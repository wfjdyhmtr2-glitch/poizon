import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, ImagePlus, Loader2, RefreshCcw, Search, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, ErrorBlock, LoadingBlock, PageHeader } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { LOOKUP_PLATFORMS, type ImageLookup } from "@/lib/types"
import { cn } from "@/lib/utils"

export function LookupPage() {
  const { backend, dataVersion, bumpData, isAdmin } = useApp()

  const [rows, setRows] = useState<ImageLookup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recognizingId, setRecognizingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ImageLookup | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await backend.listImageLookups())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  /** 识别一张图并回填关键词；未部署识别函数时静默跳过，让用户手填 */
  const recognize = useCallback(
    async (row: ImageLookup) => {
      setRecognizingId(row.id)
      try {
        const result = await backend.recognizeImage(row.image_url)
        if (result.keyword) {
          await backend.updateImageLookup(row.id, {
            keyword: result.keyword,
            brand: result.brand || null,
            note: result.note || null,
            status: "done",
          })
          bumpData()
        } else {
          await backend.updateImageLookup(row.id, { status: "pending", note: "没认出这是什么，手动填一下关键词" })
          bumpData()
        }
      } catch (err) {
        await backend
          .updateImageLookup(row.id, { status: "pending", note: (err as Error).message })
          .catch(() => undefined)
        toast.info((err as Error).message)
        bumpData()
      } finally {
        setRecognizingId(null)
      }
    },
    [backend, bumpData],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"))
      if (!images.length) return
      setBusy(true)
      for (const file of images) {
        try {
          const url = await backend.uploadImage(file)
          const row = await backend.createImageLookup({ image_url: url })
          bumpData()
          void recognize(row)
        } catch (err) {
          toast.error((err as Error).message)
        }
      }
      setBusy(false)
    },
    [backend, bumpData, recognize],
  )

  // 支持直接 ⌘V 粘贴图片
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length) {
        e.preventDefault()
        void handleFiles(files)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [handleFiles])

  async function saveKeyword(row: ImageLookup, keyword: string) {
    try {
      await backend.updateImageLookup(row.id, {
        keyword: keyword.trim() || null,
        status: keyword.trim() ? "done" : "pending",
      })
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remove(row: ImageLookup) {
    try {
      await backend.deleteImageLookups([row.id])
      toast.success("已删除")
      setPendingDelete(null)
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading && !rows) return <LoadingBlock label="正在读取…" />
  if (error && !rows) return <ErrorBlock message={error} onRetry={load} />

  const list = rows ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="图片找同款"
        description="粘贴或拖一张商品图进来，认出是什么款之后，点一下就能去京东 / 拼多多 / 1688 搜同款看价。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ImagePlus className="size-4 text-primary" />
            粘贴图片
          </CardTitle>
          <CardDescription>
            复制图片后在页面任意位置按 ⌘V 粘贴，也可以拖进来或点下面的按钮选文件。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void handleFiles(Array.from(e.dataTransfer.files))
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
            )}
          >
            {busy ? (
              <>
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="text-sm">正在上传并识别…</p>
              </>
            ) : (
              <>
                <ImagePlus className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">点这里选图片，或直接 ⌘V 粘贴</p>
                <p className="text-xs text-muted-foreground">支持 png / jpg / webp</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []))
              e.target.value = ""
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">识别结果</CardTitle>
          <CardDescription>
            共 {list.length} 条。关键词可以自己改，改完直接点平台按钮去搜同款。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {list.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              还没有图片。粘贴一张试试。
            </p>
          ) : (
            <ul className="divide-y">
              {list.map((row) => (
                <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <img
                    src={row.image_url}
                    alt="待识别商品图"
                    className="size-20 shrink-0 rounded-lg bg-muted object-cover"
                  />

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.status === "done" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="size-3" />
                          {row.brand ? `${row.brand}` : "已识别"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">待填关键词</Badge>
                      )}
                      {row.note ? (
                        <span className="text-xs text-muted-foreground">{row.note}</span>
                      ) : null}
                    </div>

                    <Input
                      defaultValue={row.keyword ?? ""}
                      placeholder="填关键词，如 Nike 空军一号 低帮 白色"
                      className="h-9"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (row.keyword ?? "")) {
                          void saveKeyword(row, e.target.value)
                        }
                      }}
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={recognizingId === row.id}
                        onClick={() => void recognize(row)}
                      >
                        {recognizingId === row.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        重新识别
                      </Button>
                      {LOOKUP_PLATFORMS.map((p) => (
                        <Button
                          key={p.name}
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={!row.keyword}
                          title={p.hint}
                          onClick={() =>
                            window.open(p.url(row.keyword ?? ""), "_blank", "noopener")
                          }
                        >
                          <Search className="size-3" />
                          {p.name}
                        </Button>
                      ))}
                      {row.keyword ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          aria-label="打开京东搜索"
                          onClick={() =>
                            window.open(
                              `https://search.jd.com/Search?keyword=${encodeURIComponent(row.keyword ?? "")}&enc=utf-8`,
                              "_blank",
                              "noopener",
                            )
                          }
                        >
                          <ExternalLink className="size-3" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {isAdmin ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 self-start px-2 text-xs text-destructive"
                      aria-label="删除这条"
                      onClick={() => setPendingDelete(row)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除这条记录"
        description="删除后这张图和它的关键词就没了，不可恢复。"
        confirmText="确认删除"
        onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)}
      />

      <p className="text-xs text-muted-foreground">
        没配视觉模型时不会自动识别，填个关键词一样能搜。想开自动识别：
        在 Supabase 部署 <code className="rounded bg-muted px-1">recognize-product</code> 函数并配置视觉模型密钥（见 README）。
      </p>
    </div>
  )
}
