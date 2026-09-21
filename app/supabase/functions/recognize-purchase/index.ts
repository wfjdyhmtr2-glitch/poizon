/**
 * 采购截图识别 · Edge Function
 *
 * 浏览器没有视觉能力，所以由服务端调视觉模型：喂一张「采购订单/购物车/采购单」截图，
 * 吐出结构化的采购明细，前端填进「入仓单批量导入」的预览表里，人工核对后一次导入。
 *
 * ── 部署步骤（Supabase 控制台；密钥与 recognize-product 共用，不用重复配）──
 * ⚠️ 「函数名」不是一开始让你填的，它在**编辑器底部**（`Deploy function` 按钮旁边）——
 *    很多人卡在这一步。顺序是「先删模板 → 再粘代码 → 最后填名字并部署」：
 *   1. 左侧 Edge Functions → Deploy a new function → Via Editor
 *      （若先弹出模板列表，随便选一个，下一步会把模板代码整个删掉）
 *   2. 编辑器里先清空：Command + A → Delete
 *   3. 把本文件内容整段粘进去（Command + V）
 *   4. 编辑器底部 **Function name** 填：recognize-purchase   （必须完全一致，前端按这个名字调用）
 *   5. 有 "Verify JWT with legacy secret" 开关就关掉（与 recognize-product 一致），点 Deploy function
 *   6. Secrets 里确认有 VISION_API_KEY（和 recognize-product 用同一个，通常早就配过了）
 *
 * ── 不想点界面？用 CLI 直接部署（无需 Docker）──
 *   SUPABASE_ACCESS_TOKEN=<sbp_...> supabase functions deploy recognize-purchase \
 *     --use-api --no-verify-jwt --project-ref <项目ref>
 *   （access token 在 Account → Access Tokens → Generate new token 生成）
 *
 * 没部署这个函数也没关系：批量导入的「粘贴 / Excel」照旧能用，只是少了截图这条路。
 */

import { createClient } from "npm:@supabase/supabase-js@2"

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

const PROMPT = `你是电商财务录入助手。这张图是**采购订单 / 已买到的宝贝 / 购物车 / 采购单 / 供货商对账**的截图。
把图里的商品逐行提取出来，**只输出一个 JSON 对象**，不要任何多余文字、不要 markdown 代码块：

{"platform":"平台名（淘宝/拼多多/1688/抖店/唯品会/得物…认不出就空串）","date":"下单日期 YYYY-MM-DD（认不出就空串）","rows":[{"name":"商品名称","spec":"颜色/尺码/型号等规格","quantity":数量,"unitPrice":单价,"amount":该行金额}]}

要求：
1. quantity 是数字（图里有 x2、×2、数量2 都算 2；没写就填 1）。
2. unitPrice 是**一件**的价格（数字，认不出填 null）；amount 是这一行的金额（数字，认不出填 null）。
3. **不要把订单总价、实付款、运费、优惠、合计当成某件商品的单价**——那是整单的，不要填进行里。
4. name 原样抄，不要翻译、不要改写、不要补全你猜的品牌。
5. 只输出"商品行"：店铺名、收货地址、按钮文字、广告语都不要。
6. 认不出价格的行的 unitPrice/amount 填 null，**不要瞎猜数字**。
7. 图上确实没有商品时，rows 返回空数组 []。`

type Row = {
  name?: unknown
  spec?: unknown
  quantity?: unknown
  unitPrice?: unknown
  amount?: unknown
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/[^\d.\-]/g, ""))
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string {
  return String(v ?? "").trim()
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "只支持 POST" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const apiKey = Deno.env.get("VISION_API_KEY")
  if (!url || !anonKey) return json({ error: "函数缺少 Supabase 环境变量" }, 500)
  if (!apiKey) {
    return json(
      { error: "还没配置视觉模型密钥：在 Supabase 的 Edge Functions → Secrets 里加上 VISION_API_KEY" },
      500,
    )
  }

  // 只允许已登录用户调用，避免被人当免费代理刷
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  })
  const { data: authData, error: authError } = await asCaller.auth.getUser()
  if (authError || !authData?.user) return json({ error: "未登录或登录已失效" }, 401)

  let payload: { image_base64?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400)
  }
  // 浏览器传的是 data URL（data:image/jpeg;base64,xxx），直接透传给模型
  const imageBase64 = String(payload.image_base64 ?? "").trim()
  if (!imageBase64) return json({ error: "缺少 image_base64" }, 400)
  if (!imageBase64.startsWith("data:image/")) {
    return json({ error: "image_base64 需要是 data:image/... 开头的 data URL" }, 400)
  }
  // 太大会被上游拒绝，也没必要（截图压到 1600px 以内足够了）
  if (imageBase64.length > 6_000_000) {
    return json({ error: "图片太大，请压缩后再试（宽度压到 1600px 以内）" }, 413)
  }

  const baseUrl =
    Deno.env.get("VISION_BASE_URL") ?? "https://open.bigmodel.cn/api/paas/v4/chat/completions"
  const model = Deno.env.get("VISION_MODEL") ?? "glm-4v-flash"

  let upstream: Response
  try {
    upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    return json({ error: `调用视觉模型失败：${(err as Error).message}` }, 502)
  }

  if (!upstream.ok) {
    const detail = await upstream.text()
    return json({ error: `视觉模型返回 ${upstream.status}：${detail.slice(0, 300)}` }, 502)
  }

  const result = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = result.choices?.[0]?.message?.content ?? ""

  // 模型可能把 JSON 包在 ``` 里、或前后带废话：宽松地抠出第一个 JSON 对象/数组
  const objMatch = raw.match(/\{[\s\S]*\}/)
  const arrMatch = raw.match(/\[[\s\S]*\]/)
  let parsed: { platform?: unknown; date?: unknown; rows?: Row[] } = {}
  if (objMatch) {
    try {
      parsed = JSON.parse(objMatch[0]) as typeof parsed
    } catch {
      /* 交给下面的兜底 */
    }
  }
  let rawRows: Row[] = Array.isArray(parsed.rows) ? parsed.rows : []
  if (!rawRows.length && arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0])
      if (Array.isArray(arr)) rawRows = arr as Row[]
    } catch {
      /* ignore */
    }
  }

  const rows = rawRows
    .map((r) => {
      const quantity = num(r.quantity)
      const amount = num(r.amount)
      let unitPrice = num(r.unitPrice)
      // 只给了行金额和数量就自己除出单价；除不尽也照算，前端还有人工核对
      if (unitPrice === null && amount !== null && quantity && quantity > 0) {
        unitPrice = Number((amount / quantity).toFixed(2))
      }
      return {
        name: str(r.name),
        spec: str(r.spec),
        quantity: quantity && quantity > 0 ? Math.round(quantity) : 1,
        unitPrice,
        amount,
      }
    })
    .filter((r) => r.name || r.spec || r.unitPrice !== null)

  if (!rows.length) {
    return json({
      platform: "",
      date: "",
      rows: [],
      note: raw.trim().slice(0, 160) || "这张图里没认出采购明细，换张更清楚的截图试试",
    })
  }

  return json({
    platform: str(parsed.platform),
    date: str(parsed.date),
    rows,
    note: "",
  })
})
