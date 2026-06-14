# Kiosk First-Load Sync & Warmup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a background sync on app boot to populate the offline cache, trigger early face verification engine warmup on mount, and dynamically swap target face embeddings on-the-fly when a user has re-registered.

**Architecture:** 
1. Add a warmup interceptor in `verify_embedding.php` that forwards a mock crop to the Python ML server.
2. Add a startup `useEffect` in `App.tsx` that triggers both the full directory background sync and the API warmup request after a 3-second delay.
3. Update the background QR resolution promise handler in `useAttendance.ts` to swap target embeddings dynamically without resetting the active camera session.

**Tech Stack:** React Native, Expo, MMKV, PHP, Python ML (InsightFace)

---

### Task 1: Warmup Interceptor in PHP Backend

**Files:**
- Modify: `backend-php/verify_embedding.php`

- [ ] **Step 1: Add Warmup Bypass Guard**

  In `backend-php/verify_embedding.php`, inspect the incoming `$userId`. If it matches `'warmup'`, forward the request to the Python server (if `$liveImageB64` is provided) and exit immediately with a `200` status code.
  
  Replace lines 27-31:
  ```php
  if (!$userId) {
      http_response_code(400);
      echo json_encode(['ok' => false, 'message' => 'Missing parameter (log_id)']);
      exit;
  }
  ```
  With:
  ```php
  if ($userId === 'warmup') {
      if ($liveImageB64) {
          $ch = curl_init('http://localhost:5001/embed_single');
          curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
          curl_setopt($ch, CURLOPT_POST, true);
          curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['image' => $liveImageB64]));
          curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
          curl_setopt($ch, CURLOPT_TIMEOUT, 3);
          curl_exec($ch);
          curl_close($ch);
      }
      http_response_code(200);
      echo json_encode(['ok' => true, 'message' => 'Warmup completed.']);
      exit;
  }

  if (!$userId) {
      http_response_code(400);
      echo json_encode(['ok' => false, 'message' => 'Missing parameter (log_id)']);
      exit;
  }
  ```

- [ ] **Step 2: Validate PHP Syntax**

  Verify that the code compiles and has no syntax errors.
  
  Run: `php -l backend-php/verify_embedding.php`
  Expected: No syntax errors detected.

---

### Task 2: Startup Boot Sync & Warmup Trigger

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Import Sync Helper**

  Import `refreshOfflineUserCache` from the offline utility module.
  
  Around line 13, add the import:
  ```typescript
  import { refreshOfflineUserCache } from './src/utils/offlineUsers';
  ```

