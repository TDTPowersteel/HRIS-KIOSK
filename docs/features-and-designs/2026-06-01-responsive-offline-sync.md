# Responsive Layout & Hybrid Offline Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fully responsive, stacked mobile layout for `OfflineSync.tsx` that persistently caches today's history and locks down the SYNC NOW button unless a verified internet connection is established.

**Architecture:** Combine a lightweight custom React hook leveraging `@react-native-community/netinfo` with an active background HTTP reachability ping to guarantee internet flow. Store history in AsyncStorage on successful fetches and render it instantly on mount. Switch flexbox directions dynamically based on standard device thresholds.

**Tech Stack:** React Native, Expo, AsyncStorage, `@react-native-community/netinfo`

---

## 📂 File Map
*   Create: `src/hooks/useNetworkStatus.ts` (Dynamic Network Hook)
*   Modify: `src/screens/OfflineSync.tsx` (Dashboard UI & Local Storage Caching)

---

## 📝 Tasks

### Task 1: Add `@react-native-community/netinfo` Package

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@react-native-community/netinfo`**

Run this command in the terminal to let Expo install the correct compatible version:
`npx expo install @react-native-community/netinfo`

- [ ] **Step 2: Verify `package.json` entry**

Confirm `@react-native-community/netinfo` is listed under the `"dependencies"` block in `package.json`.

---

### Task 2: Create Custom Hook `useNetworkStatus.ts`

**Files:**
- Create: `src/hooks/useNetworkStatus.ts`

- [ ] **Step 1: Implement the custom network status hook**

Create the file `src/hooks/useNetworkStatus.ts` and write the connection tracking and ping verification logic:

```typescript
import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { BACKEND_URL } from '../config/backend';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [hasGoodInternet, setHasGoodInternet] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      setIsConnected(state.isConnected);
      if (!state.isConnected) {
        setHasGoodInternet(false);
        setIsChecking(false);
        return false;
      }

      // If connected to network, perform a lightweight backend reachability ping
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(`${BACKEND_URL}/attendance_today.php`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const isOk = res.status >= 200 && res.status < 300;
      setHasGoodInternet(isOk);
      setIsChecking(false);
      return isOk;
    } catch {
      setHasGoodInternet(false);
      setIsChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    // Listen for OS connection status updates
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
      if (!state.isConnected) {
        setHasGoodInternet(false);
      } else {
        // Trigger verification immediately upon reconnect
        checkStatus();
      }
    });

    // Run initial reachability check
    checkStatus();

    return () => unsubscribe();
  }, [checkStatus]);

  return { isConnected, hasGoodInternet, isChecking, checkStatus };
}
```

---

### Task 3: Implement History Cache Layer in `OfflineSync.tsx`

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Import AsyncStorage**

Verify `AsyncStorage` is imported at the top of the file:
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
```

- [ ] **Step 2: Add local cache initialization hook**

Inside `OfflineSync`, add a `useEffect` hook to instantly load cached history data on component mount:

```typescript
  useEffect(() => {
    const initHistoryFromCache = async () => {
      try {
        const cached = await AsyncStorage.getItem('cached_attendance_today_history');
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch (e) {
        console.error('Failed to load cached history', e);
      }
    };
    initHistoryFromCache();
  }, []);
```

- [ ] **Step 3: Update `loadHistory` to update local cache**

Update the `loadHistory` function to write successfully retrieved payloads into `AsyncStorage`:

