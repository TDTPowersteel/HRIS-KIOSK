# Face Verification Accuracy & Robustness Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to follow this verification protocol. This is a testing-focused plan.

**Goal:** Verify that the 52% threshold and cropping logic correctly distinguish between the account owner (at various distances) and other people.

**Architecture:** This plan utilizes the existing logging infrastructure in `useAttendance.ts` to collect empirical scores. It defines 3 standardized test scenarios to validate precision and recall.

**Tech Stack:** Manual Testing, Log Analysis

---

### Task 1: Prepare Verification Environment

- [ ] **Step 1: Enable Debug Logs**
Ensure `useAttendance.ts` has verbose logging enabled (already present in the current build) to output the `[Face Verification TEST METRICS]` block.

- [ ] **Step 2: Clear Session**
Scan a QR code to identify a test user, but do not complete the face scan yet.

---

### Task 2: Scenario A - Close-Range Verification (Owner)

**Goal:** Ensure 100% pass rate at normal usage distance (10-15 inches).

- [ ] **Step 1: Position at 12 inches**
Hold the tablet or stand in front of it at a natural distance. Ensure lighting is even.

- [ ] **Step 2: Trigger Verification**
Allow the auto-capture or tap verify.

- [ ] **Step 3: Record Metrics**
Check the console logs.
Expected: Score should be **> 0.60 (60%)**. Verdict: **✅ [PASSED]**.

---

### Task 3: Scenario B - Far-Range Verification (Owner)

**Goal:** Ensure the cropping logic handles smaller face sizes (3-4 feet).

- [ ] **Step 1: Position at 3-4 feet**
Stand further back until the face is still within the viewfinder but significantly smaller.
q
- [ ] **Step 2: Trigger Verification**
Wait for the readiness gate to reach 100% and fire.

- [ ] **Step 3: Record Metrics**
Check the console logs.
Expected: Score should be **> 0.52 (52%)**. Verdict: **✅ [PASSED]**.
*Note: If score is < 0.52, check if the face was centered.*

---

### Task 4: Scenario C - Cross-User Verification (Imposter)

**Goal:** Ensure a different person cannot pass as the test user.

- [ ] **Step 1: Identify as Owner, Scan as Imposter**
Scan the Owner's QR code. Then, have a **different person** stand in front of the camera.

- [ ] **Step 2: Trigger Verification**
Allow the imposter to attempt verification.

- [ ] **Step 3: Record Metrics**
Check the console logs.
Expected: Score should be **< 0.45 (45%)**. Verdict: **❌ [FAILED]**.
*Confirmation: Ensure it specifically rejects the 42.37% score reported previously.*

---

### Task 5: Accuracy Report & Finalization

- [ ] **Step 1: Summarize Results**
Compare the scores from all three scenarios.

| Scenario | Min Score | Max Score | Verdict |
|----------|-----------|-----------|---------|
| Close    |           |           | PASS    |
| Far      |           |           | PASS    |
| Imposter |           |           | FAIL    |

- [ ] **Step 2: Adjust if necessary**
If the Imposter score is too close to 52% (e.g., > 48%), consider increasing the threshold to 55%.
If the Far score is too close to 52% (e.g., < 54%), ensure the cropping padding in `useAttendance.ts` is optimal.
