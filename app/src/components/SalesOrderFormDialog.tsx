import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Boxes, Calculator, Loader2, Save, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TradeStageBadge } from "@/components/common"
import { ORDER_STATUSES, STOCK_EFFECT_META, TRADE_STAGE_META } from "@/lib/constants"
import {
  computeTradeStage,
  emptySalesDraft,
  fromDateTimeInput,
  isKnownOrderStatus,
  orderStockEffect,
  toDateTimeInput,
} from "@/lib/sales"
import { formatMoney } from "@/lib/format"
import type { Product, SalesOrder, SalesOrderDraft } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/** 常见售后类型，可自由输入 */
const AFTER_SALES_PRESETS = ["无", "仅退款", "退货退款", "换货", "平台介入"]

export function SalesOrderFormDialog({
  open,
  onOpenChange,
  order,
  products,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入则为编辑，为空则新增 */
  order: SalesOrder | null
  products: Product[]
  onSave: (draft: SalesOrderDraft, id: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState<SalesOrderDraft>(emptySalesDraft())
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    if (order) {
      const { id: _id, created_at: _c, updated_at: _u, trade_stage: _s, ...rest } = order
      setDraft(rest)
    } else {
      setDraft(emptySalesDraft())
    }
    setErrors({})
  }, [open, order])

  function patch(next: Partial<SalesOrderDraft>) {
    setDraft((prev) => ({ ...prev, ...next }))
  }

  /**
   * 实时把「订单状态 + 是否退货」翻译成业务含义，
   * 录入时就能看出这单到底算不算成交。
   */
  const stage = useMemo(
    () => computeTradeStage(draft.order_status, draft.is_returned),
    [draft.order_status, draft.is_returned],
  )
  const stageMeta = TRADE_STAGE_META[stage] ?? TRADE_STAGE_META.unknown
  const stockEffect = useMemo(
    () => orderStockEffect(draft.order_status, draft.is_returned, draft.is_settled),
    [draft.order_status, draft.is_returned, draft.is_settled],
  )
  const matchedProduct = useMemo(
    () => products.find((p) => p.sku === draft.sku.trim()) ?? null,
    [products, draft.sku],
  )
  const unitCost = matchedProduct?.cost_price ?? null
  const netProfit =
    unitCost !== null && draft.expected_income !== null
      ? Number((draft.expected_income - unitCost).toFixed(2))
      : null

  function validate() {
    const next: Record<string, string> = {}
    if (!draft.order_no.trim()) next.order_no = "请填写订单号"
    if (!draft.sku.trim()) next.sku = "请填写 spuID"
    if (!isKnownOrderStatus(draft.order_status)) {
      next.order_status = "订单状态不在 交易成功 / 交易失败 / 交易关闭成功 之内"
    }
    if (draft.bid_amount !== null && draft.bid_amount < 0) next.bid_amount = "出价金额不能为负"
    if (draft.expected_income !== null && draft.expected_income < 0) {
      next.expected_income = "预计收入不能为负"
    }
    setErrors(next)
    return Object.values(next)[0] ?? null
  }

  async function submit() {
    const problem = validate()
    if (problem) {
      toast.error(`请先修正：${problem}`)
      return
    }
    setSaving(true)
    try {
      await onSave(
        {
          ...draft,
          order_no: draft.order_no.trim(),
          sku: draft.sku.trim(),
          spec: draft.spec?.trim() || null,
          after_sales: draft.after_sales?.trim() || null,
        },
        order?.id ?? null,
      )
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto thin-scrollbar sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{order ? "编辑销售订单" : "手动新增销售订单"}</DialogTitle>
          <DialogDescription>
            订单状态与是否退货会自动推导出交易阶段，判断这单算不算真实成交。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="order-no">
              订单号 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="order-no"
              value={draft.order_no}
              placeholder="DW260900001234"
              onChange={(e) => patch({ order_no: e.target.value })}
              className={cn("font-mono text-sm", errors.order_no && "border-destructive")}
            />
            {errors.order_no ? (
              <p className="text-xs text-destructive">{errors.order_no}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-sku">
              spuID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="order-sku"
              list="sales-spu-options"
              value={draft.sku}
              placeholder="对应商品管理里的 SPUID"
              onChange={(e) => patch({ sku: e.target.value })}
              className={cn("font-mono text-sm", errors.sku && "border-destructive")}
            />
            <datalist id="sales-spu-options">
              {products.slice(0, 300).map((p) => (
                <option key={p.id} value={p.sku}>
                  {p.name}
                </option>
              ))}
            </datalist>
            {matchedProduct ? (
              <p className="text-xs text-muted-foreground">
                已匹配：{matchedProduct.name}
                {unitCost !== null ? ` · 成本 ${formatMoney(unitCost)}` : " · 未填成本价"}
              </p>
            ) : draft.sku.trim() ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                商品库里没有这个 SPUID，仍可保存，但看板里按「未匹配」统计
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-spec">规格</Label>
            <Input
              id="order-spec"
              value={draft.spec ?? ""}
              placeholder="黑色 / M"
              onChange={(e) => patch({ spec: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>订单状态</Label>
            <Select
              value={draft.order_status}
              onValueChange={(v) => patch({ order_status: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-bid">出价金额（元）</Label>
            <Input
              id="order-bid"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={draft.bid_amount ?? ""}
              placeholder="你在平台的报价"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) =>
                patch({ bid_amount: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-income">预计收入金额（元）</Label>
            <Input
              id="order-income"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={draft.expected_income ?? ""}
              placeholder="扣掉平台费后到手"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) =>
                patch({ expected_income: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-after-sales">售后服务</Label>
            <Input
              id="order-after-sales"
              list="after-sales-options"
              value={draft.after_sales ?? ""}
              placeholder="无 / 退货退款 / 仅退款"
              onChange={(e) => patch({ after_sales: e.target.value })}
            />
            <datalist id="after-sales-options">
              {AFTER_SALES_PRESETS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-paid">买家支付时间</Label>
            <Input
              id="order-paid"
              type="datetime-local"
              value={toDateTimeInput(draft.paid_at)}
              onChange={(e) => patch({ paid_at: fromDateTimeInput(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              未付款的订单可以留空
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3.5">
            <div>
              <p className="text-sm font-medium">是否退货</p>
              <p className="text-xs text-muted-foreground">交易成功时勾选＝签收后退款</p>
            </div>
            <Switch
              id="is-returned"
              checked={draft.is_returned}
              onCheckedChange={(v) => patch({ is_returned: v })}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3.5">
            <div>
              <p className="text-sm font-medium">是否结算</p>
              <p className="text-xs text-muted-foreground">平台是否已把钱打给你</p>
            </div>
            <Switch
              id="is-settled"
              checked={draft.is_settled}
              onCheckedChange={(v) => patch({ is_settled: v })}
            />
          </div>

          <Alert className="sm:col-span-2">
            <AlertDescription className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Sparkles className="size-4 text-primary" />
                <span className="text-muted-foreground">这单会被算作</span>
                <TradeStageBadge stage={stage} />
                <span className="text-xs text-muted-foreground">{stageMeta.detail}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calculator className="size-3.5" />
                  计入收入：{stageMeta.countsAsIncome ? "是" : "否"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Boxes className="size-3.5" />
                  库存影响：
                  <span
                    className={cn(
                      "font-medium",
                      stockEffect === "locked" && "text-amber-600 dark:text-amber-400",
                      stockEffect === "consumed" && "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {STOCK_EFFECT_META[stockEffect]?.label}
                  </span>
                  <span>（{STOCK_EFFECT_META[stockEffect]?.detail}）</span>
                </span>
                {netProfit !== null && stageMeta.countsAsIncome ? (
                  <span>
                    预计毛利{" "}
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        netProfit >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {formatMoney(netProfit)}
                    </span>
                  </span>
                ) : null}
                {errors.order_status ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-3.5" />
                    {errors.order_status}
                  </span>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {order ? "保存修改" : "创建订单"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
