/**
 * 账号管理 Edge Function
 *
 * 为什么必须放在服务端：
 * 创建 / 删除账号、改密码属于 Supabase Auth 的**管理员操作**，必须用 service_role 密钥调用；
 * 而这个密钥等同于数据库最高权限，**绝不能出现在前端**（页面源码是公开的）。
 * 所以这类操作放在 Edge Function 里，前端只负责传意图；函数内部先验明调用者身份与角色。
 *
 * ── 部署步骤（Supabase 控制台，一次性，约 2 分钟）──
 *   1. 左侧 Edge Functions → Deploy a new function → Via Editor
 *   2. 函数名填：admin-users        （必须完全一致，前端按这个名字调用）
 *   3. 把本文件内容整体粘贴进编辑器，删掉模板自带的示例代码
 *   4. 点 Deploy
 *   5. 页面顶部的 "Verify JWT with legacy secret" 保持**关闭**（我们自己在函数里校验）
 *
 * 不需要手工配置任何环境变量：SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入。
 */

import { createClient } from "npm:@supabase/supabase-js@2"

/** 超级管理员：永远拥有 admin 角色，不能被降级或删除 */
const ADMIN_EMAIL = "shuo@dewu.com"

/**
 * 可分配的模块（必须与前端 `lib/types.ts` 的 PERMISSION_MODULES 保持一致）。
 * 服务端做白名单清洗：多余字段一律丢弃，避免脏数据绕过界面写进库里。
 */
const MODULE_IDS = [
  "finance",
  "dashboard",
  "sales",
  "market",
  "sourcing",
  "products",
  "purchases",
  "images",
  "sales_orders",
  "other_expenses",
  "import",
]

/** 清洗权限：{ "<moduleId>": "view" | "edit" }，非法的一律丢掉（缺省即不能看） */
function cleanPermissions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const src = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const id of MODULE_IDS) {
    const level = src[id]
    if (level === "view" || level === "edit") out[id] = level
  }
  return out
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "只支持 POST" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !anonKey || !serviceKey) {
    return json({ error: "函数缺少必要的环境变量，请检查 Supabase 项目配置" }, 500)
  }

  // ① 用调用者自己的 token 确认「他是谁」
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  })
  const { data: authData, error: authError } = await asCaller.auth.getUser()
  const caller = authData?.user
  if (authError || !caller) return json({ error: "未登录或登录已失效，请重新登录" }, 401)

  // ② 再用 service_role 确认「他是不是管理员」
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  let isAdmin = (caller.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase()
  if (!isAdmin) {
    const { data: row } = await admin
      .from("app_members")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle()
    isAdmin = row?.role === "admin"
  }
  if (!isAdmin) return json({ error: "只有管理员可以管理账号" }, 403)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400)
  }

  const action = String(payload.action ?? "")
  const isSuperAdmin = (email: string | null | undefined) =>
    (email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase()

  try {
    switch (action) {
      /* ---------- 创建账号 ---------- */
      case "create": {
        const email = String(payload.email ?? "").trim().toLowerCase()
        const password = String(payload.password ?? "")
        const role = payload.role === "admin" ? "admin" : "member"
        const displayName = String(payload.display_name ?? "").trim() || null
        if (!email.includes("@")) return json({ error: "邮箱格式不正确" }, 400)
        if (password.length < 6) return json({ error: "密码至少 6 位" }, 400)

        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // 直接标记邮箱已验证，否则对方还要去收确认邮件
          user_metadata: { display_name: displayName },
        })
        if (createError) return json({ error: createError.message }, 400)
        const newId = created.user?.id
        if (!newId) return json({ error: "创建账号失败：未返回用户 id" }, 500)

        const { error: memberError } = await admin.from("app_members").upsert({
          id: newId,
          email,
          role,
          display_name: displayName,
          permissions: cleanPermissions(payload.permissions),
        })
        if (memberError) {
          // 成员记录没写成，就把刚建的账号删掉，避免留下一个登进去也看不到数据的空账号
          await admin.auth.admin.deleteUser(newId)
          return json({ error: "成员记录写入失败：" + memberError.message }, 500)
        }
        return json({ ok: true, id: newId, email, role })
      }

      /* ---------- 修改角色 ---------- */
      case "setRole": {
        const id = String(payload.id ?? "")
        const role = payload.role === "admin" ? "admin" : "member"
        if (!id) return json({ error: "缺少成员 id" }, 400)
        if (id === caller.id && role !== "admin") return json({ error: "不能把自己降级" }, 400)

        const { data: target } = await admin
          .from("app_members")
          .select("email")
          .eq("id", id)
          .maybeSingle()
        if (isSuperAdmin(target?.email) && role !== "admin") {
          return json({ error: "超级管理员不能被降级" }, 400)
        }

        const { error } = await admin
          .from("app_members")
          .update({ role, updated_at: new Date().toISOString() })
          .eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      /* ---------- 设置模块权限（不可查看 / 仅查看 / 查看和编辑） ---------- */
      case "setPermissions": {
        const id = String(payload.id ?? "")
        if (!id) return json({ error: "缺少成员 id" }, 400)
        const { data: target } = await admin
          .from("app_members")
          .select("id")
          .eq("id", id)
          .maybeSingle()
        if (!target) return json({ error: "成员不存在" }, 404)

        // 管理员本来就不受勾选限制，给他存权限不会报错、只是不起作用
        const { error } = await admin
          .from("app_members")
          .update({
            permissions: cleanPermissions(payload.permissions),
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      /* ---------- 重置密码 ---------- */
      case "resetPassword": {
        const id = String(payload.id ?? "")
        const password = String(payload.password ?? "")
        if (!id) return json({ error: "缺少成员 id" }, 400)
        if (password.length < 6) return json({ error: "密码至少 6 位" }, 400)
        const { error } = await admin.auth.admin.updateUserById(id, { password })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      /* ---------- 移除成员 ---------- */
      case "delete": {
        const id = String(payload.id ?? "")
        if (!id) return json({ error: "缺少成员 id" }, 400)
        if (id === caller.id) return json({ error: "不能移除自己" }, 400)

        const { data: target } = await admin
          .from("app_members")
          .select("email")
          .eq("id", id)
          .maybeSingle()
        if (isSuperAdmin(target?.email)) return json({ error: "超级管理员不能被移除" }, 400)

        const { error: delError } = await admin.auth.admin.deleteUser(id)
        if (delError) return json({ error: delError.message }, 400)
        await admin.from("app_members").delete().eq("id", id)
        return json({ ok: true })
      }

      default:
        return json({ error: `未知操作：${action}` }, 400)
    }
  } catch (err) {
    return json({ error: (err as Error).message ?? "服务器内部错误" }, 500)
  }
})
