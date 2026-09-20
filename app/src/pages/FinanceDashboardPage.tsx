import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  Landmark,
  PackageSearch,
  RefreshCcw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { buildFinanceSummary, type FinanceSummary } from "@/lib/finance"
import { formatCompact, formatMoney } from "@/lib/format"
import type { OtherExpense, Product, SalesOrder, SpuMapping } from "@/lib/types"
import { cn } from "@/lib/utils"

function Pnl({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value > 0 && "text-emerald-600 dark:text-emerald-400",
        value < 0 && "text-destructive",
        className,
      )}
    >
      {value > 0 ? "+" : ""}
      {formatMoney(value)}
    </span>
  )
}

export function FinanceDashboardPage() {
  const { backend, dataVersion } = useApp()
  const [orders, setOrders] = useState<SalesOrder[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [mappings, setMappings] = useState<SpuMapping[]>([])
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [orderRows, productRows, mappingRows, otherRows] = await Promise.all([
        backend.fetchSalesForDashboard(),
        backend.fetchForDashboard(),
        backend.listSpuMappings().catch(() => [] as SpuMapping[]),
        backend.listOtherExpenses().catch(() => [] as OtherExpense[]),
      ])
      setOrders(orderRows)
      setProducts(productRows)
      setMappings(mappingRows)
      setOtherExpenses(otherRows)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const data: FinanceSummary | null = useMemo(
    () => (orders ? buildFinanceSummary(orders, products, mappings, otherExpenses) : null),
    [orders, products, mappings, otherExpenses],
  )

  if (loading && !data) return <LoadingBlock label="正在汇总财务数据…" />
  if (error) return <ErrorBlock message={error} onRetry={load} />
  if (!data) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="财务看板"
        description="盈亏 = 结算金额 − 成本 − 物流运费 + 补贴 − 其他费用（保证金、仓储费、取回费、会员费等）"
        actions={
          <>
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
          </>
        }
      />

      {/* 口径与提示 */}
      {(data.unmatchedSoldOrders > 0 || data.productsWithoutCost > 0) && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 text-sm">
            {data.unmatchedSoldOrders > 0 ? (
              <p className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {data.unmatchedSoldOrders} 条成交订单没匹配到商品（含对照），成本按 0 计，盈亏会偏高——
                请到<Link to="/sales/orders" className="underline">销售订单</Link>检查 spuID 或
                <Link to="/sales/orders" className="underline">建立 SPU 对照</Link>。
              </p>
            ) : null}
            {data.productsWithoutCost > 0 ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {data.productsWithoutCost} 个商品没填成本价，采购花费与盈亏按 0 估算——
                请到<Link to="/products" className="underline">入仓管理</Link>补填。
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* 核心指标 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="采购总花费"
          value={formatCompact(data.purchaseSpend)}
          icon={<Wallet className="size-5" />}
          tone="primary"
          hint="已卖 + 手里，按成本价估算"
        />
        <StatCard
          label="手里商品"
          value={`${data.onhandUnits} 件`}
          icon={<Boxes className="size-5" />}
          hint={`占用投入 ${formatCompact(data.onhandInvestment)}（成本+运费）`}
        />
        <StatCard
          label="已卖件数"
          value={`${data.soldUnits} 件`}
          icon={<PackageSearch className="size-5" />}
          hint={
            data.soldIncomeFromStatement > 0
              ? `结算金额合计 ${formatCompact(data.soldIncome)}（其中 ${data.soldIncomeFromStatement} 单是对账单实际金额）`
              : `结算金额合计 ${formatCompact(data.soldIncome)}`
          }
        />
        <StatCard
          label="已卖盈亏"
          value={
            <span className={data.soldPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              {data.soldPnl >= 0 ? "+" : ""}
              {formatMoney(data.soldPnl)}
            </span>
          }
          icon={data.soldPnl >= 0 ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
          tone={data.soldPnl >= 0 ? "success" : "danger"}
          hint={`收入 ${formatCompact(data.soldIncome)} − 成本 ${formatCompact(data.soldCost)} − 运费 ${formatCompact(data.soldShipping)} + 补贴 ${formatCompact(data.soldRebate)} − 其他费用 ${formatCompact(data.otherExpenseTotal)}`}
        />
      </div>

      {/* 总盈亏 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                data.totalPnl >= 0
                  ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/12 text-destructive",
              )}
            >
              <Landmark className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">总盈亏（现金口径）</p>
              <p
                className={cn(
                  "text-3xl font-bold tabular-nums",
                  data.totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                )}
              >
                {data.totalPnl >= 0 ? "+" : ""}
                {formatMoney(data.totalPnl)}
              </p>
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground sm:text-right">
            <p>
              已卖盈亏 <Pnl value={data.soldPnl} /> − 手里存货投入{" "}
              <span className="tabular-nums">{formatMoney(data.onhandInvestment)}</span>
            </p>
            <p>
              其他费用 <span className="tabular-nums">{formatMoney(data.otherExpenseTotal)}</span>
              {" · "}
              <Link to="/other-expenses" className="underline">
                去管理
              </Link>
            </p>
            <p className="text-xs">
              手里 {data.onhandUnits} 件的货还在，投入先按支出扣；卖掉后按单件公式回正。
              采购总花费 {formatMoney(data.purchaseSpend)} = 已卖 + 手里的成本合计。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SPU 明细 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CircleDollarSign className="size-4 text-primary" />
            按商品明细
          </CardTitle>
          <CardDescription>只列出有销量或有库存的商品；成本、运费、补贴取自入仓资料</CardDescription>
        </CardHeader>
        <CardContent>
          {data.perSpu.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无数据——导入销售订单或补充入仓商品后，这里会出现明细。
            </p>
          ) : (
            <div className="overflow-x-auto thin-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[200px]">商品</TableHead>
                    <TableHead className="w-[80px] text-right">已卖件</TableHead>
                    <TableHead className="w-[100px] text-right">结算金额</TableHead>
                    <TableHead className="w-[90px] text-right">成本</TableHead>
                    <TableHead className="w-[80px] text-right">运费</TableHead>
                    <TableHead className="w-[80px] text-right">补贴</TableHead>
                    <TableHead className="w-[110px] text-right">已卖盈亏</TableHead>
                    <TableHead className="w-[80px] text-right">手里件</TableHead>
                    <TableHead className="w-[110px] text-right">存货投入</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.perSpu.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell>
                        <p className="line-clamp-1 text-sm font-medium">{row.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{row.sku}</p>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{row.soldUnits}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatMoney(row.soldIncome)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatMoney(row.soldCost)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatMoney(row.soldShipping)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatMoney(row.soldRebate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Pnl value={row.soldPnl} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{row.onhandUnits}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatMoney(row.onhandInvestment)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
