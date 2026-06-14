# Design Specification: Settings Clear Data Fix and Hide

## Overview
This design document details the fix for the "Clear Data" feature in the Kiosk's Settings screen (`settings/index.tsx`) and the temporary removal of its card from the user interface.

## Problem Statement
1. **Clear Data is Commented Out:** The data wiping code inside `confirmWipe` was commented out to prevent accidental deletion, returning a mock alert instead.
2. **Incomplete Wipe:** The original commented-out logic only cleared `AsyncStorage`. It did not clear the `mmkv` key-value cache where cached offline user lists (interns and employees), face embeddings, and local profiles are stored.
3. **Hide Requirement:** After fixing the logic, the "CLEAR DATA" card needs to be hidden temporarily from the user interface.

## Solution Detail

### 1. Fix Clear Data Logic
- Import `clearOfflineUserCache` from the `offlineUsers` utility.
- Uncomment and update `confirmWipe` in [settings/index.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/settings/index.tsx):
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

### 2. Hide Card Temporarily
- Comment out the JSX block for the storage card container (`styles.storageCard`) inside `settings/index.tsx`.
- Leave the `"Device Storage"` section header visible so that the 7-tap shortcut to reveal developer options (`handleHeaderTap`) remains active.

## Verification Plan
1. **Compilation:** Run `npx tsc --noEmit` to verify type safety.
2. **Jest Test Suite:** Run `npm test` to ensure that no tests are broken.
