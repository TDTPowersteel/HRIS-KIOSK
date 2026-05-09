# Project Context: Kiosk Attendance App

## 🌟 Overview
**TDT Powersteel Kiosk** is a dedicated attendance monitoring application designed to be used in a kiosk setting (e.g., tablet at an office entrance). It allows employees to clock in and out using QR codes and face verification. It is built to be resilient, supporting both real-time synchronization and offline modes for areas with unstable internet.

## 📱 Use Cases
- **QR Attendance:** Employees scan their personal QR codes to initiate attendance.
- **Face Verification:** Biometric verification using Face++ or Luxand to ensure the person clocking in/out is the actual employee.
- **Attendance Management:** Records "Clock In" and "Clock Out" events with timestamps.
- **Offline Sync:** Allows attendance to be captured locally when the server is unreachable and synced later once a connection is established.
- **Employee Directory:** View employee profile data and department information.
- **Kiosk Configuration:** Admins can set attendance location, interval, and manage security settings.

## 🛠 Tech Stack
### Frontend
- **Framework:** [Expo](https://expo.dev/) / [React Native](https://reactnative.dev/)
- **Language:** TypeScript
- **UI Components:** Custom React Native components with specialized styling for kiosk displays.
- **Storage:** `@react-native-async-storage/async-storage` for local cache and offline queues.
- **Hardware Integration:** `expo-camera` for QR scanning and face capture.

### Backend
- **Language:** Native PHP (v8.2+)
- **Database:** [Supabase](https://supabase.com/) (PostgreSQL via REST API)
- **Face Recognition Providers:**
  - **Face++ (Megvii):** Primary biometric verification provider.
  - **Luxand Face API:** Alternative biometric provider.
- **Infrastructure:** Dockerized PHP-Apache setup, designed for deployment on [Render](https://render.com/).

## 🏛 Architecture
- **Kiosk-Backend-Supabase Flow:** The Expo app communicates with the custom PHP backend, which acts as a secure middleware to interact with Supabase and third-party Face APIs.
- **Offline-First Logic:** Attendance events are enqueued in local storage if offline mode is enabled or if the server is unreachable, allowing for bulk synchronization later.
- **Security:** Administrative settings (location, interval, password) are stored locally on the backend in JSON format for fast access and persistence.

## 📂 Directory Structure
- `src/screens/`: Main application screens (`ShowQRScan`, `EmployeeProfileData`, `Settings`, `OfflineSync`).
- `src/utils/`: Logic for offline users and attendance queue management.
- `backend-php/`: Native PHP scripts for API endpoints.
  - `public/`: Web root for the PHP backend.
  - `storage/`: Local JSON storage for app settings.
- `assets/`: Static icons and splash screens.

## 🚀 Development & Deployment
- **Local Development:** Run `expo start` for the frontend and a local PHP server for the backend.
- **Environment Config:** Managed via `.env` files (Face API keys, Supabase credentials).
- **Deployment:** The backend is deployed via the included `Dockerfile` to Render. The frontend is built into an APK using EAS (Expo Application Services).

---
*Last Updated: May 9, 2026*
