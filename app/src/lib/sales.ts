import { ORDER_STATUSES, TRADE_STAGE_META } from "./constants"
import type {
  OrderStatus,
  Product,
  SalesDashboardData,
  SalesOrder,
  SalesOrderDraft,
  SalesSortKey,
  SpuMapping,
  SpuRankRow,
  StageSlice,
  TradeStage,
} from "./types"

/* ------------------------- 解析与派生 ------------------------- */

/**
 * 得物后台导出的「订单生效中」状态（买家已付款，只是还没走完流程）。
 * 这些状态在页面上原样显示，但交易阶段、库存占用必须当作「交易成功」来算，
 * 否则待发货的订单不占库存、盈亏也会漏。数据库侧 order_stock_effect / trade_stage
 * 用的是同一套正则，两边要一起改。
 */
export const ACTIVE_ORDER_STATUS_PATTERN =
  /交易成功|已完成|已成交|成交成功|待卖家发货|待平台发货|已发货|待平台收货|平台已收货|待买家收货|待收货|已签收|鉴别中|待鉴别|已入仓|待入仓/

/** 把平台里五花八门的写法收敛到三种标准状态 */
export function normalizeOrderStatus(raw: string): OrderStatus | string {
  const v = (raw || "").trim()
  if (!v) return "交易成功"
  if (/关闭成功|交易关闭|已关闭|取消成功/.test(v)) return "交易关闭成功"
  if (ACTIVE_ORDER_STATUS_PATTERN.test(v)) return "交易成功"
  if (/交易失败|未付款|待付款|已取消|付款失败|失败/.test(v)) return "交易失败"
  return v
}

/**
 * 核心业务规则：
 *  - 交易失败          → 买家未付款
 *  - 交易关闭成功      → 买家在平台发货前退款
 *  - 交易成功 + 退货   → 买家收到货后退款
 *  - 交易成功 + 未退货 → 正常成交
 */
export function computeTradeStage(orderStatus: string, isReturned: boolean): TradeStage {
  const status = normalizeOrderStatus(orderStatus)
  if (status === "交易失败") return "unpaid"
  if (status === "交易关闭成功") return "refund_before_ship"
  if (status === "交易成功") return isReturned ? "refund_after_receive" : "completed"
  return "unknown"
}

export function isKnownOrderStatus(raw: string): boolean {
  return (ORDER_STATUSES as readonly string[]).includes(normalizeOrderStatus(raw))
}

const TRUE_VALUES = /^(是|有|y|yes|true|t|1|√|✓)$/i
const FALSE_VALUES = /^(否|无|n|no|false|f|0|-|—)$/i

/** 是否退货 / 是否结算：空值按 false，识别不了返回 null 交给调用方给警告 */
export function parseBool(raw: string): boolean | null {
  const v = (raw || "").trim()
  if (!v) return false
  if (TRUE_VALUES.test(v)) return true
  if (FALSE_VALUES.test(v)) return false
  return null
}

/** 金额：容忍「¥1,299.00」这类写法 */
export function parseMoney(raw: string): number | null {
  const v = (raw || "").trim()
  if (!v) return null
  const n = Number(v.replace(/[^\d.-]/g, ""))
  return Number.isNaN(n) ? null : n
}

/**
 * 支付时间：支持 2026-09-01 12:30(:00)、2026/9/1 12:30、2026.09.01，
 * 以及 Excel 直接给的日期序列号。
 */
export function parseDateTime(raw: string): string | null {
  const v = (raw || "").trim()
  if (!v) return null

  if (/^\d+(\.\d+)?$/.test(v)) {
    const serial = Number(v)
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }

  const m = v.match(
    /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  )
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    )
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function emptySalesDraft(): SalesOrderDraft {
  return {
    order_no: "",
    sku: "",
    spec: "",
    order_status: "交易成功",
    is_returned: false,
    is_settled: false,
    bid_amount: null,
    expected_income: null,
    settled_amount: null,
    settled_at: null,
    after_sales: "",
    tag: "",
    paid_at: new Date().toISOString(),
  }
}

