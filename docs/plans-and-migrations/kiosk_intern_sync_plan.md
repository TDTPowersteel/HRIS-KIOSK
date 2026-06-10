# HRIS-KIOSK Intern Mode Sync and Offline Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce correct fetching of all active interns (including those without face profiles), update registration badges dynamically in details view, align backend timezones to `Asia/Manila`, cache intern details locally on-the-fly, and guard settings features.

**Architecture:** Update the PHP backend REST queries for list/detail retrieval. Add JSON indicators for face registration status. Enforce client-side sync updates inside the background sync loop to mmkv cache and hide restricted options under settings panel conditions.

**Tech Stack:** React Native, Expo, PHP, MySQL, MMKV Cache.

---

### Task 1: Backend Query & Detail Updates
**Files:**
- Modify: `HRIS-KIOSK/backend-php/employees.php`

- [ ] **Step 1: Update Intern List Query**
  Modify list query to retrieve all active interns regardless of face data, exposing `has_face_registered` virtual check.
  ```php
  // Update query in employees.php around line 177:
  $sql = "SELECT i.id, i.first_name, i.last_name, i.email, i.profile_photo, 
                 (!empty(i.face_embedding)) AS has_face_registered, d.name AS dept_name
          FROM interns i
          LEFT JOIN departments d ON i.department_id = d.id
          WHERE i.status = 'Active'";
  ```
  And update map array structure around line 218:
  ```php
  $data[] = [
      'emp_id' => 'intern_' . $row['id'],
      'name' => $row['first_name'] . ' ' . $row['last_name'],
      'role' => 'Intern',
      'dept_id' => null,
      'log_id' => 'intern_' . $row['id'],
      'has_face_registered' => (bool)$row['has_face_registered'],
      'departments' => [
          'name' => $row['dept_name'] ?? 'Internship'
      ],
      'accounts' => [
          'log_id' => 'intern_' . $row['id'],
          'username' => 'intern_' . $row['id'],
          'qr_code' => 'TDTINTRN' . $row['id'],
          'profile_picture' => $profilePhotoUrl,
          'has_face_registered' => (bool)$row['has_face_registered']
      ]
  ];
  ```

- [ ] **Step 2: Add Details Mode face registration info**
  Ensure the details fetch endpoint returned array around line 73 includes `has_face_registered`:
  ```php
  $user = [
      'emp_id' => 'intern_' . $row['id'],
      'name' => $row['first_name'] . ' ' . $row['last_name'],
      'role' => 'Intern',
      'dept_id' => null,
      'log_id' => 'intern_' . $row['id'],
      'has_face_registered' => !empty($row['face_embedding']),
      'departments' => [
          'name' => $row['dept_name'] ?? 'Internship'
      ],
      'accounts' => [
          'log_id' => 'intern_' . $row['id'],
          'username' => 'intern_' . $row['id'],
          'qr_code' => 'TDTINTRN' . $row['id'],
          'profile_picture' => $profilePhotoUrl,
          'has_face_registered' => !empty($row['face_embedding'])
      ]
  ];
  ```

- [ ] **Step 3: Validate PHP Syntax**
  Run: `php -l HRIS-KIOSK/backend-php/employees.php`
  Expected: No syntax errors detected.

---

### Task 2: Backend Timezone Alignment & Proxy Tuning
**Files:**
- Modify: `HRIS-KIOSK/backend-php/record_attendance.php`

- [ ] **Step 1: Set timezone environment**
  Enforce `date_default_timezone_set('Asia/Manila');` at the top of the file before processing requests (around line 10).

- [ ] **Step 2: Tune Proxy Connection timeouts**
  Inside the curl proxy logic block around line 40, set short network timeouts for robustness.
  ```php
  curl_setopt($ch, CURLOPT_TIMEOUT, 5);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
  ```

- [ ] **Step 3: Validate PHP Syntax**
  Run: `php -l HRIS-KIOSK/backend-php/record_attendance.php`
  Expected: No syntax errors detected.

---

### Task 3: Kiosk mode Frontend State Sync & Cache loop
**Files:**
- Modify: `HRIS-KIOSK/src/screens/EmployeeProfileData.tsx`

- [ ] **Step 1: Save state in background sync block**
  Inside `syncRemainingEmployeesInBackground` callback around line 260, parse the returned mode and keep it updated in local MMKV cache so refreshes don't revert list representation.
  ```javascript
  if (payload?.kiosk_mode) {
    mmkv.set('kiosk_mode', payload.kiosk_mode);
    if (kioskMode !== payload.kiosk_mode) {
      setKioskMode(payload.kiosk_mode);
    }
  }
  ```

- [ ] **Step 2: Update offlineUser mapping helpers**
  Verify and enrich mapping inside `updateOfflineUserCacheFromEmployees` logic, ensuring interns populate offline data properly.

---

### Task 4: UI Badging and Setting Options Guard
**Files:**
- Modify: `HRIS-KIOSK/src/screens/settings/index.tsx`
- Modify: `HRIS-KIOSK/src/screens/settings/components/EmployeeDetailsModal.tsx`

- [ ] **Step 1: Guard Settings Location row**
  Inside `settings/index.tsx`, restrict location setup.
  ```javascript
  {kioskMode !== 'intern' && (
    <SyncLocationFeature
      attendance_location={backendSettings.attendance_location}
      saveBackendSettings={saveBackendSettings}
    />
  )}
  ```

- [ ] **Step 2: Render badge inside Detail Modal**
  Inside `EmployeeDetailsModal.tsx` details render section around line 510, place a badging component:
  ```javascript
  const hasFace = activeEmployee?.has_face_registered || 
                  activeEmployee?.accounts?.has_face_registered || 
                  !!activeEmployee?.face_embedding || 
                  !!activeEmployee?.accounts?.face_embedding;

  // Render badge markup
  <View style={[styles.badgeContainer, { backgroundColor: hasFace ? '#e2fbe8' : '#fde8e8', borderColor: hasFace ? '#22c55e' : '#ef4444', borderWidth: 1, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 8, marginTop: 8 }]}>
      <Text style={{ color: hasFace ? '#16a34a' : '#dc2626', fontWeight: 'bold', fontSize: 12 }}>
          {hasFace ? 'Face ID Active' : 'Face ID Not Registered'}
      </Text>
  </View>
  ```
