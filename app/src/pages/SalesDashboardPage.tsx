import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  PackageX,
  Plus,
  RefreshCcw,
  ShoppingBag,
  TrendingUp,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorBlock, LoadingBlock, StatCard } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { buildSalesDashboard, presetRange, SALES_RANGE_PRESETS, tradeStageLabel, type SalesRangePreset } from "@/lib/sales"
import { formatCompact, formatMoney, relativeTime } from "@/lib/format"
import type { Product, SalesOrder, SpuMapping } from "@/lib/types"
import { cn } from "@/lib/utils"

const STAGE_COLORS: Record<string, string> = {
  completed: "hsl(155 62% 42%)",
  refund_before_ship: "hsl(32 92% 55%)",
  refund_after_receive: "hsl(350 72% 58%)",
  unpaid: "hsl(220 12% 55%)",
  unknown: "hsl(240 6% 60%)",
}

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
          {item.name}：
          <span className="font-medium text-popover-foreground">
            {item.name === "收入" ? formatMoney(Number(item.value)) : item.value}
          </span>
        </p>
      ))}
    </div>
  )
}

export function SalesDashboardPage() {
  const { backend, dataVersion } = useApp()
  const [orders, setOrders] = useState<SalesOrder[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [mappings, setMappings] = useState<SpuMapping[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<SalesRangePreset>("all")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [orderRows, productRows, mappings] = await Promise.all([
        backend.fetchSalesForDashboard(),
        backend.fetchForDashboard(),
        backend.listSpuMappings().catch(() => [] as SpuMapping[]),
      ])
      setOrders(orderRows)
      setProducts(productRows)
      setMappings(mappings)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const range = useMemo(
    () => presetRange(preset, { start: customStart, end: customEnd }),
    [preset, customStart, customEnd],
  )

  /** 按买家支付时间过滤；无支付时间的订单在限定范围时无法归类，先排除并提示 */
  const filteredOrders = useMemo(() => {
    if (!orders) return null
    if (!range) return orders
    return orders.filter((o) => {
      if (!o.paid_at) return false
      const d = o.paid_at.slice(0, 10)
      return d >= range.start && d <= range.end
    })
  }, [orders, range])

  const excludedCount = orders && filteredOrders ? orders.length - filteredOrders.length : 0

  const data = useMemo(
    () =>
      filteredOrders
        ? buildSalesDashboard(filteredOrders, products, mappings, range ?? undefined)
        : null,
    [filteredOrders, products, mappings, range],
  )

  if (loading && !data) return <LoadingBlock label="正在汇总销售数据…" />
  if (error) return <ErrorBlock message={error} onRetry={load} />
  if (!data) return null

  const lostOrders =
    data.unpaidCount + data.refundBeforeShipCount + data.refundAfterReceiveCount
  const lostRate = data.totalOrders ? (lostOrders / data.totalOrders) * 100 : 0
  const settleRate =
    data.settledCount + data.unsettledCount > 0
      ? (data.settledCount / (data.settledCount + data.unsettledCount)) * 100
      : 0
  const maxSpuIncome = Math.max(1, ...data.topSpus.map((s) => s.income))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">销售看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {data.totalOrders} 条订单
            {range
              ? ` · 统计 ${range.start} ~ ${range.end}`
              : data.coverageDays
                ? ` · 覆盖近 ${data.coverageDays} 天`
                : ""}
            {excludedCount > 0 ? ` · 已排除 ${excludedCount} 条范围外/无支付时间` : ""}
            {" · "}购入在京东/拼多多，售出在得物
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
          <Button size="sm" asChild>
            <Link to="/sales/orders">
              <ShoppingBag className="size-4" />
              订单管理
            </Link>
          </Button>
        </div>
      </div>

      {/* 时间筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        {SALES_RANGE_PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? "default" : "outline"}
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
        {preset === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 w-[150px] tabular-nums"
            />
            <span className="text-sm text-muted-foreground">至</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-9 w-[150px] tabular-nums"
            />
            {customStart && customEnd && customStart > customEnd ? (
              <span className="text-xs text-destructive">开始日期晚于结束日期</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="订单总数"
          value={data.totalOrders}
          icon={<ShoppingBag className="size-5" />}
          tone="primary"
          hint={`正常成交 ${data.completedOrders} 条`}
        />
        <StatCard
          label="成交率"
          value={`${data.completedRate.toFixed(1)}%`}
          icon={<BadgeCheck className="size-5" />}
          tone={data.completedRate >= 50 ? "success" : "warning"}
          hint={
            <span className="flex items-center gap-2">
              <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, data.completedRate)}%` }}
                />
              </span>
              {lostOrders} 条未成交
            </span>
          }
        />
        <StatCard
          label="实际收入"
          value={formatCompact(data.totalIncome)}
          icon={<CircleDollarSign className="size-5" />}
          tone="success"
          hint={`仅统计正常成交 · 均单 ${formatMoney(Math.round(data.avgIncome))}`}
        />
        <StatCard
          label="待结算"
          value={formatCompact(data.unsettledIncome)}
          icon={<TrendingUp className="size-5" />}
          tone={data.unsettledIncome > 0 ? "warning" : "default"}
          hint={`已结 ${formatCompact(data.settledIncome)} · ${data.unsettledCount} 条未结`}
        />
      </div>

      {/* 库存影响 */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Boxes className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">订单对库存的影响</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                生效未结算的订单会先<span className="text-amber-600 dark:text-amber-400">锁定</span>1 个可用库存；
                结算成功后锁定释放并真正<span className="text-emerald-600 dark:text-emerald-400">扣减</span>1 个；
                订单没做成则把库存退回可用。
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-5 px-1">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">锁定中</p>
              <p className="text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {data.lockedOrders}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">已核销</p>
              <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {data.consumedOrders}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 交易阶段拆解 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StageCard
          label="买家未付款"
          detail="交易失败，订单未成立"
          count={data.unpaidCount}
          total={data.totalOrders}
          icon={<Ban className="size-4" />}
          tone="neutral"
        />
        <StageCard
          label="发货前退款"
          detail="交易关闭成功，货还没发"
          count={data.refundBeforeShipCount}
          total={data.totalOrders}
          icon={<Undo2 className="size-4" />}
          tone="warning"
        />
        <StageCard
          label="签收后退款"
          detail="交易成功但买家退货，会亏一笔"
          count={data.refundAfterReceiveCount}
          total={data.totalOrders}
          icon={<PackageX className="size-4" />}
          tone="danger"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-primary" />
              {range ? "成交与退款趋势" : "近 30 天成交与退款"}
            </CardTitle>
            <CardDescription>柱状为订单数，折线为当日成交收入</CardDescription>
          </CardHeader>
          <CardContent className="pl-0 pr-3">
            <div className="h-[268px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    {...axisProps}
                    tickFormatter={(v: string) => v.slice(5)}
                    minTickGap={24}
                  />
                  <YAxis yAxisId="left" {...axisProps} allowDecimals={false} width={40} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    {...axisProps}
                    width={52}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <RTooltip content={<ChartTooltip />} />
                  <Bar
                    yAxisId="left"
                    dataKey="completed"
                    name="正常成交"
                    fill="hsl(var(--chart-2))"
                    radius={[4, 4, 0, 0]}
                    barSize={9}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="refunded"
                    name="退款订单"
                    fill="hsl(var(--chart-4))"
                    radius={[4, 4, 0, 0]}
                    barSize={9}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="income"
                    name="收入"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">交易阶段分布</CardTitle>
            <CardDescription>按订单数占比</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[196px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.stages}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={56}
                    outerRadius={82}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.stages.map((s) => (
                      <Cell key={s.stage} fill={STAGE_COLORS[s.stage] ?? STAGE_COLORS.unknown} />
                    ))}
                  </Pie>
                  <RTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-semibold tabular-nums">{data.totalOrders}</p>
                <p className="text-xs text-muted-foreground">订单总数</p>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {data.stages.map((s) => (
                <div key={s.stage} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: STAGE_COLORS[s.stage] ?? STAGE_COLORS.unknown }}
                  />
                  <span className="flex-1 text-muted-foreground">{s.label}</span>
                  <span className="font-medium tabular-nums">{s.count}</span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                    {data.totalOrders ? ((s.count / data.totalOrders) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">SPU 成交排行</CardTitle>
            <CardDescription>
              只统计正常成交的订单；成本取自商品管理里的成本价，未维护成本价的不会显示毛利
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {data.topSpus.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                还没有正常成交的订单，导入后这里会出现排行。
              </p>
            ) : (
              <div className="overflow-x-auto thin-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="min-w-[190px]">SPU</TableHead>
                      <TableHead className="w-[80px]">成交单</TableHead>
                      <TableHead className="w-[110px]">收入</TableHead>
                      <TableHead className="w-[110px]">成本</TableHead>
                      <TableHead className="w-[110px]">毛利</TableHead>
                      <TableHead className="w-[120px]">收入占比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topSpus.map((row) => (
                      <TableRow key={row.sku}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="line-clamp-1 text-sm font-medium">{row.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {row.sku}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{row.orders}</TableCell>
                        <TableCell className="text-sm font-medium tabular-nums">
                          {formatMoney(row.income)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {row.hasCost ? formatMoney(row.cost) : "未维护"}
                        </TableCell>
                        <TableCell>
                          {row.hasCost ? (
                            <span
                              className={cn(
                                "text-sm font-medium tabular-nums",
                                row.profit >= 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-destructive",
                              )}
                            >
                              {formatMoney(row.profit)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={(row.income / maxSpuIncome) * 100}
                              className="h-1.5 flex-1"
                            />
                            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                              {data.totalIncome
                                ? ((row.income / data.totalIncome) * 100).toFixed(0)
                                : 0}
                              %
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">最近成交</CardTitle>
              <CardDescription>按支付时间排列</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/sales/orders">
                全部
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Progress value={settleRate} className="h-1.5 flex-1" />
              <span className="tabular-nums">结算完成 {settleRate.toFixed(0)}%</span>
            </div>
            {data.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">还没有订单</p>
            ) : (
              <ul className="divide-y">
                {data.recent.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {o.order_no}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {o.sku}
                        {o.spec ? ` · ${o.spec}` : ""} · {relativeTime(o.paid_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          o.trade_stage === "completed"
                            ? ""
                            : "text-muted-foreground line-through decoration-muted-foreground/40",
                        )}
                      >
                        {o.expected_income === null ? "—" : formatMoney(o.expected_income)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {tradeStageLabel(o.trade_stage)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">
                有 {lostOrders} 条订单没做成，占 {lostRate.toFixed(1)}%
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                其中买家未付款 {data.unpaidCount} 条、发货前退款 {data.refundBeforeShipCount} 条、
                签收后退款 {data.refundAfterReceiveCount} 条。签收后退款既压了货又付了运费，值得单独盯。
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/sales/orders?stage=refund_after_receive">
                <PackageX className="size-3.5" />
                看签收后退款
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/sales/orders">
                <Plus className="size-3.5" />
                去录订单
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StageCard({
  label,
  detail,
  count,
  total,
  icon,
  tone,
}: {
  label: string
  detail: string
  count: number
  total: number
  icon: ReactNode
  tone: "neutral" | "warning" | "danger"
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    danger: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  }
  const pct = total ? (count / total) * 100 : 0
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            tones[tone],
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{count}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          <div className="mt-2 flex items-center gap-2">
            <Progress value={pct} className="h-1.5 flex-1" />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {pct.toFixed(1)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
