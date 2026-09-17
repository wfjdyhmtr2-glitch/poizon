/**
 * 构建并生成可发布的静态目录。
 *
 *   1) npm run build        → app/out（Vite 产物）
 *   2) 本脚本把 index.html 及其真实引用到的 assets 复制到发布目录，
 *      顺带清掉上一版残留的旧资源，避免发布目录越滚越大。
 *
 * 用法：node scripts/release.mjs [发布目录]
 *   默认发布目录：<仓库根>/publish（不存在则用 app/publish）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(APP, "out")

if (!existsSync(join(OUT, "index.html"))) {
  console.error("!! 找不到 app/out/index.html，请先跑 `npm run build`")
  process.exit(1)
}

const repoRoot = dirname(APP)
const DIST = resolve(process.argv[2] ?? (existsSync(repoRoot) ? join(repoRoot, "publish") : join(APP, "publish")))

/* 1) 清空发布目录（保留目录本身） */
if (existsSync(DIST)) {
  for (const entry of readdirSync(DIST)) {
    rmSync(join(DIST, entry), { recursive: true, force: true })
  }
} else {
  mkdirSync(DIST, { recursive: true })
}

/* 2) 从 index.html 出发，按引用关系收集需要的文件 */
const ASSET_RE = /(?:assets\/|\.\/)([A-Za-z0-9._-]+\.(?:js|css))/g
const needed = new Set()
const queue = ["index.html"]
copyFileSync(join(OUT, "index.html"), join(DIST, "index.html"))

while (queue.length) {
  const rel = queue.shift()
  const full = join(DIST, rel)
  if (!existsSync(full) || !statSync(full).isFile()) continue
  const text = readFileSync(full, "utf8")
  let m
  while ((m = ASSET_RE.exec(text))) {
    const name = m[1]
    if (needed.has(name)) continue
    needed.add(name)
    const assetRel = `assets/${name}`
    const from = join(OUT, assetRel)
    if (existsSync(from) && !existsSync(join(DIST, assetRel))) {
      mkdirSync(join(DIST, "assets"), { recursive: true })
      copyFileSync(from, join(DIST, assetRel))
    }
    queue.push(assetRel)
  }
}

/* 3) 其它静态资源（图标、manifest 等） */
for (const extra of ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "manifest.webmanifest", "robots.txt"]) {
  const from = join(OUT, extra)
  if (existsSync(from)) copyFileSync(from, join(DIST, extra))
}

const total = needed.size + 1
console.log(`发布目录已就绪：${DIST}`)
console.log(`  入口 index.html + ${needed.size} 个资源文件（共 ${total} 项）`)
console.log("  下一步：把该目录交给任意静态托管（WorkBuddy 部署 / Cloudflare Pages / 对象存储 + CDN）")
