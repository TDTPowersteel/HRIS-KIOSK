# HRIS-KIOSK Testing Tutorial

This guide provides an overview of the automated testing setup used in the HRIS-KIOSK application, specifically detailing how to write and run tests for our component features using Jest and the React Native Testing Library.

## Overview

The application utilizes **Jest** as its test runner, configured with `jest-expo` to handle Expo and React Native specifics. 

### Key Dependencies:
- `jest`
- `jest-expo`
- `@testing-library/react-native`
- `@types/jest`

## Configuration

### 1. `jest.setup.js`
Since React Native relies heavily on native APIs (like camera, location, AsyncStorage) which don't exist in a Node.js testing environment, we mock these globally in `jest.setup.js`.

```js
// Example from jest.setup.js
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 14.0, longitude: 120.0 }
  }),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([
    {
      name: 'TDT Powersteel',
      street: '123 Steel Road',
      city: 'Manila',
      region: 'NCR',
      country: 'Philippines'
    }
  ])
}));
```

### 2. `package.json`
Jest is configured to use the `jest-expo` preset and load the setup file.
```json
"jest": {
  "preset": "jest-expo",
  "setupFilesAfterEnv": ["<rootDir>/jest.setup.js"]
}
```

## Running Tests

To execute the test suite, run the following command in your terminal:
```bash
npm test
```
This will run all files matching `*.test.tsx` or `*.test.ts` within the `__tests__` directory.

## Writing a Component Test

Tests are typically placed in the `__tests__` folder mirroring the `src` structure.

**Example: Testing a feature component (`SyncLocationFeature.test.tsx`)**

```tsx
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { SyncLocationFeature } from '../../src/screens/settings/features/SyncLocationFeature';

describe('SyncLocationFeature', () => {
  it('displays the address via reverse geocoding', async () => {
    // 1. Arrange: setup props and render
    const mockSave = jest.fn();
    const loc = { latitude: 14.6130, longitude: 120.9937 };
    
    const { getByText } = render(
      <SyncLocationFeature attendance_location={loc} saveBackendSettings={mockSave} />
    );

    // 2. Assert: Check initial rendering state
    expect(getByText(/Lat\s*:\s*14\.6130/)).toBeTruthy();

    // 3. Wait for async operations to complete
    await waitFor(() => {
      expect(getByText(/Address\s*:\s*TDT Powersteel/)).toBeTruthy();
    });
  });
});
```

### Tips for Testing React Native
1. **Mocking Contexts:** Use `jest.mock` to stub custom contexts (like Themes) so you don't have to wrap every component in Providers.
2. **Async Effects:** If a component runs `useEffect` on mount to fetch data (like `reverseGeocodeAsync`), use `@testing-library/react-native`'s `waitFor()` method to wait for the UI to update.
3. **Fire Events:** Use `fireEvent.press(button)` to simulate user interactions.
