import type { Product, SalesOrder } from "./types"
import { placeholderImage } from "./format"
import { computeTradeStage } from "./sales"

type Seed = {
  name: string
  sku: string
  category: string
  brand: string
  gender: string
  seasons: string[]
  colors: string[]
  sizes: string[]
  material: string
  price: number
  cost: number
  stock: number
  alert: number
  status: Product["status"]
  isNew: boolean
  tags: string[]
}

const SEEDS: Seed[] = [
  { name: "精梳棉基础款圆领T恤", sku: "TS-1001", category: "T恤", brand: "云织", gender: "中性", seasons: ["春季", "夏季"], colors: ["白色", "黑色", "灰色"], sizes: ["S", "M", "L", "XL", "XXL"], material: "纯棉", price: 129, cost: 52, stock: 486, alert: 60, status: "on_sale", isNew: false, tags: ["基础款", "热销"] },
  { name: "重磅落肩宽松短袖", sku: "TS-1002", category: "T恤", brand: "云织", gender: "男装", seasons: ["夏季"], colors: ["黑色", "卡其", "蓝色"], sizes: ["M", "L", "XL", "XXL"], material: "纯棉", price: 169, cost: 71, stock: 218, alert: 40, status: "on_sale", isNew: true, tags: ["Oversize"] },
  { name: "法式泡泡袖雪纺衬衫", sku: "SH-2001", category: "衬衫", brand: "蔓辞", gender: "女装", seasons: ["春季", "秋季"], colors: ["白色", "米色", "粉色"], sizes: ["S", "M", "L"], material: "涤纶", price: 259, cost: 108, stock: 132, alert: 30, status: "on_sale", isNew: true, tags: ["法式", "通勤"] },
  { name: "免烫商务长袖衬衫", sku: "SH-2002", category: "衬衫", brand: "恒领", gender: "男装", seasons: ["四季"], colors: ["白色", "蓝色", "灰色"], sizes: ["M", "L", "XL", "XXL"], material: "混纺", price: 219, cost: 92, stock: 74, alert: 80, status: "on_sale", isNew: false, tags: ["免烫", "商务"] },
  { name: "美式复古连帽卫衣", sku: "HD-3001", category: "卫衣", brand: "野行", gender: "中性", seasons: ["秋季", "冬季"], colors: ["灰色", "绿色", "黑色"], sizes: ["M", "L", "XL"], material: "混纺", price: 299, cost: 126, stock: 305, alert: 50, status: "on_sale", isNew: false, tags: ["复古"] },
  { name: "小香风粗花呢针织外套", sku: "KN-3101", category: "针织衫", brand: "蔓辞", gender: "女装", seasons: ["春季", "秋季"], colors: ["米色", "粉色"], sizes: ["S", "M", "L"], material: "羊毛", price: 459, cost: 208, stock: 46, alert: 25, status: "on_sale", isNew: true, tags: ["小香风"] },
  { name: "半高领修身打底毛衣", sku: "KN-3102", category: "针织衫", brand: "暖格", gender: "女装", seasons: ["秋季", "冬季"], colors: ["黑色", "米色", "红色"], sizes: ["S", "M", "L", "XL"], material: "羊绒", price: 329, cost: 148, stock: 0, alert: 30, status: "off_shelf", isNew: false, tags: ["打底"] },
  { name: "oversize 廓形西装外套", sku: "JK-4001", category: "西服", brand: "恒领", gender: "女装", seasons: ["春季", "秋季"], colors: ["卡其", "灰色", "黑色"], sizes: ["S", "M", "L", "XL"], material: "混纺", price: 599, cost: 268, stock: 88, alert: 20, status: "on_sale", isNew: false, tags: ["通勤", "廓形"] },
  { name: "轻薄防晒夹克", sku: "JK-4002", category: "外套", brand: "野行", gender: "中性", seasons: ["夏季"], colors: ["蓝色", "白色", "紫色"], sizes: ["M", "L", "XL"], material: "锦纶", price: 239, cost: 96, stock: 420, alert: 60, status: "on_sale", isNew: false, tags: ["防晒", "UPF50+"] },
  { name: "90白鸭绒短款羽绒服", sku: "DN-5001", category: "羽绒服", brand: "暖格", gender: "女装", seasons: ["冬季"], colors: ["黑色", "米色", "红色"], sizes: ["S", "M", "L", "XL"], material: "羽绒", price: 899, cost: 412, stock: 156, alert: 30, status: "on_sale", isNew: false, tags: ["90绒", "短款"] },
  { name: "中长款连帽羽绒大衣", sku: "DN-5002", category: "羽绒服", brand: "暖格", gender: "男装", seasons: ["冬季"], colors: ["黑色", "灰色", "蓝色"], sizes: ["L", "XL", "XXL", "3XL"], material: "羽绒", price: 1099, cost: 520, stock: 62, alert: 25, status: "draft", isNew: true, tags: ["加厚"] },
  { name: "碎花吊带度假长裙", sku: "DR-6001", category: "连衣裙", brand: "蔓辞", gender: "女装", seasons: ["夏季"], colors: ["花色", "蓝色"], sizes: ["S", "M", "L"], material: "真丝", price: 689, cost: 305, stock: 34, alert: 20, status: "on_sale", isNew: true, tags: ["度假", "真丝"] },
  { name: "通勤收腰衬衫裙", sku: "DR-6002", category: "连衣裙", brand: "蔓辞", gender: "女装", seasons: ["春季", "秋季"], colors: ["白色", "卡其"], sizes: ["S", "M", "L", "XL"], material: "混纺", price: 399, cost: 172, stock: 118, alert: 30, status: "on_sale", isNew: false, tags: ["通勤"] },
  { name: "高腰A字百褶半身裙", sku: "SK-6101", category: "半身裙", brand: "蔓辞", gender: "女装", seasons: ["春季", "秋季"], colors: ["黑色", "灰色", "棕色"], sizes: ["S", "M", "L"], material: "混纺", price: 249, cost: 104, stock: 176, alert: 30, status: "on_sale", isNew: false, tags: ["百褶"] },
  { name: "垂感阔腿西裤", sku: "PT-7001", category: "裤装", brand: "恒领", gender: "女装", seasons: ["四季"], colors: ["黑色", "米色", "灰色"], sizes: ["S", "M", "L", "XL"], material: "混纺", price: 289, cost: 122, stock: 268, alert: 40, status: "on_sale", isNew: false, tags: ["垂感", "通勤"] },
  { name: "工装多口袋直筒长裤", sku: "PT-7002", category: "裤装", brand: "野行", gender: "男装", seasons: ["春季", "秋季"], colors: ["卡其", "黑色", "绿色"], sizes: ["M", "L", "XL", "XXL"], material: "纯棉", price: 329, cost: 138, stock: 92, alert: 35, status: "on_sale", isNew: false, tags: ["工装"] },
  { name: "复古水洗直筒牛仔裤", sku: "DN-7101", category: "牛仔", brand: "野行", gender: "中性", seasons: ["四季"], colors: ["蓝色", "黑色"], sizes: ["S", "M", "L", "XL", "XXL"], material: "牛仔布", price: 359, cost: 152, stock: 214, alert: 40, status: "on_sale", isNew: false, tags: ["直筒", "水洗"] },
  { name: "运动休闲两件套", sku: "ST-8001", category: "套装", brand: "云织", gender: "中性", seasons: ["春季", "秋季"], colors: ["灰色", "黑色"], sizes: ["M", "L", "XL"], material: "混纺", price: 429, cost: 190, stock: 58, alert: 25, status: "on_sale", isNew: true, tags: ["运动", "两件套"] },
  { name: "真皮软底乐福鞋", sku: "SO-9001", category: "鞋靴", brand: "步野", gender: "女装", seasons: ["春季", "秋季"], colors: ["棕色", "黑色"], sizes: ["35", "36", "37", "38", "39"], material: "牛皮", price: 569, cost: 258, stock: 76, alert: 20, status: "on_sale", isNew: false, tags: ["真皮", "乐福鞋"] },
  { name: "厚底老爹运动鞋", sku: "SO-9002", category: "鞋靴", brand: "步野", gender: "中性", seasons: ["四季"], colors: ["白色", "灰色", "粉色"], sizes: ["36", "37", "38", "39", "40", "41", "42"], material: "人造革", price: 399, cost: 168, stock: 340, alert: 50, status: "on_sale", isNew: false, tags: ["增高"] },
  { name: "羊毛混纺针织帽", sku: "HT-9101", category: "帽子", brand: "暖格", gender: "中性", seasons: ["冬季"], colors: ["黑色", "米色", "红色"], sizes: ["均码"], material: "羊毛", price: 129, cost: 48, stock: 205, alert: 40, status: "on_sale", isNew: false, tags: ["保暖"] },
  { name: "羊绒长款流苏围巾", sku: "SC-9201", category: "围巾", brand: "暖格", gender: "女装", seasons: ["冬季"], colors: ["米色", "灰色", "花色"], sizes: ["均码"], material: "羊绒", price: 389, cost: 172, stock: 12, alert: 20, status: "on_sale", isNew: false, tags: ["羊绒", "流苏"] },
  { name: "简约皮质单肩托特包", sku: "AC-9301", category: "配饰", brand: "步野", gender: "女装", seasons: ["四季"], colors: ["棕色", "黑色", "米色"], sizes: ["均码"], material: "牛皮", price: 799, cost: 356, stock: 43, alert: 15, status: "on_sale", isNew: true, tags: ["通勤", "真皮"] },
  { name: "复古金属细框墨镜", sku: "AC-9302", category: "配饰", brand: "步野", gender: "中性", seasons: ["夏季"], colors: ["黑色", "棕色"], sizes: ["均码"], material: "混纺", price: 189, cost: 62, stock: 0, alert: 25, status: "off_shelf", isNew: false, tags: ["墨镜"] },
]

