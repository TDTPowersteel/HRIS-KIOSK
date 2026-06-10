# Face Verification Threshold Standardization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the face verification threshold at 52% across the entire ecosystem to prevent false positives while maintaining accuracy.

**Architecture:** This plan applies uniform constants to the frontend utility used for local verification and the two backend PHP endpoints used for API-based verification. It also updates technical documentation to ensure long-term consistency.

**Tech Stack:** React Native (TypeScript), PHP

---

### Task 1: Update Frontend Utility Constants

**Files:**
- Modify: `src/utils/face-embedding.ts`
- Test: Manual verification of score logs in subsequent runs

- [ ] **Step 1: Update MODEL_CONFIG constants**

Modify `src/utils/face-embedding.ts`:
```typescript
export const MODEL_CONFIG = {
  name: 'buffalo_sc',
  inputSize: 112,
  channels: 3,
  matchThreshold: 0.52, // Increased from 0.35/0.50
  subThreshold: 0.45,   // Updated for multi-angle agreement
} as const;
```

- [ ] **Step 2: Commit changes**

```bash
git add src/utils/face-embedding.ts
git commit -m "feat(face): increase matchThreshold to 0.52 and update subThreshold"
```

---

### Task 2: Standardize Backend API Thresholds

**Files:**
- Modify: `backend-php/verify_face_api.php`
- Modify: `backend-php/verify_embedding.php`

- [ ] **Step 1: Update verify_face_api.php**

Modify `backend-php/verify_face_api.php`:
```php
$matchThreshold = $customThreshold ?? 0.52;
$subThreshold = 0.45;
```

- [ ] **Step 2: Update verify_embedding.php**

Modify `backend-php/verify_embedding.php`:
```php
$matchThreshold = 0.52;
$subThreshold = 0.45;
```

- [ ] **Step 3: Commit changes**

```bash
git add backend-php/verify_face_api.php backend-php/verify_embedding.php
git commit -m "feat(backend): standardize face verification thresholds to 0.52"
```

---

### Task 3: Update Legacy Similarity Engine & Documentation

**Files:**
- Modify: `src/faceEngine/similarity.ts`
- Modify: `docs/face-verification.md`

- [ ] **Step 1: Update legacy similarity utility**

Modify `src/faceEngine/similarity.ts`:
```typescript
/**
 * Verify a live embedding against a stored embedding.
 * buffalo_sc threshold guide (Updated May 2026):
 *   0.35 -> lenient
 *   0.42 -> moderate
 *   0.52 -> strict (recommended standard)
 */
export function verifyFace(
  liveEmbedding: Float32Array,
  storedEmbedding: Float32Array,
  threshold = 0.52
): { verified: boolean; score: number } {
  const score = cosineSimilarity(liveEmbedding, storedEmbedding);
  return { verified: score >= threshold, score };
}
```

- [ ] **Step 2: Update technical documentation**

Modify `docs/face-verification.md` (Update flow diagram and comparison table):
```markdown
        ▼ (Similarity Score >= 0.52)
[Identity Verified ✅]
...
| Cosine Score | Match Verdict | Action / User Feedback |
|---|---|---|
| $\ge 0.52$ | **✅ Verified Match** | Proceeds to insert attendance immediately. |
| $< 0.52$ | **❌ Mismatch** | Prompts failure modal, showing score, advising better lighting or alignment. |
```

- [ ] **Step 3: Commit changes**

```bash
git add src/faceEngine/similarity.ts docs/face-verification.md
git commit -m "docs: update face verification threshold documentation to 0.52"
```
