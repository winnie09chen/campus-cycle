// ===== YOLOv8 目标检测模块（ONNX Runtime Web 推理） =====
// @author: 同学A - YOLO 模块
// 职责：浏览器端加载导出的 yolov8n.onnx，对上传图片做检测，
//       输出与原 coco-ssd 完全一致的数据格式 {detections, primaryDetection, rawDetections}，
//       供 vision-module.js 无缝接入。
// YOLOv8 ONNX 输出是 [1, 84, 8400] 原始张量，需 JS 实现后处理：
//   解码框(cx,cy,w,h→x,y,w,h) → 置信度过滤 → 按类别 NMS → 类别映射。
(function (global) {
  "use strict";

  const ORT_VERSION = "1.17.1";
  const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VERSION + "/dist/ort.min.js";
  const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VERSION + "/dist/";
  const MODEL_URL = "./models/yolov8n.onnx";
  const INPUT_SIZE = 640;       // 导出时 imgsz=640
  const NUM_CLASSES = 80;        // COCO 80 类
  const CONF_THRESHOLD = 0.25;
  const IOU_THRESHOLD = 0.45;

  // COCO 类别索引 → 受支持的业务类别
  const CLASS_MAP = {
    24: "backpack", 25: "clothing", 26: "clothing", 27: "clothing", 28: "clothing",
    39: "bottle", 40: "bottle", 41: "bottle", 45: "bottle",
    73: "book"
  };

  // COCO 80 类名称（用于 rawClass 调试展示）
  const COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
    "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
  ];

  let session = null;
  let loadPromise = null;
  let loadError = null;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (global.ort) return resolve();
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("ONNX Runtime Web 脚本加载失败"));
      document.head.appendChild(s);
    });
  }

  // 加载 ONNX Runtime + 模型（懒加载）
  async function load() {
    if (session) return session;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await loadScript(ORT_CDN);
      global.ort.env.wasm.wasmPaths = ORT_WASM; // 确保 wasm 文件从同源 CDN 加载
      session = await global.ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"]
      });
      return session;
    })();
    try {
      return await loadPromise;
    } catch (err) {
      loadError = err.message;
      loadPromise = null; // 允许重试
      console.warn("[YoloDetector] 加载失败：", err.message);
      return null;
    }
  }

  // letterbox 预处理：等比缩放并填充到 640×640，返回张量 + 还原参数
  function preprocess(imageElement) {
    const iw = imageElement.naturalWidth || imageElement.width;
    const ih = imageElement.naturalHeight || imageElement.height;
    const scale = Math.min(INPUT_SIZE / iw, INPUT_SIZE / ih);
    const newW = Math.round(iw * scale);
    const newH = Math.round(ih * scale);
    const padW = (INPUT_SIZE - newW) / 2;
    const padH = (INPUT_SIZE - newH) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#787878"; // 灰色 114
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(imageElement, padW, padH, newW, newH);

    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const pixels = INPUT_SIZE * INPUT_SIZE;
    const tensor = new Float32Array(3 * pixels);
    for (let i = 0; i < pixels; i++) {
      tensor[i] = data[i * 4] / 255;
      tensor[pixels + i] = data[i * 4 + 1] / 255;
      tensor[2 * pixels + i] = data[i * 4 + 2] / 255;
    }
    return { tensor, scale, padW, padH };
  }

  // 运行推理，返回原始输出张量数据（Float32Array）
  async function runInference(tensor) {
    const inputName = session.inputNames[0];
    const ortTensor = new global.ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const output = await session.run({ [inputName]: ortTensor });
    return output[session.outputNames[0]].data;
  }

  function iou(a, b) {
    const ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx2 = b.x + b.w, by2 = b.y + b.h;
    const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  // 解码原始输出 + NMS，返回原始框（含所有类别，未做业务过滤）
  function decodeAndNms(raw, meta) {
    const channels = 4 + NUM_CLASSES;
    const numAnchors = Math.round(raw.length / channels); // 640 输入下为 8400
    const boxes = [];

    for (let a = 0; a < numAnchors; a++) {
      let bestScore = 0, bestCls = -1;
      for (let c = 0; c < NUM_CLASSES; c++) {
        const s = raw[(4 + c) * numAnchors + a];
        if (s > bestScore) { bestScore = s; bestCls = c; }
      }
      if (bestScore < CONF_THRESHOLD) continue;

      const cx = raw[0 * numAnchors + a];
      const cy = raw[1 * numAnchors + a];
      const w = raw[2 * numAnchors + a];
      const h = raw[3 * numAnchors + a];
      // letterbox 空间 → 原图空间
      let x = (cx - meta.padW) / meta.scale - w / meta.scale / 2;
      let y = (cy - meta.padH) / meta.scale - h / meta.scale / 2;
      const ww = w / meta.scale;
      const hh = h / meta.scale;
      x = Math.max(0, Math.min(meta.origW - ww, x));
      y = Math.max(0, Math.min(meta.origH - hh, y));
      boxes.push({ classId: bestCls, score: bestScore, x, y, w: ww, h: hh });
    }

    // 按置信度降序，同类内做 NMS
    boxes.sort((a, b) => b.score - a.score);
    const keep = [];
    const removed = new Array(boxes.length).fill(false);
    for (let i = 0; i < boxes.length; i++) {
      if (removed[i]) continue;
      keep.push(boxes[i]);
      for (let j = i + 1; j < boxes.length; j++) {
        if (removed[j]) continue;
        if (boxes[i].classId === boxes[j].classId && iou(boxes[i], boxes[j]) > IOU_THRESHOLD) {
          removed[j] = true;
        }
      }
    }
    return keep;
  }

  // 主入口：返回 {detections, primaryDetection, rawDetections}，与 coco-ssd 输出格式一致
  async function detect(imageElement) {
    if (!session) {
      const ok = await load();
      if (!ok) {
        throw new Error(loadError || "YOLOv8 模型加载失败");
      }
    }
    const meta = preprocess(imageElement);
    meta.origW = imageElement.naturalWidth || imageElement.width;
    meta.origH = imageElement.naturalHeight || imageElement.height;
    const raw = await runInference(meta.tensor);
    const boxes = decodeAndNms(raw, meta);

    const detections = [];
    const rawDetections = [];
    for (const b of boxes) {
      const name = COCO_NAMES[b.classId] || ("cls" + b.classId);
      rawDetections.push({ rawClass: name, confidence: round(b.score) });
      const category = CLASS_MAP[b.classId];
      if (!category) continue; // 不在受支持类别内，仅记录到 rawDetections
      detections.push({
        category,
        rawClass: name,
        confidence: round(b.score),
        bbox: [round(b.x), round(b.y), round(b.w), round(b.h)]
      });
    }
    detections.sort((a, b) => b.confidence - a.confidence);
    return { detections, primaryDetection: detections[0] || null, rawDetections };
  }

  global.YoloDetector = {
    load,
    detect,
    get ready() { return !!session; },
    get error() { return loadError; }
  };
})(window);
