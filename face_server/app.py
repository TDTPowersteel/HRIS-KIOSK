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

# Ensure buffalo_l is downloaded
_ = FaceAnalysis(name='buffalo_l', root=insightface_root)

# Load recognition model directly so we control preprocessing to match client exactly
rec_model_path = os.path.join(insightface_root, 'models', 'buffalo_sc', 'w600k_mbf.onnx')
rec_session = ort.InferenceSession(rec_model_path, providers=['CPUExecutionProvider'])
rec_input_name = rec_session.get_inputs()[0].name

rec_model_path_l = os.path.join(insightface_root, 'models', 'buffalo_l', 'w600k_r50.onnx')
rec_session_l = ort.InferenceSession(rec_model_path_l, providers=['CPUExecutionProvider'])
rec_input_name_l = rec_session_l.get_inputs()[0].name


def get_embedding_from_bgr(img_bgr: np.ndarray, padding=1.5, model='buffalo_sc'):
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

    face_gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    
    # Perceived brightness check (avg pixel value < 50)
    brightness = np.mean(face_gray)
    if brightness < 50:
        return None, 'too_dark'
        
    # Laplacian variance blur check (variance < 50)
    variance = cv2.Laplacian(face_gray, cv2.CV_64F).var()
    if variance < 50:
        return None, 'too_blurry'

    face_resized = cv2.resize(face_crop, (112, 112))
    face_rgb = cv2.cvtColor(face_resized, cv2.COLOR_BGR2RGB)

    # Normalize to match client: (pixel - 127.5) / 128.0, float32
    face_norm = (face_rgb.astype(np.float32) - 127.5) / 128.0

    # HWC → CHW, add batch dim: [1, 3, 112, 112]
    face_chw = np.transpose(face_norm, (2, 0, 1))[np.newaxis, :]

    if model == 'both':
        output_sc = rec_session.run(None, {rec_input_name: face_chw})[0][0]
        norm_sc = np.linalg.norm(output_sc)
        if norm_sc > 0:
            output_sc = output_sc / norm_sc
            
        output_l = rec_session_l.run(None, {rec_input_name_l: face_chw})[0][0]
        norm_l = np.linalg.norm(output_l)
        if norm_l > 0:
            output_l = output_l / norm_l
            
        return (output_sc.tolist(), output_l.tolist()), None
        
    elif model == 'buffalo_l':
        output = rec_session_l.run(None, {rec_input_name_l: face_chw})[0][0]
    else:
        output = rec_session.run(None, {rec_input_name: face_chw})[0][0]

    norm = np.linalg.norm(output)
    if norm > 0:
        output = output / norm

    return output.tolist(), None


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
        embeddings_large = []
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

            pad_amount = 1.5
            embs, err = get_embedding_from_bgr(img, padding=pad_amount, model='both')

            if err == 'no_face':
                return jsonify({'success': False, 'ok': False, 'error': f'No face detected in image {idx+1}. Ensure face is clear.'}), 400
            if err == 'too_dark':
                return jsonify({'success': False, 'ok': False, 'error': f'Image {idx+1} is too dark. Move to a well-lit area.'}), 400
            if err == 'too_blurry':
                return jsonify({'success': False, 'ok': False, 'error': f'Image {idx+1} was blurry. Please hold still.'}), 400
            if err == 'multiple':
                return jsonify({'success': False, 'ok': False, 'error': f'Multiple faces detected in image {idx+1}. Keep only one person in frame.'}), 400

            embeddings.append(embs[0])
            embeddings_large.append(embs[1])

        return jsonify({'success': True, 'ok': True, 'embeddings': embeddings, 'embeddings_large': embeddings_large})

    except Exception as e:
        return jsonify({'success': False, 'ok': False, 'error': str(e)}), 500


@app.route('/embed_single', methods=['POST'])
def get_single_embedding():
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'success': False, 'ok': False, 'error': 'Missing image parameter'}), 400

        img_b64 = data['image']
        if ',' in img_b64:
            img_b64 = img_b64.split(',')[1]

        try:
            img_data = base64.b64decode(img_b64)
        except Exception:
            return jsonify({'success': False, 'ok': False, 'error': 'Invalid base64 encoding'}), 400

        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return jsonify({'success': False, 'ok': False, 'error': 'Image could not be decoded'}), 400

        model_name = data.get('model', 'buffalo_sc')

        # Extract face embedding
        pad_amount = 1.5
        embedding, err = get_embedding_from_bgr(img, padding=pad_amount, model=model_name)

        if err == 'no_face':
            return jsonify({'success': False, 'ok': False, 'error': 'No face detected.'}), 400
        if err == 'too_dark':
            return jsonify({'success': False, 'ok': False, 'error': 'Too dark. Move to a well-lit area.'}), 400
        if err == 'too_blurry':
            return jsonify({'success': False, 'ok': False, 'error': 'Image was blurry. Please hold still.'}), 400
        if err == 'multiple':
            return jsonify({'success': False, 'ok': False, 'error': 'Multiple faces detected.'}), 400

        return jsonify({'success': True, 'ok': True, 'embedding': embedding})

    except Exception as e:
        return jsonify({'success': False, 'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    try:
        from waitress import serve
        print("Starting HRIS Face Embedding Server on port 5001 (Production Mode)...")
        serve(app, host='0.0.0.0', port=5001, threads=6)
    except ImportError:
        print("Waitress not found. Starting in Development Mode...")
        app.run(host='0.0.0.0', port=5001)

