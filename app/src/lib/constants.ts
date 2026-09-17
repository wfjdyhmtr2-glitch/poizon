/** 删除商品 / 规格时需要的确认密码（防误触门禁，数据安全由 RLS 按账号隔离兜底） */
export const DELETE_PASSWORD = "1234567"

/** 云端模式下唯一有权限查看数据的账号（数据库 RLS 同步按此邮箱收紧） */
export const ALLOWED_EMAIL = "shuo@dewu.com"

import type { SalesSortKey, SortKey } from "./types"

export const CATEGORIES = [
  "T恤",
  "衬衫",
  "卫衣",
  "针织衫",
  "外套",
  "羽绒服",
  "西服",
  "连衣裙",
  "半身裙",
  "裤装",
  "牛仔",
  "套装",
  "鞋靴",
  "帽子",
  "围巾",
  "配饰",
]

export const SEASONS = ["春季", "夏季", "秋季", "冬季", "四季"]

export const GENDERS = ["女装", "男装", "中性", "童装"]

export const COLORS = [
  "黑色",
  "白色",
  "灰色",
  "米色",
  "卡其",
  "棕色",
  "红色",
  "粉色",
  "橙色",
  "黄色",
  "绿色",
  "蓝色",
  "紫色",
  "花色",
]

export const MATERIALS = [
  "纯棉",
  "亚麻",
  "真丝",
  "羊毛",
  "羊绒",
  "涤纶",
  "锦纶",
  "氨纶",
  "混纺",
  "牛仔布",
  "牛皮",
  "人造革",
  "羽绒",
  "灯芯绒",
]

export const SIZE_PRESETS: { label: string; values: string[] }[] = [
  { label: "常规码", values: ["XS", "S", "M", "L", "XL", "XXL", "3XL"] },
  { label: "女鞋码", values: ["34", "35", "36", "37", "38", "39", "40"] },
  { label: "男鞋码", values: ["39", "40", "41", "42", "43", "44", "45"] },
  { label: "均码", values: ["均码"] },
]

export const STATUS_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  on_sale: {
    label: "在售",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  off_shelf: {
    label: "已下架",
    className:
      "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  draft: {
    label: "草稿",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
}

export const STATUS_OPTIONS = [
  { value: "on_sale", label: "在售" },
  { value: "off_shelf", label: "已下架" },
  { value: "draft", label: "草稿" },
]

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated_desc", label: "最近更新" },
  { value: "created_desc", label: "最新录入" },
  { value: "price_desc", label: "价格从高到低" },
  { value: "price_asc", label: "价格从低到高" },
  { value: "stock_asc", label: "库存从少到多" },
  { value: "stock_desc", label: "库存从多到少" },
  { value: "name_asc", label: "名称 A→Z" },
]

export const PAGE_SIZES = [10, 20, 50, 100]

/** 导入模板列（中文表头 → 字段名），数组顺序即模板列顺序 */
export const IMPORT_COLUMNS: {
  header: string
  key: string
  required?: boolean
  hint?: string
}[] = [
  { header: "购入平台", key: "purchase_platform", hint: "淘宝 / 1688 / 拼多多 / 抖店 等" },
  { header: "商品名称", key: "name", required: true },
  { header: "SPUID", key: "sku", required: true, hint: "唯一，重复将视为更新" },
  { header: "分类", key: "category", hint: CATEGORIES.join("/") },
  { header: "品牌", key: "brand" },
  { header: "适用人群", key: "gender", hint: GENDERS.join("/") },
  { header: "季节", key: "seasons", hint: "多个用顿号或逗号分隔" },
  { header: "颜色", key: "colors", hint: "多个用顿号或逗号分隔" },
  { header: "尺码", key: "sizes", hint: "多个用顿号或逗号分隔" },
  { header: "售价", key: "price", required: true },
  { header: "到手价", key: "net_price", hint: "实际成交价，参与净利测算" },
  { header: "平台费用", key: "platform_fee", hint: "佣金、推广等支出" },
  { header: "成本价", key: "cost_price" },
  { header: "库存", key: "stock" },
  { header: "返利", key: "rebate", hint: "平台返现，计入收入" },
  { header: "备注", key: "remark", hint: "自由文本" },
  { header: "库存预警值", key: "stock_alert" },
  { header: "状态", key: "status", hint: "在售/已下架/草稿" },
  { header: "主图链接", key: "cover_url" },
  { header: "标签", key: "tags", hint: "多个用顿号或逗号分隔" },
  { header: "商品描述", key: "description" },
]

