# Kiosk Intern Mode UI & Settings Dynamic Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **IMPORTANT:** Do NOT execute any git commands during execution (user constraint). Skip all git commits and git actions.

**Goal:** Configure the entire Kiosk backend to dynamically switch between Employee (Supabase) and Intern (MySQL IMS) database structures based on the single configuration value `KIOSK_MODE` in `connect.php`, and update the React Native frontend screens to dynamically adjust texts, placeholders, and feature visibility according to the active mode cached in MMKV.

**Architecture:** 
1. The backend endpoints (`employees.php`, `settings.php`, `attendance_today.php`, `resolve_qr.php`, `get_face_data.php`) read the server configuration `KIOSK_MODE` and conditionally route queries to either MySQL or Supabase. They attach `'kiosk_mode'` to their JSON responses.
2. The frontend caches `'kiosk_mode'` in the local MMKV database during backend sync/fetches.
3. React Native UI elements read this cached value to dynamically swap headings, labels, search placeholders, list queries, settings layout, and warning messages.

**Tech Stack:** PHP (Backend), MySQL / Supabase (Database layer), React Native (Frontend), MMKV (Device Cache).

---

### Task 1: Update PHP Backend responses to include kiosk_mode

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/employees.php`
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/settings.php`

- [ ] **Step 1: Modify `employees.php` to attach `'kiosk_mode'` in Detail and List mode responses**

Replace the detail mode response output at line 156-163:
```php
    echo json_encode([
        'ok' => $status >= 200 && $status < 300 && $user !== null,
        'status' => $status,
        'error' => $err ?: ($user === null ? 'User not found' : null),
        'user' => $user,
        'profile_picture_hq' => $profile_picture_hq 
    ]);
```
With:
```php
    echo json_encode([
        'ok' => $status >= 200 && $status < 300 && $user !== null,
        'status' => $status,
        'error' => $err ?: ($user === null ? 'User not found' : null),
        'user' => $user,
        'profile_picture_hq' => $profile_picture_hq,
        'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
    ]);
```

And update the list mode response output at line 282-287:
```php
echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
]);
```
With:
```php
echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
    'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
]);
```

- [ ] **Step 2: Modify `settings.php` to attach `'kiosk_mode'` on GET request**

Replace the GET response at line 18-24:
```php
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        'ok' => true,
        'settings' => settings_get_public_data(),
    ]);
    exit;
}
```
With:
```php
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        'ok' => true,
        'settings' => settings_get_public_data(),
        'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
    ]);
    exit;
}
```

- [ ] **Step 3: Run PHP linter to verify syntax**

Run: `php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/employees.php`
Expected: `No syntax errors detected`

Run: `php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/settings.php`
Expected: `No syntax errors detected`


### Task 2: Make Kiosk Scanner History, QR Code Resolution, and Face Lookup dynamic in Backend

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/attendance_today.php`
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/resolve_qr.php`
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/get_face_data.php`

- [ ] **Step 1: Modify `attendance_today.php` for Intern Mode DTR query**

Update `attendance_today.php` starting from line 12:
```php
// Fetch today's attendance with joined employee and account info
$select = 'att_id,emp_id,timein,timeout,date,employees(name,log_id,accounts!log_id(username,profile_picture))';
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
            'emp_id' => $row['emp_id'],
            'name' => $emp['name'] ?? 'Unknown',
            'username' => $acc['username'] ?? 'N/A',
            'profilePicture' => $acc['profile_picture'] ?? null,
            'timein' => $row['timein'],
            'timeout' => $row['timeout'],
            'action' => $row['timeout'] ? 'clock_out' : 'clock_in',
            'time' => $row['timeout'] ?: $row['timein'],
            'date' => $row['date']
        ];
    }
}

