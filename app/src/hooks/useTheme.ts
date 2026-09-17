import { useCallback, useEffect, useState } from "react"

const KEY = "yunguan.theme"

export type Theme = "light" | "dark"

function readInitial(): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/** 在 React 挂载前先把主题类挂到 <html>，避免首屏闪白 */
export function initTheme() {
  const theme = readInitial()
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readInitial())

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.colorScheme = theme
    localStorage.setItem(KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"))
  }, [])

  return { theme, setTheme, toggle }
}
