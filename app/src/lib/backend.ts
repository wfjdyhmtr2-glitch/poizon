import type {
  AppMember,
  AppMemberDraft,
  ImageLookup,
  ImageLookupDraft,
  MarketOverview,
  MarketQuery,
  MarketRankRow,
  MarketSnapshotDraft,
  MarketTrendSeries,
  MemberRole,
  OtherExpense,
  OtherExpenseDraft,
  PriceCapture,
  PriceCaptureDraft,
  Product,
  ProductDraft,
  ProductImage,
  ProductImageDraft,
  ProductListResult,
  SpuInfo,
  SpuInfoDraft,
  ProductQuery,
  ProductStatus,
  PurchaseOrder,
  PurchaseOrderDraft,
  SalesListResult,
  SalesOrder,
  SalesOrderDraft,
  SalesOrderQuery,
  SpuMapping,
  SpuMappingDraft,
} from "./types"

export interface AuthUser {
  id: string
  email: string
}

export interface Backend {
  kind: "cloud" | "demo"
  label: string
  storageLabel: string

  /* ---------- 认证 ---------- */
  getSession(): Promise<AuthUser | null>
  onAuthChange(cb: (user: AuthUser | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>
  signOut(): Promise<void>

  /* ---------- 数据 ---------- */
  listProducts(query: ProductQuery): Promise<ProductListResult>
  fetchForDashboard(): Promise<Product[]>
  getProduct(id: string): Promise<Product | null>
  createProduct(draft: ProductDraft): Promise<Product>
  updateProduct(id: string, draft: Partial<ProductDraft>): Promise<Product>
  deleteProducts(ids: string[]): Promise<void>
  bulkSetStatus(ids: string[], status: ProductStatus): Promise<void>
  importProducts(
    drafts: ProductDraft[],
    mode: "insert" | "upsert",
  ): Promise<{ inserted: number; updated: number; failed: number }>

  /* ---------- 销售订单 ---------- */
  listSalesOrders(query: SalesOrderQuery): Promise<SalesListResult>
  fetchSalesForDashboard(): Promise<SalesOrder[]>
  getSalesOrder(id: string): Promise<SalesOrder | null>
  createSalesOrder(draft: SalesOrderDraft): Promise<SalesOrder>
  updateSalesOrder(id: string, draft: Partial<SalesOrderDraft>): Promise<SalesOrder>
  deleteSalesOrders(ids: string[]): Promise<void>
  bulkSetSettled(ids: string[], settled: boolean): Promise<void>
  importSalesOrders(
    drafts: SalesOrderDraft[],
    mode: "insert" | "upsert",
  ): Promise<{ inserted: number; updated: number; failed: number }>

  /* ---------- SPU 对照（平台 spuID ↔ 本店 SPUID）---------- */
  listSpuMappings(): Promise<SpuMapping[]>
  saveSpuMapping(draft: SpuMappingDraft): Promise<SpuMapping>
  deleteSpuMappings(ids: string[]): Promise<void>
  /** 拉某商品（含通过对照映射过来的外部 spuID）名下的全部订单，用于规格占用明细 */
  listSalesOrdersBySku(sku: string): Promise<SalesOrder[]>

  /* ---------- 图片库（按 SPUID / 颜色匹配）---------- */
  listProductImages(query?: { sku?: string; color?: string }): Promise<ProductImage[]>
  addProductImage(draft: ProductImageDraft): Promise<ProductImage>
  deleteProductImages(ids: string[]): Promise<void>

  /* ---------- 商品信息（SPUID → 名称/图片/售价）---------- */
  listSpuInfo(): Promise<SpuInfo[]>
  upsertSpuInfo(draft: SpuInfoDraft): Promise<SpuInfo>

  /* ---------- 入仓单（采购订单维度）---------- */
  listPurchaseOrders(): Promise<PurchaseOrder[]>
  /** 创建并确认入仓：明细数量加入商品库存，成本价按加权平均更新 */
  createPurchaseOrder(draft: PurchaseOrderDraft): Promise<PurchaseOrder>
  /** 删除入仓单并把对应数量从库存回退（成本价保持不变） */
  deletePurchaseOrders(ids: string[]): Promise<void>
  /** 删除某款下的一个规格（二级单元）：清掉对应采购明细并把数量从库存回退 */
  deletePurchaseOrderSpec(
    sku: string,
    color: string,
    size: string,
  ): Promise<{ removedQty: number }>

  /* ---------- 其他费用（平台层面的支出，不绑定商品，计入盈亏）---------- */
  listOtherExpenses(): Promise<OtherExpense[]>
  createOtherExpense(draft: OtherExpenseDraft): Promise<OtherExpense>
  updateOtherExpense(id: string, draft: Partial<OtherExpenseDraft>): Promise<OtherExpense>
  deleteOtherExpenses(ids: string[]): Promise<void>

  /* ---------- 成员与账号（读取对所有成员开放，写入仅管理员）---------- */
  /** 当前登录账号的成员档案；不在白名单里则为 null（此时前端应提示无权访问） */
  getMyMembership(): Promise<AppMember | null>
  listMembers(): Promise<AppMember[]>
  /** 管理员直接创建账号（云端走 Edge Function，用 service_role 建号） */
  createMember(draft: AppMemberDraft): Promise<AppMember>
  setMemberRole(id: string, role: MemberRole): Promise<void>
  resetMemberPassword(id: string, password: string): Promise<void>
  deleteMembers(ids: string[]): Promise<void>

  /* ---------- 市场数据（选品参考，非本店数据）---------- */
  /** 品牌清单（含各品牌商品数），用于筛选下拉 */
  listMarketBrands(): Promise<{ brand: string; skuCount: number }[]>
  getMarketOverview(query: MarketQuery): Promise<MarketOverview>
  /**
   * 机会排行：**在数据库侧聚合**后只返回 TOP N。
   * 前端永远不拉全量明细，这是数据量大也不卡的关键。
   */
  listMarketRanking(query: MarketQuery): Promise<MarketRankRow[]>
  /** 取指定商品的曲线数据；调用方需限制 skus 数量（页面里最多 8 个） */
  listMarketTrend(skus: string[], start?: string, end?: string): Promise<MarketTrendSeries[]>
  /** 批量导入快照，(sku, 日期) 相同则覆盖 */
  importMarketSnapshots(
    drafts: MarketSnapshotDraft[],
  ): Promise<{ inserted: number; updated: number; failed: number }>

  /* ---------- 价格采集（竞品比价，书签一键记录）---------- */
  listPriceCaptures(query?: {
    platform?: string
    keyword?: string
    limit?: number
  }): Promise<PriceCapture[]>
  createPriceCapture(draft: PriceCaptureDraft): Promise<PriceCapture>
  deletePriceCaptures(ids: string[]): Promise<void>

  /* ---------- 图片找同款 ---------- */
  listImageLookups(): Promise<ImageLookup[]>
  createImageLookup(draft: ImageLookupDraft): Promise<ImageLookup>
  updateImageLookup(
    id: string,
    patch: {
      keyword?: string | null
      brand?: string | null
      note?: string | null
      status?: ImageLookup["status"]
    },
  ): Promise<void>
  deleteImageLookups(ids: string[]): Promise<void>
  /**
   * 让服务端识别这张图（recognize-product Edge Function）。
   * 未部署该函数时会抛错，调用方应降级成「手动填关键词」。
   */
  recognizeImage(imageUrl: string): Promise<{ keyword: string; brand: string; note: string }>

  /* ---------- 文件 ---------- */
  supportsUpload: boolean
  uploadImage(file: File): Promise<string>
  deleteImage(url: string): Promise<void>

  /* ---------- 健康检查 ---------- */
  checkHealth(): Promise<{ ok: boolean; message: string }>
}

export class BackendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BackendError"
  }
}

export const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  updated_desc: { column: "updated_at", ascending: false },
  created_desc: { column: "created_at", ascending: false },
  price_desc: { column: "price", ascending: false },
  price_asc: { column: "price", ascending: true },
  stock_asc: { column: "stock", ascending: true },
  stock_desc: { column: "stock", ascending: false },
  name_asc: { column: "name", ascending: true },
}

export function sortRows(rows: Product[], sort: string): Product[] {
  const spec = SORT_MAP[sort] ?? SORT_MAP.updated_desc
  const key = spec.column as keyof Product
  const dir = spec.ascending ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
    return String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN") * dir
  })
}
