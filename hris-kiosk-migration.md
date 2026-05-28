# HRIS Kiosk — Migration Plan: MobileFaceNet → buffalo_sc
### Role: Face Verification (Attendance Check-In)

---

## What This App Does

The HRIS Kiosk is responsible for **verifying employee faces** at check-in. It continuously scans the camera, waits for a stable frontal face, runs a single verification against all stored employee embeddings, and displays a pass/fail result.

---

## Overview

| | Before | After |
|---|---|---|
| **Model** | MobileFaceNet (softmax-trained) | buffalo_sc (MobileFaceNet + ArcFace loss) |
| **Embedding dims** | 128 or 512 (varies) | 512 (fixed) |
| **LFW accuracy** | ~96–98% | 99.70% |
| **Model size** | varies | ~16 MB |
| **Runtime** | varies | onnxruntime-react-native |
| **Trigger** | button or every frame | auto after 5 stable frames |
| **Similarity** | uncalibrated | cosine similarity, threshold 0.28 |

---

## Verification Flow

```
Vision Camera (frame processor, always running)
        ↓
Face quality check per frame (yaw < 15°, pitch < 15°, size > 100px)
        ↓
Accumulate stable frames (need 5 consecutive passing frames)
        ↓
Auto-trigger: take photo
        ↓
Crop face → resize to 112×112
        ↓
Normalize: (pixel - 127.5) / 128.0 → CHW Float32 tensor
        ↓
buffalo_sc ONNX → 512-dim live embedding
        ↓
Compare against all stored employee embeddings (cosine similarity)
        ↓
Best match ≥ 0.28 → ✓ Welcome {name}
Best match < 0.28 → ✗ Face not recognized
        ↓
Display result 3 seconds → auto reset → scan again
```

---

## Step 0 — Prerequisites

### Install Packages

```bash
npm install onnxruntime-react-native
npm install jpeg-js
npm install base-64
npm install expo-image-manipulator
npm install @react-native-async-storage/async-storage
```

For iOS:
```bash
cd ios && pod install
```

### Download the Model

Get `w600k_mbf.onnx` from InsightFace:
- https://github.com/deepinsight/insightface/releases
- Or HuggingFace: search `buffalo_sc w600k_mbf.onnx`
- File size: ~16 MB

> **Same model file as the HRIS App.** If you have a shared assets pipeline, you only need to manage one copy.

### Bundle the Model

**Android** — place in:
```
android/app/src/main/assets/w600k_mbf.onnx
```

**iOS** — add to Xcode:
1. Drag `w600k_mbf.onnx` into Xcode project
2. Check "Add to target"
3. Verify under Build Phases → Copy Bundle Resources

---

## Step 1 — Face Engine Core Files

Create a `src/faceEngine/` folder with these 4 files. These are **identical** to the HRIS App — copy them over.

### `src/faceEngine/model.ts`

```typescript
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Platform } from 'react-native';

let session: InferenceSession | null = null;

/**
 * Load the buffalo_sc ONNX model once at app startup.
 * Call this in App.tsx useEffect — do not call per-verification.
 */
export async function loadFaceModel(): Promise<void> {
  if (session) return;

  const modelPath =
    Platform.OS === 'android'
      ? 'w600k_mbf.onnx'
      : `${require('../assets/w600k_mbf.onnx')}`;

  session = await InferenceSession.create(modelPath);
  console.log('[FaceEngine] Model loaded');
}

/**
 * Generate a 512-dim embedding from a preprocessed face tensor.
 * Input: Float32Array of shape [1, 3, 112, 112]
 */
export async function getEmbedding(pixels: Float32Array): Promise<Float32Array> {
  if (!session) throw new Error('Model not loaded. Call loadFaceModel() first.');

  const inputTensor = new Tensor('float32', pixels, [1, 3, 112, 112]);
  const result = await session.run({ input: inputTensor });

  // Output key varies by ONNX export version — try both
  const outputKey = result['683'] ? '683' : 'output';
  return result[outputKey].data as Float32Array;
}
```

---

### `src/faceEngine/preprocess.ts`

