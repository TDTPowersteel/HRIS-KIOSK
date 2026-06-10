# HRIS Kiosk Mode Switching & Deployment Guide

This guide describes how to switch the `HRIS-KIOSK` between **Employee Mode** and **Intern Mode**, how the database layers differ, and how to deploy the system in a production or staging environment (like Webmin, cPanel, or standard Apache/MySQL servers).

---

## 1. Switching Modes (Single-Line Toggle)

The entire kiosk backend and frontend are controlled by a single source of truth configuration constant defined on the backend.

### How to Toggle:
1. Open the backend connection helper file:
   - `C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/connect.php`
2. Locate the `KIOSK_MODE` definition (around line 53):
   ```php
   // To enable Intern Mode (MySQL IMS Backend):
   define('KIOSK_MODE', 'intern');

   // To enable Employee Mode (Supabase Cloud Backend):
   define('KIOSK_MODE', 'employee');
   ```
3. Save the file. The React Native mobile app will automatically detect the mode on the next background settings check or directory sync, update its local MMKV cache, and adapt all labels/settings features dynamically without needing to rebuild the app.

---

## 2. Technical Comparison of Modes

| Feature | Employee Mode (`employee`) | Intern Mode (`intern`) |
| :--- | :--- | :--- |
| **Primary Database** | Supabase Cloud (PostgreSQL) | Local MySQL (`tdt_ims`) |
| **Employee/User Table** | `employees` (Supabase) | `interns` (MySQL) |
| **Authentication Table** | `accounts` (Supabase) | `interns` (MySQL) |
| **Attendance Log Table** | `attendance` (Supabase) | `dtr_entries` (MySQL) |
| **Local Settings Storage** | `app_settings.json` | `app_settings_intern.json` |
| **Settings Features** | Full Options (Incl. Location Sync) | Location Sync disabled |
| **QR Code ID Prefix** | Raw Log ID / Username | `TDTINTRN<id>` |

---

## 3. Database Configurations & Schemas

### 3.1. Supabase Cloud (Employee Mode)
The connection to Supabase uses REST endpoints configured via the following variables in the backend `.env` file:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_anon_public_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3.2. MySQL Database (Intern Mode)
The connection to the local MySQL server runs through the `mysqli` extension and is defined by the following variables in the backend `.env` file:
```env
IMS_DB_HOST=localhost
IMS_DB_USER=root
IMS_DB_PASS=
IMS_DB_NAME=tdt_ims
```
* The backend automatically connects using the database specified. In Intern Mode, the schema matches the Intern Management System (IMS).

---

## 4. Deployment Guide (Webmin / Apache / MySQL)

### 4.1. Webmin / Virtualmin Apache Configuration
If you are deploying the backend PHP scripts inside Webmin, configure your Apache Virtual Host to serve the `backend-php` directory.

Example Apache Virtual Host block (`/etc/apache2/sites-available/kiosk-backend.conf`):
```apache
<VirtualHost *:8001>
    ServerAdmin webmaster@localhost
    DocumentRoot /home/username/public_html/HRIS-KIOSK/backend-php
    
    <Directory /home/username/public_html/HRIS-KIOSK/backend-php>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/kiosk_error.log
    CustomLog ${APACHE_LOG_DIR}/kiosk_access.log combined
</VirtualHost>
```

### 4.2. File Permissions
Ensure the web server (usually `www-data` on Linux / Webmin) has write permissions to the storage directory to write the configuration files:
```bash
chmod -R 775 /home/username/public_html/HRIS-KIOSK/backend-php/storage
chown -R www-data:www-data /home/username/public_html/HRIS-KIOSK/backend-php/storage
```
This enables the backend to safely read and write the dynamic configuration settings files:
- `storage/app_settings.json` (Employee settings)
- `storage/app_settings_intern.json` (Intern settings)

### 4.3. MySQL Database Setup
When deploying to production MySQL (Webmin databases):
1. Import the database schema from your IMS database.
2. Ensure the `interns` table has the following columns for face verification to work:
   - `face_embedding` (TEXT or LONGTEXT, to store JSON arrays of [512] floats).
   - `profile_photo` (VARCHAR, matching the file name in `uploads/photos/`).
3. Ensure the `dtr_entries` table is initialized to keep logs:
   - `intern_id` (INT)
   - `entry_date` (DATE)
   - `time_in` (TIME)
   - `time_out` (TIME)
   - `is_archived` (TINYINT)

---

## 5. Troubleshooting Mode Mismatch
If the React Native app doesn't show "Intern List" after you changed the backend `connect.php` constant:
1. Ensure the app is online (settings background sync ping runs every 30 seconds).
2. Or open the **Settings Screen** in the app and tap **Refresh** or **Sync Now** to trigger an immediate fetch of `/settings.php`, which will update the cached mode.
3. Check the **Active Connection** card in the Settings panel; it should display `"MySQL Database (Intern Mode)"`.
