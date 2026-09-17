/**
 * 把 src/lib/schemaSql.ts 里的 SQL 常量导出成 supabase/*.sql。
 *
 * 必须真正编译执行，不能靠正则抠文本——常量里有 ${STOCK_SYNC_SQL} 这类插值。
 * 用法：node scripts/export-sql.mjs   （在 app/ 目录下运行）
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(APP, "package.json"))
const esbuild = require("esbuild")

const src = readFileSync(join(APP, "src/lib/schemaSql.ts"), "utf8")
const { code } = esbuild.transformSync(src, { loader: "ts", format: "esm" })

const dir = mkdtempSync(join(tmpdir(), "yunguan-sql-"))
const modFile = join(dir, "schemaSql.mjs")
writeFileSync(modFile, code)

const mod = await import(pathToFileURL(modFile).href)
const schema = mod.SCHEMA_SQL
const migration = mod.MIGRATION_SQL

if (schema.includes("${") || migration.includes("${")) {
  console.error("!! 仍存在未展开的插值")
  process.exit(1)
}

writeFileSync(join(APP, "supabase/schema.sql"), schema)
writeFileSync(join(APP, "supabase/migration-add-fields.sql"), migration)

const check = (label, text) => {
  const has = (needle) => (text.includes(needle) ? "✓" : "✗")
  console.log(
    `  ${label}: ${text.split("\n").length} 行 · locked_stock ${has("locked_stock")} · ` +
      `触发器 ${has("sales_orders_sync_stock")} · 函数 ${has("order_stock_effect")}`,
  )
}
console.log("SQL 已导出（插值已展开）：")
check("schema.sql", schema)
check("migration-add-fields.sql", migration)
