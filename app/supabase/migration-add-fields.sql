-- 得物 · 增量升级脚本（可重复执行）

-- 数据归属列提前建好（后面的触发器 / 函数会引用到）
-- spu_info（商品信息登记）在此建表：迁移脚本后段的存量归属 update 依赖它
create table if not exists public.spu_info (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid,
  sku        text not null,
  name       text not null default '',
  image_url  text not null default '',
  price      numeric(12,2),
  updated_at timestamptz not null default now()
);

create unique index if not exists spu_info_owner_sku_key on public.spu_info (owner_id, sku);

alter table if exists public.products              add column if not exists owner_id uuid;
alter table if exists public.sales_orders          add column if not exists owner_id uuid;
alter table if exists public.spu_mappings          add column if not exists owner_id uuid;
alter table if exists public.product_images        add column if not exists owner_id uuid;
alter table if exists public.purchase_orders       add column if not exists owner_id uuid;
alter table if exists public.purchase_order_items  add column if not exists owner_id uuid;
alter table if exists public.spu_info               add column if not exists owner_id uuid;
alter table if exists public.other_expenses         add column if not exists owner_id uuid;

-- ---------- 其他费用（平台层面的支出，不绑定商品）----------
-- 金额符号：正 = 支出，负 = 收回。充值保证金与取回保证金是两条独立记录。
create table if not exists public.other_expenses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid,
  expense_date date not null default current_date,
  category     text not null default '其他',
  platform     text,
  amount       numeric(12,2) not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists other_expenses_date_idx  on public.other_expenses (expense_date desc);
create index if not exists other_expenses_owner_idx on public.other_expenses (owner_id);

-- ---------- 市场快照（选品参考：大盘 / 品牌 两个维度的销量与收藏数）----------
-- scope：'overall' = 大盘数据（平台整体），'brand' = 品牌 / 单商品数据
-- (owner_id, sku, snapshot_date) 唯一 → 同一天重复导入是覆盖，不是堆叠
create table if not exists public.market_snapshots (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid,
  scope         text not null default 'brand',
  snapshot_date date not null,
  sku           text not null,
  brand         text,
  name          text,
  sales         numeric(14,2),
  favorites     numeric(14,0),
  created_at    timestamptz not null default now()
);

create unique index if not exists market_snapshots_key
  on public.market_snapshots (owner_id, sku, snapshot_date);
create index if not exists market_snapshots_date_idx  on public.market_snapshots (snapshot_date desc);
create index if not exists market_snapshots_brand_idx on public.market_snapshots (brand);
create index if not exists market_snapshots_sku_idx   on public.market_snapshots (sku);
create index if not exists market_snapshots_scope_idx on public.market_snapshots (scope, snapshot_date desc);

-- 1) 商品表补齐后来新增的字段
alter table public.products
  add column if not exists purchase_platform text,
  add column if not exists net_price         numeric(12,2),
  add column if not exists platform_fee      numeric(12,2),
  add column if not exists shipping_fee      numeric(12,2),
  add column if not exists rebate            numeric(12,2),
  add column if not exists remark            text,
  add column if not exists locked_stock      integer not null default 0;

create index if not exists products_platform_idx on public.products (purchase_platform);

-- 1b) 图片库（独立模块，按 SPUID / 颜色匹配）
create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid,
  sku        text not null,
  color      text not null default '',
  url        text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_images_sku_idx   on public.product_images (sku);
create index if not exists product_images_color_idx on public.product_images (sku, color);

alter table public.product_images enable row level security;
drop policy if exists "product_images_authenticated_all" on public.product_images;
create policy "product_images_authenticated_all" on public.product_images
  for all to authenticated using (true) with check (true);

-- 1c) 入仓单（采购订单维度）
create table if not exists public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid,
  order_no     text not null unique,
  platform     text,
  purchased_at date,
  shipping_fee numeric(12,2),
  remark       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid,
  purchase_order_id uuid not null references public.purchase_orders on delete cascade,
  sku               text not null,
  name              text,
  price             numeric(12,2),
  color             text not null default '',
  size              text not null default '',
  quantity          integer not null default 0,
  unit_cost         numeric(12,2),
  created_at        timestamptz not null default now()
);

create index if not exists purchase_order_items_po_idx  on public.purchase_order_items (purchase_order_id);
create index if not exists purchase_order_items_sku_idx on public.purchase_order_items (sku);

