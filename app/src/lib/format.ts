import type { ProductDraft, ProductStatus } from "./types"

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  if (Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(1)}万`
  return `¥${value.toLocaleString("zh-CN")}`
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "—"
  const diff = Date.now() - t
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return "刚刚"
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(iso)
}

export function statusLabel(status: string) {
  return status === "on_sale" ? "在售" : status === "off_shelf" ? "已下架" : "草稿"
}

export function toStatus(input: string): ProductStatus {
  const v = (input || "").trim()
  if (v === "在售" || v === "on_sale" || v === "上架" || v === "1") return "on_sale"
  if (v === "已下架" || v === "下架" || v === "off_shelf" || v === "0") return "off_shelf"
  return "draft"
}

export function splitList(input: string | null | undefined): string[] {
  if (!input) return []
  return String(input)
    .split(/[、,，;；/|\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const COVER_HUES = [8, 24, 42, 96, 152, 186, 210, 240, 268, 300, 330, 352]

export function placeholderImage(text: string, seed = 0): string {
  const hue = COVER_HUES[Math.abs(seed) % COVER_HUES.length]
  const short = (text || "商品").slice(0, 4)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue},58%,68%)"/>` +
    `<stop offset="100%" stop-color="hsl(${(hue + 38) % 360},52%,46%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="480" height="480" fill="url(#g)"/>` +
    `<circle cx="380" cy="96" r="130" fill="rgba(255,255,255,0.10)"/>` +
    `<circle cx="96" cy="404" r="110" fill="rgba(0,0,0,0.06)"/>` +
    `<text x="240" y="262" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" font-size="88" font-weight="700" fill="rgba(255,255,255,0.95)" text-anchor="middle">${escapeXml(
      short,
    )}</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function emptyDraft(): ProductDraft {
  return {
    name: "",
    sku: "",
    purchase_platform: "",
    category: "",
    brand: "",
    gender: "",
    seasons: [],
    colors: [],
    sizes: [],
    material: "",
    price: 0,
    net_price: null,
    platform_fee: null,
    shipping_fee: null,
    cost_price: null,
    stock: 0,
    stock_alert: 5,
    rebate: null,
    remark: "",
    status: "on_sale",
    is_new: false,
    cover_url: null,
    images: [],
    description: "",
    tags: [],
  }
}

/** 净利测算：净收入 = 到手价（缺省用售价）+ 返利；净支出 = 成本价 + 平台费用 */
export function netProfit(input: {
  price: number
  net_price: number | null
  platform_fee: number | null
  cost_price: number | null
  rebate: number | null
}) {
  const revenue = (input.net_price ?? input.price ?? 0) + (input.rebate ?? 0)
  const cost = (input.cost_price ?? 0) + (input.platform_fee ?? 0)
  const profit = revenue - cost
  const rate = revenue > 0 ? (profit / revenue) * 100 : 0
  return { revenue, cost, profit, rate, hasCost: input.cost_price !== null && input.cost_price !== undefined }
}

/** 压缩图片后再上传，避免超大原图占满存储 */
export async function compressImage(file: File, maxSize = 1400, quality = 0.86): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  )
  return blob && blob.size > 0 ? blob : file
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
