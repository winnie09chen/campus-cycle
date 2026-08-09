// ===== 全局配置（唯一真相源） =====
// @author: 同学C - 集中管理所有可调参数
// 各模块以 `window.AppConfig?.xxx ?? 自带默认` 的方式读取，
// 本文件未加载时各模块仍可用自带默认值照常运行（降级不崩）。
// 注意：本文件必须在所有模块脚本之前加载。
(function (global) {
  "use strict";

  const config = {
    // ---------- 外部依赖 / CDN / API ----------
    cdn: {
      mediaPipe: {
        handsScript: [
          "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
          "https://unpkg.com/@mediapipe/hands/hands.js"
        ],
        base: "https://cdn.jsdelivr.net/npm/@mediapipe/hands/"
      },
      dashscopeApi: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      aiProxy: "/.netlify/functions/ai"
    },

    // ---------- 模型 ----------
    models: {
      vlm: {
        model: "qwen-vl-max",
        timeout: 15000,
        temperature: 0.7,
        maxTokens: 400
      },
      nlp: {
        model: "qwen-plus",
        timeout: 8000,
        temperature: 0.4,
        maxTokens: 300
      },
      mediaPipe: {
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      }
    },

    // ---------- localStorage 键 ----------
    storageKeys: {
      data: "campus_cycle_demo_v1",
      session: "campus_cycle_session_v1"
    },

    // ---------- 角色 ----------
    roles: {
      student: "student",
      reviewer: "reviewer"
    },

    // ---------- 鉴权 ----------
    // 后端 auth.mjs 单入口，body 带 action 分发；登录页按角色分流到不同主界面。
    auth: {
      apiEndpoint: "/.netlify/functions/auth",
      loginPage: "login.html",
      studentPage: "index.html",
      reviewerPage: "reviewer.html",
      profilePage: "profile.html"
    },

    // ---------- 密钥 ----------
    // Key 只存于 Netlify 后端环境变量 DASHSCOPE_API_KEY（本地放 .env），
    // 由 netlify/functions/ai.mjs 读取，前端不持有任何密钥。

    // ---------- 类别（标签唯一来源，去重） ----------
    categories: {
      // 支持的页面级类别（服装统一用 uniform；clothing 是视觉层别名，经 pageMap 映射到 uniform）
      supported: ["book", "bottle", "uniform", "backpack", "digital", "lamp"],
      // 中文展示标签（vision / vlm / nlp / index 共用）
      labels: {
        book: "教材",
        bottle: "水杯",
        clothing: "衣服/正装",
        backpack: "书包",
        uniform: "校服",
        lamp: "台灯",
        digital: "数码配件"
      },
      // 视觉识别类别 → 页面类别
      pageMap: { book: "book", bottle: "bottle", clothing: "uniform", backpack: "backpack", digital: "digital" },
      // VLM 返回的中文 → 内部类别
      vlmResponseMap: {
        "教材": "book", "校服": "uniform", "正装": "uniform",
        "水杯": "bottle", "台灯": "lamp", "书包": "backpack",
        "充电宝": "digital", "数码配件": "digital", "电子设备": "digital"
      },
      // 各类别默认科目名
      defaultSubject: { book: "教材", uniform: "校服", bottle: "水杯", lamp: "台灯", backpack: "书包", digital: "数码配件" },
      // 需求解析合法类别
      validDemand: ["book", "uniform", "lamp", "bottle", "backpack", "digital"]
    },

    // ---------- UI / 业务 ----------
    ui: {
      buyerPageSize: 6,
      imageMaxSide: 800
    },

    // ---------- 匹配打分 ----------
    scoring: {
      category: 40,
      subject: 30,
      price: 20,
      notes: 10,
      noReport: 5,
      aidCategory: 45,
      aidFree: 30,
      aidLowPrice: 20,
      aidUrgent: 10
    },

    // ---------- 交易（模拟钱包） ----------
    // 余额为模拟值，存于共享数据层（非真实资金）；初始余额用于未在 balances 表中的用户。
    transaction: {
      startBalance: 1000
    }
  };

  global.AppConfig = config;
})(window);
