# HRIS-Kiosk Intern DTR System Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the HRIS-KIOSK app with the DTR MySQL database for interns, using dynamic QR code routing and a mobile browser face registration flow.

**Architecture:** The kiosk dynamically routes calls to Supabase (for employees) or the DTR PHP/MySQL backend (for interns) based on the scanned QR code prefix (`LOGID:` vs `INTERN:`). Intern face embeddings are captured via a guided web app and generated server-side using a Python ONNX microservice running the same `buffalo_sc` model.

**Tech Stack:** React Native/Expo, PHP 8.1+, MySQL, Python 3.10+, Flask, OpenCV, ONNX Runtime, HTML5 Camera API.

---

### Task 1: MySQL Schema Changes (DTR System)

**Files:**
- Modify: `db/migrations/update_interns_face_qr.sql` (New Migration)

- [ ] **Step 1: Create SQL migration script**
  Create `db/migrations/update_interns_face_qr.sql` with schema modifications:
  ```sql
  ALTER TABLE interns 
  ADD COLUMN qr_code VARCHAR(255) NULL UNIQUE,
  ADD COLUMN face_embedding LONGTEXT NULL;
  ```

- [ ] **Step 2: Apply migration to local MySQL database**
  Run schema update command on the MySQL command line:
  ```bash
  mysql -u root -p tdt_ims < C:\Users\Keith\HRIS\TDRPowersteel IMS\db\migrations\update_interns_face_qr.sql
  ```

---

### Task 2: DTR PHP Backend Endpoints (DTR System)

**Files:**
- Create: `api/verify_intern_qr.php`
- Create: `api/log_intern_attendance.php`
- Create: `includes/dtr_db.php` (Shared database connection utility for API endpoints)

- [ ] **Step 1: Create shared database connection utility**
  Create `includes/dtr_db.php`:
  ```php
  <?php
  function get_dtr_db_connection() {
      $conn = new mysqli("localhost", "root", "", "tdt_ims");
      if ($conn->connect_error) {
          http_response_code(500);
          echo json_encode(["ok" => false, "message" => "Database connection failed"]);
          exit;
      }
      $conn->set_charset("utf8mb4");
      return $conn;
  }
  ```

- [ ] **Step 2: Create verify_intern_qr.php**
  Create `api/verify_intern_qr.php` to parse the QR code and return intern details:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Content-Type: application/json');
  require_once __DIR__ . '/../includes/dtr_db.php';

  $qr = $_GET['qr_code'] ?? '';
  if (!$qr) {
      http_response_code(400);
      echo json_encode(["ok" => false, "message" => "Missing QR code"]);
      exit;
  }

  $conn = get_dtr_db_connection();
  $stmt = $conn->prepare("SELECT id, first_name, last_name, profile_photo, face_embedding FROM interns WHERE qr_code = ? AND status = 'Active'");
  $stmt->bind_param("s", $qr);
  $stmt->execute();
  $result = $stmt->get_result()->fetch_assoc();

  if (!$result) {
      http_response_code(404);
      echo json_encode(["ok" => false, "message" => "Intern not found or inactive"]);
      exit;
  }

  // Check if clocked in today to determine next action
  $today = date('Y-m-d');
  $stmt = $conn->prepare("SELECT id, time_in, time_out FROM dtr_entries WHERE intern_id = ? AND entry_date = ? AND is_archived = 0");
  $stmt->bind_param("is", $result['id'], $today);
  $stmt->execute();
  $dtr = $stmt->get_result()->fetch_assoc();

  $action = 'clock_in';
  if ($dtr && !$dtr['time_out']) {
      $action = 'clock_out';
  }

  echo json_encode([
      "ok" => true,
      "intern_id" => $result['id'],
      "name" => $result['first_name'] . ' ' . $result['last_name'],
      "profile_picture" => $result['profile_photo'] ? "uploads/photos/" . $result['profile_photo'] : null,
      "face_embedding" => $result['face_embedding'] ? json_decode($result['face_embedding']) : null,
      "action" => $action
  ]);
  ```

- [ ] **Step 3: Create log_intern_attendance.php**
  Create `api/log_intern_attendance.php` to handle clock-in/out updates:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Content-Type: application/json');
  require_once __DIR__ . '/../includes/dtr_db.php';

  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);

  $intern_id = $data['intern_id'] ?? null;
  $action = $data['action'] ?? null;

  if (!$intern_id || !$action) {
      http_response_code(400);
      echo json_encode(["ok" => false, "message" => "Missing parameters"]);
      exit;
  }

  $conn = get_dtr_db_connection();
  $today = date('Y-m-d');
  $now = date('H:i:s');

  if ($action === 'clock_in') {
      $stmt = $conn->prepare("INSERT INTO dtr_entries (intern_id, entry_date, time_in, day_type, created_at) VALUES (?, ?, ?, 'Regular', NOW())");
      $stmt->bind_param("iss", $intern_id, $today, $now);
  } else {
      $stmt = $conn->prepare("UPDATE dtr_entries SET time_out = ?, updated_at = NOW() WHERE intern_id = ? AND entry_date = ? AND time_out IS NULL");
      $stmt->bind_param("sis", $now, $intern_id, $today);
  }

  if ($stmt->execute()) {
      // Sync intern rendered hours
      $conn->query("UPDATE interns SET rendered_hours = (SELECT COALESCE(SUM(rendered_hours), 0) FROM dtr_entries WHERE intern_id = $intern_id AND is_archived = 0) WHERE id = $intern_id");
      echo json_encode(["ok" => true, "message" => "Attendance recorded successfully"]);
  } else {
      http_response_code(500);
      echo json_encode(["ok" => false, "message" => "Database save failed"]);
  }
  ```

