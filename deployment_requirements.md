# Executive Summary: HRIS Kiosk & Face Recognition Deployment Requirements

This document outlines the business, physical hardware, and infrastructure requirements to successfully deploy the **TDT Powersteel Intern Management System (IMS)** and **HRIS Kiosk** attendance system.

---

## 1. System Overview
The system enables automated, secure attendance tracking. It has two main interfaces:
1. **The Web Registration Portal (IMS):** Used by HR to manage interns. This is also where new face registrations are added.
2. **The Attendance Kiosk (HRIS Kiosk):** Used for scanning the QR code or face for the attendance of employees/interns.

---

## 2. Infrastructure Requirements (The 3 Backend Services)
To run this system, the IT department needs to host three backend services. These can run on a single physical server PC in the IT office, or on a cloud hosting provider.

### A. Intern Management System (IMS) Website
* **Function:** Hosts the website where interns fill out their profile and register their faces. It also hosts the central MySQL database. Once an intern registers their face, the two face embedding datasets go into this IMS database, along with all clock-in/out data.
* **Requirements:** Must be open to the public internet (secured via HTTPS) so interns can access the link on their personal phones or computers from outside the office.
* **Command Used:** 
  ```bash
  php -S 0.0.0.0:8001
  ```

### B. HRIS Attendance Kiosk Backend
* **Function:** Processes clock-ins, calculates working hours, and handles local offline synchronization.
* **Requirements:** Only needs to be accessible inside the office network (Local Area Network / Wi-Fi) by the kiosk tablets.
* **Command Used:** 
  ```bash
  php -S 0.0.0.0:8000 -t backend-php/public
  ```

### C. The Face Recognition Engine (AI Server)
* **Function:** The "brain" that analyzes photos, extracts facial measurements, and verifies matches.
* **Requirements:** Runs on the same network as the kiosk backend to ensure clock-in scans are verified instantly (in under 1 second).
* **Command Used:** 
  ```bash
  # 1. Navigate to the folder
  cd face_server

  # 2. Activate the virtual environment
  # On Windows (Command Prompt):
  .venv\Scripts\activate
  # On Linux / Ubuntu:
  source .venv/bin/activate

  # 3. Start the server
  python app.py
  ```

### D. The Shared Database
* **Function:** A central storage vault that holds employee records, logs, and registered face templates.
* **Requirements:** Secure access allowed by both the Web Registration Portal and the Kiosk Backend.

---

## 3. Physical Hardware Requirements (For the Kiosk)
The Samsung Galaxy Tab A7 Lite is a budget-friendly tablet with low processing specifications. To ensure high scan accuracy and prevent scan failures, the following setup is required:

### ⚙️ Kiosk Settings: Server Mode & Offline Fallback
Because the Tab A7 Lite lacks the processing power to run heavy AI models locally, the Kiosk Application settings **must be set to "Server Mode"**. This ensures the tablet offloads the heavy lifting to **The Face Recognition Engine (AI Server)**, which is crucial for fast and accurate face verification.

* **Network Requirement:** A stable network connection to the server is needed. 
* **Offline Fallback:** If the network connection is lost or unavailable, the kiosk automatically falls back to using local face AI verification (Offline Mode) so attendance can still be logged. However, because of the Tab A7 Lite's low specifications, face scanning in this offline mode will be noticeably slower.

### 💡 External Lighting for High Accuracy
* **Why it is needed:** The front camera of the Tab A7 Lite is basic. Providing good lighting will significantly increase facial recognition accuracy and drastically lower the chance of scan failures.
* **Solution:** A neutral-white LED light should be directed toward the user's face to ensure clear, high-contrast images.

### 👤 Proper Camera Angling & Positioning
Because the tablet is often placed on a desk or counter below standard face height, it is important to make sure the employee/intern faces the camera properly. They will need to look closely and directly at the camera lens for a successful scan.

---

## 4. Intern Registration & Attendance Process

### Step 1: Intern Registers Face (From Anywhere)
1. The HR administrator managing the Intern Management System (IMS) generates a unique registration link and sends it privately to each intern.
2. The intern receives the registration link in their email.
3. They open the link on their phone/webcam and take 5 photos looking in different directions (front, left, right, up, down).
4. The system securely saves their facial data.

### Step 2: Intern Clocks In (At the Office Kiosk Tablet)
1. The intern opens the `hris-kiosk` app and stands directly in front of the tablet.
2. They **scan their QR code** first.
3. Next, the kiosk camera scans their face.
4. The server verifies the face match and logs their time-in/out instantly. 
   * **If the scan fails:** A "Face Not Recognized" modal will appear. The intern should simply close the modal, position their face better in the frame, stand steady, and try scanning again.
5. The intern waits for the **check success message** on the screen to confirm they were successfully timed in/out.
6. *(Optional)* The intern can double-check their log by tapping the **Attendance History** button (located on the upper left of the screen, next to the back button).
7. **Crucial Final Step:** After finishing, the intern must check if other interns are waiting to use the kiosk. If there is no one next in line, they must safely close the `hris-kiosk` app and always reopen the current `hris-attendance` app that regular employees are using.
8. **Offline Protection:** If the office internet goes down, the tablet will switch to offline mode automatically, letting interns scan and log attendance locally without interruption.

* **Note on App Switching:** While this new HRIS-Kiosk system is ultimately designed for all employees, the main employee backend (HRIS app and web) is still in development. As a temporary measure, this kiosk is currently connected to the IMS and is strictly **for interns only**.
