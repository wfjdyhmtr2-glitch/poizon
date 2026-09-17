import type { CloudConfig } from "./types"

const LS_KEY = "yunguan.cloud.config"
/** 用户主动断开云端后写入的标记：即便构建时注入了默认配置，也不再自动启用 */
const DISABLED = "__disabled__"

function envValue(key: string): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return (env[key] || "").trim()
}

/** 构建时注入的配置（部署前可通过 .env.production 预设） */
export function envConfig(): CloudConfig | null {
  const url = envValue("VITE_SUPABASE_URL")
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY")
  if (url && anonKey) return { url, anonKey }
  return null
}

export function loadCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === DISABLED) return null
    if (raw) {
      const parsed = JSON.parse(raw) as CloudConfig
      if (parsed?.url && parsed?.anonKey) return parsed
    }
  } catch {
    /* ignore */
  }
  return envConfig()
}

export function saveCloudConfig(config: CloudConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(config))
}

export function clearCloudConfig() {
  localStorage.setItem(LS_KEY, DISABLED)
}

export function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "")
}

export function isValidCloudConfig(config: CloudConfig | null): boolean {
  if (!config) return false
  if (!/^https?:\/\/.+/i.test(config.url)) return false
  return config.anonKey.length > 20
}
