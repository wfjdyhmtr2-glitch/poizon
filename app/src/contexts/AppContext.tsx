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
import { SUPER_ADMIN_EMAIL } from "@/lib/constants"
import type { AppMember, CloudConfig } from "@/lib/types"

interface AppContextValue {
  config: CloudConfig | null
  isCloud: boolean
  backend: Backend
  user: AuthUser | null
  authReady: boolean
  health: { ok: boolean; message: string } | null
  healthLoading: boolean
  dataVersion: number
  /** 当前账号的成员档案（含角色）；不在白名单里为 null */
  membership: AppMember | null
  /** 管理员：可管理账号、可删除业务数据；普通成员只能查看与录入 */
  isAdmin: boolean
  refreshMembership: () => Promise<void>
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
  const [membership, setMembership] = useState<AppMember | null>(null)

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

  // 登录后读取成员档案，得到当前账号的角色。角色被管理员改过之后，
  // 下一次 bumpData（任何一次数据刷新）就会重新拉取，不需要手动重登。
  const refreshMembership = useCallback(async () => {
    if (!user) {
      setMembership(null)
      return
    }
    try {
      setMembership(await backend.getMyMembership())
    } catch {
      setMembership(null)
    }
  }, [backend, user])

  useEffect(() => {
    void refreshMembership()
  }, [refreshMembership, dataVersion])

  const isAdmin =
    membership?.role === "admin" ||
    (user?.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()

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
      membership,
      isAdmin,
      refreshMembership,
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
    [backend, config, dataVersion, health, healthLoading, isAdmin, membership, refreshHealth, refreshMembership, user],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp 必须在 AppProvider 内部使用")
  return ctx
}