function iso(daysAgo: number, hour = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, (daysAgo * 7) % 60, 0, 0)
  return d.toISOString()
}

const DEMO_PLATFORMS = ["淘宝", "1688", "拼多多", "抖店", "小红书"]

export function buildDemoProducts(): Product[] {
  return SEEDS.map((s, i) => {
    const id = `demo-${String(i + 1).padStart(3, "0")}`
    const created = iso(78 - i * 3, 9 + (i % 8))
    const updated = iso((i * 3) % 28, 11 + (i % 7))
    return {
      id,
      name: s.name,
      sku: s.sku,
      purchase_platform: DEMO_PLATFORMS[i % DEMO_PLATFORMS.length],
      category: s.category,
      brand: s.brand,
      gender: s.gender,
      seasons: s.seasons,
      colors: s.colors,
      sizes: s.sizes,
      material: s.material,
      price: s.price,
      net_price: Number((s.price * (0.88 + (i % 4) * 0.03)).toFixed(2)),
      platform_fee: Number((s.price * 0.05).toFixed(2)),
      shipping_fee: null,
      cost_price: s.cost,
      stock: s.stock,
      locked_stock: 0,
      stock_alert: s.alert,
      rebate: i % 3 === 0 ? Number((s.price * 0.02).toFixed(2)) : null,
      remark: i % 5 === 0 ? "档口现货，48 小时内发货" : null,
      status: s.status,
      is_new: s.isNew,
      cover_url: placeholderImage(s.name, i),
      images: [placeholderImage(s.name, i), placeholderImage(s.category, i + 3)],
      description: `${s.brand} ${s.name}｜${s.material}｜适用${s.seasons.join("、")}｜${s.colors.join("、")}。`,
      tags: s.tags,
      created_at: created,
      updated_at: updated,
    }
  })
}

