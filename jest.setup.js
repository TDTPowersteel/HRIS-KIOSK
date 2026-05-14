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
