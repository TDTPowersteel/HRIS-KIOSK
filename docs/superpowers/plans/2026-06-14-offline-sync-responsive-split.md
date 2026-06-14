# Offline Sync Responsive Split Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a responsive 50/50 split layout in landscape mode for the Samsung Tab A7 Lite resolution (and larger screens) in the Kiosk's Management Dashboard (`OfflineSync.tsx`).

**Architecture:** Use a dynamic boolean flag `useSplitLayout` that combines `isTablet` and a check for `isSmallTablet` in landscape mode. Use this flag to conditionally apply split row layout, adjust scroll views, and set equal `flex: 0.5` styles.

**Tech Stack:** React Native, Expo

---

### Task 1: Update Layout Control Logic in `OfflineSync.tsx`

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Define useSplitLayout**
  Add `const useSplitLayout = isTablet || (isSmallTablet && windowWidth > windowHeight);` below the screen dimension calculations.
  
  ```typescript
    const isTablet = shortDimension >= 768;
    const isSmallTablet = shortDimension >= 480 && shortDimension < 768;
    const useSplitLayout = isTablet || (isSmallTablet && windowWidth > windowHeight);
  ```

- [ ] **Step 2: Update DashboardWrapper definition**
  Change:
  ```typescript
    const DashboardWrapper = isTablet ? View : ScrollView;
  ```
  To:
  ```typescript
    const DashboardWrapper = useSplitLayout ? View : ScrollView;
  ```

- [ ] **Step 3: Update DashboardWrapper wrapper component**
  Change the style selection and conditional properties for the wrapper:
  ```typescript
        style={[
          styles.dashboardContainer, 
          useSplitLayout ? styles.tabletRow : styles.mobileColumn
        ]}
        {...(!useSplitLayout ? {
          contentContainerStyle: styles.mobileScrollContainer,
          showsVerticalScrollIndicator: false,
          refreshControl: (
            <RefreshControl
              refreshing={isHistoryLoading}
              onRefresh={loadHistory}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          )
        } : {})}
  ```

---

### Task 2: Configure 50/50 Flex Split and Inner List Scrolling

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Update Left Panel (syncPanel) Flex Ratio**
  Set `flex: 0.5` when `useSplitLayout` is true:
  ```typescript
        <View style={[
          styles.syncPanel, 
          useSplitLayout ? { 
            flex: 0.5, 
            backgroundColor: theme === 'light' ? '#FFFFFF' : colors.surface, 
            borderRightWidth: 1, 
            borderRightColor: colors.border,
            zIndex: 10,
            shadowColor: '#000',
            shadowOffset: { width: 4, height: 0 },
            shadowOpacity: 0.08,
            shadowRadius: 10,
            elevation: 8, 
          } : {
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
          }
        ]}>
  ```

- [ ] **Step 2: Update Left ScrollView scrollEnabled**
  Set the inner queue ScrollView `scrollEnabled` to `useSplitLayout`:
  ```typescript
            <ScrollView scrollEnabled={useSplitLayout} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
  ```

- [ ] **Step 3: Update Right Panel (historyPanel) Flex Ratio**
  Set `flex: 0.5` when `useSplitLayout` is true:
  ```typescript
        <View style={[
          styles.historyPanel, 
          useSplitLayout ? { 
            flex: 0.5, 
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background, 
          } : {
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background,
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }
        ]}>
  ```

- [ ] **Step 4: Update Right ScrollView scrollEnabled & refreshControl**
  Update the inner history ScrollView:
  ```typescript
            scrollEnabled={useSplitLayout}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              useSplitLayout ? (
                <RefreshControl
                  refreshing={isHistoryLoading}
                  onRefresh={loadHistory}
                  colors={[colors.accent]}
                  tintColor={colors.accent}
                />
              ) : undefined
            }
  ```

---

### Task 3: Bottom Safe Area Navigation Fix

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Update Root SafeAreaView edges**
  Add `'bottom'` to the `edges` array on the root `SafeAreaView` around line 363:
  ```typescript
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
  ```

---

### Task 4: Build Verification

- [ ] **Step 1: Check TypeScript Compilation**
  Run: `npx tsc --noEmit`
  Expected: exit code 0, no compiler errors.

- [ ] **Step 2: Run Kiosk Jest Test Suite**
  Run: `npm test`
  Expected: All tests pass.
