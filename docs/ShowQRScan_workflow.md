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
- **Liveness Detection:** Configures a `useFrameProcessor` (running on UI thread via Worklets) that leverages `react-native-vision-camera-face-detector` to ensure the user is present (e.g., checking if eyes are open).
- **Face Verification:** Once liveness triggers, takes two photos with a 600ms burst delay (to prevent frame duplication on slower tablet hardware) and submits them via multipart/form-data to `/verify.php`.
- **Attendance Recording:** Submits verified clock-ins/outs to `/record_attendance.php`, or saves them to an Async Queue if Offline Mode is active.
- **Touchless Mode:** Handles the timer-based auto-clock-out for employees that just want to scan a QR to logout without touching the screen.

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
   - A 3-second countdown begins.
   - The Frame Processor actively hunts for a face and monitors for liveness (eye blinks/open probabilities).
4. **Verification & Liveness:**
   - Once liveness is confirmed by the Frame Processor, `onLivenessDetected` is triggered.
   - The app plays a shutter sound and captures two distinct photos.
   - The photos are sent to the `Face++ API` via the PHP backend to confirm the user's identity matches the profile picture bound to the scanned QR code.
5. **Completion:**
   - If successful, the attendance is recorded (Clock In or Clock Out) and the `ResultModal` displays a success message.
   - State is reset automatically, bringing the kiosk back to Step 1 (`QRScanView`) for the next employee in line.
