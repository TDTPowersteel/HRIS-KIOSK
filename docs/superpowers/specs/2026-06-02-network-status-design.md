# Network Status Optimization Design

## Problem
The app currently reports being "OFFLINE" even when there is internet connectivity and the backend is reachable. This discrepancy occurs because the `useNetworkStatus` hook enforces a strict 2.5-second timeout on its connectivity check. The history fetch (which lacks a timeout) completes successfully, leading to a UI state where the status says offline but real data is loaded. Furthermore, repeated uses of the hook across components spam the backend with multiple simultaneous heavy requests.

## Architecture Updates
1. **Timeout Extension**: The hardcoded fetch timeout inside `useNetworkStatus` will be increased from 2500ms to 8000ms. This accommodates slower backend responses or cold starts (like ngrok) without prematurely declaring an offline state.
2. **Global Request Throttling**: A module-level global variable will track `lastCheckTime` and `lastResult`. If a new check is requested within 5000ms of the previous one, the hook will immediately return the cached result instead of triggering a redundant backend ping.
3. **Cache Busting**: A `?t=timestamp` parameter will be added to the fetch URL in `useNetworkStatus` to bypass any aggressive caching mechanisms.
4. **Optimized Request Method**: The fetch request will be switched from `GET` to `HEAD` to minimize payload size and improve latency, as only the HTTP status code is required to verify connectivity.

## Components to Modify
- `src/hooks/useNetworkStatus.ts`
  - Move check deduplication logic outside the hook.
  - Implement 8s AbortController timeout.
  - Use `HEAD` method and `?t=${Date.now()}` in fetch.

## Error Handling
- If the `HEAD` request fails or times out after 8s, `hasGoodInternet` gracefully falls back to `false`.
- NetInfo listener will remain intact to handle local device connectivity events and immediately invalidate cache if device goes offline.
