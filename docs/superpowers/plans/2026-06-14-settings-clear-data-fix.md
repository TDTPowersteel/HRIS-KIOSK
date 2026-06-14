# Settings Clear Data Fix and Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable full data wipe (AsyncStorage + MMKV cache) in Settings and temporarily hide the storage card from the UI.

**Architecture:** Update `confirmWipe` in `settings/index.tsx` to execute both `AsyncStorage.clear()` and `clearOfflineUserCache()`. Comment out the `styles.storageCard` component in JSX.

**Tech Stack:** React Native, Expo

---

### Task 1: Fix Clear Data Logic in `settings/index.tsx`

**Files:**
- Modify: `src/screens/settings/index.tsx`

- [ ] **Step 1: Import clearOfflineUserCache**
  Change the import of `mmkv` on line 17:
  ```typescript
  import { mmkv, clearOfflineUserCache } from '../../utils/offlineUsers';
  ```

- [ ] **Step 2: Update confirmWipe**
  Replace lines 186 to 202 with the active clean up code:
  ```typescript
    const confirmWipe = async () => {
      setShowWipeConfirm(false);
      setIsLoading(true);
      try {
        await AsyncStorage.clear();
        await clearOfflineUserCache();
        await calculateStorageSize();
        Alert.alert('Success', 'Device memory has been cleared.');
      } catch (e) {
        Alert.alert('Error', 'Failed to clear memory.');
      } finally {
        setIsLoading(false);
      }
    };
  ```

---

### Task 2: Comment Out Storage Card in `settings/index.tsx`

**Files:**
- Modify: `src/screens/settings/index.tsx`

- [ ] **Step 1: Comment out styles.storageCard view**
  Wrap the entire storage card `View` component (lines 482 to 507) in JSX comments to hide it:
  ```typescript
            {/* Hide Device Storage card temporarily
            <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.storageMainRow}>
                <View style={styles.storageInfoBlock}>
                  <Text style={[styles.storageLabel, { color: colors.textSecondary, fontSize: storageLabelFontSize }]}>USED MEMORY</Text>
                  <Text style={[styles.storageValue, { color: colors.text, fontSize: storageValueFontSize }]}>{storageSize}</Text>
                </View>
                <Pressable 
                  onPress={handleWipeCache}
                  style={({ pressed }) => [
                    styles.wipeButton,
                    { 
                      borderColor: '#ef4444', 
                      backgroundColor: pressed ? 'rgba(239, 68, 68, 0.12)' : 'transparent' 
                    },
                  ]}
                >
                  <Text style={[styles.wipeButtonText, { fontSize: wipeButtonTextFontSize }]}>CLEAR DATA</Text>
                </Pressable>
              </View>
              <View style={[styles.storageDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.storageSubtext, { color: colors.textSecondary, fontSize: storageSubtextFontSize }]}>
                {kioskMode === 'intern' 
                  ? 'Includes saved intern lists, pictures, and attendance logs.' 
                  : 'Includes saved employee lists, pictures, and attendance logs.'}
              </Text>
            </View>
            */}
  ```

---

### Task 3: Build Verification

- [ ] **Step 1: Check TypeScript Compilation**
  Run: `npx tsc --noEmit`
  Expected: exit code 0, no compiler errors.

- [ ] **Step 2: Run Kiosk Jest Test Suite**
  Run: `npm test`
  Expected: All tests pass.
