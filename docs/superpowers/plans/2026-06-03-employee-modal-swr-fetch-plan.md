# Employee Modal SWR and Loading State Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the laggy and blank state behavior when opening the Employee Details Modal and when switching date filters.

**Architecture:** We will compute a merged `activeEmployee` object combining static props with backend sync details to render the profile header instantly. We will trigger the `loading` state check synchronously inside the Visibility/Filter `useEffect` to display the loading spinner immediately if no cache is found.

**Tech Stack:** React, React Native, MMKV.

---

### Task 1: Update EmployeeDetailsModal State and Rendering

**Files:**
- Modify: [EmployeeDetailsModal.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/settings/components/EmployeeDetailsModal.tsx)

- [ ] **Step 1: Declare activeEmployee using useMemo**
  Add a `useMemo` statement inside `EmployeeDetailsModal` to merge the `employee` prop and `localEmployee` state.
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

- [ ] **Step 2: Update UI static references to use activeEmployee**
  Update the JSX and helpers inside `EmployeeDetailsModal.tsx` to read from `activeEmployee` instead of `localEmployee`.
  * Update `getProfilePicture` to:
    ```typescript
    const getProfilePicture = () => {
      if (!activeEmployee) return null;
      const acc = Array.isArray(activeEmployee.accounts) ? activeEmployee.accounts[0] : activeEmployee.accounts;
      return acc?.profile_picture;
    };
    ```
  * In `renderContent` check:
    ```typescript
    if (!activeEmployee) return null;
    ```
  * In JSX labels, change:
    - `localEmployee?.name` -> `activeEmployee?.name`
    - `localEmployee?.role` -> `activeEmployee?.role`
    - `localEmployee?.departments?.name` -> `activeEmployee?.departments?.name`

- [ ] **Step 3: Modify useEffect to synchronously set loading to true**
  Update the `useEffect` that triggers `fetchHistory` to synchronously set `loading` to `true` if there is no cached history for the target employee and filter.
  ```typescript
  useEffect(() => {
    if (visible && employee?.emp_id) {
      setShowMonthDropdown(false);
      setStatusFilter('All');
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

- [ ] **Step 4: Run typecheck**
  Execute typescript verification.
  Run: `npx tsc --noEmit`
  Expected: Successful compilation without errors.

- [ ] **Step 5: Run unit tests**
  ExecuteJest tests to verify the test suite continues to pass.
  Run: `npm test`
  Expected: 19 tests pass successfully.
