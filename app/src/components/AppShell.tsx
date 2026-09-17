import { useEffect, useState, type ReactNode } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3,
  ClipboardList,
  Cloud,
  CloudOff,
  Database,
  Images,
  Landmark,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Package,
  RefreshCcw,
  Settings,
  ShoppingBag,
  Sun,
  TrendingUp,
  Upload,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useApp } from "@/contexts/AppContext"
import { useTheme } from "@/hooks/useTheme"
import { toast } from "sonner"

const NAV_GROUPS: {
  label: string
  items: { to: string; label: string; icon: typeof BarChart3; hint: string }[]
}[] = [
  {
    label: "概览",
    items: [
      { to: "/finance", label: "财务看板", icon: Landmark, hint: "花了多少、赚了多少" },
      { to: "/dashboard", label: "数据看板", icon: BarChart3, hint: "商品与库存概览" },
      { to: "/sales", label: "销售看板", icon: TrendingUp, hint: "成交、退款与收入" },
    ],
  },
  {
    label: "经营",
    items: [
      { to: "/products", label: "商品管理", icon: Package, hint: "商品资料与价格" },
      { to: "/purchases", label: "入仓管理", icon: ClipboardList, hint: "采购订单维度" },
      { to: "/images", label: "商品信息", icon: Images, hint: "SPUID 名称与主图登记" },
      { to: "/sales/orders", label: "销售订单", icon: ShoppingBag, hint: "订单录入与批量导入" },
      { to: "/import", label: "商品导入", icon: Upload, hint: "商品 Excel / CSV 导入" },
    ],
  },
  {
    label: "系统",
    items: [{ to: "/settings", label: "系统设置", icon: Settings, hint: "云端连接与账号" }],
  },
]

const FLAT_NAV = NAV_GROUPS.flatMap((group) => group.items)

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, isCloud, health, refreshHealth } = useApp()
  const { theme, toggle } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // 取匹配最深的那个路由，避免 /sales/orders 被 /sales 抢走标题
  const current = [...FLAT_NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => location.pathname.startsWith(item.to))

  async function handleSignOut() {
    try {
      await signOut()
      toast.success("已退出登录")
      navigate("/login", { replace: true })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarInner />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[276px] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <SheetDescription className="sr-only">店铺商品管理后台导航</SheetDescription>
          <SidebarInner />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 glass">
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
            >
              <Menu className="size-5" />
            </Button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{current?.label ?? "云铺管家"}</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {current?.hint ?? "店铺商品管理后台"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refreshHealth()}
              className={cn(
                "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors md:inline-flex",
                health?.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              {health?.ok ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
              {health?.ok ? (isCloud ? "云端已连接" : "演示模式") : "未连接云端"}
            </button>

            <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换主题">
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="账号菜单">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {(user?.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{user?.email ?? "未登录"}</p>
                      <p className="text-xs text-muted-foreground">
                        {isCloud ? "云端账号" : "演示账号"}
                      </p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <Settings className="size-4" />
                  系统设置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void refreshHealth()}>
                  <RefreshCcw className="size-4" />
                  检查云端连接
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
                  <LogOut className="size-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main key={location.pathname} className="animate-in-up px-3 py-5 sm:px-5 sm:py-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1400px] space-y-5">{children}</div>
        </main>
      </div>

    </div>
  )
}

function SidebarInner() {
  const { isCloud, user } = useApp()

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LayoutGrid className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">云铺管家</p>
          <p className="truncate text-[11px] text-muted-foreground">店铺商品管理系统</p>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="flex-1 space-y-4 overflow-y-auto p-3 thin-scrollbar">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-3 p-3">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Database className="size-3.5 text-muted-foreground" />
            <span className="truncate">{isCloud ? "云端数据库" : "本地演示数据"}</span>
          </div>
        </div>
        <p className="truncate px-1 text-[11px] text-muted-foreground">{user?.email ?? ""}</p>
      </div>
    </div>
  )
}
