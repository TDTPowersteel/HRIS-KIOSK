# Interactive Kiosk Refinement Design

## Background & Motivation
To improve the user experience and maintain a "Strict & Minimal" kiosk configuration, we are refining the feedback loop and simplifying the administration interface. The system needs clearer auditory signals for successful/failed actions and a less cluttered settings menu.

## Proposed Changes

### 1. Settings Simplification
- **Removal**: Remove the `ReportingIntervalFeature` component from the Settings screen.
- **Rationale**: Kiosks should operate on a reliable, standardized sync cycle (default 5 minutes). Manual adjustment is a low-value feature that adds unnecessary complexity to the UI.

### 2. Enhanced Auditory Feedback
- **QR Success**: Play a distinct "Chime/Beep" when a QR code is recognized.
- **Face Success**: Play a "Camera Shutter" followed by a "Success Chime" when verification passes.
- **Verification Failure**: Play a distinct "Error/Buzzer" sound when face verification fails.

## Architecture & Data Flow

### Settings Update
- **File**: `src/screens/settings/index.tsx`
- **Action**: Remove the import and usage of `ReportingIntervalFeature`.
- **Backend Sync**: The app will continue to use the current `attendance_interval_minutes` returned by the server, but admins won't change it from this device.

### Audio Integration
- **File**: `src/screens/attendance/useAttendance.ts`
- **Asset Loading**: Ensure the necessary sounds are loaded during the initialization phase.
- **Trigger Points**:
  - `handleBarcodeScanned`: Play QR Success sound.
  - `executeFaceVerification` (Success): Play Verification Success sound.
  - `executeFaceVerification` (Failure): Play Verification Failure sound.

## Verification & Testing
1. **Settings Verification**: Open Settings and ensure "Reporting Interval" is gone. Verify "System Logout" and other rows remain correctly aligned.
2. **QR Sound Test**: Scan a valid QR code and verify the success chime plays.
3. **Face Success Test**: Complete a valid face scan and verify the success sequence (Shutter + Chime) plays.
4. **Face Failure Test**: Attempt a scan with an incorrect person/face and verify the failure buzzer plays.
