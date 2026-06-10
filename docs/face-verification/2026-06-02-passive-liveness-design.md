# Passive Liveness Verification Integration

## Purpose
Make the face verification process faster while maintaining security against printed photos. Replaces the active, slow "blink/smile" prompt with a passive micro-variance check during the camera tracking phase. Keeps the existing settings toggle so users can completely disable liveness for maximum speed.

## Approach
1. **Passive Liveness**: 
   - Instead of entering a dedicated active liveness phase (Phase 2), the system will track telemetry (yaw, pitch, eye open probabilities) during the existing `CAMERA_VISION_STABLE_FACE_FRAMES` (8 frames) wait period.
   - We will calculate the variance (max - min) of these values.
   - If variance is near 0 across 8 frames, the subject is deemed a static image (spoof).
   - If variance is above a threshold, the subject is deemed live.
2. **Settings Toggle**: 
   - Retain the `LivenessCheckFeature` toggle in Settings.
   - If toggle is ON, the passive variance check must pass before capture. If it fails, prompt the user "Hold still but act natural (blink/move slightly)" and keep tracking.
   - If toggle is OFF, bypass variance check and trigger capture as soon as frames are stable.
3. **Remove Old Code**: 
   - Delete the `blinkState` worklet logic, active liveness prompts, and two-step verification sequence from `useAttendance.ts`.

## Components
- `useAttendance.ts`: 
  - Add `SharedValues` for telemetry history (arrays of last 8 frames).
  - Update `frameProcessor` to push telemetry to arrays.
  - Compute variance inside `onFaceDetectedForIdentity` (or before triggering it).
  - Modify `handleAttendance` to skip old Phase 2 and directly `executeFaceVerification()`.
- `Settings`: Keep `LivenessCheckFeature` unchanged.

## Data Flow
- Frame Processor -> Update Telemetry History Array (Yaw, Pitch, Eye).
- Stable frames reached -> Check `sharedLivenessEnabled.value`.
- If enabled -> Check history variance. If pass -> Trigger `executeFaceVerification()`.
- If disabled -> Trigger `executeFaceVerification()`.
