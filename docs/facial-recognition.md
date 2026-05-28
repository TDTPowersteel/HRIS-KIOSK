# Facial Recognition – Complete Technical Documentation

> **Audience:** Developers and team members who need to understand how face verification works end-to-end in the HRIS Kiosk attendance system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Libraries & Services Used](#2-libraries--services-used)
3. [Complete Flow – Step by Step](#3-complete-flow--step-by-step)
4. [Mobile App Layer (React Native)](#4-mobile-app-layer-react-native)
5. [Backend Layer (PHP)](#5-backend-layer-php)
6. [Database Layer (Supabase)](#6-database-layer-supabase)
7. [Liveness Detection – How It Works](#7-liveness-detection--how-it-works)
8. [Face Matching – How It Works](#8-face-matching--how-it-works)
9. [API Request & Response Reference](#9-api-request--response-reference)
10. [Error Handling & Fallbacks](#10-error-handling--fallbacks)
11. [Offline Mode](#11-offline-mode)
12. [Environment Variables](#12-environment-variables)

---

## 1. Overview

The attendance system uses a **2-step identity flow** before recording a clock-in:

```
[Employee scans QR code]
        ↓
[QR resolved → Employee identified]
        ↓
["QR Code Verified" modal shown]         ← Standard mode
[Employee taps OK]                         ← Touchless mode: modal skipped
        ↓
[3-second countdown: 3 → 2 → 1 → 0]     ← Face camera gets ready
        ↓
[Front camera detects face with open eyes] ← Liveness trigger (instant)
        ↓
[2 photos captured 300ms apart]            ← Burst shot for anti-spoofing
        ↓
[PHP backend receives photos]
        ↓
[Liveness check: Shot 1 vs Shot 2 (Face++)]      ← Blocks static photos / screens
        ↓
[Identity check: Shot 1 vs Stored Face (Face++)] ← Confirms employee identity
        ↓
[Attendance recorded in Supabase]
```

Clock-out does **not** require face verification — only QR code confirmation (or automatic with Touchless mode).

---

## 2. Libraries & Services Used

### Mobile App (React Native)

| Library | Purpose |
|---|---|
| `react-native-vision-camera` | Renders the camera view, captures photos (`takePhoto`), and runs frame processors |
| `react-native-vision-camera-face-detector` | ML Kit-powered face detection running directly on camera frames |
| `react-native-worklets-core` | Runs face detection logic on a separate worklet thread (off the JS thread) for real-time performance |
| `expo-av` | Plays the shutter click sound on capture |
| `@react-native-async-storage/async-storage` | Stores the resolved `userId` and session state locally |

### Backend (PHP)

| File | Purpose |
|---|---|
| `verify.php` | Main entry point – orchestrates liveness check and identity verification |
| `facepp_api.php` | Wrapper for the **Face++ (Megvii)** API – handles image comparison |
| `luxand_face_api.php` | Reserved wrapper for **Luxand Cloud** API (not active, available as fallback) |
| `connect.php` | Supabase REST API client – handles all database queries |
| `record_attendance.php` | Inserts or updates attendance rows in Supabase |

### Cloud Services

| Service | Role |
|---|---|
| **Face++ (Megvii)** | AI face comparison engine. Free tier: 1,000 calls/day. Accuracy: 99.8% |
| **Supabase** | PostgreSQL database hosting employee accounts, stored face images, and attendance records |

---

## 3. Complete Flow – Step by Step

### Step 1 – QR Code Scan
- The kiosk shows the front camera in QR scan mode.
- `react-native-vision-camera`'s `useCodeScanner` listens for QR codes on every frame.
- When a QR is detected, the app calls `resolve_qr.php` on the backend to translate the QR value into an employee account (`log_id`, `username`, `name`).
- The `log_id` (user ID) is saved to `AsyncStorage` for use in the next step.

### Step 2 – QR Success Modal / Touchless Skip
- **Standard mode:** A "QR Code Verified" modal is shown. The employee taps **OK ("Great")** to proceed.
- **Touchless mode (enabled in settings):** The modal is skipped entirely. The countdown starts immediately after QR resolution.
- For **clock-out**: the employee's existing session is shown and they can confirm manually, or it is auto-triggered after 1.5 seconds in touchless mode.

### Step 3 – 3-Second Countdown
- After the modal is dismissed (or instantly in touchless mode), a **3 → 2 → 1 → 0** countdown begins.
- During the countdown the face frame shows the number and the hint: *"Position your face inside the frame"*.
- Liveness detection is **blocked** while the countdown is running (`countdownRef.current > 0`) — this gives the employee time to position their face before the camera fires.
- Once countdown reaches 0, liveness detection activates.

### Step 4 – Liveness Trigger
- The `frameProcessor` runs on every camera frame via ML Kit.
- It uses `useFaceDetector` with `classificationMode: 'all'` to get eye-open probabilities.
- **Trigger condition:** Either `leftEyeOpenProbability > 0.4` OR `rightEyeOpenProbability > 0.4`.
- This fires instantly — no gesture (smile/blink) is needed. The employee just looks at the camera.
- Once triggered, `Worklets.createRunOnJS` schedules `handleAttendance()` back on the JS thread.

### Step 5 – Burst Photo Capture
- `runVerification()` is called.
- **Shot 1** is taken immediately via `cameraRef.current.takePhoto()`.
- The app waits **300 milliseconds**.
- **Shot 2** is taken (same settings).
- Both photos are stored as local file URIs (`file://...`).

> The 300ms gap between shots is the anti-spoofing mechanism. A printed photo or phone screen will look **identical** in both shots (similarity ≈ 99.5%+), which the backend detects and blocks.

### Step 6 – Photos Sent to Backend
- `verifyFace(photoUri1, photoUri2)` builds a `multipart/form-data` POST request to `verify.php`.

**Fields sent:**

| Field | Content |
|---|---|
| `photo` | Shot 1 (JPEG file, named `selfie_1.jpg`) |
| `photo_liveness` | Shot 2 (JPEG file, named `selfie_2.jpg`) |
| `user_id` | The employee's `log_id` from AsyncStorage |
| `clock_time` | Current time string (e.g., `08:30 AM`) |

- Request timeout: **28 seconds**.

### Step 7 – Backend: Liveness Check
- `verify.php` receives both photos.
- It calls `facepp_compare_faces(shot1, shot2)` to compare the two burst shots against each other.
- Face++ returns a **confidence score (0–1)**.

| Score Range | Verdict | Reason |
|---|---|---|
| ≥ 0.992 (99.2%) | ❌ Blocked | Too identical — looks like a static photo/screen |
| < 0.80 (80%) | ❌ Blocked | Too different — face moved too much or no face |
| 0.80 – 0.991 | ✅ Pass | Normal live human with slight natural micro-movement |

### Step 8 – Backend: Identity Check
- `verify.php` queries Supabase for the employee's stored face image:
  ```
  GET /rest/v1/accounts?log_id=eq.<userId>&select=face,username,log_id
  ```
- The `face` column is stored as a **PostgreSQL bytea** (hex-encoded). The backend decodes it from hex → binary → base64 before sending to Face++.
- Face++ compares **Shot 1 vs Stored Face** using the `/compare` endpoint.
- The threshold used is Face++'s `1e-4` level (≥70 confidence score out of 100).

| Result | Action |
|---|---|
| `confidence >= threshold` | ✅ Match — return `{ ok: true }` |
| `confidence < threshold` | ❌ Mismatch — return HTTP 401 with score |

### Step 9 – Attendance Recorded
- If the backend returns `{ ok: true }`, the mobile app calls `recordAttendance('clock_in')`.
- This sends a POST to `record_attendance.php`:
  ```json
  { "user_id": "52", "action": "clock_in" }
  ```
- The backend resolves `log_id → emp_id` via the `employees` table, then inserts into `attendance`:
  ```json
  { "emp_id": 12, "timein": "08:30:00", "timeout": null, "date": "2026-05-12" }
  ```
- The app also saves the session locally in `AsyncStorage` under `attendance_active_sessions` so the same employee is recognized as "clocked in" on next scan.

---

## 4. Mobile App Layer (React Native)

**File:** `src/screens/ShowQRScan.tsx`

### Key Refs & State

```
cameraRef            → ref to the Camera component (used to call takePhoto)
cameraReadyRef       → boolean flag — true only after onInitialized fires
livenessTriggeredRef → prevents liveness from firing more than once per session
qrVerified           → true after QR scan succeeds; switches camera to face mode
isVerifying          → true while the backend verification request is in-flight
faceCountdown        → counts 3→2→1→0; liveness is blocked while > 0
countdownActive      → true only after OK is tapped on QR modal (or instantly if touchless)
modalContext         → 'qr_success' | 'other' — tells closeModal whether to start countdown
countdownRef         → mirror of faceCountdown, readable from worklet thread safely
```

### Touchless Mode

Controlled by the **Touchless toggle** in the kiosk settings (stored in `AsyncStorage` as `settings_touchless_enabled`).

| Action | Standard Mode | Touchless Mode |
|---|---|---|
| After QR scan | Shows "QR Code Verified" modal | Skips modal, starts countdown immediately |
| Clock-in face scan | Activates after user taps "Great" | Activates immediately after countdown |
| Clock-out | Manual button press required | Auto-triggered 1.5 seconds after QR verified |

### Camera Rendering Strategy

Two `<Camera>` components exist but only one is mounted at a time:

```tsx
// QR MODE — no ref, no photo, uses codeScanner
{!qrVerified && (
  <Camera device={device} isActive codeScanner={codeScanner} />
)}

// FACE MODE — ref attached, photo enabled, frameProcessor active
{qrVerified && (
  <Camera
    ref={cameraRef}
    device={device}
    isActive
    photo={true}
    frameProcessor={frameProcessor}
    onInitialized={() => { cameraReadyRef.current = true; }}
  />
)}
```

> Splitting them prevents the QR camera from consuming resources during face verification and vice versa.

### Frame Processor (Worklet)

Runs on a background thread — never blocks the UI:

```ts
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const faces = detectFaces(frame);
  if (faces.length > 0) {
    const face = faces[0];
    const leftOpen  = (face.leftEyeOpenProbability  || 0) > 0.4;
    const rightOpen = (face.rightEyeOpenProbability || 0) > 0.4;
    if (leftOpen || rightOpen) {
      onLivenessDetected(); // schedules JS callback
    }
  }
}, [qrVerified, attendanceAction]);
```

---

## 5. Backend Layer (PHP)

**File:** `backend-php/verify.php`

### Execution Order

```
1. Validate inputs (photo, user_id)
2. If photo_liveness present AND Face++ configured:
     → Liveness check (shot1 vs shot2)
     → Reject if score >= 0.992 (too similar = spoof)
     → Reject if score < 0.80 (too different = unstable)
3. Fetch stored face from Supabase accounts table
4. Identity check (shot1 vs stored face)
5. Return result
```

### Face++ Image Optimization (`facepp_api.php`)

Before sending to Face++, images are resized with PHP GD:
- Max dimension: **800px** (longest side)
- Quality: **75% JPEG**
- This reduces upload time significantly for high-res camera photos.

---

## 6. Database Layer (Supabase)

### Tables Used

#### `accounts`
Stores login credentials and the employee's enrolled face.

| Column | Type | Description |
|---|---|---|
| `log_id` | int | Primary key — the `user_id` sent from the app |
| `username` | text | Employee username |
| `face` | bytea | Stored face image (hex-encoded JPEG) |

#### `employees`
Links a login account to an HR employee profile.

| Column | Type | Description |
|---|---|---|
| `log_id` | int | Foreign key to `accounts.log_id` |
| `emp_id` | int | Employee ID used in attendance records |

#### `attendance`
Stores clock-in and clock-out records.

| Column | Type | Description |
|---|---|---|
| `att_id` | int | Auto-increment primary key |
| `emp_id` | int | Foreign key to `employees.emp_id` |
| `date` | date | Date of attendance (Asia/Manila timezone) |
| `timein` | time | Clock-in time |
| `timeout` | time | Clock-out time (NULL if still clocked in) |

---

## 7. Face++ API Usage & Request Counts

The system optimally controls API usage to preserve quotas and performance depending on the attendance action being performed:

### Clock-In: Exactly 2 API Requests
For every successful clock-in attempt, the backend hits the Face++ `/compare` API exactly **twice**:
1. **Request 1 (Liveness/Anti-Spoofing):** Compares **Shot 1** vs **Shot 2** to evaluate natural biological micro-movements.
2. **Request 2 (Identity Verification):** Compares **Shot 1** vs **Stored Enrolled Face** fetched from the database.

### Clock-Out: 0 API Requests
Clock-outs do **not** perform facial comparison or liveness checks. Users simply scan their QR code and tap confirmation (or auto-confirm in Touchless Mode). Consequently, clock-outs consume **zero Face++ API calls**.

---

## 8. Why Face Scanning / Verification Takes Time (Latency Factors)

Users may observe a brief processing delay (typically 2 to 5 seconds) during the verification phase. This latency is normal and attributed to several unavoidable sequence steps:
1. **Burst Image Capture Gap:** The tablet intentionally waits **300 milliseconds** between taking Shot 1 and Shot 2 to record temporal movement differences.
2. **High-Resolution Payload Uploads:** The mobile app transmits two uncompressed Base64 JPEG photo payloads over the local Wi-Fi/network to the PHP server.
3. **Backend Image Optimization:** The PHP backend resizes both uploaded images using the GD library down to a max dimension of 800px at 75% quality before forwarding them.
4. **Sequential REST API Over-The-Network Calls:** The server performs two synchronous external HTTPS POST requests over the internet to Face++ servers (US/Global region). Network routing, TLS handshakes, and response waiting times add cumulative round-trip latency.
5. **Database Interfacing:** The server performs a REST call to Supabase to resolve and decode the hex-encoded bytea stored face string into binary format.

---

## 9. Liveness Detection – Complete Anti-Spoofing Workflow

The system enforces a **dual-layer liveness strategy** to prevent attendance fraud using static pictures or smartphone video playbacks:

### Layer 1 – Frontend Pre-Capture Guard (ML Kit, On-Device)
* **Execution:** Runs purely offline inside camera frame processors using `react-native-vision-camera-face-detector`.
* **Async Performance:** We use the `runAsync` API combined with a `useSharedValue` throttle lock. This pushes the heavy MLKit processing entirely to a background worklet thread. This ensures the main camera preview remains buttery smooth (30-60 FPS) and avoids the `invalid-output-configuration` crash on budget Android tablets.
* **Condition:** Checks real-time face presence with open-eye probabilities (`leftEyeOpenProbability > 0.4` or `rightEyeOpenProbability > 0.4`).
* **Purpose:** Ensures the subject is actively present, ready, and looking straight ahead before triggering the dual-shot capture sequence.

### Layer 2 – Backend Micro-Movement Verification (Face++, Cloud)
* **Execution:** Compares the two sequential burst photos captured 300ms apart via Face++ `/compare`.
* **Logic Breakdown:**
  * **Score ≥ 0.992 (99.2%+ similarity):** **REJECTED (Spoofing Attempt).** A photo of a printed paper picture or a stationary smartphone screen displayed to the scanner will look mathematically identical across both shots. The system flags this high similarity as a static spoofing attempt.
  * **Score < 0.80 (80% similarity):** **REJECTED (Unstable Capture).** The subject moved excessively, turned their head, or the camera lost framing.
  * **Score 0.80 – 0.991:** **PASSED (Live Human).** Live individuals exhibit subtle, involuntary micro-movements, normal eye saccades, breathing variations, or minor structural angle shifts across a 300ms interval, scoring perfectly in this natural range.

```
Shot 1 ──┐
          ├─► Face++ /compare ──► score 0.80–0.991 → LIVE ✅
Shot 2 ──┘                        score ≥ 0.992       → SPOOF ❌
                                   score < 0.80        → UNSTABLE ❌
```

---

## 10. Face Matching & Identity Verification

```
Shot 1 ──┐
          ├─► Face++ /compare ──► confidence ≥ threshold → MATCH ✅
Stored ───┘                        confidence < threshold → MISMATCH ❌
Face
```

- **Face++ API endpoint:** `POST https://api-us.faceplusplus.com/facepp/v3/compare`
- **Threshold used:** `1e-4` (roughly 70/100 confidence) — balanced for high accuracy attendance matching
- **Free tier usage:** 1,000 API calls/day (supports up to 500 employee clock-ins daily on a free tier account)

---

## 11. API Request & Response Reference

### `POST /verify.php`

**Request (multipart/form-data):**
```
photo           → JPEG file (Shot 1)
photo_liveness  → JPEG file (Shot 2, optional but recommended)
user_id         → string (employee log_id)
clock_time      → string (e.g. "08:30 AM")
```

**Success Response (HTTP 200):**
```json
{
  "ok": true,
  "message": "Face matched",
  "match_score": 0.87,
  "threshold": 0.70
}
```

**Liveness Fail (HTTP 401):**
```json
{
  "ok": false,
  "message": "Security Alert: Static photo detected.",
  "hint": "Please face the camera and blink.",
  "liveness_score": 0.997
}
```

**Identity Fail (HTTP 401):**
```json
{
  "ok": false,
  "message": "Face did not match",
  "match_score": 0.45,
  "threshold": 0.70
}
```

---

### `POST /record_attendance.php`

**Request (JSON):**
```json
{ "user_id": "52", "action": "clock_in" }
```

**Success Response (HTTP 200):**
```json
{
  "ok": true,
  "message": "Clock-in recorded",
  "emp_id": 12,
  "date": "2026-05-12",
  "timein": "08:30:00"
}
```

---

## 12. Error Handling & Fallbacks

| Scenario | Behaviour |
|---|---|
| Camera not yet initialized | Guard check via `cameraReadyRef` — throws "Camera is still initializing" |
| `takePhoto` fails | Throws "No image captured" — user sees error modal |
| Network timeout (28s) | `AbortController` cancels the request — shows "Connection Error" modal |
| Face++ not configured | Backend returns HTTP 501 with setup instructions |
| No stored face for user | Backend returns HTTP 404 — employee needs to enroll a face first |
| Face mismatch | Backend returns HTTP 401 — shows match score and asks to retry |
| Liveness spoof detected | Backend returns HTTP 401 — tells user to look directly at camera |

---

## 13. Offline Mode

When **Offline Mode** is enabled (toggled in the top-right of the kiosk UI):

- QR resolution attempts the backend first, then falls back to a locally cached employee list (`offlineUsers` cache).
- Face photos are still captured (both burst shots) but **not sent to Face++**.
- The attendance record is stored locally in an **offline queue** (`offlineAttendanceQueue` in AsyncStorage).
- When connectivity is restored, the queue is synced by pressing **SYNC NOW** in the offline attendance list screen.
- Clock-out in offline mode is similarly queued.

---

## 14. Environment Variables

Configured in `backend-php/.env`:

```env
# Face++ (Primary face recognition provider)
FACEPP_API_KEY=your_key_here
FACEPP_API_SECRET=your_secret_here

# Luxand (Reserved, not active)
LUXAND_API_TOKEN=your_token_here

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_service_role_key

# Optional: set to 'optional' or 'off' to bypass face check in dev
FACE_VERIFY_MODE=required
```

> **Never commit `.env` to version control.** Use `.env.example` as the template.

---

*Last updated: 2026-05-12 — reflects the current implementation in `src/screens/ShowQRScan.tsx` and `backend-php/verify.php`.*
