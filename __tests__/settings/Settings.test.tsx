import { render, waitFor } from '@testing-library/react-native';
import Settings from '../../src/screens/settings';

jest.mock('../../src/config/theme', () => ({
  useTheme: () => ({
    colors: { background: '#fff', surface: '#fff', text: '#000', textSecondary: '#666', border: '#ddd' },
    theme: 'light',
  }),
  Colors: { powerOrange: '#ff0000', steelGray: '#888' },
  Theme: {
    light: { background: '#fff', surface: '#eee', text: '#000' },
    dark: { background: '#000', surface: '#111', text: '#fff' },
    industrial: { background: '#222', surface: '#333', text: '#eee' },
    midnight: { background: '#112', surface: '#223', text: '#ddd' }
  }
}));

describe('Settings Screen', () => {
  it('renders all settings features successfully', async () => {
    // Override fetch mock for this specific test
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        ok: true,
        settings: { attendance_interval_minutes: 10, attendance_location: { latitude: 1, longitude: 1 } }
      })
    });

    const { getByText } = render(<Settings onBack={jest.fn()} />);
    
    // Initially should show loading
    // Then it should fetch settings and display everything
    await waitFor(() => {
      expect(getByText('Settings')).toBeTruthy();
      expect(getByText('Touchless Mode')).toBeTruthy();
      expect(getByText('Sync Location')).toBeTruthy();
      expect(getByText('Visual Style')).toBeTruthy();
    });
  });
});