echo json_encode(['ok' => true, 'history' => $history]);
```
With a check for intern mode that queries MySQL:
```php
if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
    $db = getImsConnection();
    $query = "SELECT d.id, d.intern_id, d.entry_date, d.time_in, d.time_out, i.first_name, i.last_name, i.profile_photo
              FROM dtr_entries d
              LEFT JOIN interns i ON d.intern_id = i.id
              WHERE d.entry_date = ? AND d.is_archived = 0
              ORDER BY d.id DESC";
    $stmt = $db->prepare($query);
    if ($stmt !== false) {
        $stmt->bind_param('s', $today);
        if ($stmt->execute()) {
            $res = $stmt->get_result();
            $history = [];
            $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http');
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            while ($row = $res->fetch_assoc()) {
                $profilePhotoUrl = null;
                if (!empty($row['profile_photo'])) {
                    $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
                }
                $history[] = [
                    'id' => $row['id'],
                    'emp_id' => 'intern_' . $row['intern_id'],
                    'name' => $row['first_name'] . ' ' . $row['last_name'],
                    'username' => 'intern_' . $row['intern_id'],
                    'profilePicture' => $profilePhotoUrl,
                    'timein' => $row['time_in'],
                    'timeout' => $row['time_out'],
                    'action' => $row['time_out'] ? 'clock_out' : 'clock_in',
                    'time' => $row['time_out'] ?: $row['time_in'],
                    'date' => $row['entry_date']
                ];
            }
            $stmt->close();
            echo json_encode(['ok' => true, 'history' => $history]);
            exit;
        }
        $stmt->close();
    }
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Failed to load intern logs']);
    exit;
}

// Fetch today's attendance with joined employee and account info
$select = 'att_id,emp_id,timein,timeout,date,employees(name,log_id,accounts!log_id(username,profile_picture))';
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
            'emp_id' => $row['emp_id'],
            'name' => $emp['name'] ?? 'Unknown',
            'username' => $acc['username'] ?? 'N/A',
            'profilePicture' => $acc['profile_picture'] ?? null,
            'timein' => $row['timein'],
            'timeout' => $row['timeout'],
            'action' => $row['timeout'] ? 'clock_out' : 'clock_in',
            'time' => $row['timeout'] ?: $row['timein'],
            'date' => $row['date']
        ];
    }
}

echo json_encode(['ok' => true, 'history' => $history]);
```

- [ ] **Step 2: Modify `resolve_qr.php` to resolve Intern QR codes (`TDTINTRN<id>`) and details**

At the top of the file logic (line 51-67), update:
```php
// Expected format: LOG_ID:<id>, LOGID:<id>, or USER:<username>|HASH:<...>|TIME:<...>
$logId = null;
$username = null;
if (preg_match('/(?:LOG_?ID|USER):([^|]+)/i', $qr, $m)) {
    $value = trim($m[1]);
    if (preg_match('/LOG_?ID:/i', $qr)) {
        $logId = $value;
    } else {
        $username = $value;
    }
}

if (!$logId && !$username) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid QR!']);
    exit;
}
```
To also extract `TDTINTRN` prefix or check intern mode:
```php
// Expected format: LOG_ID:<id>, LOGID:<id>, USER:<username>, or TDTINTRN<id>
$logId = null;
$username = null;
if (preg_match('/TDTINTRN([0-9]+)/i', $qr, $m)) {
    $logId = 'intern_' . (int)$m[1];
} else if (preg_match('/(?:LOG_?ID|USER):([^|]+)/i', $qr, $m)) {
    $value = trim($m[1]);
    if (preg_match('/LOG_?ID:/i', $qr)) {
        $logId = $value;
    } else {
        $username = $value;
    }
}

