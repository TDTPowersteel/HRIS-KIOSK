import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';

export const THEME_KEY = 'settings_app_theme';

export const Colors = {
  powerOrange: '#e67026',
  steelGray: '#717074',
  offWhite: '#fafafa',
  deepOrange: '#e15716',
  lightGray: '#a6a6a8',
  mediumGray: '#7d7d80',
  charcoal: '#242423',
  richBlack: '#121010',
  darkUmber: '#322721',
};

export type ThemeType = 'light' | 'dark' | 'industrial' | 'midnight';

export const Theme = {
  light: {
    background: Colors.offWhite,
    surface: '#ffffff',
    text: Colors.charcoal,
    textSecondary: Colors.mediumGray,
    border: '#e4e8ef',
    accent: Colors.powerOrange,
    accentSecondary: Colors.steelGray,
    shadow: '#000000',
  },
  dark: {
    background: Colors.richBlack,
    surface: Colors.charcoal,
    text: Colors.offWhite,
    textSecondary: Colors.lightGray,
    border: Colors.darkUmber,
    accent: Colors.powerOrange,
    accentSecondary: Colors.steelGray,
    shadow: '#000000',
  },
  industrial: {
    background: '#2c2c2c',
    surface: '#3a3a3a',
    text: '#eeeeee',
    textSecondary: Colors.lightGray,
    border: '#4a4a4a',
    accent: Colors.powerOrange,
    accentSecondary: Colors.steelGray,
    shadow: '#000000',
  },
  midnight: {
    background: '#0a0a0b',
    surface: '#161618',
    text: '#ffffff',
    textSecondary: '#88888b',
    border: '#2a2a2c',
    accent: '#3b82f6', // Example variant
    accentSecondary: Colors.steelGray,
    shadow: '#000000',
  },
};

export const ThemeContext = createContext<{
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  colors: typeof Theme.light;
}>({
  theme: 'light',
  setTheme: () => {},
  colors: Theme.light,
});

export const useTheme = () => useContext(ThemeContext);

export const getStoredTheme = async (): Promise<ThemeType> => {
  const stored = await AsyncStorage.getItem(THEME_KEY);
  return (stored as ThemeType) || 'light';
};

export const saveTheme = async (theme: ThemeType) => {
  await AsyncStorage.setItem(THEME_KEY, theme);
};
