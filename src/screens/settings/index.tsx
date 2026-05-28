import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../../config/backend';
import { useTheme, Colors } from '../../config/theme';

import { TouchlessModeFeature } from './features/TouchlessModeFeature';
import { SyncLocationFeature } from './features/SyncLocationFeature';
import { ReportingIntervalFeature } from './features/ReportingIntervalFeature';
import { AdminAccessFeature } from './features/AdminAccessFeature';
import { OfflineRedundancyFeature } from './features/OfflineRedundancyFeature';
import { ThemeSelectorFeature } from './features/ThemeSelectorFeature';
import { LivenessCheckFeature } from './features/LivenessCheckFeature';
import { FaceRecogEngineFeature, type FaceEngine } from './features/FaceRecogEngineFeature';
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
  const [isOnline, setIsOnline] = useState(true);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const [faceEngine, setFaceEngine] = useState<FaceEngine>('facepp');
  const [backendSettings, setBackendSettings] = useState<BackendSettings>({
    attendance_location: {
      latitude: 14.6130261,
      longitude: 120.9937274,
    },
    attendance_interval_minutes: 5,
  });
  const [storageSize, setStorageSize] = useState<string>('0 KB');

  const calculateStorageSize = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const result = await AsyncStorage.multiGet(keys);
      let totalSize = 0;
      result.forEach(([key, value]) => {
        totalSize += (key?.length || 0) + (value?.length || 0);
      });
      
      if (totalSize < 1024 * 1024) {
        setStorageSize(`${(totalSize / 1024).toFixed(1)} KB`);
      } else {
        setStorageSize(`${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
      }
    } catch (e) {
      console.log('Failed to calculate storage size', e);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const [settingsEntries, response] = await Promise.all([
        AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, 'settings_liveness_enabled', 'settings_face_engine']),
        fetch(`${BACKEND_URL}/settings.php`, {
          headers: {
            Accept: 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
        }),
      ]);

      const localSettings = Object.fromEntries(settingsEntries);
      setTouchlessEnabled(localSettings[TOUCHLESS_SETTING_KEY] === 'true');
      setLivenessEnabled(localSettings['settings_liveness_enabled'] !== 'false');
      setFaceEngine((localSettings['settings_face_engine'] as FaceEngine) || 'facepp');

      calculateStorageSize();

      const payload = await response.json();
      if (payload?.ok) {
        setIsOnline(true);
        setBackendSettings((prev) => ({
          ...prev,
          ...payload.settings,
        }));
      } else {
        setIsOnline(false);
      }
    } catch (error: any) {
      console.log('Settings load error', error);
      setIsOnline(false);
    } finally {
      setIsLoading(false);
    }
  }, [calculateStorageSize]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleWipeCache = useCallback(() => {
    Alert.alert(
      'Wipe System Cache',
      'This will delete all offline data and cached profile pictures. You will need to sync again when online. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Wipe Data', 
          style: 'destructive', 
          onPress: async () => {
            setIsLoading(true);
            try {
              await AsyncStorage.clear();
              await calculateStorageSize();
              Alert.alert('Success', 'Cache has been cleared.');
            } catch (e) {
              Alert.alert('Error', 'Failed to clear cache.');
            } finally {
              setIsLoading(false);
            }
          } 
        }
      ]
    );
  }, [calculateStorageSize]);

  const handleTouchlessChange = useCallback(async (value: boolean) => {
    setTouchlessEnabled(value);
    try {
      await AsyncStorage.setItem(TOUCHLESS_SETTING_KEY, value ? 'true' : 'false');
    } catch {
      setTouchlessEnabled(!value);
    }
  }, []);

  const handleLivenessChange = useCallback(async (value: boolean) => {
    setLivenessEnabled(value);
    try {
      await AsyncStorage.setItem('settings_liveness_enabled', value ? 'true' : 'false');
    } catch {
      setLivenessEnabled(!value);
    }
  }, []);

  const handleFaceEngineChange = useCallback(async (value: FaceEngine) => {
    setFaceEngine(value);
    try {
      await AsyncStorage.setItem('settings_face_engine', value);
    } catch {
      setFaceEngine(value === 'facepp' ? 'camera_vision' : 'facepp');
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionContainer}>

          <TouchlessModeFeature enabled={touchlessEnabled} onToggle={handleTouchlessChange} />
          <LivenessCheckFeature enabled={livenessEnabled} onToggle={handleLivenessChange} />
          <FaceRecogEngineFeature engine={faceEngine} onSelect={handleFaceEngineChange} />
          <SyncLocationFeature
            attendance_location={backendSettings.attendance_location}
            saveBackendSettings={saveBackendSettings}
          />
          <ReportingIntervalFeature
            currentInterval={backendSettings.attendance_interval_minutes ?? 5}
            saveBackendSettings={saveBackendSettings}
          />
          <AdminAccessFeature saveBackendSettings={saveBackendSettings} />
          <OfflineRedundancyFeature isOnline={isOnline} />

          <ThemeSelectorFeature />
          
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>System Storage</Text>
          </View>
          <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.storageInfo}>
              <Text style={[styles.storageLabel, { color: colors.text }]}>Total Cached Data</Text>
              <Text style={[styles.storageValue, { color: Colors.powerOrange }]}>{storageSize}</Text>
            </View>
            <Text style={[styles.storageSubtext, { color: colors.textSecondary }]}>
              Includes offline employee data, QR codes, and profile pictures.
            </Text>
            <Pressable 
              onPress={handleWipeCache}
              style={({ pressed }) => [
                styles.wipeButton,
                { borderColor: '#ef4444' },
                pressed && { backgroundColor: 'rgba(239, 68, 68, 0.1)' }
              ]}
            >
              <Text style={styles.wipeButtonText}>WIPE SYSTEM CACHE</Text>
            </Pressable>
          </View>

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
  sectionHeader: {
    marginTop: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  storageCard: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  storageInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  storageLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  storageValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  storageSubtext: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  wipeButton: {
    height: 50,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wipeButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
