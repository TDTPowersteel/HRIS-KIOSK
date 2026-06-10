import base64
import cv2
import numpy as np
from flask import Flask, request, jsonify
from insightface.app import FaceAnalysis
import onnxruntime as ort
import os

app = Flask(__name__)

home_dir = os.path.expanduser('~')
insightface_root = os.path.join(home_dir, '.insightface')

# InsightFace used for face DETECTION only (bounding box)
face_app = FaceAnalysis(name='buffalo_sc', root=insightface_root)
face_app.prepare(ctx_id=-1, det_size=(640, 640))

# Load recognition model directly so we control preprocessing to match client exactly
rec_model_path = os.path.join(insightface_root, 'models', 'buffalo_sc', 'w600k_mbf.onnx')
rec_session = ort.InferenceSession(rec_model_path, providers=['CPUExecutionProvider'])
rec_input_name = rec_session.get_inputs()[0].name


def get_embedding_from_bgr(img_bgr: np.ndarray, padding=1.5):
    """
    Detect face → bbox crop → resize 112×112 → BGR→RGB →
    normalize (pixel-127.5)/128.0 → CHW → direct ONNX inference → L2 normalize.

    Mirrors HRIS-APP/HRIS-KIOSK client-side preprocessing exactly so registration
    and verification embeddings are in the same feature space.
    """
    faces = face_app.get(img_bgr)
    if not faces:
        return None, 'no_face'
    if len(faces) > 1:
        return None, 'multiple'

    bbox = faces[0].bbox.astype(int)
    face_w = bbox[2] - bbox[0]
    face_h = bbox[3] - bbox[1]

    # Mirror HRIS-APP padding logic
    face_size_px = max(face_w, face_h)
    img_h, img_w = img_bgr.shape[:2]
    
    crop_size = min(int(face_size_px * padding), img_w, img_h)
    
    center_x = bbox[0] + face_w / 2.0
    center_y = bbox[1] + face_h / 2.0
    
    origin_x = max(0, min(img_w - crop_size, int(center_x - crop_size / 2.0)))
    origin_y = max(0, min(img_h - crop_size, int(center_y - crop_size * 0.45)))

    face_crop = img_bgr[origin_y:origin_y+crop_size, origin_x:origin_x+crop_size]
    if face_crop.size == 0:
        return None, 'no_face'

    face_resized = cv2.resize(face_crop, (112, 112))
    face_rgb = cv2.cvtColor(face_resized, cv2.COLOR_BGR2RGB)

    # Normalize to match client: (pixel - 127.5) / 128.0, float32
    face_norm = (face_rgb.astype(np.float32) - 127.5) / 128.0

    # HWC → CHW, add batch dim: [1, 3, 112, 112]
    face_chw = np.transpose(face_norm, (2, 0, 1))[np.newaxis, :]

    output = rec_session.run(None, {rec_input_name: face_chw})[0]
    embedding = output[0]

    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding.tolist(), None


@app.route('/embed', methods=['POST'])
def get_embeddings():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'ok': False, 'error': 'Missing request data'}), 400

        # Accept both 'images' (admin IMS) and 'photos' (intern registration portal)
        images_base64 = data.get('images') or data.get('photos')
        if not images_base64 or not isinstance(images_base64, list) or len(images_base64) != 5:
            return jsonify({'success': False, 'ok': False, 'error': 'Exactly 5 images/photos are required'}), 400

        embeddings = []
        for idx, img_b64 in enumerate(images_base64):
            if ',' in img_b64:
                img_b64 = img_b64.split(',')[1]

            try:
                img_data = base64.b64decode(img_b64)
            except Exception:
                return jsonify({'success': False, 'ok': False, 'error': f'Image {idx+1} has invalid base64 encoding'}), 400

            nparr = np.frombuffer(img_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                return jsonify({'success': False, 'ok': False, 'error': f'Image {idx+1} could not be decoded'}), 400

            pad_amount = 2.5 if idx == 1 else 1.5
            embedding, err = get_embedding_from_bgr(img, padding=pad_amount)

            if err == 'no_face':
                return jsonify({'success': False, 'ok': False, 'error': f'No face detected in image {idx+1}. Ensure face is clear and well-lit.'}), 400
            if err == 'multiple':
                return jsonify({'success': False, 'ok': False, 'error': f'Multiple faces detected in image {idx+1}. Keep only one person in frame.'}), 400

            embeddings.append(embedding)

        return jsonify({'success': True, 'ok': True, 'embeddings': embeddings})

    except Exception as e:
        return jsonify({'success': False, 'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
