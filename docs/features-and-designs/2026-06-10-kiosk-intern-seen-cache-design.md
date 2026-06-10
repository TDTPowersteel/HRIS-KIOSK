# Spec: HRIS-KIOSK Intern List Caching & Startup Mode Alignment

## Goal
Fix the deduplication seen key logic to support string-based intern IDs, enable on-demand caching of intern QR profiles when successfully verified online, and fetch `kiosk_mode` immediately on app startup.

---

## 1. Frontend Deduplication & Cache Corrections

### 1.1 `EmployeeProfileData.tsx`
- **seen deduplication:** Update `setUniqueEmployees()` to use string keys (`String(emp.emp_id)`) instead of casting to `Number()`, which results in `NaN` for intern string IDs and filters them out.
- **Bootstrap Cache Mapper:** Map cache identifiers as strings instead of running `parseInt(u.empId)` or `parseInt(u.userId)`.
- **First Open Sync:** On bootstrap, ensure that when loading the intern list, it immediately caches fetched rows in the offline user cache using `updateOfflineUserCacheFromEmployees`.

### 1.2 `useAttendance.ts` (Scanner On-Demand Cache)
- When resolving a QR code successfully online, invoke `upsertOfflineUserCacheUser(...)` for the resolved intern details, matching the employee on-demand caching behavior.

### 1.3 `App.tsx` (Immediate Startup Fetch)
- In the entry point `useEffect`, perform a fetch to `${BACKEND_URL}/settings.php` immediately on mount to read the active `kiosk_mode` and set it in state and MMKV, ensuring directory titles match the backend immediately on launch.
