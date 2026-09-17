import { useRef, useState } from "react"
import { ImagePlus, Loader2, Star, Trash2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useApp } from "@/contexts/AppContext"
import { toast } from "sonner"

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif"
const MAX_FILES = 8

export function ImageUploader({
  images,
  cover,
  onChange,
  max = MAX_FILES,
}: {
  images: string[]
  cover: string | null
  onChange: (images: string[], cover: string | null) => void
  max?: number
}) {
  const { backend } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (!list.length) {
      toast.error("只能上传图片文件")
      return
    }
    const room = max - images.length
    if (room <= 0) {
      toast.error(`最多上传 ${max} 张图片`)
      return
    }
    const picked = list.slice(0, room)
    setBusy(true)
    try {
      const urls: string[] = []
      for (const file of picked) {
        if (file.size > 12 * 1024 * 1024) {
          toast.error(`${file.name} 超过 12MB，已跳过`)
          continue
        }
        urls.push(await backend.uploadImage(file))
      }
      if (urls.length) {
        const next = [...images, ...urls]
        onChange(next, cover ?? next[0] ?? null)
        toast.success(`已上传 ${urls.length} 张图片`)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function removeAt(index: number) {
    const target = images[index]
    const next = images.filter((_, i) => i !== index)
    onChange(next, cover === target ? (next[0] ?? null) : cover)
    if (backend.supportsUpload && target && !target.startsWith("data:")) {
      void backend.deleteImage(target).catch(() => undefined)
    }
  }

  function makeCover(url: string) {
    onChange(images, url)
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= images.length) return
    const next = [...images]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next, cover)
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!busy) void handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-xs">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : dragging ? (
            <UploadCloud className="size-5 text-primary" />
          ) : (
            <ImagePlus className="size-5" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium">
            {busy ? "上传中…" : "点击选择图片，或把文件拖到这里"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            支持 JPG / PNG / WEBP，单张 ≤ 12MB，最多 {max} 张 · 已上传 {images.length} 张
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>

      {images.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((url, index) => {
            const isCover = cover === url
            return (
              <div
                key={`${url.slice(-24)}-${index}`}
                className={cn(
                  "group relative overflow-hidden rounded-xl border bg-muted",
                  isCover ? "border-primary ring-2 ring-primary/25" : "border-border",
                )}
              >
                <img
                  src={url}
                  alt={`商品图 ${index + 1}`}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                {isCover ? (
                  <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                    主图
                  </span>
                ) : null}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      title="移到前面"
                      onClick={() => move(index, -1)}
                    >
                      <span className="text-xs">←</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      title="移到后面"
                      onClick={() => move(index, 1)}
                    >
                      <span className="text-xs">→</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      title="设为主图"
                      onClick={() => makeCover(url)}
                    >
                      <Star className={cn("size-3.5", isCover && "fill-amber-400 text-amber-400")} />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="size-7"
                    title="删除"
                    onClick={() => void removeAt(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
