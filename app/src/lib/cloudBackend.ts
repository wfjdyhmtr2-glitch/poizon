import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  BackendError,
  SORT_MAP,
  type Backend,
} from "./backend"
import type {
  AppMember,
  AppMemberDraft,
  CloudConfig,
  ImageLookup,
  ImageLookupDraft,
  MarketQuery,
  MarketTrendSeries,
  MemberPermissions,
  MemberRole,
  OtherExpense,
  PriceCapture,
  PriceCaptureDraft,
  Product,
  SpuInfo,
  ProductImage,
  ProductListResult,
  ProductQuery,
  ProductStatus,
  PurchaseOrder,
  SalesOrder,
  SpuMapping,
} from "./types"
import { PERMISSION_MODULES } from "./types"
import { compressImage, placeholderImage } from "./format"
import { computeTradeStage } from "./sales"

export const BUCKET = "product-images"

/**
 * PostgREST 找不到表 / 相关对象时的几种说法。
 * 除了 "relation does not exist"，新版还会返回
 * "Could not find the table 'public.products' in the schema cache"。
 */
const TABLE_MISSING =
  /does not exist|could not find the table|schema cache|undefined table|undefined relation/i

const PRODUCT_COLUMNS =
  "id,name,sku,purchase_platform,category,brand,gender,seasons,colors,sizes,material,price,net_price,platform_fee,shipping_fee,cost_price,stock,locked_stock,stock_alert,rebate,remark,status,is_new,cover_url,images,description,tags,created_at,updated_at"

/** trade_stage 是数据库生成列，只读不写 */
const SALES_COLUMNS =
  "id,order_no,sku,spec,order_status,is_returned,is_settled,bid_amount,expected_income,after_sales,tag,paid_at,resolved_sku,trade_stage,created_at,updated_at"

const SALES_SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  paid_desc: { column: "paid_at", ascending: false },
  paid_asc: { column: "paid_at", ascending: true },
  income_desc: { column: "expected_income", ascending: false },
  income_asc: { column: "expected_income", ascending: true },
  bid_desc: { column: "bid_amount", ascending: false },
  updated_desc: { column: "updated_at", ascending: false },
}

const OTHER_EXPENSE_COLUMNS =
  "id,expense_date,category,platform,amount,note,created_at,updated_at"

/** 其他费用行归一化：date 只留 YYYY-MM-DD，金额统一成数字 */
function normalizeOtherExpense(row: Record<string, unknown>): OtherExpense {
  return {
    id: String(row.id),
    expense_date: String(row.expense_date ?? "").slice(0, 10),
    category: String(row.category ?? "其他") || "其他",
    platform: row.platform ? String(row.platform) : null,
    amount: Number(row.amount ?? 0),
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  }
}

const MEMBER_COLUMNS = "id,email,role,display_name,permissions,created_at,updated_at"

/** 权限列解析：只保留合法模块 + 合法档位，其余丢弃（避免历史脏数据把界面搞乱） */
function normalizePermissions(raw: unknown): MemberPermissions {
  if (!raw || typeof raw !== "object") return {}
  const source = raw as Record<string, unknown>
  const out: MemberPermissions = {}
  for (const mod of PERMISSION_MODULES) {
    const level = source[mod.id]
    if (level === "view" || level === "edit") out[mod.id] = level
  }
  return out
}

/** 成员行归一化 */
function normalizeMember(row: Record<string, unknown>): AppMember {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    role: row.role === "admin" ? "admin" : "member",
    display_name: row.display_name ? String(row.display_name) : null,
    permissions: normalizePermissions(row.permissions),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  }
}

/**
 * Edge Function 报错时，业务错误信息在响应体里而不是 error.message。
 * 另外函数没部署时 supabase-js 只会给一句 "Failed to send a request…"，
 * 这里翻译成可操作的提示，避免用户对着报错发懵。
 *
 * ⚠️ 提示语必须**按函数**传进来，不能写成全局常量：
 * 曾经所有函数共用一个兜底文案，结果「识图函数没部署」也提示
 * 「请部署 admin-users」，把人引到了完全无关的地方。
 */
async function describeFunctionError(error: unknown, notDeployedHint: string): Promise<string> {
  const e = error as { message?: string; context?: { status?: number; json?: () => Promise<unknown> } }
  const status = e?.context?.status
  // 最可靠的信号：网关直接 404 —— 这个函数根本没部署
  if (status === 404) return notDeployedHint
  if (e?.context && typeof e.context.json === "function") {
    try {
      const body = (await e.context.json()) as { error?: string; code?: string; message?: string }
      // 函数已部署、但它自己拒绝了这次操作（真正的业务错误）
      if (body?.error) return String(body.error)
      // 网关兜底格式：{ code: "NOT_FOUND", message: "Requested function was not found" }
      if (body?.code === "NOT_FOUND" || /not found/i.test(String(body?.message ?? ""))) {
        return notDeployedHint
      }
    } catch {
      /* 响应体不是 JSON，走下面的通用处理 */
    }
  }
  const msg = e?.message ?? String(error)
  // 注意 "non-2xx"：supabase-js 遇到 404 抛的就是这句，比 "Failed to send a request" 更常见，
  // 漏掉它会导致提示退化成一串英文报错
  if (/Failed to send a request|Failed to fetch|non-2xx|not found|404|relay/i.test(msg)) {
    return notDeployedHint
  }
  return msg
}

/** 账号管理函数未部署时的提示。引用 README 用**小节标题**而不是序号，避免以后章节顺序变了失效 */
const ADMIN_USERS_MISSING =
  "账号管理服务不可用：请先在 Supabase 部署 admin-users Edge Function（见 README「成员与权限」一节）"

/** 调用账号管理 Edge Function，统一处理错误 */
async function callAdminUsers(
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.functions.invoke("admin-users", { body })
  if (error) throw new BackendError(await describeFunctionError(error, ADMIN_USERS_MISSING))
}

