import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  CheckCircle2,
  Cloud,
  Database,
  Download,
  HardDrive,
  Info,
  KeyRound,
  LogOut,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { MousePointerClick } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ConfirmDialog } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { downloadBlob } from "@/lib/format"
import { SCHEMA_SQL } from "@/lib/schemaSql"
import { resetDemoData } from "@/lib/demoBackend"
import { toast } from "sonner"

export function SettingsPage() {
  const { backend, config, isCloud, user, health, healthLoading, refreshHealth, signOut, bumpData } =
    useApp()
  const [confirmReset, setConfirmReset] = useState(false)
  const [count, setCount] = useState<number | null>(null)

  const loadCount = useCallback(async () => {
    try {
      const rows = await backend.fetchForDashboard()
      setCount(rows.length)
    } catch {
      setCount(null)
    }
  }, [backend])

  useEffect(() => {
    void loadCount()
  }, [loadCount])

  function downloadSql() {
    downloadBlob(SCHEMA_SQL, "yunguan-schema.sql", "text/plain;charset=utf-8")
    toast.success("初始化 SQL 已下载")
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(SCHEMA_SQL)
      toast.success("已复制到剪贴板，粘到 Supabase SQL Editor 里 Run 即可")
    } catch {
      toast.error("复制失败，可使用下载按钮")
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">系统设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          账号与偏好设置
        </p>
      </div>

      {/* 使用技巧 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <MousePointerClick className="size-4 text-primary" />
            小技巧
          </span>
          <span className="text-muted-foreground">
            <b className="font-medium text-foreground">双击</b>页面上的任意数据（货号、金额、单号、规格…）即可自动复制到剪贴板
          </span>
          <span className="text-muted-foreground">输入框内双击仍是原生选词，不受影响</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 云端连接 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="size-4 text-primary" />
              云端连接
            </CardTitle>
            <CardDescription>
              {isCloud ? "数据与图片都保存在 Supabase" : "当前使用浏览器本地数据演示"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3 ${
                health?.ok
                  ? "border-emerald-500/30 bg-emerald-500/8"
                  : "border-amber-500/30 bg-amber-500/8"
              }`}
            >
              {health?.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {healthLoading ? "检测中…" : health?.ok ? "连接正常" : "未就绪"}
                </p>
                <p className="mt-0.5 break-all text-xs text-muted-foreground">
                  {health?.message ?? "尚未检测"}
                </p>
              </div>
            </div>

            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="size-3.5" />
                  数据源
                </dt>
                <dd className="truncate font-medium">{backend.label}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  文件存储
                </dt>
                <dd className="truncate font-medium">{backend.storageLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <KeyRound className="size-3.5" />
                  Project URL
                </dt>
                <dd className="max-w-[60%] truncate font-mono text-xs">
                  {config?.url ?? "未配置"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">商品数量</dt>
                <dd className="font-medium tabular-nums">
                  {count === null ? "—" : `${count} 个`}
                </dd>
              </div>
            </dl>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={healthLoading}
                onClick={() => void refreshHealth()}
              >
                <RefreshCcw className={healthLoading ? "size-3.5 animate-spin" : "size-3.5"} />
                重新检测
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 账号 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              账号与权限
            </CardTitle>
            <CardDescription>登录态由 Supabase Auth 管理</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border p-3.5">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {(user?.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.email ?? "未登录"}</p>
                <p className="text-xs text-muted-foreground">
                  {isCloud ? "云端管理员账号" : "本地演示账号"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  isCloud
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }
              >
                {isCloud ? "已认证" : "演示"}
              </Badge>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              新增后台账号请在 Supabase 控制台的 Authentication → Users 里添加，然后回到这里登录。
              数据库的行级安全策略保证只有登录用户能读写商品数据。
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await signOut()
                  toast.success("已退出登录")
                }}
              >
                <LogOut className="size-3.5" />
                退出登录
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to="/products">去管理商品</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 数据库脚本 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-primary" />
              数据库脚本
            </CardTitle>
            <CardDescription>建表、索引、RLS 策略与存储桶一次搞定</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. 打开 Supabase 控制台的 SQL Editor</li>
              <li>2. 新建 Query，粘贴下面的脚本并 Run</li>
              <li>3. 回到本页点「重新检测」，显示连接正常即完成</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={copySql}>
                复制 SQL
              </Button>
              <Button size="sm" variant="outline" onClick={downloadSql}>
                <Download className="size-3.5" />
                下载 .sql 文件
              </Button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-xl border bg-muted/40 p-3 text-[11px] leading-relaxed thin-scrollbar">
              <code>{SCHEMA_SQL}</code>
            </pre>
          </CardContent>
        </Card>

        {/* 数据与关于 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" />
              数据与关于
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">前端</p>
                <p className="mt-0.5 font-medium">React 19 + Vite</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">样式</p>
                <p className="mt-0.5 font-medium">Tailwind + shadcn/ui</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">数据库</p>
                <p className="mt-0.5 font-medium">Supabase Postgres</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">存储</p>
                <p className="mt-0.5 font-medium">Supabase Storage</p>
              </div>
            </div>

            {!isCloud ? (
              <Alert>
                <AlertTitle>演示数据说明</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    当前商品数据保存在浏览器 localStorage，换设备或清缓存会丢失。连接云端后即可跨设备使用。
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
                    <RotateCcw className="size-3.5" />
                    重置演示数据
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                数据实时写入云端数据库，任何设备登录同一账号都能看到最新商品资料。
              </p>
            )}
          </CardContent>
        </Card>
      </div>


      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="重置演示数据？"
        description="会把本地演示商品恢复为初始的 24 个示例商品，你手动新增的内容将丢失。"
        confirmText="确认重置"
        onConfirm={() => {
          resetDemoData()
          bumpData()
          void loadCount()
          toast.success("演示数据已重置")
        }}
      />
    </div>
  )
}