/* ------------------------- 演示：销售订单 ------------------------- */

/**
 * 按真实交易占比铺一批演示订单：
 * 正常成交 ~62%、签收后退款 ~9%、发货前退款 ~17%、买家未付款 ~12%。
 * 交易失败（未付款）的订单不填买家支付时间——本来就没付。
 */
const STAGE_MIX: { status: string; returned: boolean; weight: number }[] = [
  { status: "交易成功", returned: false, weight: 62 },
  { status: "交易成功", returned: true, weight: 9 },
  { status: "交易关闭成功", returned: false, weight: 17 },
  { status: "交易失败", returned: false, weight: 12 },
]

const MIX_TOTAL = STAGE_MIX.reduce((sum, m) => sum + m.weight, 0)

function pickMix(index: number) {
  let point = (index * 37 + 11) % MIX_TOTAL
  for (const mix of STAGE_MIX) {
    if (point < mix.weight) return mix
    point -= mix.weight
  }
  return STAGE_MIX[0]
}

export function buildDemoSalesOrders(products: Product[]): SalesOrder[] {
  if (!products.length) return []
  const total = 96
  const rows: SalesOrder[] = []

  for (let i = 0; i < total; i++) {
    const product = products[(i * 7 + 3) % products.length]
    const mix = pickMix(i)
    const stage = computeTradeStage(mix.status, mix.returned)

    const color = product.colors.length ? product.colors[(i * 3) % product.colors.length] : ""
    const size = product.sizes.length ? product.sizes[(i * 5) % product.sizes.length] : ""
    const spec = [color, size].filter(Boolean).join(" / ") || null

    const daysAgo = (i * 11) % 42
    const paidAt =
      mix.status === "交易失败"
        ? null
        : new Date(Date.now() - daysAgo * 86400_000 - (i % 12) * 3600_000).toISOString()

    const charges = mix.status === "交易失败" ? null : Number((product.price * 0.93).toFixed(2))
    const afterSales =
      stage === "refund_after_receive"
        ? "退货退款"
        : stage === "refund_before_ship"
          ? "仅退款"
          : null

    rows.push({
      id: `demo-order-${String(i + 1).padStart(4, "0")}`,
      order_no: `DW${String(260900000 + i * 137).padStart(12, "0")}`,
      sku: product.sku,
      spec,
      order_status: mix.status,
      is_returned: mix.returned,
      is_settled: mix.status === "交易成功" && !mix.returned && daysAgo > 12,
      bid_amount: Number((product.price * (0.96 + (i % 5) * 0.02)).toFixed(2)),
      expected_income: charges,
      after_sales: afterSales,
      paid_at: paidAt,
      trade_stage: stage,
      created_at: paidAt ?? new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      updated_at: paidAt ?? new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    })
  }

  return rows.sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
}
