import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../../config/backend';
import { useTheme, Colors } from '../../config/theme';

import { TouchlessModeFeature } from './features/TouchlessModeFeature';
import { SyncLocationFeature } from './features/SyncLocationFeature';
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

function withAlpha(hexColor: string, alpha: number) {
  const normalized = hexColor.replace('#', '');
  const normalizedSixDigit =
    normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized;
  const intColor = Number.parseInt(normalizedSixDigit, 16);
  if (Number.isNaN(intColor)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const red = (intColor >> 16) & 255;
  const green = (intColor >> 8) & 255;
  const blue = intColor & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export default function Settings({ onBack }: Props) {
  const { colors, theme } = useTheme();
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
  const [logoutTapCount, setLogoutTapCount] = useState(0);
  const [showLogout, setShowLogout] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);

  const handleHeaderTap = useCallback(() => {
    const newCount = logoutTapCount + 1;
    if (newCount >= 7) {
      setShowLogout(true);
      setLogoutTapCount(0);
    } else {
      setLogoutTapCount(newCount);
    }
  }, [logoutTapCount]);

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

  const confirmWipe = async () => {
    setShowWipeConfirm(false);
    setIsLoading(true);
    try {
      await AsyncStorage.clear();
      await calculateStorageSize();
      Alert.alert('Success', 'Device memory has been cleared.');
    } catch (e) {
      Alert.alert('Error', 'Failed to clear memory.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleWipeCache = useCallback(() => {
    setShowWipeConfirm(true);
  }, []);

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
    Alert.alert('Exit Settings', 'Are you sure you want to end this session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
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
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: pressed ? withAlpha(colors.border, 0.2) : 'transparent',
              borderColor: colors.border,
            },
          ]}
        >
          <MaterialCommunityIcons name="chevron-left" size={32} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Change how this kiosk works and manages data.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Device Options</Text>
          </View>

          <View style={styles.featureGrid}>
            <TouchlessModeFeature enabled={touchlessEnabled} onToggle={handleTouchlessChange} />
            <LivenessCheckFeature enabled={livenessEnabled} onToggle={handleLivenessChange} />
            <FaceRecogEngineFeature engine={faceEngine} onSelect={handleFaceEngineChange} />
            <SyncLocationFeature
              attendance_location={backendSettings.attendance_location}
              saveBackendSettings={saveBackendSettings}
            />
            <AdminAccessFeature saveBackendSettings={saveBackendSettings} />
            <OfflineRedundancyFeature isOnline={isOnline} />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Visual Style</Text>
          </View>
          <ThemeSelectorFeature />
          
          <View style={styles.sectionHeader}>
            <Pressable onPress={handleHeaderTap}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Device Storage</Text>
            </Pressable>
          </View>
          <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.storageMainRow}>
              <View style={styles.storageInfoBlock}>
                <Text style={[styles.storageLabel, { color: colors.textSecondary }]}>USED MEMORY</Text>
                <Text style={[styles.storageValue, { color: colors.text }]}>{storageSize}</Text>
              </View>
              <Pressable 
                onPress={handleWipeCache}
                style={({ pressed }) => [
                  styles.wipeButton,
                  { 
                    borderColor: '#ef4444', 
                    backgroundColor: pressed ? 'rgba(239, 68, 68, 0.12)' : 'transparent' 
                  },
                ]}
              >
                <Text style={styles.wipeButtonText}>CLEAR DATA</Text>
              </Pressable>
            </View>
            <View style={[styles.storageDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.storageSubtext, { color: colors.textSecondary }]}>
              Includes saved employee lists, pictures, and attendance logs.
            </Text>
          </View>

          {showLogout && (
            <View style={[styles.logoutSection, { borderTopColor: colors.border }]}>
              <Pressable 
                onPress={handleLogout}
                style={({ pressed }) => [
                  styles.logoutRow,
                  { 
                    backgroundColor: pressed ? withAlpha('#ef4444', 0.05) : 'transparent',
                    borderColor: colors.border 
                  }
                ]}
              >
                <View style={styles.logoutContent}>
                  <MaterialCommunityIcons name="logout-variant" size={24} color="#ef4444" />
                  <View style={styles.logoutTextWrap}>
                    <Text style={styles.logoutTitle}>End Management Session</Text>
                    <Text style={[styles.logoutSubtitle, { color: colors.textSecondary }]}>Close settings and return to home screen</Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* CUSTOM CONFIRMATION MODAL */}
      <Modal
        visible={showWipeConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWipeConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalIconCircle, { backgroundColor: withAlpha('#ef4444', 0.1) }]}>
              <MaterialCommunityIcons name="database-remove" size={42} color="#ef4444" />
            </View>
            
            <Text style={[styles.modalTitle, { color: colors.text }]}>Clear Device Memory?</Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              This will permanently delete all saved logs and employee pictures from this device.
              {'\n'}{'\n'}
              Internet connection will be needed to get this information back.
            </Text>

            <View style={styles.modalActionRow}>
              <Pressable 
                onPress={() => setShowWipeConfirm(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryBtn,
                  { backgroundColor: pressed ? withAlpha(colors.border, 0.5) : colors.background, borderColor: colors.border }
                ]}
              >
                <Text style={[styles.modalSecondaryBtnText, { color: colors.textSecondary }]}>CANCEL</Text>
              </Pressable>

              <Pressable 
                onPress={confirmWipe}
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? '#dc2626' : '#ef4444' }
                ]}
              >
                <Text style={styles.modalPrimaryBtnText}>CLEAR NOW</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 1,
  },
  listContent: {
    paddingBottom: 60,
  },
  sectionContainer: {
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  featureGrid: {
    gap: 16,
  },
  sectionHeader: {
    marginTop: 32,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  storageCard: {
    padding: 24,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  storageMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storageInfoBlock: {
    flex: 1,
  },
  storageLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  storageValue: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  storageDivider: {
    height: 1,
    width: '100%',
    marginVertical: 16,
    opacity: 0.5,
  },
  storageSubtext: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  wipeButton: {
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wipeButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  logoutSection: {
    marginTop: 48,
    borderTopWidth: 1.5,
    paddingTop: 24,
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  logoutContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  logoutTextWrap: {
    justifyContent: 'center',
  },
  logoutTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ef4444',
    letterSpacing: -0.2,
  },
  logoutSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 500,
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
  },
  modalIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  modalMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    fontWeight: '500',
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalPrimaryBtn: {
    flex: 1.5,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  modalSecondaryBtn: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
