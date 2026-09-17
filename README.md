# 得物 · 商品管理系统

服装鞋帽类商品经营管理系统：**入仓（采购单）→ 商品台账 → 销售订单 → 库存联动 → 财务看板** 的完整闭环。
前端静态站点 + Supabase（Postgres / Auth / Storage），无自建服务端。

---

## 一、技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind CSS 3 + shadcn/ui |
| 路由 | HashRouter（静态托管零配置，刷新不 404） |
| 后端 | Supabase：Postgres + Auth + Storage，前端直连（PostgREST） |
| 数据源抽象 | `src/lib/backend.ts` 定义唯一接口，两种实现：`cloudBackend.ts`（Supabase）/ `demoBackend.ts`（localStorage 演示） |
| 部署 | `npm run build` → `app/out`；发布目录 `publish/`（任意静态托管均可） |

> **重要**：新增数据操作时，`cloudBackend` 与 `demoBackend` **两边都要实现**，否则演示模式会缺功能。

## 二、目录结构

```
.
├── app/                      # 前端工程（仓库主体）
│   ├── src/
│   │   ├── lib/
│   │   │   ├── backend.ts        # 数据源接口定义（唯一出入口）
│   │   │   ├── cloudBackend.ts   # Supabase 实现
│   │   │   ├── demoBackend.ts    # 演示模式实现（localStorage）
│   │   │   ├── schemaSql.ts      # 建表 + 迁移 SQL（单一事实来源）
│   │   │   ├── sales.ts          # 订单/库存联动口径、时间范围
│   │   │   ├── finance.ts        # 财务看板汇总口径
│   │   │   ├── images.ts         # 图片按 SPUID/颜色匹配
│   │   │   └── constants.ts      # 枚举与开关（删除密码等）
│   │   ├── pages/                # 各业务页面
│   │   ├── components/           # 公共组件与 UI 原子
│   │   └── contexts/AppContext.tsx  # 全局状态（用户、数据源、bumpData）
│   ├── scripts/
│   │   ├── smoke.mjs             # 端到端回归（无头 Chrome + CDP）
│   │   ├── unit-stock.mjs        # 库存/入仓/图片单元测试
│   │   ├── release.mjs           # 构建 + 生成发布目录
│   │   └── export-sql.mjs        # 导出 supabase/schema.sql 与迁移脚本
│   ├── supabase/
│   │   ├── schema.sql            # 完整建库脚本（新库用）
│   │   └── migration-add-fields.sql  # 增量迁移（已有库用，可重复执行）
│   ├── .env.production           # 生产构建注入的 Supabase 配置
│   └── package.json
└── .workbuddy/memory/        # 项目记忆（踩坑记录、口径约定，建议保留）
```

## 三、在另一台电脑上开工（快速开始）

前置：**Node.js 22**（建议用 managed 版本或 nvm）。

```bash
git clone https://github.com/wfjdyhmtr2-glitch/poizon.git yunguan && cd yunguan/app
npm install
npm run dev            # 本地开发，默认 http://localhost:5173
```

- 未配置 Supabase 时自动进入**演示模式**（localStorage 假数据），可直接体验全部功能
- 配置了 Supabase 时进入**云端模式**，需登录（登录页无自助注册入口，账号在 Supabase 控制台创建）
- 修改数据层后务必跑回归，见第七节
- 改完想上线：`git push` 到 `main` 即可（CI 自动构建发布，见六之二）；
  **不要**用 WorkBuddy 的「部署」按钮——那个绑定本机工作区，换电脑换账号就是另一个域名了

## 四、Supabase 配置

配置写在 `app/.env.production`（已入库，含浏览器端公开的 anon key，**不是密钥泄露**）：

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

安全边界完全由**数据库 RLS** 承担：

