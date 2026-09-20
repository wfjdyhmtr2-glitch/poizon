import { useMemo, useRef, useState } from "react"
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/contexts/AppContext"
import { formatMoney } from "@/lib/format"
import type { PurchaseOrderDraft, SpuInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/** 表头别名：表头写得不一样也能认 */
const FIELD_ALIASES: Record<string, string[]> = {
  orderNo: ["入仓单号", "单号", "采购单号", "采购单", "入库单号", "orderno", "po"],
  platform: ["平台", "购入平台", "采购平台", "进货平台", "platform"],
  purchasedAt: ["采购日期", "购入日期", "进货日期", "日期", "下单日期", "purchasedat"],
  sku: ["spuid", "spu", "商品编号", "款号", "货号", "商品货号", "sku"],
  name: ["商品名称", "名称", "name"],
  color: ["颜色", "色", "color"],
  size: ["尺码", "尺寸", "规格", "size"],
  quantity: ["数量", "件数", "数目", "quantity", "qty"],
  unitCost: ["进货单价", "单价", "进价", "成本价", "成本单价", "拿货价", "unitcost", "cost"],
  shippingFee: ["运费", "物流费", "shippingfee"],
  remark: ["备注", "说明", "remark"],
}

const TEMPLATE_HEADERS = [
  "入仓单号",
  "平台",
  "采购日期",
  "SPUID",
  "商品名称",
  "颜色",
  "尺码",
  "数量",
  "进货单价",
  "运费",
  "备注",
]

interface ParsedRow {
  orderNo: string
  platform: string
  purchasedAt: string
  skuRaw: string
  sku: string
  skuFixed: boolean
  name: string
  color: string
  size: string
  quantity: number
  unitCost: number | null
  shippingFee: number | null
  remark: string
  issue: string | null
}

const norm = (v: string) => v.trim().replace(/\s/g, "").toLowerCase()

function pick(row: Record<string, unknown>, field: keyof typeof FIELD_ALIASES): string {
  const aliases = FIELD_ALIASES[field]
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(norm(key))) {
      const text = String(value ?? "").trim()
      if (text) return text
    }
  }
  return ""
}

function toNumber(text: string): number | null {
  if (!text) return null
  const n = Number(text.replace(/[¥,\s]/g, ""))
  return Number.isFinite(n) ? n : null
}

/** 采购日期归一成 YYYY-MM-DD（兼容 2026/9/5、2026年9月5日 这类写法） */
function normalizeDate(text: string): string {
  if (!text) return ""
  const m = text.match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/)
  if (!m) return ""
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  spuInfos: SpuInfo[]
  onDone: () => void
}

/**
 * 入仓单批量导入：粘贴或上传一张采购表，按「入仓单号」自动分成多张入仓单。
 * 「计入库存」不勾 = 补录历史采购：只更新成本档案，不动库存。
 */
