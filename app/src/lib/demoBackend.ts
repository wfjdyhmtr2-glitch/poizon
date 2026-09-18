import { BackendError, sortRows, type AuthUser, type Backend } from "./backend"
import { buildDemoProducts, buildDemoSalesOrders } from "./demoData"
import { compressImage, placeholderImage, uid } from "./format"
import { computeTradeStage, filterSalesOrders, orderStockEffect, sortSalesOrders, stockDelta } from "./sales"
import type {
  AppMember,
  AppMemberDraft,
  MarketQuery,
  MarketSnapshot,
  MarketTrendSeries,
  MemberRole,
  OtherExpense,
  Product,
  ProductImage,
  ProductListResult,
  ProductQuery,
  ProductStatus,
  PurchaseOrder,
  SalesListResult,
  SpuInfo,
  SalesOrder,
  SpuMapping,
} from "./types"
import { MARKET_OVERALL_SKU } from "./types"

const DATA_KEY = "yunguan.demo.products.v1"
const SALES_KEY = "yunguan.demo.sales.v1"
const MAPPING_KEY = "yunguan.demo.spu-mappings.v1"
const IMAGE_KEY = "yunguan.demo.product-images.v1"
const PO_KEY = "yunguan.demo.purchase-orders.v1"
const PO_SEEDED_KEY = "yunguan.demo.purchase-seeded.v1"
const SPU_INFO_KEY = "yunguan.demo.spu-info.v1"
const SPU_INFO_SEEDED_KEY = "yunguan.demo.spu-info-seeded.v1"
const OTHER_KEY = "yunguan.demo.other-expenses.v1"
const OTHER_SEEDED_KEY = "yunguan.demo.other-expenses-seeded.v1"
const MEMBER_KEY = "yunguan.demo.members.v1"
const MEMBER_SEEDED_KEY = "yunguan.demo.members-seeded.v1"
const MARKET_KEY = "yunguan.demo.market.v1"
const MARKET_SEEDED_KEY = "yunguan.demo.market-seeded.v1"
const SESSION_KEY = "yunguan.demo.session.v1"

const DEMO_ACCOUNT = { email: "admin@demo.com", password: "admin888" }

function readStore(): Product[] {
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (raw) {
      // 旧数据可能缺后来新增的字段，读出来时补默认值
      const rows = JSON.parse(raw) as Product[]
      return rows.map((p) => ({ ...p, shipping_fee: p.shipping_fee ?? null }))
    }
  } catch {
    /* ignore */
  }
  const seeded = buildDemoProducts()
  writeStore(seeded)
  return seeded
}

function writeStore(rows: Product[]) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError(
      "浏览器本地存储已满。演示模式下图片会存进 localStorage，建议先连接云端存储。",
    )
  }
}

/* ---------------- 演示：销售订单存储 ---------------- */

function readSalesStore(): SalesOrder[] {
  try {
    const raw = localStorage.getItem(SALES_KEY)
    if (raw) return JSON.parse(raw) as SalesOrder[]
  } catch {
    /* ignore */
  }
  const seeded = buildDemoSalesOrders(readStore())
  writeSalesStore(seeded)
  return seeded
}