alter table public.purchase_order_items
  add column if not exists name  text,
  add column if not exists price numeric(12,2);

alter table public.purchase_orders enable row level security;
drop policy if exists "purchase_orders_authenticated_all" on public.purchase_orders;
create policy "purchase_orders_authenticated_all" on public.purchase_orders
  for all to authenticated using (true) with check (true);

alter table public.purchase_order_items enable row level security;
drop policy if exists "purchase_order_items_authenticated_all" on public.purchase_order_items;
create policy "purchase_order_items_authenticated_all" on public.purchase_order_items
  for all to authenticated using (true) with check (true);

-- 2) 新增销售订单表
--    先确保 updated_at 触发器函数存在（老库一般已有，这里做幂等兜底）
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.sales_orders (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid,
  order_no        text not null unique,
  sku             text not null default '',
  spec            text,
  order_status    text not null default '交易成功',
  is_returned     boolean not null default false,
  is_settled      boolean not null default false,
  bid_amount      numeric(12,2),
  expected_income numeric(12,2),
  after_sales     text,
  paid_at         timestamptz,
  trade_stage     text generated always as (
                    case
                      when order_status = '交易失败'     then 'unpaid'
                      when order_status = '交易关闭成功' then 'refund_before_ship'
                      when order_status = '交易成功' and is_returned then 'refund_after_receive'
                      when order_status = '交易成功'     then 'completed'
                      else 'unknown'
                    end
                  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_orders_sku_idx    on public.sales_orders (sku);
create index if not exists sales_orders_stage_idx  on public.sales_orders (trade_stage);
create index if not exists sales_orders_settle_idx on public.sales_orders (is_settled);
create index if not exists sales_orders_paid_idx   on public.sales_orders (paid_at desc);

drop trigger if exists sales_orders_touch_updated_at on public.sales_orders;
create trigger sales_orders_touch_updated_at
  before update on public.sales_orders
  for each row execute function public.touch_updated_at();

alter table public.sales_orders enable row level security;

drop policy if exists "sales_orders_authenticated_all" on public.sales_orders;
create policy "sales_orders_authenticated_all" on public.sales_orders
  for all to authenticated using (true) with check (true);

-- 3) 库存联动：让订单自动占用 / 返回 / 核销商品库存
-- ---------- SPU 对照表（平台 spuID ↔ 本店 SPUID）----------
create table if not exists public.spu_mappings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,
  external_id text not null unique,
  sku         text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists spu_mappings_sku_idx on public.spu_mappings (sku);

alter table public.spu_mappings enable row level security;
drop policy if exists "spu_mappings_authenticated_all" on public.spu_mappings;
create policy "spu_mappings_authenticated_all" on public.spu_mappings
  for all to authenticated using (true) with check (true);

-- ---------- 库存联动 ----------
alter table public.products
  add column if not exists locked_stock integer not null default 0;
alter table public.sales_orders
  add column if not exists resolved_sku text;

comment on column public.products.locked_stock is '被「生效但未结算」的订单锁定的数量，由 sales_orders 触发器维护';
comment on column public.sales_orders.resolved_sku is '按「直接匹配 SPUID → SPU 对照表」解析出的商品 SPUID，解析不到为 null';

-- 解析：订单里的 spuID 先直接匹配商品表，匹配不到再查对照表
create or replace function public.resolve_order_sku(p_sku text)
returns text language sql stable as $$
  select case
    when p_sku is null or p_sku = '' then null
    when exists (
      select 1 from public.products pr
      where pr.sku = p_sku
    ) then p_sku
    else (
      select m.sku from public.spu_mappings m
      where m.external_id = p_sku limit 1
    )
  end;
$$;

create or replace function public.order_stock_effect(
  p_status text, p_returned boolean, p_settled boolean
) returns text language sql immutable as $$
  select case
    when p_status = '交易成功' and not coalesce(p_returned, false)
         and coalesce(p_settled, false) then 'consumed'
    when p_status = '交易成功' and not coalesce(p_returned, false) then 'locked'
    else 'released'
  end;
$$;

create or replace function public.apply_stock_delta(
  p_sku text, p_effect text, p_sign integer
) returns void language plpgsql as $$
declare
  d_locked integer := 0;
  d_stock  integer := 0;
begin
  if p_effect is null or p_sku is null or p_sku = '' then
    return;
  end if;

  if p_effect = 'locked' then
    d_locked := 1; d_stock := -1;
  elsif p_effect = 'consumed' then
    d_stock := -1;
  else
    return;
  end if;

  update public.products
     set locked_stock = greatest(0, locked_stock + d_locked * p_sign),
         stock        = stock + d_stock * p_sign,
         updated_at   = now()
   where sku = p_sku;
end;
$$;

-- 写订单前先解析 spuID → 商品 SPUID
create or replace function public.resolve_sku_on_order()
returns trigger language plpgsql as $$
begin
  new.resolved_sku := public.resolve_order_sku(new.sku);
  return new;
end;
$$;

create or replace function public.sync_stock_from_order()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.apply_stock_delta(
      old.resolved_sku,
      public.order_stock_effect(old.order_status, old.is_returned, old.is_settled),
      -1);
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if old.resolved_sku is distinct from new.resolved_sku then
      perform public.apply_stock_delta(
        old.resolved_sku,
        public.order_stock_effect(old.order_status, old.is_returned, old.is_settled),
        -1);
    end if;
  end if;

  perform public.apply_stock_delta(
    new.resolved_sku,
    public.order_stock_effect(new.order_status, new.is_returned, new.is_settled),
    1);
  return null;
end;
$$;

-- 让某外部 spuID 名下的订单全部重新解析一遍（对照表变动时调用）
create or replace function public.refresh_orders_for_external(p_external text)
returns void language plpgsql as $$
begin
  if p_external is null or p_external = '' then return; end if;
  -- 自赋值触发 BEFORE 解析触发器重算 resolved_sku，再由 AFTER 触发器按差额调整库存
  update public.sales_orders set sku = sku where sku = p_external;
end;
$$;

drop trigger if exists sales_orders_resolve_sku on public.sales_orders;
create trigger sales_orders_resolve_sku
  before insert or update on public.sales_orders
  for each row execute function public.resolve_sku_on_order();

drop trigger if exists sales_orders_sync_stock on public.sales_orders;
create trigger sales_orders_sync_stock
  after insert or update or delete on public.sales_orders
  for each row execute function public.sync_stock_from_order();

-- 对照表变动 → 受影响订单重新解析、库存随之调整
create or replace function public.refresh_orders_for_external_mapping()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_orders_for_external(old.external_id);
  elsif tg_op = 'UPDATE' and old.external_id is distinct from new.external_id then
    perform public.refresh_orders_for_external(old.external_id);
    perform public.refresh_orders_for_external(new.external_id);
  else
    perform public.refresh_orders_for_external(new.external_id);
  end if;
  return null;
end;
$$;

drop trigger if exists spu_mappings_refresh_stock on public.spu_mappings;
create trigger spu_mappings_refresh_stock
  after insert or update or delete on public.spu_mappings
  for each row execute function public.refresh_orders_for_external_mapping();

-- 新建 / 改名的商品可能让之前「解析不到」的订单突然匹配上
create or replace function public.refresh_orders_for_product()
returns trigger language plpgsql as $$
begin
  perform public.refresh_orders_for_external(new.sku);
  return null;
end;
$$;

drop trigger if exists products_refresh_orders on public.products;
create trigger products_refresh_orders
  after insert or update of sku on public.products
  for each row execute function public.refresh_orders_for_product();

-- 存量订单补解析（列刚加上时 resolved_sku 全为 null，重算后会自动锁定该锁的库存）
update public.sales_orders set sku = sku where resolved_sku is null;

-- 4) 访问控制：仅限管理员账号

