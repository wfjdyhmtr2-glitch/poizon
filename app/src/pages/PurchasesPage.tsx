import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react"
import { useApp } from "@/contexts/AppContext"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DateInput } from "@/components/DateInput"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState, PageHeader } from "@/components/common"
import { PurchaseImportDialog } from "@/components/PurchaseImportDialog"
import { presetRange, SALES_RANGE_PRESETS, type SalesRangePreset } from "@/lib/sales"
import { PURCHASE_PLATFORMS } from "@/lib/constants"
import { formatMoney } from "@/lib/format"
import type { PurchaseOrder, SpuInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface DraftItem {
  key: string
  sku: string
  name: string
  price: number | null
  color: string
  size: string
  quantity: number
  unit_cost: number | null
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** 入仓管理：按采购订单维度管理，一单买了哪些款、多少件、什么价 */
export function PurchasesPage() {
  const { backend, bumpData, dataVersion } = useApp()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [rangePreset, setRangePreset] = useState<SalesRangePreset>("all")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [spuInfos, setSpuInfos] = useState<SpuInfo[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [orderNo, setOrderNo] = useState("")
  const [platform, setPlatform] = useState("")
  const [purchasedAt, setPurchasedAt] = useState(todayStr())
  const [shippingFee, setShippingFee] = useState("")
  const [remark, setRemark] = useState("")
  const [items, setItems] = useState<DraftItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [poRows, infoRows] = await Promise.all([
        backend.listPurchaseOrders(),
        backend.listSpuInfo().catch(() => [] as SpuInfo[]),
      ])
      setOrders(poRows)
      setSpuInfos(infoRows)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const range = useMemo(
    () => presetRange(rangePreset, { start: customStart, end: customEnd }),
    [rangePreset, customStart, customEnd],
  )

  const infoBySku = useMemo(() => new Map(spuInfos.map((r) => [r.sku, r])), [spuInfos])

  /** 输入 SPUID 时自动带出商品信息里登记的名称 */
  function patchSku(key: string, sku: string) {
    const info = infoBySku.get(sku.trim())
    patchItem(key, info ? { sku, name: info.name } : { sku })
  }

  const visibleOrders = useMemo(() => {
    if (!range) return orders
    return orders.filter((o) => {
      const d = (o.purchased_at ?? "").slice(0, 10)
      if (!d) return false
      return d >= range.start && d <= range.end
    })
  }, [orders, range])


  function resetDraft() {
    const d = new Date()
    const seq = String(orders.length + 1).padStart(3, "0")
    setOrderNo(`WH-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${seq}`)
    setPlatform("")
    setPurchasedAt(todayStr())
    setShippingFee("")
    setRemark("")
    setItems([
      { key: crypto.randomUUID(), sku: "", name: "", price: null, color: "", size: "", quantity: 1, unit_cost: null },
    ])
  }

  function openCreate() {
    resetDraft()
    setDialogOpen(true)
  }

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  const totalQty = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0)
  const totalAmount = items.reduce((acc, it) => acc + (it.price ?? 0), 0)

  async function handleSave() {
    if (!orderNo.trim()) {
      toast.error("请填写入仓单号")
      return
    }
    const validItems = items.filter((it) => it.sku.trim() && it.quantity > 0)
    if (!validItems.length) {
      toast.error("请至少添加一行有效的采购明细（选款、数量大于 0）")
      return
    }
    setSaving(true)
    try {
      await backend.createPurchaseOrder({
        order_no: orderNo.trim(),
        platform: platform || null,
        purchased_at: purchasedAt || null,
        shipping_fee: shippingFee === "" ? null : Number(shippingFee),
        remark: remark || null,
        items: validItems.map((it) => {
          const quantity = Number(it.quantity)
          // 进货单价自动 = 进货总价 / 数量
          const unitCost =
            it.price !== null && quantity > 0 ? Number((it.price / quantity).toFixed(2)) : null
          return {
            sku: it.sku.trim(),
            name: it.name.trim() || null,
            price: it.price,
            color: it.color.trim(),
            size: it.size.trim(),
            quantity,
            unit_cost: unitCost,
          }
        }),
      })
      toast.success(`入仓单已确认，${totalQty} 件已加入库存`)
      setDialogOpen(false)
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("删除入仓单会把对应数量从商品库存回退（成本价保持不变），确定删除？")) return
    setDeletingId(id)
    try {
      await backend.deletePurchaseOrders([id])
      toast.success("入仓单已删除，库存已回退")
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="入仓管理"
        description="按采购订单维度管理：一张入仓单记录这次买了哪些款、什么规格、多少件、什么价；确认后自动加进商品库存并按加权平均更新成本。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="size-4" />
              批量导入
            </Button>
            <Button size="sm" onClick={openCreate}>
              <PackagePlus className="size-4" />
              新建入仓单
            </Button>
          </>
        }
      />

      {/* 按采购日期筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {SALES_RANGE_PRESETS.map((p) => (
          <Button
            key={p.key}
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
          </div>
        ) : null}
        {range ? (
          <span className="text-xs text-muted-foreground">
            只看采购日期 {range.start} ~ {range.end} · 没填日期的单不在此范围
          </span>
        ) : null}
      </div>

      {loading && !orders.length ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载入仓单…
          </div>
        </Card>
      ) : orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="还没有入仓单"
            description="点「新建入仓单」记录一次采购；也可以「批量导入」把各平台的采购表一次性导进来（支持只补成本、不动库存）。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet className="size-4" />
                  批量导入
                </Button>
                <Button size="sm" onClick={openCreate}>
                  <Plus className="size-4" />
                  新建入仓单
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto thin-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[150px]">入仓单号</TableHead>
                  <TableHead className="w-[100px]">购入平台</TableHead>
                  <TableHead className="w-[110px]">采购日期</TableHead>
                  <TableHead className="min-w-[240px]">明细</TableHead>
                  <TableHead className="w-[80px] text-right">总件数</TableHead>
                  <TableHead className="w-[110px] text-right">总金额</TableHead>
                  <TableHead className="w-[90px] text-right">运费</TableHead>
                  <TableHead className="w-[70px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders.map((po) => {
                  const qty = po.items.reduce((acc, it) => acc + it.quantity, 0)
                  const amount = po.items.reduce(
                    (acc, it) => acc + it.quantity * (it.unit_cost ?? 0),
                    0,
                  )
                  return (
                    <TableRow key={po.id}>
                      <TableCell>
                        <p className="font-mono text-xs font-medium">{po.order_no}</p>
                        {po.count_stock === false ? (
                          <p className="mt-0.5">
                            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              仅成本·不计库存
                            </span>
                          </p>
                        ) : null}
                        {po.remark ? (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                            {po.remark}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {po.platform || "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {po.purchased_at || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {po.items.map((it) => (
                            <span
                              key={it.id}
                              className="rounded border border-border px-1.5 py-0.5 text-[11px]"
                            >
                              {it.name ? <span className="font-medium">{it.name} </span> : null}
                              <span className="font-mono">{it.sku}</span>
                              {it.color || it.size ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  {it.color}
                                  {it.size ? `/${it.size}` : ""}
                                </span>
                              ) : null}
                              <span className="font-medium"> ×{it.quantity}</span>
                              {it.unit_cost !== null ? (
                                <span className="text-muted-foreground"> @{formatMoney(it.unit_cost)}</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
                        {qty}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatMoney(amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {po.shipping_fee === null ? "—" : formatMoney(po.shipping_fee)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          disabled={deletingId === po.id}
                          onClick={() => void handleDelete(po.id)}
                          aria-label="删除入仓单"
                        >
                          {deletingId === po.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <PurchaseImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spuInfos={spuInfos}
        onDone={load}
      />

      {/* 新建入仓单 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>新建入仓单</DialogTitle>
            <DialogDescription>
              一张单记录一次采购。新款会自动建档，老款自动加库存并按加权平均更新成本价；明细里的颜色/尺码是商品规格的二级单元。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>入仓单号</Label>
              <Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>购入平台</Label>
              <Input
                value={platform}
                list="po-platform-options"
                placeholder="京东 / 拼多多…"
                onChange={(e) => setPlatform(e.target.value)}
              />
              <datalist id="po-platform-options">
                {PURCHASE_PLATFORMS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>采购日期</Label>
              <DateInput value={purchasedAt} onChange={setPurchasedAt} />
            </div>
            <div className="space-y-1.5">
              <Label>运费（元）</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={shippingFee}
                placeholder="本单快递费"
                onChange={(e) => setShippingFee(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>采购明细</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    { key: crypto.randomUUID(), sku: "", name: "", price: null, color: "", size: "", quantity: 1, unit_cost: null },
                  ])
                }
              >
                <Plus className="size-3.5" />
                加一行
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto thin-scrollbar pr-1">
              <datalist id="po-sku-suggestions">
                {spuInfos.map((r) => (
                  <option key={r.sku} value={r.sku}>
                    {r.name}
                  </option>
                ))}
              </datalist>
              {items.map((it) => (
                <div key={it.key} className="rounded-lg border p-2.5">
                  <div className="grid grid-cols-[130px_1fr_92px_92px] items-center gap-2">
                    <Input
                      value={it.sku}
                      placeholder="SPUID"
                      className="h-9 font-mono"
                      list="po-sku-suggestions"
                      onChange={(e) => patchSku(it.key, e.target.value)}
                    />
                    <Input
                      value={it.name}
                      placeholder="商品名称（已登记的 SPUID 自动带出）"
                      className="h-9"
                      onChange={(e) => patchItem(it.key, { name: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={it.price ?? ""}
                      placeholder="进货总价"
                      className="h-9 tabular-nums"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) =>
                        patchItem(it.key, {
                          price: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 justify-self-end text-muted-foreground hover:text-destructive"
                      onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                      disabled={items.length <= 1}
                      aria-label="删除该行"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr_88px_100px] items-center gap-2">
                    <Input
                      value={it.color}
                      placeholder="颜色（如 白色）"
                      className="h-9"
                      onChange={(e) => patchItem(it.key, { color: e.target.value })}
                    />
                    <Input
                      value={it.size}
                      placeholder="尺码（如 M / 46）"
                      className="h-9"
                      onChange={(e) => patchItem(it.key, { size: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={1}
                      step="1"
                      value={it.quantity}
                      placeholder="数量"
                      className="h-9 tabular-nums"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => patchItem(it.key, { quantity: Number(e.target.value) })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={
                        it.price !== null && it.quantity > 0
                          ? (it.price / it.quantity).toFixed(2)
                          : ""
                      }
                      placeholder="自动计算"
                      readOnly
                      disabled
                      title="进货单价 = 进货总价 ÷ 数量，自动计算"
                      className="h-9 cursor-not-allowed tabular-nums opacity-60"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span>
                总件数 <span className="font-semibold tabular-nums">{totalQty}</span>
              </span>
              <span>
                总金额{" "}
                <span className="font-semibold tabular-nums">{formatMoney(totalAmount)}</span>
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input
              value={remark}
              placeholder="供货商、发货时效等"
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              确认入仓
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
