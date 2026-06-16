# Design Specification: Touchless Motion-Detection Auto-Capture

* **Author**: Antigravity (AI Coding Assistant)
* **Date**: 2026-06-15
* **Target Project**: HRIS Kiosk Attendance Screen

---

## 1. Problem Statement
In the touchless (auto-capture) verification flow of the Kiosk attendance app, a user walking up to the camera or moving their head can trigger face capture *in motion*. This causes motion blur, which significantly degrades the quality of the captured photo and results in a high rate of face verification failures.

To address this, we must gate the auto-capture trigger so that it only executes when the face has remained completely still for a stable window (~800ms).

---

## 2. Proposed Solution: Hybrid Motion Tracking
We will implement real-time translation, scale, and rotation delta tracking inside the high-performance frame processor worklet. If movement exceeds the specified thresholds between consecutive processed frames (at ~10 FPS), the face is marked as "in motion" and the stable frames counter is reset to `0`.

### 2.1 Motion Detection Metrics
1. **Translation (Position shift)**:
   We track the center $(X_{\text{center}}, Y_{\text{center}})$ of the normalized face bounding box:
   $$X_{\text{center}} = X + \frac{W}{2}$$
   $$Y_{\text{center}} = Y + \frac{H}{2}$$
   $$\Delta \text{pos} = \sqrt{(X_{\text{center}} - X_{\text{prevCenter}})^2 + (Y_{\text{center}} - Y_{\text{prevCenter}})^2}$$
   *Threshold*: $\Delta \text{pos} > 0.015$ (1.5% of frame dimensions)

2. **Scaling (Distance change)**:
   We track the bounding box size:
   $$\Delta \text{size} = \sqrt{(W - W_{\text{prev}})^2 + (H - H_{\text{prev}})^2}$$
   *Threshold*: $\Delta \text{size} > 0.015$ (1.5% of frame dimensions)

3. **Rotation (Pose shift)**:
   We track the yaw, pitch, and roll euler angles:
   $$\Delta \text{yaw} = |\text{yaw} - \text{yaw}_{\text{prev}}|$$
   $$\Delta \text{pitch} = |\text{pitch} - \text{pitch}_{\text{prev}}|$$
   $$\Delta \text{roll} = |\text{roll} - \text{roll}_{\text{prev}}|$$
   *Threshold*: $\Delta \text{yaw} > 2.5^\circ \text{ or } \Delta \text{pitch} > 2.5^\circ \text{ or } \Delta \text{roll} > 2.5^\circ$

---

## 3. Detailed Architecture

### 3.1 New Shared Values
We will add three new Worklet shared values to track the head rotation from the previous frame:
```typescript
const lastTrackedFaceYaw = useSharedValue(0);
const lastTrackedFacePitch = useSharedValue(0);
const lastTrackedFaceRoll = useSharedValue(0);
```

### 3.2 Detection Flow (inside `frameProcessor` worklet)
1. **Fetch Current Pose Angles**:
   ```typescript
   const yaw = face?.yawAngle ?? face?.eulerY ?? face?.headEulerAngleY ?? 0;
   const pitch = face?.pitchAngle ?? face?.eulerX ?? face?.headEulerAngleX ?? 0;
   const roll = face?.rollAngle ?? face?.eulerZ ?? face?.headEulerAngleZ ?? 0;
   ```
2. **Calculate Deltas**:
   If a previous face was successfully tracked (`hasTrackedFace.value === true`), compute:
   * `dx`, `dy` (translation deltas)
   * `dw`, `dh` (size deltas)
   * `dYaw`, `dPitch`, `dRoll` (rotation deltas)
3. **Compare against thresholds**:
   If translation $> 0.015$ OR scale change $> 0.015$ OR rotation change $> 2.5$, flag `isMoving = true`.
4. **Update Previous Values**:
   Store the current frame coordinates and euler angles into the respective shared values.
5. **Gating `isUsable`**:
   The `isUsable` condition for incrementing `stableFaceFrames` will be updated to:
   ```typescript
   const isUsable = detectedFace && 
                    isFaceBoxUsableForRecognition(detectedFace.box, detectedFace.sourceFace) && 
                    !isMoving;
   ```
6. **Fast Reset on Motion**:
   If `isUsable` is false, instead of a slow decay, we instantly reset the stable counter to ensure absolute stillness is rebuilt from scratch:
   ```typescript
   stableFaceFrames.value = 0;
   ```

---

## 4. Testing & Verification Plan
1. **Typescript Check**: Run `npx tsc --noEmit` to ensure type safety.
2. **Readiness Responsiveness Test**: Verify that moving the head or sliding side-to-side drops the readiness indicator in the Kiosk UI back to `0%` instantly.
3. **Shutter Stability Test**: Verify that the camera never flashes or triggers auto-capture while the user is walking towards the tablet or shaking their head.
