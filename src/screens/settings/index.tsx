import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../../config/backend';
import { OFFLINE_MODE_KEY } from '../../utils/offlineAttendance';
import { useTheme, Colors } from '../../config/theme';

import { TouchlessModeFeature } from './features/TouchlessModeFeature';
import { SyncLocationFeature } from './features/SyncLocationFeature';
import { ReportingIntervalFeature } from './features/ReportingIntervalFeature';
import { AdminAccessFeature } from './features/AdminAccessFeature';
import { OfflineRedundancyFeature } from './features/OfflineRedundancyFeature';
import { ThemeSelectorFeature } from './features/ThemeSelectorFeature';
import { SettingRow } from './components/SettingRow';

const TOUCHLESS_SETTING_KEY = 'settings_touchless_enabled';

type Props = {
  onBack: () => void;
};

type BackendSettings = {
  attendance_location?: {
    latitude?: number;
    longitude?: number;
  };
  attendance_interval_minutes?: number;
  updated_at?: string;
};

export default function Settings({ onBack }: Props) {
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [backendSettings, setBackendSettings] = useState<BackendSettings>({
    attendance_location: {
      latitude: 14.6130261,
      longitude: 120.9937274,
    },
    attendance_interval_minutes: 5,
  });

  const loadSettings = useCallback(async () => {
    try {
      const [settingsEntries, response] = await Promise.all([
        AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, OFFLINE_MODE_KEY]),
        fetch(`${BACKEND_URL}/settings.php`, {
          headers: {
            Accept: 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
        }),
      ]);

      const localSettings = Object.fromEntries(settingsEntries);
      setTouchlessEnabled(localSettings[TOUCHLESS_SETTING_KEY] === 'true');
      setOfflineModeEnabled(localSettings[OFFLINE_MODE_KEY] === 'true');

      const payload = await response.json();
      if (payload?.ok) {
        setBackendSettings((prev) => ({
          ...prev,
          ...payload.settings,
        }));
      }
    } catch (error: any) {
      console.log('Settings load error', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleTouchlessChange = useCallback(async (value: boolean) => {
    setTouchlessEnabled(value);
    try {
      await AsyncStorage.setItem(TOUCHLESS_SETTING_KEY, value ? 'true' : 'false');
    } catch {
      setTouchlessEnabled(!value);
    }
  }, []);

  const handleOfflineModeChange = useCallback(async (value: boolean) => {
    setOfflineModeEnabled(value);
    try {
      await AsyncStorage.setItem(OFFLINE_MODE_KEY, value ? 'true' : 'false');
    } catch {
      setOfflineModeEnabled(!value);
    }
  }, []);

  const saveBackendSettings = useCallback(async (body: Record<string, any>) => {
    const response = await fetch(`${BACKEND_URL}/settings.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || `Settings save failed (${response.status})`);
    }

    setBackendSettings((prev) => ({
      ...prev,
      ...payload.settings,
    }));

    return payload;
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.multiRemove(['userId', 'username', 'emp_id']);
          onBack();
        },
      },
    ]);
  }, [onBack]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.powerOrange} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backArrow, { color: colors.text }]}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kiosk Configuration</Text>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionContainer}>
          <TouchlessModeFeature enabled={touchlessEnabled} onToggle={handleTouchlessChange} />
          <SyncLocationFeature 
            attendance_location={backendSettings.attendance_location} 
            saveBackendSettings={saveBackendSettings} 
          />
          <ReportingIntervalFeature 
            currentInterval={backendSettings.attendance_interval_minutes ?? 5} 
            saveBackendSettings={saveBackendSettings} 
          />
          <AdminAccessFeature saveBackendSettings={saveBackendSettings} />
          <OfflineRedundancyFeature enabled={offlineModeEnabled} onToggle={handleOfflineModeChange} />
          <ThemeSelectorFeature />
          
          <SettingRow title="System Logout" danger onPress={handleLogout} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    height: 90,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  backButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
  },
  backArrow: {
    fontSize: 32,
    fontWeight: '300',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  listContent: {
    paddingBottom: 40,
  },
  sectionContainer: {
    paddingHorizontal: 32,
    paddingTop: 20,
    gap: 16,
  },
});
