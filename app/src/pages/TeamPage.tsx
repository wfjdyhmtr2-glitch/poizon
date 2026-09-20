import { useCallback, useEffect, useMemo, useState } from "react"
import { Crown, KeyRound, Lock, RefreshCcw, ShieldAlert, Trash2, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmDialog, ErrorBlock, LoadingBlock, PageHeader } from "@/components/common"
import { useApp } from "@/contexts/AppContext"
import { SUPER_ADMIN_EMAIL } from "@/lib/constants"
import { formatDate } from "@/lib/format"
import {
  PERMISSION_LEVELS,
  PERMISSION_MODULES,
  permOf,
  type AppMember,
  type MemberPermissions,
  type MemberRole,
  type ModuleId,
  type PermissionLevel,
} from "@/lib/types"
import { cn } from "@/lib/utils"

function isSuperAdmin(email: string) {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
}

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === "admin") {
    return (
      <Badge className="gap-1">
        <Crown className="size-3" />
        管理员
      </Badge>
    )
  }
  return <Badge variant="secondary">成员</Badge>
}

/** 成员列表里的一行摘要：管理员不受勾选限制，其他人显示「几个可看 / 几个可改」 */
function describePermissions(member: AppMember) {
  if (member.role === "admin") return "不受限制"
  let view = 0
  let edit = 0
  for (const mod of PERMISSION_MODULES) {
    const level = permOf(member.permissions, mod.id)
    if (level !== "none") view++
    if (level === "edit") edit++
  }
  if (!view) return "未开通（看不到任何模块）"
  return `${view} 个可查看 · ${edit} 个可编辑`
}