/** ISO → datetime-local 输入框的值 */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** datetime-local 的值 → ISO */
export function fromDateTimeInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function tradeStageLabel(stage: string) {
  return TRADE_STAGE_META[stage]?.label ?? TRADE_STAGE_META.unknown.label
}

/* ------------------------- 库存联动 ------------------------- */

/**
 * 一张订单对商品库存的影响，三态：
 * - released 不占用：买家未付款 / 发货前退款 / 签收后退款 → 库存不动
 * - locked   锁定中：交易成功未退货、但平台还没结算 → 1 个从可用挪到锁定
 * - consumed 已核销：交易成功未退货且已结算 → 锁定释放，可用永久少 1 个
 *
 * 云端由 sales_orders 上的触发器维护，这里的实现供演示模式与界面预览使用，
 * 两边规则必须保持一致（SQL 见 schemaSql.ts 的 order_stock_effect）。
 */
export type StockEffect = "released" | "locked" | "consumed"

export function orderStockEffect(
  orderStatus: string,
  isReturned: boolean,
  isSettled: boolean,
): StockEffect {
  if (computeTradeStage(orderStatus, isReturned) !== "completed") return "released"
  return isSettled ? "consumed" : "locked"
}

/** 相对「什么都没发生」的增量：locked 会从可用挪走 1 个，consumed 直接扣掉 1 个 */
export function stockDelta(effect: StockEffect): { locked: number; stock: number } {
  if (effect === "locked") return { locked: 1, stock: -1 }
  if (effect === "consumed") return { locked: 0, stock: -1 }
  return { locked: 0, stock: 0 }
}

export function orderStockEffectOf(order: {
  order_status: string
  is_returned: boolean
  is_settled: boolean
}): StockEffect {
  return orderStockEffect(order.order_status, order.is_returned, order.is_settled)
}

/* ------------------------- 排序 ------------------------- */

export function sortSalesOrders(rows: SalesOrder[], sort: SalesSortKey): SalesOrder[] {
  const list = [...rows]
  const num = (v: number | null) => (v === null || v === undefined ? -Infinity : v)
  switch (sort) {
    case "paid_asc":
      return list.sort((a, b) => (a.paid_at ?? "").localeCompare(b.paid_at ?? ""))
    case "income_desc":
      return list.sort((a, b) => num(b.expected_income) - num(a.expected_income))
    case "income_asc":
      return list.sort((a, b) => num(a.expected_income) - num(b.expected_income))
    case "bid_desc":
      return list.sort((a, b) => num(b.bid_amount) - num(a.bid_amount))
    case "updated_desc":
      return list.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    case "paid_desc":
    default:
      return list.sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
  }
}