- [ ] **Step 2: Add Startup useEffect**

  Inside `App.tsx` -> the `App` component body, add a `useEffect` that triggers:
  1. A background sync (`refreshOfflineUserCache()`) to populate the cache.
  2. A POST fetch request to `/verify_embedding.php` with `{ log_id: 'warmup', live_image_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }` (a tiny 1x1 transparent PNG base64 crop) to trigger the waitress/cURL warmup.
  
  Place it after the settings fetch `useEffect` (around line 83):
  ```typescript
  useEffect(() => {
    const runStartupTasks = async () => {
      // Delay by 3 seconds to avoid blocking main UI rendering
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('[Startup] Executing background sync...');
      refreshOfflineUserCache()
        .then(users => console.log(`[Startup] Background sync complete. Mapped ${users?.length || 0} users.`))
        .catch(err => console.log('[Startup] Background sync failed (Safe to ignore if offline):', err));

      console.log('[Startup] Triggering server warmup...');
      fetch(`${BACKEND_URL}/verify_embedding.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          log_id: 'warmup',
          live_image_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        })
      })
        .then(res => res.json())
        .then(data => console.log('[Startup] Server warmup response:', data))
        .catch(err => console.log('[Startup] Server warmup request failed:', err));
    };

    runStartupTasks();
  }, []);
  ```

---

### Task 3: Dynamic Embedding Swap on QR Scan

**Files:**
- Modify: `src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Update Background Sync Promise Handler**

  Update the `resolveUserFromQr(data).then(...)` callback inside the QR scan success handler (around line 2015). We want to check if the incoming user profile has a different face embedding than what was loaded from the local cache. If it does, we merge it, write it back to MMKV, and update the active selected user and reference immediately.
  
  In `useAttendance.ts`, modify lines 2015-2043:
  ```typescript
        // Background server sync to correct session state and fetch face data
        resolveUserFromQr(data).then(async (resolved) => {
           let existingSession = null;
           if (!offlineModeEnabled && resolved.open_session) {
             existingSession = {
               clockInTime: resolved.open_session.timein,
               clockInDate: resolved.open_session.date,
             };
           } else {
             existingSession = await getStoredSession(resolved.userId);
           }
           console.log('[QR] Background sync complete. Updated user data for:', resolved.username);
           
           // Update the selected user with the fresh data from the server (including face_embedding)
           setSelectedUser(resolved);
           setWelcomeName(resolved.name || resolved.username || 'Employee');
           setClockInTime(existingSession?.clockInTime || '');
           setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');

           // If touchless is enabled and it's a clock-in, we trigger handleAttendance NOW 
           // because the 600ms timeout above might have already fired with stale data
           // Also trigger if we were waiting for the sync to finish for clock_out
           const isClockOutNow = existingSession ? true : false;
           if (currentSettings.touchless) {
              if ((!isClockOutNow) || (isClockOutNow && shouldWaitSync)) {
                console.log('[QR] Background sync finished. Relying on useEffect for touchless transition.');
              }
           }
        }).catch(e => console.log('[QR] Background sync failed (Safe to ignore if offline)', e));
  ```
  To:
  ```typescript
        // Background server sync to correct session state and fetch face data
        resolveUserFromQr(data).then(async (resolved) => {
           let existingSession = null;
           if (!offlineModeEnabled && resolved.open_session) {
             existingSession = {
               clockInTime: resolved.open_session.timein,
               clockInDate: resolved.open_session.date,
             };
           } else {
             existingSession = await getStoredSession(resolved.userId);
           }
           console.log('[QR] Background sync complete. Updated user data for:', resolved.username);
           
           // Double check if live embedding differs from cached representation to overwrite cache and swap target on-the-fly
           const cacheMatch = cachedUser.face_embedding === resolved.face_embedding;
           if (!cacheMatch) {
             console.log('[QR] Face embedding changed on server. Updating local cache and target Ref.');
             await upsertOfflineUserCacheUser({
               userId: resolved.userId,
               empId: resolved.userId,
               username: resolved.username,
               name: resolved.name ?? null,
               qrCode: data,
               profile_picture: resolved.profile_picture ?? null,
               profile_picture_remote: resolved.profile_picture ?? null,
               role: resolved.role ?? null,
               department: resolved.department ?? null,
               face_embedding: resolved.face_embedding ?? null,
               isIntern: resolved.isIntern,
             });
           }

           // Update the selected user with the fresh data from the server (including face_embedding)
           setSelectedUser(resolved);
           setWelcomeName(resolved.name || resolved.username || 'Employee');
           setClockInTime(existingSession?.clockInTime || '');
           setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');

           // If touchless is enabled and it's a clock-in, we trigger handleAttendance NOW 
           // because the 600ms timeout above might have already fired with stale data
           // Also trigger if we were waiting for the sync to finish for clock_out
           const isClockOutNow = existingSession ? true : false;
           if (currentSettings.touchless) {
              if ((!isClockOutNow) || (isClockOutNow && shouldWaitSync)) {
                console.log('[QR] Background sync finished. Relying on useEffect for touchless transition.');
              }
           }
        }).catch(e => console.log('[QR] Background sync failed (Safe to ignore if offline)', e));
  ```

- [ ] **Step 2: Run Kiosk Tests**

  Verify that the existing test suite still compiles and runs without issues.
  
  Run: `npm run test`
  Expected: All tests pass.
