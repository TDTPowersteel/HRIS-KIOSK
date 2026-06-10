# Kiosk Intern Integration Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the Kiosk PHP backend to route settings, user directory queries, face verification, and attendance check-ins to the local MySQL database (IMS) when `KIOSK_MODE` is set to `'intern'`, allowing seamless testing without modifying the Expo mobile application.

**Architecture:** Add a global `KIOSK_MODE` constant in the backend configuration. When set to `'intern'`, endpoints will connect to MySQL using `mysqli`, return localized JSON settings, fetch the intern list matching the React Native employee schema, and forward check-in logs to the IMS attendance endpoint.

**Tech Stack:** Native PHP (v8.2+), MySQL (mysqli), cURL.

---

### Task 1: Mode Configuration & Database Connection Helper

**Files:**
- Modify: `backend-php/connect.php`

- [ ] **Step 1: Declare KIOSK_MODE constant and getImsConnection function**
  Add definition for `KIOSK_MODE` and connection getter to `backend-php/connect.php`:
  ```php
  define('KIOSK_MODE', 'intern'); // 'employee' or 'intern'

  function getImsConnection(): mysqli {
      static $conn = null;
      if ($conn === null) {
          $conn = @new mysqli('localhost', 'root', '', 'tdt_ims');
          if ($conn->connect_error) {
              header('Content-Type: application/json');
              http_response_code(500);
              echo json_encode(['ok' => false, 'message' => 'IMS Database connection failed: ' . $conn->connect_error]);
              exit;
          }
          $conn->set_charset('utf8mb4');
      }
      return $conn;
  }
  ```

- [ ] **Step 2: Run syntax validation**
  Run: `php -l backend-php/connect.php`
  Expected output: `No syntax errors detected in backend-php/connect.php`

- [ ] **Step 3: Commit manually**
  Commit message:
  ```
  feat(kiosk-backend): introduce KIOSK_MODE flag and getImsConnection database helper
  ```

---

### Task 2: Kiosk Settings File Isolation

**Files:**
- Modify: `backend-php/settings_store.php`

- [ ] **Step 1: Update settings store constants to check KIOSK_MODE**
  Modify the constants definition inside `backend-php/settings_store.php` to conditionally load `app_settings_intern.json` if in intern mode:
  ```php
  const SETTINGS_STORE_DIR = __DIR__ . '/storage';
  define('SETTINGS_STORE_FILE', SETTINGS_STORE_DIR . '/' . (defined('KIOSK_MODE') && KIOSK_MODE === 'intern' ? 'app_settings_intern.json' : 'app_settings.json'));
  ```
  *Note: Replace the original `const SETTINGS_STORE_FILE = ...` line with `define()` since constant values must be defined dynamically at runtime when using flags.*

- [ ] **Step 2: Run syntax validation**
  Run: `php -l backend-php/settings_store.php`
  Expected output: `No syntax errors detected in backend-php/settings_store.php`

- [ ] **Step 3: Commit manually**
  Commit message:
  ```
  feat(kiosk-backend): isolate settings storage file for intern mode
  ```

---

### Task 3: Intern Directory Endpoint Routing

**Files:**
- Modify: `backend-php/employees.php`

- [ ] **Step 1: Check KIOSK_MODE and route queries to MySQL**
  Modify the list mode block (around lines 83-100) inside `backend-php/employees.php` to fetch from local MySQL when `KIOSK_MODE === 'intern'`:
  ```php
  // --- List Mode ---
  $page = isset($_GET['page']) ? (int)$_GET['page'] : 0;
  $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1000;
  $offset = $page * $limit;
  $search = isset($_GET['search']) ? trim($_GET['search']) : null;

  if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
      $conn = getImsConnection();
      $query = "SELECT id, first_name, last_name, face_embedding FROM interns WHERE status = 'Active'";
      if (!empty($search)) {
          $escapedSearch = $conn->real_escape_string($search);
          $query .= " AND (first_name LIKE '%{$escapedSearch}%' OR last_name LIKE '%{$escapedSearch}%')";
      }
      $query .= " ORDER BY id LIMIT {$limit} OFFSET {$offset}";
      
      $res = $conn->query($query);
      $data = [];
      while ($row = $res->fetch_assoc()) {
          $data[] = [
              'emp_id' => 'intern_' . $row['id'],
              'name' => $row['first_name'] . ' ' . $row['last_name'],
              'role' => 'Intern',
              'dept_id' => 1,
              'log_id' => 'intern_' . $row['id'],
              'accounts' => [
                  'log_id' => 'intern_' . $row['id'],
                  'username' => strtolower($row['first_name']),
                  'qr_code' => 'TDTINTRN' . $row['id'],
                  'profile_picture' => null
              ],
              'departments' => [
                  'name' => 'Internship'
              ]
          ];
      }
      
      if (ob_get_level() > 0) ob_end_clean();
      echo json_encode(['ok' => true, 'data' => $data]);
      exit;
  }
  ```

- [ ] **Step 2: Run syntax validation**
  Run: `php -l backend-php/employees.php`
  Expected: `No syntax errors detected in backend-php/employees.php`

