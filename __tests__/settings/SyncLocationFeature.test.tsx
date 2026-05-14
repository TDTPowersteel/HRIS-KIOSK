import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { SyncLocationFeature } from '../../src/screens/settings/features/SyncLocationFeature';
import * as Location from 'expo-location';

// Wrap the component with ThemeContext if needed, but since it uses colors, we might need a mock for useTheme
jest.mock('../../src/config/theme', () => ({
  useTheme: () => ({
    colors: { background: '#fff', surface: '#fff', text: '#000', textSecondary: '#666', border: '#ddd' },
    theme: 'light',
  }),
  Colors: { powerOrange: '#ff0000', steelGray: '#888' },
}));

describe('SyncLocationFeature', () => {
  it('displays longitude, latitude, and actual address via reverse geocoding', async () => {
    const mockSave = jest.fn();
    const loc = { latitude: 14.6130, longitude: 120.9937 };

    const { getByText } = render(
      <SyncLocationFeature attendance_location={loc} saveBackendSettings={mockSave} />
    );

    // Initial render should have lat and long
    expect(getByText(/Lat\s*:\s*14\.6130000/)).toBeTruthy();
    expect(getByText(/Long\s*:\s*120\.9937000/)).toBeTruthy();

    // After async resolveAddress, it should show the address
    await waitFor(() => {
      expect(getByText(/Address\s*:\s*TDT Powersteel, 123 Steel Road, Manila, NCR, Philippines/)).toBeTruthy();
    });
  });

  it('calls saveBackendSettings when pressed', async () => {
    const mockSave = jest.fn().mockResolvedValue({});
    const { getByText } = render(
      <SyncLocationFeature attendance_location={{ latitude: 0, longitude: 0 }} saveBackendSettings={mockSave} />
    );

    const button = getByText('Sync Location');
    fireEvent.press(button);

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
      expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalledWith({
        action: 'set_location',
        latitude: 14.0,
        longitude: 120.0
      });
    });
  });
});
