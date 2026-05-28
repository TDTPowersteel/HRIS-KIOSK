import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ShowQRScan from './src/screens/ShowQRScan';
import EmployeeProfileData from './src/screens/EmployeeProfileData';
import Settings from './src/screens/settings';
import OfflineSync from './src/screens/OfflineSync';
import * as Location from 'expo-location';
import { ThemeContext, Theme, getStoredTheme, saveTheme, ThemeType, Colors } from './src/config/theme';
import { useAutoSync } from './src/utils/useAutoSync';

export default function App() {
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth > 600;

  useAutoSync();

  const [screen, setScreen] = useState<'home' | 'qr' | 'profile' | 'settings' | 'offline'>('home');
  const [theme, setThemeState] = useState<ThemeType>('light');

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
  }, []);

  const currentTheme = useMemo(() => Theme[theme], [theme]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    getStoredTheme().then(setThemeState);
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);

  const ScreenComponent = useMemo(() => {
    if (screen === 'qr') return <ShowQRScan onBack={() => setScreen('home')} onOpenOffline={() => setScreen('offline')} />;
    if (screen === 'profile') return <EmployeeProfileData onBack={() => setScreen('home')} />;
    if (screen === 'settings') return <Settings onBack={() => setScreen('home')} />;
    if (screen === 'offline') return <OfflineSync onBack={() => setScreen('home')} onOpenScanner={() => setScreen('qr')} />;
    return null;
  }, [screen]);

  const renderContent = () => {
    if (screen !== 'home') {
      return (
        <View style={{ flex: 1, backgroundColor: currentTheme.background }}>
          {ScreenComponent}
          <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
        </View>
      );
    }

    return (
      <View style={[styles.fullScreenContainer, { backgroundColor: currentTheme.background }]}>
        <View style={[styles.backgroundGlowTop, { 
          backgroundColor: theme === 'light' ? 'rgba(230, 112, 38, 0.05)' : 'rgba(230, 112, 38, 0.08)',
          shadowColor: Colors.powerOrange,
          shadowRadius: isTablet ? 200 : 150,
          width: isTablet ? 700 : 500,
          height: isTablet ? 500 : 350,
        } as any]} />
        <View style={[styles.backgroundGlowBottom, { 
          backgroundColor: theme === 'light' ? 'rgba(113, 112, 116, 0.05)' : 'rgba(113, 112, 116, 0.08)',
          shadowColor: Colors.steelGray,
          shadowRadius: isTablet ? 180 : 120,
          width: isTablet ? 600 : 400,
          height: isTablet ? 450 : 320,
        } as any]} />

        <SafeAreaView style={[styles.container, { paddingHorizontal: isTablet ? 48 : 24 }]}>
          <View style={[styles.homeCard, { 
            backgroundColor: theme === 'light' ? '#FFFFFF' : '#242423', 
            paddingHorizontal: isTablet ? 56 : 32,
            paddingVertical: isTablet ? 72 : 48,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }]}>

            <View style={[styles.brandBlock, { marginBottom: isTablet ? 56 : 32 }]}>
              <Image 
                source={require('./assets/tdt-logo.png')} 
                style={{ width: isTablet ? 420 : 280, height: isTablet ? 130 : 85, marginBottom: 8 }} 
                resizeMode="contain" 
              />
              <Text style={[styles.brandSubcopy, { color: currentTheme.textSecondary, fontSize: isTablet ? 15 : 12, marginTop: 0 }]}>
                Attendance Monitoring System
              </Text>
            </View>

            <View style={[styles.buttonStack, { gap: isTablet ? 20 : 16 }]}>
              <Pressable 
                style={({ pressed }) => [
                  styles.largeButton, 
                  { 
                    backgroundColor: Colors.powerOrange, 
                    height: isTablet ? 96 : 72 
                  },
                  pressed && { backgroundColor: Colors.deepOrange, transform: [{ scale: 0.985 }] }
                ]} 
                onPress={() => setScreen('qr')}
              >
                <Text style={[styles.largeButtonText, { fontSize: isTablet ? 20 : 16 }]}>ATTENDANCE SCANNER</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.secondaryButton, 
                  { 
                    backgroundColor: theme === 'light' ? '#F5F5F5' : '#2D2D2C', 
                    borderColor: theme === 'light' ? '#E0E0E0' : 'rgba(255,255,255,0.1)',
                    height: isTablet ? 80 : 64 
                  },
                  pressed && { backgroundColor: theme === 'light' ? '#EEEEEE' : '#353534', transform: [{ scale: 0.985 }] }
                ]} 
                onPress={() => setScreen('profile')}
              >
                <Text style={[styles.secondaryButtonText, { color: currentTheme.text, fontSize: isTablet ? 17 : 14 }]}>EMPLOYEE DIRECTORY</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.minimalButton, 
                  { 
                    marginTop: 8,
                    backgroundColor: pressed ? (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)') : 'transparent',
                    borderRadius: 12,
                  }
                ]} 
                onPress={() => setScreen('settings')}
              >
                <View style={styles.settingsRow}>
                  <Text style={[styles.settingsIcon, { color: Colors.steelGray, fontSize: isTablet ? 20 : 16 }]}>{'\u2699'}</Text>
                  <Text style={[styles.minimalButtonText, { color: Colors.steelGray, fontSize: isTablet ? 14 : 12 }]}>SETTINGS</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>

        <StatusBar style={theme === 'light' ? 'dark' : 'light'} />
      </View>
    );
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, colors: currentTheme }}>
      <SafeAreaProvider>
        {renderContent()}
      </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -200,
    right: -150,
    borderRadius: 300,
    transform: [{ scaleX: 1.5 }, { rotate: '-15deg' }],
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -150,
    left: -150,
    borderRadius: 250,
    transform: [{ scaleX: 1.8 }, { rotate: '25deg' }],
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  homeCard: {
    width: '100%',
    maxWidth: 850,
    alignSelf: 'center',
    borderRadius: 32,
  },
  brandBlock: {
    alignItems: 'center',
  },
  brandSubcopy: {
    marginTop: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  buttonStack: {
    alignItems: 'center',
    width: '100%',
  },
  largeButton: {
    width: '100%',
    maxWidth: 600,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 0,
    shadowOpacity: 0,
  },
  largeButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  secondaryButton: {
    width: '100%',
    maxWidth: 600,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  secondaryButtonText: {
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  minimalButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsIcon: {
  },
  minimalButtonText: {
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
