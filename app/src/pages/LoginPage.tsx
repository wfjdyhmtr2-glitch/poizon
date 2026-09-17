import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  BarChart3,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Package,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useApp } from "@/contexts/AppContext"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const FEATURES = [
  { icon: BarChart3, title: "数据看板", detail: "库存总值、预警与分类分布一眼看清" },
  { icon: Package, title: "商品管理", detail: "颜色尺码材质季节，服装品类字段齐全" },
  { icon: Upload, title: "批量导入", detail: "Excel / CSV 一次导入上百个 SKU" },
  { icon: ShieldCheck, title: "云端持久化", detail: "Supabase 数据库 + 对象存储" },
]

export function LoginPage() {
  const { signIn, signUp, isCloud, backend } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error("请填写邮箱和密码")
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      if (tab === "signin") {
        await signIn(email.trim(), password)
        toast.success("登录成功")
        navigate("/finance", { replace: true })
      } else {
        const result = await signUp(email.trim(), password)
        if (result.needsConfirm) {
          setNotice("注册成功，但还需要邮箱验证。请到邮箱点确认链接后再登录。")
          setTab("signin")
        } else {
          toast.success("注册成功，已自动登录")
          navigate("/finance", { replace: true })
        }
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* 左侧品牌区 */}
      <div className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(120% 90% at 0% 0%, hsl(243 82% 32%) 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, hsl(190 80% 28%) 0%, transparent 55%)",
          }}
        />
        <div className="grid-dots pointer-events-none absolute inset-0 opacity-[0.14]" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white/12 backdrop-blur">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-base font-semibold">得物</p>
              <p className="text-xs text-white/60">Dewu Shop Console</p>
            </div>
          </div>

          <h1 className="mt-14 max-w-md text-[34px] font-semibold leading-tight tracking-tight">
            把得物商品
            <br />
            管得明明白白
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/65">
            登录认证、数据看板、列表管理、表单编辑、Excel 导入、图片上传——一个后台全都覆盖，
            数据存在云端数据库，随时随地在任何设备上打开。
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur transition-colors hover:bg-white/[0.1]"
              >
                <f.icon className="size-4 text-white/80" />
                <p className="mt-2 text-sm font-medium">{f.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/55">{f.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/40">
          React · TypeScript · Tailwind · Supabase
        </p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px] animate-in-up">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">得物</p>
              <p className="text-[11px] text-muted-foreground">商品管理系统</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">
            {tab === "signin" ? "欢迎回来" : "创建后台账号"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isCloud
              ? "使用你在 Supabase 中创建的管理员账号登录"
              : "当前是本地演示模式，可直接用演示账号体验全部功能"}
          </p>

          <div
            className={cn(
              "mt-5 flex items-start gap-2 rounded-xl border p-3 text-xs",
              isCloud
                ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-400",
            )}
          >
            <Database className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{backend.label}</p>
              {isCloud ? null : (
                <p className="mt-0.5 leading-relaxed">
                  演示账号 <span className="font-mono">admin@demo.com</span> / 密码{" "}
                  <span className="font-mono">admin888</span>
                  ，数据只保存在本机浏览器。
                </p>
              )}
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">登录</TabsTrigger>
              <TabsTrigger value="signup">注册</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5">
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">邮箱</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="至少 6 位"
                      className="pl-9 pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {notice ? (
                  <Alert>
                    <AlertTitle>还差一步</AlertTitle>
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                ) : null}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                  登录后台
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email2">邮箱</Label>
                  <Input
                    id="email2"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">密码</Label>
                  <Input
                    id="password2"
                    type="password"
                    autoComplete="new-password"
                    placeholder="至少 6 位"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  注册后如果开启了邮箱验证，需要先到邮箱点确认链接。也可以在 Supabase 的
                  Authentication → Users 里手动添加并勾选 Auto Confirm。
                </p>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                  注册账号
                </Button>
              </form>
            </TabsContent>
          </Tabs>

        </div>
      </div>

    </div>
  )
}
