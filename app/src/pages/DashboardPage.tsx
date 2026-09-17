import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CircleDollarSign,
  Clock,
  Package,
  PackageCheck,
  Plus,
  RefreshCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ErrorBlock, LoadingBlock, ProductThumb, StatCard, StatusBadge } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { CATEGORIES, STATUS_META } from "@/lib/constants"
import { formatCompact, formatDate, formatMoney, relativeTime } from "@/lib/format"
import type { DashboardData, Product } from "@/lib/types"
import { cn } from "@/lib/utils"

const PRICE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "0-99", min: 0, max: 99.999 },
  { label: "100-199", min: 100, max: 199.999 },
  { label: "200-299", min: 200, max: 299.999 },
  { label: "300-499", min: 300, max: 499.999 },
  { label: "500-999", min: 500, max: 999.999 },
  { label: "1000+", min: 1000, max: Number.POSITIVE_INFINITY },
]

function buildDashboard(rows: Product[]): DashboardData {
  const now = Date.now()
  const weekAgo = now - 7 * 86400_000
  const dayKeys: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400_000)
    dayKeys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    )
  }

  const createdMap = new Map<string, number>()
  const updatedMap = new Map<string, number>()
  const categoryMap = new Map<string, number>()
  const statusMap = new Map<string, number>()
  const bandMap = new Map<string, { count: number; stock: number }>()

  let totalStock = 0
  let totalLocked = 0
  let stockValue = 0
  let priceSum = 0
  let lowStock = 0
  let outOfStock = 0
  let newThisWeek = 0
  let onSale = 0
  let offShelf = 0
  let draft = 0

  for (const p of rows) {
    totalStock += p.stock
    totalLocked += p.locked_stock ?? 0
    stockValue += p.price * p.stock
    priceSum += p.price
    if (p.stock === 0) outOfStock += 1
    else if (p.stock <= p.stock_alert) lowStock += 1

    if (p.status === "on_sale") onSale += 1
    else if (p.status === "off_shelf") offShelf += 1
    else draft += 1

    if (new Date(p.created_at).getTime() >= weekAgo) newThisWeek += 1

    const cat = p.category || "未分类"
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1)
    statusMap.set(p.status, (statusMap.get(p.status) ?? 0) + 1)

    const band = PRICE_BANDS.find((b) => p.price >= b.min && p.price <= b.max) ?? PRICE_BANDS[0]
    const entry = bandMap.get(band.label) ?? { count: 0, stock: 0 }
    entry.count += 1
    entry.stock += p.stock
    bandMap.set(band.label, entry)

    const ck = p.created_at.slice(0, 10)
    const uk = p.updated_at.slice(0, 10)
    if (createdMap.has(ck)) createdMap.set(ck, (createdMap.get(ck) ?? 0) + 1)
    if (updatedMap.has(uk)) updatedMap.set(uk, (updatedMap.get(uk) ?? 0) + 1)
  }

  const categories = [...categoryMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const statuses = ["on_sale", "off_shelf", "draft"]
    .map((key) => ({ name: STATUS_META[key].label, value: statusMap.get(key) ?? 0 }))
    .filter((s) => s.value > 0)

  const trend = dayKeys.map((date) => ({
    date,
    created: createdMap.get(date) ?? 0,
    updated: updatedMap.get(date) ?? 0,
  }))

  const lowStockList = rows
    .filter((p) => p.stock <= p.stock_alert)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6)

  const recentList = [...rows]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  return {
    total: rows.length,
    onSale,
    offShelf,
    draft,
    lowStock,
    outOfStock,
    totalStock,
    totalLocked,
    stockValue,
    avgPrice: rows.length ? priceSum / rows.length : 0,
    newThisWeek,
    categories,
    statuses,
    priceBands: PRICE_BANDS.map((b) => ({
      band: b.label,
      count: bandMap.get(b.label)?.count ?? 0,
      stock: bandMap.get(b.label)?.stock ?? 0,
    })),
    trend,
    lowStockList,
    recentList,
  }
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(265 70% 62%)",
  "hsl(20 85% 58%)",
  "hsl(210 70% 55%)",
]

