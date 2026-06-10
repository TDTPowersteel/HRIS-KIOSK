 # Kiosk — Face Verification Guide

## Overview

This document covers the complete face verification workflow for the attendance kiosk using **MobileFaceNet** (192-dimensional embeddings) via CameraVision in React Native.

---

## Diagnosing Timeout Failures

If you see repeated logs like:

```
LOG  [CameraVision] Embedding capture attempt 1/4 failed: Face capture timed out.
LOG  [CameraVision] Embedding capture attempt 2/4 failed: Face capture timed out.
```

Work through these root causes in order:

### 1. Face not being detected at all
Add a log immediately after the detection step — before liveness. If detection fails, no embedding capture will ever fire.

### 2. Liveness gate consuming all attempts
If your liveness check and embedding capture share the same 4-attempt timer, a slow liveness check eats all your retries. **Separate them** (see timeouts below).

### 3. Environment mismatch between registration and kiosk
Embeddings registered in bright conditions and verified in dim conditions will have larger cosine distances. Lower your threshold to `0.65` as a starting point.

### 4. Frame not aligned before inference
Passing the full camera frame to MobileFaceNet — instead of a cropped, aligned, 112×112 face region — is the most common source of poor embeddings and matching failures.

---

## Verification Workflow

### Step 1 — Face Detection

- Continuously process camera frames (recommend 10–15 fps for performance)
- Use a lightweight face detector (e.g. BlazeFace or MTCNN) to find the face bounding box
- **Auto-crop and align:**
  1. Take the detected bounding box
  2. Expand by ~20% padding on all sides
  3. Resize cropped region to exactly **112×112 pixels**
  4. Pass aligned crop to MobileFaceNet — not the full frame
- Log detection success/failure separately from embedding capture

**Detection timeout:** 5 seconds. If no face is detected, prompt user to step closer and retry.

---

### Step 2 — Liveness Check (Its in the settings make sure the toggle will still work if its disabled, face verification will be easier but still accurate like it could still face verify an image of a person but it shouldnt verify if its a different person  . )

Run the liveness gate **before** generating the embedding. Two approaches:

| Type | Method | Notes |
|---|---|---|
| **Passive** | Texture analysis / blink detection | Lower friction, works silently |
| **Active** | Prompt for a blink or slight nod | More secure, adds ~2s |

Give liveness its **own timeout** (5s), independent of the embedding capture timeout. Do not let a slow liveness check consume embedding capture attempts.

```
Detection timeout:  5s  (separate)
Liveness timeout:   5s  (separate)
Embedding timeout:  8–10s per attempt
```

---

### Step 3 — Generate Live Embedding

Once a face is detected and liveness passes:

1. Take the aligned 112×112 crop
2. Pass to MobileFaceNet → 192-dim float vector
3. **L2-normalize** the result

```js
function l2Normalize(embedding) {
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map(v => v / norm);
}
```

---

### Step 4 — Cosine Similarity Match

Compare the live embedding against the stored template:

```js
function cosineSimilarity(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
  // Both vectors are L2-normalized, so dot product = cosine similarity
}

const similarity = cosineSimilarity(liveEmbedding, storedTemplate);
```

**Threshold for MobileFaceNet:**

| Score | Decision |
|---|---|
| ≥ 0.75 | ✅ Strong match — log attendance |
| 0.65–0.74 | ⚠️ Weak match — consider retry or secondary check |
| < 0.65 | ❌ No match — deny, offer retry |

> Start at `0.65` if you're experiencing many false rejections, and tighten to `0.70–0.75` once registration quality improves.

---

### Step 5 — Match Decision

**On success (similarity ≥ threshold):**
- Log attendance record with employee ID + timestamp
- Display confirmation UI (name, time, green indicator)
- Reset camera for next user

**On failure:**
- Allow up to **3 retries** before locking out
- After 3 failures, display a fallback option (manual entry, HR assistance)
- Log the failure with the similarity score for debugging

```
Retry flow:
  Attempt 1 → fail → "Please look directly at the camera"
  Attempt 2 → fail → "Ensure good lighting, remove glasses if worn"
  Attempt 3 → fail → "Verification failed. Please see HR or use manual login."
```

---

## Debugging Checklist

Use this when verification is failing consistently:

- [ ] Is the face bounding box being detected? (log it)
- [ ] Is the crop being resized to 112×112 before inference?
- [ ] Is the live embedding being L2-normalized?
- [ ] Is the stored embedding L2-normalized?
- [ ] What is the actual cosine similarity score? (log it)
- [ ] Is the liveness check timing out before embedding fires?
- [ ] Was registration done under similar lighting to the kiosk?
- [ ] Is the similarity threshold too tight for your conditions?

---

## Environment Recommendations

- **Lighting:** Consistent, warm front-facing light at the kiosk. Avoid windows behind the user (backlighting) or direct overhead fluorescent glare.
- **Camera height:** Eye-level or slightly below (avoid steep downward angles).
- **Camera distance:** 40–60 cm — use UI prompts to guide the user to the correct distance.
- **Background:** Non-reflective surface behind the kiosk camera.
- **Calibration:** If possible, register at least one test face under kiosk lighting conditions and verify the similarity score before deploying to users.

---

## Similarity Score Log (recommended)

Always log the similarity score during development and QA:

```js
console.log(`[FaceVerify] Employee: ${employeeId} | Score: ${similarity.toFixed(4)} | Result: ${similarity >= threshold ? 'PASS' : 'FAIL'}`);
```

This lets you tune your threshold based on real-world data from your specific camera, lighting, and user population.
