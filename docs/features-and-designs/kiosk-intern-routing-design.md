# Design Specification: Temporary Kiosk Intern Integration Routing

This document defines the architectural routing and specifications to temporarily connect the HRIS Kiosk to the Intern Management System (IMS), enabling intern QR scanning, face verification, directory listings, and log syncs while leaving the React Native mobile app completely unmodified.

---

## 1. Architectural Overview & Context

To support intern tracking alongside employee tracking without altering the compiled Kiosk application (`HRIS-KIOSK`), the Kiosk PHP backend (`backend-php/`) will act as a routing proxy. A new configuration flag, `KIOSK_MODE`, determines whether the kiosk is in its standard employee tracking state or redirected to the intern tracking database.

```
Kiosk React Native App (Expo)
          ↓ (standard HTTP requests)
Kiosk PHP Backend (backend-php/ on Port 8000/8001)
          ↓
   [ KIOSK_MODE flag check ]
    ├── 'employee' ──> Supabase Database
    └── 'intern'   ──> Local MySQL Database (tdt_ims)
```

---

## 2. Shared PHP Variables & Settings Configuration

1. **Configuration Flag**:
   Define `KIOSK_MODE` in `backend-php/connect.php`:
   ```php
   define('KIOSK_MODE', 'intern'); // 'employee' or 'intern'
   ```
2. **Kiosk Settings Isolation**:
   When `KIOSK_MODE === 'intern'`, the settings management files (`settings.php` and `settings_store.php`) will load and save to a separate JSON file (`storage/app_settings_intern.json`) to keep the primary configuration separate.

---

## 3. Database Connection Routing

In `backend-php/connect.php`, a helper function connects to the local MySQL `tdt_ims` database using native credentials:

```php
function getImsConnection() {
    static $conn = null;
    if ($conn === null) {
        $conn = new mysqli('localhost', 'root', '', 'tdt_ims');
        if ($conn->connect_error) {
            die(json_encode(['ok' => false, 'message' => 'IMS database connection failed']));
        }
        $conn->set_charset('utf8mb4');
    }
    return $conn;
}
```

---

## 4. Endpoint Modification Specifications

### A. Employee Directory Sync (`backend-php/employees.php`)
When `KIOSK_MODE === 'intern'`, this endpoint will intercept the request and execute a query against the local MySQL `interns` table, returning a payload matching the React Native app's schema:
```php
$row = [
    'emp_id' => 'intern_' . $dbRow['id'],
    'name' => $dbRow['first_name'] . ' ' . $dbRow['last_name'],
    'role' => 'Intern',
    'qr_code' => 'TDTINTRN' . $dbRow['id'],
    'face_embedding' => $dbRow['face_embedding'] // Array of 5 arrays of 512 floats
];
```

### B. Face Verification (`backend-php/FaceVerificationHelper.php`)
Update the `fetchUserFaceData()` helper function to route queries to local MySQL if the `userId` starts with `intern_` or if `KIOSK_MODE === 'intern'`. This retrieves the intern's face embeddings and feeds them into the verification similarity loop.

### C. Attendance Log Submissions (`backend-php/record_attendance.php`)
When `record_attendance.php` receives a POST request for a user ID starting with `intern_`, it will strip the prefix and proxy the request to the IMS local attendance logging API:
`http://[host]/ims/api/record_intern_attendance.php`

---

## 5. Reversion Strategy (Removing Intern Mode)

When this temporary testing period ends, the kiosk can be reverted back to 100% employee tracking by performing these simple steps:
1. Set `define('KIOSK_MODE', 'employee');` in `backend-php/connect.php`.
2. Delete the MySQL querying blocks and the `getImsConnection` function in `connect.php` and `employees.php`.
3. Clean up the `app_settings_intern.json` file from the storage folder.