if (!$logId && !$username) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid QR!']);
    exit;
}
```

Then, at line 69, wrap the entire Supabase lookup blocks with a MySQL Intern check:
```php
if ((defined('KIOSK_MODE') && KIOSK_MODE === 'intern') || strpos($logId ?? '', 'intern_') === 0 || strpos($username ?? '', 'intern_') === 0) {
    $internId = 0;
    if ($logId && strpos($logId, 'intern_') === 0) {
        $internId = (int)str_replace('intern_', '', $logId);
    } else if ($username && strpos($username, 'intern_') === 0) {
        $internId = (int)str_replace('intern_', '', $username);
    } else {
        $internId = (int)($logId ?: $username);
    }

    $db = getImsConnection();
    $stmt = $db->prepare("SELECT i.id, i.first_name, i.last_name, i.email, i.profile_photo, i.face_embedding, d.name AS dept_name
                          FROM interns i
                          LEFT JOIN departments d ON i.department_id = d.id
                          WHERE i.id = ? AND i.status = 'Active'");
    if ($stmt === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Database error: ' . $db->error]);
        exit;
    }
    $stmt->bind_param('i', $internId);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Database query execution error']);
        exit;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'message' => 'Intern not found']);
        exit;
    }

    $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $profilePhotoUrl = null;
    if (!empty($row['profile_photo'])) {
        $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
    }

    $faceEmbedding = null;
    if (!empty($row['face_embedding'])) {
        $faceEmbedding = trim((string)$row['face_embedding']);
    }

    // Check for open attendance session in MySQL
    $openSession = null;
    $todayDate = date('Y-m-d');
    $attStmt = $db->prepare("SELECT id, entry_date, time_in, time_out 
                             FROM dtr_entries 
                             WHERE intern_id = ? AND time_out IS NULL AND is_archived = 0 
                             ORDER BY id DESC LIMIT 1");
    if ($attStmt !== false) {
        $attStmt->bind_param('i', $internId);
        if ($attStmt->execute()) {
            $attRow = $attStmt->get_result()->fetch_assoc();
            if ($attRow) {
                $openSession = [
                    'att_id' => $attRow['id'],
                    'timein' => $attRow['time_in'],
                    'date' => $attRow['entry_date']
                ];
            }
        }
        $attStmt->close();
    }

    $jsonResponse = json_encode([
        'ok' => true,
        'user' => [
            'log_id' => 'intern_' . $row['id'],
            'username' => 'intern_' . $row['id'],
            'name' => $row['first_name'] . ' ' . $row['last_name'],
            'profile_picture' => $profilePhotoUrl,
            'face_embedding' => $faceEmbedding,
            'role' => 'Intern',
            'department' => $row['dept_name'] ?? 'Internship',
            'open_session' => $openSession
        ]
    ]);
    header('Content-Length: ' . strlen($jsonResponse));
    echo $jsonResponse;
    if (ob_get_level()) ob_end_flush();
    exit;
}
```

- [ ] **Step 3: Modify `get_face_data.php` to bypass Supabase lookup in Intern mode**

Modify line 30-41 of `get_face_data.php`:
```php
if (!$userId && $username) {
    [$status, $data, $err] = supabase_request(
        'GET',
        "rest/v1/accounts?username=eq." . urlencode($username) . "&select=log_id"
    );
    if ($err || $status !== 200 || !is_array($data) || count($data) === 0) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'message' => 'Account not found by username', 'detail' => $err]);
        exit;
    }
    $userId = $data[0]['log_id'];
}
```
With:
```php
if (!$userId && $username) {
    if (strpos($username, 'intern_') === 0 || (defined('KIOSK_MODE') && KIOSK_MODE === 'intern')) {
        $userId = $username;
    } else {
        [$status, $data, $err] = supabase_request(
            'GET',
            "rest/v1/accounts?username=eq." . urlencode($username) . "&select=log_id"
        );
        if ($err || $status !== 200 || !is_array($data) || count($data) === 0) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'message' => 'Account not found by username', 'detail' => $err]);
            exit;
        }
        $userId = $data[0]['log_id'];
    }
}
```

- [ ] **Step 4: Run PHP linter to verify syntax**

Run: `php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/attendance_today.php`
Expected: `No syntax errors detected`

Run: `php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/resolve_qr.php`
Expected: `No syntax errors detected`

Run: `php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/get_face_data.php`
Expected: `No syntax errors detected`


### Task 3: Cache kiosk_mode in MMKV on React Native Frontend

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/src/utils/useAutoSync.ts`
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Update `useAutoSync.ts` to cache `kiosk_mode` in MMKV**

