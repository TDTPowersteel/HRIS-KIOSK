# Face Recognition ONNX Models

This directory dynamically stores the ONNX face recognition models downloaded and utilized by the local Python Face Server (`face_server/app.py`).

The HRIS Kiosk architecture relies on two different models for optimized verification:

## 1. `buffalo_sc` (MobileFaceNet Backbone)
- **Primary Use**: Ultra-fast local client-side verification on the Android tablet using `onnxruntime-react-native`, as well as standard Python server embedding processing.
- **Input**: `112x112x3` RGB image, CHW layout, normalized `(pixel - 127.5) / 128.0`
- **Output**: 512-dimensional embedding vector
- **Size**: ~16MB
- **LFW Accuracy**: 99.70%

## 2. `buffalo_l` (ResNet50 Backbone)
- **Primary Use**: High-accuracy server-side verification executed via the Python Flask server for scenarios requiring higher precision.
- **Input**: `112x112x3` RGB image, CHW layout, normalized `(pixel - 127.5) / 128.0`
- **Output**: 512-dimensional embedding vector
- **Size**: ~175MB
- **LFW Accuracy**: 99.83%

---

## 🛠️ Auto-Download Mechanism
You do **not** need to download these files manually. 
When the Python Face Server is launched (either manually or via `npm run dev`), the `insightface` library will automatically scan this directory. If the models are missing, it will securely download them, extract them into `buffalo_sc` and `buffalo_l` subfolders, and automatically delete the leftover `.zip` archives.

**Note:** Ensure `assets/models` is ignored in `.gitignore` to prevent committing these heavy binaries to the repository.
