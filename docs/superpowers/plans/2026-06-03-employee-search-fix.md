# Employee Search De-duplication Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve duplicate employee cards when searching (e.g. `k26`) by normalizing ID parsing and matching username query strings client-side.

**Architecture:** Normalize `emp_id` to a `Number` in unique checks and add `accounts.username` to client-side filters.

---

### Task 1: Normalize ID Check & Add Username matching in Client Search

**Files:**
- Modify: `src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Update `setUniqueEmployees` to cast IDs to numbers**
  Modify `setUniqueEmployees` to wrap `emp_id` with `Number(...)` for both map keys and unique set entries.
  
  ```typescript
  // Target:
      } else {
        const existingMap = new Map<number, EmployeeRow>();
        employeesRef.current.forEach(emp => {
          if (emp && emp.emp_id) existingMap.set(emp.emp_id, emp);
        });
        data.forEach(emp => {
          if (emp && emp.emp_id) existingMap.set(emp.emp_id, emp);
        });
        sourceData = Array.from(existingMap.values());
      }
  
      const unique = sourceData.filter(emp => {
        if (!emp || !emp.emp_id || seen.has(emp.emp_id)) return false;
        seen.add(emp.emp_id);
        return true;
      });
  
  // Replacement:
      } else {
        const existingMap = new Map<number, EmployeeRow>();
        employeesRef.current.forEach(emp => {
          if (emp && emp.emp_id) existingMap.set(Number(emp.emp_id), emp);
        });
        data.forEach(emp => {
          if (emp && emp.emp_id) existingMap.set(Number(emp.emp_id), emp);
        });
        sourceData = Array.from(existingMap.values());
      }
  
      const unique = sourceData.filter(emp => {
        if (!emp || !emp.emp_id) return false;
        const id = Number(emp.emp_id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  ```

- [ ] **Step 2: Add Username search match in client-side search query**
  Update the client-side filter `matchesSearch` inside `sortedAndFilteredEmployees` to match against `accounts.username` as well.
  
  ```typescript
  // Target:
    const sortedAndFilteredEmployees = useMemo(() => {
      let result = employees.filter(emp => {
        const matchesSearch = emp.name.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
          (emp.role && emp.role.toLowerCase().includes(debouncedSearchText.toLowerCase()));
  
  // Replacement:
    const sortedAndFilteredEmployees = useMemo(() => {
      let result = employees.filter(emp => {
        const acc = normalizeAccount(emp.accounts ?? null);
        const matchesSearch = emp.name.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
          (emp.role && emp.role.toLowerCase().includes(debouncedSearchText.toLowerCase())) ||
          (acc?.username && acc.username.toLowerCase().includes(debouncedSearchText.toLowerCase()));
  ```

- [ ] **Step 3: Verification**
  Run `npx tsc --noEmit` to ensure typechecking passes cleanly.
  Run `npm test` to ensure tests continue to pass with no issues.
