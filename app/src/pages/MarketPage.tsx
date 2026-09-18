import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Download,
  LineChart as LineChartIcon,
  RefreshCcw,
  Search,
  TrendingUp,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DateInput } from "@/components/DateInput"
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { formatCompact } from "@/lib/format"
import type {
  MarketOverview,
  MarketRankRow,
  MarketSnapshotDraft,
  MarketTrendSeries,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/** 曲线最多同时对比多少个商品——再多图就看不清了，也会拖慢渲染 */
const MAX_COMPARE = 8

/** 图表配色（固定顺序，保证同一商品颜色稳定） */
const SERIES_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
]

type RangePreset = "7" | "30" | "90" | "custom"
type MetricKey = "favorites" | "sales"

function dateOffset(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/* -------------------- 导入解析：表头做模糊匹配，容忍各种写法 -------------------- */

const HEADER_MAP: { keys: string[]; field: keyof MarketSnapshotDraft }[] = [
  { keys: ["日期", "统计日期", "date", "snapshot", "数据日期"], field: "snapshot_date" },
  { keys: ["spuid", "sku", "商品编号", "商品id", "货号"], field: "sku" },
  { keys: ["品牌", "brand", "brandname"], field: "brand" },
  { keys: ["商品名称", "名称", "name", "title", "标题"], field: "name" },
  { keys: ["销量", "sales", "销售量", "成交"], field: "sales" },
  { keys: ["收藏数", "收藏", "favorites", "favorite", "collect", "wish"], field: "favorites" },
]

function normalizeHeader(raw: string) {
  return raw.toLowerCase().replace(/[\s_（）()【】\[\]]/g, "")
}

/** 把各种写法的日期归一化成 YYYY-MM-DD（也吃 Excel 的日期序列号） */
function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "number") {
    // Excel 日期序列号（1900 起算）
    const ms = Math.round((value - 25569) * 86400000)
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const text = String(value).trim()
  const compact = text.replace(/[^\d]/g, "")
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  }
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(String(value).replace(/[,¥\s]/g, ""))
  return Number.isFinite(n) ? n : null
}

function parseSheet(rows: Record<string, unknown>[]) {
  const drafts: MarketSnapshotDraft[] = []
  const errors: string[] = []
  if (!rows.length) return { drafts, errors: ["没有解析到任何数据行"] }

  // 用第一行的表头建立「列名 → 字段」映射
  const headers = Object.keys(rows[0])
  const mapping = new Map<string, keyof MarketSnapshotDraft>()
  for (const header of headers) {
    const norm = normalizeHeader(header)
    const hit = HEADER_MAP.find((m) => m.keys.some((k) => norm === k || norm.includes(k)))
    if (hit) mapping.set(header, hit.field)
  }
  const fieldOf = (row: Record<string, unknown>, field: keyof MarketSnapshotDraft) => {
    for (const [header, f] of mapping.entries()) {
      if (f === field) return row[header]
    }
    return undefined
  }

  rows.forEach((row, i) => {
    const lineNo = i + 2
    const date = normalizeDate(fieldOf(row, "snapshot_date"))
    const sku = String(fieldOf(row, "sku") ?? "").trim()
    if (!date) {
      errors.push(`第 ${lineNo} 行：日期无法识别`)
      return
    }
    if (!sku) {
      errors.push(`第 ${lineNo} 行：SPUID 为空`)
      return
    }
    drafts.push({
      snapshot_date: date,
      sku,
      brand: String(fieldOf(row, "brand") ?? "").trim() || null,
      name: String(fieldOf(row, "name") ?? "").trim() || null,
      sales: toNumber(fieldOf(row, "sales")),
      favorites: toNumber(fieldOf(row, "favorites")),
    })
  })
  return { drafts, errors }
}

/* ==================================== 页面 ==================================== */

