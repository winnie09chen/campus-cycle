// ===== NLP 文案生成 + 需求解析模块（DashScope/Qwen 版） =====
// @author: 同学B - NLP 文案生成模块
// 职责：1) 根据物品信息生成暖心文案（Qwen API + 离线模板兜底）
//       2) 把买家/援助申请的自然语言需求解析成结构化数据（Qwen JSON + 正则兜底）
(function (global) {
  "use strict";

  const _nlp = (global.AppConfig && global.AppConfig.models && global.AppConfig.models.nlp) || {};
  const _cat = (global.AppConfig && global.AppConfig.categories) || {};
  const API_URL = (global.AppConfig && global.AppConfig.cdn && global.AppConfig.cdn.aiProxy) || "/.netlify/functions/ai";
  const TIMEOUT_MS = _nlp.timeout || 8000;
  const NLP_MODEL = _nlp.model || "qwen-plus";
  const NLP_TEMP = _nlp.temperature != null ? _nlp.temperature : 0.4;
  const NLP_MAX_TOKENS = _nlp.maxTokens || 300;
  let lastMode = "等待解析";
  let lastError = "";

  const zhCategory = _cat.labels || {
    book: "教材",
    uniform: "校服",
    clothing: "校服/正装",
    lamp: "台灯",
    bottle: "水杯",
    backpack: "书包",
    digital: "数码配件"
  };

  function getLastMode() {
    return lastMode;
  }

  function getLastError() {
    return lastError;
  }

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
          model: NLP_MODEL,
          messages,
          temperature: NLP_TEMP,
          max_tokens: NLP_MAX_TOKENS
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        let detail = "";
        try {
          const err = await response.json();
          detail = err.message || err.error?.message || JSON.stringify(err);
        } catch (e) {
          detail = await response.text();
        }
        throw new Error("DashScope 返回 " + response.status + (detail ? "：" + detail : ""));
      }
      const data = await response.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error("DashScope 未返回 message.content");
      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

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

  const OFFLINE_TEMPLATES = [
    "这件{categoryZh}陪学长走过了一整个学期，{conditionText}，{priceText}就出给有缘的学弟学妹，希望它在你手里继续发挥作用。",
    "毕业带不走啦！{categoryZh}{conditionText}，用着完全没问题，{priceText}诚意出，欢迎来宿舍自提。",
    "与其让它吃灰，不如传给需要的你。{categoryZh}{conditionText}，{priceText}，适合校内同学继续循环使用。"
  ];

  function pickOfflineText(info) {
    const template = OFFLINE_TEMPLATES[Math.floor(Math.random() * OFFLINE_TEMPLATES.length)];
    const categoryZh = info.subject && info.subject !== "不限"
      ? info.subject
      : zhCategory[info.category] || info.category || "物品";
    const defects = (info.defects || []).filter(Boolean);
    const conditionText = defects.length
      ? "有" + defects.join("、") + "，但不影响正常使用"
      : "整体成色不错（约" + (info.conditionScore || 85) + "分）";
    const priceText = info.price ? "￥" + info.price : "价格好商量";
    return template
      .replace(/\{categoryZh\}/g, categoryZh)
      .replace(/\{conditionText\}/g, conditionText)
      .replace(/\{priceText\}/g, priceText);
  }

  async function generateDescription(info, options) {
    const safeInfo = info || {};
    const categoryZh = zhCategory[safeInfo.category] || safeInfo.category || "闲置物品";
    const subject = safeInfo.subject || categoryZh;
    const condition = (safeInfo.defects && safeInfo.defects.length)
      ? "有" + safeInfo.defects.join("、") + "，成色约" + (safeInfo.conditionScore || 85) + "分"
      : "成色约" + (safeInfo.conditionScore || 85) + "分，整体状态不错";
    const price = safeInfo.price ? safeInfo.price + "元" : "价格可议";

    const messages = [
      {
        role: "system",
        content: "你是温暖友善的大学学长/学姐，请为校园循环平台写一段80-150字物品介绍。直接返回文案，不要解释。"
      },
      {
        role: "user",
        content:
          "物品类别：" + categoryZh + "\n" +
          "物品名称：" + subject + "\n" +
          "使用情况：" + condition + "\n" +
          "物品价格：" + price
      }
    ];

    try {
      lastError = "";
      return await callDashScope(messages, options);
    } catch (error) {
      lastError = error.message;
      console.warn("[NLP] DashScope 文案生成失败，使用离线模板：", error.message);
      return pickOfflineText({ ...safeInfo, subject });
    }
  }

  const VALID_CATEGORIES = (_cat.validDemand) || ["book", "uniform", "lamp", "bottle", "backpack", "digital"];

  function parseDemandByRules(text) {
    const priceMatch = text.match(/(\d+)\s*元?/);
    let category = "book";
    if (/校服|正装|西装/.test(text)) category = "uniform";
    else if (/台灯|灯/.test(text)) category = "lamp";
    else if (/水杯|杯子|保温杯|水壶/.test(text)) category = "bottle";
    else if (/书包|背包|双肩包/.test(text)) category = "backpack";
    else if (/充电宝|移动电源|耳机|数据线|鼠标|键盘|数码|电子/.test(text)) category = "digital";

    let subject = "高等数学";
    if (/线性代数|线代/.test(text)) subject = "线性代数";
    else if (/高等数学|高数/.test(text)) subject = "高等数学";
    else if (/大学英语|大英|英语/.test(text)) subject = "大学英语";
    else if (/校服/.test(text)) subject = "校服";
    else if (/台灯/.test(text)) subject = "台灯";
    else if (/水杯|杯子|保温杯/.test(text)) subject = "水杯";
    else if (/书包|背包/.test(text)) subject = "书包";
    else if (/充电宝|移动电源/.test(text)) subject = "充电宝";
    else if (/耳机/.test(text)) subject = "耳机";
    else if (/数据线/.test(text)) subject = "数据线";
    else if (/鼠标/.test(text)) subject = "鼠标";
    else if (/键盘/.test(text)) subject = "键盘";

    return {
      category,
      subject,
      wantsNotes: /笔记|划线|重点/.test(text),
      priceMax: priceMatch ? Number(priceMatch[1]) : 30
    };
  }

  async function parseDemand(text, options) {
    const messages = [
      {
        role: "system",
        content:
          "你是校园二手循环平台的需求解析助手。只返回JSON，不要任何解释。" +
          '字段：category，只能是["book","uniform","lamp","bottle","backpack","digital"]之一；充电宝、耳机、数据线、鼠标、键盘归为digital；' +
          "subject，物品具体名称或科目；wantsNotes，是否想要带笔记；priceMax，最高预算数字。"
      },
      { role: "user", content: text }
    ];

    try {
      lastError = "";
      const content = await callDashScope(messages, options);
      const parsed = extractJSON(content);
      if (!parsed) throw new Error("Qwen 返回内容不是可解析 JSON");
      if (!VALID_CATEGORIES.includes(parsed.category)) throw new Error("类别非法");
      lastMode = "Qwen API 解析";
      return {
        category: parsed.category,
        subject: String(parsed.subject || "不限"),
        wantsNotes: Boolean(parsed.wantsNotes),
        priceMax: Number(parsed.priceMax) || 30
      };
    } catch (error) {
      lastError = error.message;
      lastMode = "本地规则解析";
      console.warn("[NLP] Qwen 需求解析失败，使用本地规则：", error.message);
      return parseDemandByRules(text);
    }
  }

  function parseAidNeedByRules(text) {
    const demand = parseDemandByRules(text);
    let urgency = "两周内";
    if (/急|尽快|马上|本周|一周|7天|七天/.test(text)) urgency = "本周内";
    else if (/开学|报到|入学前/.test(text)) urgency = "开学前";

    return {
      category: demand.category,
      subject: demand.subject,
      wantsNotes: demand.wantsNotes,
      budgetMax: demand.priceMax || 20,
      urgency,
      contributionHint: "这条援助申请会帮助平台发现真实缺口，提醒卖家优先上架对应的低价或公益物品。"
    };
  }

  async function parseAidNeed(text, options) {
    const messages = [
      {
        role: "system",
        content:
          "你是校园困难生定向援助池的申请解析助手。只返回JSON，不要任何解释。" +
          '字段：category，只能是["book","uniform","lamp","bottle","backpack","digital"]之一；充电宝、耳机、数据线、鼠标、键盘归为digital；' +
          "subject，具体物品或科目；wantsNotes，是否可接受/需要笔记；budgetMax，可接受最高价格数字；" +
          'urgency，只能是["本周内","两周内","开学前"]之一；' +
          "contributionHint，用一句温暖但克制的话说明这条申请被满足后会产生什么公益贡献。"
      },
      { role: "user", content: text }
    ];

    try {
      lastError = "";
      const content = await callDashScope(messages, options);
      const parsed = extractJSON(content);
      if (!parsed) throw new Error("Qwen 返回内容不是可解析 JSON");
      if (!VALID_CATEGORIES.includes(parsed.category)) throw new Error("类别非法");
      const validUrgency = ["本周内", "两周内", "开学前"].includes(parsed.urgency) ? parsed.urgency : "两周内";
      lastMode = "Qwen API 解析";
      return {
        category: parsed.category,
        subject: String(parsed.subject || "不限"),
        wantsNotes: Boolean(parsed.wantsNotes),
        budgetMax: Number(parsed.budgetMax) || 20,
        urgency: validUrgency,
        contributionHint: String(parsed.contributionHint || "")
      };
    } catch (error) {
      lastError = error.message;
      lastMode = "本地规则解析";
      console.warn("[NLP] Qwen 援助需求解析失败，使用本地规则：", error.message);
      return parseAidNeedByRules(text);
    }
  }

  global.NLPModule = {
    generateDescription,
    parseDemand,
    parseAidNeed,
    getLastMode,
    getLastError
  };
  global.generateDescription = generateDescription;
  global.parseDemand = parseDemand;
  global.parseAidNeed = parseAidNeed;
})(window);