function writeSalesStore(rows: SalesOrder[]) {
  try {
    localStorage.setItem(SALES_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/* ---------------- 演示：SPU 对照存储 ---------------- */

function readMappingStore(): SpuMapping[] {
  try {
    const raw = localStorage.getItem(MAPPING_KEY)
    if (raw) return JSON.parse(raw) as SpuMapping[]
  } catch {
    /* ignore */
  }
  return []
}

function writeMappingStore(rows: SpuMapping[]) {
  try {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/* ---------------- 演示：图片库存储 ---------------- */

function readImageStore(): ProductImage[] {
  try {
    const raw = localStorage.getItem(IMAGE_KEY)
    if (raw) return JSON.parse(raw) as ProductImage[]
  } catch {
    /* ignore */
  }
  // 首次访问时用演示商品的占位图生成一批，体验真实结构
  const seeded: ProductImage[] = readStore().slice(0, 6).flatMap((p, i) =>
    p.colors.slice(0, 2).map((color, j) => ({
      id: `img-${i}-${j}`,
      sku: p.sku,
      color,
      url: placeholderImage(`${p.name}-${color}`, i * 2 + j),
      created_at: new Date().toISOString(),
    })),
  )
  writeImageStore(seeded)
  return seeded
}

function writeImageStore(rows: ProductImage[]) {
  try {
    localStorage.setItem(IMAGE_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，图片存不下了，建议先连接云端存储。")
  }
}

/* ---------------- 演示：商品信息（SPUID → 名称/图片/售价）---------------- */

function readSpuInfoStore(): SpuInfo[] {
  try {
    const raw = localStorage.getItem(SPU_INFO_KEY)
    if (raw) return JSON.parse(raw) as SpuInfo[]
    if (localStorage.getItem(SPU_INFO_SEEDED_KEY)) return []
  } catch {
    /* ignore */
  }
  // 首次使用：从演示商品生成一份基础登记（无图），方便体验自动带出
  const seeded: SpuInfo[] = readStore().map((p) => ({
    id: "demo-spuinfo-" + p.sku,
    sku: p.sku,
    name: p.name,
    image_url: "",
    price: p.price,
    updated_at: p.updated_at,
  }))
  try {
    localStorage.setItem(SPU_INFO_KEY, JSON.stringify(seeded))
    localStorage.setItem(SPU_INFO_SEEDED_KEY, "1")
  } catch {
    /* ignore */
  }
  return seeded
}

function writeSpuInfoStore(rows: SpuInfo[]) {
  try {
    localStorage.setItem(SPU_INFO_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/* ---------------- 演示：其他费用（平台层面的支出，不绑定商品）---------------- */

/** 首次使用的演示数据，故意包含正负两个方向：充值记正、取回记负 */
function buildDemoOtherExpenses(): OtherExpense[] {
  const now = new Date().toISOString()
  const rows: [string, string, string, number, string][] = [
    ["2026-09-01", "保证金", "得物", 500, "开店保证金充值"],
    ["2026-09-05", "保证金", "得物", -200, "部分保证金取回"],
    ["2026-09-08", "仓储费", "得物", 180, "9 月上旬仓储费"],
    ["2026-09-10", "取回费", "得物", 45, "平台取回手续费"],
    ["2026-09-12", "会员费", "淘宝", 99, "店铺会员服务费"],
  ]
  return rows.map(([expense_date, category, platform, amount, note], i) => ({
    id: `demo-other-${i + 1}`,
    expense_date,
    category,
    platform,
    amount,
    note,
    created_at: now,
    updated_at: now,
  }))
}

function readOtherExpenseStore(): OtherExpense[] {
  try {
    const raw = localStorage.getItem(OTHER_KEY)
    if (raw) return JSON.parse(raw) as OtherExpense[]
    if (localStorage.getItem(OTHER_SEEDED_KEY)) return []
  } catch {
    /* ignore */
  }
  const seeded = buildDemoOtherExpenses()
  try {
    localStorage.setItem(OTHER_KEY, JSON.stringify(seeded))
    localStorage.setItem(OTHER_SEEDED_KEY, "1")
  } catch {
    /* ignore */
  }
  return seeded
}

function writeOtherExpenseStore(rows: OtherExpense[]) {
  try {
    localStorage.setItem(OTHER_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/** 日期倒序；同日按创建时间倒序 */
function sortOtherExpenses(rows: OtherExpense[]): OtherExpense[] {
  return [...rows].sort((a, b) => {
    if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1
    return a.created_at < b.created_at ? 1 : -1
  })
}

/* ---------------- 演示：成员与角色 ---------------- */

function readDemoSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

/** 初始演示成员：一个管理员 + 一个普通成员 */
function buildDemoMembers(): AppMember[] {
  const now = new Date().toISOString()
  return [
    {
      id: "demo-member-admin",
      email: DEMO_ACCOUNT.email,
      role: "admin",
      display_name: "店主（演示）",
      created_at: now,
      updated_at: now,
    },
    {
      id: "demo-member-staff",
      email: "staff@demo.com",
      role: "member",
      display_name: "店员小张",
      created_at: now,
      updated_at: now,
    },
  ]
}

function readMemberStore(): AppMember[] {
  try {
    const raw = localStorage.getItem(MEMBER_KEY)
    if (raw) return JSON.parse(raw) as AppMember[]
    if (localStorage.getItem(MEMBER_SEEDED_KEY)) return []
  } catch {
    /* ignore */
  }
  const seeded = buildDemoMembers()
  try {
    localStorage.setItem(MEMBER_KEY, JSON.stringify(seeded))
    localStorage.setItem(MEMBER_SEEDED_KEY, "1")
  } catch {
    /* ignore */
  }
  return seeded
}

function writeMemberStore(rows: AppMember[]) {
  try {
    localStorage.setItem(MEMBER_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/* ---------------- 演示：市场快照（选品参考：品牌销量 / 收藏数）---------------- */

/** 演示数据：3 个品牌 8 个商品 × 最近 30 天，收藏数带增长与波动 */
function buildDemoMarket(): MarketSnapshot[] {
  const brands = ["Nike", "adidas", "New Balance"]
  const names = [
    "空军一号 低帮",
    "Samba 复古",
    "574 经典",
    "Dunk 低帮",
    "2002R 灰蓝",
    "Gazelle 麂皮",
    "AJ1 中帮",
    "990v5 元祖灰",
  ]
  const rows: MarketSnapshot[] = []
  const today = new Date()
  for (let back = 29; back >= 0; back--) {
    const date = new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10)
    const step = 29 - back
    names.forEach((name, i) => {
      const base = 120 + i * 95
      const growth = step * (4 + (i % 4) * 3)
      const wave = Math.round(Math.sin((step + i * 2) / 3) * 14)
      rows.push({
        id: `demo-market-${i}-${date}`,
        scope: "brand",
        snapshot_date: date,
        sku: `MK-${String(i + 1).padStart(3, "0")}`,
        brand: brands[i % brands.length],
        name,
        sales: 4 + ((i * 5 + step * 2) % 19),
        favorites: base + growth + wave,
      })
    })
    // 每天再补一条「大盘」数据：平台整体表现
    rows.push({
      id: `demo-market-overall-${date}`,
      scope: "overall",
      snapshot_date: date,
      sku: MARKET_OVERALL_SKU,
      brand: null,
      name: "大盘（平台整体）",
      sales: 900 + step * 26 + Math.round(Math.sin(step / 4) * 60),
      favorites: 52000 + step * 310 + Math.round(Math.sin(step / 5) * 900),
    })
  }
  return rows
}

function readMarketStore(): MarketSnapshot[] {
  try {
    const raw = localStorage.getItem(MARKET_KEY)
    if (raw) return JSON.parse(raw) as MarketSnapshot[]
    if (localStorage.getItem(MARKET_SEEDED_KEY)) return []
  } catch {
    /* ignore */
  }
  const seeded = buildDemoMarket()
  try {
    localStorage.setItem(MARKET_KEY, JSON.stringify(seeded))
    localStorage.setItem(MARKET_SEEDED_KEY, "1")
  } catch {
    /* ignore */
  }
  return seeded
}

function writeMarketStore(rows: MarketSnapshot[]) {
  try {
    localStorage.setItem(MARKET_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/** 演示模式的筛选；云端是数据库侧做（见 market_ranking 函数），不拉明细 */
function filterMarket(rows: MarketSnapshot[], query: MarketQuery): MarketSnapshot[] {
  const brands = query.brands?.length ? new Set(query.brands) : null
  const keyword = query.keyword?.trim().toLowerCase() ?? ""
  const scope = query.scope ?? "brand"
  return rows.filter((r) => {
    if ((r.scope ?? "brand") !== scope) return false
    if (query.start && r.snapshot_date < query.start) return false
    if (query.end && r.snapshot_date > query.end) return false
    if (brands && !brands.has((r.brand ?? "").trim() || "未标注")) return false
    if (keyword) {
      const hay = `${r.sku} ${r.name ?? ""}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    return true
  })
}

/* ---------------- 演示：入仓单（采购订单）存储 ---------------- */

/** 与商品管理页相同的规格归一化，保证台账两边能对上 */
function normSpecDemo(color: string | null | undefined, size: string | null | undefined) {
  return [color, size]
    .filter((v) => v && v.trim())
    .join("/")
    .replace(/\s+/g, "")
    .replace(/[／,，、]/g, "/")
    .toLowerCase()
}

function readPurchaseStore(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(PO_KEY)
    if (raw) return JSON.parse(raw) as PurchaseOrder[]
    // 只在首次使用时种一次演示数据；之后删光就是空的，不会复活
    if (localStorage.getItem(PO_SEEDED_KEY)) return []
  } catch {
    /* ignore */
  }
  // 首次访问：按「入仓 = 手里 + 已卖」生成演示入仓单，让商品管理与入仓管理都有数据且能对上
  const products = readStore()
  const soldBy = new Map<string, number>()
  for (const o of readSalesStore()) {
    if (o.trade_stage !== "completed") continue
    const raw = (o.spec ?? "").split(/[/／,，、]/)
    const key = o.sku + "##" + normSpecDemo(raw[0], raw[1])
    soldBy.set(key, (soldBy.get(key) ?? 0) + 1)
  }

  const rows: PurchaseOrder[] = []
  const now = new Date()
  products.forEach((p, pi) => {
    const colors = p.colors.length ? p.colors : [""]
    const sizes = p.sizes.length ? p.sizes : [""]
    const combos: { color: string; size: string }[] = []
    for (const color of colors) for (const size of sizes) combos.push({ color, size })

    // 把手里库存均摊到各规格，再加上已卖出过的件数 = 入仓件数
    const base = Math.floor(Math.max(0, p.stock) / combos.length)
    let rest = Math.max(0, p.stock) - base * combos.length
    const items = combos.map((c, ci) => {
      const spec = normSpecDemo(c.color, c.size)
      const sold = soldBy.get(p.sku + "##" + spec) ?? 0
      let qty = base + sold
      if (rest > 0) {
        qty += 1
        rest -= 1
      }
      if (qty <= 0) qty = 1
      const cost = p.cost_price ?? 0
      return {
        id: `demo-poitem-${pi}-${ci}`,
        sku: p.sku,
        name: p.name,
        price: p.price,
        color: c.color,
        size: c.size,
        quantity: qty,
        unit_cost: cost ? Number((cost * (0.94 + ((pi + ci) % 5) * 0.03)).toFixed(2)) : null,
      }
    })

    const daysAgo = 40 + (pi % 20)
    const d = new Date(now.getTime() - daysAgo * 86400_000)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    rows.push({
      id: `demo-po-${pi}`,
      order_no: `WH-DEMO-${String(pi + 1).padStart(3, "0")}`,
      platform: p.purchase_platform ?? "1688",
      purchased_at: dateStr,
      shipping_fee: 12,
      remark: "演示入仓单",
      items,
      created_at: dateStr,
      updated_at: dateStr,
    })
  })
  writePurchaseStore(rows)
  try {
    localStorage.setItem(PO_SEEDED_KEY, "1")
  } catch {
    /* ignore */
  }
  return rows
}

function writePurchaseStore(rows: PurchaseOrder[]) {
  try {
    localStorage.setItem(PO_KEY, JSON.stringify(rows))
  } catch {
    throw new BackendError("浏览器本地存储已满，建议先连接云端数据库。")
  }
}

/**
 * 入仓明细 → 商品库存（演示模式，与云端 applyPurchaseToStock 行为一致）：
 * sign=1 确认入仓（加库存 + 加权平均成本），sign=-1 删除回退。
 */
function applyPurchaseToProducts(
  items: PurchaseOrder["items"],
  sign: 1 | -1,
  platform: string | null = null,
): void {
  interface Agg {
    qty: number
    costSum: number
    costQty: number
    name: string
    price: number | null
    colors: string[]
    sizes: string[]
  }
  const bySku = new Map<string, Agg>()
  for (const it of items) {
    const sku = it.sku.trim()
    if (!sku) continue
    const agg =
      bySku.get(sku) ??
      ({ qty: 0, costSum: 0, costQty: 0, name: "", price: null, colors: [], sizes: [] } as Agg)
    agg.qty += it.quantity
    if (it.name && !agg.name) agg.name = it.name
    if (it.color && !agg.colors.includes(it.color)) agg.colors.push(it.color)
    if (it.size && !agg.sizes.includes(it.size)) agg.sizes.push(it.size)
    if (it.unit_cost !== null && it.unit_cost !== undefined) {
      agg.costSum += it.unit_cost * it.quantity
      agg.costQty += it.quantity
    }
    bySku.set(sku, agg)
  }
  if (!bySku.size) return
  // 商品售价 / 名称兜底来自「商品信息」登记（明细里的 price 是进货总价，不作售价）
  const infoBySku = new Map(readSpuInfoStore().map((r) => [r.sku, r]))
  const products = readStore()
  const now = new Date().toISOString()
  const next = [...products]

  for (const [sku, agg] of bySku) {
    const info = infoBySku.get(sku) ?? null
    const idx = next.findIndex((p) => p.sku === sku)
    const incomingCost =
      agg.costQty > 0 ? Number((agg.costSum / agg.costQty).toFixed(2)) : null

    if (idx === -1) {
      if (sign === -1) continue
      // 新款：由入仓单建档
      next.push({
        id: uid(),
        name: agg.name || info?.name || sku,
        sku,
        purchase_platform: platform,
        category: "",
        brand: null,
        gender: null,
        seasons: [],
        colors: agg.colors,
        sizes: agg.sizes,
        material: null,
        // 售价 = 该款进货均价（Σ进货总价 ÷ Σ进货数量），随入仓自动算出
        price: agg.costQty > 0 ? Number((agg.costSum / agg.costQty).toFixed(2)) : 0,
        net_price: null,
        platform_fee: null,
        shipping_fee: null,
        cost_price: incomingCost,
        stock: agg.qty,
        locked_stock: 0,
        stock_alert: 5,
        rebate: null,
        remark: null,
        status: "on_sale",
        is_new: false,
        cover_url: null,
        images: [],
        description: null,
        tags: [],
        created_at: now,
        updated_at: now,
      } satisfies Product)
      continue
    }

    const p = next[idx]
    if (sign === -1) {
      next[idx] = { ...p, stock: Math.max(0, p.stock - agg.qty), updated_at: now }
      continue
    }
    const baseQty = Math.max(0, p.stock)
    const baseCost = (p.cost_price ?? 0) * baseQty
    const newCost =
      agg.costQty > 0
        ? Number(((baseCost + agg.costSum) / (baseQty + agg.costQty)).toFixed(2))
        : p.cost_price
    next[idx] = {
      ...p,
      stock: p.stock + agg.qty,
      cost_price: newCost,
      name: p.name || agg.name || info?.name || sku,
      price: info?.price ?? p.price,
      purchase_platform: p.purchase_platform ?? platform,
      colors: [...new Set([...p.colors, ...agg.colors])],
      sizes: [...new Set([...p.sizes, ...agg.sizes])],
      updated_at: now,
    }
  }
  writeStore(next)
}

/** 演示模式下 trade_stage 由前端推导，与云端的数据库生成列保持一致 */
function withStage(order: SalesOrder): SalesOrder {
  return { ...order, trade_stage: computeTradeStage(order.order_status, order.is_returned) }
}

/**
 * 订单里的 spuID → 商品 SPUID：先直接匹配，匹配不到再查 SPU 对照表。
 * 与云端数据库里的 resolve_order_sku() 行为保持一致。
 */
function resolveOrderSku(products: Product[], mappings: SpuMapping[], sku: string): string | null {
  if (!sku) return null
  if (products.some((p) => p.sku === sku)) return sku
  return mappings.find((m) => m.external_id === sku)?.sku ?? null
}

/**
 * 把一张订单对库存的影响写回商品（sign=1 生效，sign=-1 撤销）。
 * 云端由 sales_orders 上的触发器做同样的事，这里是演示模式的等价实现。
 */
function applyOrderStock(
  products: Product[],
  order: Pick<SalesOrder, "sku" | "order_status" | "is_returned" | "is_settled">,
  sign: 1 | -1,
): Product[] {
  const resolved = resolveOrderSku(products, readMappingStore(), order.sku)
  if (!resolved) return products
  const delta = stockDelta(orderStockEffect(order.order_status, order.is_returned, order.is_settled))
  if (!delta.locked && !delta.stock) return products
  const now = new Date().toISOString()
  return products.map((p) =>
    p.sku === resolved
      ? {
          ...p,
          locked_stock: Math.max(0, p.locked_stock + delta.locked * sign),
          stock: p.stock + delta.stock * sign,
          updated_at: now,
        }
      : p,
  )
}

function matchQuery(rows: Product[], q: ProductQuery) {
  const kw = q.keyword.trim().toLowerCase()
  return rows.filter((p) => {
    if (kw) {
      const hay = `${p.name} ${p.sku} ${p.brand ?? ""} ${p.category}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    if (q.category && q.category !== "all" && p.category !== q.category) return false
    if (q.status && q.status !== "all" && p.status !== q.status) return false
    if (q.season && q.season !== "all" && !p.seasons.includes(q.season)) return false
    return true
  })
}

export function createDemoBackend(): Backend {
  return {
    kind: "demo",
    label: "演示模式（浏览器本地数据）",
    storageLabel: "浏览器本地存储",

    async getSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        return raw ? (JSON.parse(raw) as AuthUser) : null
      } catch {
        return null
      }
    },

    onAuthChange() {
      return () => {}
    },

    async signIn(email, password) {
      await new Promise((r) => setTimeout(r, 350))
      const okEmail = email.trim().toLowerCase()
      if (okEmail !== DEMO_ACCOUNT.email || password !== DEMO_ACCOUNT.password) {
        throw new BackendError(
          `演示账号为 ${DEMO_ACCOUNT.email}，密码 ${DEMO_ACCOUNT.password}`,
        )
      }
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ id: "demo-user", email: DEMO_ACCOUNT.email }),
      )
    },

    async signUp() {
      throw new BackendError("演示模式暂不支持注册，请先连接云端数据库")
    },

    async signOut() {
      localStorage.removeItem(SESSION_KEY)
    },

    async listProducts(query): Promise<ProductListResult> {
      const all = sortRows(matchQuery(readStore(), query), query.sort)
      const from = (query.page - 1) * query.pageSize
      return { rows: all.slice(from, from + query.pageSize), total: all.length }
    },

    async fetchForDashboard() {
      return readStore()
    },

    async getProduct(id) {
      return readStore().find((p) => p.id === id) ?? null
    },

    async createProduct(draft) {
      const rows = readStore()
      if (rows.some((p) => p.sku && p.sku === draft.sku)) {
        throw new BackendError("SKU 已存在，请换一个编码")
      }
      const now = new Date().toISOString()
      const product: Product = {
        ...draft,
        id: uid(),
        locked_stock: 0,
        created_at: now,
        updated_at: now,
      }
      writeStore([product, ...rows])
      return product
    },

    async updateProduct(id, draft) {
      const rows = readStore()
      const idx = rows.findIndex((p) => p.id === id)
      if (idx === -1) throw new BackendError("商品不存在或已被删除")
      if (draft.sku && rows.some((p) => p.sku === draft.sku && p.id !== id)) {
        throw new BackendError("SKU 已存在，请换一个编码")
      }
      const merged: Product = { ...rows[idx], ...draft, updated_at: new Date().toISOString() }
      rows[idx] = merged
      writeStore(rows)
      return merged
    },

    async deleteProducts(ids) {
      const set = new Set(ids)
      writeStore(readStore().filter((p) => !set.has(p.id)))
    },

    async bulkSetStatus(ids, status: ProductStatus) {
      const set = new Set(ids)
      const now = new Date().toISOString()
      writeStore(
        readStore().map((p) => (set.has(p.id) ? { ...p, status, updated_at: now } : p)),
      )
    },

    async importProducts(drafts, mode) {
      const rows = readStore()
      const bySku = new Map(rows.map((r) => [r.sku, r]))
      let inserted = 0
      let updated = 0
      let failed = 0
      const now = new Date().toISOString()

      for (const d of drafts) {
        const existing = bySku.get(d.sku)
        if (existing) {
          if (mode === "insert") {
            failed += 1
            continue
          }
          const merged: Product = { ...existing, ...d, updated_at: now }
          const idx = rows.findIndex((r) => r.id === existing.id)
          rows[idx] = merged
          updated += 1
        } else {
          const product: Product = {
            ...d,
            id: uid(),
            locked_stock: 0,
            created_at: now,
            updated_at: now,
          }
          rows.unshift(product)
          bySku.set(d.sku, product)
          inserted += 1
        }
      }
      writeStore(rows)
      return { inserted, updated, failed }
    },

    /* ---------------- 销售订单 ---------------- */

    async listSalesOrders(query): Promise<SalesListResult> {
      const all = sortSalesOrders(
        filterSalesOrders(readSalesStore(), query),
        query.sort,
      )
      const from = (query.page - 1) * query.pageSize
      return { rows: all.slice(from, from + query.pageSize), total: all.length }
    },

    async fetchSalesForDashboard() {
      return readSalesStore()
    },

    async getSalesOrder(id) {
      return readSalesStore().find((o) => o.id === id) ?? null
    },

    async createSalesOrder(draft) {
      const rows = readSalesStore()
      if (rows.some((o) => o.order_no === draft.order_no)) {
        throw new BackendError("订单号已存在，请检查是否重复")
      }
      const now = new Date().toISOString()
      const order = withStage({
        ...draft,
        id: uid(),
        trade_stage: "unknown",
        created_at: now,
        updated_at: now,
      })
      writeSalesStore([order, ...rows])
      // 新订单生效 → 锁定 1 个库存
      writeStore(applyOrderStock(readStore(), order, 1))
      return order
    },

    async updateSalesOrder(id, draft) {
      const rows = readSalesStore()
      const idx = rows.findIndex((o) => o.id === id)
      if (idx === -1) throw new BackendError("订单不存在或已被删除")
      if (draft.order_no && rows.some((o) => o.order_no === draft.order_no && o.id !== id)) {
        throw new BackendError("订单号已存在，请检查是否重复")
      }
      const previous = rows[idx]
      const merged = withStage({
        ...rows[idx],
        ...draft,
        updated_at: new Date().toISOString(),
      })
      rows[idx] = merged
      writeSalesStore(rows)
      // 先撤销旧影响再应用新影响，状态/SPU 变化都能算对
      let products = applyOrderStock(readStore(), previous, -1)
      products = applyOrderStock(products, merged, 1)
      writeStore(products)
      return merged
    },

    async deleteSalesOrders(ids) {
      const set = new Set(ids)
      const all = readSalesStore()
      const removed = all.filter((o) => set.has(o.id))
      writeSalesStore(all.filter((o) => !set.has(o.id)))
      let products = readStore()
      for (const order of removed) products = applyOrderStock(products, order, -1)
      writeStore(products)
    },

    async bulkSetSettled(ids, settled) {
      const set = new Set(ids)
      const now = new Date().toISOString()
      let products = readStore()
      const rows = readSalesStore().map((o) => {
        if (!set.has(o.id) || o.is_settled === settled) return o
        // 结算状态变化会改变订单对库存的影响（占用 → 核销），先撤销旧影响再应用新影响
        products = applyOrderStock(products, o, -1)
        const next = { ...o, is_settled: settled, updated_at: now }
        products = applyOrderStock(products, next, 1)
        return next
      })
      writeSalesStore(rows)
      writeStore(products)
    },

    async importSalesOrders(drafts, mode) {
      const rows = readSalesStore()
      const byNo = new Map(rows.map((o) => [o.order_no, o]))
      let products = readStore()
      let inserted = 0
      let updated = 0
      let failed = 0
      const now = new Date().toISOString()

      for (const d of drafts) {
        const existing = byNo.get(d.order_no)
        if (existing) {
          if (mode === "insert") {
            failed += 1
            continue
          }
          const merged = withStage({ ...existing, ...d, updated_at: now })
          rows[rows.findIndex((o) => o.id === existing.id)] = merged
          products = applyOrderStock(products, existing, -1)
          products = applyOrderStock(products, merged, 1)
          updated += 1
        } else {
          const order = withStage({
            ...d,
            id: uid(),
            trade_stage: "unknown",
            created_at: now,
            updated_at: now,
          })
          rows.unshift(order)
          byNo.set(d.order_no, order)
          products = applyOrderStock(products, order, 1)
          inserted += 1
        }
      }
      writeSalesStore(rows)
      writeStore(products)
      return { inserted, updated, failed }
    },

    /* ---------------- SPU 对照 ---------------- */

    async listSpuMappings() {
      return readMappingStore()
    },

    async saveSpuMapping(draft) {
      const external = draft.external_id.trim()
      if (!external) throw new BackendError("请填写平台 spuID")
      if (!draft.sku) throw new BackendError("请选择要关联的商品")

      const mappings = readMappingStore()
      const existing = mappings.find((m) => m.external_id === external)
      const affected = readSalesStore().filter((o) => o.sku === external)
      const now = new Date().toISOString()

      // 先按旧解析撤销这些订单的库存影响，再按新映射重新生效（等价于云端的 refresh 触发器）
      if (affected.length) {
        let prods = readStore()
        for (const o of affected) prods = applyOrderStock(prods, o, -1)
        writeStore(prods)
      }

      const row: SpuMapping = {
        id: existing?.id ?? uid(),
        external_id: external,
        sku: draft.sku,
        note: draft.note ?? null,
        created_at: existing?.created_at ?? now,
      }
      writeMappingStore(
        existing ? mappings.map((m) => (m.id === existing.id ? row : m)) : [row, ...mappings],
      )

      if (affected.length) {
        let prods = readStore()
        for (const o of affected) prods = applyOrderStock(prods, o, 1)
        writeStore(prods)
      }
      return row
    },

    async deleteSpuMappings(ids) {
      const set = new Set(ids)
      const mappings = readMappingStore()
      const removedExternals = new Set(
        mappings.filter((m) => set.has(m.id)).map((m) => m.external_id),
      )
      const affected = readSalesStore().filter((o) => removedExternals.has(o.sku))
      if (affected.length) {
        let prods = readStore()
        for (const o of affected) prods = applyOrderStock(prods, o, -1)
        writeStore(prods)
      }
      writeMappingStore(mappings.filter((m) => !set.has(m.id)))
    },

    async listSalesOrdersBySku(sku) {
      const ids = new Set([sku, ...readMappingStore().filter((m) => m.sku === sku).map((m) => m.external_id)])
      return readSalesStore()
        .filter((o) => ids.has(o.sku))
        .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
    },

    /* ---------------- 图片库 ---------------- */

    async listProductImages(query) {
      const rows = readImageStore()
      return rows
        .filter((img) => {
          if (query?.sku && img.sku !== query.sku) return false
          if (query?.color && img.color !== query.color) return false
          return true
        })
        .sort((a, b) => a.sku.localeCompare(b.sku) || a.created_at.localeCompare(b.created_at))
    },

    async addProductImage(draft) {
      const row: ProductImage = {
        id: uid(),
        sku: draft.sku,
        color: draft.color ?? "",
        url: draft.url,
        created_at: new Date().toISOString(),
      }
      writeImageStore([row, ...readImageStore()])
      return row
    },

    async deleteProductImages(ids) {
      const set = new Set(ids)
      writeImageStore(readImageStore().filter((img) => !set.has(img.id)))
    },

    /* ---------------- 商品信息 ---------------- */

    async listSpuInfo() {
      return readSpuInfoStore()
    },

    async upsertSpuInfo(draft) {
      const sku = draft.sku.trim()
      if (!sku) throw new BackendError("SPUID 不能为空")
      const rows = readSpuInfoStore()
      const now = new Date().toISOString()
      const idx = rows.findIndex((r) => r.sku === sku)
      if (idx >= 0) {
        const next: SpuInfo = { ...rows[idx], name: draft.name.trim(), image_url: draft.image_url ?? "", price: draft.price, updated_at: now }
        rows[idx] = next
        writeSpuInfoStore(rows)
        return next
      }
      const created: SpuInfo = {
        id: uid(),
        sku,
        name: draft.name.trim(),
        image_url: draft.image_url ?? "",
        price: draft.price,
        updated_at: now,
      }
      writeSpuInfoStore([created, ...rows])
      return created
    },

    /* ---------------- 入仓单 ---------------- */

    async listPurchaseOrders() {
      return readPurchaseStore()
    },

    async createPurchaseOrder(draft) {
      if (!draft.items.length) throw new BackendError("请至少添加一行采购明细")
      const now = new Date().toISOString()
      const order: PurchaseOrder = {
        id: uid(),
        order_no: draft.order_no,
        platform: draft.platform || null,
        purchased_at: draft.purchased_at || null,
        shipping_fee: draft.shipping_fee,
        remark: draft.remark || null,
        items: draft.items.map((it, i) => ({
          id: uid() + "-" + i,
          sku: it.sku,
          name: it.name || null,
          price: it.price,
          color: it.color ?? "",
          size: it.size ?? "",
          quantity: it.quantity,
          unit_cost: it.unit_cost,
        })),
        created_at: now,
        updated_at: now,
      }
      writePurchaseStore([order, ...readPurchaseStore()])
      applyPurchaseToProducts(order.items, 1, order.platform)
      return order
    },

    async deletePurchaseOrderSpec(sku, color, size) {
      const rows = readPurchaseStore()
      let removedQty = 0
      const next = rows.map((po) => ({
        ...po,
        items: po.items.filter((it) => {
          if (it.sku !== sku || it.color !== color || it.size !== size) return true
          removedQty += it.quantity
          return false
        }),
      }))
      if (removedQty > 0) {
        writePurchaseStore(next)
        applyPurchaseToProducts(
          [
            {
              id: "spec-delete",
              sku,
              color,
              size,
              quantity: removedQty,
              unit_cost: null,
              name: null,
              price: null,
            },
          ],
          -1,
        )
      }
      return { removedQty }
    },

    async deletePurchaseOrders(ids) {
      const set = new Set(ids)
      const rows = readPurchaseStore()
      const removed = rows.filter((o) => set.has(o.id))
      for (const po of removed) applyPurchaseToProducts(po.items, -1)
      writePurchaseStore(rows.filter((o) => !set.has(o.id)))
    },

    /* ---------- 其他费用（不绑定商品，计入盈亏）---------- */

    async listOtherExpenses() {
      return sortOtherExpenses(readOtherExpenseStore())
    },

    async createOtherExpense(draft) {
      const category = draft.category.trim()
      if (!category) throw new BackendError("费用类别不能为空")
      if (!Number.isFinite(draft.amount)) throw new BackendError("金额必须是数字")
      const now = new Date().toISOString()
      const row: OtherExpense = {
        id: uid(),
        expense_date: draft.expense_date,
        category,
        platform: draft.platform?.trim() || null,
        amount: draft.amount,
        note: draft.note?.trim() || null,
        created_at: now,
        updated_at: now,
      }
      writeOtherExpenseStore([row, ...readOtherExpenseStore()])
      return row
    },

    async updateOtherExpense(id, draft) {
      const rows = readOtherExpenseStore()
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) throw new BackendError("记录不存在或已被删除")
      const next: OtherExpense = { ...rows[idx], updated_at: new Date().toISOString() }
      if (draft.expense_date !== undefined) next.expense_date = draft.expense_date
      if (draft.category !== undefined) next.category = draft.category.trim() || "其他"
      if (draft.platform !== undefined) next.platform = draft.platform?.trim() || null
      if (draft.amount !== undefined) next.amount = draft.amount
      if (draft.note !== undefined) next.note = draft.note?.trim() || null
      rows[idx] = next
      writeOtherExpenseStore(rows)
      return next
    },

    async deleteOtherExpenses(ids) {
      const set = new Set(ids)
      writeOtherExpenseStore(readOtherExpenseStore().filter((r) => !set.has(r.id)))
    },

    /* ---------- 成员与账号 ---------- */

    async getMyMembership() {
      const session = readDemoSession()
      if (!session) return null
      const rows = readMemberStore()
      return rows.find((m) => m.email.toLowerCase() === session.email.toLowerCase()) ?? null
    },

    async listMembers() {
      return readMemberStore()
    },

    async createMember(draft: AppMemberDraft) {
      const email = draft.email.trim().toLowerCase()
      if (!email.includes("@")) throw new BackendError("邮箱格式不正确")
      if (draft.password.length < 6) throw new BackendError("密码至少 6 位")
      const rows = readMemberStore()
      if (rows.some((m) => m.email.toLowerCase() === email)) {
        throw new BackendError("这个邮箱已经在成员列表里了")
      }
      const now = new Date().toISOString()
      const row: AppMember = {
        id: uid(),
        email,
        role: draft.role,
        display_name: draft.display_name?.trim() || null,
        created_at: now,
        updated_at: now,
      }
      writeMemberStore([...rows, row])
      return row
    },

    async setMemberRole(id: string, role: MemberRole) {
      const rows = readMemberStore()
      const idx = rows.findIndex((m) => m.id === id)
      if (idx < 0) throw new BackendError("成员不存在")
      if (rows[idx].email.toLowerCase() === DEMO_ACCOUNT.email && role !== "admin") {
        throw new BackendError("演示账号不能被降级")
      }
      rows[idx] = { ...rows[idx], role, updated_at: new Date().toISOString() }
      writeMemberStore(rows)
    },

    async resetMemberPassword() {
      /* 演示模式没有真实账号，改密码无实际作用（界面上会说明） */
    },

    async deleteMembers(ids) {
      const set = new Set(ids)
      const rows = readMemberStore()
      if (rows.some((m) => set.has(m.id) && m.email.toLowerCase() === DEMO_ACCOUNT.email)) {
        throw new BackendError("演示账号不能被移除")
      }
      writeMemberStore(rows.filter((m) => !set.has(m.id)))
    },

    /* ---------- 市场数据（选品参考，非本店数据）---------- */

    async listMarketBrands() {
      const skusByBrand = new Map<string, Set<string>>()
      for (const r of readMarketStore()) {
        if ((r.scope ?? "brand") !== "brand") continue
        const brand = (r.brand ?? "").trim() || "未标注"
        const set = skusByBrand.get(brand) ?? new Set<string>()
        set.add(r.sku)
        skusByBrand.set(brand, set)
      }
      return [...skusByBrand.entries()]
        .map(([brand, skus]) => ({ brand, skuCount: skus.size }))
        .sort((a, b) => b.skuCount - a.skuCount)
    },

    async getMarketOverview(query: MarketQuery) {
      const rows = filterMarket(readMarketStore(), query)
      const skus = new Set(rows.map((r) => r.sku))
      const days = [...new Set(rows.map((r) => r.snapshot_date))].sort()
      return {
        skuCount: skus.size,
        dayCount: days.length,
        latestDate: days[days.length - 1] ?? "",
        snapshotCount: rows.length,
      }
    },

    async listMarketRanking(query: MarketQuery) {
      const bySku = new Map<string, MarketSnapshot[]>()
      for (const r of filterMarket(readMarketStore(), query)) {
        const list = bySku.get(r.sku) ?? []
        list.push(r)
        bySku.set(r.sku, list)
      }
      const ranked = [...bySku.entries()].map(([sku, list]) => {
        const sorted = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
        const first = sorted[0]
        const last = sorted[sorted.length - 1]
        return {
          sku,
          name: last.name ?? "",
          brand: last.brand ?? null,
          salesTotal: sorted.reduce((acc, r) => acc + (r.sales ?? 0), 0),
          favoritesGrowth: (last.favorites ?? 0) - (first.favorites ?? 0),
          favoritesLatest: last.favorites ?? 0,
          points: sorted.length,
        }
      })
      ranked.sort((a, b) => b.favoritesGrowth - a.favoritesGrowth || b.salesTotal - a.salesTotal)
      return ranked.slice(0, query.limit ?? 60)
    },

    async listMarketTrend(skus, start, end) {
      const wanted = new Set(skus)
      const rows = readMarketStore()
        .filter((r) => wanted.has(r.sku))
        .filter((r) => (!start || r.snapshot_date >= start) && (!end || r.snapshot_date <= end))
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      return skus
        .map((sku) => {
          const list = rows.filter((r) => r.sku === sku)
          if (!list.length) return null
          const last = list[list.length - 1]
          const series: MarketTrendSeries = {
            sku,
            name: last.name ?? "",
            brand: last.brand ?? null,
            points: list.map((r) => ({
              date: r.snapshot_date,
              sales: r.sales ?? 0,
              favorites: r.favorites ?? 0,
            })),
          }
          return series
        })
        .filter((s): s is MarketTrendSeries => Boolean(s))
    },

    async importMarketSnapshots(drafts) {
      const rows = readMarketStore()
      const index = new Map(rows.map((r, i) => [`${r.sku}|${r.snapshot_date}`, i]))
      let inserted = 0
      let updated = 0
      for (const d of drafts) {
        const key = `${d.sku}|${d.snapshot_date}`
        const at = index.get(key)
        const row: MarketSnapshot = {
          id: at === undefined ? uid() : rows[at].id,
          scope: d.scope ?? "brand",
          snapshot_date: d.snapshot_date,
          sku: d.sku,
          brand: d.brand ?? null,
          name: d.name ?? null,
          sales: d.sales ?? null,
          favorites: d.favorites ?? null,
        }
        if (at === undefined) {
          index.set(key, rows.length)
          rows.push(row)
          inserted += 1
        } else {
          rows[at] = row
          updated += 1
        }
      }
      writeMarketStore(rows)
      return { inserted, updated, failed: 0 }
    },

    supportsUpload: true,

    async uploadImage(file) {
      const blob = await compressImage(file, 900, 0.75)
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new BackendError("图片读取失败"))
        reader.readAsDataURL(blob)
      })
    },

    async deleteImage() {
      /* 演示模式下图片内嵌在商品记录里，无需单独删除 */
    },

    async checkHealth() {
      return { ok: true, message: "演示模式运行中（数据仅保存在本机浏览器）" }
    },
  }
}

export const DEMO_CREDENTIALS = DEMO_ACCOUNT

export function resetDemoData() {
  localStorage.removeItem(DATA_KEY)
  localStorage.removeItem(SALES_KEY)
  const products = buildDemoProducts()
  writeStore(products)
  writeSalesStore(buildDemoSalesOrders(products))
}

export function demoPlaceholder(name: string) {
  return placeholderImage(name, name.length)
}
