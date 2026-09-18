import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Bookmark, ExternalLink, Link2, RefreshCcw, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { DateInput } from "@/components/DateInput"
import { ConfirmDialog, ErrorBlock, LoadingBlock, PageHeader } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { formatMoney } from "@/lib/format"
import { CAPTURE_PLATFORMS, type PriceCapture } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 线上地址（书签要写死，因为书签是在京东/拼多多的页面上执行的） */
const APP_ORIGIN = "https://wfjdyhmtr2-glitch.github.io/poizon"

/**
 * 书签脚本。
 * 在商品页点一下 → 把商品名 / 价格 / 链接传到采集页。
 * 价格用「页面里第一个 ¥ 数字」兜底，抓不到就留空由人工填——
 * 各平台 DOM 结构变化频繁，硬匹配选择器很容易失效。
 */
const BOOKMARKLET = `javascript:(function(){
var p=location.href;
var plat=/jd\\.com/.test(p)?'京东':/yangkeduo|pinduoduo/.test(p)?'拼多多':/tmall|taobao/.test(p)?'淘宝':/1688\\.com/.test(p)?'1688':/douyin/.test(p)?'抖音':'';
var t='';
var el=document.querySelector('h1,.sku-name,.goods-name,.item-title,.title-text');
if(el&&el.innerText)t=el.innerText;
if(!t)t=document.title;
t=t.trim().split('\\n')[0].slice(0,80);
var price='';
var m=document.body.innerText.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
if(m)price=m[1];
location.href='${APP_ORIGIN}/#/capture?auto=1&title='+encodeURIComponent(t)+'&price='+encodeURIComponent(price)+'&url='+encodeURIComponent(p)+'&platform='+encodeURIComponent(plat);
})();`

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function PriceCapturePage() {
  const { backend, dataVersion, bumpData, isAdmin } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  const [rows, setRows] = useState<PriceCapture[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState("")
  const [price, setPrice] = useState("")
  const [platform, setPlatform] = useState("京东")
  const [sourceUrl, setSourceUrl] = useState("")
  const [sku, setSku] = useState("")
  const [note, setNote] = useState("")
  const [capturedAt, setCapturedAt] = useState(todayISO)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [filterPlatform, setFilterPlatform] = useState("__all__")
  const [keyword, setKeyword] = useState("")
  const [appliedKeyword, setAppliedKeyword] = useState("")
  const [pendingDelete, setPendingDelete] = useState<PriceCapture | null>(null)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(
        await backend.listPriceCaptures({
          platform: filterPlatform === "__all__" ? undefined : filterPlatform,
          keyword: appliedKeyword || undefined,
          limit: 200,
        }),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend, filterPlatform, appliedKeyword])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  // 书签带参数进来时自动填表，填完把参数清掉，避免刷新时反复覆盖
  useEffect(() => {
    const incoming = searchParams.get("title")
    if (!incoming) return
    setTitle(incoming)
    setPrice(searchParams.get("price") ?? "")
    setSourceUrl(searchParams.get("url") ?? "")
    const p = searchParams.get("platform")
    if (p) setPlatform(p)
    setSearchParams({}, { replace: true })
    toast.success("已读到你正在看的商品，确认价格后点保存")
  }, [searchParams, setSearchParams])

  const stats = useMemo(() => {
    const list = rows ?? []
    const byPlatform = new Map<string, number>()
    for (const r of list) {
      const key = r.platform ?? "未标注"
      byPlatform.set(key, (byPlatform.get(key) ?? 0) + 1)
    }
    return { total: list.length, platforms: [...byPlatform.entries()] }
  }, [rows])

  async function submit() {
    if (!title.trim()) {
      setFormError("商品名称不能为空")
      return
    }
    const value = price.trim() === "" ? null : Number(price)
    if (value !== null && !Number.isFinite(value)) {
      setFormError("价格要填数字")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await backend.createPriceCapture({
        platform: platform || null,
        title: title.trim(),
        price: value,
        source_url: sourceUrl.trim() || null,
        sku: sku.trim() || null,
        note: note.trim() || null,
        captured_at: capturedAt,
      })
      toast.success("已记录")
      setTitle("")
      setPrice("")
      setSourceUrl("")
      setSku("")
      setNote("")
      setCapturedAt(todayISO())
      bumpData()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: PriceCapture) {
    try {
      await backend.deletePriceCaptures([row.id])
      toast.success("已删除")
      setPendingDelete(null)
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading && !rows) return <LoadingBlock label="正在读取采集记录…" />
  if (error && !rows) return <ErrorBlock message={error} onRetry={load} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="价格采集"
        description="在两个平台看到商品价，点一下书签就记进来。平台没有公开的比价接口，所以走这条路：你看的是自己打开的页面，不触发风控、也不会掉数据。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setBookmarkOpen(true)}>
              <Bookmark className="size-4" />
              获取采集书签
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">记一条价格</CardTitle>
          <CardDescription>
            用书签时这里会自动填好；也可以手动录入。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 xl:col-span-2">
              <Label htmlFor="cap-title">商品名称</Label>
              <Input
                id="cap-title"
                placeholder="如 Nike 空军一号 低帮 白色"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-price">到手价（元）</Label>
              <Input
                id="cap-price"
                inputMode="decimal"
                placeholder="如 619"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>平台</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPTURE_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-sku">关联 SPUID（可选）</Label>
              <Input
                id="cap-sku"
                placeholder="你自己的商品编号"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>采集日期</Label>
              <DateInput value={capturedAt} onChange={setCapturedAt} />
            </div>
            <div className="space-y-1.5 xl:col-span-2">
              <Label htmlFor="cap-url">商品页链接（可选）</Label>
              <Input
                id="cap-url"
                placeholder="书签会自动带上"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 xl:col-span-3">
              <Label htmlFor="cap-note">备注（可选）</Label>
              <Input
                id="cap-note"
                placeholder="如 这是券后价 / 需要注意尺码"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={saving}>
              <Save className="size-4" />
              {saving ? "保存中…" : "保存记录"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">采集记录</CardTitle>
          <CardDescription>
            共 {stats.total} 条
            {stats.platforms.length
              ? ` · ${stats.platforms.map(([p, n]) => `${p} ${n}`).join(" / ")}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>平台</Label>
              <Select value={filterPlatform} onValueChange={setFilterPlatform}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部平台</SelectItem>
                  {CAPTURE_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-search">搜索</Label>
              <div className="flex gap-2">
                <Input
                  id="cap-search"
                  placeholder="商品名或 SPUID"
                  className="h-9 w-[200px]"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setAppliedKeyword(keyword.trim())
                  }}
                />
                <Button
                  size="sm"
                  className="h-9"
                  aria-label="搜索记录"
                  onClick={() => setAppliedKeyword(keyword.trim())}
                >
                  搜索
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">日期</TableHead>
                  <TableHead className="w-[100px]">平台</TableHead>
                  <TableHead className="min-w-[220px]">商品</TableHead>
                  <TableHead className="w-[110px] text-right">到手价</TableHead>
                  <TableHead className="w-[120px]">关联 SPUID</TableHead>
                  <TableHead className="w-[160px]">备注</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {row.captured_at}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.platform ?? "未标注"}</Badge>
                    </TableCell>
                    <TableCell>
                      <p className="line-clamp-1 text-sm">{row.title}</p>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.price === null ? "—" : formatMoney(row.price)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.sku ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {row.source_url ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`打开 ${row.title}`}
                            onClick={() => window.open(row.source_url!, "_blank", "noopener")}
                          >
                            <ExternalLink className="size-3" />
                            打开
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            aria-label={`删除 ${row.title}`}
                            onClick={() => setPendingDelete(row)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      还没有采集记录。先获取采集书签，然后在商品页点一下试试。
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>采集书签：拖到书签栏就能用</DialogTitle>
            <DialogDescription>
              在京东 / 拼多多 / 淘宝的商品页点一下这个书签，商品名和价格会自动带过来，确认后保存。
              平台没有对外接口，所以只能这样「你点一下、系统记一下」——合规、稳定，也不会被封。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-medium">第一步：把下面这个按钮拖到浏览器书签栏</p>
              <a
                href={BOOKMARKLET}
                onClick={(e) => {
                  e.preventDefault()
                  toast.info("请用鼠标把这个按钮拖到书签栏（浏览器里不能直接点击执行）")
                }}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                <Bookmark className="size-4" />
                记价格
              </a>
              <p className="mt-2 text-xs text-muted-foreground">
                看不到书签栏？按 ⌘+Shift+B（Windows 是 Ctrl+Shift+B）显示。
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">第二步：在商品页点一下它</p>
              <p className="text-sm text-muted-foreground">
                会自动跳到本页并填好商品名、价格、链接。价格是「页面里第一个 ¥ 数字」兜底抓的，
                不一定准，<strong>保存前扫一眼改一下</strong>。
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">手动添加书签（拖拽不成功时用这个）</p>
              <p className="text-xs text-muted-foreground">
                新建一个书签，名称随便填（比如「记价格」），地址栏粘贴下面这段代码：
              </p>
              <textarea
                readOnly
                value={BOOKMARKLET}
                rows={5}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookmarkOpen(false)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除这条采集记录"
        description={`将删除「${pendingDelete?.title ?? ""}」这条价格记录，不可恢复。`}
        confirmText="确认删除"
        onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)}
      />

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Link2 className="mt-0.5 size-3.5 shrink-0" />
        小提示：想从一张图找到商品，可以直接把图发给我，我认出来是什么款之后给你京东 / 拼多多的搜索链接。
      </p>
    </div>
  )
}
