# Attendance Kiosk Workflow (`ShowQRScan` Module)

This document details the architecture and workflow of the Kiosk Attendance scanner. What was once a monolithic `ShowQRScan.tsx` file has been completely refactored into a modular, maintainable structure inside `src/screens/attendance/`.

## 📂 Architecture & File Linking

For backward compatibility, `App.tsx` still imports `ShowQRScan`. However, `ShowQRScan.tsx` acts simply as a proxy re-export:
`export { default } from './attendance';`

The actual logic resides in the `attendance/` directory:

```text
src/screens/attendance/
├── index.tsx          # Orchestrator Component (Replaces old ShowQRScan.tsx)
├── useAttendance.ts   # Core Business Logic Hook (State machine, APIs, Camera)
├── QRScanView.tsx     # UI Component: Step 1 (QR Scanning)
├── FaceScanView.tsx   # UI Component: Step 2 (Face Scanning & Liveness)
├── ResultModal.tsx    # UI Component: Success/Error Feedback Modal
├── styles.ts          # Unified Stylesheet
└── types.ts           # Shared TypeScript interfaces & types
```

---

## ⚙️ Component Breakdown

### 1. The Orchestrator (`index.tsx`)
This is the entry point. Its primary responsibilities are:
- Requesting Camera Permissions.
- **Dynamic Orientation Locking:** Automatically locks the screen orientation based on device size (Portrait for phones, Landscape for tablets) to prevent native Android camera orientation bugs.
- **View Switching:** 
  - Renders `QRScanView` initially.
  - Switches to `FaceScanView` once `qrVerified` becomes `true`.
- Rendering the `ResultModal` for any UI alerts.

### 2. Core Logic Hook (`useAttendance.ts`)
This custom hook holds the entire state machine and side-effects. It keeps the UI components purely presentational.
- **QR Processing:** Configures the Vision Camera `useCodeScanner`. Validates the scanned QR via the `/resolve_qr.php` backend endpoint (or offline cache).
- **Liveness Detection:** Configures a `useFrameProcessor` (running on UI thread via Worklets) that leverages `react-native-vision-camera-face-detector` to ensure the user is present and verified via the Active Eye Blink state machine.
- **Face Verification:** Once stability and blink liveness pass, captures the face, applies dynamic crop padding, and runs on-device ONNX inference to generate a 512-dim embedding. Embedding comparison is executed online via `/verify_embedding.php` or offline via `verifyFaceLocal()`.
- **Attendance Recording:** Submits verified clock-ins/outs to `/record_attendance.php`, or saves them to an Async Queue if Offline Mode is active.
- **Touchless Mode:** Automatically triggers face capture and logs attendance without user touch once face readiness reaches $\ge 65\%$ and liveness is passed.

### 3. Step 1: QR Code Scanner (`QRScanView.tsx`)
- Pure UI component. 
- Displays the camera preview using `StyleSheet.absoluteFillObject` with `resizeMode="cover"` and `outputOrientation="device"`.
- Contains the Top Header with dynamic time formatting (12-hour AM/PM format) and the offline/online toggle.

### 4. Step 2: Face Scanner (`FaceScanView.tsx`)
- Pure UI component activated after a successful QR read.
- **Responsive Layout Engine:**
  - **Phones (Portrait):** Displays a full-screen camera with a compact overlay bar containing the user's name, role, and profile picture.
  - **Tablets (Landscape):** Displays a 40/60 Split-Screen layout. The left side (40%) shows detailed profile information, and the right side (60%) holds the active camera frame.
- Displays visual liveness instructions ("Position your face", "Smile", etc.) and an animated scanning line.

---

## 🔄 The User Workflow

1. **Initialization:** The user opens the Attendance scanner. The `index.tsx` component mounts, locking the orientation perfectly for their device. `QRScanView` is shown.
2. **QR Scan (Step 1):** The user holds their personal QR code up to the camera.
   - `handleBarcodeScanned` fires in the hook.
   - API is called to validate the QR data.
   - The user's ID, Name, Role, Profile Picture, and current Clock-In Status are cached in local state.
   - `qrVerified` is set to `true`.
3. **Face Scan (Step 2):** The UI seamlessly transitions to `FaceScanView`.
   - The frame processor scans for face box stability (readiness).
   - In standard mode, a countdown begins; in touchless mode, the countdown is bypassed.
4. **Verification & Liveness:**
   - The user completes the Active Eye Blink sequence (State 0 → 3) to pass liveness.
   - Once liveness is passed and stability checks are met, a high-resolution photo is captured and cropped natively.
   - Preprocessing transforms pixels to a CHW Float32 tensor, and ONNX Runtime infers a 512-dim embedding.
   - This embedding is compared to stored templates online via `/verify_embedding.php` or locally.
5. **Completion:**
   - If successful, the attendance is recorded (Clock In or Clock Out) and the `ResultModal` displays a success message.
   - State is reset automatically, bringing the kiosk back to Step 1 (`QRScanView`) for the next employee in line.
