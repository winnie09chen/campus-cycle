// ===== 视觉模块配置 =====
// @author: 同学A - YOLO + MediaPipe 模块
// 检测用 YOLOv8（yolo-detector.js，ONNX Runtime Web），手部遮挡用 MediaPipe Hands。
(function (global) {
  "use strict";

  const config = {
    cdn: {
      mediapipeHands: [
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
        "https://unpkg.com/@mediapipe/hands/hands.js"
      ],
      mediapipeBase: "https://cdn.jsdelivr.net/npm/@mediapipe/hands/"
    },
    supportedCategories: ["book", "bottle", "clothing", "backpack"],
    labelMap: {
      book: "教材",
      bottle: "水杯",
      clothing: "衣服/正装",
      backpack: "书包"
    },
    thresholds: {
      handOverlapRatio: 0.12
    },
    mediapipe: {
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    },
    errors: {
      INVALID_INPUT: "INVALID_INPUT",
      IMAGE_LOAD_FAILED: "IMAGE_LOAD_FAILED",
      MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED",
      DETECTION_FAILED: "DETECTION_FAILED",
      HAND_DETECTION_FAILED: "HAND_DETECTION_FAILED",
      NO_SUPPORTED_OBJECT: "NO_SUPPORTED_OBJECT"
    }
  };

  global.VisionModuleConfig = config;
})(window);
