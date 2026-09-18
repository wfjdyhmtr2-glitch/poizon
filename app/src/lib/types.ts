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

