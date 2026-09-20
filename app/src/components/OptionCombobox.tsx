import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { Check, ChevronDown } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type OptionComboboxProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  /** 候选清单（内置常用值 + 历史记录里出现过的值） */
  options: string[]
  placeholder?: string
  /** 无障碍名称，同时用于下拉按钮的 aria-label */
  label?: string
  /** 下拉底部的提示文案 */
  hint?: string
  className?: string
}

/**
 * 可选也可输的输入框：点一下弹出候选清单（可搜索、可键盘上下选择），
 * 也能像普通输入框一样直接写新的名字 —— 写过的值下次会自动出现在候选里。
 *
 * 之所以不做成纯下拉（只有选、不能填），是因为费用类别 / 平台本来就是开源的，
 * 写死一份清单迟早又会出现「选不到」的情况。
 */
export function OptionCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  label,
  hint,
  className,
}: OptionComboboxProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // 只有「用户正在打字」时才按输入内容筛候选；刚展开下拉要看到全部候选，
  // 否则输入框里已有值（如「保证金」）会让候选只剩它自己一项，看起来像没得选。
  const [query, setQuery] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)

  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!keyword) return options
    return options.filter((option) => option.toLowerCase().includes(keyword))
  }, [options, keyword])

  function openList() {
    setQuery("")
    setOpen(true)
  }

  // 换了关键词就把高亮重置到第一项，键盘一路往下按更符合直觉
  useEffect(() => {
    setActiveIndex(open && filtered.length > 0 ? 0 : -1)
  }, [open, keyword, filtered.length])

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function pick(option: string) {
    onChange(option)
    setQuery("")
    setOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) {
        openList()
        return
      }
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : -1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) return
      setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : -1))
    } else if (e.key === "Enter") {
      // 下拉开着且有高亮项 → 选中它；否则保留手输的值，只把下拉收起来
      if (!open) return
      e.preventDefault()
      if (activeIndex >= 0 && filtered[activeIndex]) pick(filtered[activeIndex])
      else setOpen(false)
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="pr-8"
        onChange={(e) => {
          onChange(e.target.value)
          // 只有真人敲键盘才自动展开 + 按输入筛选；程序化赋值（脚本 / 自动填充）不弹窗
          if (document.activeElement === e.target) {
            setQuery(e.target.value)
            setOpen(true)
          }
        }}
        onClick={() => openList()}
        onKeyDown={handleKeyDown}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) openList()
          else setOpen(false)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label ?? "选项"}展开候选`}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 transition-colors"
          >
            <ChevronDown className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          // 不抢输入框的焦点，才能「边打字边筛」
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] min-w-44 p-1"
        >
          <div ref={listRef} className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-xs">
                没有匹配的候选，直接输入就能用
              </p>
            ) : (
              filtered.map((option, index) => {
                const current = option === value.trim()
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => pick(option)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      index === activeIndex && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="truncate">{option}</span>
                    {current ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })
            )}
          </div>
          <p className="text-muted-foreground border-t px-2 py-1.5 text-[11px]">
            {hint ?? "也可以直接手写，写过的值下次会自动出现在这里"}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
