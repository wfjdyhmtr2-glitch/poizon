/**
 * 云端模式线上验证：确认注入的 Supabase 配置生效、请求真的打到用户自己的项目。
 * 不会创建任何数据，只用一次故意失败的登录来证明 Auth 链路可达。
 */
import { writeFileSync, mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL
const CDP = process.env.CDP_URL || "http://127.0.0.1:9222"
const OUT = process.env.SHOT_DIR || "/tmp/ypgj-online"
const PROJECT_REF = process.env.PROJECT_REF || "ltvmjppzoalambdigyoi"

if (!BASE) {
  console.error("缺少 BASE_URL")
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const consoleErrors = []
const pageErrors = []
const badRequests = []
const seenRequests = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true })
    ws.addEventListener("error", rej, { once: true })
  })
  let seq = 0
  const pending = new Map()
  const handlers = []
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method) for (const fn of handlers) fn(msg)
  })
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params, sessionId }))
      }),
    on: (fn) => handlers.push(fn),
    close: () => ws.close(),
  }
}

async function main() {
  const version = await (await fetch(`${CDP}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true })
  const s = (m, p) => browser.send(m, p, sessionId)

  browser.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "))
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails
      pageErrors.push(d.exception?.description || d.text)
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      consoleErrors.push(msg.params.entry.text)
    }
    if (msg.method === "Network.requestWillBeSent") {
      const u = msg.params.request.url
      if (u.includes("supabase")) seenRequests.push(u)
    }
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
      badRequests.push(`${msg.params.response.status} ${msg.params.response.url}`)
    }
  })

  await s("Page.enable")
  await s("Runtime.enable")
  await s("Log.enable")
  await s("Network.enable")
  await s("DOM.enable")
  await s("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const evaluate = async (expression) => {
    const res = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description)
    return res.result.value
  }
  const bodyText = () => evaluate("document.body.innerText.slice(0, 4000)")
  const shot = async (name) => {
    const { data } = await s("Page.captureScreenshot", { format: "png" })
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"))
    console.log(`  📸 ${name}.png`)
  }
  const clickSelector = async (selector) => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!box) throw new Error(`找不到元素：${selector}`)
    await sleep(150)
    for (const type of ["mousePressed", "mouseReleased"]) {
      await s("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 })
    }
    await sleep(400)
  }
  const typeInto = async (selector, text) => {
    await clickSelector(selector)
    await s("Input.insertText", { text })
    await sleep(200)
  }

  console.log("\n=== 1. 打开线上地址，确认已是云端模式 ===")
  await s("Page.navigate", { url: `${BASE}/` })
  await sleep(2000)
  await evaluate("localStorage.clear()")
  await s("Page.reload", {})
  await sleep(3000)
  await shot("01-login-cloud")

  const login = await bodyText()
  console.log("  云端模式文案:", login.includes("使用你在 Supabase 中创建的管理员账号登录"))
  console.log("  已不再显示演示账号提示:", !login.includes("admin@demo.com"))
  console.log("  未出现演示模式横幅:", !login.includes("当前是本地演示模式"))

  console.log("\n=== 2. 故意用错误账号登录，验证请求打到你的项目 ===")
  await typeInto("#email", "connectivity-probe@example.com")
  await typeInto("#password", "definitely-wrong-123")
  await clickSelector('button[type="submit"]')
  await sleep(3500)
  const afterTry = await bodyText()
  console.log("  收到「邮箱或密码不正确」:", afterTry.includes("邮箱或密码不正确"))
  console.log("  仍停留在登录页（未误入后台）:", afterTry.includes("欢迎回来"))
  await shot("02-login-rejected")

  console.log("\n=== 3. 未登录访问内页应被拦回登录页 ===")
  await s("Page.navigate", { url: `${BASE}/#/products` })
  await sleep(2000)
  const guarded = await bodyText()
  console.log("  被重定向到登录页:", guarded.includes("欢迎回来"))

  console.log("\n=== 4. 请求确实发往你的 Supabase 项目 ===")
  const hits = [...new Set(seenRequests)]
  console.log(`  发往 supabase 的请求数: ${seenRequests.length}`)
  console.log(`  指向本项目(${PROJECT_REF}):`, hits.some((u) => u.includes(PROJECT_REF)))
  hits.slice(0, 4).forEach((u) => console.log("   ·", u.replace(/\?.*$/, "").slice(0, 110)))

  console.log("\n=== 控制台错误 ===")
  if (!consoleErrors.length && !pageErrors.length) console.log("  ✅ 无 console error / 未捕获异常")
  else {
    consoleErrors.slice(0, 10).forEach((e) => console.log("  ✗ console:", e.slice(0, 260)))
    pageErrors.slice(0, 10).forEach((e) => console.log("  ✗ exception:", e.slice(0, 260)))
  }

  console.log("\n=== 4xx/5xx 请求 ===")
  const unexpected = badRequests.filter((r) => !/auth\/v1\/token/.test(r))
  if (!unexpected.length) console.log("  ✅ 除预期的登录失败外，没有其他失败请求")
  else unexpected.slice(0, 10).forEach((r) => console.log("  ✗", r.slice(0, 200)))
  console.log("  （统计到的失败请求：", badRequests.map((r) => r.split(" ")[0]).join(", ") || "无", "）")

  browser.close()
  console.log(`\n截图目录：${OUT}`)
}

main().catch((err) => {
  console.error("验证失败：", err.message)
  process.exit(1)
})