---

### Task 3: Python ONNX Embedding Service (DTR System)

**Files:**
- Create: `face_server/app.py`
- Create: `face_server/requirements.txt`

- [ ] **Step 1: Create requirements.txt**
  Create `face_server/requirements.txt` listing ONNX dependencies:
  ```text
  flask==3.0.0
  onnxruntime==1.16.3
  numpy==1.26.2
  opencv-python-headless==4.8.1.78
  pillow==10.1.0
  ```

- [ ] **Step 2: Create app.py**
  Create `face_server/app.py` to receive 5 images, run the buffalo_sc ONNX model, and output the embeddings list:
  ```python
  import base64
  import cv2
  import numpy as np
  import onnxruntime as ort
  from flask import Flask, request, jsonify

  app = Flask(__name__)
  # Load w600k_mbf.onnx (buffalo_sc) model
  model_path = "../HRIS-KIOSK/assets/models/w600k_mbf.onnx"
  session = ort.InferenceSession(model_path)

  def preprocess(img_bytes):
      # Decode and resize to 112x112
      nparr = np.frombuffer(img_bytes, np.uint8)
      img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
      img = cv2.resize(img, (112, 112))
      # RGB order and normalize to [-1, 1]
      img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
      img = (img.astype(np.float32) - 127.5) / 128.0
      # Transpose to CHW [1, 3, 112, 112]
      img = np.transpose(img, (2, 0, 1))
      img = np.expand_dims(img, axis=0)
      return img

  @app.route('/embed', methods=['POST'])
  def embed():
      data = request.json
      photos = data.get('photos', [])
      if len(photos) != 5:
          return jsonify({"ok": False, "message": "Exactly 5 photos required"}), 400

      embeddings = []
      for photo_base64 in photos:
          img_data = base64.b64decode(photo_base64.split(',')[-1])
          tensor_input = preprocess(img_data)
          
          # Run inference
          inputs = {session.get_inputs()[0].name: tensor_input}
          outs = session.run(None, inputs)
          emb = outs[0][0].tolist()
          
          # L2 normalize
          norm = np.linalg.norm(emb)
          if norm > 0:
              emb = [float(v / norm) for v in emb]
          embeddings.append(emb)

      return jsonify({"ok": True, "embeddings": embeddings})

  if __name__ == '__main__':
      app.run(host='0.0.0.0', port=8000)
  ```

---

### Task 4: Phone-Based Face Registration Web UI (DTR System)

**Files:**
- Create: `register_face.php`

