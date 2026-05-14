import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ShowQRScan from './src/screens/ShowQRScan';
import EmployeeProfileData from './src/screens/EmployeeProfileData';
import Settings from './src/screens/settings';
import OfflineSync from './src/screens/OfflineSync';
import { refreshOfflineUserCache } from './src/utils/offlineUsers';
import { ThemeContext, Theme, getStoredTheme, saveTheme, ThemeType, Colors } from './src/config/theme';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

export default function App() {
  const [screen, setScreen] = useState<'home' | 'qr' | 'profile' | 'settings' | 'offline'>('home');
  const [theme, setThemeState] = useState<ThemeType>('light');

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
  }, []);

  const currentTheme = useMemo(() => Theme[theme], [theme]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    refreshOfflineUserCache().catch(() => undefined);
    
    getStoredTheme().then(setThemeState);
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
          shadowRadius: WINDOW_WIDTH > 600 ? 180 : 120,
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        } as any]} />
        <View style={[styles.backgroundGlowBottom, { 
          backgroundColor: theme === 'light' ? 'rgba(113, 112, 116, 0.08)' : 'rgba(113, 112, 116, 0.12)',
          shadowColor: Colors.steelGray,
          shadowRadius: WINDOW_WIDTH > 600 ? 160 : 100,
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        } as any]} />

        <SafeAreaView style={styles.container}>
          <View style={[styles.homeCard, { 
            backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 1)' : 'rgba(36, 36, 35, 1)', 
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }]}>

            <View style={styles.brandBlock}>
              <Image 
                source={require('./assets/tdt-logo.png')} 
                style={styles.mainLogo} 
                resizeMode="contain" 
              />
              <Text style={[styles.brandSubcopy, { color: currentTheme.textSecondary }]}>Attendance Monitoring System</Text>
            </View>

            <View style={styles.buttonStack}>
              <Pressable 
                style={({ pressed }) => [
                  styles.largeButton, 
                  { backgroundColor: Colors.powerOrange, shadowColor: Colors.powerOrange },
                  pressed && { backgroundColor: Colors.deepOrange, transform: [{ scale: 0.98 }] }
                ]} 
                onPress={() => setScreen('qr')}
              >
                <Text style={styles.largeButtonText}>ATTENDANCE SCANNER</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.secondaryButton, 
                  { backgroundColor: currentTheme.surface, borderColor: Colors.steelGray },
                  pressed && { backgroundColor: theme === 'light' ? '#f0f0f0' : '#2a2a29', transform: [{ scale: 0.98 }] }
                ]} 
                onPress={() => setScreen('profile')}
              >
                <Text style={[styles.secondaryButtonText, { color: currentTheme.text }]}>EMPLOYEE DIRECTORY</Text>
              </Pressable>

              <Pressable 
                style={({ pressed }) => [
                  styles.minimalButton, 
                  pressed && { opacity: 0.7 }
                ]} 
                onPress={() => setScreen('settings')}
              >
                <View style={styles.settingsRow}>
                  <Text style={[styles.settingsIcon, { color: Colors.steelGray }]}>⚙</Text>
                  <Text style={[styles.minimalButtonText, { color: Colors.steelGray }]}>KIOSK SETTINGS</Text>
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
    paddingHorizontal: WINDOW_WIDTH > 600 ? 40 : 20,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -200,
    right: -150,
    width: WINDOW_WIDTH > 600 ? 600 : 400,
    height: WINDOW_WIDTH > 600 ? 450 : 300,
    borderRadius: 300,
    transform: [{ scaleX: 1.5 }, { rotate: '-15deg' }],
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -150,
    left: -150,
    width: WINDOW_WIDTH > 600 ? 500 : 350,
    height: WINDOW_WIDTH > 600 ? 400 : 280,
    borderRadius: 250,
    transform: [{ scaleX: 1.8 }, { rotate: '25deg' }],
  },
  homeCard: {
    width: '100%',
    maxWidth: 850,
    alignSelf: 'center',
    borderRadius: 32,
    paddingHorizontal: WINDOW_WIDTH > 600 ? 40 : 24,
    paddingVertical: WINDOW_WIDTH > 600 ? 60 : 40,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: WINDOW_WIDTH > 600 ? 50 : 30,
  },
  mainLogo: {
    width: WINDOW_WIDTH > 600 ? 380 : 240,
    height: WINDOW_WIDTH > 600 ? 120 : 80,
    marginBottom: 20,
  },
  brandSubcopy: {
    marginTop: 10,
    fontSize: WINDOW_WIDTH > 600 ? 18 : 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  buttonStack: {
    gap: WINDOW_WIDTH > 600 ? 24 : 16,
    alignItems: 'center',
    width: '100%',
  },
  largeButton: {
    width: '100%',
    maxWidth: 600,
    height: WINDOW_WIDTH > 600 ? 90 : 70,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // Removed shadows and elevation to keep button flat inside the card
    elevation: 0,
    shadowOpacity: 0,
  },
  largeButtonText: {
    color: '#ffffff',
    fontSize: WINDOW_WIDTH > 600 ? 18 : 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  secondaryButton: {
    width: '100%',
    maxWidth: 600,
    height: WINDOW_WIDTH > 600 ? 80 : 65,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  secondaryButtonText: {
    fontSize: WINDOW_WIDTH > 600 ? 16 : 14,
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
    fontSize: WINDOW_WIDTH > 600 ? 20 : 16,
  },
  minimalButtonText: {
    fontSize: WINDOW_WIDTH > 600 ? 15 : 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
