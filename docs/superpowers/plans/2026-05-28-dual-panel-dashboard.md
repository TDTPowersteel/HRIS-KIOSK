# Dual-Panel Kiosk Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Offline Sync screen into a comprehensive Dual-Panel Dashboard for tablets, showing real-time server history side-by-side with the local sync queue.

**Architecture:** Split-pane layout (60% History / 40% Sync) on tablets, switching to a vertical stack on mobile. Includes a new backend endpoint for real-time "Today's History" data.

**Tech Stack:** React Native, TypeScript, PHP (Backend), AsyncStorage.

---

### Task 1: Backend History Endpoint

**Files:**
- Create: `backend-php/attendance_today.php`

- [ ] **Step 1: Create the attendance_today.php endpoint**
Create a script that returns all attendance logs for the current date using the `supabase_request` helper.

```php
<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
require_once __DIR__ . '/connect.php';

date_default_timezone_set('Asia/Manila');
$today = date('Y-m-d');

// Fetch today's attendance with joined employee and account info
$select = 'att_id,emp_id,timein,timeout,date,employees(name,log_id,accounts(username))';
$path = "rest/v1/attendance?select=" . urlencode($select) . "&date=eq.{$today}&order=att_id.desc";

[$status, $data, $err] = supabase_request('GET', $path);

if ($err) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Database error', 'detail' => $err]);
    exit;
}

$history = [];
if (is_array($data)) {
    foreach ($data as $row) {
        $emp = $row['employees'] ?? null;
        $acc = $emp['accounts'] ?? null;
        
        // If timeout exists, it's a clock_out record (latest state of that session)
        $history[] = [
            'id' => $row['att_id'],
            'userId' => $emp['log_id'] ?? $row['emp_id'],
            'name' => $emp['name'] ?? 'Unknown',
            'username' => $acc['username'] ?? 'N/A',
            'action' => $row['timeout'] ? 'clock_out' : 'clock_in',
            'time' => $row['timeout'] ?: $row['timein'],
            'date' => $row['date']
        ];
    }
}

echo json_encode(['ok' => true, 'history' => $history]);
```

- [ ] **Step 2: Commit**
```bash
git add backend-php/attendance_today.php
git commit -m "feat(backend): add attendance_today endpoint for kiosk history"
```

### Task 2: Dashboard Layout & Responsiveness

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Implement the Responsive Split Container**
Update the main render logic to support a 60/40 split on tablets and vertical stacking on mobile.

```typescript
// Inside OfflineSync component
const isTablet = windowWidth >= 768;

return (
  <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
    <View style={styles.topBar} />
    <View style={[styles.dashboardContainer, isTablet && styles.tabletRow]}>
      {/* LEFT: HISTORY PANEL (60%) */}
      <View style={[styles.historyPanel, isTablet && { flex: 0.6 }]}>
        <Text style={styles.panelTitle}>Today's Activity</Text>
        {/* History List Component */}
      </View>

      {/* RIGHT: SYNC PANEL (40%) */}
      <View style={[styles.syncPanel, isTablet && { flex: 0.4, backgroundColor: colors.surface }]}>
        <Text style={styles.panelTitle}>Sync Queue</Text>
        {/* Sync List Component */}
      </View>
    </View>
  </SafeAreaView>
);
```

- [ ] **Step 2: Define new Dashboard styles**
Update `StyleSheet.create` with Bauhaus/M3-inspired layouts.

```typescript
const styles = StyleSheet.create({
  dashboardContainer: {
    flex: 1,
  },
  tabletRow: {
    flexDirection: 'row',
  },
  historyPanel: {
    padding: 24,
  },
  syncPanel: {
    padding: 24,
    borderLeftWidth: 1,
    borderLeftColor: '#e0e0e0',
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 20,
    letterSpacing: 0.5,
  },
  // ... rest of refined styles
});
```

- [ ] **Step 3: Commit**
```bash
git add src/screens/OfflineSync.tsx
git commit -m "feat(ui): implement dual-panel responsive dashboard layout"
```

### Task 3: History Data Integration

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Add fetch logic for Today's History**
Implement a hook to fetch the server data on mount.

```typescript
const [history, setHistory] = useState([]);
const [isHistoryLoading, setIsHistoryLoading] = useState(true);

const loadHistory = useCallback(async () => {
  try {
    const res = await fetch(`${BACKEND_URL}/attendance_today.php`);
    const json = await res.json();
    if (json.ok) setHistory(json.history);
  } catch (e) {
    console.error('Failed to fetch history', e);
  } finally {
    setIsHistoryLoading(false);
  }
}, []);

useEffect(() => {
  loadHistory();
}, [loadHistory]);
```

- [ ] **Step 2: Render History Cards**
Implement the "Solid" card style for the History feed.

```typescript
const renderHistoryItem = (item) => (
  <View style={styles.historyCard}>
    <View style={styles.historyCardHeader}>
      <Text style={styles.historyName}>{item.name || item.username}</Text>
      <View style={[styles.badge, item.action === 'clock_in' ? styles.badgeIn : styles.badgeOut]}>
        <Text style={styles.badgeText}>{item.action.replace('_', ' ').toUpperCase()}</Text>
      </View>
    </View>
    <Text style={styles.historyTime}>{item.time}</Text>
  </View>
);
```

- [ ] **Step 3: Commit**
```bash
git add src/screens/OfflineSync.tsx
git commit -m "feat(ui): integrate real-time history feed into dashboard"
```

### Task 4: Sync Queue Redesign

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Implement "Hollow" Outlined Cards**
Redesign the sync queue items to look different from the history items.

```typescript
const renderSyncItem = (item) => (
  <View style={[styles.syncCard, item.status === 'failed' && styles.syncCardFailed]}>
    <Text style={styles.syncName}>{item.name || item.username}</Text>
    <Text style={styles.syncStatus}>{item.status.toUpperCase()}</Text>
    {item.status === 'failed' && <Text style={styles.errorText}>{item.errorMessage}</Text>}
  </View>
);
```

- [ ] **Step 2: Final Polishing & "Sync All" Button**
Add the Power Orange floating action button.

- [ ] **Step 3: Commit**
```bash
git add src/screens/OfflineSync.tsx
git commit -m "feat(ui): redesign sync queue with hollow cards and refined status"
```