- [ ] **Step 1: Create register_face.php**
  Create a single PHP file `register_face.php` with a mobile-friendly HTML5 Camera + Canvas UI to guide the intern and post to the Python service:
  ```php
  <?php
  require_once __DIR__ . '/includes/dtr_db.php';
  // Check auth or get intern ID from query
  $intern_id = $_GET['intern_id'] ?? null;
  if (!$intern_id) {
      die("Access Denied: Missing Intern ID");
  }
  ?>
  <!DOCTYPE html>
  <html>
  <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Face Registration</title>
      <style>
          body { font-family: sans-serif; text-align: center; margin: 20px; }
          #video { border-radius: 50%; border: 3px solid #ccc; width: 250px; height: 250px; object-fit: cover; }
          .btn { background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; margin: 10px; }
          #instructions { font-size: 18px; font-weight: bold; margin: 15px; color: #2c3e50; }
      </style>
  </head>
  <body>
      <h2>Intern Face Registration</h2>
      <div id="instructions">Align your face in the circle</div>
      <video id="video" autoplay playsinline></video>
      <canvas id="canvas" style="display:none;" width="400" height="400"></canvas>
      <br>
      <button class="btn" id="captureBtn">Capture Center Close</button>

      <script>
          const video = document.getElementById('video');
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          const captureBtn = document.getElementById('captureBtn');
          const instructions = document.getElementById('instructions');

          const steps = [
              { label: 'Capture Center Close', instruction: 'Look straight at the camera (Close)' },
              { label: 'Capture Center Far', instruction: 'Move back slightly and look straight' },
              { label: 'Capture Left Angle', instruction: 'Turn your head slightly to the left' },
              { label: 'Capture Right Angle', instruction: 'Turn your head slightly to the right' },
              { label: 'Capture Up Angle', instruction: 'Look slightly up' }
          ];
          let currentStep = 0;
          const photos = [];

          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
              .then(stream => { video.srcObject = stream; })
              .catch(err => alert("Camera permission required"));

          captureBtn.onclick = () => {
              // Capture and crop face region to canvas
              ctx.drawImage(video, 0, 0, 400, 400);
              const base64 = canvas.toDataURL('image/jpeg');
              photos.push(base64);

              currentStep++;
              if (currentStep < steps.length) {
                  captureBtn.innerText = steps[currentStep].label;
                  instructions.innerText = steps[currentStep].instruction;
              } else {
                  captureBtn.style.display = 'none';
                  instructions.innerText = "Processing embeddings...";
                  
                  // Submit to Python ONNX microservice
                  fetch('http://localhost:8000/embed', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({photos: photos})
                  })
                  .then(res => res.json())
                  .then(data => {
                      if (data.ok) {
                          // Save embeddings to intern database
                          saveToDb(data.embeddings);
                      } else {
                          alert("Failed: " + data.message);
                          location.reload();
                      }
                  });
              }
          };

          function saveToDb(embeddings) {
              fetch('save_embeddings_action.php', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({intern_id: <?= $intern_id ?>, embeddings: embeddings})
              })
              .then(res => res.json())
              .then(result => {
                  if (result.ok) {
                      instructions.innerText = "✅ Registration Complete! You can close this window.";
                  } else {
                      alert("Database save failed");
                  }
              });
          }
      </script>
  </body>
  </html>
  ```

---

### Task 5: Kiosk QR Route Parsing (Kiosk App)

**Files:**
- Modify: `src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Update QR code parsing inside resolveQR process**
  In `useAttendance.ts`, detect `INTERN:` vs `LOGID:` prefixes. Update the network request code:
  ```typescript
  // Replace direct employee endpoint call with a router
  const qrString = scannedQrCode; 
  let fetchUrl = '';
  
  if (qrString.startsWith('INTERN:')) {
      fetchUrl = `${DTR_BACKEND_URL}/api/verify_intern_qr.php?qr_code=${encodeURIComponent(qrString)}`;
  } else {
      fetchUrl = `${EMPLOYEE_BACKEND_URL}/resolve_qr.php?qr_code=${encodeURIComponent(qrString)}`;
  }
  
  const response = await fetch(fetchUrl);
  const result = await response.json();
  ```

---

### Task 6: Kiosk Attendance Recording for Interns (Kiosk App)

**Files:**
- Modify: `src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Route attendance save endpoint by QR prefix**
  In the `executeAttendanceRecording` function inside `useAttendance.ts`, check which user type is active:
  ```typescript
  const qrString = selectedUserRef.current?.qr_code;
  let saveUrl = '';
  let payload = {};

  if (qrString && qrString.startsWith('INTERN:')) {
      saveUrl = `${DTR_BACKEND_URL}/api/log_intern_attendance.php`;
      payload = {
          intern_id: selectedUserRef.current.id,
          action: nextAction // 'clock_in' or 'clock_out'
      };
  } else {
      saveUrl = `${EMPLOYEE_BACKEND_URL}/record_attendance.php`;
      payload = employeePayload;
  }

  const response = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
  });
  ```
