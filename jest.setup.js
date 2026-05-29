import 'react-native';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-location
jest.mock('expo-location', () => {
  return {
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
    ]),
    Accuracy: {
      High: 5
    }
  };
});

global.fetch = jest.fn();

// Mock react-native-mmkv for Jest
jest.mock('react-native-mmkv', () => {
  const storage = new Map();
  const mockInstance = {
    set: jest.fn((key, value) => {
      storage.set(key, value);
    }),
    getString: jest.fn((key) => {
      const val = storage.get(key);
      return typeof val === 'string' ? val : undefined;
    }),
    getNumber: jest.fn((key) => {
      const val = storage.get(key);
      return typeof val === 'number' ? val : undefined;
    }),
    getBoolean: jest.fn((key) => {
      const val = storage.get(key);
      return typeof val === 'boolean' ? val : undefined;
    }),
    delete: jest.fn((key) => {
      storage.delete(key);
    }),
    clearAll: jest.fn(() => {
      storage.clear();
    }),
    getAllKeys: jest.fn(() => {
      return Array.from(storage.keys());
    }),
  };

  return {
    createMMKV: jest.fn().mockReturnValue(mockInstance),
    MMKV: jest.fn().mockImplementation(() => mockInstance),
  };
});


// Mock expo-file-system for Jest
jest.mock('expo-file-system', () => {
  return {
    documentDirectory: 'file:///mock/documentDirectory/',
    cacheDirectory: 'file:///mock/cacheDirectory/',
    downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock/cached_image.jpg' }),
    deleteAsync: jest.fn().mockResolvedValue(undefined),
    getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  };
});
