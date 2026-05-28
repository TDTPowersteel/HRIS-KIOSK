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

export default function App() {
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth > 600;

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
          backgroundColor: theme === 'light' ? 'rgba(230, 112, 38, 0.08)' : 'rgba(230, 112, 38, 0.12)',
          shadowColor: Colors.powerOrange,
          shadowRadius: isTablet ? 180 : 120,
          width: isTablet ? 600 : 400,
          height: isTablet ? 450 : 300,
        } as any]} />
        <View style={[styles.backgroundGlowBottom, { 
          backgroundColor: theme === 'light' ? 'rgba(113, 112, 116, 0.08)' : 'rgba(113, 112, 116, 0.12)',
          shadowColor: Colors.steelGray,
          shadowRadius: isTablet ? 160 : 100,
          width: isTablet ? 500 : 350,
          height: isTablet ? 400 : 280,
        } as any]} />

        <SafeAreaView style={[styles.container, { paddingHorizontal: isTablet ? 40 : 20 }]}>
          <View style={[styles.homeCard, { 
            backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 1)' : 'rgba(36, 36, 35, 1)', 
            paddingHorizontal: isTablet ? 40 : 24,
            paddingVertical: isTablet ? 60 : 40,
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }]}>

            <View style={[styles.brandBlock, { marginBottom: isTablet ? 50 : 30 }]}>
              <Image 
                source={require('./assets/tdt-logo.png')} 
                style={{ width: isTablet ? 380 : 240, height: isTablet ? 120 : 80, marginBottom: 20 }} 
                resizeMode="contain" 
              />
              <Text style={[styles.brandSubcopy, { color: currentTheme.textSecondary, fontSize: isTablet ? 18 : 14 }]}>Attendance Monitoring System</Text>
            </View>

            <View style={[styles.buttonStack, { gap: isTablet ? 24 : 16 }]}>
              <Pressable 
                style={({ pressed }) => [
                  styles.largeButton, 
                  { backgroundColor: Colors.powerOrange, height: isTablet ? 90 : 70 },
                  pressed && { backgroundColor: Colors.deepOrange, transform: [{ scale: 0.98 }] }
                ]} 
                onPress={() => setScreen('qr')}
              >
                <Text style={[styles.largeButtonText, { fontSize: isTablet ? 18 : 15 }]}>ATTENDANCE SCANNER</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.secondaryButton, 
                  { backgroundColor: currentTheme.surface, borderColor: Colors.steelGray, height: isTablet ? 80 : 65 },
                  pressed && { backgroundColor: theme === 'light' ? '#f0f0f0' : '#2a2a29', transform: [{ scale: 0.98 }] }
                ]} 
                onPress={() => setScreen('profile')}
              >
                <Text style={[styles.secondaryButtonText, { color: currentTheme.text, fontSize: isTablet ? 16 : 14 }]}>EMPLOYEE DIRECTORY</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.minimalButton, 
                  pressed && { opacity: 0.7 }
                ]} 
                onPress={() => setScreen('settings')}
              >
                <View style={styles.settingsRow}>
                  <Text style={[styles.settingsIcon, { color: Colors.steelGray, fontSize: isTablet ? 20 : 16 }]}>{'\u2699'}</Text>
                  <Text style={[styles.minimalButtonText, { color: Colors.steelGray, fontSize: isTablet ? 15 : 13 }]}>SETTINGS</Text>
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
