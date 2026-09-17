import { useCallback, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import * as XLSX from "xlsx"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCcw,
  Table2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApp } from "@/contexts/AppContext"
import { CATEGORIES, GENDERS, IMPORT_COLUMNS } from "@/lib/constants"
import { downloadBlob, splitList, toStatus } from "@/lib/format"
import type { ImportRow, ProductDraft } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const MAX_PREVIEW = 200

export function ImportPage() {
  const { backend, bumpData } = useApp()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<ImportRow[]>([])
  const [parsing, setParsing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<"upsert" | "insert">("upsert")
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ inserted: number; updated: number; failed: number } | null>(
    null,
  )
  const [showAll, setShowAll] = useState(false)

  const summary = useMemo(() => {
    const valid = rows.filter((r) => r.errors.length === 0)
    const invalid = rows.filter((r) => r.errors.length > 0)
    const warn = rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0)
    return { valid, invalid, warn }
  }, [rows])

  const reset = useCallback(() => {
    setFileName("")
    setRows([])
    setResult(null)
    setProgress(0)
    setShowAll(false)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

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

      const parsed = json.map((raw, index) => buildRow(raw, index + 2))
      setFileName(file.name)
      setRows(parsed)
      const bad = parsed.filter((r) => r.errors.length).length
      if (bad) {
        toast.warning(`解析完成：${parsed.length - bad} 行可导入，${bad} 行需要修正`)
      } else {
        toast.success(`解析完成，共 ${parsed.length} 行全部可导入`)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setParsing(false)
      setDragging(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function downloadTemplate() {
    const header = IMPORT_COLUMNS.map((c) => c.header)
    const example = [
      "淘宝",
      "法式泡泡袖雪纺衬衫",
      "SH-2001",
      "衬衫",
      "蔓辞",
      "女装",
      "春季、秋季",
      "白色、米色",
      "S、M、L",
      "259",
      "239",
      "12.95",
      "108",
      "132",
      "5.18",
      "薄款，注意色差",
      "30",
      "在售",
      "https://example.com/cover.jpg",
      "法式、通勤",
      "轻薄透气，适合春秋通勤",
    ]
    const sheet = XLSX.utils.aoa_to_sheet([header, example])
    sheet["!cols"] = header.map((h) => ({ wch: Math.max(10, h.length * 2.2) }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "商品导入模板")
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer
    downloadBlob(
      output,
      "商品导入模板.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
  }

  async function runImport() {
    const drafts = summary.valid.map((r) => r.product!).filter(Boolean)
    if (!drafts.length) {
      toast.error("没有可导入的数据")
      return
    }
    setImporting(true)
    setProgress(12)
    try {
      const timer = setInterval(() => setProgress((p) => Math.min(88, p + 9)), 220)
      const res = await backend.importProducts(drafts, mode)
      clearInterval(timer)
      setProgress(100)
      setResult(res)
      bumpData()
      toast.success(`导入完成：新增 ${res.inserted} 条，更新 ${res.updated} 条`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const previewRows = showAll ? rows : rows.slice(0, 12)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">批量导入</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            用 Excel 或 CSV 一次导入多个商品，导入前会自动校验并给出错误提示
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="size-4" />
            下载模板
          </Button>
          {rows.length ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-4" />
              重新选择
            </Button>
          ) : null}
        </div>
      </div>

      {/* 上传区 */}
      {!rows.length ? (
        <Card>
          <CardContent className="p-4 sm:p-5">
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
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
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
                  {parsing ? "正在解析文件…" : "把 Excel / CSV 拖到这里，或点击选择"}
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

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { step: "1", title: "下载模板", desc: "按模板列填好商品数据" },
                { step: "2", title: "上传校验", desc: "系统逐行检查必填与格式" },
                { step: "3", title: "确认导入", desc: "写入云端数据库" },
              ].map((item) => (
                <div key={item.step} className="flex gap-3 rounded-xl border p-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                    {item.step}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 字段说明 */}
      {!rows.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Table2 className="size-4 text-primary" />
              模板字段说明
            </CardTitle>
            <CardDescription>带 * 为必填，多值字段用顿号、逗号或斜杠分隔</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_COLUMNS.map((col) => (
                <div key={col.key} className="rounded-lg border px-3 py-2">
                  <p className="text-sm font-medium">
                    {col.header}
                    {col.required ? <span className="text-destructive"> *</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {col.hint ?? "文本"}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 校验结果 */}
      {rows.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">可导入</p>
                  <p className="text-xl font-semibold tabular-nums">{summary.valid.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">有警告</p>
                  <p className="text-xl font-semibold tabular-nums">{summary.warn.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
                  <X className="size-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">无法导入</p>
                  <p className="text-xl font-semibold tabular-nums">{summary.invalid.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{fileName}</CardTitle>
                <CardDescription>
                  共解析 {rows.length} 行
                  {summary.invalid.length ? "，红色行需要修正后重新上传" : "，全部校验通过"}
                </CardDescription>
              </div>
              <Badge variant="outline" className="shrink-0">
                {summary.valid.length} 行待导入
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto thin-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-14">行号</TableHead>
                      <TableHead className="w-[86px]">购入平台</TableHead>
                      <TableHead className="min-w-[170px]">商品名称</TableHead>
                      <TableHead className="w-[120px]">SPUID</TableHead>
                      <TableHead className="w-[80px]">分类</TableHead>
                      <TableHead className="w-[90px]">售价</TableHead>
                      <TableHead className="w-[80px]">到手价</TableHead>
                      <TableHead className="w-[70px]">库存</TableHead>
                      <TableHead className="min-w-[240px]">校验结果</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row) => (
                      <TableRow
                        key={row.rowNo}
                        className={cn(row.errors.length && "bg-destructive/10")}
                      >
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {row.rowNo}
                        </TableCell>
                        <TableCell className="truncate text-xs">
                          {row.raw["购入平台"] || "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">
                          {row.raw["商品名称"] || "—"}
                        </TableCell>
                        <TableCell className="truncate font-mono text-xs">
                          {row.raw["SPUID"] || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{row.raw["分类"] || "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {row.raw["售价"] || "—"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {row.raw["到手价"] || "—"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {row.raw["库存"] || "0"}
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
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3.5" />
                              通过
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 12 ? (
                <div className="mt-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "收起到前 12 行" : `展开全部 ${Math.min(rows.length, MAX_PREVIEW)} 行`}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">导入选项</CardTitle>
              <CardDescription>SPUID 是判断新增还是更新的唯一依据</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "upsert" | "insert")}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="mode-upsert"
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                    mode === "upsert" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value="upsert" id="mode-upsert" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">新增并更新（推荐）</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      已存在的 SPUID 会覆盖更新，新 SPUID 直接新增
                    </p>
                  </div>
                </Label>
                <Label
                  htmlFor="mode-insert"
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                    mode === "insert" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem value="insert" id="mode-insert" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">仅新增</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      SPUID 已存在时跳过该行，不改动原有数据
                    </p>
                  </div>
                </Label>
              </RadioGroup>

              {summary.invalid.length ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>有 {summary.invalid.length} 行无法导入</AlertTitle>
                  <AlertDescription>
                    这些行会被自动跳过。修正后重新上传即可，其余 {summary.valid.length} 行可以正常导入。
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

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={reset} disabled={importing}>
                  取消
                </Button>
                <Button
                  onClick={runImport}
                  disabled={importing || !summary.valid.length}
                  className="sm:w-auto"
                >
                  {importing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  确认导入 {summary.valid.length} 行
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {result ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>导入完成</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>新增 {result.inserted} 条</span>
            <span>更新 {result.updated} 条</span>
            {result.failed ? <span className="text-destructive">跳过 {result.failed} 条</span> : null}
            <Button variant="link" size="sm" className="h-auto p-0" asChild>
              <Link to="/products">去看商品列表 →</Link>
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => navigate("/dashboard")}
            >
              查看数据看板 →
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!rows.length ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>小提示</AlertTitle>
          <AlertDescription>
            图片链接列可以直接填公网图片地址；导入完成后进入编辑页还能上传本地图片到云端存储。
            分类建议填：{CATEGORIES.slice(0, 6).join(" / ")} 等；适用人群填{" "}
            {GENDERS.join(" / ")}。
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/* ---------- 解析与校验 ---------- */

function buildRow(raw: Record<string, unknown>, rowNo: number): ImportRow {
  const errors: string[] = []
  const warnings: string[] = []
  const text = (header: string) => String(raw[header] ?? "").trim()
  const toNumber = (header: string, label: string) => {
    const value = text(header)
    if (!value) return null
    const parsed = Number(value.replace(/[^\d.-]/g, ""))
    if (Number.isNaN(parsed)) {
      warnings.push(`${label}「${value}」无法识别，已忽略`)
      return null
    }
    return parsed
  }
  const toInt = (header: string, label: string, fallback: number) => {
    const value = text(header)
    if (!value) return fallback
    const parsed = Number(value.replace(/[^\d.-]/g, ""))
    if (Number.isNaN(parsed)) {
      warnings.push(`${label}无法识别，已按 ${fallback} 处理`)
      return fallback
    }
    return parsed
  }

  const name = text("商品名称")
  const sku = text("SPUID")
  const priceRaw = text("售价")

  if (!name) errors.push("缺少商品名称")
  if (!sku) errors.push("缺少 SPUID")
  if (!priceRaw) errors.push("缺少售价")

  const price = Number(priceRaw.replace(/[^\d.-]/g, ""))
  if (priceRaw && Number.isNaN(price)) errors.push("售价不是有效数字")
  if (!Number.isNaN(price) && price < 0) errors.push("售价不能为负数")

  const netPrice = toNumber("到手价", "到手价")
  const platformFee = toNumber("平台费用", "平台费用")
  const cost = toNumber("成本价", "成本价")
  const rebate = toNumber("返利", "返利")

  if (netPrice !== null && netPrice > price) {
    warnings.push("到手价高于售价，请确认是否填反")
  }
  if (cost !== null && netPrice !== null && cost > netPrice) {
    warnings.push("成本价高于到手价，这一单是亏的")
  }

  const stock = toInt("库存", "库存", 0)
  const stockAlert = toInt("库存预警值", "预警值", 5)

  const category = text("分类")
  if (category && !CATEGORIES.includes(category)) {
    warnings.push(`分类「${category}」不在预设列表中，仍会保存`)
  }

  const gender = text("适用人群")
  if (gender && !GENDERS.includes(gender)) {
    warnings.push(`适用人群「${gender}」不在预设列表中`)
  }

  const cover = text("主图链接")
  if (cover && !/^https?:\/\//i.test(cover) && !cover.startsWith("data:")) {
    warnings.push("主图链接不是有效的 http(s) 地址")
  }

  if (errors.length) {
    return { rowNo, raw: stringifyRaw(raw), product: null, errors, warnings }
  }

  const draft: ProductDraft = {
    name,
    sku,
    purchase_platform: text("购入平台") || null,
    category,
    brand: text("品牌") || null,
    gender: gender || null,
    seasons: splitList(text("季节")),
    colors: splitList(text("颜色")),
    sizes: splitList(text("尺码")),
    material: null,
    price: Number.isNaN(price) ? 0 : price,
    net_price: netPrice,
    platform_fee: platformFee,
    // 运费不入导入模板，后续由运费模块自动匹配计算
    shipping_fee: null,
    cost_price: cost,
    stock: Number.isNaN(stock) ? 0 : stock,
    stock_alert: Number.isNaN(stockAlert) ? 5 : stockAlert,
    rebate,
    remark: text("备注") || null,
    status: toStatus(text("状态")),
    is_new: false,
    cover_url: cover || null,
    images: cover ? [cover] : [],
    description: text("商品描述") || null,
    tags: splitList(text("标签")),
  }

  return { rowNo, raw: stringifyRaw(raw), product: draft, errors, warnings }
}

function stringifyRaw(raw: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const col of IMPORT_COLUMNS) {
    out[col.header] = String(raw[col.header] ?? "")
  }
  return out
}