Import `mmkv` at the top of the file:
```typescript
import { mmkv } from './offlineUsers';
```

And in `checkAndSync()` function (around line 50), save the mode on response success:
```typescript
        if (response.ok) {
          setIsOnline(true);
          stabilityCounterRef.current += 1;
          
          try {
            const data = await response.json();
            if (data && data.kiosk_mode) {
              mmkv.set('kiosk_mode', data.kiosk_mode);
            }
          } catch (e) {}
```

- [ ] **Step 2: Update `EmployeeProfileData.tsx` to cache `kiosk_mode`**

In `fetchEmployees` response success logic (around line 319-322), save it:
```typescript
      let payload: any;
      try {
        payload = JSON.parse(responseText);
      } catch (parseErr) {
        console.log('[fetchEmployees] JSON Parse Error:', parseErr);
        throw new Error('Invalid JSON response');
      }

      if (!payload?.ok || !Array.isArray(payload?.data)) {
        console.log('[fetchEmployees] Payload validation failed:', payload);
        throw new Error('Unable to sync employee directory');
      }

      // Add this block:
      if (payload.kiosk_mode) {
        mmkv.set('kiosk_mode', payload.kiosk_mode);
      }
```

In `fetchSearchResults` (around line 410), add:
```typescript
        if (payload?.ok && Array.isArray(payload?.data)) {
          if (payload.kiosk_mode) {
            mmkv.set('kiosk_mode', payload.kiosk_mode);
          }
```


### Task 4: Dynamic titles on Home Screen and Directory List Screen

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/App.tsx`
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Modify `App.tsx` homepage button dynamic rendering**

Import `mmkv` at the top of `App.tsx`:
```typescript
import { mmkv } from './src/utils/offlineUsers';
```

Initialize `kioskMode` state inside the `App` component (around line 47):
```typescript
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });
```

And in the `useEffect` on mount (around line 56), listen for focus changes or force re-check of MMKV:
```typescript
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    getStoredTheme().then(setThemeState);
    Location.requestForegroundPermissionsAsync().catch(() => {});
    
    // Check mode whenever screen changes
    const mode = (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
    if (mode !== kioskMode) {
      setKioskMode(mode);
    }
  }, [screen]);
```

Render the dynamic homepage button text (around line 159):
```tsx
<Text style={[styles.secondaryButtonText, { color: currentTheme.text, fontSize: directoryBtnFontSize }]}>
  {kioskMode === 'intern' ? 'INTERN LIST' : 'EMPLOYEE DIRECTORY'}
</Text>
```

- [ ] **Step 2: Modify `EmployeeProfileData.tsx` headers, placeholders, and error subtexts**

Initialize state inside `EmployeeProfileData` (around line 175):
```typescript
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });
```

Update it inside `fetchEmployees` if the payload returns `kiosk_mode` (around line 324):
```typescript
      if (payload.kiosk_mode) {
        mmkv.set('kiosk_mode', payload.kiosk_mode);
        if (kioskMode !== payload.kiosk_mode) {
          setKioskMode(payload.kiosk_mode);
        }
      }
```

Update it inside `fetchSearchResults` (around line 410):
```typescript
        if (payload?.ok && Array.isArray(payload?.data)) {
          if (payload.kiosk_mode) {
            mmkv.set('kiosk_mode', payload.kiosk_mode);
            if (kioskMode !== payload.kiosk_mode) {
              setKioskMode(payload.kiosk_mode);
            }
          }
```

Update titles and subtitles in render (around line 668-672):
```tsx
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.title, { color: colors.text, fontSize: titleFontSize }]}>
            {kioskMode === 'intern' ? 'Intern List' : 'Employee Directory'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary, fontSize: subtitleFontSize }]}>
            {kioskMode === 'intern' ? 'Intern information and records.' : 'Employee information and records.'}
          </Text>
        </View>
