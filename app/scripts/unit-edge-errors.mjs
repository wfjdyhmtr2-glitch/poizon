/**
 * Edge Function 报错文案单元测试
 *
 * 守的是什么：两个不同的 Edge Function 共用同一套错误翻译逻辑，但**必须各给各的提示**。
 * 曾经把兜底文案写成全局常量，结果「识图函数没部署」也提示「请部署 admin-users」，
 * 把人引到完全无关的地方——而且它不崩、不报 console error，端到端回归根本抓不到。
 *
 * 用 esbuild 打包 cloudBackend（tsx 未安装），再把 fetch 桩成「函数未部署」的 404，
 * 直接断言两个入口抛出的文案各自指向正确的函数。
 *
 * 用法：node scripts/unit-edge-errors.mjs
 */
import assert from "node:assert"
import { build } from "esbuild"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// 1) 打包 src/lib/cloudBackend.ts
const dir = mkdtempSync(join(tmpdir(), "unit-edge-"))
const outFile = join(dir, "cloud-backend.mjs")
await build({
  entryPoints: ["src/lib/cloudBackend.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: outFile,
  logLevel: "silent",
})

// 2) 桩掉 fetch：模拟 Supabase 网关「该函数不存在」的响应
globalThis.fetch = async () =>
  new Response(JSON.stringify({ code: "NOT_FOUND", message: "Requested function was not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  })

const { createCloudBackend } = await import(pathToFileURL(outFile).href)
const backend = createCloudBackend({
  url: "https://example.supabase.co",
  anonKey: "test-anon-key",
})

let failures = 0

/** 调一次并断言错误文案的包含 / 不包含 */
async function expectMessage(label, fn, mustInclude = [], mustNotInclude = []) {
  let msg
  try {
    await fn()
    msg = "(没有抛错)"
  } catch (err) {
    msg = err?.message ?? String(err)
  }
  const ok =
    mustInclude.every((t) => msg.includes(t)) && mustNotInclude.every((t) => !msg.includes(t))
  console.log(`  ${ok ? "✅" : "❌"} ${label}`)
  console.log(`      ${msg}`)
  if (!ok) failures++
}

console.log("=== 函数未部署时，提示要指向正确的那个函数 ===")

// 识图：没部署是**正常降级**，提示要温和且指向关键词手填，绝不能提账号管理
await expectMessage(
  "recognize-product 未部署 → 指向「手填关键词」，不提 admin-users",
  () => backend.recognizeImage("https://example.com/p.png"),
  ["关键词"],
  ["admin-users"],
)

// 账号管理：提示必须明确让人去部署 admin-users
await expectMessage(
  "admin-users 未部署 → 指向 admin-users 的部署步骤",
  () => backend.createMember({ email: "a@b.com", password: "12345678", role: "member" }),
  ["admin-users"],
  ["关键词"],
)

assert.ok(true)
console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
