# HRIS Attendance Kiosk Deployment Guide

The HRIS Attendance Kiosk is a hybrid attendance verification system. It features a React Native/Expo frontend running on a tablet or mobile device and a lightweight PHP backend that coordinates attendance storage with both a cloud Supabase database (for employees) and a local MySQL database (for interns).

---

## 1. System Requirements & Prerequisites

To deploy and run the system, verify that your environment has the following components:

- **Node.js**: Version 18.x or newer (recommended LTS).
- **PHP**: Version 8.0 or newer. Required extensions: `curl`, `gd`, `mysqli`, `openssl`, `json`.
- **MySQL**: Version 5.7 or newer (used for the local Intern Management System database `tdt_ims`).
- **Supabase Project**: A configured cloud Supabase instance with an `attendance` table.
- **Expo CLI & EAS**: For building and distributing the React Native mobile application.

---

## 2. Directory Structure

```text
HRIS-KIOSK/
├── App.tsx                     # Main React Native entry point
├── app.json                    # Expo configuration file
├── package.json                # Frontend dependencies and scripts
├── scripts/
│   └── dev.js                  # Local development orchestration script
├── src/
│   ├── config/
│   │   └── backend.ts          # Frontend API URL configuration
│   ├── screens/
│   │   ├── attendance/
│   │   │   └── useAttendance.ts # Attendance and face scanning state machine
│   │   └── settings/
│   │       └── index.tsx       # Kiosk administrator settings screen
│   └── utils/
│       ├── offlineAttendance.ts # Local SQLite/AsyncStorage attendance queue
│       └── useAutoSync.ts      # Background sync mechanism hook
└── backend-php/                # Kiosk backend PHP API service
    ├── .env.example            # Environment template file
    ├── connect.php             # Database connection and helper utilities
    ├── resolve_qr.php          # Resolves QR codes to user profiles
    ├── verify_embedding.php    # Submits embedding to verification algorithm
    └── record_attendance.php   # Performs clock-in/out updates
```

---

## 3. Local Development Setup

We provide an automated setup script to launch the local PHP backend and Expo bundler concurrently.

1. **Install Frontend Dependencies**:
   Navigate to the kiosk directory and run:
   ```bash
   npm install
   ```

2. **Configure Local Environment**:
   Duplicate the example environment file in the backend folder:
   ```bash
   cp backend-php/.env.example backend-php/.env
   ```
   Open `backend-php/.env` and fill in your Supabase credentials and MySQL database connections (see Section 4).

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   The `node scripts/dev.js` script will:
   - Auto-detect your local IPv4 address (prioritizing Wi-Fi/Wireless LAN interfaces).
   - Write this IP address directly to [backend.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/config/backend.ts) so that physical mobile devices on the same Wi-Fi subnet can connect to the host.
   - Start the local PHP built-in server on port `8000`.
   - Start the Expo development server.

---

## 4. Backend Environment Variables (`.env`)

Create a `.env` file in the [backend-php](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php) directory containing these keys:

```ini
# Supabase Configuration (For Employee Attendance)
SUPABASE_URL=https://your-supabase-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# MySQL Database Configuration (For Intern Management System)
IMS_DB_HOST=127.0.0.1
IMS_DB_USER=root
IMS_DB_PASS=your-mysql-password
IMS_DB_NAME=tdt_ims

# Intern Management System (IMS) Server URL
# The kiosk backend proxies intern clock-in/out events to this endpoint
IMS_URL=http://localhost:8001

# Face Recognition Settings
# Options: 'local' (performs cosine similarity checks on-device and on PHP backend)
# External API fallback config (if used):
FACE_VERIFY_MODE=local
FACEPP_API_KEY=your-faceplusplus-key
FACEPP_API_SECRET=your-faceplusplus-secret
LUXAND_API_TOKEN=your-luxand-token
```

---

## 5. Production Deployment

### 5.1. Deploying the Backend API (Render Example)

You can host the PHP backend folder on Render, Heroku, or any virtual private server running Apache/Nginx.

1. **Set Up a Web Service**:
   - Create a new web service on your hosting provider.
   - Set the root directory to the repository or copy the [backend-php](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php) folder to a dedicated branch.
   - Set the build command (if applicable) or select the **PHP** environment.

2. **Add Environment Variables**:
   In your hosting service's environment settings, add the keys defined in Section 4. 
   > [!IMPORTANT]
   > Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in production to allow bypassing Row Level Security (RLS) when storing attendance entries.

3. **Configure SSL / HTTPS**:
   - The React Native frontend requires secure `https://` connections to communicate with production endpoints. Ensure your host has SSL enabled (Render provides this automatically).

4. **Verify Backend Status**:
   Visit `https://your-backend-domain.com/settings.php` in a browser. It should return a JSON payload with `kiosk_mode` and server status.

### 5.2. Building & Deploying the Expo App

To distribute the kiosk application to tablet devices:

1. **Configure Production URL**:
   Ensure [backend.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/config/backend.ts) points to your production backend domain. Edit the production condition:
   ```typescript
   export const BACKEND_URL = __DEV__ 
     ? 'http://<your-detected-lan-ip>:8000' 
     : 'https://your-backend-domain.com';
   ```

2. **Setup EAS Credentials**:
   Initialize Expo Application Services (EAS):
   ```bash
   npm install -g eas-cli
   eas login
   eas project:init
   ```

3. **Generate Android APK/AAB**:
   Configure `eas.json` to produce an APK for sideloading on your kiosk tablet:
   ```json
   {
     "build": {
       "preview": {
         "android": {
           "buildType": "apk"
         }
       },
       "production": {}
     }
   }
   ```
   Run the build command:
   ```bash
   eas build --platform android --profile preview
   ```
   Once finished, download the generated APK from the Expo dashboard and install it on the kiosk device.

---

## 6. Troubleshooting

- **Error: "No face recognition provider configured on server"**:
  This happens when `FACE_VERIFY_MODE` is not configured or fails to default in the backend `.env`. Verify that your environment variables are correctly loaded in Render or Apache.
  
- **Clock-In Offline Fallback**:
  If the kiosk is online, it will try to record directly to the server. If it fails due to network instability, it falls back to the local device queue. Administrators can visit the **Offline Sync** screen inside settings to view queue status, trigger manual synchronization, or delete stuck/failed items.
