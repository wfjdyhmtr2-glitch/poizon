import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Boxes, ChevronDown, ChevronRight, Loader2, RefreshCcw } from "lucide-react"
import { useApp } from "@/contexts/AppContext"
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
import { EmptyState, PageHeader } from "@/components/common"
import { formatMoney } from "@/lib/format"
import type { Product, PurchaseOrder, SalesOrder, SpuMapping } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/** 规格归一化：去空白、统一分隔符、小写，便于把订单规格与采购明细对上 */
function normSpec(parts: (string | null | undefined)[]) {
  return parts
    .filter((v) => v && v.trim())
    .join("/")
    .replace(/\s+/g, "")
    .replace(/[／,，、]/g, "/")
    .toLowerCase()
}

interface SpuRow {
  sku: string
  name: string
  purchasedQty: number
  purchasedAmount: number
  soldQty: number
  onhandQty: number
  avgCost: number | null
  currentCost: number | null
}

interface SpecRow {
  label: string
  purchasedQty: number
  soldQty: number
}

export function InventoryPage() {
  const { backend, dataVersion } = useApp()
  const [orders, setOrders] = useState<SalesOrder[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [mappings, setMappings] = useState<SpuMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [orderRows, productRows, poRows, mappingRows] = await Promise.all([
        backend.fetchSalesForDashboard(),
        backend.fetchForDashboard(),
        backend.listPurchaseOrders(),
        backend.listSpuMappings().catch(() => [] as SpuMapping[]),
      ])
      setOrders(orderRows)
      setProducts(productRows)
      setPurchaseOrders(poRows)
      setMappings(mappingRows)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  /** 采购明细按 SPU 聚合 */
  const purchasedBySku = useMemo(() => {
    const map = new Map<string, { qty: number; amount: number; specs: Map<string, number> }>()
    for (const po of purchaseOrders) {
      for (const it of po.items) {
        const entry = map.get(it.sku) ?? { qty: 0, amount: 0, specs: new Map<string, number>() }
        entry.qty += it.quantity
        entry.amount += it.quantity * (it.unit_cost ?? 0)
        const spec = normSpec([it.color, it.size])
        if (spec) entry.specs.set(spec, (entry.specs.get(spec) ?? 0) + it.quantity)
        else entry.specs.set("通用", (entry.specs.get("通用") ?? 0) + it.quantity)
        map.set(it.sku, entry)
      }
    }
    return map
  }, [purchaseOrders])

  /** 已卖件数按 SPU 聚合（正常成交），规格尽力匹配 */
  const soldBySku = useMemo(() => {
    const externalToSku = new Map(mappings.map((m) => [m.external_id, m.sku]))
    const map = new Map<string, { qty: number; specs: Map<string, number> }>()
    for (const o of orders ?? []) {
      if (o.trade_stage !== "completed") continue
      const sku = externalToSku.get(o.sku) ?? o.sku
      const entry = map.get(sku) ?? { qty: 0, specs: new Map<string, number>() }
      entry.qty += 1
      const spec = normSpec([(o.spec ?? "").split("/")[0], (o.spec ?? "").split("/")[1]])
      if (spec) entry.specs.set(spec, (entry.specs.get(spec) ?? 0) + 1)
      map.set(sku, entry)
    }
    return map
  }, [orders, mappings])

  const rows = useMemo<SpuRow[]>(() => {
    return products
      .map((p) => {
        const purchased = purchasedBySku.get(p.sku)
        const sold = soldBySku.get(p.sku)
        return {
          sku: p.sku,
          name: p.name,
          purchasedQty: purchased?.qty ?? 0,
          purchasedAmount: purchased?.amount ?? 0,
          soldQty: sold?.qty ?? 0,
          onhandQty: p.stock + p.locked_stock,
          avgCost: purchased && purchased.qty > 0 ? purchased.amount / purchased.qty : p.cost_price,
          currentCost: p.cost_price,
        }
      })
      .sort((a, b) => b.onhandQty - a.onhandQty || b.purchasedQty - a.purchasedQty)
  }, [products, purchasedBySku, soldBySku])

  /** 展开某个 SPU 时算规格明细：入仓按采购明细聚合，已卖按订单规格尽力匹配 */
  const specRows = useMemo<SpecRow[]>(() => {
    if (!expanded) return []
    const purchased = purchasedBySku.get(expanded)?.specs ?? new Map<string, number>()
    const sold = soldBySku.get(expanded)?.specs ?? new Map<string, number>()
    const labels = new Set([...purchased.keys(), ...sold.keys()])
    return [...labels]
      .map((label) => ({
        label,
        purchasedQty: purchased.get(label) ?? 0,
        soldQty: sold.get(label) ?? 0,
      }))
      .sort((a, b) => b.purchasedQty - a.purchasedQty || b.soldQty - a.soldQty)
  }, [expanded, purchasedBySku, soldBySku])

  return (
    <div className="space-y-4">
      <PageHeader
        title="商品库存"
        description="商品维度的台账：引用入仓单数据，呈现每个商品、每个规格入仓多少件、卖了多少件、手里多少件、成本多少。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {loading && !products.length ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在汇总库存…
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes className="size-5" />}
            title="还没有商品"
            description="先到入仓管理建一张入仓单，或到商品管理添加商品资料。"
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="size-4 text-primary" />
              商品维度台账
            </CardTitle>
            <CardDescription>
              点行首箭头展开规格明细；「已卖」按正常成交订单统计，规格与采购明细的匹配是尽力对齐
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto thin-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8" />
                    <TableHead className="min-w-[220px]">商品</TableHead>
                    <TableHead className="w-[110px] text-right">累计入仓</TableHead>
                    <TableHead className="w-[120px] text-right">入仓金额</TableHead>
                    <TableHead className="w-[110px] text-right">入仓均价</TableHead>
                    <TableHead className="w-[90px] text-right">已卖</TableHead>
                    <TableHead className="w-[100px] text-right">手里件数</TableHead>
                    <TableHead className="w-[110px] text-right">当前成本价</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isOpen = expanded === row.sku
                    return (
                      <Fragment key={row.sku}>
                        <TableRow
                          className={cn("cursor-pointer", isOpen && "bg-muted/50")}
                          onClick={() => setExpanded(isOpen ? null : row.sku)}
                        >
                          <TableCell>
                            {isOpen ? (
                              <ChevronDown className="size-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="line-clamp-1 text-sm font-medium">{row.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{row.sku}</p>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {row.purchasedQty || "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {row.purchasedQty ? formatMoney(row.purchasedAmount) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {row.avgCost !== null ? formatMoney(row.avgCost) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {row.soldQty || "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums">
                            {row.onhandQty}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {row.currentCost !== null ? formatMoney(row.currentCost) : "—"}
                          </TableCell>
                        </TableRow>
                        {isOpen ? (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={7}>
                              {specRows.length === 0 ? (
                                <p className="py-2 text-xs text-muted-foreground">
                                  没有规格级数据——采购单明细里没填颜色/尺码，订单也没有规格。
                                </p>
                              ) : (
                                <div className="space-y-1 py-1">
                                  <p className="text-xs font-medium text-muted-foreground">
                                    规格明细（{row.sku}）
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {specRows.map((s) => (
                                      <span
                                        key={s.label}
                                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                                      >
                                        <span className="font-medium">{s.label}</span>
                                        <span className="ml-1.5 text-muted-foreground">
                                          入仓 {s.purchasedQty || "—"}
                                        </span>
                                        {s.soldQty ? (
                                          <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                                            已卖 {s.soldQty}
                                          </span>
                                        ) : null}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
