# HRIS-KIOSK Intern Seen seen seen Deduplication & Cache seen seen Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure string IDs (like `'intern_x'`) do not get deduplicated to `NaN`, enable on-demand caching for scanned QR profiles, and query settings immediately on boot.

**Architecture:** Update React Native set state deduplication logic in `EmployeeProfileData.tsx` to handle string keys, call dynamic caching upsert on QR verification in `useAttendance.ts`, and perform startup settings query in `App.tsx`.

**Tech Stack:** React Native, Expo, TypeScript, MMKV.

---

### Task 1: seen seen deduplication string support
**Files:**
- Modify: `HRIS-KIOSK/src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Update Seen Seen set key types**
  In `setUniqueEmployees` (around line 104), change the seen check to use strings instead of `Number`.
  ```typescript
  const setUniqueEmployees = useCallback((data: EmployeeRow[], append: boolean = false) => {
    const seen = new Set<string>();
    
    let sourceData: EmployeeRow[] = [];
    if (append) {
      sourceData = [...employeesRef.current, ...data];
    } else {
      const existingMap = new Map<string, EmployeeRow>();
      employeesRef.current.forEach(emp => {
        if (emp && emp.emp_id != null) existingMap.set(String(emp.emp_id), emp);
      });
      data.forEach(emp => {
        if (emp && emp.emp_id != null) existingMap.set(String(emp.emp_id), emp);
      });
      sourceData = Array.from(existingMap.values());
    }

    const unique = sourceData.filter(emp => {
      if (!emp || emp.emp_id == null) return false;
      const id = String(emp.emp_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    setEmployees(unique);
    globalEmployeesCache = unique;
    
    if (data.length < ITEMS_PER_PAGE) {
      setHasMore(false);
    } else {
      setHasMore(true);
    }
  }, []);
  ```

- [ ] **Step 2: Update Bootstrap cache parser**
  Around line 471, map keys as strings instead of `parseInt`.
  ```typescript
  emp_id: u.empId as any,
  name: u.name || '',
  role: u.role || null,
  dept_id: null,
  log_id: u.userId as any,
  ```

---

### Task 2: Immediate Bootup Sync
**Files:**
- Modify: `HRIS-KIOSK/App.tsx`

- [ ] **Step 1: Query settings endpoint on mount**
  Inside the initial mounting `useEffect` hook in `App.tsx` (around line 60), fetch the settings payload to dynamically determine kiosk mode immediately on launch.
  ```typescript
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    getStoredTheme().then(setThemeState);
    Location.requestForegroundPermissionsAsync().catch(() => {});

    // Startup Mode query
    const checkModeOnStartup = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/settings.php`, {
          headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }
        });
        const payload = await response.json();
        if (payload?.ok && payload.kiosk_mode) {
          mmkv.set('kiosk_mode', payload.kiosk_mode);
          setKioskMode(payload.kiosk_mode);
        }
      } catch (err) {
        console.log('[Startup] Mode fetch failed, using cached mode:', err);
      }
    };
    checkModeOnStartup();
  }, []);
  ```

---

### Task 3: On-Demand Scanner Cache
**Files:**
- Modify: `HRIS-KIOSK/src/screens/attendance/useAttendance.ts`

- [ ] **Step 1: Ensure resolved intern QR is cached locally**
  In `useAttendance.ts` inside `resolveUserFromQr` around line 665, make sure the intern details are cached:
  ```typescript
  await upsertOfflineUserCacheUser({
    userId: user.userId,
    empId: user.userId,
    username: user.username,
    name: user.name ?? null,
    qrCode: qrData,
    profile_picture: user.profile_picture ?? null,
    role: user.role ?? null,
    department: user.department ?? null,
    face_embedding: user.face_embedding ?? null,
    isIntern: true,
  });
  ```

- [ ] **Step 2: Validate TypeScript**
  Run compilation checks: `npx tsc --noEmit`
  Expected: Success.
