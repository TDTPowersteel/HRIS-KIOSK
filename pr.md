# Pull Request: Comprehensive Attendance Optimization

**Title:** Real-Time Sync, High-Speed Scanning, and Face Recognition Reliability Overhaul

## Description
This PR consolidates several development phases focused on transforming the Kiosk from a locally-reliant scanner into a robust, high-performance, and server-synchronized attendance system. It addresses state-sync bugs, optimizes biometric speed, and enhances data reliability.

---

### **1. Attendance Reliability & Real-Time Sync**
- **Server-First Truth:** Eliminated the "stuck on clock-out" bug by making the database the absolute source of truth. Every QR scan now triggers a real-time check for open sessions, overriding stale local data.
- **Cross-Device Sync:** The kiosk now instantly reflects clock-outs performed on the mobile app or other devices.
- **Zombie Session Fix:** Updated the backend to allow closing unclosed sessions from previous days, preventing users from getting "stuck" in a session loop.
- **Anti-Caching:** implemented aggressive cache-busting (timestamps + No-Cache headers) to ensure network responses are always fresh.

### **2. High-Speed Face Recognition (Face++)**
- **Data Integrity Fix:** Resolved the "0% confidence" matching failure. Added smart header detection to prevent the backend from corrupting binary image data during decoding.
- **Optimized Scanning:**
    - **Backend:** Switched to an 800px / 70% quality standard to minimize network latency.
    - **Frontend:** Switched to `balanced` camera prioritization to eliminate shutter lag.
- **Resource Boost:** Increased PHP memory limits (512MB) to support high-resolution image resampling without crashes.

### **3. UI/UX & Modern Loading (Employee Directory)**
- **Instant Navigation:** Implemented a "Cache-First" bootstrap with a global in-memory cache, allowing the directory to appear instantly.
- **Modern Shimmer:** Replaced full-screen loading spinners with a high-end Animated Skeleton Shimmer effect.
- **Background Sync:** Added a silent 20-second background refresh cycle to keep data current without blocking the user.
- **Unique Key Guard:** Fixed duplicate key console warnings by implementing a strict deduplication filter for employee data.

### **4. System Utilities & Diagnostics**
- **Log Sanitization:** Added a `sanitizeForLog` helper to truncate massive Base64 strings, keeping logs readable while preserving unique identifiers.
- **Explicit Diagnostics:** The system now logs `Live Capture` vs `Database Reference` face counts to quickly identify if a failure is due to camera quality or stored data.
- **Storage Expansion:** Increased Android's `AsyncStorage` capacity from 6MB to **50MB** to handle thousands of cached profile pictures.
- **Location Services:** Added startup permission requests and a "Sync Location" feature to automatically capture kiosk coordinates.

### **5. Future-Proof Scalability & Memory Management (10k+ Employees)**
- **Extreme List Compression:** Reduced directory thumbnails to **80px width / 15% quality**. This shrinks per-employee footprint to ~1.5KB, allowing 10,000 employees to fit within 20MB of cache (well under the 50MB limit).
- **Offset Pagination:** Implemented a "Load More" system (50 items/page) to prevent PHP memory exhaustion and ensure the tablet UI remains buttery smooth even with massive datasets.
- **Hybrid HQ Fetching:** Created `employee_details.php` to fetch **High-Quality (80%)** profile pictures on-demand. HQ images are never cached, preserving storage while allowing clear visuals when viewing details.
- **Cumulative Cache Merging:** Refactored the offline sync utility to merge paginated pages into the local database rather than replacing it, ensuring all employees are available for offline QR resolution.
- **Backend Stability:** Increased PHP `memory_limit` to **512MB** and network timeouts to **30s** to handle high-traffic scaling and complex image processing.

---

**Modified Files:**
- **Frontend:** `useAttendance.ts`, `EmployeeProfileData.tsx`, `App.tsx`, `ResultModal.tsx`, `FaceScanView.tsx`, `QRScanView.tsx`, `types.ts`, `android/gradle.properties`, `index.tsx`, `src/utils/offlineUsers.ts`.
- **Backend:** `facepp_api.php`, `verify.php`, `resolve_qr.php`, `record_attendance.php`, `connect.php`, `employees.php`, `employee_details.php`.
