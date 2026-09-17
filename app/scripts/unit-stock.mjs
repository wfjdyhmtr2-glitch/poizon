/**
 * 演示模式库存联动 + SPU 对照单元测试
 * 用 localStorage 桩在 Node 里直接跑 demoBackend，不需要浏览器。
 * 先用 esbuild 把 TS 打包成临时 JS 再运行（tsx 未安装）。
 * 用法：node scripts/unit-stock.mjs
 */
import assert from "node:assert"
import { build } from "esbuild"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// 1) 打包 src/lib/demoBackend.ts 为可运行的 ESM
const dir = mkdtempSync(join(tmpdir(), "unit-stock-"))
const outFile = join(dir, "demo-backend.mjs")
await build({
  entryPoints: ["src/lib/demoBackend.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: outFile,
  external: [],
  logLevel: "silent",
})

// 2) localStorage 桩
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.window = globalThis

const { createDemoBackend } = await import(pathToFileURL(outFile).href)
const backend = createDemoBackend()
// 关闭演示入仓单种子，保持空库便于精确断言
localStorage.setItem("yunguan.demo.purchase-seeded.v1", "1")

const product = await backend.createProduct({
  name: "测试卫衣", sku: "SPU-9001", category: "卫衣", brand: null, gender: null,
  seasons: [], colors: ["白色", "黑色"], sizes: ["M", "L"], material: null,
  price: 199, net_price: null, platform_fee: null, shipping_fee: null, cost_price: 80, stock: 10,
  stock_alert: 2, rebate: null, remark: null, status: "on_sale", is_new: false,
  purchase_platform: "1688", cover_url: null, images: [], description: null, tags: [],
})

let p = await backend.getProduct(product.id)
assert.equal(p.stock, 10)
assert.equal(p.locked_stock, 0)
console.log("✓ 初始：可用 10 / 锁定 0")

// 1) 平台 spuID 与本店 SPUID 不一致 → 先建对照，再用外部 ID 下单
await backend.saveSpuMapping({ external_id: "DW-SPU-777", sku: "SPU-9001", note: null })
await backend.createSalesOrder({
  order_no: "DW-001", sku: "DW-SPU-777", spec: "白色 / M", order_status: "交易成功",
  is_returned: false, is_settled: false, bid_amount: 199, expected_income: 189,
  after_sales: null, paid_at: new Date().toISOString(),
})
p = await backend.getProduct(product.id)
assert.equal(p.stock, 9, "通过对照映射的订单应锁库存")
assert.equal(p.locked_stock, 1)
console.log("✓ 对照生效：外部 spuID 下单后 可用 9 / 锁定 1")

// 2) 结算 → 锁定释放、库存不回退
const orders = await backend.listSalesOrders({ keyword: "DW-001", stage: "all", settled: "all", sort: "paid_desc", page: 1, pageSize: 10 })
await backend.bulkSetSettled([orders.rows[0].id], true)
p = await backend.getProduct(product.id)
assert.equal(p.stock, 9)
assert.equal(p.locked_stock, 0)
console.log("✓ 结算核销：可用 9 / 锁定 0（不回退）")

// 3) 删除对照 → 该订单的库存影响应被撤销
const mappings = await backend.listSpuMappings()
await backend.deleteSpuMappings([mappings[0].id])
p = await backend.getProduct(product.id)
assert.equal(p.stock, 10, "删除对照后库存应退回")
assert.equal(p.locked_stock, 0)
console.log("✓ 删除对照：库存退回 10 / 锁定 0")

// 4) 重建对照 → 影响恢复（注意：DW-001 已结算，所以恢复的是「核销」而非「锁定」）
await backend.saveSpuMapping({ external_id: "DW-SPU-777", sku: "SPU-9001", note: null })
p = await backend.getProduct(product.id)
assert.equal(p.stock, 9)
assert.equal(p.locked_stock, 0)
console.log("✓ 重建对照：已结算订单恢复为核销 可用 9 / 锁定 0")

// 4b) 再来一笔未结算订单 → 应正常锁定
await backend.createSalesOrder({
  order_no: "DW-002", sku: "DW-SPU-777", spec: "黑色 / L", order_status: "交易成功",
  is_returned: false, is_settled: false, bid_amount: 199, expected_income: 189,
  after_sales: null, paid_at: new Date().toISOString(),
})
p = await backend.getProduct(product.id)
assert.equal(p.stock, 8)
assert.equal(p.locked_stock, 1)
console.log("✓ 未结算订单：可用 8 / 锁定 1")

// 5) listSalesOrdersBySku 应包含映射过来的订单（演示种子数据也会给该 SPU 生成订单）
const bySku = await backend.listSalesOrdersBySku("SPU-9001")
const nos = bySku.map((o) => o.order_no)
assert.ok(nos.includes("DW-001") && nos.includes("DW-002"), `应包含 DW-001/DW-002，实际 ${nos.join(",")}`)
console.log(`✓ 规格明细数据源：listSalesOrdersBySku 命中 ${bySku.length} 条（含 2 条映射订单）`)

// 6) 图片库：挂图 → 按 SPUID 匹配 → 删除
const img = await backend.addProductImage({ sku: "SPU-9001", color: "白色", url: "data:image/svg+xml,test" })
let imgs = await backend.listProductImages({ sku: "SPU-9001" })
assert.ok(imgs.some((i) => i.id === img.id), "挂图后应能按 SPUID 匹配到")
const whiteImgs = await backend.listProductImages({ sku: "SPU-9001", color: "白色" })
assert.ok(whiteImgs.some((i) => i.id === img.id), "按颜色匹配应命中")
const blackImgs = await backend.listProductImages({ sku: "SPU-9001", color: "黑色" })
assert.ok(!blackImgs.some((i) => i.id === img.id), "其他颜色不应命中")
await backend.deleteProductImages([img.id])
imgs = await backend.listProductImages({ sku: "SPU-9001" })
assert.ok(!imgs.some((i) => i.id === img.id), "删除后不应再匹配到")
console.log("✓ 图片库：挂图 / 按 SPUID+颜色匹配 / 删除 全部通过")

// 7) 入仓单：确认入仓加库存 + 加权平均成本；删除回退库存
const po = await backend.createPurchaseOrder({
  order_no: "WH-TEST-1", platform: "京东", purchased_at: "2026-09-17", shipping_fee: 12,
  remark: null,
  items: [
    { sku: "SPU-9001", color: "白色", size: "M", quantity: 10, unit_cost: 50 },
    { sku: "SPU-9001", color: "黑色", size: "L", quantity: 5, unit_cost: 60 },
  ],
})
p = await backend.getProduct(product.id)
assert.equal(p.stock, 23, "入仓后库存 = 8 + 15")
assert.equal(p.cost_price, 62.61, "加权平均成本 = (8×80 + 10×50 + 5×60) / 23")
const pos = await backend.listPurchaseOrders()
assert.equal(pos.length, 1)
assert.equal(pos[0].items.length, 2)
await backend.deletePurchaseOrders([po.id])
p = await backend.getProduct(product.id)
assert.equal(p.stock, 8, "删除入仓单后库存回退")
assert.equal((await backend.listPurchaseOrders()).length, 0)
console.log("✓ 入仓单：确认入仓 / 加权成本 / 删除回退 全部通过")

// 8) 商品信息登记 + 新款由入仓单自动建档（名称/售价来自登记，进货单价 = 总价/数量）
await backend.upsertSpuInfo({ sku: "SPU-NEW-1", name: "新款羽绒服", image_url: "", price: null })
const infos = await backend.listSpuInfo()
assert.ok(infos.some((r) => r.sku === "SPU-NEW-1" && r.name === "新款羽绒服"), "商品信息登记可查询")
// 再次保存 = 更新（upsert）
await backend.upsertSpuInfo({ sku: "SPU-NEW-1", name: "新款羽绒服Pro", image_url: "", price: null })
assert.equal((await backend.listSpuInfo()).find((r) => r.sku === "SPU-NEW-1").name, "新款羽绒服Pro", "重复保存应更新")

await backend.createPurchaseOrder({
  order_no: "WH-TEST-2", platform: "拼多多", purchased_at: "2026-09-17", shipping_fee: null,
  remark: null,
  items: [
    { sku: "SPU-NEW-1", name: "", price: 1800, color: "黑色", size: "L", quantity: 6, unit_cost: 300 },
    { sku: "SPU-NEW-1", name: "", price: 1240, color: "白色", size: "", quantity: 4, unit_cost: 310 },
  ],
})
const all = await backend.fetchForDashboard()
const created = all.find((x) => x.sku === "SPU-NEW-1")
assert.ok(created, "新款应自动建档")
assert.equal(created.stock, 10, "两行明细同款合并：6 + 4")
assert.equal(created.name, "新款羽绒服Pro", "名称来自商品信息登记")
assert.equal(created.price, 304, "售价 = Σ进货总价(3040) ÷ Σ进货数量(10)")
assert.equal(created.cost_price, 304, "加权成本 = (6×300 + 4×310) / 10")
assert.deepEqual(created.colors, ["黑色", "白色"], "颜色自动汇总")
assert.equal(created.purchase_platform, "拼多多", "平台来自入仓单")
console.log("✓ 商品信息登记 + 新款自动建档（名称来自登记，售价 = 进货均价，成本来自总价÷数量）")

// 9) 删除规格：清明细 + 回退库存（先补一张带黑色/L 的入仓单）
await backend.createPurchaseOrder({
  order_no: "WH-TEST-3", platform: "淘宝", purchased_at: "2026-09-17", shipping_fee: null,
  remark: null,
  items: [{ sku: "SPU-9001", name: "", price: null, color: "黑色", size: "L", quantity: 7, unit_cost: 55 }],
})
p = await backend.getProduct(product.id)
const stockBefore = p.stock
const res = await backend.deletePurchaseOrderSpec("SPU-9001", "黑色", "L")
assert.ok(res.removedQty >= 1, "应删掉黑色/L 的采购明细")
p = await backend.getProduct(product.id)
assert.equal(p.stock, stockBefore - res.removedQty, "库存应按删掉的明细回退")
console.log(`✓ 删除规格：回退库存 ${res.removedQty} 件，明细已清`)

console.log("\n全部 10 组断言通过 ✅")
