import { lazy, Suspense, type ReactNode } from "react"
import { HashRouter, Link, Navigate, Route, Routes } from "react-router-dom"
import { Loader2, Lock } from "lucide-react"
import { AppProvider, useApp } from "@/contexts/AppContext"
import { AppShell } from "@/components/AppShell"
import { LoginPage } from "@/pages/LoginPage"
import { ProductsPage } from "@/pages/ProductsPage"
import { SalesOrdersPage } from "@/pages/SalesOrdersPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { PERMISSION_MODULES, type ModuleId } from "@/lib/types"

// 看板（图表库）与导入页（表格解析库）体积较大，按需加载
const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
)
const SalesDashboardPage = lazy(() =>
  import("@/pages/SalesDashboardPage").then((m) => ({ default: m.SalesDashboardPage })),
)
const ImportPage = lazy(() =>
  import("@/pages/ImportPage").then((m) => ({ default: m.ImportPage })),
)
const ImageLibraryPage = lazy(() =>
  import("@/pages/ImageLibraryPage").then((m) => ({ default: m.ImageLibraryPage })),
)
const FinanceDashboardPage = lazy(() =>
  import("@/pages/FinanceDashboardPage").then((m) => ({ default: m.FinanceDashboardPage })),
)
const PurchasesPage = lazy(() =>
  import("@/pages/PurchasesPage").then((m) => ({ default: m.PurchasesPage })),
)
const OtherExpensesPage = lazy(() =>
  import("@/pages/OtherExpensesPage").then((m) => ({ default: m.OtherExpensesPage })),
)
const TeamPage = lazy(() => import("@/pages/TeamPage").then((m) => ({ default: m.TeamPage })))
const MarketPage = lazy(() => import("@/pages/MarketPage").then((m) => ({ default: m.MarketPage })))
const SourcingPage = lazy(() =>
  import("@/pages/SourcingPage").then((m) => ({ default: m.SourcingPage })),
)

function Splash({ label = "正在准备工作台…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      加载中…
    </div>
  )
}

function Protected({ children }: { children: ReactNode }) {
  const { user, authReady } = useApp()
  if (!authReady) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  // 团队成员共享同一份店铺数据；能不能看/能不能改由模块权限决定（数据库 RLS 同步把关）
  return <AppShell>{children}</AppShell>
}

/**
 * 没有权限时的提示页。
 * 不传 module 表示「这个页面本身就不该给普通成员看」。
 */
function NoAccess({ module }: { module?: ModuleId }) {
  const { canView, user } = useApp()
  const label = module ? PERMISSION_MODULES.find((m) => m.id === module)?.label : null
  const fallback = PERMISSION_MODULES.find((m) => canView(m.id))
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Lock className="size-7 text-muted-foreground" />
      <p className="text-base font-medium">
        {label ? `没有访问「${label}」的权限` : "当前账号没有访问这个页面的权限"}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        模块权限由管理员在「成员管理」里逐项开通。
        {user?.email ? `当前登录账号：${user.email}` : ""}
      </p>
      {fallback ? (
        <Link to={fallback.to} className="text-sm text-primary underline underline-offset-4">
          去「{fallback.label}」
        </Link>
      ) : null}
    </div>
  )
}

/**
 * 模块门禁：没有「可查看」权限就不让进页面。
 * 这层只管体验（避免进去看到一个空列表）；真正的安全边界在数据库 RLS。
 */
function ModuleGate({ module, children }: { module: ModuleId; children: ReactNode }) {
  const { canView, membershipLoaded } = useApp()
  // 权限还没读回来时先等，否则会把「加载中」误判成「没权限」
  if (!membershipLoaded) return <Splash label="正在读取权限…" />
  if (!canView(module)) return <NoAccess module={module} />
  return <>{children}</>
}

/** 仅管理员可进（成员管理） */
function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin, membershipLoaded } = useApp()
  if (!membershipLoaded) return <Splash label="正在读取权限…" />
  if (!isAdmin) return <NoAccess />
  return <>{children}</>
}

/** 进首页时落到**第一个有权限**的模块；一个都没开就提示去找管理员 */
function HomeRedirect() {
  const { authReady, canView, membershipLoaded, user } = useApp()
  if (!authReady) return <Splash />
  // 未登录必须先回登录页，否则会被判定成「没有权限」
  if (!user) return <Navigate to="/login" replace />
  if (!membershipLoaded) return <Splash label="正在读取权限…" />
  const first = PERMISSION_MODULES.find((m) => canView(m.id))
  return first ? <Navigate to={first.to} replace /> : <NoAccess />
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, authReady } = useApp()
  if (!authReady) return <Splash />
  // 登录后统一走 HomeRedirect，由它挑第一个有权限的模块
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
            <Route
        path="/finance"
        element={
          <Protected>
            <ModuleGate module="finance">
              <Suspense fallback={<PageFallback />}>
                <FinanceDashboardPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/purchases"
        element={
          <Protected>
            <ModuleGate module="purchases">
              <Suspense fallback={<PageFallback />}>
                <PurchasesPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/other-expenses"
        element={
          <Protected>
            <ModuleGate module="other_expenses">
              <Suspense fallback={<PageFallback />}>
                <OtherExpensesPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/team"
        element={
          <Protected>
            <AdminGate>
              <Suspense fallback={<PageFallback />}>
                <TeamPage />
              </Suspense>
            </AdminGate>
          </Protected>
        }
      />
            <Route
        path="/market"
        element={
          <Protected>
            <ModuleGate module="market">
              <Suspense fallback={<PageFallback />}>
                <MarketPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
      {/* 合并后的「找同款比价」：/lookup 是导航主入口；
          /capture 继续保留，兼容已经拖到书签栏的采集书签 */}
            <Route
        path="/lookup"
        element={
          <Protected>
            <ModuleGate module="sourcing">
              <Suspense fallback={<PageFallback />}>
                <SourcingPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/capture"
        element={
          <Protected>
            <ModuleGate module="sourcing">
              <Suspense fallback={<PageFallback />}>
                <SourcingPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/dashboard"
        element={
          <Protected>
            <ModuleGate module="dashboard">
              <Suspense fallback={<PageFallback />}>
                <DashboardPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/products"
        element={
          <Protected>
            <ModuleGate module="products">
              <ProductsPage />
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/sales"
        element={
          <Protected>
            <ModuleGate module="sales">
              <Suspense fallback={<PageFallback />}>
                <SalesDashboardPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/sales/orders"
        element={
          <Protected>
            <ModuleGate module="sales_orders">
              <SalesOrdersPage />
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/images"
        element={
          <Protected>
            <ModuleGate module="images">
              <Suspense fallback={<PageFallback />}>
                <ImageLibraryPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
            <Route
        path="/import"
        element={
          <Protected>
            <ModuleGate module="import">
              <Suspense fallback={<PageFallback />}>
                <ImportPage />
              </Suspense>
            </ModuleGate>
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProvider>
  )
}
