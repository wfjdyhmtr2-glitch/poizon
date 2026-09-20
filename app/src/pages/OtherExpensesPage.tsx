import { useCallback, useEffect, useMemo, useState } from "react"
import { Coins, Plus, Receipt, RefreshCcw, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DateInput } from "@/components/DateInput"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ConfirmDialog,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
} from "@/components/common"
import { OptionCombobox } from "@/components/OptionCombobox"
import { useApp } from "@/contexts/AppContext"
import { OTHER_EXPENSE_CATEGORIES, OTHER_EXPENSE_PLATFORMS, mergeOptions } from "@/lib/constants"
import { formatMoney } from "@/lib/format"
import type { OtherExpense } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 输入框默认值：今天（本地时区，YYYY-MM-DD） */
function todayInput() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 金额展示：正数前面补 +，负数保持 -，收回用绿色以区别于支出 */
function AmountText({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value < 0 && "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {value > 0 ? "+" : ""}
      {formatMoney(value)}
    </span>
  )
}

export function OtherExpensesPage() {
  const { backend, dataVersion, bumpData, isAdmin } = useApp()

  const [rows, setRows] = useState<OtherExpense[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [date, setDate] = useState(todayInput)
  const [category, setCategory] = useState("保证金")
  const [platform, setPlatform] = useState("得物")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await backend.listOtherExpenses())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  const stats = useMemo(() => {
    const list = rows ?? []
    const spend = list.filter((r) => r.amount > 0).reduce((acc, r) => acc + r.amount, 0)
    const back = list.filter((r) => r.amount < 0).reduce((acc, r) => acc + r.amount, 0)
    return { spend, back, net: spend + back, count: list.length }
  }, [rows])

  // 候选 = 内置常用值 + 历史记录里真实用过的值，所以记过一次的类别 / 平台下次就能选到
  const categoryOptions = useMemo(
    () => mergeOptions(OTHER_EXPENSE_CATEGORIES, (rows ?? []).map((r) => r.category)),
    [rows],
  )
  const platformOptions = useMemo(
    () => mergeOptions(OTHER_EXPENSE_PLATFORMS, (rows ?? []).map((r) => r.platform)),
    [rows],
  )

  async function submit() {
    const value = Number(amount)
    if (!date) {
      setFormError("请选择发生日期")
      return
    }
    if (!category.trim()) {
      setFormError("请填写费用类别")
      return
    }
    if (!amount.trim() || !Number.isFinite(value)) {
      setFormError("金额要填数字；收回 / 退回的钱请填负数")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await backend.createOtherExpense({
        expense_date: date,
        category: category.trim(),
        platform: platform.trim() || null,
        amount: value,
        note: note.trim() || null,
      })
      setAmount("")
      setNote("")
      bumpData()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(ids: string[]) {
    if (!ids.length) return
    try {
      await backend.deleteOtherExpenses(ids)
      setSelected((prev) => prev.filter((id) => !ids.includes(id)))
      bumpData()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const allChecked = (rows?.length ?? 0) > 0 && selected.length === rows?.length

  if (loading && !rows) return <LoadingBlock label="正在读取其他费用…" />
  if (error && !rows) return <ErrorBlock message={error} onRetry={load} />
  if (!rows) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="其他费用"
        description="平台层面的支出，不绑定商品：保证金、仓储费、取回费、会员费等。正数记支出、负数记收回，合计后计入财务看板盈亏。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            {isAdmin && selected.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                删除选中（{selected.length}）
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="费用合计（净额）"
          value={formatMoney(stats.net)}
          hint="已计入财务看板的盈亏"
          icon={<Coins className="size-5" />}
          tone="primary"
        />
        <StatCard
          label="支出合计"
          value={formatMoney(stats.spend)}
          hint="保证金充值、仓储费等"
          icon={<TrendingDown className="size-5" />}
          tone="danger"
        />
        <StatCard
          label="收回合计"
          value={formatMoney(Math.abs(stats.back))}
          hint="保证金取回、退回等"
          icon={<TrendingUp className="size-5" />}
          tone="success"
        />
        <StatCard
          label="记录条数"
          value={stats.count}
          hint="全部为历史累计"
          icon={<Receipt className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">记一笔</CardTitle>
          <CardDescription>
            金额支持正负：充值保证金记正（如 1000），日后取回记负（如 -1000），两笔独立记账。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="oe-date">发生日期</Label>
              <DateInput id="oe-date" value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oe-amount">
                金额（元）<span className="text-muted-foreground">· 收回填负数</span>
              </Label>
              <Input
                id="oe-amount"
                inputMode="decimal"
                placeholder="如 1000 或 -200"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oe-category">费用类别</Label>
              <OptionCombobox
                id="oe-category"
                label="费用类别"
                value={category}
                onChange={setCategory}
                options={categoryOptions}
                placeholder="如 保证金 / 会员费"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oe-platform">平台（可选）</Label>
              <OptionCombobox
                id="oe-platform"
                label="平台"
                value={platform}
                onChange={setPlatform}
                options={platformOptions}
                placeholder="如 得物 / 唯品会"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Label>常用类别</Label>
              <span className="text-muted-foreground text-xs">
                点上面的输入框可展开全部候选，选不到就直接手写，写过的下次自动进候选
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OTHER_EXPENSE_CATEGORIES.map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant={category === c ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Label>常用平台</Label>
              <span className="text-muted-foreground text-xs">
                得物、唯品会、淘宝、抖店… 候选里没有的也能直接手写
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OTHER_EXPENSE_PLATFORMS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={platform === p ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPlatform(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oe-note">备注（可选）</Label>
            <Input
              id="oe-note"
              placeholder="如 9 月上旬仓储费"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={saving}>
              <Plus className="size-4" />
              {saving ? "保存中…" : "记一笔"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">费用明细</CardTitle>
          <CardDescription>按发生日期倒序，共 {stats.count} 条</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              还没有记录。用上面的表单记第一笔费用。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[44px]">
                      <Checkbox
                        checked={allChecked}
                        aria-label="全选"
                        onCheckedChange={(checked) =>
                          setSelected(checked ? rows.map((r) => r.id) : [])
                        }
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">发生日期</TableHead>
                    <TableHead className="w-[120px]">类别</TableHead>
                    <TableHead className="w-[110px]">平台</TableHead>
                    <TableHead className="w-[140px]">金额</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="w-[90px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.includes(row.id)}
                          aria-label={`选择 ${row.category}`}
                          onCheckedChange={(checked) =>
                            setSelected((prev) =>
                              checked ? [...prev, row.id] : prev.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{row.expense_date}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.category}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.platform ?? "—"}</TableCell>
                      <TableCell>
                        <AmountText value={row.amount} />
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {row.note ?? "—"}
                      </TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            aria-label={`删除 ${row.category}`}
                            onClick={() => void remove([row.id])}
                          >
                            删除
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell />
                    <TableCell colSpan={3} className="font-medium">
                      合计
                    </TableCell>
                    <TableCell>
                      <AmountText value={stats.net} />
                    </TableCell>
                    <TableCell colSpan={2} className="text-xs text-muted-foreground">
                      支出 {formatMoney(stats.spend)} · 收回 {formatMoney(Math.abs(stats.back))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="删除其他费用记录"
        description={`将删除选中的 ${selected.length} 条记录，删除后财务看板的盈亏会重新计算，且不可恢复。`}
        confirmText="确认删除"
        onConfirm={() => remove(selected)}
      />
    </div>
  )
}
