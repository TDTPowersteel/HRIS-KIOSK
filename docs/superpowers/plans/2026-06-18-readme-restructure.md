# Kiosk README.md Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the kiosk README.md to serve as a general developer onboarding guide, retitling it to "TDT PowerSteel Attendance System Kiosk" and adding complete installation and execution tutorials for the PHP and Python backends.

**Architecture:** We will modify the repository README.md file in two main steps. The first task will overwrite the top half (Title, Overview, Prerequisites, and Setup), and the second task will overwrite the bottom half (Running, Deploying, and Troubleshooting).

**Tech Stack:** Markdown / GFM (GitHub Flavored Markdown).

---

### Task 1: Update README Header and Setup Guide

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/README.md`

- [ ] **Step 1: Write the updated top half of the README.md**
  
  Overwrite lines 1 to 104 of `README.md` with the new project title, prerequisites, directory structure, and comprehensive installation tutorials.
  
  Code to replace with:
  ```markdown
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
  Navigate to the project root and install Node packages:
  ```bash
  npm install
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
     # Supabase (Employee records)
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_ANON_KEY=your-anon-key
     SUPABASE_SERVICE_ROLE_KEY=your-role-key
  
     # MySQL Database (Intern records)
     IMS_DB_HOST=127.0.0.1
     IMS_DB_USER=root
     IMS_DB_PASS=your-mysql-password
     IMS_DB_NAME=tdt_ims
  
     # Connections
     IMS_URL=http://localhost:8001
     FACE_SERVER_URL=http://localhost:5001
     ```
  
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
  ```

- [ ] **Step 2: Save and verify the top half matches**
  Ensure the replaced section compiles cleanly as markdown. (Note: Since user requested no git commands, skip git commit steps).

---

### Task 2: Update README Running, Deploying, and Troubleshooting Sections

**Files:**
- Modify: `C:/Users/Keith/HRIS/HRIS-KIOSK/README.md`

- [ ] **Step 1: Write the updated bottom half of the README.md**
  
  Overwrite lines 105 to 176 of `README.md` with the new "Running the Application", "Production Deployment", and "Troubleshooting" sections.
  
  Code to replace with:
  ```markdown
  ## 4. Running the Application
  
  You can run the kiosk ecosystem using the automated development menu or by launching each server manually.
  
  ### 4.1. Automated Development Menu (Recommended)
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
  ```bash
  npx expo start
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
  
  ### 5.3. Building the Expo App
  Set up EAS CLI and run:
  ```bash
  eas build --platform android --profile preview
  ```
  Install the generated APK onto your tablet.
  
  ---
  
  ## 6. Troubleshooting
  
  - **Error: "Python AI Server unreachable"**
    Ensure the Python Face Server is running on port `5001`. On Windows, verify that the virtual environment is activated before running `python app.py`.
  - **Leftover .zip files bloating disk space**
    Our Python server automatically cleans up `.zip` archives upon model extraction. If downloads fail or get interrupted, manually delete any `.zip` files in `assets/models/` and restart the script to retry.
  ```

- [ ] **Step 2: Save and verify the bottom half matches**
  Ensure the markdown is complete, with no placeholders, and represents a clean user guide.