-- ---------- 访问控制、成员与角色 ----------

-- ---------- 成员表：账号白名单 + 角色 ----------
-- 只有出现在这张表里的账号才能访问业务数据；
-- role = 'admin' 可管理账号、可删除数据；'member' 只能查看与录入。
create table if not exists public.app_members (
  id           uuid primary key,
  email        text not null default '',
  role         text not null default 'member',
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint app_members_role_check check (role in ('admin', 'member'))
);

create index if not exists app_members_email_idx on public.app_members (lower(email));

-- 把已有账号补录进来（超管固定为 admin），可重复执行
insert into public.app_members (id, email, role)
select u.id,
       lower(u.email),
       case when lower(u.email) = lower('shuo@dewu.com') then 'admin' else 'member' end
  from auth.users u
 where u.email is not null
    on conflict (id) do nothing;

-- 超管的角色永远校正回 admin
update public.app_members
   set role = 'admin'
 where lower(email) = lower('shuo@dewu.com')
   and role <> 'admin';

alter table public.app_members enable row level security;

-- 成员判定：必须是白名单里的账号。
-- security definer 让函数以定义者身份读表，避免策略自引用导致无限递归。
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.app_members m where m.id = auth.uid())
$$;

-- 管理员判定：超管邮箱，或成员表里 role = 'admin'
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('shuo@dewu.com')
      or exists (
           select 1 from public.app_members m
            where m.id = auth.uid() and m.role = 'admin'
         )
