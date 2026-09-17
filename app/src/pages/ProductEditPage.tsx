import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  ImageIcon,
  Info,
  Loader2,
  Ruler,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ErrorBlock, LoadingBlock, StatusBadge } from "@/components/common"
import { TagPicker } from "@/components/TagPicker"
import { useApp } from "@/contexts/AppContext"
import {
  CATEGORIES,
  COLORS,
  PURCHASE_PLATFORMS,
  SEASONS,
  SIZE_PRESETS,
  STATUS_OPTIONS,
} from "@/lib/constants"
import { emptyDraft, formatMoney, netProfit, placeholderImage } from "@/lib/format"
import { orderStockEffect } from "@/lib/sales"
import type { ProductDraft, ProductImage, ProductStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 规格占用明细的一行 */
interface SpecStat {
  spec: string
  locked: number
  sold: number
  refunded: number
}
import { toast } from "sonner"

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === "new"
  const navigate = useNavigate()
  const { backend, bumpData, dataVersion } = useApp()

  const [draft, setDraft] = useState<ProductDraft>(() =>
    isNew ? { ...emptyDraft(), sku: generateSku("SP") } : emptyDraft(),
  )
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoSku, setAutoSku] = useState(isNew)
  /** 被未结算订单锁定的数量，只读展示 */
  const [lockedStock, setLockedStock] = useState(0)
  /** 按规格聚合的占用明细（锁定中 / 已成交 / 签收后退款），null 表示无数据 */
  const [specStats, setSpecStats] = useState<SpecStat[] | null>(null)
  /** 图片库中匹配到该 SPUID 的图 */
  const [matchedImages, setMatchedImages] = useState<ProductImage[]>([])
  /** 商品信息里登记的 SPU 主图（无颜色图时兜底） */
  const [registeredImageUrl, setRegisteredImageUrl] = useState("")

  const load = useCallback(async () => {
    if (isNew) {
      setDraft({ ...emptyDraft(), sku: generateSku("SP") })
      setLockedStock(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const product = await backend.getProduct(id!)
      if (!product) {
        setLoadError("商品不存在，可能已被删除")
      } else {
        // locked_stock 由订单触发器维护，表单不参与提交
        const { id: _id, created_at: _c, updated_at: _u, locked_stock, ...rest } = product
        setDraft(rest)
        setLockedStock(locked_stock)
      }
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend, id, isNew])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  /* 图片库匹配：按 SPUID 拉取该商品名下的全部图（含各颜色） */
  useEffect(() => {
    if (isNew || !draft.sku.trim()) {
      setMatchedImages([])
      return
    }
    let alive = true
    backend
      .listProductImages({ sku: draft.sku.trim() })
      .then((rows) => alive && setMatchedImages(rows))
      .catch(() => alive && setMatchedImages([]))
    backend
      .listSpuInfo()
      .then((rows) => alive && setRegisteredImageUrl(rows.find((r) => r.sku === draft.sku.trim())?.image_url ?? ""))
      .catch(() => alive && setRegisteredImageUrl(""))
    return () => {
      alive = false
    }
  }, [backend, isNew, draft.sku, dataVersion])

  /* 规格占用明细：按该商品名下订单的「规格」列聚合 */
  useEffect(() => {
    if (isNew || !draft.sku.trim()) {
      setSpecStats(null)
      return
    }
    let alive = true
    void backend
      .listSalesOrdersBySku(draft.sku.trim())
      .then((orders) => {
        if (!alive) return
        const map = new Map<string, SpecStat>()
        for (const o of orders) {
          const spec = (o.spec ?? "").trim()
          if (!spec) continue
          const stat = map.get(spec) ?? { spec, locked: 0, sold: 0, refunded: 0 }
          const effect = orderStockEffect(o.order_status, o.is_returned, o.is_settled)
          if (effect === "locked") stat.locked += 1
          else if (effect === "consumed") stat.sold += 1
          else if (o.trade_stage === "refund_after_receive") stat.refunded += 1
          map.set(spec, stat)
        }
        setSpecStats(
          [...map.values()].sort((a, b) => b.locked - a.locked || b.sold - a.sold),
        )
      })
      .catch(() => {
        if (alive) setSpecStats(null)
      })
    return () => {
      alive = false
    }
  }, [backend, isNew, draft.sku, dataVersion])

  /* 离开前提醒 */
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  function patch(next: Partial<ProductDraft>) {
    setDraft((prev) => {
      const merged = { ...prev, ...next }
      if (autoSku && isNew && next.category && !next.sku?.trim()) {
        merged.sku = generateSku(next.category)
      }
      return merged
    })
    setDirty(true)
  }

  const profit = useMemo(
    () =>
      netProfit({
        price: draft.price,
        net_price: draft.net_price,
        platform_fee: draft.platform_fee,
        cost_price: draft.cost_price,
        rebate: draft.rebate,
      }),
    [draft.price, draft.net_price, draft.platform_fee, draft.cost_price, draft.rebate],
  )

  const gross = useMemo(() => {
    if (draft.cost_price === null || draft.cost_price === undefined) return null
    const value = draft.price - draft.cost_price
    return { value, rate: draft.price > 0 ? (value / draft.price) * 100 : 0 }
  }, [draft.cost_price, draft.price])

  function validate() {
    const next: Record<string, string> = {}
    if (!draft.name.trim()) next.name = "请填写商品名称"
    if (!draft.sku.trim()) next.sku = "请填写 SPUID"
    if (draft.price < 0) next.price = "售价不能为负数"
    if (draft.stock_alert < 0) next.stock_alert = "预警值不能为负数"
    setErrors(next)
    return next
  }

  async function save(continueNext = false) {
    const problems = validate()
    const firstProblem = Object.values(problems)[0]
    if (firstProblem) {
      toast.error(`请先修正：${firstProblem}`)
      return
    }
    setSaving(true)
    try {
      const payload: ProductDraft = {
        ...draft,
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        cover_url: draft.cover_url ?? draft.images[0] ?? null,
      }
      if (isNew || !id) {
        const created = await backend.createProduct(payload)
        toast.success("商品已创建")
        bumpData()
        setDirty(false)
        if (continueNext) {
          setDraft({ ...emptyDraft(), sku: generateSku("SP") })
          setAutoSku(true)
          window.scrollTo({ top: 0, behavior: "smooth" })
        } else {
          navigate(`/products/${created.id}`, { replace: true })
        }
      } else {
        await backend.updateProduct(id, payload)
        toast.success("修改已保存")
        bumpData()
        setDirty(false)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingBlock label="正在读取商品信息…" />
  if (loadError) return <ErrorBlock message={loadError} onRetry={load} />

  const cover =
    matchedImages[0]?.url || registeredImageUrl || draft.cover_url || draft.images[0] || placeholderImage(draft.name || "新品", 3)

  return (
    <div className="space-y-4 pb-24 lg:pb-6">
      {/* 顶部操作栏 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/products")} aria-label="返回">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {isNew ? "新增商品" : draft.name || "编辑商品"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {isNew ? "填写商品资料后保存即可上架" : `SKU ${draft.sku}`}
            </p>
          </div>
        </div>
        <div className="hidden gap-2 lg:flex">
          <Button variant="outline" onClick={() => navigate("/products")}>
            取消
          </Button>
          {isNew ? (
            <Button variant="outline" disabled={saving} onClick={() => void save(true)}>
              保存并继续新增
            </Button>
          ) : null}
          <Button disabled={saving} onClick={() => void save(false)}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isNew ? "创建商品" : "保存修改"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* 基础信息 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4 text-primary" />
                基础信息
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">
                  商品名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={draft.name}
                  placeholder="例如：法式泡泡袖雪纺衬衫"
                  onChange={(e) => patch({ name: e.target.value })}
                  className={cn(errors.name && "border-destructive")}
                />
                {errors.name ? (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="size-3" />
                    {errors.name}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="sku">
                  SPUID <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="sku"
                    value={draft.sku}
                    placeholder="SH-2001"
                    onChange={(e) => {
                      setAutoSku(false)
                      patch({ sku: e.target.value })
                    }}
                    className={cn("font-mono text-sm", errors.sku && "border-destructive")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="自动生成"
                    onClick={() => {
                      setAutoSku(true)
                      patch({ sku: generateSku(draft.category || "SP") })
                    }}
                  >
                    <Wand2 className="size-4" />
                  </Button>
                </div>
                {errors.sku ? (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="size-3" />
                    {errors.sku}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">全店唯一，导入时用它判断新增还是更新</p>                )}
              </div>

              <div className="space-y-2">
                <Label>分类</Label>
                <Select
                  value={draft.category || undefined}
                  onValueChange={(v) => patch({ category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand">品牌</Label>
                <Input
                  id="brand"
                  value={draft.brand ?? ""}
                  placeholder="例如：蔓辞"
                  onChange={(e) => patch({ brand: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="purchase-platform">购入平台</Label>
                <Input
                  id="purchase-platform"
                  list="purchase-platform-options"
                  value={draft.purchase_platform ?? ""}
                  placeholder="淘宝 / 1688 / 抖店…"
                  onChange={(e) => patch({ purchase_platform: e.target.value })}
                />
                <datalist id="purchase-platform-options">
                  {PURCHASE_PLATFORMS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>适用季节</Label>
                <TagPicker
                  value={draft.seasons}
                  onChange={(v) => patch({ seasons: v })}
                  options={SEASONS}
                  placeholder="自定义季节，回车添加"
                />
              </div>
            </CardContent>
          </Card>

          {/* 规格属性 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ruler className="size-4 text-primary" />
                规格属性
              </CardTitle>
              <CardDescription>颜色与尺码支持多选，会展示在商品卡片上</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>颜色</Label>
                <TagPicker
                  value={draft.colors}
                  onChange={(v) => patch({ colors: v })}
                  options={COLORS}
                  placeholder="自定义颜色，回车添加"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>尺码</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => patch({ sizes: preset.values })}
                        className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      >
                        套用{preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <TagPicker
                  value={draft.sizes}
                  onChange={(v) => patch({ sizes: v })}
                  placeholder="自定义尺码，回车添加"
                />
              </div>

            </CardContent>
          </Card>

          {/* 价格库存 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="size-4 text-primary" />
                价格与库存
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="price">
                  售价（元） <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.price}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => patch({ price: Number(e.target.value) })}
                  className={cn("tabular-nums", errors.price && "border-destructive")}
                />
                {errors.price ? (
                  <p className="text-xs text-destructive">{errors.price}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="net-price">到手价（元）</Label>
                <Input
                  id="net-price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.net_price ?? ""}
                  placeholder="不填则按售价计算"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    patch({ net_price: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="platform-fee">平台费用（元）</Label>
                <Input
                  id="platform-fee"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.platform_fee ?? ""}
                  placeholder="佣金、推广等支出"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    patch({ platform_fee: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shipping-fee">运费（元）</Label>
                <Input
                  id="shipping-fee"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.shipping_fee ?? ""}
                  placeholder="后续由运费模块自动计算"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    patch({ shipping_fee: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cost">成本价（元）</Label>
                <Input
                  id="cost"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.cost_price ?? ""}
                  placeholder="选填，用于测算净利"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    patch({ cost_price: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rebate">返利（元）</Label>
                <Input
                  id="rebate"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={draft.rebate ?? ""}
                  placeholder="平台返现，计入收入"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    patch({ rebate: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stock">可用库存</Label>
                <Input
                  id="stock"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={draft.stock}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => patch({ stock: Number(e.target.value) })}
                  className={cn("tabular-nums", errors.stock && "border-destructive")}
                />
                {lockedStock > 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    另有 {lockedStock} 个被未结算的销售订单锁定 · 合计{" "}
                    {draft.stock + lockedStock}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    销售订单会先锁定库存，结算后才真正扣减
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="alert">库存预警值</Label>
                <Input
                  id="alert"
                  type="number"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  value={draft.stock_alert}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => patch({ stock_alert: Math.max(0, Number(e.target.value)) })}
                  className="tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  库存跌到该数值及以下时，看板会标红提醒
                </p>
              </div>

              {specStats && specStats.length > 0 ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label>规格占用明细</Label>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/60 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">规格（颜色 / 尺码）</th>
                          <th className="px-3 py-2 text-right font-medium">锁定中</th>
                          <th className="px-3 py-2 text-right font-medium">已成交</th>
                          <th className="px-3 py-2 text-right font-medium">签收后退款</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {specStats.map((s) => (
                          <tr key={s.spec}>
                            <td className="px-3 py-2">{s.spec}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.locked > 0 ? (
                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                  {s.locked}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.sold}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.refunded > 0 ? (
                                <span className="text-destructive">{s.refunded}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    按该商品名下销售订单的「规格」列汇总。库存按 SPU 级锁定，这里帮你看清锁的是哪些规格。
                  </p>
                </div>
              ) : null}

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="remark">备注</Label>
                <Textarea
                  id="remark"
                  rows={2}
                  value={draft.remark ?? ""}
                  placeholder="发货时效、色差提醒、供货商联系方式…"
                  onChange={(e) => patch({ remark: e.target.value })}
                />
              </div>

              {profit.hasCost ? (
                <Alert className="sm:col-span-2">
                  <AlertDescription className="space-y-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        单件净利{" "}
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            profit.profit >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-destructive",
                          )}
                        >
                          {formatMoney(profit.profit)}
                        </span>
                      </span>
                      <span>
                        净利率{" "}
                        <span className="font-semibold tabular-nums">
                          {profit.rate.toFixed(1)}%
                        </span>
                      </span>
                      {gross ? (
                        <span className="text-muted-foreground">
                          表面毛利 {formatMoney(gross.value)}（{gross.rate.toFixed(1)}%）
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      净收入 {formatMoney(profit.revenue)}（
                      {draft.net_price === null || draft.net_price === undefined
                        ? "售价"
                        : "到手价"}
                      + 返利）－ 净支出 {formatMoney(profit.cost)}（成本价 + 平台费用）· 库存货值{" "}
                      {formatMoney(draft.price * draft.stock)}
                    </p>
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  填上成本价后，这里会自动算出单件净利（到手价 + 返利 － 成本价 － 平台费用）。
                </p>
              )}
            </CardContent>
          </Card>

          {/* 图片（独立模块，按 SPUID / 颜色匹配展示） */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="size-4 text-primary" />
                商品图片
              </CardTitle>
              <CardDescription>
                图片已移至独立的「图片管理」模块，这里按 SPUID / 颜色自动匹配展示
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {matchedImages.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {matchedImages.slice(0, 8).map((img) => (
                    <div key={img.id} className="overflow-hidden rounded-lg bg-muted">
                      <img
                        src={img.url}
                        alt={img.color || draft.sku}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                        {img.color || "通用"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">
                  该 SPUID 还没有匹配到图片
                </p>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link to="/images">
                  <ImageIcon className="size-4" />
                  去图片管理上传 / 调整
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* 描述 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">商品描述</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                rows={5}
                value={draft.description ?? ""}
                placeholder="面料成分、版型说明、洗涤方式、尺码建议…"
                onChange={(e) => patch({ description: e.target.value })}
              />
              <div className="flex items-center justify-between rounded-xl border p-3.5">
                <div>
                  <p className="text-sm font-medium">标记为新品</p>
                  <p className="text-xs text-muted-foreground">
                    新品会在列表和看板上带特殊角标
                  </p>
                </div>
                <Switch
                  checked={draft.is_new}
                  onCheckedChange={(checked) => patch({ is_new: checked })}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧预览 */}
        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" />
                上架预览
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative overflow-hidden rounded-xl bg-muted">
                <img src={cover} alt="预览" className="aspect-square w-full object-cover" />
                <div className="absolute left-2 top-2">
                  <StatusBadge status={draft.status} className="bg-background/85 backdrop-blur" />
                </div>
              </div>

              <div>
                <p className="line-clamp-2 text-sm font-medium">
                  {draft.name || "商品名称待填写"}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {draft.sku || "SKU 待填写"}
                </p>
              </div>

              <div className="flex items-end justify-between">
                <p className="text-lg font-semibold tabular-nums">{formatMoney(draft.price)}</p>
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    draft.stock === 0
                      ? "text-destructive"
                      : draft.stock <= draft.stock_alert
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  库存 {draft.stock}
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {draft.purchase_platform ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {draft.purchase_platform}
                  </Badge>
                ) : null}
                {draft.category ? <Badge variant="secondary">{draft.category}</Badge> : null}
                {draft.seasons.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </div>

              {draft.colors.length || draft.sizes.length ? (
                <div className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                  {draft.colors.length ? <p>颜色：{draft.colors.join("、")}</p> : null}
                  {draft.sizes.length ? <p>尺码：{draft.sizes.join("、")}</p> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">上架状态</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={draft.status}
                onValueChange={(v) => patch({ status: v as ProductStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                「在售」会出现在前台展示，「草稿」仅后台可见，适合还没定稿的商品。
              </p>
              {dirty ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-3.5" />
                  有未保存的修改
                </p>
              ) : null}
            </CardContent>
          </Card>

          {!isNew ? (
            <Card>
              <CardContent className="p-4">
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/products">返回商品列表</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* 移动端底部操作条 */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background/90 p-3 glass lg:hidden">
        <Button variant="outline" className="flex-1" onClick={() => navigate("/products")}>
          取消
        </Button>
        <Button className="flex-[2]" disabled={saving} onClick={() => void save(false)}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isNew ? "创建商品" : "保存修改"}
        </Button>
      </div>
    </div>
  )
}

function generateSku(category: string) {
  const map: Record<string, string> = {
    T恤: "TS",
    衬衫: "SH",
    卫衣: "HD",
    针织衫: "KN",
    外套: "JK",
    羽绒服: "DN",
    西服: "BL",
    连衣裙: "DR",
    半身裙: "SK",
    裤装: "PT",
    牛仔: "DJ",
    套装: "ST",
    鞋靴: "SO",
    帽子: "HT",
    围巾: "SC",
    配饰: "AC",
  }
  const prefix = map[category] ?? "SP"
  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  return `${prefix}-${suffix}`
}
