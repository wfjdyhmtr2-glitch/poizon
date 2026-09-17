/**
 * 端到端冒烟测试：用 Chrome DevTools Protocol 驱动无头浏览器
 * 覆盖：登录页渲染 → 演示账号登录 → 看板 → 商品列表 → 新增商品 → 导入页 → 设置页
 * 全程收集 console error / 未捕获异常，最后输出截图。
 */
import { writeFileSync, mkdirSync } from "node:fs"
import * as XLSX from "xlsx"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const CDP = process.env.CDP_URL || "http://127.0.0.1:9222"
const OUT = process.env.SHOT_DIR || "/tmp/ypgj-shots"
const IMPORT_FILE = "/tmp/ypgj-import-test.xlsx"
const SALES_IMPORT_FILE = "/tmp/ypgj-sales-import-test.xlsx"

mkdirSync(OUT, { recursive: true })

const IMPORT_HEADER = [
  "购入平台", "商品名称", "SPUID", "分类", "品牌", "适用人群", "季节", "颜色", "尺码",
  "售价", "到手价", "平台费用", "成本价", "库存", "返利", "备注", "库存预警值", "状态",
  "主图链接", "标签", "商品描述",
]

function makeImportFile() {
  const rows = [
    ["1688", "测试导入-羊毛流苏围巾", "IMP-001", "围巾", "暖格", "女装", "冬季", "米色、灰色", "均码",
      "299", "279", "14.95", "130", "88", "5.98", "档口现货，48 小时发", "20", "在售", "", "进口、保暖", "冒烟测试写入"],
    ["淘宝", "测试导入-复古破洞牛仔", "IMP-002", "牛仔", "野行", "中性", "四季", "蓝色、黑色", "M、L、XL",
      "359", "329", "17.95", "150", "120", "", "", "30", "在售", "", "", "冒烟测试写入"],
    ["抖店", "", "IMP-003", "T恤", "", "", "", "", "",
      "", "", "", "", "", "", "", "", "", "", "", "缺少名称，应当被校验拦下"],
  ]
  const sheet = XLSX.utils.aoa_to_sheet([IMPORT_HEADER, ...rows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "商品导入")
  // ESM 版 xlsx 的 writeFile 拿不到 fs，改用 write + writeFileSync
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" })
  writeFileSync(IMPORT_FILE, buffer)
}

/** 销售订单夹具：覆盖四种交易阶段 + 一行必填缺失 */
const SALES_HEADER = [
  "订单号", "spuID", "规格", "订单状态", "是否退货", "是否结算",
  "出价金额（元）", "预计收入金额（元）", "售后服务", "买家支付时间",
]

function makeSalesImportFile() {
  const rows = [
    ["DW260900009001", "TS-1001", "白色 / M", "交易成功", "否", "否",
      "129", "119.00", "无", "2026-09-10 12:30:00"],
    ["DW260900009002", "SH-2001", "米色 / M", "交易成功", "是", "否",
      "259", "239.00", "退货退款", "2026-09-10 15:00:00"],
    ["DW260900009003", "HD-3001", "灰色 / L", "交易关闭成功", "否", "否",
      "299", "278.00", "仅退款", "2026-09-11 09:20:00"],
    ["DW260900009004", "DN-5001", "黑色 / M", "交易失败", "否", "否",
      "899", "", "", ""],
    ["", "TS-1002", "", "交易成功", "否", "否", "169", "157.00", "", ""],
  ]
  const sheet = XLSX.utils.aoa_to_sheet([SALES_HEADER, ...rows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "销售订单")
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" })
  writeFileSync(SALES_IMPORT_FILE, buffer)
}

const consoleErrors = []
const pageErrors = []
const badRequests = []

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
  let seq = 0
  const pending = new Map()
  const handlers = []
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of handlers) fn(msg)
    }
  })
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params, sessionId }))
      })
    },
    on(fn) {
      handlers.push(fn)
    },
    close() {
      ws.close()
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const version = await (await fetch(`${CDP}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)

  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })
  const s = (method, params) => browser.send(method, params, sessionId)

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
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
      badRequests.push(`${msg.params.response.status} ${msg.params.response.url}`)
    }
  })

  await s("Page.enable")
  await s("Runtime.enable")
  await s("Log.enable")
  await s("Network.enable")

  async function viewport(width, height, mobile = false) {
    await s("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    })
  }

  async function evaluate(expression) {
    const res = await s("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || "evaluate failed")
    }
    return res.result.value
  }

  async function shot(name) {
    const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"))
    console.log(`  📸 ${name}.png`)
  }

  async function goto(url, waitMs = 1400) {
    await s("Page.navigate", { url })
    await sleep(waitMs)
  }

  async function clickSelector(selector) {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!box) throw new Error(`找不到元素：${selector}`)
    await sleep(150)
    const fresh = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    const point = fresh ?? box
    for (const type of ["mousePressed", "mouseReleased"]) {
      await s("Input.dispatchMouseEvent", {
        type,
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      })
    }
    await sleep(400)
  }

  /** 对页面上某段文字做**真实双击**（CDP 派发，clickCount=2），用于验证双击复制 */
  async function doubleClickText(label, scope = "main") {
    const box = await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(scope)}) ?? document.body;
      const nodes = [...root.querySelectorAll('*')];
      const el = nodes.find((e) => {
        const t = (e.textContent || '').trim();
        if (!t.includes(${JSON.stringify(label)})) return false;
        return ![...e.children].some((c) => (c.textContent || '').trim().includes(${JSON.stringify(label)}));
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!box) return false
    for (const clickCount of [1, 2]) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await s("Input.dispatchMouseEvent", {
          type,
          x: box.x,
          y: box.y,
          button: "left",
          clickCount,
        })
      }
    }
    await sleep(700)
    return true
  }

  /** 清掉提示条（toast），避免其文案污染后续页面断言 */
  async function dismissToasts() {
    await evaluate(`(() => {
      document.querySelectorAll('[data-sonner-toast], [role="status"] li').forEach((el) => el.remove());
      return true;
    })()`)
    await sleep(200)
  }

  async function readValue(selector) {
    return evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.value ?? null`,
    )
  }

  async function typeInto(selector, text) {
    await clickSelector(selector)
    await s("Input.insertText", { text })
    await sleep(200)
  }

  async function text(selector) {
    return evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`,
    )
  }

  async function bodyText() {
    return evaluate("document.body.innerText.slice(0, 20000)")
  }

  /** 只读主内容区（排除 toast / 侧边栏等） */
  async function mainText() {
    return evaluate("(document.querySelector('main')?.innerText ?? document.body.innerText).slice(0, 20000)")
  }

  /**
   * 按可见文案点击按钮 / 链接。
   * 默认只在主内容区和弹窗里找，避免误命中侧边栏同名导航。
   */
  async function clickByText(label, scope = 'main, [role="dialog"], [role="alertdialog"]') {
    const ok = await evaluate(`(() => {
      const roots = [...document.querySelectorAll(${JSON.stringify(scope)})];
      const pools = roots.length ? roots : [document];
      for (const root of pools) {
        const el = [...root.querySelectorAll('button, a')]
          .find(b => (b.textContent || '').trim().includes(${JSON.stringify(label)}));
        if (el) { el.click(); return true; }
      }
      return false;
    })()`)
    await sleep(500)
    return ok
  }

  /** 直接改 React 受控输入的值（先清空再填），比逐字输入更稳 */
  async function setInputValue(selector, text) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await sleep(900)
    return ok
  }

  /** 按 aria-label 点击（图标按钮没有文字） */
  async function clickByLabel(label) {
    const ok = await evaluate(`(() => {
      const el = document.querySelector('[aria-label="' + ${JSON.stringify(label)} + '"]');
      if (!el) return false;
      el.click();
      return true;
    })()`)
    await sleep(500)
    return ok
  }

  /** 直接读演示模式下的商品库存，用于断言库存联动 */
  async function readStock(sku) {
    return evaluate(`(() => {
      const rows = JSON.parse(localStorage.getItem('yunguan.demo.products.v1') || '[]');
      const p = rows.find(r => r.sku === ${JSON.stringify(sku)});
      return p ? { stock: p.stock, locked: p.locked_stock } : null;
    })()`)
  }

  /** 给弹窗里的 file input 塞真实文件 */
  async function uploadTo(selector, filePath) {
    const { root } = await s("DOM.getDocument", { depth: -1 })
    const { nodeId } = await s("DOM.querySelector", { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error(`找不到文件输入框：${selector}`)
    await s("DOM.setFileInputFiles", { files: [filePath], nodeId })
    await sleep(1800)
  }

  console.log("\n=== 1. 登录页（桌面 1440×900）===")
  await viewport(1440, 900)
  // 首次加载等待加长：dev server 冷启动编译可能超过默认 1.4s，
  // 若文档还没 commit 就执行 localStorage.clear() 会抛 SecurityError
  await goto(`${BASE}/`, 6000)
  // 每次从干净的浏览器状态开始，避免上一轮登录态残留
  await evaluate("localStorage.clear()")
  await s("Page.reload", {})
  await sleep(1800)
  await shot("01-login-desktop")
  const loginText = await bodyText()
  console.log("  标题含「欢迎回来」:", loginText.includes("欢迎回来"))
  console.log("  提示演示账号:", loginText.includes("admin@demo.com"))

  console.log("\n=== 2. 用演示账号登录 ===")
  await typeInto("#email", "admin@demo.com")
  await typeInto("#password", "admin888")
  await clickSelector('button[type="submit"]')
  await sleep(2200)
  const afterLogin = await bodyText()
  console.log("  已进入财务看板:", afterLogin.includes("财务看板"))
  console.log("  抓到采购总花费:", afterLogin.includes("采购总花费"))
  console.log("  抓到盈亏卡片:", afterLogin.includes("总盈亏"))
  await shot("02-dashboard-desktop")

  console.log("\n=== 3. 商品管理列表 ===")
  await goto(`${BASE}/#/products`, 2000)
  const productText = await bodyText()
  console.log("  页面标题:", (await text("h1")) || "(空)")
  console.log("  命中商品「精梳棉基础款圆领T恤」:", productText.includes("精梳棉基础款圆领T恤"))
  console.log("  含 SPU 关键列:", productText.includes("手里件数") && productText.includes("累计入仓"))
  console.log("  不支持编辑（无新增按钮）:", !productText.includes("新增商品"))
  await shot("03-products-desktop")

  console.log("\n=== 3b. 双击数据自动复制 ===")
  console.log("  双击商品名:", await doubleClickText("精梳棉基础款圆领T恤"))
  const afterCopy = await bodyText()
  console.log("  出现复制提示:", afterCopy.includes("已复制"))
  const clip = await evaluate(`(async () => {
    try { return await navigator.clipboard.readText(); } catch (e) { return "读不到：" + e.message; }
  })()`)
  console.log("  剪贴板内容:", (clip ?? "(空)").toString().slice(0, 40))
  await shot("03b-copy-toast")
  await dismissToasts()

  console.log("\n=== 4. 搜索过滤 ===")
  await typeInto('input[placeholder^="搜索商品名称"]', "羽绒")
  await sleep(1200)
  const searchText = await mainText()
  console.log("  搜索结果含羽绒服:", searchText.includes("羽绒服"))
  console.log("  已过滤掉T恤:", !searchText.includes("精梳棉基础款圆领T恤"))
  await shot("04-products-search")

  console.log("\n=== 5. 规格二级单元展开（SPU → 颜色/尺码）===")
  await goto(`${BASE}/#/products`, 2000)
  // 点第一个商品的展开按钮
  const expand = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="展开规格"]');
    if (!btn) return false; btn.click(); return true;
  })()`)
  console.log("  展开规格:", expand)
  await sleep(800)
  const specText5 = await bodyText()
  console.log("  含规格标签（颜色/尺码）:", /白色|黑色|米色|灰色/.test(specText5))
  console.log("  规格行含入仓均价或SPUID:", specText5.includes("入仓均价") || specText5.includes("SPUID："))
  await shot("05-product-specs")

  console.log("\n=== 5b. 删除密码门禁 ===")
  const delBtn = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="删除商品"]');
    if (!btn) return false; btn.click(); return true;
  })()`)
  console.log("  点删除按钮:", delBtn)
  await sleep(700)
  const pwText = await bodyText()
  console.log("  弹出密码确认:", pwText.includes("删除密码"))
  await clickByText("取消")
  await sleep(600)
  console.log("  取消后弹窗关闭:", !(await bodyText()).includes("确认删除"))

  console.log("\n=== 7. 批量导入页 ===")
  await goto(`${BASE}/#/import`, 2000)
  const importText = await bodyText()
  console.log("  含上传区:", importText.includes("拖到这里"))
  console.log("  含字段说明:", importText.includes("模板字段说明"))
  await shot("07-import-desktop")

  console.log("\n=== 7b. 真实上传 Excel 并导入 ===")
  makeImportFile()
  await s("DOM.enable")
  const { root } = await s("DOM.getDocument", { depth: -1 })
  const { nodeId } = await s("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  })
  await s("DOM.setFileInputFiles", { files: [IMPORT_FILE], nodeId })
  await sleep(1800)
  const preview = await bodyText()
  const parsedCount = /共解析 (\d+) 行/.exec(preview)?.[1]
  console.log("  文件已解析行数:", parsedCount)
  console.log("  显示可导入统计:", preview.includes("可导入"))
  console.log("  错误行被标出（缺少商品名称）:", preview.includes("缺少商品名称"))
  await shot("07b-import-preview")

  const importClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认导入'));
    if (!btn) return false; btn.click(); return true;
  })()`)
  console.log("  点击确认导入:", importClicked)
  await sleep(2500)
  const imported = await bodyText()
  console.log("  导入完成提示:", /导入完成/.test(imported) ? "是" : "否")
  console.log("  本次结果:", (/新增 (\\d+) 条/.exec(imported) || [])[0] ?? "(未捕获)")
  await shot("07c-import-done")

  console.log("\n=== 7d. 确认导入结果已落库 ===")
  await goto(`${BASE}/#/products`, 2000)
  await typeInto('input[placeholder^="搜索商品名称"]', "测试导入")
  await sleep(1300)
  const importedList = await bodyText()
  console.log("  搜到导入的围巾:", importedList.includes("测试导入-羊毛流苏围巾"))
  console.log("  搜到导入的牛仔:", importedList.includes("测试导入-复古破洞牛仔"))
  await shot("07d-import-persisted")

  console.log("\n=== 8. 系统设置页 ===")
  await goto(`${BASE}/#/settings`, 1800)
  const settingsText = await bodyText()
  console.log("  含云端连接:", settingsText.includes("云端连接"))
  console.log("  含数据库脚本:", settingsText.includes("数据库脚本"))
  await shot("08-settings-desktop")

  console.log("\n=== 8b. 商品信息模块 ===")
  await goto(`${BASE}/#/images`, 2200)
  const imagesText = await bodyText()
  console.log("  页面标题:", (await text("h1")) || "(空)")
  console.log("  含合并表单（登记+挂图）:", imagesText.includes("SPUID 信息登记与图片") && imagesText.includes("粘贴 / 选择图片") && imagesText.includes("选择图片"))
  console.log("  含颜色行与默认主图:", imagesText.includes("新增颜色") && imagesText.includes("设为默认主图"))
  console.log("  含已登记列表:", imagesText.includes("已登记"))
  console.log("  含 SPUID 过滤角标:", /DEMO-[A-Z]+-\d+/.test(imagesText) || imagesText.includes("全部（"))
  console.log("  演示种子图已生成:", imagesText.includes("通用") || /白色|黑色|米色/.test(imagesText))
  await shot("08b-images-desktop")

  console.log("\n=== 8c. 入仓管理（采购单维度 + 时间筛选）===")
  await goto(`${BASE}/#/purchases`, 2200)
  const poText = await bodyText()
  console.log("  页面标题:", (await text("h1")) || "(空)")
  console.log("  含新建按钮:", poText.includes("新建入仓单"))
  console.log("  有演示入仓单:", poText.includes("WH-DEMO"))
  console.log("  含时间筛选:", poText.includes("近 7 天") && poText.includes("近 90 天"))
  const poAll = poText.match(/WH-DEMO-/g)
  await clickByText("近 7 天")
  await sleep(700)
  const poWeek = await bodyText()
  console.log("  近 7 天后种子单被过滤:", !poWeek.includes("WH-DEMO"))
  await clickByText("全部时间")
  await sleep(600)
  await shot("08c-purchases-desktop")
  console.log("  打开新建弹窗:", await clickByText("新建入仓单"))
  await sleep(800)
  const poForm = await bodyText()
  console.log("  弹窗含自由录入明细:", poForm.includes("采购明细") && poForm.includes("总件数"))
  await shot("08c2-purchase-form")
  console.log("  关闭弹窗:", await clickByText("取消"))
  await sleep(1200)

  console.log("\n=== 9. 销售看板 ===")
  await viewport(1440, 900)
  await goto(`${BASE}/#/sales`, 2600)
  const salesDash = await bodyText()
  console.log("  页面标题:", (await text("h1")) || "(空)")
  console.log("  含成交率卡片:", salesDash.includes("成交率"))
  console.log("  含「买家未付款」:", salesDash.includes("买家未付款"))
  console.log("  含「发货前退款」:", salesDash.includes("发货前退款"))
  console.log("  含「签收后退款」:", salesDash.includes("签收后退款"))
  console.log("  含 SPU 成交排行:", salesDash.includes("SPU 成交排行"))
  await shot("12-sales-dashboard")

  console.log("\n=== 9b. 看板时间筛选 ===")
  console.log("  含筛选按钮:", salesDash.includes("近 7 天") && salesDash.includes("近 90 天"))
  const allMatch = salesDash.match(/共 (\d+) 条订单/)
  console.log("  「全部」订单数:", allMatch ? allMatch[1] : "(未捕获)")
  await clickByText("近 7 天")
  await sleep(900)
  const weekDash = await bodyText()
  const weekMatch = weekDash.match(/共 (\d+) 条订单/)
  console.log("  「近 7 天」订单数:", weekMatch ? weekMatch[1] : "(未捕获)")
  console.log("  显示统计范围:", weekDash.includes("统计 "))
  await shot("21-sales-dashboard-range")
  await clickByText("全部")
  await sleep(700)

  console.log("\n=== 10. 销售订单列表 ===")
  await goto(`${BASE}/#/sales/orders`, 2400)
  const orderText = await bodyText()
  console.log("  页面标题:", (await text("h1")) || "(空)")
  console.log("  有演示订单（DW 开头）:", /DW\d+/.test(orderText))
  await shot("13-sales-orders")

  console.log("\n=== 10b. 订单时间筛选 ===")
  const orderAllMatch = orderText.match(/共 (\d+) 条订单/)
  console.log("  「全部时间」订单数:", orderAllMatch ? orderAllMatch[1] : "(未捕获)")
  console.log("  点「近 7 天」:", await clickByText("近 7 天"))
  await sleep(1000)
  const orderWeek = await bodyText()
  const orderWeekMatch = orderWeek.match(/共 (\d+) 条订单/)
  console.log("  「近 7 天」订单数:", orderWeekMatch ? orderWeekMatch[1] : "(未捕获)")
  console.log("  显示范围提示:", orderWeek.includes("只看支付时间"))
  await shot("13b-orders-range")
  console.log("  点「全部时间」:", await clickByText("全部时间"))
  await sleep(800)

  console.log("\n=== 11. 批量导入销售订单（含四种交易阶段）===")
  const stockBeforeImport = await readStock("TS-1001")
  console.log("  导入前 TS-1001 库存:", JSON.stringify(stockBeforeImport))
  makeSalesImportFile()
  console.log("  点开导入弹窗:", await clickByText("导入订单"))
  await uploadTo('input[type="file"]', SALES_IMPORT_FILE)
  const salesPreview = await bodyText()
  console.log("  解析行数:", /共解析 (\d+) 行/.exec(salesPreview)?.[1])
  console.log("  标出正常成交:", salesPreview.includes("正常成交"))
  console.log("  标出签收后退款:", salesPreview.includes("签收后退款"))
  console.log("  标出买家未付款:", salesPreview.includes("买家未付款"))
  console.log("  缺订单号的行被拦下:", salesPreview.includes("缺少订单号"))
  await shot("14-sales-import-preview")

  console.log("  点确认导入:", await clickByText("确认导入"))
  await sleep(2500)
  const salesImported = await bodyText()
  console.log("  导入完成提示:", salesImported.includes("导入完成"))
  const stockAfterImport = await readStock("TS-1001")
  console.log("  导入后 TS-1001 库存:", JSON.stringify(stockAfterImport))
  console.log(
    "  仅「交易成功未结算」那单锁定了 1 个:",
    stockAfterImport.stock === stockBeforeImport.stock - 1 &&
      stockAfterImport.locked === stockBeforeImport.locked + 1,
  )
  await shot("15-sales-import-done")
  console.log("  点取消:", await clickByText("取消"))
  // 等弹窗关闭动画彻底结束再断言，避免偶发时序抖动
  await sleep(1600)
  console.log("  弹窗已关闭:", !(await bodyText()).includes("批量导入销售订单"))

  console.log("\n=== 12. 搜索刚导入的订单 ===")
  await goto(`${BASE}/#/sales/orders`, 2200)
  await setInputValue('input[placeholder^="搜索订单号"]', "DW260900009002")
  const found = await bodyText()
  console.log("  搜到签收后退款订单:", found.includes("DW260900009002"))
  console.log("  阶段显示为签收后退款:", found.includes("签收后退款"))
  await shot("16-sales-order-found")

  console.log("\n=== 13. 手动新增订单 ===")
  const manualNo = `DW-MANUAL-${String(Date.now()).slice(-6)}`
  await clickByText("手动新增")
  await sleep(600)
  await setInputValue("#order-no", manualNo)
  await setInputValue("#order-sku", "TS-1001")
  await typeInto("#order-bid", "199")
  await typeInto("#order-income", "185")
  const salesFormText = await bodyText()
  console.log("  表单弹出:", salesFormText.includes("手动新增销售订单"))
  console.log("  实时推导出交易阶段:", salesFormText.includes("正常成交"))
  await shot("17-sales-order-form")
  console.log("  点创建订单:", await clickByText("创建订单"))
  await sleep(2000)
  await goto(`${BASE}/#/sales/orders`, 2200)
  await setInputValue('input[placeholder^="搜索订单号"]', manualNo)
  console.log("  手动订单已落库:", (await bodyText()).includes(manualNo))

  console.log("\n=== 14. 库存联动：锁定 → 核销 → 删除退回 ===")
  const SKU = "SH-2001"
  const base = await readStock(SKU)
  console.log("  起始状态:", JSON.stringify(base))

  await goto(`${BASE}/#/sales/orders`, 2200)
  const stockNo = `DW-STOCK-${String(Date.now()).slice(-6)}`
  await clickByText("手动新增")
  await sleep(700)
  await setInputValue("#order-no", stockNo)
  await setInputValue("#order-sku", SKU)
  await setInputValue("#order-income", "120")
  const lockForm = await bodyText()
  console.log("  表单预告会锁定库存:", lockForm.includes("锁定库存"))
  await shot("18-stock-lock-form")
  await clickByText("创建订单")
  await sleep(2200)

  const afterLock = await readStock(SKU)
  console.log("  下单后:", JSON.stringify(afterLock))
  console.log(
    "  可用 -1 且锁定 +1:",
    afterLock.stock === base.stock - 1 && afterLock.locked === base.locked + 1,
  )

  console.log("  — 把这单改成已结算 —")
  await setInputValue('input[placeholder^="搜索订单号"]', stockNo)
  await clickByLabel("编辑订单")
  await sleep(700)
  await clickSelector("#is-settled")
  await clickByText("保存修改")
  await sleep(2200)

  const afterSettle = await readStock(SKU)
  console.log("  结算后:", JSON.stringify(afterSettle))
  console.log(
    "  锁定释放且可用不再回退:",
    afterSettle.locked === base.locked && afterSettle.stock === base.stock - 1,
  )
  await shot("19-stock-consumed")

  console.log("  — 删掉这单，库存应退回 —")
  await setInputValue('input[placeholder^="搜索订单号"]', stockNo)
  await clickByLabel("删除订单")
  await sleep(600)
  console.log("  点确认删除:", await clickByText("确认删除"))
  await sleep(2200)

  const afterDelete = await readStock(SKU)
  console.log("  删除后:", JSON.stringify(afterDelete))
  console.log(
    "  库存完全恢复:",
    afterDelete.stock === base.stock && afterDelete.locked === base.locked,
  )

  console.log("\n=== 15. 移动端视图（390×844）===")
  await viewport(390, 844, true)
  await goto(`${BASE}/#/dashboard`, 2000)
  await shot("09-dashboard-mobile")
  await goto(`${BASE}/#/products`, 2000)
  await shot("10-products-mobile")
  await goto(`${BASE}/#/sales`, 2400)
  await shot("11-sales-dashboard-mobile")
  await goto(`${BASE}/#/sales/orders`, 2200)
  await shot("12-sales-orders-mobile")
  await goto(`${BASE}/#/images`, 2200)
  await shot("14-images-mobile")
  await goto(`${BASE}/#/purchases`, 2000)
  await shot("15-purchases-mobile")
  await goto(`${BASE}/#/login`, 1500)
  await shot("13-login-mobile")

  console.log("\n=== 控制台错误 ===")
  if (consoleErrors.length === 0 && pageErrors.length === 0) {
    console.log("  ✅ 没有任何 console error 或未捕获异常")
  } else {
    for (const e of consoleErrors.slice(0, 15)) console.log("  ✗ console:", e.slice(0, 300))
    for (const e of pageErrors.slice(0, 15)) console.log("  ✗ exception:", e.slice(0, 300))
  }
  console.log("\n=== 4xx/5xx 请求 ===")
  if (badRequests.length === 0) console.log("  ✅ 没有失败的网络请求")
  else for (const r of [...new Set(badRequests)].slice(0, 10)) console.log("  ✗", r.slice(0, 200))

  browser.close()
  console.log(`\n截图目录：${OUT}`)
  process.exit(consoleErrors.length + pageErrors.length > 0 ? 2 : 0)
}

main().catch((err) => {
  console.error("冒烟测试失败：", err.message)
  process.exit(1)
})
