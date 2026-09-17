# 云铺管家 · 店铺商品管理系统

面向服装鞋帽类店铺的商品管理后台。前端为纯静态 SPA，可直接部署到任意静态托管；数据存于 **Supabase Postgres**，图片存于 **Supabase Storage**，登录态由 **Supabase Auth** 管理。

## 功能

| 模块 | 说明 |
| --- | --- |
| 登录认证 | 邮箱密码登录 / 注册、会话保持、受保护路由、退出登录 |
| 数据看板 | 商品总数、在售占比、库存预警、库存总值；近 30 天变动趋势、状态构成、分类分布、价格带分布；库存告急与最近更新列表 |
| 销售看板 | 订单总数、成交率、实际收入、待结算金额；未付款 / 发货前退款 / 签收后退款三档拆解；近 30 天成交与退款趋势、交易阶段分布、SPU 成交排行（联动商品成本算毛利） |
| 销售订单 | 订单列表（搜索 / 交易阶段筛选 / 结算筛选 / 6 种排序 / 分页）、手动新增与编辑、批量导入、标记结算、批量删除 |
| 商品列表 | 关键词搜索（名称/SPU/品牌）、分类 / 状态 / 季节筛选、7 种排序、分页、卡片与表格双视图、多选批量上下架与删除、复制为草稿 |
| 商品表单 | 基础信息 / 规格属性 / 价格库存 / 图片 / 描述五个分区，服装品类专用字段（颜色、尺码、材质、季节），净利测算与库存货值实时计算，右侧上架预览 |
| 图片上传 | 支持点击与拖拽，上传前自动压缩，可设主图、调顺序、删除，写入 Supabase Storage |
| 商品导入 | 下载 Excel 模板、解析 .xlsx/.xls/.csv、逐行校验并给出错误与警告、可选「新增并更新」或「仅新增」、导入进度与结果统计 |
| 响应式 | 桌面固定侧栏 / 平板自适应 / 手机抽屉侧栏 + 卡片列表 + 底部固定操作条 |

## 交易阶段是怎么算出来的

销售订单只记录平台给的**订单状态**和**是否退货**两个原始字段，交易阶段由它们派生，
规则固化在数据库的生成列里（`sales_orders.trade_stage`），导入和手动录入走的是同一套逻辑：

| 订单状态 | 是否退货 | 交易阶段 | 业务含义 | 计入收入 | 对库存的影响 |
| --- | --- | --- | --- | --- | --- |
| 交易失败 | — | `unpaid` | 买家未付款，订单未成立 | 否 | 不占用 |
| 交易关闭成功 | — | `refund_before_ship` | 买家在平台发货前退款 | 否 | 不占用 |
| 交易成功 | 是 | `refund_after_receive` | 买家收到货后退款（货已发、钱已垫，实际亏损） | 否 | 不占用 |
| 交易成功 | 否 | `completed` | 正常成交，但还没结算 | 是 | **锁定 1 个** |
| 交易成功 | 否 | `completed` | 正常成交且已结算 | 是 | **扣减 1 个** |

导入时会校验：状态不在三种之内、预计收入高于出价、交易失败却填了支付时间、签收后退款等，
都会在预览里标出警告或错误。

## 库存联动

可用库存放 `products.stock`，被占用的放 `products.locked_stock`（只读，由触发器维护）。

- 订单生效但**未结算** → 从可用挪 1 个到锁定
- 订单**结算成功** → 锁定释放，可用不再退回（等于真扣减 1 个）
- 订单**没做成**（未付款 / 发货前退款 / 签收后退款）→ 锁定的 1 个退回可用
- 订单被**编辑**或**删除** → 先撤销旧影响再应用新影响，SPU 被改也一样算得对

这套规则全部落在数据库触发器里（`sales_orders_sync_stock`），所以界面操作、Excel 导入、
甚至直接在 Supabase 表编辑器改数据，库存都会自动跟上。演示模式的等价实现在
`src/lib/sales.ts` 的 `orderStockEffect()` / `stockDelta()`。

> ⚠️ 触发器只对**创建之后**的订单变更生效。历史订单需要删掉重新导入一次，
> 否则它们的占用不会被计入，而后续一旦编辑又会重复撤销。

## 快速开始

```bash
cd app
npm install
npm run dev          # 本地开发
npm run build        # 构建，产物在 app/out
```

首次打开会进入**演示模式**：用 `admin@demo.com` / `admin888` 登录即可体验全部功能，数据只存在浏览器 localStorage。

## 接入云端数据库

