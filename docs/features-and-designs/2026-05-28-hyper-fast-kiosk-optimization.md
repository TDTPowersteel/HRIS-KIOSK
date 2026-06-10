# Design Spec: Hyper-Fast Kiosk Optimization

## 1. Goal
Reduce the total interaction time for attendance from **~4.5 seconds** to **~1.2 seconds**. This is achieved by eliminating network latency through local embedding caching and optimizing the UI state machine for faster face detection and verification.

## 2. Architecture Changes

### 2.1 Storage Layer: MMKV
Current `AsyncStorage` is a bottleneck for large datasets (50MB+). We will replace it with `react-native-mmkv` for employee records.
- **Lookup Speed:** O(1) direct memory-mapped access.
- **Indexing:** 
    - `user_by_id:[userId]` -> JSON object (User profile + metadata)
    - `user_by_qr:[qrCode]` -> `userId` (Pointer to the main record)
- **Binary Support:** Embeddings will be stored as Base64 strings (or raw ArrayBuffers if MMKV instance allows) to minimize parsing time.

### 2.2 Data Schema Update
The `CachedOfflineUser` type in `src/utils/offlineUsers.ts` will be strictly enforced to include `face_embedding`.
```typescript
export type CachedOfflineUser = {
  userId: string;
  empId: string;
  username: string;
  qrCode: string | null;
  face_embedding: number[] | number[][] | null; // Multi-angle support
  // ... other fields
};
```

## 3. Implementation Details

### 3.1 Timing & Logic Optimizations (`src/screens/attendance/useAttendance.ts`)
| Constant | Current | Optimized | Benefit |
| :--- | :--- | :--- | :--- |
| `CAMERA_VISION_STABLE_FACE_FRAMES` | 5 | **3** | Faster initial face lock-on. |
| `setFaceCountdown` (Touchless) | 2s | **0.5s** | Shorter wait before photo capture. |
| `MODEL_CONFIG.matchThreshold` | 0.82 | 0.82 | (Keep same for accuracy) |

### 3.2 High-Confidence Skip Logic
In the `executeFaceVerification` function:
1. Take the first photo and run inference.
2. If `similarityScore > 0.92`:
    - Immediately trigger `executeAttendanceRecording`.
    - **Skip** taking the second liveness photo.
    - **Skip** the 200ms delay between shots.
3. If `0.82 < similarityScore < 0.92`:
    - Proceed with the standard multi-shot/liveness flow to ensure security.
### 3.3 Background Sync Refinement
`refreshOfflineUserCache` will be modified to:
1. Fetch all employees including embeddings from `/employees.php`.
2. Bulk-write to MMKV.
3. Use `mmkv.set` in a loop (MMKV handles thousands of writes in milliseconds).

## 4. Performance Targets

| Stage | Baseline | Target |
| :--- | :--- | :--- |
| QR Scan to Profile | 500ms (Network) | **< 10ms (Local)** |
| Face Stability Lock | 166ms | **100ms** |
| Pre-capture Countdown | 2000ms | **500ms** |
| Inference & Rec. | 1800ms (Network/2-shot) | **600ms (1-shot skip)** |
| **Total** | **4.46s** | **1.21s** |

## 5. Verification Plan
1. **Load Test:** Cache 1,000 employees with mock embeddings and verify QR lookup remains < 10ms.
2. **Timing Audit:** Use `performance.now()` logs in the `useAttendance` hook to verify the 1.2s total interaction goal.
3. **Accuracy Check:** Ensure skipping the second shot does not increase False Acceptance Rate (FAR) for users with similar features.