const PRICE_CAPTURE_COLUMNS =
  "id,captured_at,platform,title,price,source_url,sku,note,created_at"

/** 价格采集行归一化 */
function normalizePriceCapture(row: Record<string, unknown>): PriceCapture {
  return {
    id: String(row.id),
    platform: row.platform ? String(row.platform) : null,
    title: String(row.title ?? ""),
    price: nullableNumber(row.price),
    source_url: row.source_url ? String(row.source_url) : null,
    sku: row.sku ? String(row.sku) : null,
    note: row.note ? String(row.note) : null,
    captured_at: String(row.captured_at ?? "").slice(0, 10),
    created_at: String(row.created_at ?? ""),
  }
}

const IMAGE_LOOKUP_COLUMNS = "id,image_url,status,keyword,brand,note,created_at"

/** 图片找同款行归一化 */
function normalizeImageLookup(row: Record<string, unknown>): ImageLookup {
  const status = String(row.status ?? "pending")
  return {
    id: String(row.id),
    image_url: String(row.image_url ?? ""),
    status: status === "done" || status === "failed" ? status : "pending",
    keyword: row.keyword ? String(row.keyword) : null,
    brand: row.brand ? String(row.brand) : null,
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at ?? ""),
  }
}

/** 关键字里可能破坏 PostgREST 查询语法的字符，先剔除 */
function sanitizeKeyword(input: string) {
  return input.replace(/[,()*]/g, " ").replace(/\s+/g, " ").trim()
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined || value === "" ? null : Number(value)
}

