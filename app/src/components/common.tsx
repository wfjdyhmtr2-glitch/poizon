import type { ReactNode } from "react"
import { useState } from "react"
import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { STATUS_META, STOCK_EFFECT_META, TRADE_STAGE_META } from "@/lib/constants"
import { formatMoney, placeholderImage } from "@/lib/format"

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap font-normal", meta.className, className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  )
}

export function TradeStageBadge({
  stage,
  className,
}: {
  stage: string
  className?: string
}) {
  const meta = TRADE_STAGE_META[stage] ?? TRADE_STAGE_META.unknown
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap font-normal", meta.className, className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  )
}

export function StockEffectBadge({
  effect,
  className,
}: {
  effect: string
  className?: string
}) {
  const meta = STOCK_EFFECT_META[effect] ?? STOCK_EFFECT_META.released
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 whitespace-nowrap font-normal", meta.className, className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  )
}

/** 可用 / 锁定 两行式库存显示，锁定时标黄，超卖标红 */
export function StockCell({
  stock,
  locked,
  className,
}: {
  stock: number
  locked: number
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "tabular-nums",
          stock < 0 ? "font-medium text-destructive" : "",
        )}
      >
        {stock < 0 ? `超卖 ${Math.abs(stock)}` : stock}
      </span>
      {locked > 0 ? (
        <span className="text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
          锁 {locked}
        </span>
      ) : null}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: "default" | "primary" | "warning" | "danger" | "success"
}) {
  const tones: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/12 text-primary",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    danger: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-semibold tabular-nums sm:text-[26px]">
            {value}
          </p>
          {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              tones[tone],
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function LoadingBlock({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/12 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div>
        <p className="font-medium">出错了</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          重试
        </button>
      ) : null}
    </div>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmText?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={(event) => {
              event.preventDefault()
              void Promise.resolve(onConfirm()).then(() => onOpenChange(false))
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MoneyText({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(value)}</span>
}

/** 商品缩略图：没有图或图片加载失败时，自动退回到生成的占位图，避免出现裂图 */
export function ProductThumb({
  src,
  name,
  className,
}: {
  src?: string | null
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const url = src && src.trim() && !failed ? src : placeholderImage(name, name.length)
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
