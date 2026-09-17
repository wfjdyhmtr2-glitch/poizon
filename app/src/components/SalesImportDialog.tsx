import { useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  UploadCloud,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TradeStageBadge } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { SALES_IMPORT_COLUMNS } from "@/lib/constants"
import {
  computeTradeStage,
  isKnownOrderStatus,
  orderStockEffect,
  parseBool,
  parseDateTime,
  parseMoney,
  tradeStageLabel,
} from "@/lib/sales"
import { downloadBlob, formatMoney } from "@/lib/format"
import type { SalesImportRow, SalesOrderDraft } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function SalesImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (
    drafts: SalesOrderDraft[],
    mode: "insert" | "upsert",
  ) => Promise<{ inserted: number; updated: number; failed: number }>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { backend } = useApp()
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<SalesImportRow[]>([])
  /** 能联动库存的 spuID 集合（商品 SPUID + 已建对照的外部 spuID），null 表示还没加载完 */
  const [knownSkus, setKnownSkus] = useState<Set<string> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<"upsert" | "insert">("upsert")
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ inserted: number; updated: number; failed: number } | null>(
    null,
  )

  const summary = useMemo(() => {
    const valid = rows.filter((r) => r.errors.length === 0)
    return {
      valid,
      invalid: rows.filter((r) => r.errors.length > 0),
      warn: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0),
    }
  }, [rows])

  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      try {
        const [products, mappings] = await Promise.all([
          backend.fetchForDashboard(),
          backend.listSpuMappings(),
        ])
        if (!alive) return
        setKnownSkus(
          new Set([...products.map((p) => p.sku), ...mappings.map((m) => m.external_id)]),
        )
      } catch {
        if (alive) setKnownSkus(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [open, backend])

  function reset() {
    setFileName("")
    setRows([])
    setResult(null)
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function parseFile(file: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("只支持 .xlsx / .xls / .csv 文件")
      return
    }
    setParsing(true)
    setResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) throw new Error("文件里没有可读的工作表")
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      })
      if (!json.length) throw new Error("没有解析到数据行，请确认第一行是表头")

      const seen = new Set<string>()
      const parsed = json.map((raw, index) => {
        const row = buildRow(raw, index + 2)
        const no = row.raw["订单号"]
        if (no) {
          if (seen.has(no)) row.warnings.push("文件内订单号重复，导入时后者会覆盖前者")
          else seen.add(no)
        }
        return row
      })

      setFileName(file.name)
      if (knownSkus) {
        for (const row of parsed) {
          const s = String(row.raw["spuID"] ?? "").trim()
          if (s && !knownSkus.has(s)) {
            row.warnings.push(
              "spuID 未匹配任何商品或对照，这单不会联动库存；可先到「SPU 对照」里建立映射再导入",
            )
          }
        }
      }
      setRows(parsed)
      const bad = parsed.filter((r) => r.errors.length).length
      if (bad) toast.warning(`解析完成：${parsed.length - bad} 行可导入，${bad} 行需要修正`)
      else toast.success(`解析完成，共 ${parsed.length} 行全部可导入`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setParsing(false)
      setDragging(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function downloadTemplate() {
    const header = SALES_IMPORT_COLUMNS.map((c) => c.header)
    const examples = [
      ["DW260900001234", "SH-2001", "白色 / M", "交易成功", "否", "是", "259", "239.00", "无", "2026-09-01 12:30:00"],
      ["DW260900001235", "TS-1001", "黑色 / L", "交易成功", "是", "否", "129", "119.00", "退货退款", "2026-09-02 09:15:00"],
      ["DW260900001236", "DN-5001", "米色 / M", "交易关闭成功", "否", "否", "899", "835.00", "仅退款", "2026-09-03 20:05:00"],
      ["DW260900001237", "HD-3001", "灰色 / XL", "交易失败", "否", "否", "299", "", "", ""],
    ]
    const sheet = XLSX.utils.aoa_to_sheet([header, ...examples])
    sheet["!cols"] = header.map((h) => ({ wch: Math.max(12, h.length * 2.1) }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "销售订单模板")
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer
    downloadBlob(
      output,
      "销售订单导入模板.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
  }

  async function runImport() {
    const drafts = summary.valid.map((r) => r.order!).filter(Boolean)
    if (!drafts.length) {
      toast.error("没有可导入的数据")
      return
    }
    setImporting(true)
    setProgress(12)
    try {
      const timer = setInterval(() => setProgress((p) => Math.min(88, p + 9)), 220)
      const res = await onImport(drafts, mode)
      clearInterval(timer)
      setProgress(100)
      setResult(res)
      toast.success(`导入完成：新增 ${res.inserted} 条，更新 ${res.updated} 条`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto thin-scrollbar sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>批量导入销售订单</DialogTitle>
          <DialogDescription>
            订单号是判断新增还是更新的依据；订单状态与是否退货会自动推导交易阶段。
          </DialogDescription>
        </DialogHeader>

        {!rows.length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="size-4" />
                下载模板
              </Button>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => !parsing && inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file && !parsing) void parseFile(file)
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/25 hover:border-primary/50 hover:bg-muted/40",
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-xs">
                {parsing ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : dragging ? (
                  <UploadCloud className="size-6 text-primary" />
                ) : (
                  <FileSpreadsheet className="size-6" />
                )}
              </div>
              <div>
                <p className="font-medium">
                  {parsing ? "正在解析文件…" : "把订单 Excel / CSV 拖到这里，或点击选择"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  支持 .xlsx / .xls / .csv，首行必须是表头
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void parseFile(file)
                }}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {SALES_IMPORT_COLUMNS.map((col) => (
                <div key={col.key} className="rounded-lg border px-3 py-2">
                  <p className="text-sm font-medium">
                    {col.header}
                    {col.required ? <span className="text-destructive"> *</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{col.hint ?? "文本"}</p>
                </div>
              ))}
            </div>

            <Alert>
              <AlertTitle>状态怎么理解</AlertTitle>
              <AlertDescription className="space-y-1 text-xs leading-relaxed">
                <p>· 交易失败 → 买家根本没付款</p>
                <p>· 交易关闭成功 → 买家在你的平台发货前就退款了</p>
                <p>· 交易成功 + 是否退货＝是 → 买家收到货之后才退款（这单会算作亏损）</p>
                <p>· 交易成功 + 是否退货＝否 → 正常成交，计入收入</p>
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-xl border p-3">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-xs text-muted-foreground">可导入</p>
                  <p className="text-lg font-semibold tabular-nums">{summary.valid.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border p-3">
                <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-xs text-muted-foreground">有警告</p>
                  <p className="text-lg font-semibold tabular-nums">{summary.warn.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border p-3">
                <X className="size-5 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">无法导入</p>
                  <p className="text-lg font-semibold tabular-nums">{summary.invalid.length}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span> · 共解析{" "}
                {rows.length} 行
              </p>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-4" />
                重新选择
              </Button>
            </div>

            <div className="max-h-[38vh] overflow-auto rounded-xl border thin-scrollbar">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12">行号</TableHead>
                    <TableHead className="min-w-[150px]">订单号</TableHead>
                    <TableHead className="w-[100px]">spuID</TableHead>
                    <TableHead className="w-[100px]">规格</TableHead>
                    <TableHead className="w-[110px]">订单状态</TableHead>
                    <TableHead className="w-[104px]">是否退货</TableHead>
                    <TableHead className="w-[96px]">预计收入</TableHead>
                    <TableHead className="w-[120px]">交易阶段</TableHead>
                    <TableHead className="min-w-[200px]">校验结果</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((row) => {
                    const stage = row.order
                      ? computeTradeStage(row.order.order_status, row.order.is_returned)
                      : null
                    const effect = row.order
                      ? orderStockEffect(
                          row.order.order_status,
                          row.order.is_returned,
                          row.order.is_settled,
                        )
                      : null
                    return (
                      <TableRow
                        key={row.rowNo}
                        className={cn(row.errors.length && "bg-destructive/10")}
                      >
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {row.rowNo}
                        </TableCell>
                        <TableCell className="truncate font-mono text-xs">
                          {row.raw["订单号"] || "—"}
                        </TableCell>
                        <TableCell className="truncate font-mono text-xs">
                          {row.raw["spuID"] || "—"}
                        </TableCell>
                        <TableCell className="truncate text-xs">{row.raw["规格"] || "—"}</TableCell>
                        <TableCell className="text-xs">{row.raw["订单状态"] || "—"}</TableCell>
                        <TableCell className="text-xs">{row.raw["是否退货"] || "否"}</TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {row.order?.expected_income !== null &&
                          row.order?.expected_income !== undefined
                            ? formatMoney(row.order.expected_income)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {stage ? (
                            <TradeStageBadge stage={stage} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.errors.length ? (
                            <div className="space-y-0.5">
                              {row.errors.map((e) => (
                                <p key={e} className="text-xs text-destructive">
                                  {e}
                                </p>
                              ))}
                            </div>
                          ) : row.warnings.length ? (
                            <div className="space-y-0.5">
                              {row.warnings.map((w) => (
                                <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
                                  {w}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3.5" />
                                {stage ? tradeStageLabel(stage) : "通过"}
                              </span>
                              <p className="text-xs text-muted-foreground">
                                库存：
                                {effect === "locked"
                                  ? "锁定 1 个"
                                  : effect === "consumed"
                                    ? "扣减 1 个"
                                    : "不占用"}
                              </p>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {rows.length > 100 ? (
              <p className="text-xs text-muted-foreground">
                预览仅显示前 100 行，实际导入会处理全部 {rows.length} 行。
              </p>
            ) : null}

            <div className="space-y-3">
              <Label className="text-sm">导入选项</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "upsert" | "insert")}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="sales-upsert"
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                    mode === "upsert" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value="upsert" id="sales-upsert" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">新增并更新（推荐）</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      已存在的订单号会覆盖更新，新订单号直接新增
                    </p>
                  </div>
                </Label>
                <Label
                  htmlFor="sales-insert"
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                    mode === "insert" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value="insert" id="sales-insert" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">仅新增</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      订单号已存在时跳过，不改动原有数据
                    </p>
                  </div>
                </Label>
              </RadioGroup>

              {summary.invalid.length ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>有 {summary.invalid.length} 行无法导入</AlertTitle>
                  <AlertDescription>
                    这些行会被自动跳过，其余 {summary.valid.length} 行可正常导入。
                  </AlertDescription>
                </Alert>
              ) : null}

              {importing || progress > 0 ? (
                <div className="space-y-2">
                  <Progress value={progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    {result ? "导入完成" : "正在写入云端数据库…"}
                  </p>
                </div>
              ) : null}

              {result ? (
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertTitle>导入完成</AlertTitle>
                  <AlertDescription>
                    新增 {result.inserted} 条 · 更新 {result.updated} 条
                    {result.failed ? ` · 跳过 ${result.failed} 条` : ""}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    // 弹窗里的「取消」必须同时关闭弹窗，否则只是清空了文件、窗口还杵在那
                    reset()
                    onOpenChange(false)
                  }}
                  disabled={importing}
                >
                  取消
                </Button>
                <Button onClick={runImport} disabled={importing || !summary.valid.length}>
                  {importing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  确认导入 {summary.valid.length} 行
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------- 解析与校验 ---------- */

function buildRow(raw: Record<string, unknown>, rowNo: number): SalesImportRow {
  const errors: string[] = []
  const warnings: string[] = []
  const text = (header: string) => String(raw[header] ?? "").trim()

  const orderNo = text("订单号")
  const sku = text("spuID")
  const statusRaw = text("订单状态")

  if (!orderNo) errors.push("缺少订单号")
  if (!sku) errors.push("缺少 spuID")
  if (!statusRaw) errors.push("缺少订单状态")
  else if (!isKnownOrderStatus(statusRaw)) {
    errors.push(`订单状态「${statusRaw}」无法识别，只能是 交易成功 / 交易失败 / 交易关闭成功`)
  }

  const returned = parseBool(text("是否退货"))
  if (returned === null) warnings.push(`是否退货「${text("是否退货")}」无法识别，已按否处理`)
  const isReturned = returned ?? false

  const settled = parseBool(text("是否结算"))
  if (settled === null) warnings.push(`是否结算「${text("是否结算")}」无法识别，已按否处理`)
  const isSettled = settled ?? false

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
    warnings.push("预计收入高于出价金额，请确认是否填反")
  }

  const stage = computeTradeStage(statusRaw, isReturned)
  if (stage === "unpaid" && paidRaw) {
    warnings.push("订单状态是交易失败（买家未付款），通常不会有支付时间")
  }
  if (stage === "refund_after_receive") {
    warnings.push("签收后退款，这单会记为亏损")
  }

  if (errors.length) {
    return { rowNo, raw: stringifyRaw(raw), order: null, errors, warnings }
  }

  const draft: SalesOrderDraft = {
    order_no: orderNo,
    sku,
    spec: text("规格") || null,
    order_status: statusRaw,
    is_returned: isReturned,
    is_settled: isSettled,
    bid_amount: bid,
    expected_income: income,
    after_sales: text("售后服务") || null,
    paid_at: paidAt,
  }

  return { rowNo, raw: stringifyRaw(raw), order: draft, errors, warnings }
}

function stringifyRaw(raw: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const col of SALES_IMPORT_COLUMNS) {
    out[col.header] = String(raw[col.header] ?? "")
  }
  return out
}
