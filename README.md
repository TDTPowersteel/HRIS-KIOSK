# TDT PowerSteel Attendance System Kiosk

The TDT PowerSteel Attendance System Kiosk is a hybrid attendance tracking and verification system. It features a React Native/Expo frontend running on tablet/mobile devices, a lightweight PHP backend for local attendance storage coordination, and a Python Face Recognition server for high-accuracy facial embedding validation.

---

## 1. System Requirements & Prerequisites

Verify that your local machine has the following software installed before proceeding:

- **Node.js**: Version 18.x or newer (recommended LTS).
- **PHP**: Version 8.0 or newer. Required extensions: `curl`, `gd`, `mysqli`, `openssl`, `json`.
- **Python**: Version 3.9 or newer (for the Face Recognition Engine).
- **MySQL / MariaDB**: Version 5.7 or newer (stores local intern database `tdt_ims`).
- **Supabase Account**: A configured cloud Supabase instance for regular employee records.

---

## 2. Directory Structure

```text
HRIS-KIOSK/
├── App.tsx                     # React Native main entry point
├── app.json                    # Expo config configuration
├── package.json                # Frontend package definition
├── scripts/
│   └── dev.js                  # Local setup & server runner script
├── src/                        # React Native source files
├── face_server/                # Python Face Recognition AI Server
│   ├── app.py                  # AI Server Flask entry point
│   ├── requirements.txt        # Python library dependencies
│   └── models/                 # Downloaded models (git-ignored)
└── backend-php/                # Kiosk PHP API service
    ├── .env                    # Environment credentials
    ├── connect.php             # MySQL database connection handler
    └── record_attendance.php   # Direct DB logging API
```

---

## 3. Installation & Configuration

### 3.1. Frontend App Installation
1. Navigate to the project root and install Node packages:
   ```bash
   npm install
   ```
2. **Prebuild the Native Directories:** Because this project uses custom native modules (like Vision Camera and ONNX Runtime), you must generate the native directories (which will automatically configure the custom ONNX plugins in `app.json`):
   ```bash
   npx expo prebuild
   ```

### 3.2. PHP Backend Configuration
1. Navigate to the `backend-php` directory:
   ```bash
   cd backend-php
   ```
2. Duplicate the example environment file:
   ```bash
   cp .env.example .env
   ```
3. Open `backend-php/.env` in your editor and configure the keys:
   ```ini
   # Supabase (Employee records - Can be ignored/left empty in Intern-only Mode)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-role-key

   # MySQL Database (Intern records - REQUIRED for Intern Mode)
   IMS_DB_HOST=127.0.0.1
   IMS_DB_USER=root
   IMS_DB_PASS=your-mysql-password
   IMS_DB_NAME=tdt_ims

   # Connections & Local Network IP
   # (If running manually, replace 'localhost' with your computer's local network IP, e.g. 192.168.1.100)
   IMS_URL=http://localhost:8001
   FACE_SERVER_URL=http://localhost:5001
   EXPO_PUBLIC_BACKEND_IP=localhost
   ```

> [!NOTE]
> **Intern Mode Simplified Setup:**
> Since this kiosk defaults to **Intern Mode** (`KIOSK_MODE = 'intern'` in `connect.php`), you **do not need** to configure or set up a Supabase project. The system bypasses Supabase completely and operates solely using your local MySQL database. You only need to create the local MySQL database `tdt_ims` and configure its credentials above.

> [!TIP]
> **Automated Configuration:** If you run the system using the orchestrator command `npm run dev` (Recommended), it will automatically detect your local network IP and dynamically update `IMS_URL` and `EXPO_PUBLIC_BACKEND_IP` in your `.env` file.

### 3.3. Python Face Server Configuration
1. Navigate to the `face_server` directory:
   ```bash
   cd face_server
   ```
2. Create a virtual environment:
   ```bash
   python -m venv .venv
   ```
3. Activate the virtual environment:
   * **Windows (Command Prompt / PowerShell):**
     ```powershell
     .venv\Scripts\activate
     ```
   * **Linux / Ubuntu / macOS:**
     ```bash
     source .venv/bin/activate
     ```
4. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

---

## 4. Running the Application

You can run the kiosk ecosystem using the automated development menu (`npm run dev` - Recommended) or by launching each server manually.

### 4.1. Automated Development Menu (`npm run dev` - Recommended)
We provide an orchestrator script that automatically detects your local IP and manages startup options. Run it using:
```bash
npm run dev
```
You will be presented with a menu:
1. **Full System**: Launches the PHP Server, Python Face Server, and Expo bundler together.
2. **Backend Only**: Launches both the PHP Server and the Python Face Server.
3. **PHP Backend Only**: Launches only the PHP server on port `8000`.
4. **Python Face Server Only**: Launches only the Face Server on port `5001`.
5. **Expo Android Only**: Starts the React Native compilation.
6. **Exit**

### 4.2. Manual CLI Startup
To run the components individually without the automated menu, you must **manually configure your local network IP address** so that the mobile device can communicate with the server.

> [!WARNING]
> **Manual Network IP Configuration Required:**
> If you run manually, you must find your computer's local network IP (e.g. `192.168.1.100`) and manually update these files before starting:
> 1. **`backend-php/.env`**: Set `IMS_URL=http://<YOUR_IP>:8001` and `EXPO_PUBLIC_BACKEND_IP=<YOUR_IP>`.
> 2. **`src/config/backend.ts`**: Set the local dev URL to `http://<YOUR_IP>:8000`.

To run components individually, open separate terminal tabs and execute the following:

#### A. Start the PHP Kiosk Backend (Port 8000)
```bash
php -S 0.0.0.0:8000 -t backend-php/public
```

#### B. Start the Python Face AI Server (Port 5001)
Navigate to `face_server`, activate the virtual environment, and run:
* **Windows:**
  ```powershell
  cd face_server
  .venv\Scripts\activate
  python app.py
  ```
* **Linux / Ubuntu:**
  ```bash
  cd face_server
  source .venv/bin/activate
  python app.py
  ```
*(Note: On the first launch, the server will download the buffalo_sc and buffalo_l model files into `assets/models/`. The download `.zip` files will be automatically deleted on success).*

#### C. Start the Expo App
To compile and run the React Native frontend on your connected Android tablet or emulator:
```bash
# Option 1: Compile and run the native Android app (Required for first-time runs)
npm run android

# Option 2: Start the Expo dev server (If the app is already installed on the device)
npm run start
```

---

## 5. Production Hosting & Deployment

### 5.1. Deploying the PHP Backend
* Host the `backend-php` folder on Apache/Nginx. Point the document root to the `backend-php/public` folder.
* Ensure the production database is configured correctly.

### 5.2. Deploying the Python Face AI Server
* Place the `face_server` folder on your Linux/Ubuntu server.
* Create a Systemd service file `/etc/systemd/system/face-server.service` to run it automatically in the background:
  ```ini
  [Unit]
  Description=HRIS Face Recognition Engine
  After=network.target

  [Service]
  WorkingDirectory=/var/www/hris-kiosk/face_server
  ExecStart=/var/www/hris-kiosk/face_server/.venv/bin/python app.py
  Restart=always

  [Install]
  WantedBy=multi-user.target
  ```

### 5.3. Building the Android App Locally (Release APK)
To compile and generate the release APK directly on your local machine:

1. Run the local release compilation:
   ```bash
   npx expo run:android
   ```
2. Once complete, the production APK will be created at:
   `android/app/build/outputs/apk/release/app-release.apk`
3. Copy this APK file to your tablet and install it.

---

## 6. Troubleshooting

- **Error: "Python AI Server unreachable"**
  Ensure the Python Face Server is running on port `5001`. On Windows, verify that the virtual environment is activated before running `python app.py`.
- **Leftover .zip files bloating disk space**
  Our Python server automatically cleans up `.zip` archives upon model extraction. If downloads fail or get interrupted, manually delete any `.zip` files in `assets/models/` and restart the script to retry.
