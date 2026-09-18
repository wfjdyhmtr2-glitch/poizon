export type ProductStatus = "on_sale" | "off_shelf" | "draft"

export interface Product {
  id: string
  name: string
  sku: string
  /** 购入渠道，如淘宝 / 1688 / 抖店 */
  purchase_platform: string | null
  category: string
  brand: string | null
  gender: string | null
  seasons: string[]
  colors: string[]
  sizes: string[]
  material: string | null
  price: number
  /** 实际成交价，参与净利测算 */
  net_price: number | null
  /** 平台佣金、推广等支出 */
  platform_fee: number | null
  /** 运费（不入导入模板；后续由运费模块自动匹配计算） */
  shipping_fee: number | null
  cost_price: number | null
  /** 可用库存 */
  stock: number
  /** 已被「生效但未结算」的销售订单锁定的数量，由数据库触发器维护 */
  locked_stock: number
  stock_alert: number
  /** 平台返现，计入收入 */
  rebate: number | null
  remark: string | null
  status: ProductStatus
  is_new: boolean
  cover_url: string | null
  images: string[]
  description: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

/** 锁定库存由订单触发器维护，不允许表单直接改写 */
export type ProductDraft = Omit<
  Product,
  "id" | "created_at" | "updated_at" | "locked_stock"
>

export interface ProductQuery {
  keyword: string
  category: string
  status: string
  season: string
  sort: SortKey
  page: number
  pageSize: number
}

export type SortKey =
  | "updated_desc"
  | "created_desc"
  | "price_desc"
  | "price_asc"
  | "stock_asc"
  | "stock_desc"
  | "name_asc"

export interface ProductListResult {
  rows: Product[]
  total: number
}

export interface CategorySlice {
  name: string
  value: number
}

export interface PriceBand {
  band: string
  count: number
  stock: number
}

export interface TrendPoint {
  date: string
  created: number
  updated: number
}

export interface DashboardData {
  total: number
  onSale: number
  offShelf: number
  draft: number
  lowStock: number
  outOfStock: number
  totalStock: number
  /** 被未结算销售订单锁定的总数 */
  totalLocked: number
  stockValue: number
  avgPrice: number
  newThisWeek: number
  categories: CategorySlice[]
  statuses: CategorySlice[]
  priceBands: PriceBand[]
  trend: TrendPoint[]
  lowStockList: Product[]
  recentList: Product[]
}

export interface ImportRow {
  rowNo: number
  raw: Record<string, string>
  product: ProductDraft | null
  errors: string[]
  warnings: string[]
}

export interface CloudConfig {
  url: string
  anonKey: string
}

/* ============================ 销售订单 ============================ */

/** 得物侧的原始订单状态（导入时会被归一化成这三个之一） */
export type OrderStatus = "交易成功" | "交易失败" | "交易关闭成功"

/**
 * 由订单状态 + 是否退货派生的交易阶段，业务含义：
 * - unpaid            交易失败      → 买家未付款
 * - refund_before_ship 交易关闭成功  → 买家在平台发货前退款
 * - refund_after_receive 交易成功+退货 → 买家收到货后退款
 * - completed         交易成功      → 正常成交
 */
export type TradeStage =
  | "completed"
  | "refund_after_receive"
  | "refund_before_ship"
  | "unpaid"
  | "unknown"

export interface SalesOrder {
  id: string
  order_no: string
  /** 对应商品的 SPUID */
  sku: string
  spec: string | null
  order_status: OrderStatus | string
  is_returned: boolean
  is_settled: boolean
  /** 出价金额（元） */
  bid_amount: number | null
  /** 预计收入金额（元） */
  expected_income: number | null
  after_sales: string | null
  /** 买家支付时间 */
  paid_at: string | null
  /** 派生字段，云端由数据库生成列计算 */
  trade_stage: TradeStage
  created_at: string
  updated_at: string
}

export type SalesOrderDraft = Omit<
  SalesOrder,
  "id" | "created_at" | "updated_at" | "trade_stage"
>

export type SalesSortKey =
  | "paid_desc"
  | "paid_asc"
  | "income_desc"
  | "income_asc"
  | "bid_desc"
  | "updated_desc"

export interface SalesOrderQuery {
  keyword: string
  stage: string
  settled: string
  /** 买家支付时间范围（YYYY-MM-DD，含头含尾），空串表示不限 */
  paidFrom: string
  paidTo: string
  sort: SalesSortKey
  page: number
  pageSize: number
}

export interface SalesListResult {
  rows: SalesOrder[]
  total: number
}

/** SPU 对照：平台侧的 spuID ↔ 本店商品的 SPUID（两边编号体系不一致时用） */
export interface SpuMapping {
  id: string
  /** 平台导出文件里的 spuID */
  external_id: string
  /** 本店商品表里的 SPUID */
  sku: string
  note: string | null
  created_at: string
}

export type SpuMappingDraft = Omit<SpuMapping, "id" | "created_at">

/* ============================ 图片库 ============================ */

/** 图片库条目：按 SPUID（+ 可选颜色）挂图，其他模块需要图时按此匹配 */
export interface ProductImage {
  id: string
  /** 对应商品的 SPUID */
  sku: string
  /** 颜色，空串表示「该 SPU 通用」 */
  color: string
  url: string
  created_at: string
}

export type ProductImageDraft = Omit<ProductImage, "id" | "created_at">

/* ============================ 商品信息（SPUID 台账） ============================ */

/** 每个 SPUID 对应的商品名称、图片（图片导入支持粘贴）与选填售价 */
export interface SpuInfo {
  id: string
  /** SPUID，唯一 */
  sku: string
  name: string
  image_url: string
  /** 选填：商品售价（入仓建档时带入） */
  price: number | null
  updated_at: string
}

export type SpuInfoDraft = Omit<SpuInfo, "id" | "updated_at">

/* ============================ 入仓单（采购订单） ============================ */

/** 采购单明细：一单里买了哪个款、什么规格、多少件、单价多少 */
export interface PurchaseOrderItem {
  id: string
  /** 商品 SPUID（款） */
  sku: string
  /** 商品名称（新款首次入仓时创建商品用） */
  name: string | null
  /** 售价（新款首次入仓时写入商品） */
  price: number | null
  /** 颜色，空 = 不限 */
  color: string
  /** 尺码，空 = 不限 */
  size: string
  quantity: number
  /** 该规格的进货单价 */
  unit_cost: number | null
}

export interface PurchaseOrder {
  id: string
  /** 入仓单号 */
  order_no: string
  /** 购入平台 */
  platform: string | null
  /** 采购日期 YYYY-MM-DD */
  purchased_at: string | null
  /** 本单运费（记录用，成本摊薄由运费模块接管） */
  shipping_fee: number | null
  remark: string | null
  items: PurchaseOrderItem[]
  created_at: string
  updated_at: string
}

export interface PurchaseOrderDraft {
  order_no: string
  platform: string | null
  purchased_at: string | null
  shipping_fee: number | null
  remark: string | null
  items: Omit<PurchaseOrderItem, "id">[]
}

/**
 * 其他费用：平台层面、摊不到具体商品上的支出
 * （得物的取回费 / 仓储费 / 保证金，其他平台的会员费等），单独记账并计入盈亏。
 *
 * 金额符号约定：**正数 = 支出**（增加成本），**负数 = 收回 / 退回**（冲减成本）。
 * 例：充值保证金记 +1000，日后取回保证金记 -1000，是两条独立记录，
 * 这样「其他费用合计」天然是净额，直接作为盈亏减项。
 *
 * 暂不绑定商品（无 sku 字段），后续若要做按款摊派再扩展。
 */
export interface OtherExpense {
  id: string
  /** 发生日期 YYYY-MM-DD */
  expense_date: string
  /** 费用类别，如 保证金 / 仓储费 / 取回费 / 会员费 */
  category: string
  /** 关联平台，如 得物 / 淘宝；可为空 */
  platform: string | null
  /** 金额：正 = 支出，负 = 收回 */
  amount: number
  note: string | null
  created_at: string
  updated_at: string
}

export interface OtherExpenseDraft {
  expense_date: string
  category: string
  platform?: string | null
  amount: number
  note?: string | null
}

/* ============================ 成员与角色 ============================ */

/**
 * 成员角色。
 * - `admin`：可管理账号、可删除业务数据
 * - `member`：只能查看与录入（不能删、不能管账号）
 *
 * 超管邮箱（shuo@dewu.com）永远视为 admin，且不能被降级或删除。
 */
export type MemberRole = "admin" | "member"

/** 成员档案（即账号白名单）：不在这张表里的账号看不到任何业务数据 */
export interface AppMember {
  id: string
  email: string
  role: MemberRole
  display_name: string | null
  created_at: string
  updated_at: string
}

/** 新建账号：邮箱 + 初始密码 + 角色 */
export interface AppMemberDraft {
  email: string
  password: string
  role: MemberRole
  display_name?: string | null
}

export interface StageSlice {
  stage: TradeStage
  label: string
  count: number
  income: number
}

export interface SalesTrendPoint {
  date: string
  completed: number
  refunded: number
  unpaid: number
  income: number
}

export interface SpuRankRow {
  sku: string
  name: string
  orders: number
  income: number
  cost: number
  profit: number
  hasCost: boolean
}

export interface SalesDashboardData {
  totalOrders: number
  completedOrders: number
  completedRate: number
  totalIncome: number
  totalBid: number
  avgIncome: number
  unpaidCount: number
  refundBeforeShipCount: number
  refundAfterReceiveCount: number
  settledIncome: number
  unsettledIncome: number
  settledCount: number
  unsettledCount: number
  /** 仍锁定着库存的订单数（生效未结算） */
  lockedOrders: number
  /** 已核销库存的订单数（已结算） */
  consumedOrders: number
  stages: StageSlice[]
  trend: SalesTrendPoint[]
  topSpus: SpuRankRow[]
  recent: SalesOrder[]
  coverageDays: number
}

export interface SalesImportRow {
  rowNo: number
  raw: Record<string, string>
  order: SalesOrderDraft | null
  errors: string[]
  warnings: string[]
}

/* ============================ 市场数据（选品参考）============================ */

/**
 * 市场数据的口径：
 * - `overall`：大盘数据（平台整体）
 * - `brand`：品牌 / 单商品数据
 *
 * 导入时按表格里的「标签」列自动归类，页面上分两个 Tab 展示。
 */
export type MarketScope = "overall" | "brand"

/**
 * 市场快照：定时抓取的「非本店」公开数据（销量、收藏数），
 * 用来判断哪些品还有销售机会。
 *
 * 一个商品一天一条记录；`(owner_id, sku, snapshot_date)` 唯一，
 * 所以同一天重复导入是**覆盖**而不是堆叠——可以放心地反复导。
 */
export interface MarketSnapshot {
  id: string
  /** 大盘 / 品牌 */
  scope: MarketScope
  /** 数据日期 YYYY-MM-DD */
  snapshot_date: string
  /** 商品 SPUID；大盘数据没有具体商品时用 `__OVERALL__` */
  sku: string
  brand: string | null
  name: string | null
  /** 平台销量（按导入的列填，件或金额都行） */
  sales: number | null
  /** 收藏数 */
  favorites: number | null
}

export interface MarketSnapshotDraft {
  /** 不带时按品牌数据处理 */
  scope?: MarketScope
  snapshot_date: string
  sku: string
  brand?: string | null
  name?: string | null
  sales?: number | null
  favorites?: number | null
}

/** 大盘数据没有具体商品，统一用这个哨兵 SPUID */
export const MARKET_OVERALL_SKU = "__OVERALL__"

/** 筛选条件（排行与概览共用） */
export interface MarketQuery {
  scope?: MarketScope
  brands?: string[]
  keyword?: string
  /** 起始日期 YYYY-MM-DD */
  start?: string
  /** 结束日期 YYYY-MM-DD */
  end?: string
  /** 排行返回条数上限 */
  limit?: number
}

/** 排行行：时间区间内按商品聚合后的表现 */
export interface MarketRankRow {
  sku: string
  name: string
  brand: string | null
  /** 区间内销量合计 */
  salesTotal: number
  /** 区间内收藏增量（最后一天 − 第一天） */
  favoritesGrowth: number
  /** 最后一天的收藏数 */
  favoritesLatest: number
  /** 区间内覆盖的天数 */
  points: number
}

/** 数据概览 */
export interface MarketOverview {
  skuCount: number
  dayCount: number
  latestDate: string
  snapshotCount: number
}

/** 曲线上的一个点 */
export interface MarketTrendPoint {
  date: string
  sales: number
  favorites: number
}

/** 一个商品的时间序列 */
export interface MarketTrendSeries {
  sku: string
  name: string
  brand: string | null
  points: MarketTrendPoint[]
}

/** 导入时可识别的列名（表头模糊匹配用，大小写与空格都会归一化） */
export const MARKET_IMPORT_COLUMNS: {
  header: string
  key: keyof MarketSnapshotDraft
  required?: boolean
  hint: string
}[] = [
  {
    header: "标签",
    key: "scope",
    hint: "填「大盘」或「品牌」，决定这条数据进哪个 Tab；不填按品牌处理",
  },
  { header: "日期", key: "snapshot_date", required: true, hint: "2026-09-18 这种格式" },
  { header: "SPUID", key: "sku", hint: "商品编号；大盘数据可以留空" },
  { header: "品牌", key: "brand", hint: "如 Nike / 阿迪达斯" },
  { header: "商品名称", key: "name", hint: "便于识别" },
  { header: "销量", key: "sales", hint: "平台销量（件或金额都行）" },
  { header: "收藏数", key: "favorites", hint: "该商品当前收藏数" },
]

/** 把导入表格里的「标签」文字归一化成口径；认不出来按品牌处理 */
export function normalizeMarketScope(raw: unknown): MarketScope {
  const text = String(raw ?? "").trim().toLowerCase()
  if (!text) return "brand"
  if (/大盘|整体|平台|全部|overall|total|all/.test(text)) return "overall"
  return "brand"
}

