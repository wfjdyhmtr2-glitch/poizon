import { lazy, Suspense, type ReactNode } from "react"
import { HashRouter, Navigate, Route, Routes } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppProvider, useApp } from "@/contexts/AppContext"
import { AppShell } from "@/components/AppShell"
import { LoginPage } from "@/pages/LoginPage"
import { ProductsPage } from "@/pages/ProductsPage"
import { SalesOrdersPage } from "@/pages/SalesOrdersPage"
import { SettingsPage } from "@/pages/SettingsPage"

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
const PriceCapturePage = lazy(() =>
  import("@/pages/PriceCapturePage").then((m) => ({ default: m.PriceCapturePage })),
)
const LookupPage = lazy(() => import("@/pages/LookupPage").then((m) => ({ default: m.LookupPage })))

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
  // 每个账号只看到自己的数据（数据库 RLS 按 owner_id 隔离，管理员可见全部）
  return <AppShell>{children}</AppShell>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, authReady } = useApp()
  if (!authReady) return <Splash />
  if (user) return <Navigate to="/finance" replace />
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
            <Suspense fallback={<PageFallback />}>
              <FinanceDashboardPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/purchases"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <PurchasesPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/other-expenses"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <OtherExpensesPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/team"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <TeamPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/market"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <MarketPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/capture"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <PriceCapturePage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/lookup"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <LookupPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <DashboardPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/products"
        element={
          <Protected>
            <ProductsPage />
          </Protected>
        }
      />
      <Route
        path="/sales"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <SalesDashboardPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/sales/orders"
        element={
          <Protected>
            <SalesOrdersPage />
          </Protected>
        }
      />
      <Route
        path="/images"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <ImageLibraryPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/import"
        element={
          <Protected>
            <Suspense fallback={<PageFallback />}>
              <ImportPage />
            </Suspense>
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
      <Route path="/" element={<Navigate to="/finance" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
