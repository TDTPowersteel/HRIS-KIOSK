# Employee Directory Caching & Modal Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Employee Directory loading times and offline reliability by introducing Stale-While-Revalidate (SWR) caching and background sync for the directory list, dynamic avatar updating, and 5-second AbortController timeouts with local MMKV caches for the attendance history details modal.

**Architecture:** Use `react-native-mmkv` to store the directory and attendance logs. Merges updates dynamically into the React state. Employs `AbortController` in detail fetches to prevent UI hangs.

**Tech Stack:** React Native, Expo, react-native-mmkv, expo-file-system.

---

### Task 1: Extend Offline User Cache Callback

**Files:**
- Modify: `src/utils/offlineUsers.ts`

- [ ] **Step 1: Modify `triggerBackgroundProfileCaching` to support dynamic callbacks**
  Update the method signature and inner batch-caching logic to accept and execute an optional `onProfileCached` callback when an avatar finishes caching to disk.
  
  ```typescript
  // target content in src/utils/offlineUsers.ts:
  export async function triggerBackgroundProfileCaching(users: CachedOfflineUser[]): Promise<void> {
  // replacement:
  export async function triggerBackgroundProfileCaching(
    users: CachedOfflineUser[],
    onProfileCached?: (userId: string, localUri: string) => void
  ): Promise<void> {
  ```
  
  Within the `batch.map` execution block inside `triggerBackgroundProfileCaching`, invoke the callback when files are already cached locally or when they are freshly downloaded:
  
  ```typescript
  // For existing cached:
  if (existing.profile_picture && existing.profile_picture.startsWith('file://') && existing.profile_picture_remote === remoteUrl) {
    if (onProfileCached) {
      onProfileCached(user.userId, existing.profile_picture);
    }
    return;
  }
  
  // After download success:
  const cachedUri = await cacheProfilePictureOnDisk(user.userId, remoteUrl);
  if (cachedUri) {
    // ... cache update logic
    if (onProfileCached) {
      onProfileCached(user.userId, cachedUri);
    }
  }
  ```

- [ ] **Step 2: Update `updateOfflineUserCacheFromEmployees` to forward the callback**
  Update its arguments and internal `triggerBackgroundProfileCaching` invocation.
  
  ```typescript
  export async function updateOfflineUserCacheFromEmployees(
    data: EmployeePayloadRow[],
    isFullSync: boolean = true,
    onProfileCached?: (userId: string, localUri: string) => void
  ): Promise<CachedOfflineUser[]> {
    // ...
    triggerBackgroundProfileCaching(incomingUsers, onProfileCached).catch(err => {
      console.error('[Profile Caching] Background caching failed:', err);
    });
    return getOfflineUserCache();
  }
  ```

- [ ] **Step 3: Verification**
  Check that the code builds and there are no compilation errors in `src/utils/offlineUsers.ts`. (No git commit step, per user rules).

---

### Task 2: Implement Directory SWR & Dynamic Avatar Swapping

