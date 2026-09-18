import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ClipboardPaste, ImagePlus, ImageIcon, Loader2, Plus, Save, Star, Trash2 } from "lucide-react"
import { useApp } from "@/contexts/AppContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, PageHeader } from "@/components/common"
import type { Product, ProductImage, PurchaseOrder, SpuInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/** 登记表单里的一行颜色（color 为空 = 通用 / SPU 主图） */
interface RegRow {
  key: string
  color: string
  /** 待上传的新图 */
  files: File[]
  previews: string[]
}

function newRow(color = ""): RegRow {
  return { key: crypto.randomUUID(), color, files: [], previews: [] }
}

/**
 * 商品信息（独立模块）
 * 一个 SPUID 下可挂：通用图 + 各颜色图；其他模块按 SPUID / 颜色匹配，匹配不到用默认主图兜底。
 */
export function ImageLibraryPage() {
  const { backend, bumpData, dataVersion } = useApp()

  const [products, setProducts] = useState<Product[]>([])
  const [images, setImages] = useState<ProductImage[]>([])
  const [loading, setLoading] = useState(true)

  const [filterSku, setFilterSku] = useState("all")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /* 登记表单：SPUID + 名称 + 颜色 + 图片（粘贴 / 选择） */
  const [regSku, setRegSku] = useState("")
  const [regName, setRegName] = useState("")
  /** 颜色行：一个 SPUID 下可加多行，每行一个颜色各自贴图；color 为空 = 通用 */
  const [regRows, setRegRows] = useState<RegRow[]>(() => [newRow("")])
  /** 被勾选为默认主图的行 key（该行第一张图会写进 SPU 主图） */
  const [defaultRowKey, setDefaultRowKey] = useState("")
  const [regSaving, setRegSaving] = useState(false)
  const [spuInfos, setSpuInfos] = useState<SpuInfo[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const pasteTargetRef = useRef<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [productRows, imageRows, infoRows, poRows] = await Promise.all([
        backend.fetchForDashboard().catch(() => [] as Product[]),
        backend.listProductImages(),
        backend.listSpuInfo().catch(() => [] as SpuInfo[]),
        backend.listPurchaseOrders().catch(() => [] as PurchaseOrder[]),
      ])
      setProducts(productRows)
      setImages(imageRows)
      setSpuInfos(infoRows)
      setPurchaseOrders(poRows)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const productBySku = useMemo(() => new Map(products.map((p) => [p.sku, p])), [products])

  const visible = useMemo(
    () =>
      [...images]
        .filter((img) => (filterSku === "all" ? true : img.sku === filterSku))
        .sort(
          (a, b) =>
            a.sku.localeCompare(b.sku) ||
            a.color.localeCompare(b.color) ||
            a.created_at.localeCompare(b.created_at),
        ),
    [images, filterSku],
  )

  /** 每个 SPUID 的图片数（含未入库商品），用于过滤器上的角标 */
  const countBySku = useMemo(() => {
    const map = new Map<string, number>()
    for (const img of images) map.set(img.sku, (map.get(img.sku) ?? 0) + 1)
    return map
  }, [images])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await backend.deleteProductImages([id])
      setImages((prev) => prev.filter((img) => img.id !== id))
      bumpData()
      toast.success("已删除")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const infoBySku = useMemo(() => new Map(spuInfos.map((r) => [r.sku, r])), [spuInfos])

  /** 售价 = 入仓管理该款 Σ进货总价 ÷ Σ进货数量；没进过货 = null（显示 -） */
  const avgPriceBySku = useMemo(() => {
    const acc = new Map<string, { total: number; qty: number }>()
    for (const po of purchaseOrders) {
      for (const it of po.items) {
        const a = acc.get(it.sku) ?? { total: 0, qty: 0 }
        a.total += it.price ?? 0
        a.qty += it.quantity
        acc.set(it.sku, a)
      }
    }
    const map = new Map<string, number | null>()
    for (const [sku, a] of acc) {
      map.set(sku, a.qty > 0 ? Number((a.total / a.qty).toFixed(2)) : null)
    }
    return map
  }, [purchaseOrders])

  /** 当前 SPUID 已登记的信息（SPU 主图 / 名称） */
  const regInfo = infoBySku.get(regSku.trim()) ?? null
  /** 该款已有商品资料里的颜色，作为新增颜色时的建议 */
  const colorSuggestions = productBySku.get(regSku.trim())?.colors ?? []
  /** SKU 建议：已登记 + 已有商品 */
  const skuOptions = useMemo(
    () => [...new Set([...infoBySku.keys(), ...products.map((p) => p.sku)])].sort(),
    [infoBySku, products],
  )
  /** 当前 SPUID 已存在的图片（图库），按颜色分组 */
  const existingByColor = useMemo(() => {
    const map = new Map<string, ProductImage[]>()
    for (const img of images) {
      if (img.sku !== regSku.trim()) continue
      const list = map.get(img.color) ?? []
      list.push(img)
      map.set(img.color, list)
    }
    return map
  }, [images, regSku])

  /** 选中 SPUID 时自动带出名称，并按已有颜色初始化颜色行 */
  function applyRegSku(sku: string) {
    setRegSku(sku)
    const trimmed = sku.trim()
    const info = infoBySku.get(trimmed)
    if (info) setRegName(info.name)
    const colors = (productBySku.get(trimmed)?.colors ?? []).filter(Boolean)
    const used = new Set(
      images.filter((img) => img.sku === trimmed && img.color).map((img) => img.color),
    )
    const rows = [...new Set([...colors, ...used])].map((c) => newRow(c))
    setRegRows(rows.length ? rows : [newRow("")])
    setDefaultRowKey("")
  }

  function addRow() {
    setRegRows((prev) => [...prev, newRow("")])
  }

  function patchRow(key: string, patch: Partial<RegRow>) {
    setRegRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: string) {
    setRegRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
    setDefaultRowKey((prev) => (prev === key ? "" : prev))
  }

  function addRowFiles(key: string, list: File[]) {
    if (!list.length) return
    setRegRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, files: [...r.files, ...list], previews: [...r.previews, ...list.map((f) => URL.createObjectURL(f))] }
          : r,
      ),
    )
  }

  /** 粘贴图片：贴到当前聚焦的颜色行（未指定则贴到第一行） */
  function handleRegPaste(e: React.ClipboardEvent) {
    const file = [...e.clipboardData.items].find((it) => it.type.startsWith("image/"))?.getAsFile()
    if (!file) return
    e.preventDefault()
    const key = pasteTargetRef.current || regRows[0]?.key
    if (!key) return
    addRowFiles(key, [file])
    toast.success("已读取粘贴的图片")
  }

  function resetReg() {
    setRegRows([newRow("")])
    setDefaultRowKey("")
  }

  async function saveReg() {
    const sku = regSku.trim()
    if (!sku) {
      toast.error("请填写 SPUID")
      return
    }
    const colors = regRows.map((r) => r.color.trim())
    if (colors.some((c, i) => c && colors.indexOf(c) !== i)) {
      toast.error("颜色重复了，请合并为一行")
      return
    }
    setRegSaving(true)
    try {
      /* 1) 逐行上传新图：有颜色 → 该颜色图；无颜色 → 通用图 */
      const uploadedByRow = new Map<string, string[]>()
      for (const row of regRows) {
        const urls: string[] = []
        for (const file of row.files) {
          const url = await backend.uploadImage(file)
          await backend.addProductImage({ sku, color: row.color.trim(), url })
          urls.push(url)
        }
        uploadedByRow.set(row.key, urls)
      }

      /* 2) 默认主图：
            - 手动勾选了某行 → 用该行第一张（新图优先，否则该行已有图）
            - 没勾选 → 自动用「第一张录入的图片」（按行顺序的第一张新图），
              这就是用户期望的默认行为，不需要每次手动去勾 */
      let imageUrl = regInfo?.image_url ?? ""
      const defRow = defaultRowKey ? regRows.find((r) => r.key === defaultRowKey) : undefined
      if (defRow) {
        const fresh = uploadedByRow.get(defRow.key) ?? []
        const existing = defRow.color.trim()
          ? existingByColor.get(defRow.color.trim())?.[0]?.url
          : existingByColor.get("")?.[0]?.url
        imageUrl = fresh[0] ?? existing ?? imageUrl
      } else {
        const firstUploaded = regRows
          .map((r) => uploadedByRow.get(r.key)?.[0])
          .find((url): url is string => Boolean(url))
        if (firstUploaded) imageUrl = firstUploaded
      }

      await backend.upsertSpuInfo({
        sku,
        name: regName.trim(),
        image_url: imageUrl,
        price: null,
      })

      const total = regRows.reduce((acc, r) => acc + r.files.length, 0)
      toast.success(
        total ? `已保存「${sku}」，上传 ${total} 张图片` : `已保存「${sku}」的商品信息`,
      )
      resetReg()
      bumpData()
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRegSaving(false)
    }
  }


  return (
    <div className="space-y-4">
      <PageHeader
        title="商品信息"
        description="每个 SPUID 登记名称，并按颜色分行贴图（支持粘贴）。未手动指定时，自动取第一张录入的图片作为默认主图。入仓管理输入 SPUID 会自动带出名称。"
      />

      {/* SPUID 登记 + 按颜色挂图（合一） */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Save className="size-4 text-primary" />
            SPUID 信息登记与图片
            <span className="text-xs font-normal text-muted-foreground">
              可只登记名称；图片按颜色分行贴（可粘贴 / 选择），不勾选则自动取第一张录入的图作为默认主图
            </span>
          </div>

          {/* 基础信息 */}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="reg-sku">SPUID</Label>
              <Input
                id="reg-sku"
                value={regSku}
                placeholder="输入或从下拉选择"
                className="font-mono"
                list="spu-info-sku-list"
                onChange={(e) => applyRegSku(e.target.value)}
              />
              <datalist id="spu-info-sku-list">
                {skuOptions.map((sku) => (
                  <option key={sku} value={sku} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-name">商品名称</Label>
              <Input
                id="reg-name"
                value={regName}
                placeholder="该 SPUID 对应的商品名称"
                onChange={(e) => setRegName(e.target.value)}
              />
            </div>
          </div>

          {/* 颜色行 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                颜色行（每行一个颜色，各自贴图；留空 = 该款通用图）
              </Label>
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-3.5" />
                新增颜色
              </Button>
            </div>
            <datalist id="reg-color-suggestions">
              {colorSuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            {regRows.map((row, index) => {
              const existing = existingByColor.get(row.color.trim()) ?? []
              const isDefault = defaultRowKey === row.key
              return (
                <div
                  key={row.key}
                  className={cn(
                    "space-y-2 rounded-xl border p-2.5 transition-colors",
                    isDefault && "border-primary/60 bg-primary/5",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-8 shrink-0 text-center text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      value={row.color}
                      placeholder="颜色（留空 = 通用）"
                      className="h-9 w-[180px]"
                      list="reg-color-suggestions"
                      onChange={(e) => patchRow(row.key, { color: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant={isDefault ? "default" : "outline"}
                      onClick={() => setDefaultRowKey(isDefault ? "" : row.key)}
                    >
                      <Star className={cn("size-3.5", isDefault && "fill-current")} />
                      {isDefault ? "默认主图" : "设为默认主图"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {existing.length ? `已有 ${existing.length} 张` : "暂无图"}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.key)}
                      disabled={regRows.length <= 1}
                      aria-label="删除该颜色行"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {/* 该行的图片区：已有图 + 待上传图，支持粘贴 */}
                  <div
                    tabIndex={0}
                    onPaste={(e) => handleRegPaste(e)}
                    onFocus={() => {
                      pasteTargetRef.current = row.key
                    }}
                    onClick={(e) => {
                      e.currentTarget.focus()
                      pasteTargetRef.current = row.key
                    }}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2 outline-none transition-colors focus-visible:border-primary"
                    title="点击该区域后直接 Ctrl+V / Cmd+V 粘贴图片"
                  >
                    {existing.map((img) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt={row.color || "通用"}
                        loading="lazy"
                        className="size-14 rounded-lg bg-muted object-cover"
                      />
                    ))}
                    {row.previews.map((url, i) => (
                      <div key={`${row.key}-${i}`} className="relative">
                        <img src={url} alt="待上传预览" className="size-14 rounded-lg bg-muted object-cover" />
                        <button
                          type="button"
                          className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            patchRow(row.key, {
                              files: row.files.filter((_, idx) => idx !== i),
                              previews: row.previews.filter((_, idx) => idx !== i),
                            })
                          }}
                          aria-label="移除该图"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                      <ClipboardPaste className="size-3.5" />
                      {row.previews.length
                        ? `待上传 ${row.previews.length} 张`
                        : "粘贴 / 选择图片"}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        id={`reg-file-${row.key}`}
                        onChange={(e) => {
                          addRowFiles(row.key, Array.from(e.target.files ?? []))
                          e.target.value = ""
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          document.getElementById(`reg-file-${row.key}`)?.click()
                        }}
                      >
                        <ImagePlus className="size-3.5" />
                        选择图片
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {defaultRowKey
                ? "已手动指定默认主图：其他模块按 SPUID / 颜色匹配不到图时用它兜底"
                : "未手动指定时，自动取第一张录入的图片作为默认主图"}
            </p>
            <Button onClick={() => void saveReg()} disabled={regSaving} className="min-w-[104px]">
              {regSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 已登记列表 */}
      {spuInfos.length ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              已登记 <span className="tabular-nums">{spuInfos.length}</span> 个 SPUID
              <span className="text-xs font-normal text-muted-foreground">点击任意一项可回填到上方表单修改</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {spuInfos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => applyRegSku(r.sku)}
                  className="flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.name || r.sku}
                      loading="lazy"
                      className="size-14 shrink-0 rounded-lg bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <ImageIcon className="size-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name || "（未填名称）"}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{r.sku}</p>
                    <p className="text-[11px] text-muted-foreground">
                      售价 {avgPriceBySku.get(r.sku) ?? "-"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 过滤 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filterSku === "all" ? "default" : "outline"}
          onClick={() => setFilterSku("all")}
        >
          全部（{images.length}）
        </Button>
        {[...countBySku.entries()].map(([sku, count]) => (
          <Button
            key={sku}
            size="sm"
            variant={filterSku === sku ? "default" : "outline"}
            onClick={() => setFilterSku(sku)}
            className="font-mono text-xs"
          >
            {sku}（{count}）
          </Button>
        ))}
      </div>

      {/* 图库 */}
      {loading && !images.length ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载图片…
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ImageIcon className="size-5" />}
            title="还没有图片"
            description="选择一个 SPUID 和颜色，把商品图上传进来；之后入仓列表和编辑页会自动匹配显示。"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((img) => (
            <Card key={img.id} className="group overflow-hidden">
              <div className="relative aspect-square bg-muted">
                <img
                  src={img.url}
                  alt={`${img.sku}${img.color ? ` · ${img.color}` : ""}`}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute right-1.5 top-1.5 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                  disabled={deletingId === img.id}
                  onClick={() => void handleDelete(img.id)}
                  aria-label="删除图片"
                >
                  {deletingId === img.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
              <CardContent className="space-y-0.5 p-2.5">
                <p className="truncate font-mono text-[11px]">{img.sku}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5",
                      img.color ? "bg-muted" : "bg-primary/10 text-primary",
                    )}
                  >
                    {img.color || "通用"}
                  </span>
                  <span className="truncate">{productBySku.get(img.sku)?.name ?? "SPUID 未入库"}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