export function TeamPage() {
  const { backend, isCloud, dataVersion, bumpData, user, isAdmin } = useApp()

  const [rows, setRows] = useState<AppMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [pwTarget, setPwTarget] = useState<AppMember | null>(null)
  const [pwValue, setPwValue] = useState("")
  const [permTarget, setPermTarget] = useState<AppMember | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AppMember | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await backend.listMembers())
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
    return {
      total: list.length,
      admins: list.filter((m) => m.role === "admin").length,
    }
  }, [rows])

  async function submit() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes("@")) {
      setFormError("请填写正确的邮箱")
      return
    }
    if (password.length < 6) {
      setFormError("初始密码至少 6 位")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const created = await backend.createMember({
        email: trimmed,
        password,
        role,
        display_name: displayName.trim() || null,
      })
      toast.success(`已创建账号 ${trimmed}，接着给他勾选模块权限`)
      setEmail("")
      setPassword("")
      setDisplayName("")
      setRole("member")
      bumpData()
      // 新账号默认**什么都看不到**（权限为空），所以建完直接弹权限设置引导勾选
      setPermTarget(created)
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function changeRole(member: AppMember, next: MemberRole) {
    try {
      await backend.setMemberRole(member.id, next)
      toast.success(`${member.email} 已设为${next === "admin" ? "管理员" : "成员"}`)
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function doResetPassword() {
    if (!pwTarget) return
    if (pwValue.length < 6) {
      toast.error("新密码至少 6 位")
      return
    }
    try {
      await backend.resetMemberPassword(pwTarget.id, pwValue)
      toast.success(`已重置 ${pwTarget.email} 的密码`)
      setPwTarget(null)
      setPwValue("")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function doRemove() {
    if (!removeTarget) return
    try {
      await backend.deleteMembers([removeTarget.id])
      toast.success(`已移除 ${removeTarget.email}`)
      setRemoveTarget(null)
      bumpData()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading && !rows) return <LoadingBlock label="正在读取成员…" />
  if (error && !rows) return <ErrorBlock message={error} onRetry={load} />

  // 非管理员：给出明确提示，而不是一片空白
  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title="成员管理" description="管理谁能登录这个系统，以及各自的权限。" />
        <Card>
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium">仅管理员可以进入这个页面</p>
              <p className="text-muted-foreground">
                你当前的身份是普通成员，可以查看和录入数据，但不能管理账号，也不能删除数据。
                需要调整权限请联系管理员。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="成员管理"
        description="给同事开账号、设置角色。管理员可以管理账号和删除数据，普通成员只能查看与录入。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            创建账号
          </CardTitle>
          <CardDescription>
            填好邮箱和初始密码即可创建，对方拿到账号后可以直接登录（无需邮箱验证）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-email">登录邮箱</Label>
              <Input
                id="member-email"
                type="email"
                placeholder="如 zhangsan@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-password">初始密码</Label>
              <Input
                id="member-password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-name">姓名 / 备注（可选）</Label>
              <Input
                id="member-name"
                placeholder="如 店员小张"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色</Label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={role === "member" ? "default" : "outline"}
                  className="h-9 px-3 text-xs"
                  onClick={() => setRole("member")}
                >
                  成员（只能查看与录入）
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={role === "admin" ? "default" : "outline"}
                  className="h-9 px-3 text-xs"
                  onClick={() => setRole("admin")}
                >
                  管理员（可删数据、管账号）
                </Button>
              </div>
            </div>
          </div>

          {!isCloud ? (
            <p className="text-xs text-muted-foreground">
              当前是演示模式：新建的账号只作展示，无法真正登录。真实建号需要连接 Supabase
              并部署 admin-users 函数（见 README「成员与权限」一节）。
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              首次使用需要先在 Supabase 部署 admin-users 函数（见 README「成员与权限」一节）；
              没部署时点创建 / 重置密码 / 移除会提示服务不可用，其他功能不受影响。
            </p>
          )}

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={saving}>
              <UserPlus className="size-4" />
              {saving ? "创建中…" : "创建账号"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" />
            成员列表
          </CardTitle>
          <CardDescription>
            共 {stats.total} 个账号，其中管理员 {stats.admins} 个。所有成员共享同一份店铺数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">邮箱</TableHead>
                  <TableHead className="w-[140px]">姓名 / 备注</TableHead>
                  <TableHead className="w-[110px]">角色</TableHead>
                  <TableHead className="w-[180px]">模块权限</TableHead>
                  <TableHead className="w-[120px]">加入时间</TableHead>
                  <TableHead className="w-[320px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows ?? []).map((member) => {
                  const superAdmin = isSuperAdmin(member.email)
                  const isMe = member.id === user?.id || member.email === user?.email
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{member.email}</span>
                          {isMe ? <Badge variant="outline">你</Badge> : null}
                          {superAdmin ? <Badge variant="outline">超级管理员</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.display_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={member.role} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {describePermissions(member)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(member.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={superAdmin}
                            onClick={() =>
                              void changeRole(member, member.role === "admin" ? "member" : "admin")
                            }
                          >
                            {member.role === "admin" ? "降为成员" : "设为管理员"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setPermTarget(member)}
                          >
                            <Lock className="size-3" />
                            模块权限
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setPwTarget(member)
                              setPwValue("")
                            }}
                          >
                            <KeyRound className="size-3" />
                            重置密码
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            aria-label={`移除 ${member.email}`}
                            disabled={superAdmin || isMe}
                            onClick={() => setRemoveTarget(member)}
                          >
                            <Trash2 className="size-3" />
                            移除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <PermissionDialog
        member={permTarget}
        onClose={() => setPermTarget(null)}
        onSaved={() => {
          bumpData()
          void load()
        }}
      />

      <Dialog open={Boolean(pwTarget)} onOpenChange={(open) => !open && setPwTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              为 {pwTarget?.email} 设置新密码，对方下次登录请使用新密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              placeholder="至少 6 位"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void doResetPassword()}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="移除成员"
        description={`移除后 ${removeTarget?.email ?? ""} 将无法再登录，其创建的数据会保留。这个操作不可撤销。`}
        confirmText="确认移除"
        onConfirm={doRemove}
      />
    </div>
  )
}

/**
 * 模块权限设置：11 个模块 × 三档（不可查看 / 仅查看 / 查看和编辑）。
 * 点「保存权限」才写库；直接关掉对话框不改任何东西。
 */
function PermissionDialog({
  member,
  onClose,
  onSaved,
}: {
  member: AppMember | null
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useApp()
  const [draft, setDraft] = useState<MemberPermissions>({})
  const [saving, setSaving] = useState(false)

  // 每次换人或重新打开，都用他当前的权限初始化草稿
  useEffect(() => {
    setDraft(member?.permissions ?? {})
  }, [member])

  // 按导航分组呈现，顺序与左侧菜单一致
  const groups = useMemo(() => {
    const out: { label: string; modules: (typeof PERMISSION_MODULES)[number][] }[] = []
    for (const mod of PERMISSION_MODULES) {
      const last = out[out.length - 1]
      if (last && last.label === mod.group) last.modules.push(mod)
      else out.push({ label: mod.group, modules: [mod] })
    }
    return out
  }, [])

  function setLevel(id: ModuleId, level: PermissionLevel) {
    setDraft((prev) => {
      const next = { ...prev }
      if (level === "none") delete next[id]
      else next[id] = level
      return next
    })
  }

  async function save() {
    if (!member) return
    setSaving(true)
    try {
      await backend.setMemberPermissions(member.id, draft)
      toast.success(`已更新 ${member.email} 的权限`)
      onSaved()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置模块权限</DialogTitle>
          <DialogDescription>
            {member?.email} —— 每个模块三档：不可查看 / 仅查看 / 查看和编辑。
            留「不可查看」就等于没开通这个模块（左侧不显示，数据库层面也读不到数据）。
          </DialogDescription>
        </DialogHeader>

        {member?.role === "admin" ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            这个账号是<strong>管理员</strong>，所有模块都不受限制，勾选不生效。
            想让他受权限约束，先在列表里取消管理员身份。
          </p>
        ) : null}

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="space-y-1.5">
                {group.modules.map((mod) => {
                  const level = permOf(draft, mod.id)
                  return (
                    <div
                      key={mod.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="text-sm font-medium">{mod.label}</span>
                      <div className="flex gap-1">
                        {PERMISSION_LEVELS.map((opt) => (
                          <Button
                            key={opt.value}
                            type="button"
                            size="sm"
                            variant={level === opt.value ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => setLevel(mod.id, opt.value)}
                          >
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          「商品导入」会写入商品数据，要让某个人用导入功能，建议同时给他「商品管理」的编辑权。
          删除操作始终只有管理员能做。
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存权限"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
