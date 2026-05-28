# Face Recognition Model

This directory contains the buffalo_sc ONNX model file used for on-device face embedding generation.

- **Filename:** `w600k_mbf.onnx`
- **Model:** buffalo_sc (InsightFace, ArcFace loss, MobileFaceNet backbone)
- **Input:** 112×112×3 RGB image, CHW layout, normalized `(pixel - 127.5) / 128.0`
- **Output:** 512-dimensional embedding vector
- **Size:** ~16MB
- **Format:** ONNX
- **LFW Accuracy:** 99.70%

## Runtime

| Platform | Runtime |
|----------|---------|
| HRIS App (React Native) | `onnxruntime-react-native` |
| Kiosk App (React Native) | `onnxruntime-react-native` |

## Download

Get `w600k_mbf.onnx` from:
- https://github.com/deepinsight/insightface/releases (buffalo_sc package)
- HuggingFace: search `buffalo_sc w600k_mbf.onnx`
