# Fix deleteIconFontSize in Employee Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the missing `deleteIconFontSize` property ReferenceError in the Employee Directory screen.

**Architecture:** Define `deleteIconFontSize` responsively based on device dimensions inside the main render function, matching other font size settings in the screen.

**Tech Stack:** React Native, Expo, TypeScript

---

### Task 1: Add deleteIconFontSize definition

**Files:**
- Modify: `src/screens/EmployeeProfileData.tsx:174-177`

- [ ] **Step 1: Write the implementation**

Modify [EmployeeProfileData.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx#L174-L177) to define the `deleteIconFontSize` responsive constant.

```typescript
  const sortToggleTextFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const deleteIconFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
  const isFetchingRef = useRef(false);
```

- [ ] **Step 2: Run verification checks**

Run the TypeScript compiler to ensure the ReferenceError is completely gone.

Run: `npx tsc --noEmit`
Expected output: No errors in `EmployeeProfileData.tsx`.
