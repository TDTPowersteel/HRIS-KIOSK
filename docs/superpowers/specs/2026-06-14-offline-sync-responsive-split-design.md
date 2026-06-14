# Design Specification: Offline Sync Responsive Split Layout

## Overview
This design document specifies the layout optimization of the management dashboard screen (`OfflineSync.tsx`) in landscape mode for tablet resolutions, specifically targeting devices like the Samsung Galaxy Tab A7 Lite (~838 x 500 dp), while keeping the layout responsive on smaller phone screens.

## Problem Statement
The current implementation of `OfflineSync.tsx` only shows the side-by-side split layout (Offline Queue and Today's History) on screens where the short dimension is at least `768 dp` (`isTablet`).
On a Samsung Galaxy Tab A7 Lite in landscape mode, the dimensions are approximately `838 x 500 dp`. Since the short dimension is `500 dp` (less than `768 dp`), it defaults to a single-column stacked layout, which wastes horizontal space and forces users to scroll vertically to see both lists.

## Solution Detail

### 1. Landscape-Adaptive Split Detection
Instead of relying solely on `isTablet` for the side-by-side columns, we introduce a `useSplitLayout` flag:
```typescript
const useSplitLayout = isTablet || (isSmallTablet && windowWidth > windowHeight);
```
- **Tablet Resolutions in Landscape:** Fits the Tab A7 Lite resolution where `isSmallTablet` is true and `windowWidth > windowHeight` is true.
- **Portrait Mode & Smaller Screens:** Stacks vertically, keeping the single-column scrolling view.

### 2. 50/50 Layout Proportion
When `useSplitLayout` is true, the left (`syncPanel`) and right (`historyPanel`) sections will be split evenly (50/50) instead of the previous 60/40 ratio:
- `syncPanel` flex ratio: `0.5`
- `historyPanel` flex ratio: `0.5`

### 3. Layout and Scrolling Controls
The component layout properties (DashboardWrapper type, layout direction styles, inner scroll enabled states, and refresh control placements) will be updated to key off of `useSplitLayout` instead of `isTablet`.

### 4. Bottom Safe Area Responsiveness
To prevent the "SYNC NOW" button or screen elements from being hidden behind Android's/iOS's system bottom navigation bar, we will include the `'bottom'` edge in the root `SafeAreaView` edges:
```typescript
edges={['top', 'left', 'right', 'bottom']}
```
This native safe area handling will automatically scale layout padding at the bottom depending on the presence of software navigation indicators, remaining at 0 padding on devices with hardware navigation or gesture controls.

## Verification Plan
1. **Compilation:** Run `npx tsc --noEmit` to check that the layout updates compile cleanly.
2. **Jest Test Suite:** Run `npm test` to ensure no settings or component tests are broken.
