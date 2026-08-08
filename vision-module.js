// ===== 视觉模块（MediaPipe 手部遮挡检测） =====
// @author: 同学A - MediaPipe 模块
// 职责：检测上传图片中是否出现手部遮挡。物品识别（类别/描述）由 VLM 负责，本模块只管手部检测。
// 从 AppConfig 读取配置，缺失时用自带默认。
(function (global) {
  "use strict";

  const defaultConfig = {
    cdn: {
      mediapipeHands: [
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
        "https://unpkg.com/@mediapipe/hands/hands.js"
      ],
      mediapipeBase: "https://cdn.jsdelivr.net/npm/@mediapipe/hands/"
    },
    mediapipe: {
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    },
    errors: {
      IMAGE_LOAD_FAILED: "IMAGE_LOAD_FAILED",
      MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED",
      HAND_DETECTION_FAILED: "HAND_DETECTION_FAILED"
    }
  };

  function mergeConfig(base, override) {
    const output = { ...base };
    Object.keys(override || {}).forEach((key) => {
      const baseValue = base[key];
      const overrideValue = override[key];
      if (overrideValue === undefined) return;
      if (
        baseValue && overrideValue &&
        typeof baseValue === "object" && !Array.isArray(baseValue) &&
        typeof overrideValue === "object" && !Array.isArray(overrideValue)
      ) {
        output[key] = mergeConfig(baseValue, overrideValue);
      } else {
        output[key] = overrideValue;
      }
    });
    return output;
  }

  // 从全局配置读取（缺失用 defaultConfig 兜底）
  const AC = global.AppConfig || {};
  const config = mergeConfig(defaultConfig, {
    cdn: (AC.cdn && AC.cdn.mediaPipe) ? {
      mediapipeHands: AC.cdn.mediaPipe.handsScript,
      mediapipeBase: AC.cdn.mediaPipe.base
    } : undefined,
    mediapipe: AC.models && AC.models.mediaPipe
  });

  // ---------- 内部状态 ----------
  const scriptPromises = {};
  const state = {
    loading: false,
    initPromise: null,
    handsReady: false,
    handsError: null,
    handsDetector: null,
    pendingHandsResolver: null
  };

  function createError(code, message) {
    return { success: false, handOcclusion: { enabled: false, detected: false, message: "" }, error: { code, message } };
  }

  function getModelStatus() {
    return {
      loading: state.loading,
      handsReady: state.handsReady,
      handsError: state.handsError
    };
  }

  // ---------- 脚本加载（多 CDN 降级） ----------
  function loadScript(url) {
    if (scriptPromises[url]) return scriptPromises[url];
    scriptPromises[url] = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-vision-src="${url}"]`);
      if (existing && existing.dataset.loaded === "true") {
        resolve(url);
        return;
      }
      const script = existing || document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.visionSrc = url;
      script.onload = function () {
        script.dataset.loaded = "true";
        resolve(url);
      };
      script.onerror = function () {
        delete scriptPromises[url];
        reject(new Error("脚本加载失败: " + url));
      };
      if (!existing) document.head.appendChild(script);
    });
    return scriptPromises[url];
  }

  async function loadScriptWithFallback(urls, checker) {
    if (checker()) return true;
    let lastError = null;
    for (const url of urls) {
      try {
        await loadScript(url);
        if (checker()) return true;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("脚本加载失败");
  }

  // ---------- MediaPipe Hands 加载 ----------
  async function ensureHandsLoaded() {
    await loadScriptWithFallback(config.cdn.mediapipeHands, () => Boolean(global.Hands));
    if (!global.Hands) throw new Error("MediaPipe Hands 不可用");

    if (!state.handsDetector) {
      state.handsDetector = new global.Hands({
        locateFile(file) {
          return config.cdn.mediapipeBase + file;
        }
      });
      state.handsDetector.setOptions(config.mediapipe);
      state.handsDetector.onResults(function (results) {
        if (typeof state.pendingHandsResolver === "function") {
          state.pendingHandsResolver(results);
          state.pendingHandsResolver = null;
        }
      });
    }
    state.handsReady = true;
  }

  async function initVisionModels() {
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async function () {
      state.loading = true;
      state.handsError = null;
      try {
        await ensureHandsLoaded();
      } catch (error) {
        state.handsReady = false;
        state.handsError = error.message;
        // 不抛错：MediaPipe 失败只影响手部检测，不阻断主流程
      }
      return getModelStatus();
    })();
    try {
      return await state.initPromise;
    } finally {
      state.loading = false;
      state.initPromise = null;
    }
  }

  // ---------- 图片输入归一化 ----------
  function loadImageFromUrl(url, revokeAfterLoad) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        if (revokeAfterLoad) URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        if (revokeAfterLoad) URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  }

  async function normalizeImageInput(input) {
    if (!input) throw new Error("缺少图片输入");
    if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
      if (input.complete && input.naturalWidth > 0) return input;
      return loadImageFromUrl(input.src, false);
    }
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      const objectUrl = URL.createObjectURL(input);
      return loadImageFromUrl(objectUrl, true);
    }
    if (typeof input === "string") {
      return loadImageFromUrl(input, false);
    }
    throw new Error("暂不支持的图片输入类型");
  }

  // ---------- 手部遮挡检测 ----------
  // 简化策略：检测到任意手部关键点即认为可能遮挡（不再依赖物品 bbox）
  function detectHandsFromResults(results) {
    const hands = results.multiHandLandmarks || [];
    if (hands.length) {
      return { enabled: true, detected: true, message: "建议重拍，手部遮挡了物品" };
    }
    return { enabled: true, detected: false, message: "未发现明显手部遮挡" };
  }

  async function runHandOcclusionCheck(imageElement) {
    if (!state.handsDetector || !state.handsReady) {
      return { enabled: true, detected: false, available: false, message: "手部检测不可用，已跳过" };
    }
    const results = await new Promise((resolve, reject) => {
      state.pendingHandsResolver = resolve;
      state.handsDetector.send({ image: imageElement }).catch((error) => {
        state.pendingHandsResolver = null;
        reject(error);
      });
    });
    return detectHandsFromResults(results);
  }

  // ---------- 主入口 ----------
  // 只返回手部遮挡结果 { success, handOcclusion }；物品识别交给 VLM
  async function analyzeImage(input, options) {
    const settings = { enableHandCheck: true, ...(options || {}) };

    if (!settings.enableHandCheck) {
      return { success: true, handOcclusion: { enabled: false, detected: false, message: "已跳过手部检测" } };
    }

    let imageElement;
    try {
      imageElement = await normalizeImageInput(input);
    } catch (error) {
      return createError(config.errors.IMAGE_LOAD_FAILED, error.message || "图片加载失败");
    }

    try {
      await initVisionModels();
    } catch (error) {
      // MediaPipe 初始化失败不阻断：返回不可用提示
      return {
        success: true,
        handOcclusion: { enabled: true, detected: false, available: false, message: "手部检测不可用，已跳过" }
      };
    }

    try {
      const handOcclusion = await runHandOcclusionCheck(imageElement);
      return { success: true, handOcclusion };
    } catch (error) {
      return {
        success: true,
        handOcclusion: {
          enabled: true,
          detected: false,
          available: false,
          message: "手部检测失败，已跳过"
        }
      };
    }
  }

  // ---------- 暴露到全局 ----------
  global.VisionModule = {
    initVisionModels,
    analyzeImage,
    runHandOcclusionCheck,
    getModelStatus
  };
})(window);