$$;

-- app_members 自身：成员可读全表（页面要展示同事），仅管理员可增删改
drop policy if exists "app_members_select" on public.app_members;
create policy "app_members_select" on public.app_members
  for select to authenticated using (public.is_member());

drop policy if exists "app_members_insert" on public.app_members;
create policy "app_members_insert" on public.app_members
  for insert to authenticated with check (public.is_admin());

drop policy if exists "app_members_update" on public.app_members;
create policy "app_members_update" on public.app_members
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "app_members_delete" on public.app_members;
create policy "app_members_delete" on public.app_members
  for delete to authenticated using (public.is_admin());

-- 数据归属：写入时自动打上创建者，存量数据归管理员
create or replace function public.set_owner_id()
returns trigger
language plpgsql
as $$
begin
  new.owner_id := coalesce(new.owner_id, auth.uid());
  return new;
end;
$$;

-- 每张业务表加 owner_id
alter table public.products             add column if not exists owner_id uuid;
alter table public.sales_orders         add column if not exists owner_id uuid;
alter table public.spu_mappings         add column if not exists owner_id uuid;
alter table public.product_images       add column if not exists owner_id uuid;
alter table public.purchase_orders      add column if not exists owner_id uuid;
alter table public.purchase_order_items add column if not exists owner_id uuid;
alter table public.other_expenses       add column if not exists owner_id uuid;
alter table public.market_snapshots     add column if not exists owner_id uuid;
alter table public.market_snapshots     add column if not exists scope text not null default 'brand';

-- 存量数据归属管理员
update public.products              set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.sales_orders          set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.spu_mappings          set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.product_images        set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.purchase_orders       set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.purchase_order_items  set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;
update public.spu_info              set owner_id = (select id from auth.users where lower(email) = lower('shuo@dewu.com') limit 1) where owner_id is null;

-- 写入时自动打归属
drop trigger if exists products_set_owner on public.products;
create trigger products_set_owner before insert on public.products
  for each row execute function public.set_owner_id();

drop trigger if exists sales_orders_set_owner on public.sales_orders;
create trigger sales_orders_set_owner before insert on public.sales_orders
  for each row execute function public.set_owner_id();

drop trigger if exists spu_mappings_set_owner on public.spu_mappings;
create trigger spu_mappings_set_owner before insert on public.spu_mappings
  for each row execute function public.set_owner_id();

drop trigger if exists product_images_set_owner on public.product_images;
create trigger product_images_set_owner before insert on public.product_images
  for each row execute function public.set_owner_id();

drop trigger if exists purchase_orders_set_owner on public.purchase_orders;
create trigger purchase_orders_set_owner before insert on public.purchase_orders
  for each row execute function public.set_owner_id();

drop trigger if exists purchase_order_items_set_owner on public.purchase_order_items;
create trigger purchase_order_items_set_owner before insert on public.purchase_order_items
  for each row execute function public.set_owner_id();

drop trigger if exists spu_info_set_owner on public.spu_info;
create trigger spu_info_set_owner before insert on public.spu_info
  for each row execute function public.set_owner_id();

drop trigger if exists other_expenses_set_owner on public.other_expenses;
create trigger other_expenses_set_owner before insert on public.other_expenses
  for each row execute function public.set_owner_id();

drop trigger if exists market_snapshots_set_owner on public.market_snapshots;
create trigger market_snapshots_set_owner before insert on public.market_snapshots
  for each row execute function public.set_owner_id();

-- 策略：团队共享——所有成员可读可写（查看 / 录入 / 编辑 / 导入），删除仅限管理员。
-- 注意：PostgreSQL 的同表多条策略之间是 OR 关系，所以必须**按操作拆分**；
-- 若用一条 for all 覆盖，成员会连带拿到删除权。
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'sales_orders', 'spu_mappings', 'product_images',
    'purchase_orders', 'purchase_order_items', 'spu_info', 'other_expenses',
    'market_snapshots'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_member())',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      t || '_delete', t);
  end loop;
