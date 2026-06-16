# Employee Directory System Documentation

> [!WARNING]
> **FEATURE CURRENTLY DISABLED (COMMENTED OUT)**
> This feature has been safely commented out in `App.tsx` because TDT Powersteel Company currently does not need it, and removing it drastically improves memory and UI performance on the Samsung Galaxy Tab A7 Lite.
> 
> **To re-enable it, uncomment the following in `App.tsx`:**
> *   Line 6: `import EmployeeProfileData from './src/screens/EmployeeProfileData';`
> *   Line 116: `<Stack.Screen name="employees" component={EmployeeProfileData} />`
> *   Line 200: The `<TouchableOpacity>` button routing to `employees` inside the `home` Screen.
This document serves as the comprehensive guide for users, developers, and AI agents on the workflow, logic, architecture, and caching mechanisms of the **Employee Directory** and the **Employee Details Modal** inside the HRIS Kiosk application.

---

## 1. System Overview
The Employee Directory is a critical feature of the HRIS Kiosk. It allows employees to search for colleagues, view roles and departments, and inspect personal attendance records directly on the device. Because the kiosk operates in environments with variable network conditions, the directory uses a **Stale-While-Revalidate (SWR)** architecture backed by a high-performance local key-value store (MMKV) and disk file caching.

---

## 2. Kiosk Directory Workflow (User Perspective)

```
[Main Kiosk Interface]
         │
         ▼
[Employee Directory Screen] ◄─── Instantly loads list from local MMKV Cache
         │
         ├──► Search Input: Filters list dynamically by Name or Role (starts after 300ms debounce)
         ├──► Department Dropdown: Filters list by Department Name
         ├──► Role Dropdown: Filters list by Role Name
         └──► Sort Toggle: Sorts list A-Z or Z-A
         │
         ▼
[Click Employee Card]
         │
         ▼
[Employee Details Modal] ◄────── Instantly displays cached profile details & logs
         │
         ├──► Top-Right Header Spinner: Silent sync fetches latest logs in background
         ├──► Range Filters: 7D / 30D / Custom Month selection
         └──► Status Filters: Filters logs (On Time, Late, Early Out, Overtime, No Out)
```

1. **Entering the Directory:** The user opens the directory, and the list of employees appears instantly. If there is a change on the server (e.g., new employee added), the background worker silently syncs and merges it.
2. **Details Modal:** Clicking on any employee's card opens a profile card displaying details (avatar, name, role, department) and their attendance logs table. 
3. **Filtering and Sorting Logs:** The user can filter logs by ranges (Last 7 Days, Last 30 Days, Specific Month) or status pills (e.g. "Late", "On Time").

---

## 3. Tech Stack & Key Files
* **Local Storage:** `react-native-mmkv` (fast, synchronous C++ storage engine for React Native).
* **File System:** `expo-file-system` (manages high-resolution avatar caching on disk).
* **Framework:** React Native / Expo.
* **Key Files:**
  * [src/screens/EmployeeProfileData.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx): Main directory view, handling list indexing, searching, and background poll.
  * [src/screens/settings/components/EmployeeDetailsModal.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/settings/components/EmployeeDetailsModal.tsx): Pop-up details view containing logs history table and filter rules.
  * [src/utils/offlineUsers.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/utils/offlineUsers.ts): Caching utilities (MMKV reads/writes, background avatar downloader).

---

## 4. Architecture & Logic Details (Programmer & AI Guide)

### A. Data Caching Schema
Data is cached in MMKV under specific key structures:
* **User by ID:** `user_by_id:${userId}` -> Stores a JSON string matching the `CachedOfflineUser` type:
  ```typescript
  type CachedOfflineUser = {
    userId: string;
    empId: string;
    username: string;
    name?: string | null;
    qrCode?: string | null;
    profile_picture?: string | null; // local file:// path once cached
    profile_picture_remote?: string | null; // remote URL
    role?: string | null;
    department?: string | null;
    face_embedding?: string | number[] | number[][] | null;
  };
  ```
* **User by QR Code:** `user_by_qr:${qrCode}` -> Maps a scanned QR code string to a `userId`.
* **Attendance History Logs:** `attendance_history:${employee.emp_id}:${filter}` -> Caches parsed attendance logs array for a specific range filter, e.g., `attendance_history:42:week`.

