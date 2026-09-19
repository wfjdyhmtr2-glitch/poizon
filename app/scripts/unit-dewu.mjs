/**
 * 得物后台导出文件适配 + 订单状态归一 单元测试
 *
 * 覆盖三件事：
 *   1. 能认出得物原生导出文件（而不是系统模板），并按得物列名映射出订单草稿；
 *   2. 得物的中间状态（待卖家发货 / 待平台收货 …）原样保存，但交易阶段与库存占用
 *      必须按「交易成功」算；
 *   3. 把数据库那套正则（trade_stage 生成列 + order_stock_effect）在 JS 里重放一遍，
 *      逐条比对前端口径——这四处（前端 sales.ts / 生成列 / order_stock_effect / 本测试）
 *      必须完全一致，改一处就要跑这个测试。
 *
 * 用法：node scripts/unit-dewu.mjs
 */
import assert from "node:assert"
import { build } from "esbuild"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const dir = mkdtempSync(join(tmpdir(), "unit-dewu-"))
const outFile = join(dir, "dewu.mjs")

// 一次打包出 dewu + sales + schemaSql 的状态正则，避免多次构建
await build({
  stdin: {
    contents:
      `export * from "./src/lib/dewu.ts"\n` +
      `export * from "./src/lib/sales.ts"\n` +
      `export { ORDER_ACTIVE_REGEX_SQL, ORDER_CLOSED_REGEX_SQL, ORDER_FAILED_REGEX_SQL }` +
      ` from "./src/lib/schemaSql.ts"\n`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: outFile,
  logLevel: "silent",
})

const {
  buildDewuOrderRow,
  isDewuOrderFile,
  normalizeOrderStatus,
  computeTradeStage,
  orderStockEffect,
  ORDER_ACTIVE_REGEX_SQL,
  ORDER_CLOSED_REGEX_SQL,
  ORDER_FAILED_REGEX_SQL,
} = await import(pathToFileURL(outFile).href)

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/* ---------- 1. 文件识别 ---------- */

// 得物订单导出的真实表头（截自实际导出文件，63 列里取特征列）
const DEWU_HEADERS = [
  "订单号", "订单类型", "spuID", "skuID", "商品名称", "货号", "SKU货号", "品牌",
  "规格", "数量", "出价金额（元）", "卖家承担优惠金额（元）", "消费者邮费补贴金额（元）",
  "预计收入金额（元）", "剩余发货时效", "关闭原因", "配送方", "物流公司（卖家>平台or买家）",
  "物流单号（卖家>平台or买家）", "预约单号", "订单状态", "订单来源", "得物收货地址",
  "收件人姓名", "收件人手机号", "买家下单时间", "买家支付时间", "订单关闭时间",
]

// 系统自己的导入模板表头
const TEMPLATE_HEADERS = [
  "订单号", "spuID", "规格", "订单状态", "是否退货", "是否结算",
  "出价金额（元）", "预计收入金额（元）", "售后服务", "买家支付时间",
]

check("得物导出文件能被识别", () => {
  assert.equal(isDewuOrderFile(DEWU_HEADERS), true)
})

check("系统模板不会被误判成得物文件", () => {
  assert.equal(isDewuOrderFile(TEMPLATE_HEADERS), false)
})

check("缺少订单号 / 订单状态的表不会被误判", () => {
  assert.equal(isDewuOrderFile(["姓名", "手机号", "金额"]), false)
})

/* ---------- 2. 行映射 ---------- */

// 一行真实数据（截自实际导出文件）
const DEWU_ROW = {
  订单号: "110212628181831218",
  订单类型: "品牌直发",
  spuID: "27967941",
  skuID: "947254056",
  商品名称: "Cabbeen卡宾 美式老钱风 设计师品牌复古满印棋盘格提花针织茄克外套",
  货号: "3253138014",
  品牌: "卡宾 CABBEEN",
  规格: "提花/宽松—米白色12 50/175/L",
  数量: "1",
  "出价金额（元）": "399",
  "预计收入金额（元）": "297.88",
  关闭原因: "",
  订单状态: "待卖家发货",
  买家下单时间: "2026-09-19 09:55:25",
  买家支付时间: "2026-09-19 09:55:33",
}

check("得物一行映射成订单草稿，字段对得上", () => {
  const row = buildDewuOrderRow(DEWU_ROW, 2)
  assert.deepEqual(row.errors, [])
  const o = row.order
  assert.ok(o)
  assert.equal(o.order_no, "110212628181831218")
  assert.equal(o.sku, "27967941") // 平台 spuID，库存联动靠对照表解析
  assert.equal(o.spec, "提花/宽松—米白色12 50/175/L")
  assert.equal(o.bid_amount, 399)
  assert.equal(o.expected_income, 297.88)
  assert.ok(o.paid_at && o.paid_at.startsWith("2026-09-19"))
  // 状态原样保留（用户要求：页面上看到的和得物后台一致）
  assert.equal(o.order_status, "待卖家发货")
  assert.equal(o.is_returned, false)
  assert.equal(o.is_settled, false)
})

check("缺订单号 / spuID / 状态的行会被拦下", () => {
  const row = buildDewuOrderRow({ 商品名称: "只有名字" }, 3)
  assert.equal(row.order, null)
  assert.equal(row.errors.length, 3)
})

check("数量大于 1 会给出提示", () => {
  const row = buildDewuOrderRow({ ...DEWU_ROW, 数量: "3" }, 4)
  assert.ok(row.warnings.some((w) => w.includes("数量是 3")))
})

check("部分字段缺失也能导入（金额留空）", () => {
  const row = buildDewuOrderRow(
    { 订单号: "X1", spuID: "999", 订单状态: "交易成功", "出价金额（元）": "", "预计收入金额（元）": "" },
    5,
  )
  assert.deepEqual(row.errors, [])
  assert.equal(row.order?.bid_amount, null)
  assert.equal(row.order?.expected_income, null)
})

/* ---------- 3. 状态归一与库存口径 ---------- */

check("得物中间态归一到交易成功", () => {
  for (const status of [
    "待卖家发货",
    "待平台发货",
    "已发货",
    "待平台收货",
    "平台已收货",
    "待买家收货",
    "已签收",
    "鉴别中",
  ]) {
    assert.equal(normalizeOrderStatus(status), "交易成功", `${status} 应归一到交易成功`)
  }
})

check("三种标准状态仍然各归各位", () => {
  assert.equal(normalizeOrderStatus("交易成功"), "交易成功")
  assert.equal(normalizeOrderStatus("交易失败"), "交易失败")
  assert.equal(normalizeOrderStatus("交易关闭成功"), "交易关闭成功")
})

check("中间态订单要占库存（锁定 1 个）", () => {
  assert.equal(computeTradeStage("待卖家发货", false), "completed")
  assert.equal(orderStockEffect("待卖家发货", false, false), "locked")
  assert.equal(orderStockEffect("待卖家发货", false, true), "consumed")
  assert.equal(orderStockEffect("交易失败", false, false), "released")
  assert.equal(orderStockEffect("交易关闭成功", false, false), "released")
  assert.equal(orderStockEffect("待卖家发货", true, false), "released")
})

/* ---------- 4. 前端口径 vs 数据库口径（必须完全等价） ---------- */

/**
 * 数据库那边是用 `order_status ~ '正则'` 判断的（生成列 trade_stage + 函数 order_stock_effect），
 * 前端是 normalizeOrderStatus / computeTradeStage。界面显示和统计读的是数据库生成列，
 * 前端只在老库缺列时兜底——两边只要有一处不一致，页面和统计就会对不上。
 * 这里用同一套正则串在 JS 里重放数据库的判定，逐条比对。
 */
const reFailed = new RegExp(ORDER_FAILED_REGEX_SQL)
const reClosed = new RegExp(ORDER_CLOSED_REGEX_SQL)
const reActive = new RegExp(ORDER_ACTIVE_REGEX_SQL)

/** 重放数据库生成列 trade_stage 的 case 分支 */
function sqlTradeStage(status, isReturned) {
  const s = status ?? ""
  if (reFailed.test(s)) return "unpaid"
  if (reClosed.test(s)) return "refund_before_ship"
  if (reActive.test(s) && isReturned) return "refund_after_receive"
  if (reActive.test(s)) return "completed"
  return "unknown"
}

/** 重放数据库函数 order_stock_effect */
function sqlStockEffect(status, isReturned, isSettled) {
  const active = reActive.test(status ?? "")
  if (active && !isReturned && isSettled) return "consumed"
  if (active && !isReturned) return "locked"
  return "released"
}

// 语料直接从三段正则里拆出来，保证每个分支都被覆盖；再补上真实见过的写法
const CORPUS = [
  ...new Set([
    ...ORDER_ACTIVE_REGEX_SQL.split("|"),
    ...ORDER_CLOSED_REGEX_SQL.split("|"),
    ...ORDER_FAILED_REGEX_SQL.split("|"),
    "待卖家发货", // 真实得物导出里 25 单都是这个状态
    "待平台收货",
    "鉴别不通过",
    "发货失败",
    "买家已取消",
    "关单",
    "未知状态",
    "买家申请退款",
    "已退款",
  ]),
]

check(`交易阶段：${CORPUS.length} 种状态 × 退货与否，数据库与前端判定一致`, () => {
  const mismatched = []
  for (const status of CORPUS) {
    for (const returned of [false, true]) {
      const db = sqlTradeStage(status, returned)
      const fe = computeTradeStage(status, returned)
      if (db !== fe) mismatched.push({ 状态: status, 已退货: returned, 数据库: db, 前端: fe })
    }
  }
  assert.deepEqual(mismatched, [], `口径不一致：\n${JSON.stringify(mismatched, null, 2)}`)
})

check(`库存联动：${CORPUS.length} 种状态 × 退货与否 × 结算与否，数据库与前端判定一致`, () => {
  const mismatched = []
  for (const status of CORPUS) {
    for (const returned of [false, true]) {
      for (const settled of [false, true]) {
        const db = sqlStockEffect(status, returned, settled)
        const fe = orderStockEffect(status, returned, settled)
        if (db !== fe) {
          mismatched.push({ 状态: status, 已退货: returned, 已结算: settled, 数据库: db, 前端: fe })
        }
      }
    }
  }
  assert.deepEqual(mismatched, [], `口径不一致：\n${JSON.stringify(mismatched, null, 2)}`)
})

check("正则表里没有漏写的空分支", () => {
  for (const [name, sql] of [
    ["生效中", ORDER_ACTIVE_REGEX_SQL],
    ["已关闭", ORDER_CLOSED_REGEX_SQL],
    ["失败", ORDER_FAILED_REGEX_SQL],
  ]) {
    assert.ok(sql.trim().length > 0, `${name} 正则为空`)
    assert.ok(!sql.split("|").some((x) => x.trim() === ""), `${name} 正则里有空分支`)
  }
})

console.log(`\n得物订单导入：${passed} 项断言全部通过`)
