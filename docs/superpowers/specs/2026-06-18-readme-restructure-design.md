# Design Spec: Kiosk README.md Restructuring & Setup Tutorials

**Date:** 2026-06-18  
**Topic:** Restructure and update `C:/Users/Keith/HRIS/HRIS-KIOSK/README.md`  
**Goal:** Convert the current document into a general project README with the title "TDT PowerSteel Attendance System Kiosk", establishing a clean developer onboarding hierarchy and adding step-by-step setup/run tutorials for both backends (PHP and Python).

---

## 1. Context & Objectives

Currently, the `README.md` is titled "HRIS Attendance Kiosk Deployment Guide" which focuses heavily on deployment rather than developer onboarding and local setup. It lacks detailed configuration instructions for the Python Face Recognition server (`face_server`) and does not explain the various component startup options.

### Objectives:
1. Retitle the README to **"TDT PowerSteel Attendance System Kiosk"**.
2. Organize the content logically (Overview -> Prerequisites -> Setup -> Running -> Deploying -> Troubleshooting).
3. Add step-by-step installation guides for both PHP dependencies, MySQL database setup, and the Python virtual environment/dependencies.
4. Detail the startup commands for both automated (`npm run dev`) and manual launches (separating components).

---

## 2. Proposed Hierarchy (Approach 1)

The file will be structured into the following headers:

1. `# TDT PowerSteel Attendance System Kiosk` (Intro & Architecture)
2. `## 1. System Requirements & Prerequisites` (Required software list)
3. `## 2. Directory Structure` (Updated folder representation)
4. `## 3. Installation & Configuration` (Consolidated setup steps)
   * `### 3.1. Frontend Installation`
   * `### 3.2. PHP Backend Environment Config`
   * `### 3.3. Python Face Server Environment Config`
5. `## 4. Running the Application`
   * `### 4.1. Automated Menu Run (Recommended)`
   * `### 4.2. Manual CLI Run`
6. `## 5. Production Hosting & Deployment`
7. `## 6. Troubleshooting`

---

## 3. Detailed Tutorials Content

### Installation Section:
* **PHP Environment:** Steps to duplicate `.env.example` to `.env` and fill the variables.
* **Python Environment:**
  ```bash
  cd face_server
  python -m venv .venv
  # Windows
  .venv\Scripts\activate
  # Linux/macOS
  source .venv/bin/activate
  pip install -r requirements.txt
  ```

### Running Section:
* **Automated Runner:** Explanation of running `npm run dev` and selecting Options 1-6.
* **Manual Runner:** Copyable commands to start PHP, Python, and Expo client separately.

---

## 4. Spec Self-Review Check
* **Placeholder Scan:** No placeholders or vague requirements present.
* **Internal Consistency:** File paths and names are verified (e.g. `face_server` instead of `intern_face_reg_server`).
* **Scope Check:** Narrow, well-defined update to documentation only.
