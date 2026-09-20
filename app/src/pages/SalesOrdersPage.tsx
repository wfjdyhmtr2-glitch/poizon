import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DateInput } from "@/components/DateInput"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
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
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  StockEffectBadge,
  TradeStageBadge,
} from "@/components/common"
import { SalesOrderFormDialog } from "@/components/SalesOrderFormDialog"
import { SalesImportDialog } from "@/components/SalesImportDialog"
import { SalesMappingDialog } from "@/components/SalesMappingDialog"
import { useApp } from "@/contexts/AppContext"
import { TRADE_STAGE_META } from "@/lib/constants"
import { PAGE_SIZES, SALES_SORT_OPTIONS, SALES_STAGE_OPTIONS } from "@/lib/constants"
import {
  orderStockEffect,
  presetRange,
  SALES_RANGE_PRESETS,
  type SalesRangePreset,
} from "@/lib/sales"
import { formatDateTime, formatMoney } from "@/lib/format"
import type { Product, SalesOrder, SalesOrderDraft, SalesOrderQuery, SalesSortKey } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function SalesOrdersPage() {
  const { backend, dataVersion, bumpData } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  const [keywordInput, setKeywordInput] = useState("")
  const [query, setQuery] = useState<SalesOrderQuery>({
    keyword: "",
    stage: searchParams.get("stage") ?? "all",
    settled: searchParams.get("settled") ?? "all",
    paidFrom: "",
    paidTo: "",
    sort: (searchParams.get("sort") as SalesSortKey) || "paid_desc",
    page: 1,
    pageSize: 20,
  })
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>("all")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")

  const [rows, setRows] = useState<SalesOrder[]>([])
  const [total, setTotal] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<SalesOrder | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const firstLoad = useRef(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((q) => (q.keyword === keywordInput ? q : { ...q, keyword: keywordInput, page: 1 }))
    }, 320)
    return () => clearTimeout(timer)
  }, [keywordInput])

  /* 时间筛选 → 查询条件（切换时回到第一页） */
  const range = useMemo(
    () => presetRange(rangePreset, { start: customStart, end: customEnd }),
    [rangePreset, customStart, customEnd],
  )
  useEffect(() => {
    setQuery((q) => {
      const from = range?.start ?? ""
      const to = range?.end ?? ""
      return q.paidFrom === from && q.paidTo === to ? q : { ...q, paidFrom: from, paidTo: to, page: 1 }
    })
  }, [range])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, productList] = await Promise.all([
        backend.listSalesOrders(query),
        products.length ? Promise.resolve(null) : backend.fetchForDashboard(),
      ])
      setRows(list.rows)
      setTotal(list.total)
      if (productList) setProducts(productList)
      setSelected((prev) => {
        const ids = new Set(list.rows.map((r) => r.id))
        const next = new Set([...prev].filter((id) => ids.has(id)))
        return next.size === prev.size ? prev : next
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      firstLoad.current = false
    }
  }, [backend, query, products.length])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const productBySku = useMemo(() => new Map(products.map((p) => [p.sku, p])), [products])
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const pageIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function patchQuery(patch: Partial<SalesOrderQuery>) {
    setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }))
    const next = new URLSearchParams(searchParams)
    const keyMap: Record<string, string> = { sort: "sort", stage: "stage", settled: "settled" }
    for (const [field, param] of Object.entries(keyMap)) {
      const value = (patch as Record<string, unknown>)[field]
      if (typeof value === "string") next.set(param, value)
    }
    setSearchParams(next, { replace: true })
  }

  async function handleSave(draft: SalesOrderDraft, id: string | null) {
    if (id) {
      await backend.updateSalesOrder(id, draft)
      toast.success("订单已更新")
    } else {
      await backend.createSalesOrder(draft)
      toast.success("订单已创建")
    }
    bumpData()
    await load()
  }

  async function runBulkSettled(settled: boolean) {
    const ids = [...selected]
    if (!ids.length) return
    setBusy(true)
    try {
      await backend.bulkSetSettled(ids, settled)
      toast.success(`已标记为${settled ? "已结算" : "未结算"}（${ids.length} 条）`)
      setSelected(new Set())
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    const ids = deleteTarget ?? []
    if (!ids.length) return
    setBusy(true)
    try {
      await backend.deleteSalesOrders(ids)
      toast.success(`已删除 ${ids.length} 条订单`)
      setSelected(new Set())
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const activeFilters =
    (query.stage !== "all" ? 1 : 0) +
    (query.settled !== "all" ? 1 : 0) +
    (query.keyword ? 1 : 0) +
    (query.paidFrom || query.paidTo ? 1 : 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">销售订单</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total} 条订单
            {activeFilters ? ` · 已应用 ${activeFilters} 个筛选条件` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/sales">
              <RotateCcw className="size-4" />
              销售看板
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMappingOpen(true)}>
            <Link2 className="size-4" />
            SPU 对照
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            导入订单
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" />
            手动新增
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索订单号、spuID 或规格…"
                className="pl-9"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
              />
              {keywordInput ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setKeywordInput("")}
                  aria-label="清空搜索"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:w-auto lg:grid-cols-3">
              <Select value={query.stage} onValueChange={(v) => patchQuery({ stage: v })}>
                <SelectTrigger className="w-full lg:w-[136px]">
                  <SelectValue placeholder="交易阶段" />
                </SelectTrigger>
                <SelectContent>
                  {SALES_STAGE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={query.settled} onValueChange={(v) => patchQuery({ settled: v })}>
                <SelectTrigger className="w-full lg:w-[124px]">
                  <SelectValue placeholder="结算状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部结算</SelectItem>
                  <SelectItem value="settled">已结算</SelectItem>
                  <SelectItem value="unsettled">未结算</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={query.sort}
                onValueChange={(v) => patchQuery({ sort: v as SalesSortKey })}
              >
                <SelectTrigger className="w-full lg:w-[156px]">
                  <ArrowUpDown className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  {SALES_SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 支付时间筛选 */}
            <div className="flex flex-wrap items-center gap-2">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              {SALES_RANGE_PRESETS.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  size="sm"
                  variant={rangePreset === p.key ? "default" : "outline"}
                  onClick={() => setRangePreset(p.key)}
                >
                  {p.label}
                </Button>
              ))}
              {rangePreset === "custom" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <DateInput
                    value={customStart}
                    onChange={setCustomStart}
                    className="h-9 w-[150px]"
                  />
                  <span className="text-sm text-muted-foreground">至</span>
                  <DateInput
                    value={customEnd}
                    onChange={setCustomEnd}
                    className="h-9 w-[150px]"
                  />
                  {customStart && customEnd && customStart > customEnd ? (
                    <span className="text-xs text-destructive">开始日期晚于结束日期</span>
                  ) : null}
                </div>
              ) : null}
              {range ? (
                <span className="text-xs text-muted-foreground">
                  只看支付时间 {range.start} ~ {range.end} · 无支付时间的订单会被排除
                </span>
              ) : null}
            </div>

            {activeFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setKeywordInput("")
                  setRangePreset("all")
                  setQuery((q) => ({
                    ...q,
                    keyword: "",
                    stage: "all",
                    settled: "all",
                    page: 1,
                  }))
                }}
              >
                <Filter className="size-3.5" />
                清除筛选
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/8 px-3 py-2.5 backdrop-blur">
          <span className="text-sm font-medium">
            已选 <span className="tabular-nums">{selected.size}</span> 条
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runBulkSettled(true)}
            >
              <BadgeCheck className="size-3.5" />
              标记已结算
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runBulkSettled(false)}
            >
              标记未结算
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => setDeleteTarget([...selected])}
            >
              <Trash2 className="size-3.5" />
              批量删除
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Card>
          <ErrorBlock message={error} onRetry={load} />
        </Card>
      ) : loading && !rows.length ? (
        <Card>
          <LoadingBlock label="正在读取销售订单…" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag className="size-5" />}
            title="还没有符合条件的订单"
            description="可以手动新增一条，或者把平台的订单导出成 Excel 再导入。"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="size-4" />
                  导入订单
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="size-4" />
                  手动新增
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto thin-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="全选本页"
                      />
                    </TableHead>
                    <TableHead className="min-w-[170px]">订单号</TableHead>
                    <TableHead className="min-w-[170px]">商品</TableHead>
                    <TableHead className="w-[110px]">规格</TableHead>
                    <TableHead className="w-[120px]">订单状态</TableHead>
                    <TableHead className="w-[122px]">交易阶段</TableHead>
                    <TableHead className="w-[96px]">出价</TableHead>
                    <TableHead className="w-[104px]">预计收入</TableHead>
                    <TableHead className="w-[84px]">结算</TableHead>
                    <TableHead className="w-[140px]">标签</TableHead>
                    <TableHead className="w-[150px]">支付时间</TableHead>
                    <TableHead className="w-[64px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => {
                    const product = productBySku.get(o.sku)
                    const settled = TRADE_STAGE_META[o.trade_stage]?.countsAsIncome
                    const effect = orderStockEffect(o.order_status, o.is_returned, o.is_settled)
                    return (
                      <TableRow key={o.id} className={cn(selected.has(o.id) && "bg-primary/5")}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(o.id)}
                            onCheckedChange={() => toggleOne(o.id)}
                            aria-label={`选择订单 ${o.order_no}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="line-clamp-1 text-sm font-medium">
                              {product?.name ?? o.sku}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {o.sku}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground">
                          {o.spec || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{o.order_status}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <TradeStageBadge stage={o.trade_stage} />
                            {effect === "released" ? null : <StockEffectBadge effect={effect} />}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {o.bid_amount === null ? "—" : formatMoney(o.bid_amount)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "text-sm font-medium tabular-nums",
                              !settled && "text-muted-foreground line-through decoration-muted-foreground/40",
                            )}
                          >
                            {o.expected_income === null ? "—" : formatMoney(o.expected_income)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {o.is_settled ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-normal text-emerald-600 dark:text-emerald-400"
                            >
                              <Wallet className="size-3" />
                              已结算
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-muted-foreground">
                              未结算
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {o.tag ? (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                              {o.tag}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(o.paid_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label="编辑订单"
                              onClick={() => {
                                setEditing(o)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive"
                              aria-label="删除订单"
                              onClick={() => setDeleteTarget([o.id])}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* 移动端卡片 */}
          <div className="grid gap-3 md:hidden">
            {rows.map((o) => {
              const product = productBySku.get(o.sku)
              const counts = TRADE_STAGE_META[o.trade_stage]?.countsAsIncome
              const effect = orderStockEffect(o.order_status, o.is_returned, o.is_settled)
              return (
                <Card key={o.id} className={cn(selected.has(o.id) && "ring-2 ring-primary/40")}>
                  <CardContent className="space-y-3 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {o.order_no}
                        </p>
                        <p className="mt-1 line-clamp-1 text-sm font-medium">
                          {product?.name ?? o.sku}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.sku}
                          {o.spec ? ` · ${o.spec}` : ""}
                        </p>
                      </div>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={() => toggleOne(o.id)}
                        aria-label={`选择订单 ${o.order_no}`}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <TradeStageBadge stage={o.trade_stage} />
                      {effect === "released" ? null : <StockEffectBadge effect={effect} />}
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {o.order_status}
                      </span>
                      {o.after_sales ? (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {o.after_sales}
                        </span>
                      ) : null}
                      {o.tag ? (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {o.tag}
                        </span>
                      ) : null}
                      {o.is_settled ? (
                        <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          已结算
                        </span>
                      ) : (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          未结算
                        </span>
                      )}
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <p
                          className={cn(
                            "text-base font-semibold tabular-nums",
                            !counts && "text-muted-foreground line-through decoration-muted-foreground/40",
                          )}
                        >
                          {o.expected_income === null ? "—" : formatMoney(o.expected_income)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          出价 {o.bid_amount === null ? "—" : formatMoney(o.bid_amount)} ·{" "}
                          {formatDateTime(o.paid_at)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8"
                          aria-label="编辑订单"
                          onClick={() => {
                            setEditing(o)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8 text-destructive"
                          aria-label="删除订单"
                          onClick={() => setDeleteTarget([o.id])}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex flex-col items-center justify-between gap-3 pt-1 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>每页</span>
              <Select
                value={String(query.pageSize)}
                onValueChange={(v) => patchQuery({ pageSize: Number(v) })}
              >
                <SelectTrigger className="h-8 w-[76px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="tabular-nums">
                第 {query.page} / {totalPages} 页
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={query.page <= 1}
                onClick={() => patchQuery({ page: query.page - 1 })}
              >
                <ChevronLeft className="size-4" />
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={query.page >= totalPages}
                onClick={() => patchQuery({ page: query.page + 1 })}
              >
                下一页
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <SalesOrderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        order={editing}
        products={products}
        onSave={handleSave}
      />

      <SalesImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={async (drafts, mode) => {
          const res = await backend.importSalesOrders(drafts, mode)
          bumpData()
          await load()
          return res
        }}
      />

      <SalesMappingDialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        products={products}
        onChanged={() => {
          bumpData()
          void load()
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`确认删除 ${deleteTarget?.length ?? 0} 条订单？`}
        description={
          <div className="space-y-2">
            <p>删除后订单记录会从数据库中移除，看板统计也会同步变化。</p>
            <p className="rounded-lg bg-muted px-2.5 py-2 font-mono text-xs">
              {(deleteTarget ?? [])
                .map((id) => rows.find((r) => r.id === id)?.order_no ?? id)
                .slice(0, 4)
                .join("、")}
              {(deleteTarget?.length ?? 0) > 4 ? ` 等 ${deleteTarget?.length} 条` : ""}
            </p>
          </div>
        }
        confirmText={busy ? "删除中…" : "确认删除"}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
