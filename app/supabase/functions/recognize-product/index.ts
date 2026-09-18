/**
 * 图片找同款 · 识别函数
 *
 * 浏览器没有视觉能力，所以要有个服务端去调视觉模型。函数只做一件事：
 * 接一个图片地址，返回「品牌 + 搜索关键词」。前端拿到关键词后自己拼各平台的搜索链接。
 *
 * ── 部署步骤（Supabase 控制台，约 3 分钟）──
 *   1. 左侧 Edge Functions → Deploy a new function → Via Editor
 *   2. 函数名填：recognize-product     （必须完全一致，前端按这个名字调用）
 *   3. 把本文件内容整体粘进去，删掉模板示例代码，点 Deploy
 *   4. 到 Settings → Edge Functions → Secrets 里加两个变量：
 *        VISION_API_KEY = 你的视觉模型密钥
 *        （可选）VISION_BASE_URL / VISION_MODEL
 *   5. 顶部 "Verify JWT with legacy secret" 保持关闭（函数内部自己校验登录态）
 *
 * ── 免费额度怎么拿 ──
 *   默认走智谱 GLM-4V-Flash（目前免费）：open.bigmodel.cn 注册 → 控制台建 API Key。
 *   换别家也可以，只要兼容 OpenAI 的 /chat/completions 格式（通义、DeepSeek 等都行），
 *   改 VISION_BASE_URL + VISION_MODEL 两个变量即可。
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

const PROMPT = `你是电商选品助手。看这张商品图，判断它是什么商品，然后**只输出一个 JSON 对象**，不要任何多余文字、不要 markdown 代码块：
{"brand":"品牌名（认不出就空串）","keyword":"用于在电商平台搜索同款的中文关键词","note":"一句话说明这是什么商品"}

keyword 的要求：尽量精准，按「品牌 + 品类 + 型号/系列 + 颜色/材质」组织，
例如 "Nike 空军一号 低帮 白色"、"adidas Samba OG 黑白"、"New Balance 574 元祖灰"。
如果完全认不出是什么商品，keyword 返回空串。`

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

  let payload: { image_url?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400)
  }
  const imageUrl = String(payload.image_url ?? "").trim()
  if (!imageUrl) return json({ error: "缺少 image_url" }, 400)

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
              { type: "image_url", image_url: { url: imageUrl } },
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

  // 模型可能把 JSON 包在 ``` 里，或者前后带废话，这里宽松地抠出第一个 JSON 对象
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed: { brand?: string; keyword?: string; note?: string } = {}
  if (match) {
    try {
      parsed = JSON.parse(match[0])
    } catch {
      /* 解析不了就走下面的兜底 */
    }
  }

  const keyword = String(parsed.keyword ?? "").trim()
  if (!keyword) {
    return json({
      keyword: "",
      brand: "",
      note: raw.trim().slice(0, 120) || "没认出这是什么商品，手动填一下关键词",
    })
  }

  return json({
    keyword,
    brand: String(parsed.brand ?? "").trim(),
    note: String(parsed.note ?? "").trim(),
  })
})