/** 常用购入平台，表单里做快捷选择 */
export const PURCHASE_PLATFORMS = [
  "淘宝",
  "1688",
  "拼多多",
  "抖店",
  "京东",
  "小红书",
  "快手",
  "唯品会",
  "线下档口",
]

/* ============================ 销售订单 ============================ */

/** 销售订单导入模板列，数组顺序即模板列顺序 */
export const SALES_IMPORT_COLUMNS: {
  header: string
  key: string
  required?: boolean
  hint?: string
}[] = [
  { header: "订单号", key: "order_no", required: true, hint: "全店唯一，重复视为更新" },
  { header: "spuID", key: "sku", required: true, hint: "对应商品管理里的 SPUID" },
  { header: "规格", key: "spec", hint: "如：黑色 / M" },
  {
    header: "订单状态",
    key: "order_status",
    required: true,
    hint: "交易成功 / 交易失败 / 交易关闭成功",
  },
  { header: "是否退货", key: "is_returned", hint: "是 / 否" },
  { header: "是否结算", key: "is_settled", hint: "是 / 否" },
  { header: "出价金额（元）", key: "bid_amount" },
  { header: "预计收入金额（元）", key: "expected_income" },
  { header: "售后服务", key: "after_sales", hint: "如：无 / 退货退款 / 换货" },
  { header: "买家支付时间", key: "paid_at", hint: "2026-09-01 12:30，也支持 Excel 日期" },
]

/** 平台侧原始订单状态 */
export const ORDER_STATUSES = ["交易成功", "交易关闭成功", "交易失败"] as const

/**
 * 订单状态 + 是否退货 → 交易阶段。
 * 规则来自实际交易逻辑：
 *  - 交易失败          → 买家未付款
 *  - 交易关闭成功      → 买家在平台发货前退款
 *  - 交易成功 + 退货   → 买家收到货后退款
 *  - 交易成功 + 未退货 → 正常成交
 */
export const TRADE_STAGE_META: Record<
  string,
  {
    label: string
    detail: string
    tone: "success" | "warning" | "danger" | "neutral"
    className: string
    dot: string
    /** 是否计入实际收入 */
    countsAsIncome: boolean
    /** 是否属于「没做成」的订单 */
    isLost: boolean
  }
> = {
  completed: {
    label: "正常成交",
    detail: "交易成功且未退货",
    tone: "success",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    countsAsIncome: true,
    isLost: false,
  },
  refund_after_receive: {
    label: "签收后退款",
    detail: "交易成功但买家已退货",
    tone: "danger",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
    countsAsIncome: false,
    isLost: true,
  },
  refund_before_ship: {
    label: "发货前退款",
    detail: "交易关闭成功，尚未发货",
    tone: "warning",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    countsAsIncome: false,
    isLost: true,
  },
  unpaid: {
    label: "买家未付款",
    detail: "交易失败，订单未成立",
    tone: "neutral",
    className: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400",
    countsAsIncome: false,
    isLost: true,
  },
  unknown: {
    label: "状态待确认",
    detail: "订单状态无法识别",
    tone: "neutral",
    className: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    countsAsIncome: false,
    isLost: true,
  },
}

/** 订单对库存的影响：锁定 / 核销 / 不占用 */
export const STOCK_EFFECT_META: Record<
  string,
  { label: string; detail: string; className: string; dot: string }
> = {
  locked: {
    label: "锁定库存",
    detail: "订单生效但还没结算，先占用 1 个可用库存",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  consumed: {
    label: "已扣减",
    detail: "订单已结算，锁定释放并永久占用 1 个库存",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  released: {
    label: "不占用",
    detail: "订单没做成（未付款 / 退款），库存已退回可用",
    className: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
}

export const SALES_STAGE_OPTIONS = [  { value: "all", label: "全部阶段" },
  { value: "completed", label: "正常成交" },
  { value: "refund_before_ship", label: "发货前退款" },
  { value: "refund_after_receive", label: "签收后退款" },
  { value: "unpaid", label: "买家未付款" },
  { value: "unknown", label: "状态待确认" },
]

export const SALES_SORT_OPTIONS: { value: SalesSortKey; label: string }[] = [
  { value: "paid_desc", label: "支付时间倒序" },
  { value: "paid_asc", label: "支付时间正序" },
  { value: "income_desc", label: "收入从高到低" },
  { value: "income_asc", label: "收入从低到高" },
  { value: "bid_desc", label: "出价从高到低" },
  { value: "updated_desc", label: "最近更新" },
]
