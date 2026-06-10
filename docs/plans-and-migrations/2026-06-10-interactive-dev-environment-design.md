# Spec: Interactive Development Environment Scripts

## Objective
Create robust, interactive development scripts for `HRIS-KIOSK` and `INTERN-MANAGEMENT-SYSTEM` to simplify starting various services, automating IP detection, and providing flexible launch options.

## 1. HRIS-KIOSK Interactive Dev Script

### File: `HRIS-KIOSK/scripts/dev.js` (Updated)
**Logic Flow:**
1.  **Network Setup**:
    *   Scan `os.networkInterfaces()`.
    *   Prioritize 'Wi-Fi' or 'Wireless' interfaces.
    *   Update `src/config/backend.ts` with the detected IP and **Port 8000**.
2.  **Interactive Menu**:
    *   Prompt the user to select components using standard numeric input (1-4).
    *   **Option 1: PHP Backend Only** (`php -S 0.0.0.0:8000 -t backend-php/public`)
    *   **Option 2: Face Server Only** (`.venv\Scripts\python.exe app.py` in `intern_face_reg_server`)
    *   **Option 3: Expo Android**: Sub-menu for `npx expo run:android` or `npx expo run:android --device`.
    *   **Option 4: Full System**: Launch all 3 services in parallel.
3.  **Process Handling**:
    *   Use `spawn` with `stdio: ['inherit', 'pipe', 'inherit']` to capture and prefix logs.
    *   Implement a `SIGINT` (Ctrl+C) handler that sends kill signals to all child PIDs.

## 2. IMS Interactive Dev Script

### New Files:
1.  **`INTERN-MANAGEMENT-SYSTEM/package.json`**:
    *   Add `"scripts": { "dev": "node scripts/dev.js" }`.
2.  **`INTERN-MANAGEMENT-SYSTEM/scripts/dev.js`**:
    *   **Interactive Menu**:
        *   **Option 1: Local Server** (`php -S 0.0.0.0:8001`)
        *   **Option 2: Local + ngrok** (Spawns PHP on 8001 and `ngrok http 8001` in parallel).
    *   Display local and public URLs clearly in the console.

## 3. Standardization
*   **Kiosk Port**: 8000
*   **IMS Port**: 8001
*   **Python Port**: 5001
*   **IP Detection**: Always bind to `0.0.0.0` for cross-device accessibility.

## 4. Testing & Verification
*   Verify that `backend.ts` is correctly overwritten on each run.
*   Confirm that selecting "Expo --device" correctly prompts for target hardware.
*   Ensure that closing the terminal doesn't leave orphaned PHP or Python processes.
