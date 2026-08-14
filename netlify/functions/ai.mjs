// ===== AI 代理：浏览器 → 本函数 → DashScope（需登录会话） =====
// Key 只存在 Netlify 环境变量 DASHSCOPE_API_KEY，前端代码不持有任何密钥。
// 兼容 VLM（qwen-vl-max，messages 含 image_url）与 NLP（qwen-plus）两种调用，
// 原样转发 chat-completions 请求与响应。要求有效登录会话，防止配额盗刷。
import { requireUser } from "./_shared/auth-guard.mjs";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const [user, unauthorized] = await requireUser(request);
  if (!user) return unauthorized;

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return json({ error: "DashScope API key not configured" }, { status: 500 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstream = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: payload.model || "qwen-plus",
        messages: payload.messages,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens
      }),
      signal: controller.signal
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return json({ error: "Upstream failed: " + error.message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