const axisProps = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-medium text-popover-foreground">{label}</p> : null}
      {payload.map((item: any) => (
        <p key={item.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: item.color || item.fill }}
          />
          {item.name}：<span className="font-medium text-popover-foreground">{item.value}</span>
        </p>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const { backend, dataVersion } = useApp()
  const [rows, setRows] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await backend.fetchForDashboard())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const data = useMemo(() => (rows ? buildDashboard(rows) : null), [rows])

  if (loading && !data) return <LoadingBlock label="正在汇总经营数据…" />
  if (error) return <ErrorBlock message={error} onRetry={load} />
  if (!data) return null

  const lowStockRatio = data.total ? (data.lowStock + data.outOfStock) / data.total : 0
  const onSaleRatio = data.total ? data.onSale / data.total : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">数据看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {data.total} 个 SKU · 数据更新于 {formatDate(new Date().toISOString())}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
          <Button size="sm" asChild>
            <Link to="/products/new">
              <Plus className="size-4" />
              新增商品
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="商品总数"
          value={data.total}
          icon={<Package className="size-5" />}
          tone="primary"
          hint={`本周新增 ${data.newThisWeek} 个`}
        />
        <StatCard
          label="在售商品"
          value={data.onSale}
          icon={<PackageCheck className="size-5" />}
          tone="success"
          hint={
            <span className="flex items-center gap-2">
              占比 {(onSaleRatio * 100).toFixed(1)}%
              <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{ width: `${onSaleRatio * 100}%` }}
                />
              </span>
            </span>
          }
        />
        <StatCard
          label="库存预警"
          value={data.lowStock + data.outOfStock}
          icon={<AlertTriangle className="size-5" />}
          tone={data.lowStock + data.outOfStock > 0 ? "warning" : "default"}
          hint={`其中 ${data.outOfStock} 个已断货`}
        />
        <StatCard
          label="库存总值"
          value={formatCompact(data.stockValue)}
          icon={<CircleDollarSign className="size-5" />}
          tone="default"
          hint={
            <span>
              共 {data.totalStock.toLocaleString("zh-CN")} 件可售
              {data.totalLocked > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  · {data.totalLocked} 件被订单锁定
                </span>
              ) : null}
              {" · "}均价 {formatMoney(Math.round(data.avgPrice))}
            </span>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-primary" />
              近 30 天商品变动
            </CardTitle>
            <CardDescription>新增与更新记录的时间分布</CardDescription>
          </CardHeader>
          <CardContent className="pl-0 pr-3">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="fillUpdated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <RTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="updated"
                    name="更新"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    fill="url(#fillUpdated)"
                  />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="新增"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#fillCreated)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              商品状态构成
            </CardTitle>
            <CardDescription>在售 / 下架 / 草稿占比</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.statuses}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={84}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.statuses.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-semibold tabular-nums">{data.total}</p>
                <p className="text-xs text-muted-foreground">SKU 总数</p>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {data.statuses.map((s, index) => (
                <div key={s.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <span className="flex-1 text-muted-foreground">{s.name}</span>
                  <span className="font-medium tabular-nums">{s.value}</span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                    {data.total ? ((s.value / data.total) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="size-4 text-primary" />
              分类分布
            </CardTitle>
            <CardDescription>各品类 SKU 数量</CardDescription>
          </CardHeader>
          <CardContent className="pl-0 pr-3">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.categories.slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" {...axisProps} width={64} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="value" name="SKU 数" radius={[0, 6, 6, 0]} barSize={16}>
                    {data.categories.slice(0, 10).map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="size-4 text-primary" />
              价格带分布
            </CardTitle>
            <CardDescription>按售价区间统计 SKU 数量</CardDescription>
          </CardHeader>
          <CardContent className="pl-0 pr-3">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.priceBands} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="band" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="count" name="SKU 数" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-amber-500" />
                库存预警
              </CardTitle>
              <CardDescription>库存不高于预警值的商品</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/products?sort=stock_asc">
                全部
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Progress value={lowStockRatio * 100} className="h-1.5 flex-1" />
              <span className="tabular-nums">
                {(lowStockRatio * 100).toFixed(1)}% 存在风险
              </span>
            </div>
            {data.lowStockList.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                库存都很健康，暂无预警商品 🎉
              </p>
            ) : (
              <ul className="divide-y">
                {data.lowStockList.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <ProductThumb
                      src={p.cover_url}
                      name={p.name}
                      className="size-9 shrink-0 rounded-lg bg-muted object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/products/${p.id}`}
                        className="line-clamp-1 text-sm font-medium hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.sku} · {p.category || "未分类"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          p.stock === 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {p.stock === 0 ? "断货" : `${p.stock} 件`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">预警 {p.stock_alert}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-primary" />
                最近更新
              </CardTitle>
              <CardDescription>按更新时间排序的最新商品</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/products">
                全部
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y">
              {data.recentList.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <ProductThumb
                    src={p.cover_url}
                    name={p.name}
                    className="size-9 shrink-0 rounded-lg bg-muted object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/products/${p.id}`}
                      className="line-clamp-1 text-sm font-medium hover:text-primary"
                    >
                      {p.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatMoney(p.price)} · {relativeTime(p.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
            <Separator className="mt-3" />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              覆盖 {CATEGORIES.length} 个品类字段模板，支持颜色 / 尺码 / 材质 / 季节多选
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