end $$;

-- 匿名一律不可见
drop policy if exists "products_anon_read_on_sale" on public.products;

-- 图片桶：公开读保持（图片链接要能显示），登录用户可上传自己的图
drop policy if exists "product_images_auth_insert" on storage.objects;
create policy "product_images_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_member());

drop policy if exists "product_images_auth_update" on storage.objects;
create policy "product_images_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_member())
  with check (bucket_id = 'product-images' and public.is_member());

drop policy if exists "product_images_auth_delete" on storage.objects;
create policy "product_images_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_member());

-- ---------- 市场数据的聚合函数 ----------
-- 排行与汇总都在**数据库侧**算完再返回 TOP N，前端永远不拉全量明细——
-- 这是「商品再多、日期再多也不卡」的关键。
-- 这几个函数是 security invoker（默认），所以 RLS 照常生效。

-- 品牌清单（附带每个品牌下的商品数），用于品牌页的筛选下拉
drop function if exists public.market_brands();
create or replace function public.market_brands()
returns table (brand text, sku_count integer)
language sql
stable
set search_path = public
as $$
  select coalesce(nullif(trim(m.brand), ''), '未标注') as brand,
         count(distinct m.sku)::integer as sku_count
    from public.market_snapshots m
   where m.scope = 'brand'
   group by 1
   order by 2 desc;
$$;

-- 数据概览：按「大盘 / 品牌」分别统计覆盖多少商品、多少天、最新日期、总记录数
drop function if exists public.market_overview(date, date);
create or replace function public.market_overview(
  p_start date default null,
  p_end   date default null,
  p_scope text default 'brand'
)
returns table (sku_count integer, day_count integer, latest_date date, snapshot_count integer)
language sql
stable
set search_path = public
as $$
  select count(distinct m.sku)::integer,
         count(distinct m.snapshot_date)::integer,
         max(m.snapshot_date),
         count(*)::integer
    from public.market_snapshots m
   where m.scope = coalesce(nullif(p_scope, ''), 'brand')
     and (p_start is null or m.snapshot_date >= p_start)
     and (p_end   is null or m.snapshot_date <= p_end);
$$;

-- 机会排行：区间内每个商品的销量合计 + 收藏增量，按收藏增量排序
drop function if exists public.market_ranking(date, date, text[], text, integer);
create or replace function public.market_ranking(
  p_start   date    default null,
  p_end     date    default null,
  p_brands  text[]  default null,
  p_keyword text    default null,
  p_limit   integer default 50,
  p_scope   text    default 'brand'
)
returns table (
  sku              text,
  name             text,
  brand            text,
  sales_total      numeric,
  favorites_growth numeric,
  favorites_latest numeric,
  points           integer
)
language sql
stable
set search_path = public
as $$
  with base as (
    select m.sku,
           max(m.name)  as name,
           max(m.brand) as brand,
           sum(coalesce(m.sales, 0)) as sales_total,
           (array_agg(coalesce(m.favorites, 0) order by m.snapshot_date asc))[1]  as fav_first,
           (array_agg(coalesce(m.favorites, 0) order by m.snapshot_date desc))[1] as fav_last,
           count(*)::integer as points
      from public.market_snapshots m
     where m.scope = coalesce(nullif(p_scope, ''), 'brand')
       and (p_start is null or m.snapshot_date >= p_start)
       and (p_end   is null or m.snapshot_date <= p_end)
       and (p_brands is null
            or coalesce(nullif(trim(m.brand), ''), '未标注') = any(p_brands))
       and (p_keyword is null or p_keyword = ''
            or m.sku ilike '%' || p_keyword || '%'
            or coalesce(m.name, '') ilike '%' || p_keyword || '%')
     group by m.sku
  )
  select sku,
         coalesce(name, ''),
         brand,
         sales_total,
         coalesce(fav_last, 0) - coalesce(fav_first, 0) as favorites_growth,
         coalesce(fav_last, 0) as favorites_latest,
         points
    from base
   order by (coalesce(fav_last, 0) - coalesce(fav_first, 0)) desc,
            sales_total desc
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;


-- 5) 让 PostgREST 立刻感知新表与新字段
notify pgrst, 'reload schema';
