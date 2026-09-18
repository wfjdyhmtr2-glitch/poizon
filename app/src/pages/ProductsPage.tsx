import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, RefreshCcw, Search, Trash2 } from "lucide-react"
import { useApp } from "@/contexts/AppContext"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { EmptyState, PageHeader } from "@/components/common"
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
import { DELETE_PASSWORD } from "@/lib/constants"
import { firstMatchedImage } from "@/lib/images"
import { formatMoney } from "@/lib/format"
import type { Product, ProductImage, PurchaseOrder, SalesOrder, SpuInfo, SpuMapping } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 待确认的删除操作 */
type PendingDelete = {
  type: "spu" | "spec" | "batch"
  label: string
  productIds: string[]
  spec?: { sku: string; color: string; size: string }
}

/** 规格归一化：去空白、统一分隔符、小写，便于把订单规格与采购明细对上 */
function normSpec(color: string | null | undefined, size: string | null | undefined) {
  return [color, size]
    .filter((v) => v && v.trim())
    .join("/")
    .replace(/\s+/g, "")
    .replace(/[／,，、]/g, "/")
    .toLowerCase()
}

interface SpecRow {
  label: string
  purchasedQty: number
  avgCost: number | null
  soldQty: number
  onhandQty: number | null
}

interface SpuBlock {
  product: Product
  purchasedQty: number
  purchasedAmount: number
  soldQty: number
  specs: SpecRow[]
}

/**
 * 商品管理（只读台账）：
 * 商品数据全部由入仓单生成，这里按「SPUID 一级 → 颜色/尺码规格 二级」呈现，
 * 不提供编辑入口；要改数据去入仓管理调整入仓单。
 */