export function filterSalesOrders(rows: SalesOrder[], query: {
  keyword: string
  stage: string
  settled: string
  paidFrom?: string
  paidTo?: string
}): SalesOrder[] {
  const kw = query.keyword.trim().toLowerCase()
  return rows.filter((o) => {
    if (kw) {
      const hay = `${o.order_no} ${o.sku} ${o.spec ?? ""} ${o.after_sales ?? ""}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    if (query.stage && query.stage !== "all" && o.trade_stage !== query.stage) return false
    if (query.settled === "settled" && !o.is_settled) return false
    if (query.settled === "unsettled" && o.is_settled) return false
    if (query.paidFrom || query.paidTo) {
      // 没有支付时间的订单无法归入范围，与看板口径一致：排除
      if (!o.paid_at) return false
      const d = o.paid_at.slice(0, 10)
      if (query.paidFrom && d < query.paidFrom) return false
      if (query.paidTo && d > query.paidTo) return false
    }
    return true
  })
}

/* ------------------------- 看板聚合 ------------------------- */

const STAGE_ORDER: TradeStage[] = [
  "completed",
  "refund_before_ship",
  "refund_after_receive",
  "unpaid",
  "unknown",
]

/** 看板时间范围：YYYY-MM-DD，含头含尾 */
export interface SalesDateRange {
  start: string
  end: string
}

export type SalesRangePreset = "all" | "today" | "7d" | "30d" | "90d" | "custom"

export const SALES_RANGE_PRESETS: { key: SalesRangePreset; label: string }[] = [
  { key: "all", label: "全部时间" },
  { key: "today", label: "今天" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "90d", label: "近 90 天" },
  { key: "custom", label: "自定义" },
]

const fmtDayLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** 把筛选预设换算成日期范围；无法换算（自定义没填全/起止颠倒）返回 null 表示不限 */
export function presetRange(
  preset: SalesRangePreset,
  custom: { start: string; end: string },
): SalesDateRange | null {
  const today = new Date()
  switch (preset) {
    case "all":
      return null
    case "today": {
      const s = fmtDayLocal(today)
      return { start: s, end: s }
    }
    case "7d":
      return {
        start: fmtDayLocal(new Date(today.getTime() - 6 * 86400_000)),
        end: fmtDayLocal(today),
      }
    case "30d":
      return {
        start: fmtDayLocal(new Date(today.getTime() - 29 * 86400_000)),
        end: fmtDayLocal(today),
      }
    case "90d":
      return {
        start: fmtDayLocal(new Date(today.getTime() - 89 * 86400_000)),
        end: fmtDayLocal(today),
      }
    case "custom":
      return custom.start && custom.end && custom.start <= custom.end ? custom : null
  }
}

const fmtDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export function buildSalesDashboard(
  orders: SalesOrder[],
  products: Product[] = [],
  mappings: SpuMapping[] = [],
  range?: SalesDateRange,
): SalesDashboardData {
  /* 趋势分桶：未传范围 → 近 30 天按天；范围 ≤ 92 天 → 按天；更长 → 按月 */
  let bucketKeys: string[]
  let bucketOf: (paidAt: string) => string
  if (range) {
    const startD = new Date(`${range.start}T00:00:00`)
    const endD = new Date(`${range.end}T00:00:00`)
    const spanDays = Math.round((endD.getTime() - startD.getTime()) / 86400_000)
    if (Number.isNaN(spanDays) || spanDays < 0) {
      bucketKeys = []
      bucketOf = () => ""
    } else if (spanDays <= 92) {
      bucketKeys = []
      for (let t = startD.getTime(); t <= endD.getTime(); t += 86400_000) {
        bucketKeys.push(fmtDay(new Date(t)))
      }
      bucketOf = (p) => p.slice(0, 10)
    } else {
      bucketKeys = []
      const cur = new Date(startD.getFullYear(), startD.getMonth(), 1)
      const endM = new Date(endD.getFullYear(), endD.getMonth(), 1)
      while (cur <= endM) {
        bucketKeys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`)
        cur.setMonth(cur.getMonth() + 1)
      }
      bucketOf = (p) => p.slice(0, 7)
    }
  } else {
    const now = Date.now()
    bucketKeys = []
    for (let i = 29; i >= 0; i--) bucketKeys.push(fmtDay(new Date(now - i * 86400_000)))
    bucketOf = (p) => p.slice(0, 10)
  }

  const trendMap = new Map<string, { completed: number; refunded: number; unpaid: number; income: number }>()
  for (const key of bucketKeys) trendMap.set(key, { completed: 0, refunded: 0, unpaid: 0, income: 0 })

  const stageMap = new Map<string, { count: number; income: number }>()
  const spuMap = new Map<string, { orders: number; income: number }>()

  /** 对照感知：订单里的外部 spuID 先解析到本店 SPUID 再聚合 */
  const externalToSku = new Map(mappings.map((m) => [m.external_id, m.sku]))
  const resolveSku = (sku: string) => externalToSku.get(sku) ?? sku

  let totalIncome = 0
  let totalBid = 0
  let completedOrders = 0
  let settledIncome = 0
  let unsettledIncome = 0
  let settledCount = 0
  let unsettledCount = 0
  let lockedOrders = 0
  let consumedOrders = 0

  for (const o of orders) {
    const meta = TRADE_STAGE_META[o.trade_stage] ?? TRADE_STAGE_META.unknown
    const income = o.expected_income ?? 0
    // 已结算的单子用对账单同步来的「实际结算金额」，没同步到才回退预计收入
    const incomeIfSettled = o.settled_amount ?? income
    const bid = o.bid_amount ?? 0

    const effect = orderStockEffect(o.order_status, o.is_returned, o.is_settled)
    if (effect === "locked") lockedOrders += 1
    else if (effect === "consumed") consumedOrders += 1

    const stage = stageMap.get(o.trade_stage) ?? { count: 0, income: 0 }
    stage.count += 1
    if (meta.countsAsIncome) stage.income += income
    stageMap.set(o.trade_stage, stage)

    totalBid += bid
    if (meta.countsAsIncome) {
      completedOrders += 1
      totalIncome += incomeIfSettled
      if (o.is_settled) {
        settledIncome += incomeIfSettled
        settledCount += 1
      } else {
        unsettledIncome += income
        unsettledCount += 1
      }
      const spuKey = resolveSku(o.sku)
      const spu = spuMap.get(spuKey) ?? { orders: 0, income: 0 }
      spu.orders += 1
      spu.income += incomeIfSettled
      spuMap.set(spuKey, spu)
    } else if (o.trade_stage !== "unpaid" && o.trade_stage !== "unknown") {
      // 退款类订单计入待处理但不算收入，单独统计结算状态
      if (o.is_settled) settledCount += 1
      else unsettledCount += 1
    }

    if (o.paid_at) {
      const key = bucketOf(o.paid_at)
      const point = trendMap.get(key)
      if (point) {
        if (o.trade_stage === "completed") {
          point.completed += 1
          point.income += income
        } else if (
          o.trade_stage === "refund_after_receive" ||
          o.trade_stage === "refund_before_ship"
        ) {
          point.refunded += 1
        } else if (o.trade_stage === "unpaid") {
          point.unpaid += 1
        }
      }
    }
  }

  const productBySku = new Map(products.map((p) => [p.sku, p]))
  const topSpus: SpuRankRow[] = [...spuMap.entries()]
    .map(([sku, agg]) => {
      const product = productBySku.get(sku)
      const unitCost = product?.cost_price ?? 0
      const hasCost = product?.cost_price !== undefined && product?.cost_price !== null
      const cost = unitCost * agg.orders
      return {
        sku,
        name: product?.name ?? "未匹配到商品",
        orders: agg.orders,
        income: agg.income,
        cost,
        profit: agg.income - cost,
        hasCost,
      }
    })
    .sort((a, b) => b.income - a.income)
    .slice(0, 12)

  const stages: StageSlice[] = STAGE_ORDER.filter(
    (stage) => (stageMap.get(stage)?.count ?? 0) > 0,
  ).map((stage) => ({
    stage,
    label: TRADE_STAGE_META[stage].label,
    count: stageMap.get(stage)?.count ?? 0,
    income: stageMap.get(stage)?.income ?? 0,
  }))

  const paidDates = orders
    .map((o) => o.paid_at)
    .filter((v): v is string => Boolean(v))
    .sort()
  const coverageDays =
    paidDates.length > 1
      ? Math.max(
          1,
          Math.round(
            (new Date(paidDates[paidDates.length - 1]).getTime() -
              new Date(paidDates[0]).getTime()) /
              86400_000,
          ),
        )
      : 0

  return {
    totalOrders: orders.length,
    completedOrders,
    completedRate: orders.length ? (completedOrders / orders.length) * 100 : 0,
    totalIncome,
    totalBid,
    avgIncome: completedOrders ? totalIncome / completedOrders : 0,
    unpaidCount: stageMap.get("unpaid")?.count ?? 0,
    refundBeforeShipCount: stageMap.get("refund_before_ship")?.count ?? 0,
    refundAfterReceiveCount: stageMap.get("refund_after_receive")?.count ?? 0,
    settledIncome,
    unsettledIncome,
    settledCount,
    unsettledCount,
    lockedOrders,
    consumedOrders,
    stages,
    trend: bucketKeys.map((date) => ({ date, ...(trendMap.get(date) ?? {
      completed: 0,
      refunded: 0,
      unpaid: 0,
      income: 0,
    }) })),
    topSpus,
    recent: [...orders]
      .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
      .slice(0, 8),
    coverageDays,
  }
}
