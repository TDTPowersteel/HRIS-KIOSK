# Intern Tracking Mode (IMS)

The HRIS Kiosk serves a dual purpose: it can track both regular **Employees** and **Interns**. To achieve this without needing to deploy two separate physical apps, the system utilizes a powerful proxy routing logic on the backend.

## 1. How It Works

The Kiosk React Native app remains exactly the same for both employees and interns. The "switch" happens at the **PHP Backend Layer**.

In `backend-php/connect.php`, there is a configuration flag:
```php
define('KIOSK_MODE', 'intern'); // can be 'employee' or 'intern'
```

### When KIOSK_MODE = 'intern'
* **QR Resolution (`resolve_qr.php`)**: When an intern scans their QR code (e.g., `TDTINTRN42`), the PHP backend intercepts the request and queries the local **MySQL database (`tdt_ims`)** instead of the cloud Supabase database.
* **Directory Sync (`employees.php`)**: Fetches the list of interns from the `interns` table and formats them to look identical to the standard Employee schema so the Kiosk app doesn't break.
* **Attendance Logging (`record_attendance.php`)**: Forwards the clock-in/out payload to the local `http://localhost/ims/api/record_intern_attendance.php` endpoint.
* **Face Verification (`verify_embedding.php`)**: Proxies live photos to the Python AI server and compares the results against `face_embedding_large` stored in the MySQL database.

## 2. Media Routing

Intern profile pictures are hosted locally on the IMS server (`http://[host]/ims/uploads/photos/`), whereas employee photos are hosted on Supabase Storage. The backend normalizes these URLs before sending them to the Kiosk.

## 3. Disabling Intern Mode
To switch the kiosk back to tracking standard TDT Powersteel employees:
1. Open `backend-php/connect.php`.
2. Change the flag: `define('KIOSK_MODE', 'employee');`.
3. Restart the PHP server.
