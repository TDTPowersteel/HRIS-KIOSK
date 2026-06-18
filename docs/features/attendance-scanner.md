# Attendance Scanner

The **Attendance Scanner** is the primary core feature of the HRIS Kiosk system. It combines a QR scanner and a biometric face verification engine to securely clock employees and interns in and out of the facility.

## 1. Scanner Workflow

1. **QR Scanning (Step 1)**: The user presents their unique company-issued QR Code (e.g. `TDTPWR26` or `TDTINTRN42`) to the tablet camera.
2. **Identification**: The system queries the local cache (if offline) or the backend server (if online) to pull the user's name, department, role, profile picture, and current clock-in status.
3. **Face Verification (Step 2)**: The screen transitions to the Camera Vision module. The user aligns their face inside the bounding box and follows the liveness prompts (e.g., "Please Blink").
4. **Transaction Logging**: Once the face matches the stored biometric `face_embedding_large` (via Server Mode) or local `face_embedding` (via Local Mode), the system successfully logs the attendance entry.

## 2. Low-Spec Optimization

The scanner UI was heavily optimized to run smoothly on low-spec hardware like the **Samsung Galaxy Tab A7 Lite**:
* **Bystander Face Discarding**: The scanner ignores faces of other people walking in the background and only renders tracking telemetry for the primary target face.
* **Server-Side AI Verification**: Face embedding extraction is seamlessly offloaded to the Python backend server (`buffalo_l` model) over Wi-Fi, saving the tablet from heavy CPU calculations.
* **Hardware-Accelerated Cropping**: The Kiosk leverages `expo-image-manipulator` to perform native C++ image cropping before sending it to the server.

## 3. Detailed Architecture

For an in-depth technical explanation of the codebase, React component orchestrator (`index.tsx`), and the React hooks driving the state machine (`useAttendance.ts`), please read:
**[Attendance Scanner Architecture](../architecture/attendance-scanner-architecture.md)**
