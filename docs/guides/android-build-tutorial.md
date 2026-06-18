# Android Native Build & Synchronization Guide

This document outlines the standard procedure for setting up, synchronizing, and troubleshooting the native Android build environment for the **HRIS-KIOSK** project.

---

## 1. Initial Setup & Synchronization for Teammates

Since the `/android` directory and `/node_modules` are excluded from version control (`.gitignore`), any teammate pulling the project for the first time—or after dependency updates—must follow these steps to ensure a clean native environment.

### Step 1: Install Dependencies
Run the following command in the root directory:

```bash
npm install --legacy-peer-deps
```

#### Why use `--legacy-peer-deps` instead of just `npm install`?
Starting with npm v7, npm automatically attempts to install native `peerDependencies` defined by third-party packages. In complex React Native and Expo SDK 54 environments, various libraries may specify conflicting ranges for core packages like `react` (e.g., requesting v18 when Expo SDK 54 requires v19) or `react-native`. 

A standard `npm install` will detect these overlapping ranges, throw an **`ERESOLVE`** version conflict error, and completely abort the installation. Adding the `--legacy-peer-deps` flag instructs npm to bypass strict peer dependency auto-resolution and safely install the exact package versions defined in our `package.json`, matching the stable behavior of older npm versions.

### Step 2: Automatic Patching (`postinstall`)
Upon completing the dependency download, npm will automatically execute the project's `postinstall` script:
```bash
patch-package
```
This utility reads the `.patch` files stored inside the `/patches` directory and instantly applies necessary native source code compatibility fixes directly to the local `/node_modules` packages. 

---

## 2. Local Environment Configurations

### Minimum SDK Version (`minSdkVersion`)
Certain integrated modules (such as `react-native-vision-camera-face-detector`) utilize modern Android APIs that require a higher minimum SDK version than the default Expo configuration.
* **Configuration Location:** `app.json` under the `expo-build-properties` plugin.
* **Current Target:** `minSdkVersion: 26`

```json
"plugins": [
  [
    "expo-build-properties",
    {
      "android": {
        "minSdkVersion": 26
      }
    }
  ]
]
```

---

## 3. Compiling and Running the Build

To compile the native application locally, run:

```bash
npx expo run:android
```

Alternatively, if you need to regenerate the native Android folder from scratch without starting the bundler, you can use the prebuild command:

```bash
npx expo prebuild --platform android --clean
```
*(Note: Ensure you run `npm install --legacy-peer-deps` if prebuild triggers an automated package install that fails due to peer dependencies).*
