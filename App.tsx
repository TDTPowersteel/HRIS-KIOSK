import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ShowQRScan from './src/screens/ShowQRScan';
import EmployeeProfileData from './src/screens/EmployeeProfileData';
import Settings from './src/screens/settings';
import OfflineSync from './src/screens/OfflineSync';
import * as Location from 'expo-location';
import { ThemeContext, Theme, getStoredTheme, saveTheme, ThemeType, Colors } from './src/config/theme';
import { useAutoSync } from './src/utils/useAutoSync';
import { mmkv, refreshOfflineUserCache } from './src/utils/offlineUsers';
import { BACKEND_URL } from './src/config/backend';

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTablet = windowWidth > 600 && windowHeight > 550;

  const isSmallScreen = windowWidth < 380 || windowHeight < 550;
  const isShortScreen = windowHeight < 550;

  const cardPaddingHorizontal = isTablet ? 56 : (isSmallScreen ? 24 : 32);
  const cardPaddingVertical = isTablet ? 72 : (isShortScreen ? 25 : (isSmallScreen ? 32 : 48));
  const brandBlockMargin = isTablet ? 56 : (isShortScreen ? 20 : (isSmallScreen ? 24 : 32));
  
  const maxAvailableLogoWidth = windowWidth - (cardPaddingHorizontal * 2) - (isTablet ? 96 : 48);
  const targetLogoWidth = isTablet ? 420 : (isSmallScreen ? 220 : 280);
  const logoWidth = Math.min(targetLogoWidth, maxAvailableLogoWidth);
  const logoHeight = logoWidth * (isTablet ? 130 / 420 : 85 / 280);
  
  const logoMarginBottom = isTablet ? 8 : (isShortScreen ? 4 : 8);
  const brandSubcopyFontSize = isTablet ? 15 : (isSmallScreen ? 11 : 12);
  
  const buttonGap = isTablet ? 20 : (isShortScreen ? 12 : (isSmallScreen ? 12 : 16));
  const scannerBtnHeight = isTablet ? 96 : (isShortScreen ? 56 : (isSmallScreen ? 60 : 72));
  const directoryBtnHeight = isTablet ? 80 : (isShortScreen ? 48 : (isSmallScreen ? 54 : 64));
  
  const scannerBtnFontSize = isTablet ? 20 : (isShortScreen ? 14 : (isSmallScreen ? 14 : 16));
  const directoryBtnFontSize = isTablet ? 17 : (isShortScreen ? 13 : (isSmallScreen ? 13 : 14));
  
  const settingsIconSize = isTablet ? 20 : (isShortScreen ? 14 : (isSmallScreen ? 14 : 16));
  const settingsTextSize = isTablet ? 14 : (isShortScreen ? 11 : (isSmallScreen ? 11 : 12));
  const settingsMarginTop = isShortScreen ? 4 : 8;

  useAutoSync();

  const [screen, setScreen] = useState<'home' | 'qr' | 'profile' | 'settings' | 'offline'>('home');
  const [theme, setThemeState] = useState<ThemeType>('light');
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
  }, []);

  const currentTheme = useMemo(() => Theme[theme], [theme]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    getStoredTheme().then(setThemeState);
    Location.requestForegroundPermissionsAsync().catch(() => {});
    fetch(`${BACKEND_URL}/settings.php`, {
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
    })
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.ok && payload?.kiosk_mode) {
          const mode = payload.kiosk_mode as 'employee' | 'intern';
          mmkv.set('kiosk_mode', mode);
          setKioskMode(mode);
        }
      })
      .catch((err) => {
        console.log('Failed to fetch settings:', err);
      });
  }, []);

  useEffect(() => {
    const runStartupTasks = async () => {
      // Delay by 3 seconds to avoid blocking main UI rendering
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('[Startup] Executing background sync...');
      refreshOfflineUserCache()
        .then(users => console.log(`[Startup] Background sync complete. Mapped ${users?.length || 0} users.`))
        .catch(err => console.log('[Startup] Background sync failed:', err));

      console.log('[Startup] Triggering server warmup...');
      fetch(`${BACKEND_URL}/verify_embedding.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          log_id: 'warmup',
          live_image_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        })
      })
        .then(res => res.json())
        .then(data => console.log('[Startup] Server warmup response:', data))
        .catch(err => console.log('[Startup] Server warmup request failed:', err));
    };

    runStartupTasks();
  }, []);

  useEffect(() => {
    const mode = (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
    if (mode !== kioskMode) {
      setKioskMode(mode);
    }
  }, [screen]);

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

        <SafeAreaView style={styles.container}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollContainer,
              { 
                paddingHorizontal: isTablet ? 48 : (isSmallScreen ? 12 : 24),
                paddingVertical: isShortScreen ? 0 : 24
              }
            ]}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.homeCard, { 
              backgroundColor: theme === 'light' ? '#FFFFFF' : '#242423', 
              paddingHorizontal: cardPaddingHorizontal,
              paddingVertical: cardPaddingVertical,
              maxWidth: isTablet ? 650 : (isShortScreen ? 460 : 540),
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
            }]}>

              <View style={[styles.brandBlock, { marginBottom: brandBlockMargin }]}>
                <Image 
                  source={require('./assets/tdt-logo.png')} 
                  style={{ width: logoWidth, height: logoHeight, marginBottom: logoMarginBottom }} 
                  resizeMode="contain" 
                />
                <Text style={[styles.brandSubcopy, { color: currentTheme.textSecondary, fontSize: brandSubcopyFontSize, marginTop: 0 }]}>
                  Attendance Monitoring System
                </Text>
              </View>

              <View style={[styles.buttonStack, { gap: buttonGap }]}>
                <Pressable 
                  style={({ pressed }) => [
                    styles.largeButton, 
                    { 
                      backgroundColor: Colors.powerOrange, 
                      height: scannerBtnHeight 
                    },
                    pressed && { backgroundColor: Colors.deepOrange, transform: [{ scale: 0.985 }] }
                  ]} 
                  onPress={() => setScreen('qr')}
                >
                  <Text style={[styles.largeButtonText, { fontSize: scannerBtnFontSize }]}>ATTENDANCE SCANNER</Text>
                </Pressable>

                <Pressable 
                  style={({ pressed }) => [
                    styles.secondaryButton, 
                    { 
                      backgroundColor: theme === 'light' ? '#F5F5F5' : '#2D2D2C', 
                      borderColor: theme === 'light' ? '#E0E0E0' : 'rgba(255,255,255,0.1)',
                      height: directoryBtnHeight 
                    },
                    pressed && { backgroundColor: theme === 'light' ? '#EEEEEE' : '#353534', transform: [{ scale: 0.985 }] }
                  ]} 
                  onPress={() => setScreen('profile')}
                >
                  <Text style={[styles.secondaryButtonText, { color: currentTheme.text, fontSize: directoryBtnFontSize }]}>
                    {kioskMode === 'intern' ? 'INTERN LIST' : 'EMPLOYEE DIRECTORY'}
                  </Text>
                </Pressable>

                <Pressable 
                  style={({ pressed }) => [
                    styles.minimalButton, 
                    { 
                      marginTop: settingsMarginTop,
                      backgroundColor: pressed ? (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)') : 'transparent',
                      borderRadius: 12,
                    }
                  ]} 
                  onPress={() => setScreen('settings')}
                >
                  <View style={styles.settingsRow}>
                    <Text style={[styles.settingsIcon, { color: Colors.steelGray, fontSize: settingsIconSize }]}>{'\u2699'}</Text>
                    <Text style={[styles.minimalButtonText, { color: Colors.steelGray, fontSize: settingsTextSize }]}>SETTINGS</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </ScrollView>
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
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