```typescript
  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/attendance_today.php`, {
        headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
      });
      const json = await res.json();
      if (json.ok) {
        const fetchedHistory = json.history || [];
        setHistory(fetchedHistory);
        await AsyncStorage.setItem('cached_attendance_today_history', JSON.stringify(fetchedHistory));
      }
    } catch (e) {
      console.error('Failed to fetch history', e);
      // Fallback: Reload from local storage if network request fails
      try {
        const cached = await AsyncStorage.getItem('cached_attendance_today_history');
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch {}
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);
```

---

### Task 4: UI Security Guard & Status Indicator

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Import `useNetworkStatus`**

Import the network status hook at the top of `src/screens/OfflineSync.tsx`:
```typescript
import { useNetworkStatus } from '../hooks/useNetworkStatus';
```

- [ ] **Step 2: Initialize hook and disable "SYNC NOW"**

Call `useNetworkStatus` inside the component:
```typescript
  const { hasGoodInternet, isChecking, checkStatus } = useNetworkStatus();
```

Disable the "SYNC NOW" button press handler if `!hasGoodInternet` or `isSyncing` is active:
```typescript
  const handleSyncNow = useCallback(async () => {
    if (isSyncing || !hasGoodInternet) return;

    setIsSyncing(true);
    try {
      await syncOfflineQueue();
    } finally {
      await reloadQueue();
      setIsSyncing(false);
    }
  }, [isSyncing, reloadQueue, hasGoodInternet]);
```

- [ ] **Step 3: Update Sync Button render state**

Change the Pressable render properties to disable touch interactions and apply a faded look when offline:
```typescript
            <Pressable
              style={({ pressed }) => [
                styles.syncButton,
                { backgroundColor: pressed ? withAlpha(Colors.powerOrange, 0.85) : Colors.powerOrange },
                (isSyncing || !hasGoodInternet) && styles.syncButtonDisabled,
              ]}
              onPress={handleSyncNow}
              disabled={isSyncing || !hasGoodInternet}
            >
```

- [ ] **Step 4: Add clear Connection Status Banner**

Inside the **Offline Queue** panel, insert a dynamic connection status indicator above or inside the `noobInfoBox`:

```typescript
          <View style={[
            styles.connectionBanner,
            { backgroundColor: hasGoodInternet ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderColor: hasGoodInternet ? '#22c55e' : '#ef4444' }
          ]}>
            <MaterialCommunityIcons 
              name={hasGoodInternet ? "wifi" : "wifi-off"} 
              size={18} 
              color={hasGoodInternet ? "#22c55e" : "#ef4444"} 
            />
            <Text style={[styles.connectionBannerText, { color: hasGoodInternet ? "#16a34a" : "#dc2626" }]}>
              {hasGoodInternet ? "ONLINE - READY TO SYNC" : "OFFLINE - SYNC DISABLED (CONNECTION REQUIRED)"}
            </Text>
          </View>
```

Add these styles to `styles`:
```typescript
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  connectionBannerText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
```

---

### Task 5: Adapt UI Breakpoints and Responsiveness

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Define adaptive breakpoints**

At the top of the `OfflineSync` component, grab layout dimensions dynamically:
```typescript
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 768;
  const isSmallTablet = windowWidth >= 480 && windowWidth < 768;
  const isPhone = windowWidth < 480;
```

- [ ] **Step 2: Update Layout container**

Update the `dashboardContainer` and panel styles to stack vertically on small widths:
```typescript
      <View style={[
        styles.dashboardContainer, 
        isTablet ? styles.tabletRow : styles.mobileColumn
      ]}>
```

Add layout weights and rules to styles:
```typescript
  mobileColumn: {
    flexDirection: 'column',
    flex: 1,
  },
```

- [ ] **Step 3: Adapt panel layout styles**

For both `syncPanel` and `historyPanel`, calculate responsive sizes dynamically:
```typescript
        <View style={[
          styles.syncPanel, 
          isTablet ? { 
            flex: 0.6, 
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
            flex: 1.2,
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
          }
        ]}>
```

Update `historyPanel` dynamically:
```typescript
        <View style={[
          styles.historyPanel, 
          isTablet ? { 
            flex: 0.4, 
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background, 
          } : {
            flex: 0.8,
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background,
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }
        ]}>
```

- [ ] **Step 4: Scale Card Heights & Avatars**

Declare scaling values dynamically inside the render method:
```typescript
  const cardHeight = isPhone ? 70 : isSmallTablet ? 74 : 80;
  const avatarSize = isPhone ? 40 : 48;
```

Update Queue and History list cards to use these computed sizes:
```typescript
                  <View
                    key={item.id}
                    style={[
                      styles.standardCard,
                      {
                        backgroundColor: isFailedItem ? 'rgba(239, 68, 68, 0.04)' : colors.background,
                        borderColor: isFailedItem ? '#ef4444' : colors.border,
                        height: cardHeight,
                      },
                    ]}
                  >
                    <View style={[styles.standardAvatar, { backgroundColor: isFailedItem ? '#ef4444' : '#f97316', width: avatarSize, height: avatarSize, borderRadius: isPhone ? 10 : 12 }]}>
```

Repeat same scaling for Today's History card.

---

## 🔍 Verification & Final Review

- [ ] **Step 1: Test with Wi-Fi/Cellular off**
    *   Disconnect device internet completely.
    *   Open Management Dashboard.
    *   Verify badge instantly shows `OFFLINE` (0ms wait).
    *   Verify `SYNC NOW` is disabled and greyed out.
    *   Verify today's history loads instantly from local cache instead of failing.
- [ ] **Step 2: Test layout scaling**
    *   Open in mobile device, small tablet, and large tablet.
    *   Verify no squishing occurs and both panels flow perfectly in a vertical stack on mobile/small-tablet.
