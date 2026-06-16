# Kiosk Settings Module

The HRIS Kiosk includes a protected administration panel meant only for HR managers and IT deployment staff. 

## 1. Accessing Settings
To access the Settings panel from the Home Screen:
1. Tap the **Gear Icon** in the top right corner.
2. Enter the Admin PIN. (Default: `1234`).
3. Tap "Submit".

## 2. Available Features

### Global Configuration
* **Backend URL / IPv4 Setup**: Allows the IT administrator to define the network IP address of the local PHP server so the tablet knows where to send API requests over Wi-Fi.

### Cache & Offline Management
* **Clear Face Engine Cache**: Purges the locally downloaded `w600k_mbf.onnx` AI model.
* **Clear User Cache & Offline Data**: Purges the MMKV key-value store (which holds the synced employee directory, cached profile pictures, and downloaded embeddings). Useful for forcing a fresh sync.
* **Force Offline Sync**: A quick-action button to push any pending offline attendance logs to the server.

### System Behaviors
* **Touchless Mode**: Toggles the zero-touch feature. When enabled, the scanner skips the "OK" confirmation screen and the 3-second countdown, taking a photo instantly once the user's face is aligned.
* **Liveness Detection**: Toggles the Active Eye Blink state machine. If disabled, users do not need to blink to pass verification (faster, but less secure against photo-spoofing).

## 3. Storage
Settings are stored persistently using React Native `AsyncStorage` under various keys (e.g., `touchless_enabled`, `liveness_enabled`, `backend_url_override`). They are loaded into memory instantly when the app boots.
