# Touchless Motion-Detection Auto-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent blurry face captures during Kiosk auto-attendance by gating the capture trigger until the face has remained completely motionless for at least 800ms.

**Architecture:** We will compute translation, scale, and head rotation deltas inside the frame processor worklet. If these exceed a 1.5% distance/scale shift or a 2.5-degree rotation delta, the face is marked in motion, and we instantly reset the stable face frames counter to `0`.

**Tech Stack:** React Native, Vision Camera V3, Worklets / Reanimated Shared Values.

---

### Task 1: Add Shared Values for Face Rotation History

**Files:**
* Modify: `src/screens/attendance/useAttendance.ts` (around line 320-330)

- [ ] **Step 1: Declare the rotation history shared values**
  Add the three new shared values to track yaw, pitch, and roll orientation history right under `hasTrackedFace`:
  ```typescript
  const lastTrackedFaceX = useSharedValue(0);
  const lastTrackedFaceY = useSharedValue(0);
  const lastTrackedFaceW = useSharedValue(0);
  const lastTrackedFaceH = useSharedValue(0);
  const hasTrackedFace = useSharedValue(false);
  const lastTrackedFaceYaw = useSharedValue(0);
  const lastTrackedFacePitch = useSharedValue(0);
  const lastTrackedFaceRoll = useSharedValue(0);
  ```

- [ ] **Step 2: Verify TypeScript compilation**
  Run: `npx tsc --noEmit`
  Expected: Command finishes successfully with no compilation errors.

---

### Task 2: Implement Motion Detection Delta Checks inside `frameProcessor`

**Files:**
* Modify: `src/screens/attendance/useAttendance.ts` (around line 1840-1860)

- [ ] **Step 1: Compute translation, scale, and rotation deltas**
  Insert the delta computation and motion checks inside `frameProcessor` right after updating `hasTrackedFace.value = true`:
  ```typescript
      let isMoving = false;
      if (trackedFace) {
        const yaw = trackedFace.sourceFace?.yawAngle ?? trackedFace.sourceFace?.eulerY ?? trackedFace.sourceFace?.headEulerAngleY ?? 0;
        const pitch = trackedFace.sourceFace?.pitchAngle ?? trackedFace.sourceFace?.eulerX ?? trackedFace.sourceFace?.headEulerAngleX ?? 0;
        const roll = trackedFace.sourceFace?.rollAngle ?? trackedFace.sourceFace?.eulerZ ?? trackedFace.sourceFace?.headEulerAngleZ ?? 0;

        if (hasTrackedFace.value) {
          const currentCenterX = trackedFace.box.x + trackedFace.box.width / 2;
          const currentCenterY = trackedFace.box.y + trackedFace.box.height / 2;
          const prevCenterX = lastTrackedFaceX.value + lastTrackedFaceW.value / 2;
          const prevCenterY = lastTrackedFaceY.value + lastTrackedFaceH.value / 2;

          const dx = currentCenterX - prevCenterX;
          const dy = currentCenterY - prevCenterY;
          const dw = trackedFace.box.width - lastTrackedFaceW.value;
          const dh = trackedFace.box.height - lastTrackedFaceH.value;

          const movementDistance = Math.sqrt(dx * dx + dy * dy);
          const sizeChange = Math.sqrt(dw * dw + dh * dh);
          
          const dYaw = Math.abs(yaw - lastTrackedFaceYaw.value);
          const dPitch = Math.abs(pitch - lastTrackedFacePitch.value);
          const dRoll = Math.abs(roll - lastTrackedFaceRoll.value);

          if (movementDistance > 0.015 || sizeChange > 0.015 || dYaw > 2.5 || dPitch > 2.5 || dRoll > 2.5) {
            isMoving = true;
          }
        }

        lastTrackedFaceX.value = trackedFace.box.x;
        lastTrackedFaceY.value = trackedFace.box.y;
        lastTrackedFaceW.value = trackedFace.box.width;
        lastTrackedFaceH.value = trackedFace.box.height;
        lastTrackedFaceYaw.value = yaw;
        lastTrackedFacePitch.value = pitch;
        lastTrackedFaceRoll.value = roll;
        hasTrackedFace.value = true;
      }
  ```

- [ ] **Step 2: Verify TypeScript compilation**
  Run: `npx tsc --noEmit`
  Expected: Command finishes successfully with no compilation errors.

---

### Task 3: Update Face Stability Readiness Logic

**Files:**
* Modify: `src/screens/attendance/useAttendance.ts` (around line 1860-1880)

- [ ] **Step 1: Enforce `!isMoving` in `isUsable` check and reset on motion**
  Update the face usability checks inside the frame processor to gate stable frames, resetting to `0` instantly on motion:
  ```typescript
      if (workletPhase.value === 0) {
        const isUsable = detectedFace && isFaceBoxUsableForRecognition(detectedFace.box, detectedFace.sourceFace) && !isMoving;
        if (isUsable) {
          stableFaceFrames.value = Math.min(stableFaceFrames.value + 1, CAMERA_VISION_STABLE_FACE_FRAMES);
        } else {
          stableFaceFrames.value = 0; // Instant reset on motion or tracking loss
        }
  ```

- [ ] **Step 2: Verify TypeScript compilation**
  Run: `npx tsc --noEmit`
  Expected: Command finishes successfully with no compilation errors.
