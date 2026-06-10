# Spec: HRIS-KIOSK Intern Mode Enhancements and Sync Alignment

## Goal
Improve and align the Intern Mode behavior in the `HRIS-KIOSK` to match the exact patterns used for employees, including background synchronization, offline caching, dynamic state updates, and timezone-aligned attendance logs.

---

## 1. Backend Changes

### 1.1 `employees.php` (List and Detail Modes)
- **Select All Interns:** Update the select query for the list mode of interns so that *all* active interns are retrieved, regardless of whether they have a face embedding registered.
- **Dynamic Field `kiosk_mode` enforcement:** Include `kiosk_mode` key in *all* response payloads (both list and detail responses) to signal the client React Native app what mode is active.
- **Embed Verification Status:** For list mode, add a lightweight virtual field: `'has_face_registered' => !empty($row['face_embedding'])` so the client knows if an intern is registered without downloading the heavy raw embedding vector.

### 1.2 `resolve_qr.php` & `record_attendance.php`
- **Timezone alignment:** Enforce `date_default_timezone_set('Asia/Manila');` before handling or routing any attendance logs to avoid time drift relative to the client system.
- **Timeout parameters:** Ensure curl options in `record_attendance.php` have a maximum execution timeout of 5 seconds for proxying requests.

---

## 2. Frontend Changes (React Native)

### 2.1 `EmployeeProfileData.tsx`
- **Dynamic Mode Synchronization:** Modify `syncRemainingEmployeesInBackground()` and search fetch functions to parse the `kiosk_mode` property from backend responses. Instantly store it in MMKV and update React state (`kioskMode`) to match the backend.
- **Auto-Sync and Cache:** Use the helper `updateOfflineUserCacheFromEmployees` to write all fetched interns (along with their metadata, username, role, department, and profile pictures) into the local user cache.

### 2.2 `settings/index.tsx`
- **Hide Location Sync Feature:** Wrap the `SyncLocationFeature` row with a conditional expression `kioskMode !== 'intern'`.

### 2.3 `settings/components/EmployeeDetailsModal.tsx`
- **Face Registration status:** Add a colored badge below the profile name:
  - Green Badge: **Face ID Active** (if face embedding or `has_face_registered` is present).
  - Red Badge: **Face ID Not Registered** (if missing).
- **Offline Safety Warn:** Show a soft notification banner if the kiosk is offline and face data is missing from the local cache.

---

## 3. Review Plan
- Every change will be peer-reviewed by specialized subagents to enforce PHP syntax check and React Native runtime safety.
