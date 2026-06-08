# Spec: HRIS-Kiosk Intern DTR System Integration Design

This document details the architectural design to connect the existing `HRIS-KIOSK` (used by employees) with the separate `TDRPowersteel IMS` (DTR system used by interns) without disrupting the Supabase connections.

---

## 1. Architectural Overview

```
                      ┌───────────────────────────────────────────────┐
                      │                 HRIS-KIOSK                    │
                      │                 (Expo App)                    │
                      └──────────────────────┬────────────────────────┘
                                             │
                               QR Code Prefix Routing
                                             │
                      ┌──────────────────────┴────────────────────────┐
                      │                 PHP Backend Router            │
                      └──────────────┬────────────────────────┬───────┘
                                     │                        │
                             LOGID:  │                INTERN: │
                                     ▼                        ▼
                       ┌─────────────────────────┐      ┌─────────────┐
                       │ Supabase REST API       │      │ DTR MySQL   │
                       │ (Employee DB)           │      │ (Intern DB) │
                       └─────────────────────────┘      └─────────────┘
```

---

## 2. Database & Config Changes (DTR System)

### 2.1 Database Schema Alterations
We will modify the `interns` table in the MySQL database (`tdt_ims`) of the DTR system.

```sql
ALTER TABLE interns 
ADD COLUMN qr_code VARCHAR(255) NULL UNIQUE,
ADD COLUMN face_embedding LONGTEXT NULL,
ADD COLUMN registered_at DATETIME NULL;
```

- **`qr_code`**: Stores the unique QR code payload. Format: `INTERN:<id>|HASH:<hash>|TIME:<ts>`.
  - **`<hash>`**: A reproducible, tamper-proof signature verifying that the QR code was officially generated. It is calculated by taking the first 8 characters of an HMAC-SHA256 hash using the Intern ID, the timestamp, and a secret server salt/pepper:
    `$hash = substr(hash_hmac('sha256', "INTERN:{$id}|TIME:{$timestamp}", 'TDRPowersteelInternSalt2026!'), 0, 8);`
- **`face_embedding`**: Stored as a JSON string array of arrays (shape: `[[512 floats], [512 floats], [512 floats], [512 floats], [512 floats]]`).
- **`registered_at`**: Logs the exact date and time the intern completed their Face ID registration (differentiated from `created_at` which is when their profile was first seeded/created).

### 2.2 Timezone Setup (Philippine Standard Time)
Since the server might be hosted in a different cloud timezone, we must set the PHP default timezone globally in the DTR configuration file `config/db.php`:
```php
date_default_timezone_set('Asia/Manila');
```
This ensures that `date('Y-m-d')` and `date('H:i:s')` always output the correct Philippine Standard Time (UTC+8) when recording clock-ins and clock-outs.

---

## 3. Kiosk Application Changes (`HRIS-KIOSK`)

### Dynamic QR Code Parsing
`useAttendance.ts` will parse the scanned QR code and split logic by prefix:

1. **Employee Flow (`LOGID:`)**:
   - Calls the existing backend endpoints which talk to Supabase.
   - Fetches the employee's `face_embedding` (512-dim).
   - Runs local ONNX verification.
   - Performs employee clock-in/out via `record_attendance.php`.

2. **Intern Flow (`INTERN:`)**:
   - Calls new intern-specific backend endpoints.
   - Fetches the intern's `face_embedding` (512-dim) from the MySQL database.
   - Runs the same local ONNX verification algorithm (`compareMultiAngleEmbeddings`).
   - Performs intern clock-in/out via `log_intern_attendance.php`.

---

## 4. DTR PHP Backend Router Endpoints

We will add two new endpoints to the DTR system's backend to service the kiosk requests:

1. **`api/verify_intern_qr.php`**:
   - Accepts the QR code.
   - Queries MySQL `interns` table.
   - Checks `dtr_entries` for today's entries to determine if `clock_in` or `clock_out`.
   - Returns: Intern name, ID, profile picture, face embedding array.

2. **`api/record_intern_attendance.php`**:
   - Accepts: intern ID, action (`clock_in` or `clock_out`), date, time.
   - Inserts/updates `dtr_entries` table.
   - Triggers MySQL generated columns to auto-calculate hours.

---

## 5. Intern Account Linking & Face Registration Workflow (Web App)

Since intern profiles are pre-seeded by HR in the DTR system without emails, but not all interns are pre-seeded, the web app uses a **Hybrid Search-and-Link** flow. This matches existing records by Name (preventing duplication of teammates' existing logs) and creates new records only for new interns.

### 5.1 Registration Flow Steps

- **Step 1: Profile Selection or Name Input**:
  - Intern can select their name from a dropdown of active, unregistered interns:
    `SELECT id, first_name, last_name FROM interns WHERE face_embedding IS NULL AND status = 'Active' ORDER BY first_name ASC`
  - If their name is not on the list, they can select "Register New Profile" and type in their **First Name**, **Last Name**, **Middle Name**, and select their **Department** (loaded from the `departments` table).
  - Intern inputs/verifies their **Email Address**.
- **Step 2: Profile Picture Upload**:
  - Intern uploads or captures a headshot photo for the directory profile.
- **Step 3: Face Capture (5 Angles)**:
  - Phone camera opens. Guided UI captures 5 angles (Center-Close, Center-Far, Left, Right, Up).
- **Step 4: Submission, Matching & Activation**:
  - Web page submits the photos, email, names, department, and selected Intern ID (if selected from list).
  - Python service generates 512-dim embeddings.
  - The PHP script checks for name duplicates if a new profile was typed:
    `SELECT id FROM interns WHERE first_name = ? AND last_name = ?`
  - **Match Found (Linking):** If matched (either chosen via dropdown or resolved by name match in backend), the PHP script **updates** the existing record (saving `email`, `profile_photo`, `face_embedding`, and generating `qr_code`) to preserve their historical DTR hours.
  - **No Match Found (Create New):** The PHP script runs an `INSERT` statement to create a new intern profile.
  - Web page displays the generated QR code for download.

---

## 6. Free Cloud Deployment Plan

We will deploy the entire DTR system on a single **Oracle Cloud Always Free VM** (Ubuntu Linux).

1. **Web Server (Apache/PHP)**:
   - Serves the DTR web portal (admin and intern views).
   - Serves the DTR PHP router endpoints.
2. **Database (MySQL)**:
   - Hosts the `tdt_ims` database locally inside the VM.
3. **Python ONNX Microservice**:
   - Python API running inside a virtual environment on port `8000` via `gunicorn` or `uvicorn`.
4. **DDNS + SSL**:
   - Free DDNS (DuckDNS) points to the VM's public IP.
   - Let's Encrypt (Certbot) generates free SSL certificates to secure the registration webcam requests (HTTPS is required for camera permissions in mobile browsers).

---

## 7. Device Fallback Strategy

If the official company tablet is unavailable, the kiosk app is designed to run on alternative devices:

- **Any Android Device (Recommended Fallback)**:
  - Since the kiosk is a React Native/Expo app, we can compile a standard Android APK.
  - The APK can be installed on any affordable Android smartphone or tablet.
  - The device can be mounted at the office entrance using a secure stand.
