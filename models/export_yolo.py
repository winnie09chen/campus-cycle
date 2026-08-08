"""
export_yolo.py — 导出预训练 YOLOv8n 为 ONNX（供浏览器 onnxruntime-web 加载）
===========================================================
依赖安装（本项目的 uv 已默认走清华 PyPI 镜像）：
    cd ai-camp
    uv pip install ultralytics onnx onnxslim

运行（首次会从网络下载 yolov8n.pt 权重）：
    cd Project/models
    python export_yolo.py

产物：models/yolov8n.onnx （约 12MB）
之后浏览器打开 index.html 即可使用 YOLOv8 识别。
"""
from ultralytics import YOLO


def main():
    print("加载 yolov8n.pt（首次会从网络下载权重）…")
    model = YOLO("yolov8n.pt")
    print("导出为 ONNX …")
    path = model.export(format="onnx", imgsz=640, opset=13, simplify=True)
    print("完成！ONNX 模型已生成：", path)
    print("把它放在 Project/models/yolov8n.onnx，刷新 index.html 即可。")


if __name__ == "__main__":
    main()
