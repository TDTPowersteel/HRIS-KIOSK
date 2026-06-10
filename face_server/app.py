import base64
import cv2
import numpy as np
from flask import Flask, request, jsonify
import insightface
from insightface.app import FaceAnalysis

import os

app = Flask(__name__)

# Initialize FaceAnalysis using the buffalo_l model
# We dynamically locate the user's home directory to make deployment portable across Windows and Linux.
home_dir = os.path.expanduser('~')
insightface_root = os.path.join(home_dir, '.insightface')

face_app = FaceAnalysis(name='buffalo_l', root=insightface_root)
face_app.prepare(ctx_id=-1, det_size=(640, 640))

@app.route('/embed', methods=['POST'])
def get_embeddings():
    try:
        data = request.get_json()
        if not data or 'images' not in data:
            return jsonify({'success': False, 'error': 'Missing images in request'}), 400
        
        images_base64 = data['images']
        if not isinstance(images_base64, list) or len(images_base64) != 5:
            return jsonify({'success': False, 'error': 'Exactly 5 images are required'}), 400
        
        embeddings = []
        for idx, img_b64 in enumerate(images_base64):
            # Check if base64 has header, strip it
            if ',' in img_b64:
                img_b64 = img_b64.split(',')[1]
                
            try:
                img_data = base64.b64decode(img_b64)
            except Exception:
                return jsonify({'success': False, 'error': f'Image {idx+1} has invalid base64 encoding'}), 400
                
            nparr = np.frombuffer(img_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                return jsonify({'success': False, 'error': f'Image {idx+1} could not be decoded'}), 400
            
            # Run face analysis
            faces = face_app.get(img)
            
            if not faces:
                return jsonify({'success': False, 'error': f'No face detected in image {idx+1}. Please ensure your face is clear and well-lit.'}), 400
            
            if len(faces) > 1:
                return jsonify({'success': False, 'error': f'Multiple faces detected in image {idx+1}. Keep only one person in frame.'}), 400
            
            embedding = faces[0].embedding.tolist()
            embeddings.append(embedding)
            
        return jsonify({'embeddings': embeddings})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
