# Running the Face Verification Server

The HRIS Kiosk uses a local Python Flask AI Server to run high-accuracy face embedding verification (`buffalo_l` model) directly on the local network. 

There are two ways to run this server: **Automatically via Orchestrator** (Recommended) or **Manually** (for debugging/development).

---

## 🛑 Important System Requirements
Before attempting to run the server, ensure you have a **stable** version of Python installed.
- **Supported Versions**: Python 3.9, 3.10, 3.11, or 3.12.
- **DO NOT USE**: Python 3.13 or 3.14 (Bleeding-edge versions do not have pre-compiled `.whl` binaries for heavy AI libraries like `numpy` and `onnxruntime`, which will cause C++ compilation errors during installation).

---

## Method 1: The Automated Orchestrator (Recommended)

The easiest way to start the Face Server is alongside the rest of your development environment.

1. Open a terminal at the root of the `HRIS-KIOSK` repository.
2. Run the start command:
   ```bash
   npm run dev
   ```
3. The orchestrator script (`scripts/dev.js`) will:
   - Auto-detect your local Wi-Fi IP address.
   - Inject the IP into your PHP backend `.env` file.
   - Boot up the PHP Server (Port 8000).
   - Boot up the Python Face Server (Port 5001).
   - Start the Expo bundler for the tablet UI.

*Note: If the Python server crashes in the background, `npm run dev` will continue running the other services. If face verification fails in the app, check Method 2 to debug the Python server manually.*

---

## Method 2: Manual Startup (For Setup & Debugging)

If you are setting up the project for the very first time, or if you need to debug server logs, you should run it manually.

### 1. Setup the Virtual Environment
Navigate into the server folder:
```bash
cd face_server
```

Create a fresh virtual environment using a stable Python version:
```bash
python -m venv .venv
```

### 2. Activate the Environment
**Windows (PowerShell):**
```bash
.venv\Scripts\activate
```
**Linux / macOS:**
```bash
source .venv/bin/activate
```

### 3. Install Dependencies
Install the required AI libraries (ensure your `.venv` is active):
```bash
pip install -r requirements.txt
```

### 4. Run the Server
Start the application:
```bash
python app.py
```

**Expected Output on First Run:**
If this is your first time, the `insightface` library will automatically securely download the ~300MB `buffalo_sc` and `buffalo_l` model archives into the `assets/models/` folder. Subsequent runs will be instantaneous.

```text
find model: C:\...\assets\models\buffalo_l\w600k_r50.onnx
Starting HRIS Face Embedding Server on port 5001 (Production Mode)...
```
*(The server is running correctly when it hangs on this line waiting for requests).*