- [ ] **Step 3: Commit manually**
  Commit message:
  ```
  feat(kiosk-backend): fetch and map intern records from MySQL database in employees endpoint
  ```

---

### Task 4: Face Verification Routing

**Files:**
- Modify: `backend-php/FaceVerificationHelper.php`

- [ ] **Step 1: Modify fetchUserFaceData to query MySQL database**
  Modify `fetchUserFaceData()` in `backend-php/FaceVerificationHelper.php` to load embeddings from the local `interns` database if the ID begins with `intern_` or if in intern mode:
  ```php
  function fetchUserFaceData(string $userId, string $engine = '') {
      if (strpos($userId, 'intern_') === 0 || (defined('KIOSK_MODE') && KIOSK_MODE === 'intern')) {
          $numericId = (int)str_replace('intern_', '', $userId);
          $conn = getImsConnection();
          $stmt = $conn->prepare("SELECT id, first_name, face_embedding FROM interns WHERE id = ?");
          $stmt->bind_param('i', $numericId);
          $stmt->execute();
          $result = $stmt->get_result()->fetch_assoc();
          $stmt->close();

          if (!$result) return [null, 'Intern not found'];
          
          return [
              [
                  'log_id' => 'intern_' . $result['id'],
                  'username' => $result['first_name'],
                  'profile_picture' => null,
                  'face_embedding' => $result['face_embedding'],
              ],
              null
          ];
      }

      // Original Supabase flow
      $selectCols = "profile_picture,username,log_id,face_embedding";
      [$status, $data, $err] = supabase_request('GET', "rest/v1/accounts?log_id=eq." . urlencode($userId) . "&select=" . $selectCols);
      if ($err) return [null, 'Database connection error: ' . $err];
      if ($status !== 200 || !is_array($data) || count($data) === 0) return [null, 'User not found'];
      
      $account = $data[0];
      $faceEmbedding = null;
      $rawEmbedding = $account['face_embedding'] ?? null;
      if (is_array($rawEmbedding) || is_object($rawEmbedding)) {
          $faceEmbedding = json_encode($rawEmbedding);
      } else if ($rawEmbedding !== null) {
          $faceEmbedding = trim((string)$rawEmbedding);
      }

      return [
          [
              'log_id' => $account['log_id'],
              'username' => $account['username'],
              'profile_picture' => $account['profile_picture'] ?? null,
              'face_embedding' => $faceEmbedding,
          ],
          null
      ];
  }
  ```

- [ ] **Step 2: Run syntax validation**
  Run: `php -l backend-php/FaceVerificationHelper.php`
  Expected: `No syntax errors detected in backend-php/FaceVerificationHelper.php`

- [ ] **Step 3: Commit manually**
  Commit message:
  ```
  feat(kiosk-backend): add MySQL support to fetchUserFaceData for intern face matches
  ```

---

### Task 5: Online Attendance Log Forwarding

**Files:**
- Modify: `backend-php/record_attendance.php`

- [ ] **Step 1: Check userId and forward intern check-ins to IMS**
  In the POST handler block of `backend-php/record_attendance.php` (around line 124, right before the Supabase employee query), intercept intern check-ins and forward them via cURL:
  ```php
  // Intercept and route intern logs to IMS record_intern_attendance.php
  if (strpos($userId, 'intern_') === 0 || (defined('KIOSK_MODE') && KIOSK_MODE === 'intern')) {
      $numericId = (int)str_replace('intern_', '', $userId);
      $httpHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
      $imsUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . "://" . $httpHost . "/ims";
      
      $ch = curl_init();
      curl_setopt($ch, CURLOPT_URL, "{$imsUrl}/api/record_intern_attendance.php");
      curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
      curl_setopt($ch, CURLOPT_POST, true);
      curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
          'intern_id' => $numericId,
          'action' => $action,
          'date' => $providedDate ?: date('Y-m-d'),
          'time' => $providedTime ?: date('H:i:s')
      ]));
      curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
      curl_setopt($ch, CURLOPT_TIMEOUT, 15);
      
      $response = curl_exec($ch);
      $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $curlErr = curl_error($ch);
      curl_close($ch);

      if ($curlErr) {
          http_response_code(502);
          echo json_encode(['ok' => false, 'message' => 'Failed to reach IMS server: ' . $curlErr]);
          exit;
      }

      $data = json_decode($response, true);
      if ($httpCode !== 200 || !($data['ok'] ?? false)) {
          http_response_code($httpCode ?: 500);
          echo json_encode(['ok' => false, 'message' => $data['message'] ?? 'IMS record failure']);
          exit;
      }

      echo json_encode(['ok' => true, 'message' => $data['message'] ?? 'Intern log saved']);
      exit;
  }
  ```

- [ ] **Step 2: Run syntax validation**
  Run: `php -l backend-php/record_attendance.php`
  Expected: `No syntax errors detected in backend-php/record_attendance.php`

- [ ] **Step 3: Commit manually**
  Commit message:
  ```
  feat(kiosk-backend): proxy online intern attendance logs directly to IMS backend
  ```
