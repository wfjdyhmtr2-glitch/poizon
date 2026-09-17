import { useCallback, useEffect, useMemo, useState } from "react"
import { Link2, Loader2, Plus, Trash2 } from "lucide-react"
import { useApp } from "@/contexts/AppContext"
import type { Product, SpuMapping } from "@/lib/types"
import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * SPU 对照管理：平台（得物等）导出文件里的 spuID 若与本店 SPUID 不一致，
 * 在这里建立映射。订单导入后按「直接匹配 → 对照表」的顺序解析到商品，
 * 库存联动与看板统计都认这个结果。
 */
export function SalesMappingDialog({
  open,
  onOpenChange,
  products,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  /** 对照发生变化后通知父页面刷新（库存联动可能已调整） */
  onChanged?: () => void
}) {
  const { backend } = useApp()
  const [mappings, setMappings] = useState<SpuMapping[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [externalId, setExternalId] = useState("")
  const [sku, setSku] = useState("")

  const productBySku = useMemo(() => new Map(products.map((p) => [p.sku, p])), [products])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setMappings(await backend.listSpuMappings())
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取对照失败")
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    if (open) {
      setError("")
      void reload()
    }
  }, [open, reload])

  function resetForm() {
    setExternalId("")
    setSku("")
  }

  async function handleSave() {
    if (!externalId.trim()) {
      setError("请填写平台 spuID")
      return
    }
    if (!sku) {
      setError("请选择要关联的商品")
      return
    }
    setSaving(true)
    setError("")
    try {
      await backend.saveSpuMapping({ external_id: externalId.trim(), sku, note: null })
      resetForm()
      await reload()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setError("")
    try {
      await backend.deleteSpuMappings([id])
      await reload()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" />
            SPU 对照
          </DialogTitle>
          <DialogDescription>
            平台导出的 spuID 与本店 SPUID 不一致时，在这里建立对应关系。
            建好后库存联动、看板统计都会自动认上。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label htmlFor="mapping-external">平台 spuID</Label>
              <Input
                id="mapping-external"
                value={externalId}
                placeholder="例如 DW-SPU-88231（对照表里唯一）"
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>关联到本店商品</Label>
              <Select value={sku} onValueChange={setSku}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择商品（按 SPUID 关联）" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.sku}>
                      {p.name}（{p.sku}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button onClick={handleSave} disabled={saving} className="justify-self-start">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              保存对照
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              已建立的对照（{mappings.length}）
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                读取中…
              </div>
            ) : mappings.length === 0 ? (
              <p className="rounded-lg bg-muted/60 px-3 py-4 text-center text-xs text-muted-foreground">
                还没有对照。若平台 spuID 与本店 SPUID 一致，则无需对照。
              </p>
            ) : (
              <div className="h-44 overflow-y-auto rounded-lg border thin-scrollbar">
                <ul className="divide-y text-sm">
                  {mappings.map((m) => {
                    const product = productBySku.get(m.sku)
                    return (
                      <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs">{m.external_id}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            → {product ? `${product.name}（${m.sku}）` : `SPUID ${m.sku}（商品已删除）`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(m.id)}
                          disabled={deletingId === m.id}
                        >
                          {deletingId === m.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