```typescript
import { decode as atob } from 'base-64';
import jpeg from 'jpeg-js';

/**
 * Decode a base64 JPEG (112x112) into raw RGBA pixel array.
 */
export function base64ToPixels(base64: string): Uint8Array {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const decoded = jpeg.decode(binary, { useTArray: true });
  return decoded.data; // RGBA uint8, length = 112 * 112 * 4
}

/**
 * Convert RGBA pixels to CHW Float32 tensor normalized to [-1, 1].
 *
 * buffalo_sc requirements:
 *   - Color order: RGB (not BGR)
 *   - Layout: CHW (channels first, not HWC)
 *   - Normalization: (pixel - 127.5) / 128.0
 */
export function preprocessFace(rgbaPixels: Uint8Array): Float32Array {
  const size = 112 * 112;
  const tensor = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const r = rgbaPixels[i * 4];
    const g = rgbaPixels[i * 4 + 1];
    const b = rgbaPixels[i * 4 + 2];
    tensor[i]            = (r - 127.5) / 128.0; // R plane
    tensor[size + i]     = (g - 127.5) / 128.0; // G plane
    tensor[2 * size + i] = (b - 127.5) / 128.0; // B plane
  }

  return tensor;
}

/** Convenience: base64 JPEG → Float32 tensor ready for the model. */
export function prepareEmbeddingInput(base64Image: string): Float32Array {
  const pixels = base64ToPixels(base64Image);
  return preprocessFace(pixels);
}
```

---

### `src/faceEngine/similarity.ts`

```typescript
/**
 * Cosine similarity between two 512-dim embeddings.
 * Returns a value between -1 and 1. Higher = more similar.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Verify a live embedding against a stored embedding.
 *
 * Threshold guide for buffalo_sc:
 *   0.20 → very lenient  (more false positives)
 *   0.28 → recommended default
 *   0.35 → strict        (more false rejections)
 *
 * Tune after your first real-world test session.
 */
export function verifyFace(
  liveEmbedding: Float32Array,
  storedEmbedding: Float32Array,
  threshold = 0.28
): { verified: boolean; score: number } {
  const score = cosineSimilarity(liveEmbedding, storedEmbedding);
  return { verified: score >= threshold, score };
}
```

---

### `src/faceEngine/crop.ts`

```typescript
import * as ImageManipulator from 'expo-image-manipulator';

interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop photo to face region with padding, then resize to 112×112.
 * Returns base64 JPEG string.
 */
export async function cropFaceTo112(
  photoPath: string,
  bounds: FaceBounds,
  photoWidth: number,
  photoHeight: number
): Promise<string> {
  const pad = 0.25;
  const padX = bounds.width * pad;
  const padY = bounds.height * pad;

  const x = Math.max(0, bounds.x - padX);
  const y = Math.max(0, bounds.y - padY);
  const w = Math.min(photoWidth - x, bounds.width + padX * 2);
  const h = Math.min(photoHeight - y, bounds.height + padY * 2);

  const result = await ImageManipulator.manipulateAsync(
    photoPath,
    [
      { crop: { originX: x, originY: y, width: w, height: h } },
      { resize: { width: 112, height: 112 } },
    ],
    { format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!result.base64) throw new Error('Failed to crop face image');
  return result.base64;
}
```

---

## Step 2 — Storage Module

The Kiosk **reads** employee embeddings registered by the HRIS App. It does not write new registrations.

### `src/storage/faceStorage.ts`

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hris_registered_faces';

export interface RegisteredFace {
  employeeId: string;
  employeeName: string;
  embedding: number[];    // 512 floats as plain array
  captureCount: number;
  registeredAt: string;
}