1. 在 [supabase.com](https://supabase.com) 新建一个免费 Project（区域建议 Singapore / Tokyo）。
2. 打开 **SQL Editor**，把 `supabase/schema.sql` 整体粘贴执行。会创建 `products` 表、索引、`updated_at` 触发器、RLS 策略与 `product-images` 公共存储桶。
3. 打开 **Authentication → Providers**，确认 Email 已启用；想跳过邮箱验证可在 **Sign In / Providers** 关闭 Confirm email。
4. 在 **Authentication → Users → Add user** 创建一个后台账号，勾选 Auto Confirm User。
5. 在 **Project Settings → API** 复制 `Project URL` 和 `anon public key`。
6. 回到后台（登录页或「系统设置」），点「连接云端数据库」，粘贴两段信息并保存。页面会自动校验表结构与存储桶是否就绪。

> anon key 设计上就是公开的，数据安全由 RLS 策略保证，不需要 service_role key。

也可以构建时注入，让产物打开即为云端模式（访客无需手动填写）：

```bash
# app/.env.production —— 构建时会内联进产物
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
```

两种 key 格式都支持：老版 JWT（`eyJ...`）与新版 publishable key（`sb_publishable_...`）。
若用户在界面上主动点了「断开云端」，会在 localStorage 写入停用标记，之后不再自动启用构建时的默认配置。

> ⚠️ 登录后台用的**不是 Supabase 官网账号**。控制台账号属于 supabase.com 平台，后台登录用的是
> 你 project 里的 `auth.users` 用户（Authentication → Users → Add user，记得勾 Auto Confirm User）。

## 导入模板

### 商品导入模板

`购入平台`、`商品名称*`、`SPUID*`、`分类`、`品牌`、`适用人群`、`季节`、`颜色`、`尺码`、`售价*`、`到手价`、`平台费用`、`成本价`、`库存`、`返利`、`备注`、`库存预警值`、`状态`、`主图链接`、`标签`、`商品描述`

- 打 `*` 为必填。多值字段（季节 / 颜色 / 尺码 / 标签）用顿号、逗号或斜杠分隔。
- **SPUID 是判断新增还是更新的唯一依据**；「新增并更新」模式下同 SPUID 会覆盖。
- 分类建议填：T恤、衬衫、卫衣、针织衫、外套、羽绒服、西服、连衣裙、半身裙、裤装、牛仔、套装、鞋靴、帽子、围巾、配饰。
- 适用人群：女装 / 男装 / 中性 / 童装。状态：在售 / 已下架 / 草稿。

### 销售订单导入模板

`订单号*`、`spuID*`、`规格`、`订单状态*`、`是否退货`、`是否结算`、`出价金额（元）`、`预计收入金额（元）`、`售后服务`、`买家支付时间`

- **订单号是判断新增还是更新的唯一依据**。
- `订单状态` 只接受 交易成功 / 交易失败 / 交易关闭成功；`是否退货`、`是否结算` 填 是 / 否。
- `买家支付时间` 支持 `2026-09-01 12:30:00`、`2026/9/1 12:30`、`2026.09.01`，也能识别 Excel 的日期序列号。
- 未付款的订单不必填支付时间。

## 项目结构

```
app/
├── src/
│   ├── components/          # AppShell、公共组件、图片上传、标签选择、云端配置弹窗
│   │   ├── SalesOrderFormDialog.tsx  # 手动录入 / 编辑销售订单
│   │   ├── SalesImportDialog.tsx     # 销售订单批量导入
│   │   └── ui/              # shadcn/ui 组件
│   ├── contexts/AppContext.tsx   # 云端配置 + 数据源 + 登录态统一入口
│   ├── hooks/useTheme.ts    # 明暗主题
│   ├── lib/
│   │   ├── backend.ts       # 数据源接口定义（auth / 商品 / 订单 / 文件 / 健康检查）
│   │   ├── cloudBackend.ts  # Supabase 实现
│   │   ├── demoBackend.ts   # 本地演示实现（localStorage）
│   │   ├── sales.ts         # 订单状态归一化、交易阶段派生、看板聚合
│   │   ├── constants.ts     # 品类、尺码、颜色、材质、两套导入列定义
│   │   ├── schemaSql.ts     # 初始化 / 增量升级 SQL 常量
│   │   └── format.ts        # 金额 / 时间格式化、净利测算、图片压缩、占位图
│   └── pages/               # LoginPage / DashboardPage / ProductsPage / ProductEditPage
│                            # SalesDashboardPage / SalesOrdersPage / ImportPage / SettingsPage
├── scripts/                 # 端到端测试
│   ├── smoke.mjs            # 演示模式全流程回归（登录→看板→商品→销售→导入→移动端）
│   └── verify-cloud.mjs     # 云端模式线上验证（配置生效 / 请求打到自己的项目 / 路由守卫）
└── supabase/
    ├── schema.sql                    # 全量初始化脚本（可重复执行，自动补新表新字段）
    └── migration-add-fields.sql      # 增量升级脚本（老项目只需跑这份）
```

## 端到端测试

需要本机装有 Google Chrome：

```bash
# 1. 构建并启动静态预览
npm run build
cd out && python3 -m http.server 4173

# 2. 启动无头 Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/ypgj-chrome about:blank

# 3. 运行（截图输出到 /tmp/ypgj-shots）
node scripts/smoke.mjs
```

覆盖：登录页渲染 → 演示账号登录 → 看板 → 列表与搜索 → 新增并保存商品 → 列表确认落库 → 真实上传 Excel 并导入 → 设置页 → 移动端视图，同时收集 console error 与 4xx/5xx 请求。

## 技术栈

React 19 · TypeScript · Vite 7 · Tailwind CSS 3 · shadcn/ui · Recharts · SheetJS · Supabase
