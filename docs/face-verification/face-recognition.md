# Facial Recognition – Complete Technical Documentation

> **Audience:** Developers and team members who need to understand how face verification works end-to-end in the HRIS Kiosk attendance system.

---

## Table of Contents

1. [Camera Vision Engine Overview](#1-camera-vision-engine-overview)
2. [Libraries & Services Used](#2-libraries--services-used)
3. [Complete Flow – Step by Step](#3-complete-flow--step-by-step)
4. [Mobile App Layer (React Native)](#4-mobile-app-layer-react-native)
5. [Backend Layer (PHP)](#5-backend-layer-php)
6. [Database Layer (Supabase)](#6-database-layer-supabase)
7. [Liveness Detection – Active Eye Blink Workflow](#7-liveness-detection--active-eye-blink-workflow)
8. [Face Matching & Identity Verification](#8-face-matching--identity-verification)
9. [API Request & Response Reference](#9-api-request--response-reference)
10. [Error Handling & Fallbacks](#10-error-handling--fallbacks)
11. [Offline Mode](#11-offline-mode)
12. [Environment Variables](#12-environment-variables)

---

## 1. Dual-Model Vision Engine Overview

The HRIS Kiosk attendance system uses a **Hybrid Dual-Model facial recognition engine**. It attempts to verify the face using a high-accuracy server-side model (`buffalo_l`), and seamlessly falls back to a fully **on-device local inference engine** (`buffalo_sc`) during network outages or low-bandwidth scenarios.

*   **Primary Engine (Server Mode):** `buffalo_l` (ResNet50) running on a Python AI server via `verify_embedding.php`.
*   **Fallback Engine (Local Mode):** `buffalo_sc` (MobileFaceNet) running locally via ONNX Runtime.
*   **Accuracy:** 99.70% (Local) / 99.83% (Server)
*   **Liveness Verification:** Active Eye Blink state machine (Open → Closed → Open eyes sequence).
*   **Latency:** < 30ms local ONNX inference, overall transaction < 500ms (online) or < 50ms (offline).
*   *For low-level coordinate scaling, preprocessing calculations, and detailed math, see:* **[Camera Vision Face Verification Documentation](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/docs/face-verification.md)**.

### Camera Viewfinder Overlay
The camera viewfinder uses a premium, high-fidelity overlay conforming to the application design system:
*   **Style:** Sharp **0-radius corners** (`borderRadius: 0`) and a thin **1.5px solid border** (`borderWidth: 1.5`).
*   **Active Status Colors:**
    *   **Orange/Amber (#F27121):** The subject is aligning or does not pass stability / liveness checks. Transparent backdrop.
    *   **Green (#2ecc71):** The subject is locked in, liveness is verified, stability is reached, and the photo capture is triggering. A 15% green backdrop is applied (`rgba(46, 204, 113, 0.15)`).

---

## 2. Libraries & Services Used

### Mobile App (React Native)

| Library | Purpose / Role | Performance |
|---|---|---|
| `onnxruntime-react-native` | Runs MobileFaceNet ONNX model directly on the device processor | **< 30ms** inference time |
| `react-native-vision-camera` | Render viewfinder and capture high-resolution photo | Butter-smooth **30-60 FPS** |
| `react-native-vision-camera-face-detector` | ML Kit wrapper for real-time bounding box, orientation, and eye openness | Runs on background Worklet |
| `react-native-worklets-core` | Offloads heavy frame-by-frame calculations from the JS thread | Zero main-thread frame drops |
| `expo-image-manipulator` | Native hardware-accelerated cropping, scaling, and JPEG generation | **~15ms** execution time |
| `jpeg-js` | Decodes raw binary JPEG crop into RGBA byte array in JS | Sub-10ms decoding |
| `expo-av` | Plays camera shutter feedback sounds | Instant execution |
| `@react-native-async-storage/async-storage` | Stores offline attendance queues, location caches, and session flags | Local I/O |

### Backend (PHP)

| File | Purpose / Role |
|---|---|
| `resolve_qr.php` | Resolves scanned QR code payload to employee information and stored face embeddings |
| `verify_embedding.php` | Receives live 512-dim embedding and performs server-side cosine comparison against stored templates |
| `record_attendance.php` | Writes a validated attendance record into the Supabase database |

### Cloud Services

| Service | Role |
|---|---|
| **Supabase** | Main database hosting employee accounts, multi-angle face embeddings, and attendance records |

---

## 3. Complete Flow – Step by Step

```
[Employee scans QR code]
        ↓
[QR resolved → Employee metadata & registered embeddings fetched]
        ↓
["QR Code Verified" modal shown]          ← Standard mode
[Employee taps OK]                          ← Touchless mode: modal skipped
        ↓
[Viewfinder active: seeks face box]
        ↓
[Pose & Blink Liveness verified]            ← Blocks static screens / photos
        ↓
[Stability counter locks target]            ← Green viewfinder & backdrop
        ↓
[High-Res Photo captured & cropped]         ← Dynamic padding (1.6x - 2.0x)
        ↓
[ONNX Local Inference runs (Optional)]     ← Generates 512-dim embedding (if offline)
        ↓
[Online? Verify Embedding via Server API]   ← POSTs live photo to verify_embedding.php (`buffalo_l`)
        ├─► Yes: Cosine match in PHP        ← Server-side comparison vs `face_embedding_large`
        └─► No: verifyFaceLocal() fallback  ← Instant on-device similarity check vs `face_embedding` (`buffalo_sc`)
        ↓
[Attendance logged & saved]                 ← Supabase insert / local queue sync
```

### Step 1 – QR Code Scan
*   The kiosk renders the front camera in QR scanning mode.
*   Upon reading a QR payload, it calls `resolve_qr.php` to fetch employee details (`userId`, `username`, `name`, `face_embedding`).
*   The metadata is cached in state, and `qrVerified` transitions to true.

### Step 2 – QR Success Modal / Touchless Skip
*   **Standard Mode:** A success modal is shown. The user taps **OK** to open the face camera viewfinder.
*   **Touchless Mode:** The modal is skipped; the camera switches immediately to face verification mode.

### Step 3 – Viewfinder Alignment
*   The camera viewfinder opens, running the frame processor.
*   The UI displays the telemetry guidance (e.g., `"Face the camera directly"`, `"Look straight with a neutral face"`).
*   The viewfinder displays an amber border.

### Step 4 – Active Blink Liveness Check
*   The frame processor evaluates eye openness indicators:
    *   State 0 (Neutral): Waits for both eyes open (`leftEye > 0.6 && rightEye > 0.6`).
    *   State 1 (Blink): Awaits eyes closed (`leftEye < 0.3 && rightEye < 0.3`).
    *   State 2 (Open/Recover): Awaits eyes reopened.
*   Upon successful sequence completion, state transitions to 3 (Liveness passed).

### Step 5 – Bounded Crop Capture
*   When stability threshold is reached (consecutive stable frames) and liveness is verified, the camera captures a high-resolution photo.
*   Coordinates from the frame detector are scaled to the photo dimensions.
*   Dynamic crop padding (between $1.6x$ and $2.0x$) is calculated depending on the subject's distance from the camera (far face compensation).
*   `expo-image-manipulator` cuts a square cropped image containing the face and resizes it to $112 \times 112$ pixels.

### Step 6 – ONNX Embedding Generation
*   `jpeg-js` extracts raw RGBA pixels from the crop.
*   Pixels are preprocessed into CHW Float32 layout (Red, Green, Blue planes) and normalized to `[-1, 1]`.
*   ONNX Runtime executes local inference on `w600k_mbf.onnx` to generate a 512-dimensional face embedding.
*   The output embedding is normalized to unit length.

### Step 7 – Identity Verification
*   **Online Path (Server Mode):** The cropped image is sent to `verify_embedding.php` as base64. The backend forwards it to the Python AI server which uses the `buffalo_l` model to extract a live embedding. The PHP server computes the Cosine similarity between this live embedding and the user's `face_embedding_large` stored in the database.
*   **Offline Path (Local Mode):** The local engine uses ONNX (`w600k_mbf.onnx`) to extract a live embedding and falls back to `verifyFaceLocal()`, which performs the Cosine similarity check against the locally cached `face_embedding`.

### Step 8 – Attendance Logging
*   Upon successful validation (similarity $\ge 0.52$ with multi-angle consensus), the attendance record is inserted into Supabase via `record_attendance.php`.
*   If offline, the record is placed in the local AsyncStorage queue.

---

## 4. Mobile App Layer (React Native)

**File:** `src/screens/ShowQRScan.tsx` / Hooks in `src/screens/attendance/useAttendance.ts`

### Key State & Shared Values

```typescript
cameraRef            // React ref to Vision Camera component
qrVerified           // Tracks transition from QR scanner to face viewfinder
isVerifying          // In-flight API lock to prevent double execution
blinkState           // SharedValue state machine tracking blink sequence (0 to 3)
stableFaceFrames     // Tracks consecutive frames containing aligned face
backgroundLivenessPassed // True when active blink sequence completes
```

### Touchless Mode Comparison

| Feature | Standard Mode | Touchless Mode |
|---|---|---|
| QR Verification | Success modal shown (Requires user tap) | Skips modal, goes straight to face viewfinder |
| Countdown Timer | Old countdown timer begins | Countdown bypassed; triggers instantly |
| Trigger Threshold | Requires 8 stable frames (Readiness 100%) | Triggers instantly when readiness $\ge 65\%$ |
| Clock-Out Action | User must press confirmation button | Auto-submits 1.5 seconds after QR scans |

---

## 5. Backend Layer (PHP)

Since facial cropping and embedding extraction are completed on-device, the PHP backend acts as a database gatekeeper.

*   `resolve_qr.php`: Retrieves employee metadata.
*   `verify_embedding.php`: Validates embeddings using Cosine Similarity:
    ```php
    // Computes dot product of two pre-normalized 512-dimensional arrays
    function cosine_similarity($arr1, $arr2) {
        $dot = 0.0;
        for ($i = 0; $i < 512; $i++) {
            $dot += $arr1[$i] * $arr2[$i];
        }
        return $dot;
    }
    ```
*   `record_attendance.php`: Enters attendance timestamps in Supabase.

---

## 6. Database Layer (Supabase)

### `accounts`
Stores login credentials and the employee's enrolled face embeddings.

| Column | Type | Description |
|---|---|---|
| `log_id` | int | Primary Key |
| `username` | text | Unique employee username |
| `face_embedding` | json | Multi-angle array of Float32 embedding vectors (`number[][]`) |

### `attendance`
Stores clock-in and clock-out transaction logs.

| Column | Type | Description |
|---|---|---|
| `att_id` | int | Auto-increment primary key |
| `emp_id` | int | Foreign key referencing employee profile |
| `date` | date | Date of attendance (Asia/Manila timezone) |
| `timein` | time | Clock-in time |
| `timeout` | time | Clock-out time (NULL if active) |

---

## 7. Liveness Detection – Active Eye Blink Workflow

To prevent spoofing via printed photos or digital displays, the engine implements an **Active Eye Blink sequence** state machine within the camera frame processor worklet:

```
[State 0: Neutral] ──(Both eyes open >= 3 frames)──► [State 1: Ready]
                                                          │
                                                (Both eyes closed >= 1 frame)
                                                          │
                                                          ▼
[State 3: Complete] ◄──(Both eyes open >= 2 frames)── [State 2: Blink Started]
```

*   **State 0 (Idle):** Frame processor requires both eyes open (`leftEye > 0.6 && rightEye > 0.6`) for 3 consecutive frames. Sets state to 1.
*   **State 1 (Awaiting Blink):** Awaits eyes closed (`leftEye < 0.3 && rightEye < 0.3`) for 1 frame. Sets state to 2.
*   **State 2 (Awaiting Open):** Awaits eyes reopened (`leftEye > 0.6 && rightEye > 0.6`) for 2 consecutive frames. Sets state to 3, marking liveness as passed.
*   **Lost Face Rule:** If no face is detected for 15 consecutive frames, the state machine resets back to State 0.

---

## 8. Face Matching & Identity Verification

Verification computes the similarity between the captured face embedding and the stored angles template.

### Dot Product Similarity
Since embeddings are pre-normalized to unit magnitude ($\lVert A \rVert = 1, \lVert B \rVert = 1$), Cosine Similarity simplifies to a dot product:
$$\text{Similarity} = \sum_{i=1}^{512} A_i \cdot B_i$$

### Thresholds
*   **Primary Threshold:** `0.52` (minimum similarity required for a match).
*   **Sub-Threshold:** `0.45` (used for multi-angle consensus).

### Multi-Angle Consensus Gate (Top-2 Agreement)
For employees with 3 or more registered face angles (e.g. looking center, slightly left, slightly right):
1.  Compare live embedding against all registered angles.
2.  Identify the maximum similarity score.
3.  Evaluate how many angles match above the `sub-threshold (0.45)`.
4.  **Verdict Rule:** The verification succeeds only if `MaxSimilarity >= 0.52` AND at least **2 angles** score $\ge 0.45$. This prevents accidental passes against a single angle.

---

## 9. API Request & Response Reference

### `POST /verify_embedding.php`

**Request Headers:**
`Content-Type: application/json`

**Request Body:**
```json
{
  "log_id": 52,
  "live_embedding": [0.0125, -0.0456, ..., 0.0891]
}
```

**Success Response (HTTP 200):**
```json
{
  "verified": true,
  "similarity": 0.725,
  "threshold": 0.52,
  "angle_count": 3,
  "best_angle_index": 0,
  "agreeing_angles": 3
}
```

**Failure Response (HTTP 401):**
```json
{
  "verified": false,
  "similarity": 0.412,
  "threshold": 0.52,
  "message": "Face does not match.",
  "hint": "Ensure good lighting and face the camera directly."
}
```

---

## 10. Error Handling & Fallbacks

| Scenario | System Behavior / Handling |
|---|---|
| Camera Not Initialized | Bypasses trigger checks until `onInitialized` fires and sets `cameraReadyRef` |
| Native Crop Fails | Catches exception, resets verification lock, and prompts retries |
| Backend Timeout | Aborts HTTP request after 5 seconds, falling back to local `verifyFaceLocal()` comparison |
| Mismatch Detected | Prompts warning overlay, plays warning tone, resets liveness checks |
| Face Lost | Resets stability counter, decrements readiness, and returns liveness state to 0 |

---

## 11. Offline Mode

When **Offline Mode** is active:
1.  **QR Resolution:** Falls back to matching the QR data against the local `offlineUsers` array stored in AsyncStorage.
2.  **Inference:** Still runs on-device via ONNX Runtime to extract the embedding.
3.  **Matching:** Directly calls `verifyFaceLocal()` using cached embeddings.
4.  **Queuing:** Saves transaction info into the `offlineAttendanceQueue` array in AsyncStorage.
5.  **Sync:** Tapping "SYNC NOW" in the Offline Attendance list posts queued logs to the server.

---

## 12. Environment Variables

Configured in `backend-php/.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_service_role_key

# Optional: set to 'optional' or 'off' to bypass face check in dev
FACE_VERIFY_MODE=required
```

> **Never commit `.env` to version control.** Use `.env.example` as the template.


*Last updated: 2026-05-12 — reflects the current implementation in `src/screens/ShowQRScan.tsx` and `backend-php/verify.php`.*
