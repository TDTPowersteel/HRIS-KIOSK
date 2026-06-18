# Code Reading Guide: Face Verification & Recognition

> **Audience:** Developers and technical maintainers who need to read, debug, or extend the camera vision face-verification and face-recognition features in the HRIS Kiosk.

---

## 1. Directory & File Map

The logic is split across a few key components:

```
HRIS-KIOSK/
├── docs/face-verification/          # Documentation files
│   ├── face-verification.md         # Low-level math & preprocessing docs
│   ├── face-recognition.md          # End-to-end pipeline overview
│   ├── running-face-server.md       # Flask face server setup
│   └── code-guide.md                # This code reading guide
├── face_server/                     # Python Flask AI Server (Server-mode fallback)
│   ├── app.py                       # Server entrypoint & Model Loader
│   └── requirements.txt             # Python packages (InsightFace, ONNX, etc.)
└── src/screens/
    ├── ShowQRScan.tsx               # Main QR Scan page & state controller
    └── attendance/
        ├── FaceScanView.tsx         # Camera viewfinder overlay & CSS styling
        ├── QRScanView.tsx           # Camera viewfinder wrapper for QR codes
        └── useAttendance.ts         # Hook containing all ML frame logic & math
```

---

## 2. Core Logic Walkthrough

### 1. QR Scan & Location Cache Prefetch
*   **Location Prefetch:** When the kiosk boots, `useAttendance.ts` queries GPS coordinates and fetches the complete reverse-geocoded address (including house/street number). This data is cached in `AsyncStorage` as `kiosk_cached_location`.
*   **Transaction Speed:** During a scan, location retrieval takes **< 5ms**, completely eliminating the 2–5s lag of polling GPS chips during check-in.
*   **QR Resolution:** When a QR is scanned, `ShowQRScan.tsx` sends the code to `resolve_qr.php` to fetch employee records and their enrolled face templates.

---

### 2. The Frame Processor Worklet
All real-time frame operations are executed inside the frame processor in [useAttendance.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/attendance/useAttendance.ts).

*   **Worklet Safety Locks:** The frame processor utilizes `isProcessingFace` shared values to prevent frame buffer queue locking. If a frame takes longer than ~1s (30 frames) to execute, a safety reset forces `isProcessingFace.value = false`.
*   **Frame Throttle:** Frame processing is throttled to roughly **10 FPS** (`if (frameCounter.value % 3 !== 0) return;`) to ensure the main thread has ample overhead for rendering the camera preview.

---