export function ProductsPage() {
  const { backend, dataVersion, bumpData, isAdmin } = useApp()
  /** 删除是管理员专属：普通成员只能查看与录入，删除入口直接不渲染 */
  const canDelete = isAdmin
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [mappings, setMappings] = useState<SpuMapping[]>([])
  const [images, setImages] = useState<ProductImage[]>([])
  const [spuInfos, setSpuInfos] = useState<SpuInfo[]>([])
  const spuInfoBySku = useMemo(() => new Map(spuInfos.map((r) => [r.sku, r])), [spuInfos])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keywordInput, setKeywordInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [password, setPassword] = useState("")
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [productRows, orderRows, poRows, mappingRows, imageRows, spuInfoRows] = await Promise.all([
        backend.fetchForDashboard(),
        backend.fetchSalesForDashboard(),
        backend.listPurchaseOrders(),
        backend.listSpuMappings().catch(() => [] as SpuMapping[]),
        backend.listProductImages().catch(() => [] as ProductImage[]),
        backend.listSpuInfo().catch(() => [] as SpuInfo[]),
      ])
      setProducts(productRows)
      setOrders(orderRows)
      setPurchaseOrders(poRows)
      setMappings(mappingRows)
      setImages(imageRows)
      setSpuInfos(spuInfoRows)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  /* 搜索防抖 */
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim().toLowerCase()), 300)
    return () => clearTimeout(timer)
  }, [keywordInput])

  const externalToSku = useMemo(
    () => new Map(mappings.map((m) => [m.external_id, m.sku])),
    [mappings],
  )

  /** 采购明细聚合：SPU 总量 + 规格明细（含各规格入仓均价） */
  const purchasedBySku = useMemo(() => {
    const map = new Map<string, { qty: number; amount: number; specs: Map<string, { qty: number; cost: number; label: string }> }>()
    for (const po of purchaseOrders) {
      for (const it of po.items) {
        const sku = externalToSku.get(it.sku) ?? it.sku
        const entry = map.get(sku) ?? {
          qty: 0,
          amount: 0,
          specs: new Map<string, { qty: number; cost: number; label: string }>(),
        }
        entry.qty += it.quantity
        entry.amount += it.quantity * (it.unit_cost ?? 0)
        const rawLabel = [it.color, it.size]
          .filter((v) => v && v.trim())
          .join(" ")
        const key =
          normSpec(it.color, it.size) ||
          normSpec(it.color, null) ||
          normSpec(null, it.size) ||
          "通用"
        const spec = entry.specs.get(key) ?? { qty: 0, cost: 0, label: rawLabel || "通用" }
        spec.qty += it.quantity
        spec.cost += it.quantity * (it.unit_cost ?? 0)
        entry.specs.set(key, spec)
        map.set(sku, entry)
      }
    }
    return map
  }, [purchaseOrders, externalToSku])

  /** 已卖聚合（正常成交），规格尽力匹配 */
  const soldBySku = useMemo(() => {
    const map = new Map<string, { qty: number; specs: Map<string, number> }>()
    for (const o of orders) {
      if (o.trade_stage !== "completed") continue
      const sku = externalToSku.get(o.sku) ?? o.sku
      const entry = map.get(sku) ?? { qty: 0, specs: new Map<string, number>() }
      entry.qty += 1
      const raw = (o.spec ?? "").split(/[/／,，、]/)
      const spec = normSpec(raw[0], raw[1])
      if (spec) entry.specs.set(spec, (entry.specs.get(spec) ?? 0) + 1)
      map.set(sku, entry)
    }
    return map
  }, [orders, externalToSku])

  const blocks = useMemo<SpuBlock[]>(() => {
    const kw = keyword
    return products
      .filter((p) => {
        if (!kw) return true
        return `${p.name} ${p.sku} ${p.brand ?? ""} ${p.purchase_platform ?? ""}`
          .toLowerCase()
          .includes(kw)
      })
      .map((p) => {
        const purchased = purchasedBySku.get(p.sku)
        const sold = soldBySku.get(p.sku)
        const specs: SpecRow[] = []
        if (purchased) {
          for (const [key, s] of purchased.specs) {
            const soldQty = sold?.specs.get(key) ?? 0
            specs.push({
              label: s.label,
              purchasedQty: s.qty,
              avgCost: s.qty > 0 ? s.cost / s.qty : null,
              soldQty,
              onhandQty: s.qty - soldQty,
            })
          }
        }
        specs.sort((a, b) => b.purchasedQty - a.purchasedQty || a.label.localeCompare(b.label))
        return {
          product: p,
          purchasedQty: purchased?.qty ?? 0,
          purchasedAmount: purchased?.amount ?? 0,
          soldQty: sold?.qty ?? 0,
          specs,
        }
      })
      .sort((a, b) => b.product.stock + b.product.locked_stock - (a.product.stock + a.product.locked_stock))
  }, [products, purchasedBySku, soldBySku, keyword])

  function openDelete(p: PendingDelete) {
    if (!canDelete) {
      toast.error("仅管理员可删除商品")
      return
    }
    const pending = p;
    setPending(pending)
    setPassword("")
  }

  async function confirmDelete() {
    if (!pending) return
    if (password !== DELETE_PASSWORD) {
      toast.error("删除密码不正确")
      return
    }
    setDeleting(true)
    try {
      if (pending.type === "spec" && pending.spec) {
        const { removedQty } = await backend.deletePurchaseOrderSpec(
          pending.spec.sku,
          pending.spec.color,
          pending.spec.size,
        )
        toast.success(`规格已删除，回退库存 ${removedQty} 件`)
      } else {
        await backend.deleteProducts(pending.productIds)
        setSelected((prev) => {
          const next = new Set(prev)
          for (const id of pending.productIds) next.delete(id)
          return next
        })
        toast.success(
          pending.type === "batch"
            ? `已删除 ${pending.productIds.length} 个商品`
            : "商品已删除",
        )
      }
      setPending(null)
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  function toggle(sku: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="商品管理"
        description="商品数据全部由入仓单生成，这里只做呈现：SPUID 为一级单元，其下的颜色/尺码规格为二级单元。要调整数据请到入仓管理。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {/* 搜索 */}
      <Card className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索商品名称、SPUID、平台…"
            className="pl-9"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
        </div>
      </Card>

      {selected.size > 0 ? (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 backdrop-blur">
          <span className="text-sm font-medium">
            已选 <span className="tabular-nums">{selected.size}</span> 个商品
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                openDelete({
                  type: "batch",
                  label: `选中的 ${selected.size} 个商品`,
                  productIds: [...selected],
                })
              }
            >
              <Trash2 className="size-3.5" />
              批量删除
            </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Card>
          <div className="p-6 text-sm text-destructive">{error}</div>
        </Card>
      ) : loading && !products.length ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载商品…
          </div>
        </Card>
      ) : blocks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Loader2 className="size-5 opacity-40" />}
            title="还没有商品"
            description="到「入仓管理」新建入仓单，新款会自动建档；这里会按 SPUID 和规格呈现台账。"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {blocks.map((block) => {
            const p = block.product
            const onhand = p.stock + p.locked_stock
            const isOpen = expanded.has(p.sku)
            const specs = block.specs
            return (
              <Card key={p.id} className="overflow-hidden">
                {/* 一级单元：SPUID */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(p.id)) next.delete(p.id)
                        else next.add(p.id)
                        return next
                      })
                    }
                    aria-label={`选择 ${p.name}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={() => toggle(p.sku)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-label={isOpen ? "收起规格" : "展开规格"}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <ProductImageThumb
                      sku={p.sku}
                      images={images}
                      fallbackUrl={spuInfoBySku.get(p.sku)?.image_url}
                      name={p.name}
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-medium">{p.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>货号：{p.sku}</span>
                        {p.purchase_platform ? <span>· {p.purchase_platform}</span> : null}
                        {p.locked_stock > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">锁 {p.locked_stock}</span>
                        ) : null}
                      </p>
                    </div>
                  </button>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
                    <div>
                      <p className="text-[11px] text-muted-foreground">售价</p>
                      <p className="font-medium tabular-nums">{formatMoney(p.price)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">成本价</p>
                      <p className="tabular-nums">
                        {p.cost_price === null ? "—" : formatMoney(p.cost_price)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">手里件数</p>
                      <p
                        className={cn(
                          "font-medium tabular-nums",
                          p.stock < 0 && "text-destructive",
                        )}
                      >
                        {p.stock < 0 ? `超卖 ${Math.abs(p.stock)}` : onhand}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">已卖</p>
                      <p className="tabular-nums">{block.soldQty || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">累计入仓</p>
                      <p className="tabular-nums">{block.purchasedQty || "—"}</p>
                    </div>
                  </div>
                  {canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      openDelete({
                        type: "spu",
                        label: `商品「${p.name}」（${p.sku}）`,
                        productIds: [p.id],
                      })
                    }
                    aria-label="删除商品"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  ) : null}
                </div>

                {/* 二级单元：颜色/尺码规格 */}
                {isOpen ? (
                  <div className="border-t bg-muted/30">
                    {specs.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-muted-foreground sm:pl-14">
                        暂无规格数据——入仓单明细里填了颜色/尺码后，这里会按规格列出。
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {specs.map((spec) => (
                          <li
                            key={spec.label}
                            className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 sm:pl-14"
                          >
                            <div className="min-w-[140px] flex-1">
                              <p className="text-sm font-medium">{spec.label}</p>
                              <p className="text-[11px] text-muted-foreground">
                                SPUID：{p.sku}
                                {spec.avgCost !== null
                                  ? ` · 入仓均价 ${formatMoney(spec.avgCost)}`
                                  : ""}
                              </p>
                            </div>
                            <div className="flex gap-x-6 text-sm tabular-nums">
                              <span className="text-muted-foreground">
                                入仓 <span className="text-foreground">{spec.purchasedQty}</span>
                              </span>
                              <span className="text-muted-foreground">
                                已卖{" "}
                                <span className={spec.soldQty ? "text-foreground" : ""}>
                                  {spec.soldQty || "—"}
                                </span>
                              </span>
                              <span className="text-muted-foreground">
                                手里{" "}
                                <span
                                  className={cn(
                                    "font-medium",
                                    spec.onhandQty !== null && spec.onhandQty <= 0 && "text-destructive",
                                  )}
                                >
                                  {spec.onhandQty !== null ? spec.onhandQty : "—"}
                                </span>
                              </span>
                            </div>
                            {canDelete ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                openDelete({
                                  type: "spec",
                                  label: `规格「${spec.label}」（${p.sku}）`,
                                  productIds: [],
                                  spec: {
                                    sku: p.sku,
                                    color: spec.label.split(" ")[0] ?? "",
                                    size: spec.label.split(" ").slice(1).join(" "),
                                  },
                                })
                              }
                              aria-label="删除规格"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      {/* 删除确认（需要密码） */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              即将删除 {pending?.label}
              {pending?.type === "spec"
                ? "，该规格的采购明细会一并清除，对应数量从库存回退。"
                : "，商品档案将从数据库移除（入仓单历史保留）。"}
              此操作需要输入删除密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-password">删除密码</Label>
            <Input
              id="delete-password"
              type="password"
              value={password}
              placeholder="输入删除密码"
              onKeyDown={(e) => e.key === "Enter" && void confirmDelete()}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProductImageThumb({
  sku,
  images,
  fallbackUrl,
  name,
}: {
  sku: string
  images: ProductImage[]
  /** 商品信息里登记的 SPU 主图：没有颜色图时兜底 */
  fallbackUrl?: string
  name: string
}) {
  const url = firstMatchedImage(images, sku)?.url ?? fallbackUrl
  return url ? (
    <img
      src={url}
      alt={name}
      loading="lazy"
      className="size-11 shrink-0 rounded-lg bg-muted object-cover"
    />
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
      无图
    </span>
  )
}
