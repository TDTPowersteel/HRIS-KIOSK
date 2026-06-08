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

## 2. Database Changes (DTR MySQL)

We will modify the `interns` table in the MySQL database (`tdt_ims`) of the DTR system.

```sql
ALTER TABLE interns 
ADD COLUMN qr_code VARCHAR(255) NULL UNIQUE,
ADD COLUMN face_embedding LONGTEXT NULL;
```

- **`qr_code`**: Stores the unique QR code payload. Format: `INTERN:<id>|HASH:<hash>|TIME:<ts>`.
- **`face_embedding`**: Stored as a JSON string array of arrays (shape: `[[512 floats], [512 floats], [512 floats], [512 floats], [512 floats]]`).

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

## 5. Phone-Based Face Registration Web App

Interns will register their face using their phone browser (cross-platform, zero app install).

```
┌────────────────┐     Capture 5 angles      ┌───────────────┐
│ Intern Phone   │ ────────────────────────→ │ Python Flask  │
│ (HTML5 Camera) │ ←──────────────────────── │ (ONNX Server) │
└────────────────┘      JSON Embeddings      └───────┬───────┘
                                                     │
                                                     ▼
                                             ┌───────────────┐
                                             │ MySQL DB      │
                                             └───────────────┘
```

### Flow:
1. **Guided Capture Web UI**:
   - Intern logs into their intern portal or accesses a secure registration page.
   - Camera opens in the browser. Guided outline prompts the user:
     - Close Center (Looking straight)
     - Far Center (Farther back)
     - Left (Slight horizontal turn)
     - Right (Slight horizontal turn)
     - Up (Slight chin up)
2. **Server-side ONNX Embedding Generation**:
   - The phone browser uploads the 5 raw images as base64 to a Python Flask/FastAPI service running on the DTR server.
   - Python loads the `w600k_mbf.onnx` model (matching the kiosk).
   - Preprocesses images (resizes to 112x112, normalizes to `[-1, 1]` range, shapes as `[1, 3, 112, 112]`).
   - Runs inference to extract 512-dimensional vectors.
   - L2-normalizes the vectors.
   - Saves them as a JSON array of arrays in MySQL `interns.face_embedding`.
   - Generates and saves a unique QR code in `interns.qr_code`.

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
