import { useCallback, useEffect, useMemo, useState } from "react"
import { Crown, KeyRound, RefreshCcw, ShieldAlert, Trash2, UserPlus, Users } from "lucide-react"
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
import type { AppMember, MemberRole } from "@/lib/types"
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
      await backend.createMember({
        email: trimmed,
        password,
        role,
        display_name: displayName.trim() || null,
      })
      toast.success(`已创建账号 ${trimmed}`)
      setEmail("")
      setPassword("")
      setDisplayName("")
      setRole("member")
      bumpData()
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
                  <TableHead className="w-[120px]">加入时间</TableHead>
                  <TableHead className="w-[280px]">操作</TableHead>
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