export function MarketPage() {
  const { backend, dataVersion, bumpData } = useApp()

  const [brands, setBrands] = useState<{ brand: string; skuCount: number }[]>([])
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [ranking, setRanking] = useState<MarketRankRow[] | null>(null)
  const [trend, setTrend] = useState<MarketTrendSeries[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [preset, setPreset] = useState<RangePreset>("30")
  const [customStart, setCustomStart] = useState(dateOffset(30))
  const [customEnd, setCustomEnd] = useState(todayISO())
  const [brand, setBrand] = useState("__all__")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "" })
  const [metric, setMetric] = useState<MetricKey>("favorites")
  const [compare, setCompare] = useState<string[]>([])

  const [importOpen, setImportOpen] = useState(false)
  const [pasting, setPasting] = useState("")
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const range = useMemo(() => {
    if (preset === "custom") return { start: customStart, end: customEnd }
    const days = Number(preset)
    return { start: dateOffset(days), end: todayISO() }
  }, [preset, customStart, customEnd])

  const query = useMemo(
    () => ({
      start: range.start,
      end: range.end,
      brands: brand === "__all__" ? undefined : [brand],
      keyword: applied.keyword || undefined,
      limit: 60,
    }),
    [range.start, range.end, brand, applied.keyword],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [brandRows, overviewRow, rankRows] = await Promise.all([
        backend.listMarketBrands().catch(() => []),
        backend.getMarketOverview(query),
        backend.listMarketRanking(query),
      ])
      setBrands(brandRows)
      setOverview(overviewRow)
      setRanking(rankRows)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend, query])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  // 曲线单独加载：只取选中的少量商品，几百行，很快
  useEffect(() => {
    let alive = true
    if (!compare.length) {
      setTrend([])
      return
    }
    backend
      .listMarketTrend(compare, range.start, range.end)
      .then((rows) => {
        if (alive) setTrend(rows)
      })
      .catch(() => {
        if (alive) setTrend([])
      })
    return () => {
      alive = false
    }
  }, [backend, compare, range.start, range.end])

  /** 把多商品序列转成 recharts 需要的「一行一天」结构 */
  const chartData = useMemo(() => {
    if (!trend.length) return []
    const byDate = new Map<string, Record<string, number | string>>()
    for (const series of trend) {
      for (const p of series.points) {
        const row = byDate.get(p.date) ?? { date: p.date }
        row[series.sku] = metric === "favorites" ? p.favorites : p.sales
        byDate.set(p.date, row)
      }
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [trend, metric])

  const nameOf = useCallback(
    (sku: string) => trend.find((t) => t.sku === sku)?.name || sku,
    [trend],
  )

  function toggleCompare(sku: string) {
    setCompare((prev) => {
      if (prev.includes(sku)) return prev.filter((s) => s !== sku)
      if (prev.length >= MAX_COMPARE) {
        toast.error(`最多同时对比 ${MAX_COMPARE} 个商品，先去掉一个`)
        return prev
      }
      return [...prev, sku]
    })
  }

  async function doImport(drafts: MarketSnapshotDraft[]) {
    if (!drafts.length) {
      toast.error("没有可导入的数据")
      return
    }
    setImporting(true)
    try {
      const result = await backend.importMarketSnapshots(drafts)
      if (result.failed) {
        toast.error(`${result.failed} 行导入失败，其余已写入`)
      } else {
        toast.success(
          `已导入 ${result.inserted + result.updated} 行（新增 ${result.inserted}，覆盖 ${result.updated}）`,
        )
      }
      setImportOpen(false)
      setPasting("")
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  function handlePastedText() {
    const text = pasting.trim()
    if (!text) {
      toast.error("先粘贴数据")
      return
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    const delimiter = lines[0].includes("\t") ? "\t" : ","
    const headers = lines[0].split(delimiter).map((h) => h.trim())
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(delimiter)
      const row: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        row[h] = cells[i]?.trim() ?? ""
      })
      return row
    })
    const { drafts, errors } = parseSheet(rows)
    if (errors.length) toast.warning(`${errors.length} 行被跳过：${errors[0]}`)
    void doImport(drafts)
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("只支持 .xlsx / .xls / .csv")
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
      const { drafts, errors } = parseSheet(rows)
      if (errors.length) toast.warning(`${errors.length} 行被跳过：${errors[0]}`)
      await doImport(drafts)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const hasData = (overview?.snapshotCount ?? 0) > 0

  if (loading && !ranking && !error) return <LoadingBlock label="正在汇总市场数据…" />
  if (error) return <ErrorBlock message={error} onRetry={load} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="市场机会"
        description="把每次抓下来的销量与收藏数据导进来，按时间段看趋势，找出还在涨的品。数据存在云端，页面只取筛选后的结果，商品再多也不会卡。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              导入数据
            </Button>
          </>
        }
      />

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <LineChartIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">还没有市场数据</p>
            <p className="max-w-md text-sm text-muted-foreground">
              点右上角「导入数据」上传你抓下来的表格，或直接粘贴。 需要的列：日期、SPUID，以及品牌 /
              商品名称 / 销量 / 收藏数中的任意几列（表头写得不一样也能认）。
            </p>
            <Button className="mt-1" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              导入第一批数据
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="覆盖商品"
              value={`${overview?.skuCount ?? 0} 个`}
              hint={`${range.start} ~ ${range.end}`}
            />
            <StatCard
              label="数据天数"
              value={`${overview?.dayCount ?? 0} 天`}
              hint={`共 ${formatCompact(overview?.snapshotCount ?? 0)} 条快照`}
            />
            <StatCard
              label="最新数据"
              value={overview?.latestDate || "—"}
              hint="数据越新判断越准"
            />
            <StatCard
              label="当前对比"
              value={`${compare.length} / ${MAX_COMPARE}`}
              hint="点排行里的「加曲线」对比"
            />
          </div>

          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label>时间范围</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["7", "近 7 天"],
                      ["30", "近 30 天"],
                      ["90", "近 90 天"],
                      ["custom", "自定义"],
                    ] as [RangePreset, string][]
                  ).map(([key, label]) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant={preset === key ? "default" : "outline"}
                      className="h-8 px-2.5 text-xs"
                      onClick={() => setPreset(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {preset === "custom" ? (
                  <div className="flex items-center gap-2 pt-1">
                    <DateInput
                      value={customStart}
                      onChange={setCustomStart}
                      className="h-9 w-[140px]"
                    />
                    <span className="text-xs text-muted-foreground">至</span>
                    <DateInput
                      value={customEnd}
                      onChange={setCustomEnd}
                      className="h-9 w-[140px]"
                    />
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>品牌</Label>
                <Select value={brand} onValueChange={setBrand}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部品牌</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.brand} value={b.brand}>
                        {b.brand}（{b.skuCount}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="market-keyword">搜索商品</Label>
                <div className="flex gap-2">
                  <Input
                    id="market-keyword"
                    placeholder="SPUID 或名称"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setApplied({ keyword: keyword.trim() })
                    }}
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    aria-label="搜索商品"
                    onClick={() => setApplied({ keyword: keyword.trim() })}
                  >
                    <Search className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>看哪个指标</Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={metric === "favorites" ? "default" : "outline"}
                    className="h-8 px-2.5 text-xs"
                    onClick={() => setMetric("favorites")}
                  >
                    收藏趋势
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={metric === "sales" ? "default" : "outline"}
                    className="h-8 px-2.5 text-xs"
                    onClick={() => setMetric("sales")}
                  >
                    销量趋势
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-primary" />
                趋势曲线
              </CardTitle>
              <CardDescription>
                {compare.length
                  ? `正在对比 ${compare.length} 个商品（最多 ${MAX_COMPARE} 个）`
                  : "从下面的排行里点「加曲线」，挑几个商品对比看看"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {compare.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {compare.map((sku, i) => (
                    <Badge
                      key={sku}
                      variant="secondary"
                      className="gap-1"
                      style={{ borderLeft: `3px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}` }}
                    >
                      {nameOf(sku) || sku}
                      <button
                        type="button"
                        aria-label={`移除 ${sku}`}
                        onClick={() => toggleCompare(sku)}
                        className="ml-0.5 rounded hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}

              {chartData.length ? (
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} width={56} />
                      <Tooltip
                        formatter={(value: number, key: string) => [
                          value.toLocaleString("zh-CN"),
                          nameOf(key) || key,
                        ]}
                      />
                      <Legend formatter={(value: string) => nameOf(value) || value} />
                      {compare.map((sku, i) => (
                        <Line
                          key={sku}
                          type="monotone"
                          dataKey={sku}
                          stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {compare.length ? "正在加载曲线…" : "尚未选择对比商品"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">机会排行</CardTitle>
              <CardDescription>
                按「收藏增量」排序（区间内最后一天 − 第一天）。
                收藏涨得快、但销量还不高的品，通常就是还没被抢的机会。
                最多显示 60 行——再多也不会一次全拉下来。
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[56px] text-right">#</TableHead>
                      <TableHead className="min-w-[180px]">商品</TableHead>
                      <TableHead className="w-[120px]">品牌</TableHead>
                      <TableHead className="w-[110px] text-right">收藏增量</TableHead>
                      <TableHead className="w-[110px] text-right">最新收藏</TableHead>
                      <TableHead className="w-[100px] text-right">销量合计</TableHead>
                      <TableHead className="w-[80px] text-right">天数</TableHead>
                      <TableHead className="w-[110px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ranking ?? []).map((row, i) => {
                      const active = compare.includes(row.sku)
                      return (
                        <TableRow key={row.sku}>
                          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                            {i + 1}
                          </TableCell>
                          <TableCell>
                            <p className="line-clamp-1 text-sm font-medium">
                              {row.name || "（无名称）"}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {row.sku}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.brand ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                "font-semibold tabular-nums",
                                row.favoritesGrowth > 0 && "text-emerald-600 dark:text-emerald-400",
                                row.favoritesGrowth < 0 && "text-destructive",
                              )}
                            >
                              {row.favoritesGrowth > 0 ? "+" : ""}
                              {row.favoritesGrowth.toLocaleString("zh-CN")}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {row.favoritesLatest.toLocaleString("zh-CN")}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {row.salesTotal.toLocaleString("zh-CN")}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                            {row.points}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant={active ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => toggleCompare(row.sku)}
                            >
                              {active ? "移出曲线" : "加曲线"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {(ranking ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          当前筛选条件下没有数据，换个时间段或品牌试试。
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入市场数据</DialogTitle>
            <DialogDescription>
              支持 .xlsx / .xls / .csv，首行是表头。需要的列：
              <strong> 日期、SPUID</strong>，以及 品牌 / 商品名称 / 销量 / 收藏数 中的任意几列。
              表头写法不一样也能认（如「收藏」「favorites」都行）。
              同一天同一个 SPUID 重复导入会<strong>覆盖</strong>，不会重复累加。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                  e.target.value = ""
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
                <Upload className="size-4" />
                选择文件
              </Button>
              <Button variant="outline" asChild>
                <a href="#" onClick={(e) => e.preventDefault()}>
                  <Download className="size-4" />
                  列说明见下方
                </a>
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="market-paste">或者直接粘贴（从 Excel 复制过来即可）</Label>
              <Textarea
                id="market-paste"
                rows={8}
                placeholder={"日期\tSPUID\t品牌\t商品名称\t销量\t收藏数\n2026-09-18\tMK-001\tNike\t空军一号\t12\t1860"}
                value={pasting}
                onChange={(e) => setPasting(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button onClick={handlePastedText} disabled={importing}>
              {importing ? "导入中…" : "导入粘贴的数据"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