- 六张业务表（products / sales_orders / spu_mappings / product_images / purchase_orders / purchase_order_items + spu_info）均带 `owner_id`，策略为 `owner_id = auth.uid() or public.is_admin()`
- `is_admin()` 比对 `ADMIN_EMAIL`（管理员可见全部数据）
- 未登录（anon）一律不可读写；图片桶公开读、登录可写
- 管理员邮箱写死在 `src/lib/schemaSql.ts` 的 `ADMIN_EMAIL`，改完需重跑迁移脚本

## 五、数据库变更流程（重要）

`schemaSql.ts` 是**唯一事实来源**，改结构时改它，然后导出：

```bash
cd app
node scripts/export-sql.mjs      # 重新生成 supabase/schema.sql 与 migration-add-fields.sql
```

线上库执行：**Supabase 控制台 → SQL Editor → 把 `migration-add-fields.sql` 全文粘贴 → Run**（整段跑，别只选一段）。
脚本可重复执行、不动已有数据。

> ⚠️ **顺序陷阱**：迁移脚本里引用某列的语句（触发器、函数、存量归属 update）必须排在该列的 `alter table ... add column` / `create table` **之后**。历史上踩过两次：
> `resolve_order_sku` 引用 `pr.owner_id`、存量归属 `update spu_info` 早于建表。新增结构时，把建表/加列放到脚本**最前面**的「提前块」里最稳。

## 六、构建与上线

```bash
cd app
npm run build          # 产物在 app/out
node scripts/release.mjs   # 生成/刷新 publish/ 目录（只保留 index.html 实际引用的资源）
```

把 `publish/` 目录交给任意静态托管即可（WorkBuddy CloudStudio 部署、Cloudflare Pages、腾讯云 EdgeOne/静态网站托管、对象存储 + CDN 都行）。

> 托管方只是"发文件"，没有任何服务端逻辑；切换托管方不影响功能。
> 注意：**不同托管方会得到不同网址**。若希望团队始终访问同一个域名，建议绑定自己的域名（CNAME 到托管方），而不是依赖临时沙箱地址。

## 六之二、自动上线（推代码即发布）

前端 `vite.config.ts` 已设 `base: "./"`（资源用相对路径），**放在任何子路径下都能正常加载**——
这是能直接用 GitHub Pages 这类「项目子路径」托管的前提，无需改任何代码。

### 方案 A：GitHub Pages（仓库已内置工作流）

仓库里已有 `.github/workflows/deploy-pages.yml`：推 `main` 分支 → 自动构建 → 自动发布。

一次性启用步骤：

1. 仓库 **Settings → Pages** → Source 选 **GitHub Actions**
2. 之后每次 `git push`（或在本仓库 Actions 页点一次 Run workflow）都会自动上线
3. 固定网址：`https://wfjdyhmtr2-glitch.github.io/poizon/`（仓库现名 `poizon`，原名为 `-`；改名后旧地址会自动跳转）
4. **换自己的域名**：Settings → Pages → Custom domain 填你的域名 →
   在 DNS 服务商加一条 CNAME 指向 `<用户名>.github.io` → 勾选 Enforce HTTPS

> ⚠️ 私有仓库用 Pages 需要 GitHub Pro；**公开仓库免费**且 Actions 用量不限。
> 仓库若必须私有，用方案 B。

### 方案 B：Cloudflare Pages（支持私有仓库，免费）

1. Cloudflare 控制台 → Workers & Pages → Create → Pages → 连接 Git → 选该仓库
2. 构建配置：**Root directory `app`**、Build command `npm run build`、Output directory `out`
3. 得到固定域名 `https://<项目名>.pages.dev`，可再绑自定义域名

### 方案 C：腾讯云 EdgeOne Pages / 对象存储 + CDN（国内访问最快）

同样支持 Git 集成与自动构建；产物目录填 `app/out`。
绑自定义域名到**中国大陆节点需 ICP 备案**，用境外节点则免备案但速度一般。

### 共同要点

