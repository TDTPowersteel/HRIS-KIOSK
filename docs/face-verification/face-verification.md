# Camera Vision – On-Device Face Verification Documentation

> **Audience:** Developers and technical team members who need to understand the offline-first, local face verification pipeline running directly on the HRIS Kiosk hardware.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Libraries & Technologies](#2-libraries--technologies)
3. [Dual-Model Architecture: Local vs. Server (buffalo_sc & buffalo_l)](#3-dual-model-architecture-local-vs-server-buffalo_sc--buffalo_l)
4. [End-to-End Verification Pipeline](#4-end-to-end-verification-pipeline)
5. [Mathematics of Coordinate Mapping & Cropping](#5-mathematics-of-coordinate-mapping--cropping)
6. [Quality & Stability Gates (Readiness)](#6-quality--stability-gates-readiness)
7. [Liveness Detection & Active Eye Blink Workflow](#7-liveness-detection--active-eye-blink-workflow)
8. [Touchless Mode & Bypassed Countdown](#8-touchless-mode--bypassed-countdown)
9. [Orientation-Invariant Device Scaling](#9-orientation-invariant-device-scaling)
10. [Zero-Lag Transactions: Geocoding Location Cache](#10-zero-lag-transactions-geocoding-location-cache)
11. [Local Embedding Comparison (Cosine Similarity)](#11-local-embedding-comparison-cosine-similarity)
12. [Developer Code & Syntax Reference](#12-developer-code--syntax-reference)

---

## 1. Overview

The HRIS Kiosk attendance system features a fully **on-device local face verification engine** known as **Camera Vision**. Running local neural network inference directly on the tablet's processor, it decodes the camera payload, extracts a 512-dimensional face embedding, and checks similarity in **under 30ms** per inference, bypassing all internet latency.

### Camera Vision Architecture

```
[Employee scans QR code]
        │
        ▼ (Resolved offline or online)
[Employee identified / selected]
        │
        ▼
[Frame Processor locks target face]
        │
        ├─► Multi-face detection (Alerts if > 1 person)
        ├─► Active pose gate (Yaw, Pitch, Roll <= 14°)
        ├─► Active Eye Blink sequence (Checks for live user)
        └─► Frame stability filter (Counts 8 stable frames)
        │
        ▼ (Standard: Readiness 100% / Touchless: Readiness >= 65% + Liveness passed)
[Capture Triggered]
        │
        ▼
[Oriented Crop Recovery Math]
        │
        ▼ (Dynamic Crop Padding 1.6x - 2.0x)
[JPEG Decoded to RGBA Pixel Buffer]
        │
        ▼ (Preprocessed to 112x112 CHW Float32)
[ONNX local Inference (buffalo_sc)] ──► Generates 512-dim embedding
        │
        ▼
[Cosine Similarity Matching] ◄───────► Compares against accounts.face_embedding (stored locally)
        │
        ▼ (Similarity Score >= 0.52 with multi-angle consensus)
[Identity Verified ✅]
        │
        ▼ (Retrieves pre-fetched location coordinates & street address)
[Instant Supabase Insert / Queue] ──► Transaction complete
```

---

## 2. Libraries & Technologies

The local pipeline is powered by a high-performance stack optimized for React Native on Android tablets:

| Library | Role / Purpose | Performance Metrics |
|---|---|---|
| `onnxruntime-react-native` | Direct C++ execution of ONNX model formats via native platform accelerators. | **< 30ms** inference time |
| `react-native-vision-camera` | High-frequency frame acquisition and camera control. | Butter-smooth **30–60 FPS** viewfinder |
| `react-native-vision-camera-face-detector` | ML Kit wrapper for real-time bounding box, landmarks, and orientation. | Real-time on background Worklet |
| `react-native-worklets-core` | Runs JavaScript Worklet threads, delegating heavy ML workloads off the main thread. | Zero main-thread frame drops |
| `expo-image-manipulator` | Fast hardware-accelerated image cropping, scaling, and JPEG generation. | **~15ms** execution time |
| `jpeg-js` | Decodes raw binary JPEG payloads into an RGBA byte buffer inside JS. | Sub-10ms JS buffer translation |

---

## 3. Dual-Model Architecture: Local vs. Server (buffalo_sc & buffalo_l)

The HRIS Kiosk attendance system features a **Hybrid Dual-Model facial recognition engine** that shifts between offline local inference and online server comparison based on network availability:

1. **Server Mode (Primary / Online):** Uses the higher-capacity `buffalo_l` model on a Flask AI server.
2. **Local Mode (Fallback / Offline):** Runs the lightweight `buffalo_sc` model directly on the device using ONNX Runtime.

---

### A. The Server-Side Model (`buffalo_l`)

When the kiosk is online, it sends the cropped face image via PHP to a local Python Flask AI server executing the high-accuracy server-side model.

*   **Model Name:** `buffalo_l` (ResNet50 backbone)
*   **Primary Execution:** Python / PyTorch / ONNX Runtime (on the local server)
*   **Accuracy:** **99.83%** (higher discriminative power, robust to lighting variation)
*   **Stored Template Field:** `face_embedding_large` (stored in the database)
*   **Verification Endpoint:** `/verify_embedding.php` (which forwards to Python AI server port 5001)

---

### B. The Local On-Device Model (`buffalo_sc`)

When network request delays exceed thresholds or during network outages, the local face verification falls back instantly to the **MobileFaceNet** model running directly on the device's CPU.

*   **Model Filename:** `w600k_mbf.onnx` (~16MB)
*   **Backbone:** MobileFaceNet optimized for low-power mobile processors
*   **Loss Function:** Trained using ArcFace loss
*   **LFW Benchmark Accuracy:** **99.70%**
*   **Input Tensor Dimensions:** `[1, 3, 112, 112]` (Float32 CHW format)
*   **Normalization Scale:** `(pixel_value - 127.5) / 128.0` (maps pixels to `[-1.0, 1.0]`)
*   **Output Vector:** `512` Float32 dimensional embedding vector
*   **Stored Template Field:** `face_embedding` (stored locally in accounts/AsyncStorage cache)

> [!NOTE]
> The local `buffalo_sc` model is packaged in the kiosk binary asset folder (`assets/models/w600k_mbf.onnx`). On initial boot, the app copies the model from the read-only package system into `FileSystem.documentDirectory` to initialize the `InferenceSession` asynchronously.

---

## 4. End-to-End Verification Pipeline

1.  **Detection & Alignment**: Frame processor detects the face, measures landmark points, and tracks the candidate face across frames.
2.  **Quality Validation**: The face must pass strict size bounds, location clamping, and a tightened $\le 14^\circ$ head-angle gate.
3.  **Liveness Gate**: The Active Blink state machine checks for natural biological movements.
4.  **Capture**: A high-resolution photo is taken using the camera hardware.
5.  **Oriented Bounding Box Mapping**: Bounding box coordinates from the frame processor (e.g. `640x480`) are mapped to the high-resolution photo coordinates (e.g. `2736x3648`).
6.  **Crop & Padding**: The face box is centered, expanded by a dynamic padding factor for ArcFace feature context, and cropped using native hardware.
7.  **JS Pixel Decode**: The cropped JPEG is fetched and decoded to an RGBA byte array.
8.  **Normalizing & Channel Reshaping**: Converts the RGBA pixels to an RGB float array, reshapes it to CHW format (`[3, 112, 112]`), and normalizes.
9.  **Inference**: The tensor is fed to `w600k_mbf.onnx` via ONNX Runtime.
10. **L2 Normalization**: Output embeddings are normalized to unit magnitude to allow Cosine Similarity calculation.
11. **Comparison**: Best-match similarity is calculated against the employee's stored face embeddings.

---

## 5. Mathematics of Coordinate Mapping & Cropping

To prevent crashes caused by cropping outside raw portrait/landscape photo boundaries, the engine applies aspect-ratio scaling and boundary clamping.

### Recovery from Oriented Frame Space to Photo Space

Let the face bounding box returned by the detector be normalized: $(x, y, w, h) \in [0, 1]^4$.
The face detector outputs dimensions in the camera oriented frame coordinates (e.g., $640 \times 480$ landscape). However, the photo captured is upright portrait (e.g., $2736 \times 3648$).

1.  **Horizontal Mirroring Check**: If using the front camera, the $x$-coordinate is mirrored horizontally:
    $$x_{raw} = 1 - (x + w)$$

2.  **Rotation Recovery (PORTRAIT_UP)**:
    To match the CSS rotation of the camera preview view, coordinates are rotated:
    $$x_{rotated} = 1 - (y + h)$$
    $$y_{rotated} = x$$
    $$w_{rotated} = h$$
    $$h_{rotated} = w$$

3.  **Cover Scale & Aspect Ratio Correction**:
    Since the camera viewfinder utilizes `resizeMode="cover"`, the frame is scaled up to fill the display window.
    $$\text{coverScale} = \max\left(\frac{W_{photo}}{W_{frame}}, \frac{H_{photo}}{H_{frame}}\right)$$
    
    $$\text{renderedW} = W_{frame} \times \text{coverScale}$$
    $$\text{renderedH} = H_{frame} \times \text{coverScale}$$
    
    $$\text{offsetX} = \frac{\text{renderedW} - W_{photo}}{2}$$
    $$\text{offsetY} = \frac{\text{renderedH} - H_{photo}}{2}$$

4.  **Absolute Pixel Recovery**:
    $$x_{photo} = (x_{rotated} \times W_{frame} \times \text{coverScale}) - \text{offsetX}$$
    $$y_{photo} = (y_{rotated} \times H_{frame} \times \text{coverScale}) - \text{offsetY}$$
    $$w_{photo} = w_{rotated} \times W_{frame} \times \text{coverScale}$$
    $$h_{photo} = h_{rotated} \times H_{frame} \times \text{coverScale}$$

5.  **Dynamic Crop Padding (Far Face Compensation)**:
    To prevent stale tracking bounding boxes from cropping out facial edges, the crop padding dynamically scales based on the face-to-frame ratio:
    $$\text{faceRatio} = \max\left(\frac{w_{photo}}{W_{photo}}, \frac{h_{photo}}{H_{photo}}\right)$$
    
    *   **Close Face ($\text{faceRatio} \ge 0.35$):** Padding multiplier is set to `1.6`.
    *   **Far Face ($\text{faceRatio} \le 0.15$):** Padding multiplier is set to `2.0` (wider margin to account for tracking lag).
    *   **Mid-range ($0.15 < \text{faceRatio} < 0.35$):** Linear interpolation is computed:
        $$t = \frac{\text{faceRatio} - 0.15}{0.35 - 0.15}$$
        $$\text{paddingMult} = 2.0 - t \times (2.0 - 1.6)$$

6.  **Square Centering**:
    $$\text{center}_X = x_{photo} + \frac{w_{photo}}{2}$$
    $$\text{center}_Y = y_{photo} + \frac{h_{photo}}{2}$$
    $$\text{side} = \max(w_{photo}, h_{photo}) \times \text{paddingMult}$$
    
    $$\text{origin}_X = \lfloor\text{center}_X - \frac{\text{side}}{2}\rfloor$$
    $$\text{origin}_Y = \lfloor\text{center}_Y - \text{side} \times 0.45\rfloor$$

7.  **Safety Clamp Protection**:
    To prevent coordinate out-of-bounds crashes during native cropping, the crop size is locked to the smallest photo dimension and clamped against raw photo boundaries:
    $$\text{safeSize} = \min(\text{side}, W_{photo}, H_{photo})$$
    $$\text{origin}_X = \max(0, \min(W_{photo} - \text{safeSize}, \text{origin}_X))$$
    $$\text{origin}_Y = \max(0, \min(H_{photo} - \text{safeSize}, \text{origin}_Y))$$

---

## 6. Quality & Stability Gates (Readiness)

To avoid capturing blurred faces, bad angles, or flickering targets, the engine implements a **stable frame low-pass filter**:

*   **Stable Frames Required**: `CAMERA_VISION_STABLE_FACE_FRAMES = 8` frames.
*   **Filter Rule**: Every consecutive frame containing a valid face increments the counter. If the face is lost or drops out of bounds, the counter decrements.
*   **Readiness Percent**:
    $$\text{Readiness \%} = \min\left(100, \text{round}\left(\frac{\text{stableFaceFrames}}{8} \times 100\right)\right)$$

---

## 7. Liveness Detection & Active Eye Blink Workflow

To prevent static spoofing attacks (e.g. photos, phone screens), the camera Vision frame processor Worklet tracks an **Active Eye Blink sequence** state machine:

*   **State `0` (Idle/Neutral):**
    *   *Trigger:* Both eyes open (`leftEyeOpenProbability > 0.6 && rightEyeOpenProbability > 0.6`) for 3 consecutive frames.
    *   *Action:* Transitions to State 1. Guided prompt: `"Look straight with a neutral face"`.
*   **State `1` (Ready):**
    *   *Trigger:* Both eyes closed (`leftEyeOpenProbability < 0.3 && rightEyeOpenProbability < 0.3`) for 1 frame.
    *   *Action:* Transitions to State 2. Guided prompt: `"Please Blink"`.
*   **State `2` (Blink Started):**
    *   *Trigger:* Both eyes reopen (`leftEyeOpenProbability > 0.6 && rightEyeOpenProbability > 0.6`) for 2 consecutive frames.
    *   *Action:* Transitions to State 3. Guided prompt: `"Liveness passed! Ready to verify."`. Sets `backgroundLivenessPassed = true`.
*   **State `3` (Blink Complete/Passed):**
    *   Maintains passed state until reset.
*   **State Reset Rule (Face Lost):**
    *   If no faces are detected for 15 consecutive frames, the system resets: `blinkState = 0`, `livenessConsecutiveFrames = 0`, `backgroundLivenessPassed = false`.

---

## 8. Touchless Mode & Bypassed Countdown

When **Touchless Mode** is active, users do not tap any buttons to register attendance. The engine manages the verification lifecycle automatically using quality locks:

1.  **Zero-Touch QR Trigger**: The employee presents their QR code to the scanner. Once verified, the camera instantly switches to face mode.
2.  **Bypassed Countdown**: Unlike standard mode, which starts a 3-second timer, touchless mode bypasses the countdown entirely.
3.  **Auto-Trigger Threshold**: Verification auto-triggers instantly once:
    *   `Readiness` reaches $\ge 65\%$ (`CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY = 65`), which represents 6 consecutive frames of a stable face box.
    *   `backgroundLivenessPassed` is true (Active Eye Blink sequence passed).
4.  **Auto-Reset Protection**: If the employee steps away during alignment and readiness drops below the threshold, the trigger resets to prevent false triggers.

---

## 9. Orientation-Invariant Device Scaling

To prevent landscape orientation on tablets and phones from incorrectly mapping to oversized text, button styles, or viewfinders, all styling calculations are locked to the device's shortest physical dimension:

$$\text{shortDimension} = \min(\text{windowWidth}, \text{windowHeight})$$

By using `shortDimension` as the base scale for styles across [OfflineSync.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/OfflineSync.tsx), [EmployeeProfileData.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx), and settings index files, layout elements remain scaled for the device form factor (phone vs tablet) even when the screen is rotated to landscape.

---

## 10. Zero-Lag Transactions: Geocoding Location Cache

To avoid blocking the UI thread or introducing hardware-locking lags during location sweeps, the kiosk utilizes a **background pre-fetched geocoding location cache**:

*   **Pre-fetch Cycle**: During app launch, the kiosk initiates a background task to request foreground location permissions, query the tablet GPS coordinates (latitude/longitude), and query reverse-geocoding APIs.
*   **Full Address Format**: The geocoder captures and formats the complete address, including the **street number**, to provide granular accuracy:
    $$\text{Address} = \text{streetNumber} + \text{" "} + \text{street} + \text{", "} + \text{city} + \text{", "} + \text{region}$$
*   **Local Storage Cache**: The resulting location coordinate payload is serialized and cached in `AsyncStorage` under `'kiosk_cached_location'`.
*   **Zero-Delay Clock In/Out**: When a user clocks in or out, the kiosk reads `'kiosk_cached_location'` from local storage (retrieval completed in **< 5ms**). It completely bypasses hardware location chip polling during the transaction, securing instant, lag-free clock-ins.

---

## 11. Local Embedding Comparison (Cosine Similarity)

The 512-dimensional Float32 embedding vector extracted from the local ONNX inference is compared directly against the employee's face profiles in memory:

### Cosine Similarity Formula

$$\text{Similarity}(A, B) = \frac{A \cdot B}{\lVert A \rVert \lVert B \rVert} = \frac{\sum_{i=1}^{512} A_i B_i}{\sqrt{\sum_{i=1}^{512} A_i^2} \sqrt{\sum_{i=1}^{512} B_i^2}}$$

Since both the live embedding and the stored Supabase embeddings are pre-normalized to unit length ($\lVert A \rVert = 1$ and $\lVert B \rVert = 1$), the calculation simplifies to a simple dot product:
$$\text{Similarity}(A, B) = \sum_{i=1}^{512} A_i B_i$$

### Verification Thresholds & Verdict

The comparison engine evaluates similarity against the recommended defaults:

| Cosine Score | Match Verdict | Action / User Feedback |
|---|---|---|
| $\ge 0.52$ | **✅ Verified Match*** | Proceeds to insert attendance immediately. |
| $< 0.52$ | **❌ Mismatch** | Prompts failure modal, showing score, advising better lighting or alignment. |

#### * The Multi-Angle Consensus Rule (Top-2 Agreement)
To prevent "lucky hits" where an imposter might score high against a single specific angle of the employee, the engine implements a **Consensus Gate**:

*   **Logic**: If an employee has 3 or more face angles registered, the system requires **at least 2 angles** to score above the **Sub-Threshold (0.45)**.
*   **Security Benefit**: Even if an imposter scores 0.56 (above the 0.52 primary threshold) on one specific angle, if they score poorly on all other angles (below 0.45), the verification will **FAIL**.
*   **Verdict Rule**: `Verified = (MaxSimilarity >= 0.52) AND (At least 2 angles >= 0.45)`.

---

## 12. Developer Code & Syntax Reference

### 1. Model Download & Copy Syntax

On initial boot, the binary assets must be loaded and copied into a writable directory for ONNX Runtime:

```typescript
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as Ort from 'onnxruntime-react-native';

async function initializeOnnxSession(): Promise<Ort.InferenceSession> {
  const modelDir = FileSystem.documentDirectory + 'models/';
  const targetModelPath = modelDir + 'w600k_mbf.onnx';

  // Ensure target folder exists
  const dirInfo = await FileSystem.getInfoAsync(modelDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
  }

  // Check if model already copied
  const fileInfo = await FileSystem.getInfoAsync(targetModelPath);
  if (!fileInfo.exists) {
    const localModelUri = Asset.fromModule(require('../../assets/models/w600k_mbf.onnx')).uri;
    await FileSystem.downloadAsync(localModelUri, targetModelPath);
  }

  return await Ort.InferenceSession.create(targetModelPath);
}
```

### 2. Preprocessing HWC to CHW Float32 Tensor

Preprocesses raw pixels from RGBA format (Height, Width, Channel) to CHW (Channel, Height, Width) format and normalizes to $[-1.0, 1.0]$:

```typescript
export function rgbaBufferToCHWTensor(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  faceBox?: { x: number; y: number; width: number; height: number },
): Float32Array {
  const SIZE = 112;
  const tensor = new Float32Array(3 * SIZE * SIZE);

  // Determine crop box boundaries
  const cropX = faceBox ? Math.max(0, Math.floor(faceBox.x * srcW)) : 0;
  const cropY = faceBox ? Math.max(0, Math.floor(faceBox.y * srcH)) : 0;
  const cropW = faceBox ? Math.max(1, Math.min(Math.floor(faceBox.width * srcW), srcW - cropX)) : srcW;
  const cropH = faceBox ? Math.max(1, Math.min(Math.floor(faceBox.height * srcH), srcH - cropY)) : srcH;

  const xr = cropW / SIZE;
  const yr = cropH / SIZE;
  const pixelCount = SIZE * SIZE;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(cropX + Math.floor(x * xr), srcW - 1);
      const sy = Math.min(cropY + Math.floor(y * yr), srcH - 1);
      const si = (sy * srcW + sx) * 4; // 4 channels: RGBA
      const pi = y * SIZE + x;

      // Extract RGB, normalize to [-1, 1], and place in CHW planes
      tensor[pi]                  = (rgba[si]     - 127.5) / 128.0; // R plane
      tensor[pixelCount + pi]     = (rgba[si + 1] - 127.5) / 128.0; // G plane
      tensor[2 * pixelCount + pi] = (rgba[si + 2] - 127.5) / 128.0; // B plane
    }
  }

  return tensor;
}
```

### 3. Embedding Vector Cosine Comparison & Consensus Gate

```typescript
export function compareEmbeddings(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function verifyFaceLocal(
  liveEmbedding: number[], 
  storedEmbedding: number[] | number[][]
): boolean {
  // Normalize multi-angle array format
  const embeddingsList: number[][] = Array.isArray(storedEmbedding[0])
    ? (storedEmbedding as number[][])
    : [storedEmbedding as number[]];

  let maxSimilarity = -1;
  const perAngleScores: number[] = [];

  for (let i = 0; i < embeddingsList.length; i++) {
    const score = compareEmbeddings(liveEmbedding, embeddingsList[i]);
    perAngleScores.push(score);
    if (score > maxSimilarity) {
      maxSimilarity = score;
    }
  }

  const primaryThreshold = 0.52;
  const subThreshold = 0.45;

  const agreeingAngles = perAngleScores.filter(s => s >= subThreshold).length;
  const top2Required = embeddingsList.length >= 3;
  const top2Agrees = !top2Required || agreeingAngles >= 2;

  return maxSimilarity >= primaryThreshold && top2Agrees;
}
```

---

*Last updated: 2026-06-02 — Reflects local Camera Vision implementation.*
