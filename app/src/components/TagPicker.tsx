import { useState } from "react"
import { Check, Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function TagPicker({
  value,
  onChange,
  options = [],
  placeholder = "输入后回车添加",
  max,
}: {
  value: string[]
  onChange: (next: string[]) => void
  options?: string[]
  placeholder?: string
  max?: number
}) {
  const [draft, setDraft] = useState("")

  function toggle(item: string) {
    if (value.includes(item)) onChange(value.filter((v) => v !== item))
    else if (!max || value.length < max) onChange([...value, item])
  }

  function addCustom() {
    const text = draft.trim()
    if (!text) return
    if (value.includes(text)) {
      setDraft("")
      return
    }
    if (max && value.length >= max) return
    onChange([...value, text])
    setDraft("")
  }

  const extras = value.filter((v) => !options.includes(v))

  return (
    <div className="space-y-2.5">
      {options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = value.includes(option)
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggle(option)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {active ? <Check className="size-3" /> : null}
                {option}
              </button>
            )
          })}
        </div>
      ) : null}

      {extras.length ? (
        <div className="flex flex-wrap gap-1.5">
          {extras.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              {item}
              <button
                type="button"
                onClick={() => toggle(item)}
                aria-label={`移除 ${item}`}
                className="rounded-sm hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCustom()
            }
          }}
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={addCustom}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>
    </div>
  )
}