---

### B. Stale-While-Revalidate (SWR) Engine

#### 1. Employee Directory Sync & Search
* **Fast Display:** During mount, the screen reads all `user_by_id:*` keys via `getOfflineUserCache()`, maps them, and updates the local state `employees`.
* **Silent Network Update:** Simultaneously, a background fetch `fetchEmployees({ showLoading: false, page: 0 })` is triggered.
* **On Network Success:** The fresh batch of users is saved to MMKV. If a profile picture remote URL has changed, it is queued for background download.
* **Dynamic Swap Callback:** The utility calls `onProfileCached(userId, localUri)` once the high-res file is written. The UI component listens to this and dynamically swaps the image URI state in place, preventing visual reloads.
* **Polling:** The directory runs a periodic background poll every 30 seconds to fetch page 0 and fetch updates.
* **Deduplication Normalization:** In `setUniqueEmployees`, all employee keys (`emp_id`) are parsed to a `Number(...)` before indexing and filtering. This prevents ID type conflicts (e.g. comparing string `"26"` from search results vs. number `26` from the main database list) from creating duplicate employee cards.
* **Client-side Search Matching:** In `sortedAndFilteredEmployees`, searches are matched against display `name`, `role`, and also `accounts.username` (e.g., matching `"k26"`), aligning client-side rendering with server-side query results.
* **Pagination Reset:** When search text is cleared, the pagination lock `hasMore` state is automatically reset back to `true` to allow subsequent paging requests.

#### 2. Details Modal Background Sync & Timeout
* **Initial Display:** Instantly reads `attendance_history:${employee.emp_id}:${filter}`. If present, it populates the table and turns off full-screen load spinners.
* **Subtle Indicator:** A small `ActivityIndicator` spinner is rendered inside the header to notify the user of background syncing.
* **Concurrent Fetching:** Hits `employees.php?detail_id=...` and `record_attendance.php?emp_id=...` in parallel via `Promise.all` using a 15-second `AbortController` timeout threshold.
* **Data Refresh:** On fetch completion, the MMKV key is updated, states (`localEmployee` and `history`) are swapped, and the syncing spinner is hidden.

---

### C. Concurrency, Race Condition, & Cleanups

#### 1. Race Condition Handling
When users tap filter ranges quickly (e.g. week -> month -> Jan), multiple async fetch promises are fired. If a slower request finishes after a faster one, it will overwrite the UI with stale range data.
* **Solution:** We maintain an `activeControllerRef` containing the active `AbortController`.
* At the start of a fetch, we abort the previous controller:
  ```typescript
  if (activeControllerRef.current) {
    activeControllerRef.current.abort();
  }
  const controller = new AbortController();
  activeControllerRef.current = controller;
  ```
* Before applying states, we verify if this fetch instance is still the active one:
  ```typescript
  if (activeControllerRef.current !== controller) return;
  ```
* On error or timeout abort, we check the same constraint. If `activeControllerRef.current !== controller`, we return silently without updating states or showing errors.

#### 2. Unmount Resource Cleanup
When the modal closes or unmounts, the pending fetch must be cancelled to prevent updating states on an unmounted component.
* **Solution:** The `useEffect` registers a cleanup function:
  ```typescript
  return () => {
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
      activeControllerRef.current = null; // prevents catches from executing
    }
  };
  ```

---

### D. Offline Resilience & Error Recovery
* **Network Failures / Timeouts:** If the background sync fails or times out (15s duration), the system displays the cached MMKV logs and displays a Toast alert on Android (`ToastAndroid.show(...)`) indicating the Kiosk is viewing offline records.
* **Cache Corruption Guard:** If the local MMKV cache contains corrupted JSON that fails parsing, the system catches the error, deletes the corrupted key (`(mmkv as any).delete(cacheKey)`), and calls `setLoading(true)` to fall back to a full network load safely.

---

## 5. Verification & Testing Reference
Developers or AI agents modifying the Employee Directory files must verify changes using:
1. **TypeScript Verification:** `npx tsc --noEmit`
2. **Jest Test Suite Execution:** `npm test` or `npx jest __tests__/utils/offlineUsers.test.ts`
