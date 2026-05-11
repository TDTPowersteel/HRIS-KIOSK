import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ShowQRScan from './src/screens/ShowQRScan';
import EmployeeProfileData from './src/screens/EmployeeProfileData';
import Settings from './src/screens/Settings';
import OfflineSync from './src/screens/OfflineSync';
import { refreshOfflineUserCache } from './src/utils/offlineUsers';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'qr' | 'profile' | 'settings' | 'offline'>('home');

  useEffect(() => {
    // Dynamically unlock screen orientation to prevent tablet letterboxing
    ScreenOrientation.unlockAsync().catch(() => {});
    refreshOfflineUserCache().catch(() => undefined);
  }, []);

  const ScreenComponent = useMemo(() => {
    if (screen === 'qr') return <ShowQRScan onBack={() => setScreen('home')} onOpenOffline={() => setScreen('offline')} />;
    if (screen === 'profile') return <EmployeeProfileData onBack={() => setScreen('home')} />;
    if (screen === 'settings') return <Settings onBack={() => setScreen('home')} />;
    if (screen === 'offline') return <OfflineSync onBack={() => setScreen('home')} onOpenScanner={() => setScreen('qr')} />;
    return null;
  }, [screen]);

  if (screen !== 'home') {
    return (
      <>
        {ScreenComponent}
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />

      <View style={styles.homeCard}>
        <View style={styles.brandBlock}>
          <View style={styles.brandRow}>
            <Text style={[styles.brandText, styles.brandDark]}>TDT</Text>
            <Text style={[styles.brandText, styles.brandAccent]}>POWER</Text>
            <Text style={[styles.brandText, styles.brandLight]}>STEEL</Text>
          </View>
          <Text style={styles.brandTagline}>THE NO.1 STEEL SUPPLIER</Text>
          <Text style={styles.brandSubcopy}>Attendance Monitoring System</Text>
        </View>

        <View style={styles.buttonStack}>
          <Pressable style={styles.pillButton} onPress={() => setScreen('qr')}>
            <Text style={styles.pillText}>SHOW QR SCAN</Text>
          </Pressable>
          <Pressable style={styles.pillButton} onPress={() => setScreen('profile')}>
            <Text style={styles.pillText}>EMPLOYEE PROFILE DATA</Text>
          </Pressable>
          <Pressable style={styles.pillButton} onPress={() => setScreen('settings')}>
            <Text style={styles.pillText}>SETTINGS</Text>
          </Pressable>
        </View>
      </View>

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#d7dde6',
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f2ed',
    justifyContent: 'center',
    paddingHorizontal: 32,
    overflow: 'hidden',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -120,
    right: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(200, 116, 46, 0.12)',
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -100,
    left: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(52, 93, 134, 0.10)',
  },
  homeCard: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    backgroundColor: '#fffdf9',
    borderRadius: 34,
    paddingHorizontal: 26,
    paddingVertical: 34,
    borderWidth: 1,
    borderColor: '#f0e6dc',
    shadowColor: '#8f5c2a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 34,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  brandText: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  brandDark: {
    color: '#575b61',
  },
  brandAccent: {
    color: '#d96f1e',
    marginHorizontal: 4,
  },
  brandLight: {
    color: '#6d7177',
  },
  brandTagline: {
    marginTop: 4,
    fontSize: 18,
    letterSpacing: 2.2,
    color: '#787d84',
    fontWeight: '500',
    textAlign: 'center',
  },
  brandSubcopy: {
    marginTop: 12,
    fontSize: 15,
    color: '#8a8179',
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonStack: {
    gap: 18,
    alignItems: 'center',
  },
  pillButton: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: '#c8742e',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pillText: {
    color: '#f7f4f0',
    fontSize: 16,
    letterSpacing: 0.6,
    fontWeight: '600',
  },
});