function normalize(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    sku: String(row.sku ?? ""),
    purchase_platform: (row.purchase_platform as string) ?? null,
    category: (row.category as string) ?? "",
    brand: (row.brand as string) ?? null,
    gender: (row.gender as string) ?? null,
    seasons: (row.seasons as string[]) ?? [],
    colors: (row.colors as string[]) ?? [],
    sizes: (row.sizes as string[]) ?? [],
    material: (row.material as string) ?? null,
    price: Number(row.price ?? 0),
    net_price: nullableNumber(row.net_price),
    platform_fee: nullableNumber(row.platform_fee),
    shipping_fee: nullableNumber(row.shipping_fee),
    cost_price: nullableNumber(row.cost_price),
    stock: Number(row.stock ?? 0),
    locked_stock: Number(row.locked_stock ?? 0),
    stock_alert: Number(row.stock_alert ?? 0),
    rebate: nullableNumber(row.rebate),
    remark: (row.remark as string) ?? null,
    status: (row.status as ProductStatus) ?? "draft",
    is_new: Boolean(row.is_new),
    cover_url: (row.cover_url as string) ?? null,
    images: (row.images as string[]) ?? [],
    description: (row.description as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

export function createCloudBackend(config: CloudConfig): Backend {
  let cached: SupabaseClient | null = null

  const client = () => {
    if (!cached) {
      cached = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "yunguan.auth",
        },
      })
    }
    return cached
  }

  const table = () => client().from("products")
  const salesTable = () => client().from("sales_orders")

  const backend: Backend = {
    kind: "cloud",
    label: "云端数据库已连接",
    storageLabel: "Supabase Storage",

    async getSession() {
      const { data } = await client().auth.getSession()
      const u = data.session?.user
      return u ? { id: u.id, email: u.email ?? "" } : null
    },

    onAuthChange(cb) {
      const { data } = client().auth.onAuthStateChange((_event, session) => {
        const u = session?.user
        cb(u ? { id: u.id, email: u.email ?? "" } : null)
      })
      return () => data.subscription.unsubscribe()
    },

    async signIn(email, password) {
      const { error } = await client().auth.signInWithPassword({ email, password })
      if (error) throw new BackendError(translateAuthError(error.message))
    },

    async signUp(email, password) {
      const { data, error } = await client().auth.signUp({ email, password })
      if (error) throw new BackendError(translateAuthError(error.message))
      return { needsConfirm: !data.session }
    },

    async signOut() {
      await client().auth.signOut()
    },

    async listProducts(query: ProductQuery): Promise<ProductListResult> {
      const from = (query.page - 1) * query.pageSize
      const to = from + query.pageSize - 1
      let q = table().select(PRODUCT_COLUMNS, { count: "exact" })

      const kw = sanitizeKeyword(query.keyword)
      if (kw) {
        q = q.or(`name.ilike.%${kw}%,sku.ilike.%${kw}%,brand.ilike.%${kw}%`)
      }
      if (query.category && query.category !== "all") q = q.eq("category", query.category)
      if (query.status && query.status !== "all") q = q.eq("status", query.status)
      if (query.season && query.season !== "all") q = q.contains("seasons", [query.season])

      const spec = SORT_MAP[query.sort] ?? SORT_MAP.updated_desc
      q = q.order(spec.column, { ascending: spec.ascending }).range(from, to)

      const { data, error, count } = await q
      if (error) throw new BackendError(translateDbError(error.message))
      return {
        rows: (data ?? []).map((r) => normalize(r as Record<string, unknown>)),
        total: count ?? 0,
      }
    },

    async fetchForDashboard() {
      const { data, error } = await table()
        .select(PRODUCT_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(2000)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalize(r as Record<string, unknown>))
    },

    async getProduct(id) {
      const { data, error } = await table().select(PRODUCT_COLUMNS).eq("id", id).maybeSingle()
      if (error) throw new BackendError(error.message)
      return data ? normalize(data as Record<string, unknown>) : null
    },

    async createProduct(draft) {
      const payload = { ...draft, updated_at: new Date().toISOString() }
      const { data, error } = await table().insert(payload).select(PRODUCT_COLUMNS).single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalize(data as Record<string, unknown>)
    },

    async updateProduct(id, draft) {
      const payload = { ...draft, updated_at: new Date().toISOString() }
      const { data, error } = await table()
        .update(payload)
        .eq("id", id)
        .select(PRODUCT_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalize(data as Record<string, unknown>)
    },

    async deleteProducts(ids) {
      const { error } = await table().delete().in("id", ids)
      if (error) throw new BackendError(error.message)
    },

    async bulkSetStatus(ids, status) {
      const { error } = await table()
        .update({ status, updated_at: new Date().toISOString() })
        .in("id", ids)
      if (error) throw new BackendError(error.message)
    },

    async importProducts(drafts, mode) {
      let inserted = 0
      let updated = 0
      const chunkSize = 100

      for (let i = 0; i < drafts.length; i += chunkSize) {
        const chunk = drafts.slice(i, i + chunkSize)
        const payload = chunk.map((d) => ({ ...d, updated_at: new Date().toISOString() }))
        const { data, error } = await table()
          .upsert(payload, { onConflict: "sku", ignoreDuplicates: mode === "insert" })
          .select("sku")
        if (error) throw new BackendError(translateDbError(error.message))
        const count = data?.length ?? 0
        if (mode === "insert") inserted += count
        else {
          inserted += 0
          updated += count
        }
      }

      if (mode === "upsert") {
        // upsert 无法直接区分新增/更新，用总数近似呈现
        inserted = 0
        updated = drafts.length
      }
      return { inserted, updated, failed: 0 }
    },

    /* ---------------- 销售订单 ---------------- */

    async listSalesOrders(query) {
      const from = (query.page - 1) * query.pageSize
      const to = from + query.pageSize - 1
      let q = salesTable().select(SALES_COLUMNS, { count: "exact" })

      const kw = sanitizeKeyword(query.keyword)
      if (kw) q = q.or(`order_no.ilike.%${kw}%,sku.ilike.%${kw}%,spec.ilike.%${kw}%`)
      if (query.stage && query.stage !== "all") q = q.eq("trade_stage", query.stage)
      if (query.settled === "settled") q = q.eq("is_settled", true)
      if (query.settled === "unsettled") q = q.eq("is_settled", false)
      if (query.paidFrom) q = q.gte("paid_at", query.paidFrom)
      if (query.paidTo) {
        // 含头含尾：上界取次日零点前（paid_at 是 timestamptz，按 UTC 日期与看板口径一致）
        const end = new Date(`${query.paidTo}T00:00:00Z`)
        end.setUTCDate(end.getUTCDate() + 1)
        q = q.lt("paid_at", end.toISOString())
      }

      const spec = SALES_SORT_MAP[query.sort] ?? SALES_SORT_MAP.paid_desc
      q = q.order(spec.column, { ascending: spec.ascending }).range(from, to)

      const { data, error, count } = await q
      if (error) throw new BackendError(translateDbError(error.message))
      return {
        rows: (data ?? []).map((r) => normalizeSales(r as Record<string, unknown>)),
        total: count ?? 0,
      }
    },

    async fetchSalesForDashboard() {
      const { data, error } = await salesTable()
        .select(SALES_COLUMNS)
        .order("paid_at", { ascending: false })
        .limit(5000)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeSales(r as Record<string, unknown>))
    },

    async getSalesOrder(id) {
      const { data, error } = await salesTable()
        .select(SALES_COLUMNS)
        .eq("id", id)
        .maybeSingle()
      if (error) throw new BackendError(translateDbError(error.message))
      return data ? normalizeSales(data as Record<string, unknown>) : null
    },

    async createSalesOrder(draft) {
      const { data, error } = await salesTable()
        .insert({ ...draft, updated_at: new Date().toISOString() })
        .select(SALES_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeSales(data as Record<string, unknown>)
    },

    async updateSalesOrder(id, draft) {
      const { data, error } = await salesTable()
        .update({ ...draft, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(SALES_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeSales(data as Record<string, unknown>)
    },

    async deleteSalesOrders(ids) {
      const { error } = await salesTable().delete().in("id", ids)
      if (error) throw new BackendError(error.message)
    },

    async bulkSetSettled(ids, settled) {
      const { error } = await salesTable()
        .update({ is_settled: settled, updated_at: new Date().toISOString() })
        .in("id", ids)
      if (error) throw new BackendError(error.message)
    },

    async importSalesOrders(drafts, mode) {
      const chunkSize = 100
      for (let i = 0; i < drafts.length; i += chunkSize) {
        const chunk = drafts.slice(i, i + chunkSize)
        const payload = chunk.map((d) => ({ ...d, updated_at: new Date().toISOString() }))
        const { error } = await salesTable().upsert(payload, {
          onConflict: "order_no",
          ignoreDuplicates: mode === "insert",
        })
        if (error) throw new BackendError(translateDbError(error.message))
      }
      return mode === "insert"
        ? { inserted: drafts.length, updated: 0, failed: 0 }
        : { inserted: 0, updated: drafts.length, failed: 0 }
    },

    /* ---------------- SPU 对照 ---------------- */

    async listSpuMappings() {
      const { data, error } = await client()
        .from("spu_mappings")
        .select("id,external_id,sku,note,created_at")
        .order("created_at", { ascending: false })
        .limit(2000)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeMapping(r as Record<string, unknown>))
    },

    async saveSpuMapping(draft) {
      const { data, error } = await client()
        .from("spu_mappings")
        .upsert(
          { external_id: draft.external_id, sku: draft.sku, note: draft.note || null },
          { onConflict: "external_id" },
        )
        .select("id,external_id,sku,note,created_at")
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeMapping(data as Record<string, unknown>)
    },

    async deleteSpuMappings(ids) {
      const { error } = await client().from("spu_mappings").delete().in("id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    async listSalesOrdersBySku(sku) {
      // 订单里存的可能是外部 spuID，把通过对照映射到该商品的一并查出来
      const { data: mappings } = await client()
        .from("spu_mappings")
        .select("external_id")
        .eq("sku", sku)
        .limit(1000)
      const ids = [sku, ...((mappings ?? []) as { external_id: string }[]).map((m) => m.external_id)]
      const { data, error } = await salesTable()
        .select(SALES_COLUMNS)
        .in("sku", ids)
        .order("paid_at", { ascending: false })
        .limit(5000)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeSales(r as Record<string, unknown>))
    },

    /* ---------------- 图片库 ---------------- */

    async listProductImages(query) {
      let q = client().from("product_images").select("id,sku,color,url,created_at")
      if (query?.sku) q = q.eq("sku", query.sku)
      if (query?.color) q = q.eq("color", query.color)
      const { data, error } = await q
        .order("sku", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeImage(r as Record<string, unknown>))
    },

    async addProductImage(draft) {
      const { data, error } = await client()
        .from("product_images")
        .insert({
          sku: draft.sku,
          color: draft.color ?? "",
          url: draft.url,
        })
        .select("id,sku,color,url,created_at")
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeImage(data as Record<string, unknown>)
    },

    async deleteProductImages(ids) {
      const { error } = await client().from("product_images").delete().in("id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    /* ---------------- 入仓单 ---------------- */

    async listPurchaseOrders() {
      const { data: pos, error } = await client()
        .from("purchase_orders")
        .select("id,order_no,platform,purchased_at,shipping_fee,remark,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(2000)
      if (error) throw new BackendError(translateDbError(error.message))
      const { data: items, error: itemError } = await client()
        .from("purchase_order_items")
        .select("id,purchase_order_id,sku,name,price,color,size,quantity,unit_cost")
        .limit(20000)
      if (itemError) throw new BackendError(translateDbError(itemError.message))
      const byPo = new Map<string, Record<string, unknown>[]>()
      for (const it of (items ?? []) as Record<string, unknown>[]) {
        const key = String(it.purchase_order_id)
        const list = byPo.get(key) ?? []
        list.push(it)
        byPo.set(key, list)
      }
      return (pos ?? []).map((r) =>
        normalizePurchaseOrder(r as Record<string, unknown>, byPo.get(String(r.id)) ?? []),
      )
    },

    async createPurchaseOrder(draft) {
      if (!draft.items.length) throw new BackendError("请至少添加一行采购明细")
      const { data: po, error } = await client()
        .from("purchase_orders")
        .insert({
          order_no: draft.order_no,
          platform: draft.platform || null,
          purchased_at: draft.purchased_at || null,
          shipping_fee: draft.shipping_fee,
          remark: draft.remark || null,
        })
        .select("id,order_no,platform,purchased_at,shipping_fee,remark,created_at,updated_at")
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      const { data: items, error: itemError } = await client()
        .from("purchase_order_items")
        .insert(
          draft.items.map((it) => ({
            purchase_order_id: po.id,
            sku: it.sku,
            name: it.name || null,
            price: it.price,
            color: it.color ?? "",
            size: it.size ?? "",
            quantity: it.quantity,
            unit_cost: it.unit_cost,
          })),
        )
        .select("id,purchase_order_id,sku,color,size,quantity,unit_cost")
      if (itemError) throw new BackendError(translateDbError(itemError.message))
      await applyPurchaseToStock(client(), (items ?? []) as unknown as Record<string, unknown>[], 1, draft.platform || null)
      return normalizePurchaseOrder(po as Record<string, unknown>, (items ?? []) as Record<string, unknown>[])
    },

    async deletePurchaseOrderSpec(sku, color, size) {
      // 找到该规格名下的全部采购明细（RLS 自动限定为自己名下）
      const { data: items, error } = await client()
        .from("purchase_order_items")
        .select("id,quantity")
        .eq("sku", sku)
        .eq("color", color)
        .eq("size", size)
      if (error) throw new BackendError(translateDbError(error.message))
      const rows = (items ?? []) as { id: string; quantity: number }[]
      if (!rows.length) return { removedQty: 0 }
      const removedQty = rows.reduce((acc, r) => acc + Number(r.quantity ?? 0), 0)

      // 回退商品库存
      const { data: current } = await client()
        .from("products")
        .select("id,stock")
        .eq("sku", sku)
        .maybeSingle()
      if (current) {
        const { error: upError } = await client()
          .from("products")
          .update({
            stock: Math.max(0, Number(current.stock ?? 0) - removedQty),
            updated_at: new Date().toISOString(),
          })
          .eq("id", String(current.id))
        if (upError) throw new BackendError(translateDbError(upError.message))
      }

      const { error: delError } = await client()
        .from("purchase_order_items")
        .delete()
        .in("id", rows.map((r) => r.id))
      if (delError) throw new BackendError(translateDbError(delError.message))
      return { removedQty }
    },

    async deletePurchaseOrders(ids) {
      const { data: items, error } = await client()
        .from("purchase_order_items")
        .select("id,purchase_order_id,sku,color,size,quantity,unit_cost")
        .in("purchase_order_id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
      const { error: delError } = await client().from("purchase_orders").delete().in("id", ids)
      if (delError) throw new BackendError(translateDbError(delError.message))
      if (items?.length) await applyPurchaseToStock(client(), items as unknown as Record<string, unknown>[], -1)
    },

    /* ---------- 其他费用（不绑定商品，计入盈亏）---------- */

    async listOtherExpenses() {
      const { data, error } = await client()
        .from("other_expenses")
        .select(OTHER_EXPENSE_COLUMNS)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeOtherExpense(r as Record<string, unknown>))
    },

    async createOtherExpense(draft) {
      const category = draft.category.trim()
      if (!category) throw new BackendError("费用类别不能为空")
      if (!Number.isFinite(draft.amount)) throw new BackendError("金额必须是数字")
      const { data, error } = await client()
        .from("other_expenses")
        .insert({
          expense_date: draft.expense_date,
          category,
          platform: draft.platform?.trim() || null,
          amount: draft.amount,
          note: draft.note?.trim() || null,
        })
        .select(OTHER_EXPENSE_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeOtherExpense(data as Record<string, unknown>)
    },

    async updateOtherExpense(id, draft) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (draft.expense_date !== undefined) patch.expense_date = draft.expense_date
      if (draft.category !== undefined) patch.category = draft.category.trim() || "其他"
      if (draft.platform !== undefined) patch.platform = draft.platform?.trim() || null
      if (draft.amount !== undefined) patch.amount = draft.amount
      if (draft.note !== undefined) patch.note = draft.note?.trim() || null
      const { data, error } = await client()
        .from("other_expenses")
        .update(patch)
        .eq("id", id)
        .select(OTHER_EXPENSE_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeOtherExpense(data as Record<string, unknown>)
    },

    async deleteOtherExpenses(ids) {
      if (!ids.length) return
      const { error } = await client().from("other_expenses").delete().in("id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    /* ---------- 成员与账号 ---------- */

    async getMyMembership() {
      const { data: authData } = await client().auth.getUser()
      const uid = authData.user?.id
      if (!uid) return null
      const { data, error } = await client()
        .from("app_members")
        .select(MEMBER_COLUMNS)
        .eq("id", uid)
        .maybeSingle()
      if (error) return null
      return data ? normalizeMember(data as Record<string, unknown>) : null
    },

    async listMembers() {
      const { data, error } = await client()
        .from("app_members")
        .select(MEMBER_COLUMNS)
        .order("created_at", { ascending: true })
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeMember(r as Record<string, unknown>))
    },

    async createMember(draft: AppMemberDraft) {
      const email = draft.email.trim().toLowerCase()
      await callAdminUsers(client(), {
        action: "create",
        email,
        password: draft.password,
        role: draft.role,
        display_name: draft.display_name ?? null,
        permissions: draft.permissions ?? {},
      })
      const { data, error } = await client()
        .from("app_members")
        .select(MEMBER_COLUMNS)
        .eq("email", email)
        .maybeSingle()
      if (error || !data) {
        throw new BackendError("账号已创建，但读取成员记录失败，刷新页面即可看到")
      }
      return normalizeMember(data as Record<string, unknown>)
    },

    async setMemberRole(id: string, role: MemberRole) {
      await callAdminUsers(client(), { action: "setRole", id, role })
    },

    async setMemberPermissions(id: string, permissions: MemberPermissions) {
      await callAdminUsers(client(), { action: "setPermissions", id, permissions })
    },

    async resetMemberPassword(id: string, password: string) {
      await callAdminUsers(client(), { action: "resetPassword", id, password })
    },

    async deleteMembers(ids) {
      // Edge Function 一次处理一个账号，逐个调用（成员数量很少，够用）
      for (const id of ids) {
        await callAdminUsers(client(), { action: "delete", id })
      }
    },

    /* ---------- 市场数据（选品参考，非本店数据）---------- */

    async listMarketBrands() {
      const { data, error } = await client().rpc("market_brands")
      if (error) throw new BackendError(translateDbError(error.message))
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        brand: String(r.brand ?? "未标注"),
        skuCount: Number(r.sku_count ?? 0),
      }))
    },

    async getMarketOverview(query: MarketQuery) {
      const { data, error } = await client().rpc("market_overview", {
        p_start: query.start ?? null,
        p_end: query.end ?? null,
        p_scope: query.scope ?? "brand",
      })
      if (error) throw new BackendError(translateDbError(error.message))
      const row = ((data ?? []) as Record<string, unknown>[])[0] ?? {}
      return {
        skuCount: Number(row.sku_count ?? 0),
        dayCount: Number(row.day_count ?? 0),
        latestDate: row.latest_date ? String(row.latest_date).slice(0, 10) : "",
        snapshotCount: Number(row.snapshot_count ?? 0),
      }
    },

    async listMarketRanking(query: MarketQuery) {
      const { data, error } = await client().rpc("market_ranking", {
        p_start: query.start ?? null,
        p_end: query.end ?? null,
        p_brands: query.brands?.length ? query.brands : null,
        p_keyword: query.keyword?.trim() || null,
        p_limit: query.limit ?? 60,
        p_scope: query.scope ?? "brand",
      })
      if (error) throw new BackendError(translateDbError(error.message))
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        sku: String(r.sku ?? ""),
        name: String(r.name ?? ""),
        brand: r.brand ? String(r.brand) : null,
        salesTotal: Number(r.sales_total ?? 0),
        favoritesGrowth: Number(r.favorites_growth ?? 0),
        favoritesLatest: Number(r.favorites_latest ?? 0),
        points: Number(r.points ?? 0),
      }))
    },

    async listMarketTrend(skus: string[], start?: string, end?: string) {
      if (!skus.length) return []
      let q = client()
        .from("market_snapshots")
        .select("sku,snapshot_date,sales,favorites,name,brand")
        .in("sku", skus)
        .order("snapshot_date", { ascending: true })
      if (start) q = q.gte("snapshot_date", start)
      if (end) q = q.lte("snapshot_date", end)
      const { data, error } = await q
      if (error) throw new BackendError(translateDbError(error.message))

      const bySku = new Map<string, MarketTrendSeries>()
      for (const raw of data ?? []) {
        const row = raw as Record<string, unknown>
        const sku = String(row.sku ?? "")
        let series = bySku.get(sku)
        if (!series) {
          series = {
            sku,
            name: String(row.name ?? ""),
            brand: row.brand ? String(row.brand) : null,
            points: [],
          }
          bySku.set(sku, series)
        }
        series.points.push({
          date: String(row.snapshot_date ?? "").slice(0, 10),
          sales: Number(row.sales ?? 0),
          favorites: Number(row.favorites ?? 0),
        })
      }
      // 保持调用方传入的顺序，图表颜色才稳定
      return skus
        .map((s) => bySku.get(s))
        .filter((s): s is MarketTrendSeries => Boolean(s))
    },

    async importMarketSnapshots(drafts) {
      if (!drafts.length) return { inserted: 0, updated: 0, failed: 0 }
      const SIZE = 500 // 分片，避免单次请求体过大
      let failed = 0
      for (let i = 0; i < drafts.length; i += SIZE) {
        const chunk = drafts.slice(i, i + SIZE).map((d) => ({
          scope: d.scope ?? "brand",
          snapshot_date: d.snapshot_date,
          sku: d.sku,
          brand: d.brand ?? null,
          name: d.name ?? null,
          sales: d.sales ?? null,
          favorites: d.favorites ?? null,
        }))
        const { error } = await client()
          .from("market_snapshots")
          .upsert(chunk, { onConflict: "owner_id,sku,snapshot_date" })
        if (error) failed += chunk.length
      }
      return { inserted: drafts.length - failed, updated: 0, failed }
    },

    /* ---------- 价格采集（竞品比价，书签一键记录）---------- */

    async listPriceCaptures(query) {
      let q = client()
        .from("price_captures")
        .select(PRICE_CAPTURE_COLUMNS)
        .order("captured_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(query?.limit ?? 200)
      if (query?.platform) q = q.eq("platform", query.platform)
      const keyword = sanitizeKeyword(query?.keyword?.trim() ?? "")
      if (keyword) q = q.or(`title.ilike.%${keyword}%,sku.ilike.%${keyword}%`)
      const { data, error } = await q
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizePriceCapture(r as Record<string, unknown>))
    },

    async createPriceCapture(draft: PriceCaptureDraft) {
      const title = draft.title.trim()
      if (!title) throw new BackendError("商品名称不能为空")
      const { data, error } = await client()
        .from("price_captures")
        .insert({
          captured_at: draft.captured_at || new Date().toISOString().slice(0, 10),
          platform: draft.platform?.trim() || null,
          title,
          price: draft.price ?? null,
          source_url: draft.source_url?.trim() || null,
          sku: draft.sku?.trim() || null,
          note: draft.note?.trim() || null,
        })
        .select(PRICE_CAPTURE_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizePriceCapture(data as Record<string, unknown>)
    },

    async deletePriceCaptures(ids) {
      if (!ids.length) return
      const { error } = await client().from("price_captures").delete().in("id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    /* ---------- 图片找同款 ---------- */

    async listImageLookups() {
      const { data, error } = await client()
        .from("image_lookups")
        .select(IMAGE_LOOKUP_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => normalizeImageLookup(r as Record<string, unknown>))
    },

    async createImageLookup(draft: ImageLookupDraft) {
      const { data, error } = await client()
        .from("image_lookups")
        .insert({
          image_url: draft.image_url,
          keyword: draft.keyword ?? null,
          brand: draft.brand ?? null,
          note: draft.note ?? null,
          status: draft.keyword ? "done" : "pending",
        })
        .select(IMAGE_LOOKUP_COLUMNS)
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return normalizeImageLookup(data as Record<string, unknown>)
    },

    async updateImageLookup(id, patch) {
      const payload: Record<string, unknown> = {}
      if (patch.keyword !== undefined) payload.keyword = patch.keyword
      if (patch.brand !== undefined) payload.brand = patch.brand
      if (patch.note !== undefined) payload.note = patch.note
      if (patch.status !== undefined) payload.status = patch.status
      if (!Object.keys(payload).length) return
      const { error } = await client().from("image_lookups").update(payload).eq("id", id)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    async deleteImageLookups(ids) {
      if (!ids.length) return
      const { error } = await client().from("image_lookups").delete().in("id", ids)
      if (error) throw new BackendError(translateDbError(error.message))
    },

    async recognizeImage(imageUrl: string) {
      const { data, error } = await client().functions.invoke("recognize-product", {
        body: { image_url: imageUrl },
      })
      // 没部署这个函数是**正常情况**（设计上就允许不装，退化成手填关键词），
      // 所以提示要温和，别吓人、更别指错方向
      if (error) {
        throw new BackendError(
          await describeFunctionError(error, "未配置自动识图，手填关键词就行（想开启见 README）"),
        )
      }
      const row = (data ?? {}) as { keyword?: string; brand?: string; note?: string }
      return {
        keyword: String(row.keyword ?? ""),
        brand: String(row.brand ?? ""),
        note: String(row.note ?? ""),
      }
    },

    supportsUpload: true,

    async listSpuInfo() {
      const { data, error } = await client()
        .from("spu_info")
        .select("id,sku,name,image_url,price,goods_no,updated_at")
        .order("updated_at", { ascending: false })
      if (error) throw new BackendError(translateDbError(error.message))
      return (data ?? []).map((r) => {
        const row = r as Record<string, unknown>
        return {
          id: String(row.id),
          sku: String(row.sku ?? ""),
          name: String(row.name ?? ""),
          image_url: String(row.image_url ?? ""),
          price: nullableNumber(row.price),
          goods_no: row.goods_no ? String(row.goods_no) : null,
          updated_at: String(row.updated_at ?? ""),
        }
      })
    },

    async upsertSpuInfo(draft) {
      const sku = draft.sku.trim()
      if (!sku) throw new BackendError("SPUID 不能为空")
      const payload = {
        sku,
        name: draft.name.trim(),
        image_url: draft.image_url ?? "",
        price: draft.price,
        goods_no: draft.goods_no?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      // RLS 自动限定在自己名下；按 (owner_id, sku) 先查后写，避免全局 upsert 冲突
      const { data: existing } = await client()
        .from("spu_info")
        .select("id")
        .eq("sku", sku)
        .maybeSingle()
      if (existing) {
        const { data, error } = await client()
          .from("spu_info")
          .update(payload)
          .eq("id", String((existing as Record<string, unknown>).id))
          .select("id,sku,name,image_url,price,goods_no,updated_at")
          .single()
        if (error) throw new BackendError(translateDbError(error.message))
        return data as unknown as SpuInfo
      }
      const { data, error } = await client()
        .from("spu_info")
        .insert(payload)
        .select("id,sku,name,image_url,price,goods_no,updated_at")
        .single()
      if (error) throw new BackendError(translateDbError(error.message))
      return data as unknown as SpuInfo
    },

    async uploadImage(file) {
      const blob = await compressImage(file)
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"
      const now = new Date()
      const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`
      const { error } = await client()
        .storage.from(BUCKET)
        .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false })
      if (error) throw new BackendError(`图片上传失败：${error.message}`)
      const { data } = client().storage.from(BUCKET).getPublicUrl(path)
      return data.publicUrl
    },

    async deleteImage(url) {
      const marker = `/object/public/${BUCKET}/`
      const idx = url.indexOf(marker)
      if (idx === -1) return
      const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
      await client().storage.from(BUCKET).remove([path])
    },

    async checkHealth() {
      const { error } = await table().select("id", { head: true, count: "exact" }).limit(1)
      if (error) {
        // 字段缺失要排在前头：它的报错同样含 "does not exist"
        if (/column\s+\S*\s*does not exist/i.test(error.message)) {
          const missing = /column\s+([\w.]+)\s+does not exist/i.exec(error.message)?.[1]
          return {
            ok: false,
            message: `数据库缺了新增字段${missing ? `（${missing}）` : ""}。请把初始化 SQL 在 Supabase 的 SQL Editor 里重新执行一次，脚本会自动补齐字段与触发器，不会动已有数据。`,
          }
        }
        if (TABLE_MISSING.test(error.message)) {
          return {
            ok: false,
            message:
              "连接是通的，但数据库里还没有 products 表。请到 Supabase 的 SQL Editor 执行初始化脚本（点「初始化指引」标签可直接复制）。",
          }
        }
        if (/invalid api key|no api key|jwt/i.test(error.message)) {
          return { ok: false, message: "anon key 不正确或没复制完整，请重新复制一次" }
        }
        return { ok: false, message: error.message }
      }

      const salesCheck = await salesTable().select("id", { head: true, count: "exact" }).limit(1)
      if (salesCheck.error) {
        if (TABLE_MISSING.test(salesCheck.error.message)) {
          return {
            ok: false,
            message:
              "商品表正常，但销售订单表 sales_orders 还没建。请在 SQL Editor 里重新执行一次初始化脚本，会补上这张表。",
          }
        }
        return { ok: false, message: salesCheck.error.message }
      }

      return { ok: true, message: "云端数据库连接正常，商品表与销售订单表都已就绪" }
    },
  }

  return backend
}

function normalizePurchaseOrder(
  row: Record<string, unknown>,
  items: Record<string, unknown>[],
): PurchaseOrder {
  return {
    id: String(row.id),
    order_no: String(row.order_no ?? ""),
    platform: (row.platform as string) ?? null,
    purchased_at: (row.purchased_at as string) ?? null,
    shipping_fee: nullableNumber(row.shipping_fee),
    remark: (row.remark as string) ?? null,
    items: items.map((it) => ({
      id: String(it.id),
      sku: String(it.sku ?? ""),
      name: (it.name as string) ?? null,
      price: nullableNumber(it.price),
      color: String(it.color ?? ""),
      size: String(it.size ?? ""),
      quantity: Number(it.quantity ?? 0),
      unit_cost: nullableNumber(it.unit_cost),
    })),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

/**
 * 入仓明细 → 商品（商品数据的唯一来源）：
 * - sign=1 确认入仓：新款自动建档（名称/平台/售价/成本/颜色尺码），老款加库存 + 加权平均成本，
 *   并用明细里的名称、售价、颜色、尺码补全资料。
 * - sign=-1 删除入仓单：只回退库存，商品档案保留。
 * 加权平均 = (当前库存×现成本 + 入仓件数×入仓单价) / (当前库存 + 入仓件数)。
 */
async function applyPurchaseToStock(
  // 用最小接口而非 SupabaseClient 泛型，避免版本参数不匹配
  cli: { from: (table: string) => any },
  items: Record<string, unknown>[],
  sign: 1 | -1,
  platform: string | null = null,
) {
  interface Agg {
    qty: number
    costSum: number
    costQty: number
    name: string
    price: number | null
    colors: Set<string>
    sizes: Set<string>
  }
  const bySku = new Map<string, Agg>()
  for (const it of items) {
    const sku = String(it.sku ?? "").trim()
    if (!sku) continue
    const agg =
      bySku.get(sku) ??
      ({ qty: 0, costSum: 0, costQty: 0, name: "", price: null, colors: new Set(), sizes: new Set() } as Agg)
    const qty = Number(it.quantity ?? 0)
    agg.qty += qty
    const name = String(it.name ?? "").trim()
    if (name && !agg.name) agg.name = name
    const color = String(it.color ?? "").trim()
    const size = String(it.size ?? "").trim()
    if (color) agg.colors.add(color)
    if (size) agg.sizes.add(size)
    if (it.unit_cost !== null && it.unit_cost !== undefined) {
      agg.costSum += Number(it.unit_cost) * qty
      agg.costQty += qty
    }
    bySku.set(sku, agg)
  }

  // 商品售价 / 名称兜底来自「商品信息」登记（明细里的 price 是进货总价，不作售价）
  const { data: infoRows } = await cli.from("spu_info").select("sku,name,price")
  const infoBySku = new Map<string, { name: string | null; price: number | null }>(
    ((infoRows ?? []) as { sku: string; name: string | null; price: number | null }[]).map((r) => [
      String(r.sku),
      { name: r.name, price: r.price === null ? null : Number(r.price) },
    ]),
  )

  const now = new Date().toISOString()
  for (const [sku, agg] of bySku) {
    const info = infoBySku.get(sku) ?? null
    const { data: current } = await cli
      .from("products")
      .select("id,stock,cost_price,name,price,purchase_platform,colors,sizes")
      .eq("sku", sku)
      .maybeSingle()

    if (sign === -1) {
      // 回退库存，档案保留
      if (!current) continue
      const stock = Math.max(0, Number(current.stock ?? 0) - agg.qty)
      const { error } = await cli
        .from("products")
        .update({ stock, updated_at: now })
        .eq("id", String(current.id))
      if (error) throw new BackendError(translateDbError(error.message))
      continue
    }

    const incomingCost = agg.costQty > 0 ? Number((agg.costSum / agg.costQty).toFixed(2)) : null

    if (!current) {
      // 新款：由入仓单建档
      const { error } = await cli.from("products").insert({
        sku,
        name: agg.name || info?.name || sku,
        purchase_platform: platform,
        // 售价 = 该款进货均价（Σ进货总价 ÷ Σ进货数量），随入仓自动算出
        price: agg.costQty > 0 ? Number((agg.costSum / agg.costQty).toFixed(2)) : 0,
        cost_price: incomingCost,
        stock: agg.qty,
        locked_stock: 0,
        stock_alert: 5,
        status: "on_sale",
        colors: [...agg.colors],
        sizes: [...agg.sizes],
        images: [],
        tags: [],
        seasons: [],
      })
      if (error) throw new BackendError(translateDbError(error.message))
      continue
    }

    // 老款：加库存 + 加权平均成本 + 补全资料
    const stock = Number(current.stock ?? 0)
    const oldCost = current.cost_price === null ? null : Number(current.cost_price)
    let newCost = oldCost
    if (agg.costQty > 0) {
      const baseQty = Math.max(0, stock)
      const baseCost = (oldCost ?? 0) * baseQty
      newCost = Number(((baseCost + agg.costSum) / (baseQty + agg.costQty)).toFixed(2))
    }
    const oldColors = Array.isArray(current.colors) ? (current.colors as string[]) : []
    const oldSizes = Array.isArray(current.sizes) ? (current.sizes as string[]) : []
    const { error } = await cli
      .from("products")
      .update({
        stock: stock + agg.qty,
        cost_price: newCost,
        name: current.name || agg.name || info?.name || sku,
        price: info?.price ?? current.price ?? 0,
        purchase_platform: current.purchase_platform ?? platform,
        colors: [...new Set([...oldColors, ...agg.colors])],
        sizes: [...new Set([...oldSizes, ...agg.sizes])],
        updated_at: now,
      })
      .eq("id", String(current.id))
    if (error) throw new BackendError(translateDbError(error.message))
  }
}

function normalizeImage(row: Record<string, unknown>): ProductImage {
  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    color: String(row.color ?? ""),
    url: String(row.url ?? ""),
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

function normalizeMapping(row: Record<string, unknown>): SpuMapping {
  return {
    id: String(row.id),
    external_id: String(row.external_id ?? ""),
    sku: String(row.sku ?? ""),
    note: (row.note as string) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

function normalizeSales(row: Record<string, unknown>): SalesOrder {
  return {
    id: String(row.id),
    order_no: String(row.order_no ?? ""),
    sku: String(row.sku ?? ""),
    spec: (row.spec as string) ?? null,
    order_status: String(row.order_status ?? ""),
    is_returned: Boolean(row.is_returned),
    is_settled: Boolean(row.is_settled),
    bid_amount: nullableNumber(row.bid_amount),
    expected_income: nullableNumber(row.expected_income),
    after_sales: (row.after_sales as string) ?? null,
    tag: (row.tag as string) ?? null,
    paid_at: (row.paid_at as string) ?? null,
    // 数据库触发器算好的归属 SPUID（老库可能没这列，读不到就为 null）
    resolved_sku: (row.resolved_sku as string) ?? null,
    // 生成列缺失时（老库）回退到前端推导，保证界面不崩
    trade_stage:
      (row.trade_stage as SalesOrder["trade_stage"]) ??
      computeTradeStage(String(row.order_status ?? ""), Boolean(row.is_returned)),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

function translateAuthError(message: string) {  if (/Invalid login credentials/i.test(message)) return "邮箱或密码不正确"
  if (/Email not confirmed/i.test(message)) return "邮箱尚未验证，请先到邮箱里点确认链接"
  if (/User already registered/i.test(message)) return "该邮箱已注册，请直接登录"
  if (/Password should be at least/i.test(message)) return "密码至少 6 位"
  if (/rate limit|too many/i.test(message)) return "请求过于频繁，请稍后再试"
  return message
}

function translateDbError(message: string) {
  if (/duplicate key.*order_no/i.test(message)) return "订单号已存在，请检查是否重复导入"
  if (/duplicate key.*sku/i.test(message)) return "SPUID 已存在，请换一个编号"
  if (/row-level security/i.test(message)) return "没有权限写入，请检查数据表的 RLS 策略"
  if (/column\s+\S*\s*does not exist/i.test(message)) {
    return "数据库缺了新增字段，请把初始化 SQL 重新执行一次（会自动补齐字段，不会动已有数据）"
  }
  if (TABLE_MISSING.test(message)) return "数据表 products 不存在，请先执行初始化 SQL"
  return message
}

/** 演示模式下的占位图，保证导入/新建时也有视觉反馈 */
export function demoCover(name: string) {
  return placeholderImage(name, name.length)
}