export function PurchaseImportDialog({ open, onOpenChange, spuInfos, onDone }: Props) {
  const { backend, bumpData } = useApp()
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [notice, setNotice] = useState("")
  const [text, setText] = useState("")
  const [countStock, setCountStock] = useState(true)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  /** 货号 → SPUID：表里填的是货号也能自动纠正（他系统里商品主键是 SPUID） */
  const goodsNoToSku = useMemo(() => {
    const map = new Map<string, string>()
    for (const info of spuInfos) {
      const no = info.goods_no?.trim()
      if (no && !map.has(norm(no))) map.set(norm(no), info.sku)
    }
    return map
  }, [spuInfos])

  function reset() {
    setRows([])
    setNotice("")
    setText("")
    setProgress("")
  }

  function mapRows(raw: Record<string, unknown>[]) {
    const parsed: ParsedRow[] = raw.map((r) => {
      const skuRaw = pick(r, "sku")
      const mapped = goodsNoToSku.get(norm(skuRaw))
      const sku = mapped ?? skuRaw
      const qtyText = pick(r, "quantity")
      const qty = toNumber(qtyText)
      const unitCost = toNumber(pick(r, "unitCost"))
      const issues: string[] = []
      if (!skuRaw) issues.push("缺 SPUID")
      if (qty !== null && qty <= 0) issues.push("数量要大于 0")
      if (unitCost === null) issues.push("没填单价（成本不会更新）")
      return {
        orderNo: pick(r, "orderNo"),
        platform: pick(r, "platform"),
        purchasedAt: normalizeDate(pick(r, "purchasedAt")) || todayStr(),
        skuRaw,
        sku,
        skuFixed: Boolean(mapped) && mapped !== skuRaw,
        name: pick(r, "name"),
        color: pick(r, "color"),
        size: pick(r, "size"),
        quantity: qty === null || qty <= 0 ? 1 : Math.round(qty),
        unitCost,
        shippingFee: toNumber(pick(r, "shippingFee")),
        remark: pick(r, "remark"),
        issue: issues.length ? issues.join("；") : null,
      }
    })
    const usable = parsed.filter((r) => r.skuRaw || r.name || r.quantity > 1)
    setRows(usable)
    if (!usable.length) {
      setNotice("没读到数据：请确认第一行是表头，且至少有一列是 SPUID / 货号")
      return
    }
    const noSku = usable.filter((r) => !r.sku).length
    const noCost = usable.filter((r) => r.unitCost === null).length
    const fixed = usable.filter((r) => r.skuFixed).length
    const bits = [`共 ${usable.length} 行`]
    if (noSku) bits.push(`${noSku} 行缺 SPUID（会被跳过）`)
    if (noCost) bits.push(`${noCost} 行没单价`)
    if (fixed) bits.push(`${fixed} 行按货号自动认成了 SPUID`)
    setNotice(bits.join("，"))
  }

  async function parseFile(file: File) {
    try {
      const XLSX = await import("xlsx")
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
      mapRows(json)
    } catch (err) {
      reset()
      setNotice(`文件解析失败：${(err as Error).message}`)
    }
  }

  function parseText(value: string) {
    const lines = value
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim())
    if (lines.length < 2) {
      setRows([])
      setNotice("至少需要「表头 + 一行数据」")
      return
    }
    const delim = lines[0].includes("\t") ? "\t" : ","
    const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ""))
    const data = lines.slice(1).map((line) => {
      const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""))
      const obj: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        obj[h] = cells[i] ?? ""
      })
      return obj
    })
    mapRows(data)
  }

  /** 按入仓单号分组；没写单号的按「平台 + 日期」自动归组并生成单号 */
  const groups = useMemo(() => {
    const usable = rows.filter((r) => r.sku.trim())
    const map = new Map<string, ParsedRow[]>()
    const stamp = new Date()
    const tag = `${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}-${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}`
    for (const row of usable) {
      const key = row.orderNo.trim() || `__auto__${row.platform}|${row.purchasedAt}`
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    let autoIndex = 0
    return [...map.entries()].map(([key, list]) => {
      const isAuto = key.startsWith("__auto__")
      if (isAuto) autoIndex += 1
      const first = list[0]
      return {
        orderNo: isAuto ? `导入${tag}-${autoIndex}` : first.orderNo.trim(),
        platform: first.platform || null,
        purchasedAt: first.purchasedAt || null,
        shippingFee: list.find((r) => r.shippingFee !== null)?.shippingFee ?? null,
        remark: first.remark || (countStock ? null : "补录历史采购（不计库存）"),
        rows: list,
      }
    })
  }, [rows, countStock])

  const totalAmount = useMemo(
    () => rows.reduce((acc, r) => acc + (r.unitCost ?? 0) * r.quantity, 0),
    [rows],
  )

  async function downloadTemplate() {
    const XLSX = await import("xlsx")
    const sheet = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["", "1688", todayStr(), "TN002YR", "示例：Teenie Weenie 卫衣", "黑色", "M", 3, 88, 12, "可留空"],
      ["", "拼多多", todayStr(), "", "示例：同款不同色（SPUID 也可空着先占位）", "白色", "L", 2, 92, 12, ""],
    ])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, "采购明细")
    const out = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer
    const url = URL.createObjectURL(new Blob([out], { type: "application/octet-stream" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "入仓单批量导入模板.xlsx"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runImport() {
    if (!groups.length) {
      toast.error("没有可导入的行（至少要填 SPUID）")
      return
    }
    setImporting(true)
    let okOrders = 0
    let okRows = 0
    const failed: string[] = []
    try {
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        setProgress(`正在导入 ${i + 1}/${groups.length} 张入仓单…`)
        const draft: PurchaseOrderDraft = {
          order_no: g.orderNo,
          platform: g.platform,
          purchased_at: g.purchasedAt,
          shipping_fee: g.shippingFee,
          remark: g.remark,
          items: g.rows.map((r) => ({
            sku: r.sku.trim(),
            name: r.name || null,
            price: r.unitCost === null ? null : Number((r.unitCost * r.quantity).toFixed(2)),
            color: r.color,
            size: r.size,
            quantity: r.quantity,
            unit_cost: r.unitCost,
          })),
        }
        try {
          await backend.createPurchaseOrder(draft, { costOnly: !countStock })
          okOrders += 1
          okRows += g.rows.length
        } catch (err) {
          failed.push(`${g.orderNo}：${(err as Error).message}`)
        }
      }
      if (failed.length) {
        toast.error(`导入完成 ${okOrders}/${groups.length} 张，${failed.length} 张失败`, {
          description: failed.slice(0, 3).join("；"),
        })
      } else {
        toast.success(
          countStock
            ? `已导入 ${okOrders} 张入仓单 / ${okRows} 行，库存与成本已更新`
            : `已导入 ${okOrders} 张入仓单 / ${okRows} 行，只更新了成本档案（库存未动）`,
        )
      }
      bumpData()
      onDone()
      reset()
      onOpenChange(false)
    } finally {
      setImporting(false)
      setProgress("")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !importing && (v ? onOpenChange(v) : (reset(), onOpenChange(v)))}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto thin-scrollbar">
        <DialogHeader>
          <DialogTitle>批量导入采购（入仓单）</DialogTitle>
          <DialogDescription>
            粘贴或上传一张采购表，按「入仓单号」自动分成多张入仓单。需要的列：
            <strong>SPUID</strong>（填货号也能自动认成 SPUID）、<strong>数量</strong>、
            <strong>进货单价</strong>；平台 / 采购日期 / 颜色 / 尺码 / 运费 / 备注可选。
            <br />
            <span className="text-muted-foreground">
              「入仓单号」留空时，系统按「平台 + 日期」自动归组并生成单号。
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}>
              <Download className="size-4" />
              下载模板
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet className="size-4" />
              选择 .xlsx / .csv
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void parseFile(file)
                e.target.value = ""
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="po-import-text">或者直接把表格粘进来（含表头，Excel 复制出来即可）</Label>
            <Textarea
              id="po-import-text"
              rows={5}
              placeholder={"入仓单号\t平台\t采购日期\tSPUID\t颜色\t尺码\t数量\t进货单价\n\t1688\t2026-09-01\tTN002YR\t黑色\tM\t3\t88"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const value = e.clipboardData.getData("text")
                if (value.trim()) {
                  setText(value)
                  parseText(value)
                  e.preventDefault()
                }
              }}
              onBlur={() => text.trim() && parseText(text)}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
            <Checkbox
              aria-label="计入库存"
              checked={countStock}
              onCheckedChange={(v) => setCountStock(Boolean(v))}
              className="mt-0.5"
            />
            <span className="space-y-0.5 text-sm">
              <span className="font-medium">计入库存</span>
              <span className="block text-xs text-muted-foreground">
                新进的货勾上（库存 + 成本一起更新）。<strong>补录历史采购请取消勾选</strong>
                ：只按累计进货量算出加权平均成本，<strong>不动库存</strong>
                （历史买的东西多半早卖掉了，加库存会让库存虚高）。
              </span>
            </span>
          </label>

          {notice ? (
            <p className={cn("text-sm", rows.length ? "text-muted-foreground" : "text-destructive")}>
              {notice}
            </p>
          ) : null}

          {rows.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  将创建 <strong className="text-foreground">{groups.length}</strong> 张入仓单
                </span>
                <span>
                  明细 <strong className="text-foreground">{groups.reduce((a, g) => a + g.rows.length, 0)}</strong> 行
                </span>
                <span>
                  采购金额合计 <strong className="text-foreground">{formatMoney(totalAmount)}</strong>
                </span>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border thin-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-medium">入仓单</th>
                      <th className="px-2 py-1.5 font-medium">平台</th>
                      <th className="px-2 py-1.5 font-medium">日期</th>
                      <th className="px-2 py-1.5 font-medium">SPUID</th>
                      <th className="px-2 py-1.5 font-medium">规格</th>
                      <th className="px-2 py-1.5 text-right font-medium">数量</th>
                      <th className="px-2 py-1.5 text-right font-medium">单价</th>
                      <th className="px-2 py-1.5 font-medium">提示</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="max-w-[130px] truncate px-2 py-1.5 text-muted-foreground">
                          {r.orderNo || "（自动）"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.platform || "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {r.purchasedAt}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={cn("tabular-nums", r.skuFixed && "text-amber-600")}>
                            {r.sku || r.skuRaw || "—"}
                          </span>
                          {r.skuFixed ? (
                            <span className="ml-1 text-[10px] text-amber-600">（按货号认出）</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {[r.color, r.size].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {r.unitCost === null ? "—" : formatMoney(r.unitCost)}
                        </td>
                        <td className="px-2 py-1.5 text-destructive">{r.issue ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 ? (
                <p className="text-xs text-muted-foreground">（只预览前 200 行，导入会处理全部）</p>
              ) : null}
            </div>
          ) : null}

          {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onOpenChange(false))} disabled={importing}>
            取消
          </Button>
          <Button onClick={() => void runImport()} disabled={importing || !rows.length}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {importing ? "导入中…" : `导入 ${groups.length} 张入仓单`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
