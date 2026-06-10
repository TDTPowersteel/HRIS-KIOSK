# HRIS-Kiosk Intern DTR System Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the HRIS-KIOSK app with the DTR MySQL database for interns, using dynamic QR code routing and a mobile browser face registration flow.

**Architecture:** The kiosk dynamically routes calls to Supabase (for employees) or the DTR PHP/MySQL backend (for interns) based on the scanned QR code prefix (`LOGID:` vs `INTERN:`). Intern face embeddings are captured via a guided web app and generated server-side using a Python ONNX microservice running the same `buffalo_sc` model.

**Tech Stack:** React Native/Expo, PHP 8.1+, MySQL, Python 3.10+, Flask, OpenCV, ONNX Runtime, HTML5 Camera API.

---

### Data Safety & Teammate Synchronization Guidelines

- **Non-Destructive Schema Alterations:** Running the migration query to add `qr_code` and `face_embedding` columns to the `interns` table is safe. It only appends empty fields to existing rows and does not affect or delete any existing intern records, names, or departments.
- **Append-Only Attendance Logs:** The kiosk clock-in/out endpoint (`api/log_intern_attendance.php`) performs only standard `INSERT` (for clock-in) and `UPDATE` (for today's clock-out) queries restricted to the current date (`entry_date = CURDATE()`). It contains no instructions to delete, rewrite, or modify historical records. 
- **Safe Code Pulling:** When your teammate pulls these code changes and runs the migration SQL on their database, the system will start capturing new time logs seamlessly. Existing attendance histories will remain 100% preserved and untouched.

---

### Task 1: MySQL Schema Changes (DTR System)

**Files:**
- Modify: `db/migrations/update_interns_face_qr.sql` (New Migration)

- [ ] **Step 1: Create SQL migration script**
  Create `db/migrations/update_interns_face_qr.sql` with schema modifications:
  ```sql
  ALTER TABLE interns 
  ADD COLUMN qr_code VARCHAR(255) NULL UNIQUE,
  ADD COLUMN face_embedding LONGTEXT NULL,
  ADD COLUMN registered_at DATETIME NULL;
  ```

- [ ] **Step 2: Apply migration to local MySQL database**
  Run schema update command on the MySQL command line:
  ```bash
  mysql -u root -p tdt_ims < C:\Users\Keith\HRIS\TDRPowersteel IMS\db\migrations\update_interns_face_qr.sql
  ```

---

### Task 2: DTR PHP Backend Endpoints (DTR System)

**Files:**
- Modify: `config/db.php` (Set timezone globally)
- Create: `api/verify_intern_qr.php`
- Create: `api/log_intern_attendance.php`

- [ ] **Step 1: Set Philippine Timezone Globally**
  At the top of `config/db.php`, set the default timezone to `Asia/Manila` so that all date/time calculations throughout the DTR application and the new API endpoints use the correct Philippine timezone:
  ```php
  <?php
  // ============================================================
  // Database Configuration
  // ============================================================
  date_default_timezone_set('Asia/Manila');
  define('DB_HOST', 'localhost');
  // ...
  ```

- [ ] **Step 2: Create verify_intern_qr.php**
  Create `api/verify_intern_qr.php` to parse the QR code and return intern details:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Allow-Methods: GET, OPTIONS');
  header('Content-Type: application/json');

  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
      exit;
  }

  require_once __DIR__ . '/../config/db.php';
  $conn = getDB();

  $qr = $_GET['qr_code'] ?? '';
  if (!$qr) {
      http_response_code(400);
      echo json_encode(["ok" => false, "message" => "Missing QR code"]);
      exit;
  }

  $stmt = $conn->prepare("SELECT id, first_name, last_name, profile_photo, face_embedding FROM interns WHERE qr_code = ? AND status = 'Active'");
  $stmt->bind_param("s", $qr);
  $stmt->execute();
  $result = $stmt->get_result()->fetch_assoc();
  $stmt->close();

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
  $stmt->close();

  $action = 'clock_in';
  $open_session = null;
  if ($dtr && !$dtr['time_out']) {
      $action = 'clock_out';
      $open_session = [
          "timein" => $dtr['time_in'],
          "date" => $today
      ];
  }

  echo json_encode([
      "ok" => true,
      "intern_id" => $result['id'],
      "name" => $result['first_name'] . ' ' . $result['last_name'],
      "profile_picture" => $result['profile_photo'] ? "uploads/photos/" . $result['profile_photo'] : null,
      "face_embedding" => $result['face_embedding'] ? json_decode($result['face_embedding']) : null,
      "action" => $action,
      "open_session" => $open_session
  ]);
  ```

- [ ] **Step 3: Create log_intern_attendance.php**
  Create `api/log_intern_attendance.php` to handle clock-in/out updates:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Content-Type: application/json');

  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
      exit;
  }

  require_once __DIR__ . '/../config/db.php';
  $conn = getDB();

  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);

  $intern_id = $data['intern_id'] ?? null;
  $action = $data['action'] ?? null;

  if (!$intern_id || !$action) {
      http_response_code(400);
      echo json_encode(["ok" => false, "message" => "Missing parameters"]);
      exit;
  }

  $today = date('Y-m-d');
  $now = date('H:i:s');

  if ($action === 'clock_in') {
      // Check duplicate clock-in
      $chk = $conn->prepare("SELECT id FROM dtr_entries WHERE intern_id = ? AND entry_date = ? AND is_archived = 0");
      $chk->bind_param("is", $intern_id, $today);
      $chk->execute();
      $existing = $chk->get_result()->fetch_assoc();
      $chk->close();
      
      if ($existing) {
          http_response_code(400);
          echo json_encode(["ok" => false, "message" => "Already clocked in today"]);
          exit;
      }

      $stmt = $conn->prepare("INSERT INTO dtr_entries (intern_id, entry_date, time_in, day_type, created_at) VALUES (?, ?, ?, 'Regular', NOW())");
      $stmt->bind_param("iss", $intern_id, $today, $now);
  } else {
      $stmt = $conn->prepare("UPDATE dtr_entries SET time_out = ?, updated_at = NOW() WHERE intern_id = ? AND entry_date = ? AND time_out IS NULL");
      $stmt->bind_param("sis", $now, $intern_id, $today);
  }

  if ($stmt->execute()) {
      $stmt->close();
      // Sync intern rendered hours
      $conn->query("UPDATE interns SET rendered_hours = (SELECT COALESCE(SUM(rendered_hours), 0) FROM dtr_entries WHERE intern_id = $intern_id AND is_archived = 0) WHERE id = $intern_id");
      echo json_encode(["ok" => true, "message" => "Attendance recorded successfully"]);
  } else {
      $stmt->close();
      http_response_code(500);
      echo json_encode(["ok" => false, "message" => "Database save failed: " . $conn->error]);
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
- Create: `register_intern.php`
- Create: `api/get_unregistered_interns.php`
- Create: `api/save_intern_registration.php`

- [ ] **Step 1: Create get_unregistered_interns.php**
  Create `api/get_unregistered_interns.php` to fetch active interns missing face data:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Content-Type: application/json');
  require_once __DIR__ . '/../includes/dtr_db.php';

  $conn = get_dtr_db_connection();
  $result = $conn->query("SELECT i.id, i.first_name, i.last_name, d.name AS department_name FROM interns i JOIN departments d ON i.department_id = d.id WHERE i.face_embedding IS NULL AND i.status = 'Active' ORDER BY i.first_name ASC");

  $list = [];
  while ($row = $result->fetch_assoc()) {
      $list[] = $row;
  }

  echo json_encode(["ok" => true, "interns" => $list]);
  ```