**Files:**
- Modify: `src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Add image cached callback and update `fetchEmployees`**
  Implement `handleProfileCached` using `useCallback` to update the profile picture URI dynamically in React state as it completes downloading in the background. Pass this callback down through `fetchEmployees`.
  
  ```typescript
  // Add to EmployeeProfileData component:
  const handleProfileCached = useCallback((userId: string, localUri: string) => {
    setEmployees(prev => prev.map(emp => {
      const acc = Array.isArray(emp.accounts) ? emp.accounts[0] : emp.accounts;
      const logId = emp.log_id || acc?.log_id;
      if (logId && String(logId) === String(userId)) {
        const isArr = Array.isArray(emp.accounts);
        const enrichedAcc = {
          ...acc,
          log_id: logId,
          profile_picture: localUri
        };
        return {
          ...emp,
          accounts: isArr ? [enrichedAcc] : enrichedAcc
        };
      }
      return emp;
    }));
  }, []);
  ```

  Update the `fetchEmployees` parameters and its invocation of `updateOfflineUserCacheFromEmployees`:
  
  ```typescript
  const fetchEmployees = useCallback(async (options?: { showLoading?: boolean; manual?: boolean; page?: number }) => {
    // ...
    if (isInitial) {
      await updateOfflineUserCacheFromEmployees(rows, false, handleProfileCached);
    }
    // ...
  }, [setUniqueEmployees, updateLastSync, handleProfileCached]);
  ```

- [ ] **Step 2: Verification**
  Open the employee directory screen and ensure it loads successfully from local cache instantly on bootstrap and then refreshes silently.

---

### Task 3: Implement SWR, Timeouts and Background Loader in Employee Modal

**Files:**
- Modify: `src/screens/settings/components/EmployeeDetailsModal.tsx`

- [ ] **Step 1: Add Caching, Timeout and Syncing state**
  Import `Platform` and `ToastAndroid` from `react-native`.
  Create a state `isSyncing` inside the component.
  Update the `fetchHistory` method in `EmployeeDetailsModal.tsx` to first load cached history from MMKV using key `attendance_history:${employee.emp_id}:${filter}`.
  Concurrently fetch the profile details and attendance history, wrapping them in a 5-second `AbortController` timeout.
  
  ```typescript
  const [isSyncing, setIsSyncing] = useState(false);
  
  const fetchHistory = async () => {
    if (!employee?.emp_id) return;
    
    // Load from cache first
    const cacheKey = `attendance_history:${employee.emp_id}:${filter}`;
    const cachedHistoryRaw = mmkv.getString(cacheKey);
    let hasCache = false;
    if (cachedHistoryRaw) {
      try {
        const parsed = JSON.parse(cachedHistoryRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHistory(parsed);
          hasCache = true;
        }
      } catch {}
    }
    
    // If no cache, block with full-screen loading spinner
    if (!hasCache) {
      setLoading(true);
    }
    setIsSyncing(true);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      // 1. Fetch fresh details and history concurrently
      let historyUrl = `${BACKEND_URL}/record_attendance.php?emp_id=${employee.emp_id}`;
      const now = new Date();
      if (filter === 'week') {
        const lastWeek = new Date();
        lastWeek.setDate(now.getDate() - 7);
        historyUrl += `&since=${lastWeek.toISOString().split('T')[0]}&limit=50`;
      } else if (filter === 'month') {
        const lastMonth = new Date();
        lastMonth.setDate(now.getDate() - 30);
        historyUrl += `&since=${lastMonth.toISOString().split('T')[0]}&limit=50`;
      } else if (filter !== 'all') {
        const year = now.getFullYear();
        const monthIdx = parseInt(filter, 10);
        const startDate = new Date(year, monthIdx, 1);
        historyUrl += `&since=${startDate.toISOString().split('T')[0]}&limit=100`;
      } else {
        historyUrl += `&limit=100`;
      }
      
      const [detailRes, response] = await Promise.all([
        fetch(`${BACKEND_URL}/employees.php?detail_id=${employee.emp_id}`, { signal: controller.signal }),
        fetch(historyUrl, { signal: controller.signal })
      ]);
      
      // Parse fresh profile details
      const detailPayload = await detailRes.json();
      if (detailPayload.ok && detailPayload.user) {
        const freshUser = detailPayload.user;
        const hqPic = detailPayload.profile_picture_hq;
        const acc = Array.isArray(freshUser.accounts) ? freshUser.accounts[0] : freshUser.accounts;
        const merged = {
          ...freshUser,
          accounts: {
            ...acc,
            profile_picture: hqPic || acc?.profile_picture || null
          }
        };
        setLocalEmployee(merged);
        
        // Async update offline cache
        const userId = freshUser.log_id || acc?.log_id;
        if (userId) {
          upsertOfflineUserCacheUser({
            userId: String(userId),
            empId: String(freshUser.emp_id),
            username: acc?.username || freshUser.name || '',
            name: freshUser.name,
            role: freshUser.role,
            department: freshUser.departments?.name || null,
            profile_picture: hqPic || acc?.profile_picture || null,
            profile_picture_remote: acc?.profile_picture || null,
            qrCode: acc?.qr_code || null,
          }).catch(e => console.log('Cache update error:', e));
        }
      }
      
      // Parse fresh history logs
      const payload = await response.json();
      if (payload.ok) {
        let fetchedData = payload.data || [];
        if (filter !== 'all' && filter !== 'week' && filter !== 'month') {
          const targetMonth = parseInt(filter, 10);
          fetchedData = fetchedData.filter((log: any) => new Date(log.date).getMonth() === targetMonth);
        }
        setHistory(fetchedData);
        mmkv.set(cacheKey, JSON.stringify(fetchedData));
      } else {
        if (!hasCache) setHistory([]);
      }
    } catch (e: any) {
      console.log('Failed to fetch attendance history/details:', e);
      if (!hasCache) setHistory([]);
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          e?.name === 'AbortError' ? 'Sync timed out. Showing offline records.' : 'Sync failed. Showing offline records.',
          ToastAndroid.SHORT
        );
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setIsSyncing(false);
    }
  };
  ```

- [ ] **Step 2: Update UI and add the background syncing spinner**
  Modify the `EmployeeDetailsModal` JSX to show a small, non-blocking `ActivityIndicator` in the header next to "Attendance Records" while `isSyncing` is true.
  
  ```typescript
  // target content in EmployeeDetailsModal.tsx:
  <Text style={[styles.historyTitle, { color: colors.text, fontSize: historyTitleFontSize }]}>Attendance Records</Text>
  // replacement:
  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    <Text style={[styles.historyTitle, { color: colors.text, fontSize: historyTitleFontSize }]}>Attendance Records</Text>
    {isSyncing && (
      <ActivityIndicator size="small" color={Colors.powerOrange} style={{ marginLeft: 10 }} />
    )}
  </View>
  ```

- [ ] **Step 3: Verification**
  Open the modal for any employee. Verify that cached logs display instantly, and the small background loader spins briefly before closing on sync completion. Simulate a slow network and verify it aborts/reverts without freezing.