### 3. Active Blink Liveness Check
To block static spoofing (e.g. holding up an employee's photo), the frame processor runs a state machine:

```
State 0 (Idle) ──► State 1 (Eyes Open) ──► State 2 (Blink Detected) ──► State 3 (Passed)
```

1.  **State 0 (Idle):** Awaits a stable baseline where both eyes are open (`leftEyeOpenProbability > 0.6 && rightEyeOpenProbability > 0.6`) for 3 consecutive frames.
2.  **State 1 (Neutral):** Prompts the user to blink. Translates to State 2 once both eyes are closed (`leftEyeOpenProbability < 0.3 && rightEyeOpenProbability < 0.3`) for 1 frame.
3.  **State 2 (Blink Started):** Awaits eyes reopening (`leftEyeOpenProbability > 0.6 && rightEyeOpenProbability > 0.6`) for 2 consecutive frames. Once met, liveness is permanently marked as passed (`backgroundLivenessPassed = true`), transitioning to State 3.
4.  **Auto-Reset:** If no faces are detected for 15 consecutive frames, the liveness state resets to `0` and liveness is revoked.

---

### 4. Photo Capture & High-Resolution Math
Once readiness criteria are met (stability frames logged and liveness verified), the system triggers `takePhoto()` on the JS thread. The captured photo has a much higher resolution (e.g., $3264 \times 2448$) compared to the frame buffer (e.g., $1280 \times 720$).

#### Recovery Mapping Formula:
1.  **Horizontal Mirroring Offset:** For the front camera, the normalized $x$ coordinate is flipped:
    $$x_{flipped} = 1 - (x + \text{width})$$
2.  **Aspect Ratio cover mode scaling:** The scale factor is determined:
    $$\text{scale} = \max\left(\frac{W_{photo}}{W_{frame}}, \frac{H_{photo}}{H_{frame}}\right)$$
3.  **Centered Crop:** To avoid capturing cropped facial edges, padding is added dynamically.
    *   **Close Face:** (Face occupies $\ge 35\%$ of frame width) $\rightarrow$ `1.6x` padding.
    *   **Far Face:** (Face occupies $\le 15\%$ of frame width) $\rightarrow$ `2.0x` padding.
    *   **Mid Face:** Linear interpolation between `1.6x` and `2.0x`.
4.  **Clamping Protection:** The final crop coordinates are clamped to ensure they are strictly inside $[0, W_{photo}]$ and $[0, H_{photo}]$ to prevent image manipulation library crashes.

---

### 5. On-Device Local Inference (`buffalo_sc`)
If the server is offline or unreachable, the local verification is fired using the MobileFaceNet model (`assets/models/w600k_mbf.onnx`):

*   **Pixel Extraction:** `jpeg-js` decodes the cropped JPEG image into raw RGBA bytes.
*   **Preprocessing:** The HWC (Height, Width, Channel) RGBA buffer is reshaped into a CHW (Channel, Height, Width) Float32 array, ignoring the alpha channel.
*   **Normalization:** Pixels are scaled using:
    $$\text{pixel}_{\text{tensor}} = \frac{\text{pixel} - 127.5}{128.0}$$
*   **Inference Session:** Executed inside `onnxruntime-react-native` to output a 512-dimensional vector. The output is L2-normalized:
    $$\text{embedding} = \frac{v}{\|v\|_2}$$

---

### 6. Local Cosine Similarity & Consensus Gate
To verify if the live embedding matches the stored profile, we calculate the dot product. Because both vectors are L2-normalized, the cosine similarity is a simple dot product:

$$\text{Similarity} = \sum_{i=1}^{512} A_i B_i$$

*   **Primary Threshold:** Must be $\ge 0.52$.
*   **Multi-Angle Consensus:** If the employee has $\ge 3$ templates registered, the live embedding must score $\ge 0.45$ (Sub-Threshold) on **at least 2 different angles** to avoid passing imposters who may coincidentally match a single template angle.

---

## 3. Orientation Invariance Explained
Android camera sensors are physically mounted at a 90-degree offset relative to the screen. 

*   **Library Output:** `react-native-vision-camera` reports `frame.orientation` as the raw **sensor rotation relative to the preview screen**.
*   **What this means:**
    *   When holding the tablet in **Portrait (Vertical)**, the raw frame buffer orientation is `'landscape-left'` or `'landscape-right'`.
    *   When holding the tablet in **Landscape (Horizontal)**, the raw frame buffer orientation is `'portrait'` or `'portrait-upside-down'`.

```typescript
// Map sensor orientation to physical device orientation
const isDevicePortrait = frameOrient === 'landscape-left' || frameOrient === 'landscape-right';
const orientedFrameW = isDevicePortrait ? frame.height : frame.width;
const orientedFrameH = isDevicePortrait ? frame.width : frame.height;
```

> [!IMPORTANT]
> **Variable Naming Rule:** Keep code variable checks matching the raw library outputs (`landscape-left` / `landscape-right` as checks for portrait devices). This ensures code aligns with the official `react-native-vision-camera` API documentation, preventing confusion for developers auditing the code in the future.

---

## 4. Debugging & Troubleshooting

### 1. Diagnostic Logs
A temporary diagnostic logger `logFrameDiag` is implemented in [useAttendance.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/attendance/useAttendance.ts#L1818-L1820). It prints the raw frame data every ~90 frames (~3 seconds):

```text
[DIAG] frame=1280x720 orient=landscape-left oriented=720x1280 face=(0.257,0.474,0.315,0.526)
```

*   **`frame`**: Raw sensor buffer dimensions (typically 1280x720).
*   **`orient`**: Raw sensor orientation (`landscape-left` when phone is vertical).
*   **`oriented`**: Swapped dimensions for device mapping (720x1280).
*   **`face`**: Normalized coordinate bounds $(x, y, w, h)$ of the tracked face.

### 2. Common Verification Failure Checklist
1.  **Low Verification Scores:**
    *   *Cause:* Face is too far away or off-center, leading to excessive dynamic padding inclusion.
    *   *Solution:* Align face closely inside the green viewfinder box.
2.  **No Face Overlay Rendered:**
    *   *Cause:* Throttled frame processor or worklet lock timeout.
    *   *Solution:* Check if `isProcessingFace` is permanently locked. Re-verify stability values.
3.  **Server Verification Fails but Offline Works:**
    *   *Cause:* Local face server is not running on port 5001 or IP is incorrect in PHP `.env`.
    *   *Solution:* Run `npm run dev` to boot orchestrator, or run `python app.py` manually from `face_server/` directory. Check server logs for incoming requests.
