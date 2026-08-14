// ===== VLM 视觉语言模块（通义千问 Qwen-VL，浏览器直连 DashScope） =====
// @author: 同学B - NLP/VLM 模块
// 职责：看图识别物品，一次返回 {category, subject, description}。
//       category 精准定类，description 直接出暖心文案。
//       与 MediaPipe 并发：VLM 定类+出文案，MediaPipe 检测手部遮挡。失败返回 null，由调用方回退。
(function (global) {
  "use strict";

  // 从全局配置读取（缺失则用兜底默认）
  const _vlm = (global.AppConfig && global.AppConfig.models && global.AppConfig.models.vlm) || {};
  const API_URL = (global.AppConfig && global.AppConfig.cdn && global.AppConfig.cdn.aiProxy) || "/.netlify/functions/ai";
  const MODEL = _vlm.model || "qwen-vl-max";
  const TIMEOUT_MS = _vlm.timeout || 15000;
  const TEMPERATURE = _vlm.temperature != null ? _vlm.temperature : 0.7;
  const MAX_TOKENS = _vlm.maxTokens || 400;

  // VLM 返回的中文类目 → 页面内部 category
  const CATEGORY_MAP = (global.AppConfig && global.AppConfig.categories && global.AppConfig.categories.vlmResponseMap) || {
    "教材": "book",
    "校服": "uniform",
    "正装": "uniform",
    "水杯": "bottle",
    "台灯": "lamp",
    "书包": "backpack",
    "充电宝": "digital",
    "数码配件": "digital",
    "电子设备": "digital"
  };

  async function callDashScope(messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { "Content-Type": "application/json" };
      const token = global.AuthModule && global.AuthModule.getToken();
      if (token) headers["Authorization"] = "Bearer " + token;
      const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("识别服务返回 " + response.status);
      const data = await response.json();
      return data.choices[0].message.content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  // 从模型输出里提取 JSON（兼容 ```json 代码块包裹）
  function extractJSON(text) {
    if (!text) return null;
    const t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  // 主入口：imageDataUrl(压缩后的 base64 data URL) → {category, subject, description} 或 null
  async function analyzeImage(imageDataUrl) {
    if (!imageDataUrl) return null; // 无图，静默回退（Key 已在后端）

    const systemPrompt =
      "你是校园二手循环平台的物品识别助手。看图识别物品，只返回JSON，不要任何解释。" +
      "字段：category(必须是[教材,校服,水杯,台灯,书包,数码配件]之一；充电宝、耳机、数据线、鼠标等归为数码配件)、" +
      "subject(物品具体名称或科目，如 高等数学)、" +
      "description(面向学弟学妹的暖心介绍，温暖口语化、不说教，80-150字)。";
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: "请识别这张图中的物品并按要求返回JSON。" }
        ]
      }
    ];

    try {
      const content = await callDashScope(messages);
      const parsed = extractJSON(content);
      if (!parsed) return null;
      const category = CATEGORY_MAP[parsed.category] || "book";
      return {
        category,
        subject: String(parsed.subject || "").trim() || "物品",
        description: String(parsed.description || "").trim()
      };
    } catch (error) {
      console.warn("[VLM] 调用失败，回退到 Qwen/离线文案：", error.message);
      return null;
    }
  }

  global.VLMModule = { analyzeImage };
})(window);
