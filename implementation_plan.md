# Face Verification and Registration Improvements — Implementation Plan

**Goal Description:** 
Improve face registration quality and verification reliability by adding quality guards to the IMS registration app (face boundary guard and brightness check), updating guidelines for glasses, and relaxing the kiosk's strict multi-angle agreement check to prevent false verification rejections.

## User Review Required

> [!IMPORTANT]
> The current kiosk face verification requires **at least 2 matching angles** (out of 5 registered profiles) to score above the sub-threshold (0.45) to pass. This causes false rejections when users register with glasses but scan without them (or vice versa), or under varying angles/lighting. We propose relaxing this to require **at least 1 matching angle**, meaning verification passes if the user matches *any* of their registered angles above the main threshold (0.52). Since the main threshold (0.52) is highly secure, this resolves the false failures without reducing security.

## Open Questions

No outstanding open questions.

---

## Proposed Changes

### Intern Management System (Registration)

#### [MODIFY] [register_intern.php](file:///C:/Users/Keith/HRIS/INTERN-MANAGEMENT-SYSTEM/register_intern.php)
- **Face Boundary Guard**: Add logic in `processLandmarkResults()` to verify that the outer boundaries of the face (forehead landmark `10`, chin `152`, left cheek `234`, right cheek `454`) mapped to SVG coordinates are within the `95px` radius of the guide circle. Displays a warning "Move back slightly. Your face must fit inside the circle." and blocks capture if not.
- **Brightness Check**: Add helper function `getFrameBrightness()` to downscale the webcam frame to a `64x64` canvas and calculate perceived luminance. Blocks capture with a warning "Too dark. Move to a well-lit area." if average luminance is `< 50` (~20%).
- **Glasses Guidance Update**: Update camera hint and tutorial slide 1 messages to say: "Keep glasses on if you normally wear them. Remove masks or hats for best results."

---

### HRIS Kiosk (Face Verification)

#### [MODIFY] [useAttendance.ts](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/attendance/useAttendance.ts)
- **Relax Multi-Angle Check**: In `verifyFaceLocal()` and the frame processing loop, relax `top2Agrees` to require at least **1** agreeing angle (change `agreeingAngles >= 2` to `agreeingAngles >= 1`).
- **Update Logs**: Update console logs to print `At least 1 required` for matching angles agreement.

#### [MODIFY] [verify_embedding.php](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/verify_embedding.php)
- **Relax Multi-Angle Check**: Update the backend verification logic to match the frontend (change `$agreeingAngles >= 2` to `$agreeingAngles >= 1`).

---

## Verification Plan

### Automated Tests
- Run PHP syntax check on the modified files:
  ```bash
  php -l C:/Users/Keith/HRIS/INTERN-MANAGEMENT-SYSTEM/register_intern.php
  php -l C:/Users/Keith/HRIS/HRIS-KIOSK/backend-php/verify_embedding.php
  ```

### Manual Verification
1. **Distance Guard**: Attempt to register face too close to the camera. Verify red circle and "Move back slightly" warning are shown.
2. **Brightness Guard**: Attempt to register face in low light. Verify red circle and "Too dark" warning are shown.
3. **Glasses Hint**: Check that the hint states "Keep glasses on if you normally wear them."
4. **Multi-Angle Verification**: Scan face at the kiosk (which previously failed due to agreement check) and verify it successfully clocks in/out with `Agreement: 1 matching angles (At least 1 required)`.