/** Load all registered employee embeddings. */
export async function loadAllFaces(): Promise<RegisteredFace[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Sync embeddings from your backend API.
 * Call this on kiosk startup and periodically (e.g. every 30 min)
 * so new registrations from the HRIS App are picked up.
 */
export async function syncFacesFromBackend(
  apiUrl: string,
  token: string
): Promise<void> {
  const response = await fetch(`${apiUrl}/employees/embeddings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error(`Sync failed: ${response.status}`);

  const faces: RegisteredFace[] = await response.json();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
  console.log(`[FaceStorage] Synced ${faces.length} embeddings from backend`);
}
```

---

## Step 3 — Verification Screen

### `src/screens/FaceVerificationScreen.tsx`

```typescript
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';

import { cropFaceTo112 } from '../faceEngine/crop';
import { prepareEmbeddingInput } from '../faceEngine/preprocess';
import { getEmbedding } from '../faceEngine/model';
import { verifyFace } from '../faceEngine/similarity';
import { loadAllFaces, RegisteredFace } from '../storage/faceStorage';

// Show result for this long before auto-resetting
const RESULT_DISPLAY_MS = 3000;
// Require this many consecutive quality-passing frames before verifying
const STABLE_FRAMES_NEEDED = 5;
// Cooldown between verification attempts (ms) — prevents rapid re-triggers
const VERIFY_COOLDOWN_MS = 1500;

interface Props {
  onVerified?: (result: { employee: RegisteredFace; score: number }) => void;
  onFailed?: (result: { bestScore: number }) => void;
}

export function FaceVerificationScreen({ onVerified, onFailed }: Props) {
  const device = useCameraDevice('front');
  const camera = useRef<Camera>(null);

  const [status, setStatus] = useState<'scanning' | 'verifying' | 'success' | 'failed'>('scanning');
  const [feedback, setFeedback] = useState('Look at the camera to check in');
  const [matchedName, setMatchedName] = useState('');
  const [displayScore, setDisplayScore] = useState(0);

  // Refs used inside frame processor worklet (no re-render cost)
  const stableFrames = useRef(0);
  const lastBounds = useRef(null);
  const isVerifying = useRef(false);
  const lastVerifyTime = useRef(0);

  const { detectFaces } = useFaceDetector({ performanceMode: 'accurate' });

  // Frame processor — runs on every camera frame
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    // Skip if a verification is already running
    if (isVerifying.current) return;

    const now = Date.now();
    if (now - lastVerifyTime.current < VERIFY_COOLDOWN_MS) return;

    const faces = detectFaces(frame);

    if (faces.length === 0) {
      stableFrames.current = 0;
      runOnJS(setFeedback)('Look at the camera');
      return;
    }

    if (faces.length > 1) {
      stableFrames.current = 0;
      runOnJS(setFeedback)('One person at a time please');
      return;
    }

    const face = faces[0];
    const yawOk   = Math.abs(face.yawAngle) < 15;
    const pitchOk = Math.abs(face.pitchAngle) < 15;
    const sizeOk  = face.bounds.width > 100;

    if (!sizeOk) {
      stableFrames.current = 0;
      runOnJS(setFeedback)('Move a bit closer');
      return;
    }

    if (!yawOk || !pitchOk) {
      stableFrames.current = 0;
      runOnJS(setFeedback)('Look straight ahead');
      return;
    }

    // Face is stable and well-positioned
    stableFrames.current += 1;
    lastBounds.current = face.bounds;
    runOnJS(setFeedback)('Hold still...');

    if (stableFrames.current >= STABLE_FRAMES_NEEDED) {
      stableFrames.current = 0;
      lastVerifyTime.current = now;
      runOnJS(triggerVerification)();
    }
  }, []);

  async function triggerVerification() {
    if (isVerifying.current || !camera.current || !lastBounds.current) return;

    isVerifying.current = true;
    setStatus('verifying');

    try {
      // 1. Capture photo
      const photo = await camera.current.takePhoto({ quality: 85 });

      // 2. Crop and preprocess
      const base64   = await cropFaceTo112(photo.path, lastBounds.current, 1080, 1920);
      const tensor   = prepareEmbeddingInput(base64);
      const liveEmb  = await getEmbedding(tensor);

      // 3. Compare against all registered employees
      const allFaces = await loadAllFaces();

      if (allFaces.length === 0) {
        setFeedback('No employees registered yet');
        setStatus('scanning');
        isVerifying.current = false;
        return;
      }

      let bestScore = -1;
      let bestMatch: RegisteredFace | null = null;

      for (const face of allFaces) {
        const storedEmb = new Float32Array(face.embedding);
        const { score } = verifyFace(liveEmb, storedEmb);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = face;
        }
      }

      const THRESHOLD = 0.28;

      if (bestMatch && bestScore >= THRESHOLD) {
        // ✓ Verified
        setMatchedName(bestMatch.employeeName);
        setDisplayScore(bestScore);
        setStatus('success');
        onVerified?.({ employee: bestMatch, score: bestScore });

        // Log the attendance check-in here if needed
        // await logAttendance(bestMatch.employeeId);

      } else {
        // ✗ Not recognized
        setDisplayScore(bestScore);
        setStatus('failed');
        onFailed?.({ bestScore });
      }

      // Auto-reset after showing result
      setTimeout(() => {
        setStatus('scanning');
        setFeedback('Look at the camera to check in');
        isVerifying.current = false;
      }, RESULT_DISPLAY_MS);

    } catch (err) {
      console.error('[Verification] Error:', err);
      setStatus('scanning');
      setFeedback('Error — please try again');
      isVerifying.current = false;
    }
  }

  return (
    <View style={styles.container}>
      {/* Camera — paused during result display to save battery */}
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device!}
        isActive={status === 'scanning'}
        photo={true}
        frameProcessor={frameProcessor}
      />

      {/* Oval face guide — changes color on result */}
      <View style={[
        styles.oval,
        status === 'success' && styles.ovalSuccess,
        status === 'failed'  && styles.ovalFailed,
      ]} />

      {/* Scanning state */}
      {status === 'scanning' && (
        <View style={styles.feedbackBar}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}

      {/* Verifying state */}
      {status === 'verifying' && (
        <View style={styles.resultOverlay}>
          <ActivityIndicator size="large" color="white" />
          <Text style={styles.resultText}>Verifying...</Text>
        </View>
      )}

      {/* Success state */}
      {status === 'success' && (
        <View style={[styles.resultOverlay, styles.successOverlay]}>
          <Text style={styles.resultIcon}>✓</Text>
          <Text style={styles.resultTitle}>Welcome!</Text>
          <Text style={styles.resultName}>{matchedName}</Text>
          <Text style={styles.resultScore}>
            Match confidence: {(displayScore * 100).toFixed(1)}%
          </Text>
        </View>
      )}

      {/* Failed state */}
      {status === 'failed' && (
        <View style={[styles.resultOverlay, styles.failedOverlay]}>
          <Text style={styles.resultIcon}>✗</Text>
          <Text style={styles.resultTitle}>Not Recognized</Text>
          <Text style={styles.resultSubtitle}>Please try again or see HR</Text>
          <Text style={styles.resultScore}>
            Best score: {(displayScore * 100).toFixed(1)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  oval: {
    position: 'absolute', top: '15%', alignSelf: 'center',
    width: 230, height: 290, borderRadius: 115,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
  },
  ovalSuccess: { borderColor: '#22C55E', borderWidth: 5 },
  ovalFailed:  { borderColor: '#EF4444', borderWidth: 5 },

  feedbackBar: {
    position: 'absolute', bottom: 80, left: 0, right: 0,
    alignItems: 'center', paddingHorizontal: 24,
  },
  feedbackText: {
    color: 'white', fontSize: 17, fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)', gap: 10,
  },
  successOverlay: { backgroundColor: 'rgba(22,163,74,0.90)' },
  failedOverlay:  { backgroundColor: 'rgba(220,38,38,0.90)' },

  resultIcon:     { fontSize: 80, color: 'white' },
  resultTitle:    { fontSize: 28, color: 'white', fontWeight: '800' },
  resultName:     { fontSize: 22, color: 'white', fontWeight: '600' },
  resultSubtitle: { fontSize: 16, color: 'rgba(255,255,255,0.85)' },
  resultScore:    { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  resultText:     { fontSize: 18, color: 'white', fontWeight: '600' },
});
```

---

## Step 4 — Initialize Model + Sync at Kiosk Startup

### `App.tsx`

```typescript
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { loadFaceModel } from './src/faceEngine/model';
import { syncFacesFromBackend } from './src/storage/faceStorage';

const API_URL = 'https://your-hris-api.com';
const API_TOKEN = 'your-token-here'; // load from secure storage in production

export default function App() {
  const [ready, setReady] = useState(false);
  const [initMessage, setInitMessage] = useState('Starting up...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function init() {
      try {
        setInitMessage('Loading face engine...');
        await loadFaceModel();

        setInitMessage('Syncing employee data...');
        await syncFacesFromBackend(API_URL, API_TOKEN);

        setReady(true);
      } catch (err) {
        console.error('Init error:', err);
        // Allow kiosk to work offline with locally cached embeddings
        setReady(true);
      }
    }

    init();

    // Re-sync every 30 minutes to pick up new registrations
    const interval = setInterval(() => {
      syncFacesFromBackend(API_URL, API_TOKEN).catch(console.error);
    }, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'red', fontSize: 16 }}>{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator size="large" />
        <Text style={{ fontSize: 15, color: '#444' }}>{initMessage}</Text>
      </View>
    );
  }

  return <FaceVerificationScreen />;
}
```

---

## Step 5 — Threshold Tuning

Run this test before going live. Takes ~20 minutes with real employees.

```
1. Register 5–10 employees using the HRIS App (4 captures each)
2. On the Kiosk, have each employee verify themselves 3× each
3. Have 2–3 non-registered people attempt verification

Log the similarity scores printed in the console:
  - True matches typically score > 0.30
  - False attempts typically score < 0.20

Adjust threshold in verifyFace():
  - Getting too many rejections of real employees → lower to 0.24
  - Wrong people are occasionally passing       → raise to 0.33
  - Goal: find a clear gap between the two groups
```

---

## File Structure

```
src/
├── faceEngine/
│   ├── model.ts          ← load ONNX model, run inference
│   ├── preprocess.ts     ← base64 → RGBA → CHW Float32 tensor
│   ├── similarity.ts     ← cosineSimilarity(), verifyFace()
│   └── crop.ts           ← crop photo to 112×112 face region
├── storage/
│   └── faceStorage.ts    ← loadAllFaces(), syncFacesFromBackend()
└── screens/
    └── FaceVerificationScreen.tsx

android/app/src/main/assets/
└── w600k_mbf.onnx

ios/HRISKiosk/
└── w600k_mbf.onnx  (added via Xcode)
```

---

## Migration Checklist

- [ ] Install packages: `onnxruntime-react-native`, `jpeg-js`, `base-64`, `expo-image-manipulator`, `@react-native-async-storage/async-storage`
- [ ] Run `pod install` (iOS)
- [ ] Download `w600k_mbf.onnx` and place in Android assets + iOS Xcode target
- [ ] Create `src/faceEngine/` with all 4 files
- [ ] Create `src/storage/faceStorage.ts`
- [ ] Replace old verification screen with `FaceVerificationScreen`
- [ ] Add backend sync to `App.tsx` startup
- [ ] Initialize model in `App.tsx` on startup
- [ ] Remove old MobileFaceNet model file and old verification code
- [ ] Test: registered employees pass, unknown people fail
- [ ] Run threshold tuning session and adjust if needed

---

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Model fails on Android | Wrong asset path | File must be in `android/app/src/main/assets/` |
| Model fails on iOS | Missing from bundle | Add to Xcode → Copy Bundle Resources |
| All scores very low (<0.1) | Wrong normalization | Check `(pixel - 127.5) / 128.0` and CHW layout |
| All scores high regardless of person | Channel order wrong | Confirm RGB not BGR, CHW not HWC |
| Registered employee always fails | Embedding from App uses different crop | Ensure both apps use the same `cropFaceTo112` logic |
| Kiosk verifies too fast / too slow | `STABLE_FRAMES_NEEDED` too low/high | Adjust from 5 up to 8 for stricter quality gate |
| No employees found | Sync didn't run | Check `syncFacesFromBackend` is called and API returns data |
| Output key error | ONNX version mismatch | Try both `'683'` and `'output'` as output key |
