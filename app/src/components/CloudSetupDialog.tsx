import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldAlert,
  XCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useApp } from "@/contexts/AppContext"
import { createCloudBackend } from "@/lib/cloudBackend"
import { normalizeUrl } from "@/lib/cloud"
import { SCHEMA_SQL, SETUP_STEPS } from "@/lib/schemaSql"
import { toast } from "sonner"

export function CloudSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { config, applyCloudConfig, disconnectCloud, isCloud } = useApp()
  const [url, setUrl] = useState("")
  const [anonKey, setAnonKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setUrl(config?.url ?? "")
      setAnonKey(config?.anonKey ?? "")
      setResult(null)
    }
  }, [open, config])

  async function handleTest() {
    const clean = normalizeUrl(url)
    if (!clean || !anonKey.trim()) {
      toast.error("请先填写 Project URL 和 anon key")
      return
    }
    const mistake = detectMisplacedSql(clean, anonKey)
    if (mistake) {
      setResult({ ok: false, message: mistake })
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const probe = createCloudBackend({ url: clean, anonKey: anonKey.trim() })
      const health = await probe.checkHealth()
      setResult(health)
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    const clean = normalizeUrl(url)
    const mistake = detectMisplacedSql(clean, anonKey)
    if (mistake) {
      toast.error(mistake)
      return
    }
    if (!/^https?:\/\//i.test(clean)) {
      toast.error("Project URL 需要以 https:// 开头，例如 https://abcdefgh.supabase.co")
      return
    }
    if (anonKey.trim().length < 20) {
      toast.error("anon key 看起来不完整，请重新复制")
      return
    }
    setSaving(true)
    try {
      applyCloudConfig({ url: clean, anonKey: anonKey.trim() })
      toast.success("已切换到云端数据库，请使用 Supabase 里的账号重新登录")
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(SCHEMA_SQL)
      toast.success("初始化 SQL 已复制到剪贴板")
    } catch {
      toast.error("复制失败，请手动选中复制")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto thin-scrollbar sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugZap className="size-5 text-primary" />
            连接云端数据库
          </DialogTitle>
          <DialogDescription>
            数据存到 Supabase Postgres，图片存到 Supabase Storage，前端可以纯静态部署上线。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="config">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="config">填写连接信息</TabsTrigger>
            <TabsTrigger value="guide">初始化指引</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sb-url" className="flex items-center gap-1.5">
                <Database className="size-3.5" />
                Project URL
              </Label>
              <Input
                id="sb-url"
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sb-key" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" />
                anon public key
              </Label>
              <Input
                id="sb-key"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                anon key 设计上就是公开的，安全性由数据库的 RLS 策略保证，可以放心填。
              </p>
            </div>

            {result ? (
              <Alert variant={result.ok ? "default" : "destructive"}>
                {result.ok ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <XCircle className="size-4" />
                )}
                <AlertTitle>{result.ok ? "连接成功" : "连接失败"}</AlertTitle>
                <AlertDescription className="break-all">{result.message}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                  测试连接
                </Button>
                {isCloud ? (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      disconnectCloud()
                      toast.message("已切回演示模式")
                      onOpenChange(false)
                    }}
                  >
                    断开云端
                  </Button>
                ) : null}
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                保存并连接
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="guide" className="mt-4 space-y-4">
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>首次使用需要 4 步</AlertTitle>
              <AlertDescription>
                建项目 → 执行 SQL → 建管理员账号 → 回填连接信息。全程免费，大约 5 分钟。
              </AlertDescription>
            </Alert>

            <ol className="space-y-3">
              {SETUP_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {step.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copySql}>
                <Copy className="size-3.5" />
                复制初始化 SQL
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  打开 Supabase 控制台
                </a>
              </Button>
            </div>

            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                初始化 SQL 预览（点上方按钮复制完整版本）
              </p>
              <pre className="max-h-52 overflow-auto rounded-lg bg-background/60 p-3 text-[11px] leading-relaxed thin-scrollbar">
                <code>{SCHEMA_SQL}</code>
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/** 建表 SQL 常被误粘进 URL / anon key 输入框，提前拦住并说清该去哪儿执行 */
function detectMisplacedSql(urlValue: string, keyValue: string): string | null {
  const key = keyValue.trim()
  if (looksLikeSql(key)) {
    return "anon public key 这一格里粘的是建表 SQL。这段脚本要放到 Supabase 控制台的 SQL Editor 里执行；这一格只需要那串以 eyJ 或 sb_publishable_ 开头的密钥。"
  }
  if (looksLikeSql(urlValue)) {
    return "Project URL 这一格里粘的是建表 SQL。URL 只需要 https://你的项目ID.supabase.co 这一行。"
  }
  return null
}

function looksLikeSql(text: string): boolean {
  if (!text) return false
  if (text.includes("\n") || text.includes("\r")) return true
  if (/^(create|insert|alter|drop|select|grant|comment|--)/i.test(text)) return true
  return /(create\s+table|create\s+policy|insert\s+into|alter\s+table|drop\s+policy|storage\.buckets)/i.test(
    text,
  )
}