```

Update search placeholder (around line 695):
```tsx
            placeholder={kioskMode === 'intern' ? 'Search by intern name...' : 'Search by name or role...'}
```

Update load more button text (around line 817):
```tsx
                <Text style={[styles.loadMoreText, { color: Colors.powerOrange, fontSize: loadMoreTextFontSize }]}>
                  {kioskMode === 'intern' ? 'LOAD MORE INTERNS' : 'LOAD MORE EMPLOYEES'}
                </Text>
```

Update empty sync subtext (around line 827):
```tsx
                <Text style={[styles.notSyncedSubtext, { color: colors.textSecondary, fontSize: notSyncedSubtextFontSize }]}>
                  {kioskMode === 'intern' ? 'You need to sync to load intern records.' : 'You need to sync to load employee records.'}
                </Text>
```


### Task 5: Dynamic Features List and Info Card in Settings

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/settings/index.tsx`

- [ ] **Step 1: Modify `settings/index.tsx` feature grid layout and statuses**

Import `mmkv` at the top:
```typescript
import { mmkv } from '../../utils/offlineUsers';
```

Initialize `kioskMode` state inside the `Settings` component (around line 75):
```typescript
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });
```

And in `loadSettings` response logic (around line 155-161), save the mode to MMKV and update the state:
```typescript
      const payload = await response.json();
      if (payload?.ok) {
        setIsOnline(true);
        setBackendSettings((prev) => ({
          ...prev,
          ...payload.settings,
        }));
        if (payload.kiosk_mode) {
          mmkv.set('kiosk_mode', payload.kiosk_mode);
          setKioskMode(payload.kiosk_mode);
        }
      }
```

Update the feature grid inside ScrollView (around line 428-431) to conditional-render location feature:
```tsx
            <AutoSyncFeature enabled={autoSyncEnabled} onToggle={handleAutoSyncChange} />
            <TouchlessModeFeature enabled={touchlessEnabled} onToggle={handleTouchlessChange} />
            <LivenessCheckFeature enabled={livenessEnabled} onToggle={handleLivenessChange} />
            {kioskMode !== 'intern' && (
              <SyncLocationFeature
                attendance_location={backendSettings.attendance_location}
                saveBackendSettings={saveBackendSettings}
              />
            )}
            {/* <AdminAccessFeature saveBackendSettings={saveBackendSettings} /> */}
            <OfflineRedundancyFeature isOnline={isOnline} />
```

Update storage card label description (around line 466):
```tsx
            <Text style={[styles.storageSubtext, { color: colors.textSecondary, fontSize: storageSubtextFontSize }]}>
              {kioskMode === 'intern' 
                ? 'Includes saved intern lists, pictures, and attendance logs.' 
                : 'Includes saved employee lists, pictures, and attendance logs.'}
            </Text>
```

Update confirmation modal text description (around line 511-514):
```tsx
            <Text style={[styles.modalMessage, { color: colors.textSecondary, fontSize: modalMessageFontSize }]}>
              {kioskMode === 'intern' 
                ? 'This will permanently delete all saved logs and intern pictures from this device.\n\nInternet connection will be needed to get this information back.'
                : 'This will permanently delete all saved logs and employee pictures from this device.\n\nInternet connection will be needed to get this information back.'}
            </Text>
```

Add a dynamic active database card below the Visual Style section (around line 440):
```tsx
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontSize: sectionTitleFontSize }]}>Active Connection</Text>
          </View>
          <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border, padding: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <MaterialCommunityIcons 
                name={kioskMode === 'intern' ? 'database' : 'cloud'} 
                size={24} 
                color={Colors.powerOrange} 
              />
              <View>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                  {kioskMode === 'intern' ? 'MySQL Database (Intern Mode)' : 'Supabase Cloud (Employee Mode)'}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                  {kioskMode === 'intern' ? 'Storage File: app_settings_intern.json' : 'Storage File: app_settings.json'}
                </Text>
              </View>
            </View>
          </View>
```