- ⚠️ **WorkBuddy 内置的「部署」不等于固定域名**：它绑定的是**本机工作区路径**。
  换一台电脑、或换一个 WorkBuddy 账号再部署，会生成**新的 sandbox 和新域名**，
  覆盖不到原来那个网址。要让「任何电脑、任何账号、推代码就更新到同一个网址」，
  必须走上面的 A / B / C（由 CI 构建发布），这也正是本仓库用 Git 当协作桥的原因。
- 构建时注入的 Supabase 配置来自 `app/.env.production`（已入库），CI 不需要额外配置密钥
- 数据库结构变更（迁移 SQL）**不会**自动执行，仍需在 Supabase SQL Editor 手动跑一次
- 首次部署后建议用管理员账号登录验一遍：登录、看板、入仓单、商品信息、双击复制

## 七、回归测试（改完必须跑）

```bash
cd app
# 1) 单元测试：库存联动 / 入仓单 / 图片库（纯 Node，无需浏览器）
node scripts/unit-stock.mjs

# 2) 端到端回归：需要本机 Chrome + 无头 CDP
npm run dev -- --port 5199 --strictPort &        # 另开一个终端
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/yg-chrome about:blank &
BASE_URL=http://127.0.0.1:5199 SHOT_DIR=/tmp/yg-shots node scripts/smoke.mjs
```

- `smoke.mjs` 是回归基线：**全绿（无 `false`、无 console error、无 4xx/5xx）** 才算通过
- 端口 9222 常被残留实例占用：`pkill -f remote-debugging-port=9222`
- 弹窗类断言偶发时序抖动，复跑一次即可确认

## 八、业务口径速查

**库存三态**（规则固化在数据库触发器 `STOCK_SYNC_SQL`，前端 `sales.ts` 保持同口径）：

- 订单生效（交易成功且未退货）未结算 → `locked_stock +1`、`stock -1`
- 结算 → 释放 `locked_stock`，`stock` 不回退（已核销）
- 未付款 / 退款 → 不占用库存
- 允许超卖（`stock` 可为负，列表标红），不拦截

**入仓单（采购单）**：明细自由录入（SPUID / 名称 / 颜色 / 尺码 / 数量 / 进货总价），
`进货单价 = 进货总价 ÷ 数量`（自动算，不可填）。确认入仓后：新款自动建档，老款加库存，成本价按**加权平均**更新。

**商品（售价）**：售价不可手填，= 该款在入仓管理里的 **Σ进货总价 ÷ Σ进货数量**；无进货显示 `-`。
商品数据全部由入仓单生成，商品管理页只读（两级呈现：SPUID 一级 → 颜色/尺码规格二级）。

**图片匹配链**（`lib/images.ts`）：精确颜色图 → 该 SPU 通用图 → SPU 默认主图（商品信息里勾选） → 商品旧封面。
SPUID 的名称与主图在「商品信息」页登记（支持 Ctrl+V 粘贴图片）。

**财务看板**：`盈亏 = 结算金额 − 成本 − 物流运费 + 补贴（返利） − 其他费用`（其他费用预留，暂 0）；
总盈亏（现金口径）= 已卖盈亏 − 手里存货投入。

**交互**：页面上任意数据**双击即复制**（`src/hooks/useDoubleClickCopy.ts`，挂在 AppShell；输入框内保持原生选词）。

**权限**：删除商品/规格需密码（`constants.DELETE_PASSWORD`，防误触门禁），且仅管理员账号可见删除入口；
数据可见性由数据库 RLS 按 `owner_id` 隔离。

## 九、已知坑

1. **vite 预构建 × 文件安全删除**：引入项目没用过的新 npm 依赖时，vite 会重建依赖缓存并批量删除文件，可能被安全删除保护拦截导致 dev 崩溃 / 白屏。演示页面尽量复用已有依赖。
2. **无头 Chrome 端口占用**：见第七节。
3. **数据库结构落后于代码**：云端页面报错时，先确认 `migration-add-fields.sql` 是否已整段执行过。
4. **spu_info 表**：商品信息登记（SPUID → 名称 / 主图）依赖该表，老库需要跑迁移脚本才会创建。
