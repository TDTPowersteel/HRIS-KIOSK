# Design Specification: Fix deleteIconFontSize Reference Error in Employee Directory

## 1. Problem Statement
In the `EmployeeProfileData.tsx` screen, a `ReferenceError` occurs when typing in the search bar: `Property 'deleteIconFontSize' doesn't exist`. The clear icon (`✕`) attempts to read `deleteIconFontSize` for its style configuration, but this variable is not defined within the scope of the component.

## 2. Goals & Success Criteria
- Resolve the `ReferenceError` completely.
- Ensure the clear button icon sizes scale responsively with screen width to match the style behavior of the text input.
- Maintain existing codebase style patterns.
- Pass TypeScript compilation checks.

## 3. Proposed Changes

### Component Sizing Definition
Define `deleteIconFontSize` in [EmployeeProfileData.tsx](file:///C:/Users/Keith/HRIS/HRIS-KIOSK/src/screens/EmployeeProfileData.tsx) under the list of responsive typography assignments (around lines 157-174).

```typescript
  const sortToggleTextFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const deleteIconFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
```

This ensures the clear button matches the font size of the search text input `searchInputFontSize` responsively.

## 4. Verification and Testing
- Run TypeScript compiler (`npx tsc --noEmit`) to verify that the error is resolved.
- Visual checking of the layout is handled by React Native layout engine.
