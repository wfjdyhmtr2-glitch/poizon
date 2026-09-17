import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { AuthUser, Backend } from "@/lib/backend"
import { createCloudBackend } from "@/lib/cloudBackend"
import { createDemoBackend } from "@/lib/demoBackend"
import { clearCloudConfig, loadCloudConfig, saveCloudConfig } from "@/lib/cloud"
import type { CloudConfig } from "@/lib/types"

interface AppContextValue {
  config: CloudConfig | null
  isCloud: boolean
  backend: Backend
  user: AuthUser | null
  authReady: boolean
  health: { ok: boolean; message: string } | null
  healthLoading: boolean
  dataVersion: number
  applyCloudConfig: (config: CloudConfig) => void
  disconnectCloud: () => void
  refreshHealth: () => Promise<void>
  bumpData: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<{ needsConfirm: boolean }>
  signOut: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<CloudConfig | null>(() => loadCloudConfig())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)

  const backend = useMemo<Backend>(
    () => (config ? createCloudBackend(config) : createDemoBackend()),
    [config],
  )

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const result = await backend.checkHealth()
      setHealth(result)
    } catch (error) {
      setHealth({ ok: false, message: (error as Error).message })
    } finally {
      setHealthLoading(false)
    }
  }, [backend])

  useEffect(() => {
    let alive = true
    setAuthReady(false)
    backend
      .getSession()
      .then((session) => {
        if (alive) setUser(session)
      })
      .catch(() => {
        if (alive) setUser(null)
      })
      .finally(() => {
        if (alive) setAuthReady(true)
      })

    const unsubscribe = backend.onAuthChange((next) => {
      if (alive) setUser(next)
    })

    if (backend.kind === "cloud") {
      backend
        .checkHealth()
        .then((result) => {
          if (alive) setHealth(result)
        })
        .catch((error: Error) => {
          if (alive) setHealth({ ok: false, message: error.message })
        })
    } else {
      setHealth({ ok: true, message: "演示模式运行中（数据仅保存在本机浏览器）" })
    }

    return () => {
      alive = false
      unsubscribe()
    }
  }, [backend])

  const value = useMemo<AppContextValue>(
    () => ({
      config,
      isCloud: Boolean(config),
      backend,
      user,
      authReady,
      health,
      healthLoading,
      dataVersion,
      applyCloudConfig(next: CloudConfig) {
        saveCloudConfig(next)
        setConfig(next)
        setUser(null)
      },
      disconnectCloud() {
        clearCloudConfig()
        setConfig(null)
        setUser(null)
      },
      refreshHealth,
      bumpData() {
        setDataVersion((v) => v + 1)
      },
      async signIn(email: string, password: string) {
        await backend.signIn(email, password)
        const session = await backend.getSession()
        setUser(session)
      },
      async signUp(email: string, password: string) {
        const result = await backend.signUp(email, password)
        const session = await backend.getSession()
        setUser(session)
        return result
      },
      async signOut() {
        await backend.signOut()
        setUser(null)
      },
    }),
    [backend, config, dataVersion, health, healthLoading, refreshHealth, user],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp 必须在 AppProvider 内部使用")
  return ctx
}