- [ ] **Step 2: Create register_intern.php**
  Create `register_intern.php` with a mobile-responsive dropdown select, email verification, camera capture, and QR download:
  ```html
  <!DOCTYPE html>
  <html>
  <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Intern Face Registration</title>
      <style>
          body { font-family: sans-serif; text-align: center; margin: 20px; background: #f8f9fa; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .step { display: none; }
          .step.active { display: block; }
          input, select { width: 100%; padding: 12px; margin: 8px 0; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; }
          .btn { background: #3498db; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; margin: 10px 0; cursor: pointer; width: 100%; }
          #video { border-radius: 50%; border: 3px solid #ccc; width: 250px; height: 250px; object-fit: cover; }
          #instructions { font-size: 18px; font-weight: bold; margin: 15px; color: #2c3e50; }
          #qrContainer img { max-width: 200px; margin: 15px; }
      </style>
  </head>
  <body>
      <div class="container">
          <!-- Step 1: Select Profile -->
          <div id="step1" class="step active">
              <h2>Select Your Name</h2>
              <p>Find your name in the list to begin:</p>
              <select id="internSelect">
                  <option value="">-- Loading Interns --</option>
              </select>
              <input type="email" id="email" placeholder="Email Address" required>
              <p>Upload a standard headshot for your directory profile:</p>
              <input type="file" id="profilePic" accept="image/*" required>
              <button class="btn" onclick="initCameraStep()">Next: Face ID Capture</button>
          </div>

          <!-- Step 2: Face Capture -->
          <div id="step2" class="step">
              <h2>Face ID Setup</h2>
              <div id="instructions">Look straight at the camera (Close)</div>
              <video id="video" autoplay playsinline></video>
              <canvas id="canvas" style="display:none;" width="400" height="400"></canvas>
              <button class="btn" id="captureBtn">Capture Center Close</button>
          </div>

          <!-- Step 3: Success & QR Code -->
          <div id="step3" class="step">
              <h2>Registration Complete!</h2>
              <p>Download your QR code or take a screenshot. Sticking this to your ID card is recommended.</p>
              <div id="qrContainer"></div>
              <a id="downloadQrBtn" class="btn" style="display:inline-block; text-decoration:none;" download="my_qr.png">Download QR</a>
          </div>
      </div>

      <script>
          let currentStep = 1;
          let internId = '';
          const photos = [];
          let profilePicBase64 = '';
          const steps = [
              { label: 'Capture Center Close', instruction: 'Look straight at the camera (Close)' },
              { label: 'Capture Center Far', instruction: 'Move back slightly and look straight' },
              { label: 'Capture Left Angle', instruction: 'Turn your head slightly to the left' },
              { label: 'Capture Right Angle', instruction: 'Turn your head slightly to the right' },
              { label: 'Capture Up Angle', instruction: 'Look slightly up' }
          ];
          let currentFaceStep = 0;

          // Fetch unregistered interns list
          fetch('api/get_unregistered_interns.php')
              .then(res => res.json())
              .then(data => {
                  const select = document.getElementById('internSelect');
                  select.innerHTML = '<option value="">-- Select your Name --</option>';
                  if (data.ok && data.interns.length > 0) {
                      data.interns.forEach(i => {
                          const opt = document.createElement('option');
                          opt.value = i.id;
                          opt.innerText = `${i.first_name} ${i.last_name} (${i.department_name})`;
                          select.appendChild(opt);
                      });
                  } else {
                      select.innerHTML = '<option value="">All seeded interns registered!</option>';
                  }
              });

          if (!/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
              alert("⚠️ For best camera quality during Face ID capture, please open this link on your smartphone!");
          }

          function nextStep(step) {
              document.getElementById(`step${currentStep}`).classList.remove('active');
              document.getElementById(`step${step}`).classList.add('active');
              currentStep = step;
          }

          document.getElementById('profilePic').onchange = function(e) {
              const file = e.target.files[0];
              const reader = new FileReader();
              reader.onloadend = function() {
                  profilePicBase64 = reader.result;
              };
              reader.readAsDataURL(file);
          };

          function initCameraStep() {
              internId = document.getElementById('internSelect').value;
              const emailVal = document.getElementById('email').value;
              if (!internId) {
                  alert("Please select your name");
                  return;
              }
              if (!emailVal) {
                  alert("Email is required");
                  return;
              }
              if (!profilePicBase64) {
                  alert("Please upload a profile picture first");
                  return;
              }
              nextStep(2);
              const video = document.getElementById('video');
              navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
                  .then(stream => { video.srcObject = stream; })
                  .catch(err => alert("Camera permission required"));
          }

          const video = document.getElementById('video');
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          const captureBtn = document.getElementById('captureBtn');
          const instructions = document.getElementById('instructions');

          captureBtn.onclick = () => {
              ctx.drawImage(video, 0, 0, 400, 400);
              const base64 = canvas.toDataURL('image/jpeg');
              photos.push(base64);

              currentFaceStep++;
              if (currentFaceStep < steps.length) {
                  captureBtn.innerText = steps[currentFaceStep].label;
                  instructions.innerText = steps[currentFaceStep].instruction;
              } else {
                  instructions.innerText = "Processing Face ID...";
                  captureBtn.style.display = 'none';
                  submitRegistration();
              }
          };

          function submitRegistration() {
              const payload = {
                  intern_id: internId,
                  email: document.getElementById('email').value,
                  profile_photo: profilePicBase64,
                  photos: photos
              };

              fetch('api/save_intern_registration.php', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify(payload)
              })
              .then(res => res.json())
              .then(data => {
                  if (data.ok) {
                      nextStep(3);
                      const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qr_code)}`;
                      document.getElementById('qrContainer').innerHTML = `<img src="${qrImgUrl}">`;
                      document.getElementById('downloadQrBtn').href = qrImgUrl;
                  } else {
                      alert("Registration failed: " + data.message);
                      location.reload();
                  }
              });
          }
      </script>
  </body>
  </html>
  ```

- [ ] **Step 3: Create save_intern_registration.php**
  Create `api/save_intern_registration.php` to handle ONNX embeddings and either UPDATE the matched/selected intern record or INSERT a new one:
  ```php
  <?php
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Content-Type: application/json');

  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
      exit;
  }

  require_once __DIR__ . '/../config/db.php';
  $conn = getDB();

  $raw = file_get_contents('php://input');
  $data = json_decode($raw, true);

  $intern_id = $data['intern_id'] ?? null;
  $first_name = trim($data['first_name'] ?? '');
  $last_name = trim($data['last_name'] ?? '');
  $middle_name = trim($data['middle_name'] ?? '');
  $department_id = $data['department_id'] ?? null;
  $email = trim($data['email'] ?? '');

  if ((!$intern_id && (!$first_name || !$last_name || !$department_id)) || !$email || !$data['photos'] || count($data['photos']) !== 5) {
      http_response_code(400);
      echo json_encode(["ok" => false, "message" => "Missing or invalid parameters"]);
      exit;
  }

  // 1. Search and Link: If no intern_id was provided, check if the name already exists
  if (!$intern_id) {
      $stmt = $conn->prepare("SELECT id FROM interns WHERE first_name = ? AND last_name = ?");
      $stmt->bind_param("ss", $first_name, $last_name);
      $stmt->execute();
      $match = $stmt->get_result()->fetch_assoc();
      $stmt->close();
      if ($match) {
          $intern_id = $match['id'];
      }
  }

  // 2. Generate embeddings via Python ONNX service
  $ch = curl_init('http://localhost:8000/embed');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["photos" => $data['photos']]));
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
  $pyResponse = curl_exec($ch);
  $pyStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  $pyData = json_decode($pyResponse, true);
  if ($pyStatus !== 200 || !$pyData || !$pyData['ok']) {
      http_response_code(500);
      echo json_encode(["ok" => false, "message" => "Face embedding generation failed"]);
      exit;
  }
  $embeddings = $pyData['embeddings'];

  // 3. Save profile picture file (use a temporary prefix if ID is not yet generated)
  $photoData = $data['profile_photo'] ?? '';
  $photoName = null;
  if ($photoData && preg_match('/^data:image\/(\w+);base64,/', $photoData, $type)) {
      $photoData = substr($photoData, strpos($photoData, ',') + 1);
      $type = strtolower($type[1]);
      $photoData = base64_decode($photoData);
      $photoName = 'intern_reg_' . time() . '.' . $type;
      $uploadDir = __DIR__ . '/../uploads/photos/';
      if (!is_dir($uploadDir)) {
          mkdir($uploadDir, 0755, true);
      }
      file_put_contents($uploadDir . $photoName, $photoData);
  }

  // 4. Generate secure reproducible QR payload signature using HMAC-SHA256 and a secret salt
  $timestamp = time();
  $secret_salt = 'TDRPowersteelInternSalt2026!';

  $embeddings_json = json_encode($embeddings);

  if ($intern_id) {
      // 5A. UPDATE existing record (retains ID and teammate's existing DTR logs)
      $hash = substr(hash_hmac('sha256', "INTERN:{$intern_id}|TIME:{$timestamp}", $secret_salt), 0, 8);
      $qr_code = "INTERN:{$intern_id}|HASH:{$hash}|TIME:{$timestamp}";
      
      if ($photoName) {
          // Rename photo to match permanent ID
          $permanentPhotoName = 'intern_' . $intern_id . '_' . time() . '.' . pathinfo($photoName, PATHINFO_EXTENSION);
          rename($uploadDir . $photoName, $uploadDir . $permanentPhotoName);
          $photoName = $permanentPhotoName;
          
          $stmt = $conn->prepare("UPDATE interns SET email = ?, profile_photo = ?, face_embedding = ?, qr_code = ?, registered_at = NOW(), updated_at = NOW() WHERE id = ?");
          $stmt->bind_param("ssssi", $email, $photoName, $embeddings_json, $qr_code, $intern_id);
      } else {
          $stmt = $conn->prepare("UPDATE interns SET email = ?, face_embedding = ?, qr_code = ?, registered_at = NOW(), updated_at = NOW() WHERE id = ?");
          $stmt->bind_param("sssi", $email, $embeddings_json, $qr_code, $intern_id);
      }
      $success = $stmt->execute();
      $stmt->close();
  } else {
      // 5B. INSERT new record
      // Temporary QR payload using a placeholder ID, will re-update below with true primary key
      $qr_placeholder = "INTERN_TEMP|HASH_PLACEHOLDER|TIME:{$timestamp}";
      $stmt = $conn->prepare("INSERT INTO interns (department_id, first_name, last_name, middle_name, email, profile_photo, face_embedding, qr_code, status, required_hours, registered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', 486.00, NOW(), NOW())");
      $stmt->bind_param("isssssss", $department_id, $first_name, $last_name, $middle_name, $email, $photoName, $embeddings_json, $qr_placeholder);
      $success = $stmt->execute();
      $intern_id = $conn->insert_id;
      $stmt->close();

      if ($success && $intern_id) {
          // Generate real QR code with permanent ID and salted hash, then update row
          $hash = substr(hash_hmac('sha256', "INTERN:{$intern_id}|TIME:{$timestamp}", $secret_salt), 0, 8);
          $qr_code = "INTERN:{$intern_id}|HASH:{$hash}|TIME:{$timestamp}";
          
          if ($photoName) {
              $permanentPhotoName = 'intern_' . $intern_id . '_' . time() . '.' . pathinfo($photoName, PATHINFO_EXTENSION);
              rename($uploadDir . $photoName, $uploadDir . $permanentPhotoName);
              $photoName = $permanentPhotoName;
              
              $upd = $conn->prepare("UPDATE interns SET qr_code = ?, profile_photo = ? WHERE id = ?");
              $upd->bind_param("ssi", $qr_code, $photoName, $intern_id);
          } else {
              $upd = $conn->prepare("UPDATE interns SET qr_code = ? WHERE id = ?");
              $upd->bind_param("si", $qr_code, $intern_id);
          }
          $upd->execute();
          $upd->close();
      }
  }

  if ($success) {
      echo json_encode(["ok" => true, "qr_code" => $qr_code]);
  } else {
      http_response_code(500);
      echo json_encode(["ok" => false, "message" => "Failed to save database profile: " . $conn->error]);
  }
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

---

## Operational Recommendations & Enhancements

### 1. Offline Verification and Caching for Interns
* **Concept:** Currently, Kiosk offline redundancies only cover employees. If the connection to the PHP server fails, interns cannot register attendance.
* **Enhancement:** Modify the Kiosk sync tasks to pull active intern face embeddings into a local SQLite/AsyncStorage cache. This allows offline intern verification, logging attendance locally, and syncing logs when connection is restored.

### 2. Time-Falsification Prevention
* **Concept:** The API accepts client-side time values. While helpful for offline queuing, a dedicated mountable Kiosk should verify records against the secure authority clock.
* **Enhancement:** When logging attendance online, use the server's timezone-aware clock (`date('H:i:s')` under `Asia/Manila` in PHP) rather than the Kiosk client-supplied parameters.

### 3. Local SSL configuration for Webcams
* **Concept:** Camera hardware access (`getUserMedia`) requires a secure origin (HTTPS) on client web views.
* **Enhancement:** Ensure Webmin is configured with active SSL certificates (via Let's Encrypt or a local trust store CA certificate) for deployment.

