# Passive Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (NOTE: Do NOT use git commands, user has requested to skip git operations).

**Goal:** Implement passive liveness tracking by checking face micro-variance during the stable frames period, falling back to a prompt only if variance is zero, while keeping the main verification logic completely untouched.

**Architecture:** Use Worklets SharedValues arrays to track the last 8 yaw, pitch, and eye openness probabilities inside the frame processor in `src/screens/attendance/useAttendance.ts`. When 8 frames are reached, calculate the delta (max - min) to ensure it's not a static photo.

**Tech Stack:** React Native, react-native-worklets-core, react-native-vision-camera

---

### Task 1: Add Tracking SharedValues and State

**Files:**
- Modify: `src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Write the SharedValues declaration**

Near line 315, where the other `useSharedValue` calls are, add the tracking arrays:

```typescript
  const lastTrackedFaceH = useSharedValue(0);
  const hasTrackedFace = useSharedValue(false);
  
  // PASSIVE LIVENESS HISTORY
  const yawHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0]);
  const pitchHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0]);
  const eyeHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0]);
  const historyIndex = useSharedValue(0);
  const isHumanDetected = useSharedValue(false);
```

- [ ] **Step 2: Update the frameProcessor to record history**

In `useAttendance.ts` inside the `frameProcessor` around line 1450, right after `stableFaceFrames.value = Math.min(...)`, record the telemetry.

```typescript
          const isUsable = detectedFace && isFaceBoxUsableForRecognition(detectedFace.box, detectedFace.sourceFace);
          if (isUsable) {
            stableFaceFrames.value = Math.min(stableFaceFrames.value + 1, CAMERA_VISION_STABLE_FACE_FRAMES);
            
            // Record telemetry for passive liveness
            const faceRaw = trackedFace?.sourceFace;
            const yaw = typeof faceRaw?.yawAngle === 'number' ? faceRaw.yawAngle : 0;
            const pitch = typeof faceRaw?.pitchAngle === 'number' ? faceRaw.pitchAngle : 0;
            const leftEye = faceRaw?.leftEyeOpenProbability ?? 0.5;
            const rightEye = faceRaw?.rightEyeOpenProbability ?? 0.5;
            
            const idx = historyIndex.value % 8;
            yawHistory.value[idx] = yaw;
            pitchHistory.value[idx] = pitch;
            eyeHistory.value[idx] = Math.min(leftEye, rightEye);
            historyIndex.value = historyIndex.value + 1;
            
          } else {
```

### Task 2: Variance Check & Bypass Old Logic

**Files:**
- Modify: `src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Check variance when 8 frames are reached**

Around line 1505 in `useAttendance.ts`, before `onFaceDetectedForIdentity()`:

```typescript
            if (stableFaceFrames.value >= CAMERA_VISION_STABLE_FACE_FRAMES) {
              if (sharedLivenessEnabled.value) {
                // Check variance
                let minY = yawHistory.value[0], maxY = yawHistory.value[0];
                let minP = pitchHistory.value[0], maxP = pitchHistory.value[0];
                let minE = eyeHistory.value[0], maxE = eyeHistory.value[0];
                for (let i = 1; i < 8; i++) {
                  minY = Math.min(minY, yawHistory.value[i]); maxY = Math.max(maxY, yawHistory.value[i]);
                  minP = Math.min(minP, pitchHistory.value[i]); maxP = Math.max(maxP, pitchHistory.value[i]);
                  minE = Math.min(minE, eyeHistory.value[i]); maxE = Math.max(maxE, eyeHistory.value[i]);
                }
                const varY = maxY - minY;
                const varP = maxP - minP;
                const varE = maxE - minE;
                
                // If there's tiny movement, it's live.
                if (varY > 0.05 || varP > 0.05 || varE > 0.01) {
                  isHumanDetected.value = true;
                  onFaceDetectedForIdentity();
                } else {
                  isHumanDetected.value = false;
                  updateLivenessMessage('Static face. Move slightly.');
                }
              } else {
                isHumanDetected.value = true;
                onFaceDetectedForIdentity();
              }
            }
```

- [ ] **Step 2: Bypass old Active Liveness prompts**

Remove the `blinkState` logic from the `handleAttendance` function. Around line 1272:

```typescript
    faceProcessingRef.current = true;

    // Fast track face verification directly (liveness is now passive in tracking phase)
    await executeFaceVerification();
```

And around line 1529, completely remove or comment out the `if (faces.length > 0) { ... workletPhase.value === 2 ... blinkState }` block, as it is no longer needed. Remove the `updateLivenessMessage` prompts from inside that block to prevent state corruption.

### Task 3: Syntax and Logic Verification

- [ ] **Step 1: Run TypeScript type check**

```bash
npm run tsc --noEmit
```
Expected: PASS or unrelated errors only.

- [ ] **Step 2: Start linter on `useAttendance.ts`**

```bash
npx eslint src/screens/attendance/useAttendance.ts
```
Expected: PASS.
