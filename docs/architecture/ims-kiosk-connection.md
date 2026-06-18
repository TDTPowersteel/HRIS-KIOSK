# IMS & HRIS Kiosk Connection Technical Reference

This document details the technical connection, network routing, and integration mechanisms between the **HRIS Attendance Kiosk** and the **Intern Management System (IMS)**.

---

## 1. What is a REST API & How It Is Used

### 1.1. REST API Definition
A **REST API** (Representational State Transfer Application Programming Interface) is an architectural style for web services. It allows the Kiosk React Native Client and the PHP Backend to communicate over the network using standard web protocols.

Key principles used:
1. **Client-Server Separation**: Kiosk client and backend database are independent.
2. **Statelessness**: Each request contains all information needed to process it. The server does not store active session states between requests.
3. **HTTP Methods**:
   * `GET`: Fetch data (e.g., loading directory list from `/employees.php`).
   * `POST`: Submit data (e.g., sending clock logs to `/record_attendance.php`).
4. **JSON Payload**: Communication data is formatted in JSON (JavaScript Object Notation).

### 1.2. Usage in Kiosk System
1. **QR Scanning**: Kiosk scans QR, makes `GET` request to `/resolve_qr.php?qr=...`. API returns user info and face embeddings.
2. **Logging**: Kiosk matches face, makes `POST` request to `/record_attendance.php` with ID, time, and GPS coords to store log.

---

## 2. System Integration Overview

The HRIS Kiosk React Native client does not connect directly to the IMS MySQL database. Instead, the **Kiosk PHP Backend** acts as a database router and proxy. 

Based on the `KIOSK_MODE` configuration flag, requests from the Kiosk client are routed to either the **Supabase** cloud database (for employees) or the local **IMS MySQL** database (for interns).

```
[ Kiosk React Native App (Expo Client) ]
                  │
                  ▼ (REST HTTP Requests)
         [ Kiosk PHP Backend ]
                  │
          (Check KIOSK_MODE)
                  │
      ┌───────────┴───────────┐
      ▼                       ▼
  [ Employee Mode ]       [ Intern Mode ]
  (Supabase Cloud)       (IMS MySQL Database)
```

---

## 2. Database Connection Configuration

In `backend-php/connect.php`, a global configuration constant `KIOSK_MODE` dictates database routing.

```php
define('KIOSK_MODE', 'intern'); // 'employee' or 'intern'
```

When `KIOSK_MODE` is set to `'intern'`, the helper function `getImsConnection()` is initialized to establish a connection to the local MySQL server:

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

## 3. REST API Endpoint Behaviors

### 3.1. User Resolution (`resolve_qr.php`)
Resolves the scanned QR code content.
* **Employee Mode**: Queries Supabase `profiles` table.
* **Intern Mode**: Queries MySQL database `tdt_ims` (specifically the `interns` table) for matching log IDs (`intern_<id>`) or usernames.

### 3.2. Attendance Registration (`record_attendance.php`)
Receives DTR records (Clock-In/Clock-Out logs).
* **Employee Mode**: Inserts records into the Supabase `attendance` table.
* **Intern Mode**: Intercepts requests where the user ID starts with `intern_`, strips the prefix, and forwards the payload to the local IMS record endpoint:
  `http://[host]/ims/api/record_intern_attendance.php`

### 3.3. Face Verification Proxy (`verify_embedding.php`)
Handles biometric face matching when the Kiosk is operating in **Server Mode** (designed for low-end tablets like the Samsung Tab A7 Lite).
* **Live Inference**: Receives a base64-encoded live photo from the Kiosk.
* **Dual-Model AI**: Forwards the image to the Python AI Server requesting the high-accuracy `buffalo_l` model to generate live vectors.
* **Database Routing**: Queries the user's `face_embedding_large` from either Supabase (Employees) or MySQL (Interns), performs a Cosine Similarity match against the live vectors, and returns the result to the Kiosk.

### 3.4. Directory Synchronization (`employees.php`)
Used to download the offline-caching index of employees/interns.
* **Employee Mode**: Pulls name, ID, role, and face embeddings from Supabase.
* **Intern Mode**: Queries MySQL `interns` table and formats the output structure to match the employee schema expected by the Kiosk React Native app.

---

## 4. Media & Assets Integration

* **Employee Profiles**: Loaded directly from Supabase public storage buckets.
* **Intern Profiles**: Proxied through the local IMS upload path:
  `http://[host]/ims/uploads/photos/<photo_filename>`

---

## 5. Network Requirements & Ports
* **Kiosk Client App**: Port `8081` (Metro Packager) / Compiled apk/ipa.
* **Kiosk PHP Backend API**: Port `8000` (or reverse-proxied via ngrok).
* **Local IMS Server**: Port `8001` or `/ims` route mapping.
* **Local MySQL Database**: Port `3306` (`tdt_ims` schema).
