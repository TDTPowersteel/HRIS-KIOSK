# Design Specification: Employee Details Modal SWR and Loading State Fixes

## Problem Statement
When opening the Employee Details Modal:
1. The profile details render blank or empty initially because the component relies on a lagged state (`localEmployee`) that updates one frame after the modal is shown.
2. The full-screen loading spinner does not show up on the initial load because `loading` state starts as `false` and is set to `true` asynchronously inside the `fetchHistory` callback, leading to a laggy UX.
3. Changing the date filter triggers an abort of the previous request (logging `AbortError: Aborted`), but the full-screen loading indicator does not consistently render for filters that have no cached history.

## Proposed Solution
We will refactor the state initialization and render logic in `EmployeeDetailsModal.tsx` as follows:

### 1. Merged Active Employee Object
Create a computed `activeEmployee` object using `useMemo` that merges the latest `employee` prop and any fetched metadata updates from `localEmployee` state.
This ensures the profile header and avatar render instantly on the first frame when the modal becomes visible.

```typescript
const activeEmployee = useMemo(() => {
  if (!employee) return null;
  return {
    ...employee,
    ...(localEmployee || {}),
    accounts: localEmployee?.accounts || employee.accounts
  };
}, [employee, localEmployee]);
```

### 2. Synchronous Loading State Trigger
Update the `useEffect` that triggers `fetchHistory` to check for cache presence synchronously. If no cache exists for the selected `employee.emp_id` and `filter` combination, set the `loading` state to `true` synchronously inside the effect to prevent rendering frames without a loading spinner.

```typescript
useEffect(() => {
  if (visible && employee?.emp_id) {
    const cacheKey = `attendance_history:${employee.emp_id}:${filter}`;
    const cachedString = mmkv.getString(cacheKey);
    if (!cachedString) {
      setLoading(true);
    }
    fetchHistory();
  } else {
    setHistory([]);
    setLoading(false);
  }
  return () => {
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
      activeControllerRef.current = null;
    }
  };
}, [visible, employee?.emp_id, filter]);
```

### 3. Cleanup of Prop References
Clean up JSX references within `EmployeeDetailsModal.tsx` so that static profile metadata is rendered from `activeEmployee` rather than `localEmployee`.
