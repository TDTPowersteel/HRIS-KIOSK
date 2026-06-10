# Kiosk Intern Mode UI & Settings Dynamic Customization Spec

This document details the design for updating the `HRIS-KIOSK` application to dynamically support **Intern Mode** based on the `KIOSK_MODE` constant configured on the PHP backend (`connect.php`).

## 1. Objectives
* Automatically shift the kiosk UI (both the Home screen and the Directory screen) to display "Intern List" (and related labels) instead of "Employee Directory" when `KIOSK_MODE = 'intern'` in `connect.php`.
* Restructure the Settings features dynamically in Intern Mode to hide location features (`SyncLocationFeature`) while maintaining other options like Touchless Mode, Offline Sync, and Liveness Check.
* Display the active database mode (MySQL for Interns, Supabase for Employees) in the settings screen.
* Ensure settings changes are loaded and stored in mode-specific JSON files (`app_settings_intern.json` vs `app_settings.json`).
* Ensure QR code resolution, face lookup, and today's scan history dynamically shift database connections between Supabase and MySQL based on `KIOSK_MODE`.

## 2. Backend Design Changes (PHP)

### 2.1. Single Source of Truth
* **`connect.php`**: Keep `KIOSK_MODE` defined as `'intern'` or `'employee'`:
  ```php
  define('KIOSK_MODE', 'intern'); // 'employee' or 'intern'
  ```

### 2.2. Payload Mode Exposure in `/employees.php` & `/settings.php`
* Both endpoints will return a `'kiosk_mode'` key containing the value of `KIOSK_MODE`.

### 2.3. Dynamic Scanner History (`/attendance_today.php`)
* If `KIOSK_MODE === 'intern'`, query the MySQL `dtr_entries` table joined with the `interns` table for today's logs:
  ```sql
  SELECT d.id, d.intern_id, d.entry_date, d.time_in, d.time_out, i.first_name, i.last_name, i.profile_photo
  FROM dtr_entries d
  LEFT JOIN interns i ON d.intern_id = i.id
  WHERE d.entry_date = ? AND d.is_archived = 0
  ORDER BY d.id DESC
  ```

### 2.4. Dynamic QR Scan Resolution (`/resolve_qr.php`)
* If `KIOSK_MODE === 'intern'` or the scanned QR data starts with `TDTINTRN`:
  - Extract the numeric intern ID from `TDTINTRN<id>` (or use raw log_id/username).
  - Query the MySQL `interns` table joined with `departments` to retrieve details.
  - Query `dtr_entries` to check for any open session (where `time_out` is `NULL` and `entry_date` is today or recent):
    ```sql
    SELECT id, entry_date, time_in, time_out 
    FROM dtr_entries 
    WHERE intern_id = ? AND time_out IS NULL AND is_archived = 0 
    ORDER BY id DESC LIMIT 1
    ```
  - Format the response object identically to the employee schema, substituting intern details.

### 2.5. Face Registration Lookup (`/get_face_data.php`)
* If `KIOSK_MODE === 'intern'`, bypass the Supabase API query when looking up `log_id` by username. Since intern usernames and log IDs are identical (format: `intern_<id>`), set `$userId = $username` directly.

## 3. Frontend Design Changes (React Native / Expo)

### 3.1. Caching the Mode
* **Background Sync (`useAutoSync.ts`)**: Saves the backend-returned `kiosk_mode` to local MMKV on every successful settings ping.
* **Directory Fetch (`EmployeeProfileData.tsx`)**: Saves the backend-returned `kiosk_mode` on every directory refresh or search.

### 3.2. Home Screen Updates (`App.tsx`)
* **State**: Read `kiosk_mode` from MMKV (defaulting to `'employee'`).
* **Button Text**: Dynamically render:
  - **Employee Mode**: `"EMPLOYEE DIRECTORY"`
  - **Intern Mode**: `"INTERN LIST"`

### 3.3. Directory Screen Updates (`EmployeeProfileData.tsx`)
* **State**: Track `kioskMode` initialized from MMKV.
* **UI Dynamic Texts**:
  - **Header Title**: `"Employee Directory"` ➜ `"Intern List"`
  - **Header Subtitle**: `"Employee information and records."` ➜ `"Intern information and records."`
  - **Search Placeholder**: `"Search by name or role..."` ➜ `"Search by intern name..."`
  - **Empty State Subtext**: `"You need to sync to load employee records."` ➜ `"You need to sync to load intern records."`
  - **Load More Button**: `"LOAD MORE EMPLOYEES"` ➜ `"LOAD MORE INTERNS"`

### 3.4. Settings Screen Updates (`settings/index.tsx`)
* **State**: Track `kioskMode` initialized from MMKV.
* **Feature Grid Customization**:
  - Hide `<SyncLocationFeature />` if `kioskMode === 'intern'`.
  - Maintain `<TouchlessModeFeature />`, `<LivenessCheckFeature />`, `<AutoSyncFeature />`, and `<OfflineRedundancyFeature />` regardless of mode.
* **Dynamic Warning Texts**:
  - **Used Memory Description**: `"Includes saved employee lists..."` ➜ `"Includes saved intern lists..."`
  - **Wipe Confirm Message**: `"delete all saved logs and employee pictures..."` ➜ `"delete all saved logs and intern pictures..."`
* **Backend Status Card**:
  - Render a visual connection card showing:
    - **Intern Mode**: `"MySQL Database (Intern Mode) - app_settings_intern.json"`
    - **Employee Mode**: `"Supabase Cloud (Employee Mode) - app_settings.json"`

## 4. Verification Plan
* Validate backend response payload structure from `employees.php` and `settings.php` contains the correct `kiosk_mode`.
* Verify that the Home page and Directory screens dynamically toggle text on setting `KIOSK_MODE` to `'employee'` or `'intern'` in `connect.php`.
* Verify that changing settings works correctly for both modes and updates the target backend settings JSON files.
* Test clock-ins/clock-outs on the scanner using both employee QR codes and intern QR codes (`TDTINTRN<id>`).
