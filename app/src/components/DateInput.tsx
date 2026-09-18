import { useEffect, useState } from "react"
import { CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * 日期输入框：**键盘直接打字** + 右侧点开日历，两种方式都支持。
 *
 * 为什么不用原生 `<input type="date">`：它在各浏览器里的键盘体验差异很大
 * （Safari 基本只能点选、没法直接键入，也不支持粘贴 `2026-09-18`），
 * 分段输入的焦点也很不直观。这里用文本框承接键盘输入，把原生控件
 * 缩成一块透明的「日历热区」盖在右侧，兼顾两种习惯。
 *
 * 接受的写法：`2026-09-18`、`2026/9/18`、`2026.9.18`、`20260918`（敲满 8 位自动补分隔符）。
 * 对外始终是 `YYYY-MM-DD`，空字符串表示未填。
 */

const DATE_RE = /^(\d{4})\D*(\d{1,2})\D*(\d{1,2})$/

/** 把用户敲进去的各种写法归一化成 YYYY-MM-DD；解析不出来返回 null，空串返回 "" */
export function normalizeDateInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return ""
  const m = DATE_RE.exec(text.replace(/\s/g, ""))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 再反查一次，挡掉 2026-02-31 这种日历上不存在的日期
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}`
}

export function DateInput({
  id,
  value,
  onChange,
  placeholder = "如 2026-09-18",
  className,
  disabled,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [text, setText] = useState(value)

  // 外部值变化（日历选择、表单重置）时同步回输入框
  useEffect(() => {
    setText(value)
  }, [value])

  function commit(raw: string) {
    const next = normalizeDateInput(raw)
    if (next === null) return
    if (next !== value) onChange(next)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => {
          const next = normalizeDateInput(text)
          if (next === null) {
            setText(value) // 没敲完整就还原，别留下半截日期
          } else {
            setText(next)
            commit(next)
          }
        }}
        className={cn("pr-10 tabular-nums", className)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
        <CalendarDays className="size-4" />
      </span>
      {/* 透明的原生日期控件盖在右侧，点这里就是点开系统日历 */}
      <input
        type="date"
        tabIndex={-1}
        aria-label="用日历选择日期"
        disabled={disabled}
        value={value || ""}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          onChange(next)
        }}
        className="absolute inset-y-0 right-0 w-10 cursor-pointer rounded-r-md opacity-0"
      />
    </div>
  )
}
