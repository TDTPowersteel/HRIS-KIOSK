# Offline Sync and Scanner Flow

## 1. History Button (Scanner Header)
- The history icon beside the back button in Attendance Scanner opens the Offline list screen.
- Routing path:
  - `App.tsx` (`screen === 'qr'` -> `onOpenOffline={() => setScreen('offline')}`)
  - `src/screens/attendance/index.tsx` passes `onOpenOffline`
  - `src/screens/attendance/QRScanView.tsx` and `FaceScanView.tsx` call `onOpenOffline` on history button press

## 2. Offline List and Sync
- Screen: `src/screens/OfflineSync.tsx`
- Data source: `src/utils/offlineAttendance.ts` (`offline_attendance_queue` in AsyncStorage)
- Tabs:
  - **Wait to Sync** = `pending`
  - **Sync Failed** = `failed`
- `SYNC NOW` behavior:
  - Sends each queued item to `record_attendance.php`
  - Success: removes item from queue
  - Failure: marks item as `failed` with error message

## 3. Current Auto Online/Offline Logic
- Core logic: `src/screens/attendance/useAttendance.ts`
- Status badge in scanner is display-only (`ONLINE`/`OFFLINE`).
- App auto-switches to offline when:
  - periodic connectivity probe fails, or
  - live QR/attendance request fails due to connectivity.
- App switches back online when backend probe succeeds.
- When network drops, scanner shows no-internet notification and queues attendance offline.

## 4. Why QR Scan Can Fail While Offline
Offline QR scan works only if user data for that QR can be resolved from local cache (`offline_user_cache_v1`):
- Local resolver: `resolveOfflineUserFromQr(...)` in `src/utils/offlineUsers.ts`
- It can match by:
  - exact QR string (`qrCode`)
  - parsed `LOG_ID`
  - parsed `USER`

If none match, scanner throws:
- `Offline mode needs a previously cached employee list for this QR code.`

### Common causes
1. Device has no cached employee list yet (first run while already offline).
2. Employee record was not cached before internet loss.
3. QR format does not include `LOG_ID` or `USER`, and exact QR value is not in cached `qrCode`.
4. Backend `employees.php` data did not provide a matching QR for that user.

## 5. Operational Note
- For reliable offline QR scanning, the device must connect online at least once to populate/refresh cache before going offline.
