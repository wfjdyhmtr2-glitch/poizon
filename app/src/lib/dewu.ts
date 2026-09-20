/**
 * 得物后台「订单导出」文件适配。
 *
 * 得物商家后台（stark.dewu.com）/ 个卖中心导出的订单表有 60+ 列，
 * 列名和系统订单表的字段基本一一对应（订单号 / spuID / 出价金额 / 预计收入金额 /
 * 买家支付时间都是同一套口径），所以这里不需要套系统模板，直接识别原生文件即可。
 *
 * 三个要留意的差异：
 *   1. 得物没有「是否退货 / 是否结算」两列 → 导入时按未退货、未结算处理，页面给出提示；
 *   2. 得物的订单状态是平台原始文案（如「待卖家发货」），**原样保存**，
 *      由 sales.ts 的 normalizeOrderStatus 统一归一到交易阶段（数据库侧同一套正则）；
 *   3. spuID 是得物平台的 SPU ID，库存联动靠「商品 SPUID 直接匹配 → SPU 对照表」解析。
 */
import { parseDateTime, parseMoney } from "./sales"
import type { SalesImportRow, SalesOrderDraft } from "./types"

/** 只有得物原生导出才会带的列（命中越多越确定） */
const DEWU_ONLY_HEADERS = [
  "skuID",
  "货号",
  "品牌",
  "订单类型",
  "出价金额（元）",
  "预计收入金额（元）",
  "买家支付时间",
  "开放预约时间",
]

/** 系统自己的导入模板一定会带这两列；带了就说明不是得物原生文件 */
const TEMPLATE_ONLY_HEADERS = ["是否退货", "是否结算"]

/** 得物文件里订单号列的实际表头（历史版本有过细微差别，这里都认） */
const ORDER_NO_HEADERS = ["订单号", "得物订单号", "平台订单号"]

/**
 * 判断一份表格是不是得物「订单导出」文件。
 * 只看特征列，不看列顺序，也不要求列数完全一致——得物改版加列也不会误判。
 */
export function isDewuOrderFile(headers: string[]): boolean {
  const set = new Set(headers.map((h) => String(h ?? "").trim()).filter(Boolean))
  if (!ORDER_NO_HEADERS.some((h) => set.has(h))) return false
  if (!set.has("订单状态") || !set.has("spuID")) return false
  if (TEMPLATE_ONLY_HEADERS.some((h) => set.has(h))) return false
  return DEWU_ONLY_HEADERS.filter((h) => set.has(h)).length >= 3
}

/** 从一行里取订单号（兼容几种表头写法） */
function pickOrderNo(text: (header: string) => string): string {
  for (const header of ORDER_NO_HEADERS) {
    const v = text(header)
    if (v) return v
  }
  return ""
}

/** 把得物的一行导出记录映射成系统订单草稿 */
export function buildDewuOrderRow(raw: Record<string, unknown>, rowNo: number): SalesImportRow {
  const errors: string[] = []
  const warnings: string[] = []
  const text = (header: string) => String(raw[header] ?? "").trim()

  const orderNo = pickOrderNo(text)
  const sku = text("spuID")
  const statusRaw = text("订单状态")

  if (!orderNo) errors.push("缺少订单号")
  if (!sku) errors.push("缺少 spuID")
  if (!statusRaw) errors.push("缺少订单状态")

  // 数量：系统按「一单一行」记录，一行多件只会占用 1 个库存
  const qtyRaw = text("数量")
  if (qtyRaw) {
    const qty = Number(qtyRaw)
    if (Number.isFinite(qty) && qty > 1) {
      warnings.push(`这一行数量是 ${qty}，系统按一单一件记录，库存只会占用 1 个`)
    }
  }

  const bidRaw = text("出价金额（元）")
  const bid = parseMoney(bidRaw)
  if (bidRaw && bid === null) warnings.push("出价金额无法识别，已留空")

  const incomeRaw = text("预计收入金额（元）")
  const income = parseMoney(incomeRaw)
  if (incomeRaw && income === null) warnings.push("预计收入金额无法识别，已留空")

  const paidRaw = text("买家支付时间")
  const paidAt = parseDateTime(paidRaw)
  if (paidRaw && !paidAt) warnings.push("买家支付时间无法识别，已留空")

  if (bid !== null && income !== null && income > bid) {
    warnings.push("预计收入高于出价金额，请确认得物是否调整了费用口径")
  }

  if (errors.length) {
    return { rowNo, raw: stringifyDewuRaw(raw), order: null, errors, warnings }
  }

  const draft: SalesOrderDraft = {
    order_no: orderNo,
    sku,
    spec: text("规格") || null,
    // 得物原始状态原样保留，页面看到的和后台一致
    order_status: statusRaw,
    is_returned: false,
    is_settled: false,
    bid_amount: bid,
    expected_income: income,
    after_sales: text("关闭原因") || null,
    // 标签：优先用系统模板里的「标签」列；得物原生导出没有这列，
    // 退而用「订单类型」（品牌直发 / 入仓 …）当标记——只展示，不参与盈亏
    tag: text("标签") || text("订单类型") || null,
    paid_at: paidAt,
  }

  return { rowNo, raw: stringifyDewuRaw(raw), order: draft, errors, warnings }
}

/** 得物文件的列很多，原样留一份字符串快照供预览与排查 */
function stringifyDewuRaw(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) out[k] = String(v ?? "")
  return out
}

/**
 * 得物导出文件的两点先天缺失，导入前统一提醒用户一次：
 *  - 没有「是否结算」→ 一律按未结算导入，结算后在订单列表批量勾选
 *  - 没有「是否退货」→ 一律按未退货导入，签收后退款的单子需要手工勾选「已退货」
 */
export const DEWU_FILE_NOTES: string[] = [
  "得物导出不含「是否结算」列，导入后请在订单列表里批量标记结算（系统按未结算处理）。",
  "得物导出不含「是否退货」列，签收后退款的订单需要手工勾选「已退货」才算作亏损。",
  "订单状态按得物原文保存（如「待卖家发货」），交易阶段与库存占用会自动识别，不用担心统计漏算。",
]
