import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, Modal, Animated, useWindowDimensions } from 'react-native';
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
import { AutoSyncFeature } from './features/AutoSyncFeature';
import { SettingRow } from './components/SettingRow';

const TOUCHLESS_SETTING_KEY = 'settings_touchless_enabled';
const AUTO_SYNC_SETTING_KEY = 'settings_auto_sync_enabled';

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

let settingsHasLoadedOnce = false;

export default function Settings({ onBack }: Props) {
  const { colors, theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const shortDimension = Math.min(windowWidth, windowHeight);
  const isTablet = shortDimension >= 768;
  const isSmallTablet = shortDimension >= 480 && shortDimension < 768;
  const isPhone = shortDimension < 480;

  const headerTitleFontSize = isTablet ? 24 : isSmallTablet ? 20 : 18;
  const headerSubtitleFontSize = isTablet ? 14 : isSmallTablet ? 12 : 10;
  const sectionTitleFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const storageLabelFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;
  const storageValueFontSize = isTablet ? 28 : isSmallTablet ? 23 : 18;
  const storageSubtextFontSize = isTablet ? 13 : isSmallTablet ? 11 : 10;
  const wipeButtonTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const logoutTitleFontSize = isTablet ? 18 : isSmallTablet ? 15 : 13;
  const logoutSubtitleFontSize = isTablet ? 13 : isSmallTablet ? 11 : 10;
  const modalTitleFontSize = isTablet ? 24 : isSmallTablet ? 20 : 16;
  const modalMessageFontSize = isTablet ? 15 : isSmallTablet ? 13 : 11;
  const modalPrimaryBtnTextFontSize = isTablet ? 15 : isSmallTablet ? 13 : 11;
  const modalSecondaryBtnTextFontSize = isTablet ? 14 : isSmallTablet ? 12 : 10;

  const [isLoading, setIsLoading] = useState(!settingsHasLoadedOnce);
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  // Shimmer animation for loading skeletons
  const shimmerTranslate = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.timing(shimmerTranslate, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        })
      ).start();
    } else {
      shimmerTranslate.setValue(-1);
    }
  }, [isLoading, shimmerTranslate]);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
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
        AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, 'settings_liveness_enabled', AUTO_SYNC_SETTING_KEY]),
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
      setAutoSyncEnabled(localSettings[AUTO_SYNC_SETTING_KEY] !== 'false');

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
      settingsHasLoadedOnce = true;
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

  const handleAutoSyncChange = useCallback(async (value: boolean) => {
    setAutoSyncEnabled(value);
    try {
      await AsyncStorage.setItem(AUTO_SYNC_SETTING_KEY, value ? 'true' : 'false');
    } catch {
      setAutoSyncEnabled(!value);
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
    const getShimmerStyle = (width: number | string = 200) => {
      const numericWidth = typeof width === 'number' ? width : 200;
      return {
        position: 'absolute' as const,
        top: 0,
        bottom: 0,
        width: width as any,
        backgroundColor: theme === 'light' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.15)',
        opacity: shimmerTranslate.interpolate({
          inputRange: [-1, -0.2, 0.2, 1],
          outputRange: [0, 1, 1, 0]
        }),
        transform: [{
          translateX: shimmerTranslate.interpolate({
            inputRange: [-1, 1],
            outputRange: [-numericWidth, numericWidth]
          })
        }]
      };
    };

    const SettingRowSkeleton = () => (
      <View style={[
        styles.rowSkeleton, 
        { backgroundColor: colors.surface, borderColor: colors.border, overflow: 'hidden', position: 'relative' }
      ]}>
        <View style={styles.rowTextBlock}>
          <View style={{ width: '45%', height: 22, borderRadius: 6, marginBottom: 8, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
            <Animated.View style={getShimmerStyle(150)} />
          </View>
          <View style={{ width: '85%', height: 14, borderRadius: 4, marginBottom: 6, backgroundColor: theme === 'light' ? '#f3f4f6' : '#404040', overflow: 'hidden', position: 'relative' }}>
            <Animated.View style={getShimmerStyle(300)} />
          </View>
          <View style={{ width: '60%', height: 14, borderRadius: 4, backgroundColor: theme === 'light' ? '#f3f4f6' : '#404040', overflow: 'hidden', position: 'relative' }}>
            <Animated.View style={getShimmerStyle(200)} />
          </View>
        </View>
        <View style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: theme === 'light' ? '#e5e7eb' : '#3c3c3c', overflow: 'hidden', position: 'relative' }}>
          <Animated.View style={getShimmerStyle(50)} />
        </View>
      </View>
    );

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            style={[
              styles.backButton,
              {
                backgroundColor: 'transparent',
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialCommunityIcons name="chevron-left" size={32} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: colors.text, fontSize: headerTitleFontSize }]}>Settings</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: headerSubtitleFontSize }]}>
              Change how this kiosk works and manages data.
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <View style={styles.sectionContainer}>
            {/* Device Options Title Skeleton */}
            <View style={styles.sectionHeader}>
              <View style={{ width: 140, height: 14, borderRadius: 4, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
                <Animated.View style={getShimmerStyle(100)} />
              </View>
            </View>

            <View style={styles.featureGrid}>
              {[1, 2, 3, 4, 5].map((i) => <SettingRowSkeleton key={i} />)}
            </View>

            {/* Visual Style Title Skeleton */}
            <View style={styles.sectionHeader}>
              <View style={{ width: 120, height: 14, borderRadius: 4, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
                <Animated.View style={getShimmerStyle(100)} />
              </View>
            </View>
            
            <View style={[styles.themeSelectorSkeleton, { backgroundColor: colors.surface, borderColor: colors.border, overflow: 'hidden', position: 'relative' }]}>
              <View style={{ width: '30%', height: 16, borderRadius: 4, marginBottom: 16, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
                <Animated.View style={getShimmerStyle(100)} />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={{ flex: 1, height: 75, borderRadius: 16, backgroundColor: theme === 'light' ? '#f3f4f6' : '#3c3c3c', overflow: 'hidden', position: 'relative' }}>
                    <Animated.View style={getShimmerStyle(100)} />
                  </View>
                ))}
              </View>
            </View>

            {/* Device Memory Title Skeleton */}
            <View style={styles.sectionHeader}>
              <View style={{ width: 155, height: 14, borderRadius: 4, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
                <Animated.View style={getShimmerStyle(100)} />
              </View>
            </View>

            {/* Device Storage Card Skeleton */}
            <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border, overflow: 'hidden', position: 'relative' }]}>
              <View style={styles.storageMainRow}>
                <View style={styles.storageInfoBlock}>
                  <View style={{ width: 90, height: 12, borderRadius: 3, marginBottom: 6, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }}>
                    <Animated.View style={getShimmerStyle(80)} />
                  </View>
                  <View style={{ width: 120, height: 28, borderRadius: 6, backgroundColor: theme === 'light' ? '#f3f4f6' : '#3c3c3c', overflow: 'hidden', position: 'relative' }}>
                    <Animated.View style={getShimmerStyle(120)} />
                  </View>
                </View>
                <View style={{ width: 110, height: 44, borderRadius: 12, backgroundColor: theme === 'light' ? '#e5e7eb' : '#3c3c3c', overflow: 'hidden', position: 'relative' }}>
                  <Animated.View style={getShimmerStyle(110)} />
                </View>
              </View>
              <View style={[styles.storageDivider, { backgroundColor: colors.border }]} />
              <View style={{ width: '80%', height: 14, borderRadius: 4, backgroundColor: theme === 'light' ? '#f3f4f6' : '#404040', overflow: 'hidden', position: 'relative' }}>
                <Animated.View style={getShimmerStyle(250)} />
              </View>
            </View>
          </View>
        </ScrollView>
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
          <Text style={[styles.headerTitle, { color: colors.text, fontSize: headerTitleFontSize }]}>Settings</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: headerSubtitleFontSize }]}>
            Change how this kiosk works and manages data.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontSize: sectionTitleFontSize }]}>Device Options</Text>
          </View>

          <View style={styles.featureGrid}>
            <AutoSyncFeature enabled={autoSyncEnabled} onToggle={handleAutoSyncChange} />
            <TouchlessModeFeature enabled={touchlessEnabled} onToggle={handleTouchlessChange} />
            <LivenessCheckFeature enabled={livenessEnabled} onToggle={handleLivenessChange} />
            <SyncLocationFeature
              attendance_location={backendSettings.attendance_location}
              saveBackendSettings={saveBackendSettings}
            />
            {/* <AdminAccessFeature saveBackendSettings={saveBackendSettings} /> */}
            <OfflineRedundancyFeature isOnline={isOnline} />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontSize: sectionTitleFontSize }]}>Visual Style</Text>
          </View>
          <ThemeSelectorFeature />
          
          <View style={styles.sectionHeader}>
            <Pressable onPress={handleHeaderTap}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontSize: sectionTitleFontSize }]}>Device Storage</Text>
            </Pressable>
          </View>
          <View style={[styles.storageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.storageMainRow}>
              <View style={styles.storageInfoBlock}>
                <Text style={[styles.storageLabel, { color: colors.textSecondary, fontSize: storageLabelFontSize }]}>USED MEMORY</Text>
                <Text style={[styles.storageValue, { color: colors.text, fontSize: storageValueFontSize }]}>{storageSize}</Text>
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
                <Text style={[styles.wipeButtonText, { fontSize: wipeButtonTextFontSize }]}>CLEAR DATA</Text>
              </Pressable>
            </View>
            <View style={[styles.storageDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.storageSubtext, { color: colors.textSecondary, fontSize: storageSubtextFontSize }]}>
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
                    <Text style={[styles.logoutTitle, { fontSize: logoutTitleFontSize }]}>End Management Session</Text>
                    <Text style={[styles.logoutSubtitle, { color: colors.textSecondary, fontSize: logoutSubtitleFontSize }]}>Close settings and return to home screen</Text>
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
            
            <Text style={[styles.modalTitle, { color: colors.text, fontSize: modalTitleFontSize }]}>Clear Device Memory?</Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary, fontSize: modalMessageFontSize }]}>
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
                <Text style={[styles.modalSecondaryBtnText, { color: colors.textSecondary, fontSize: modalSecondaryBtnTextFontSize }]}>CANCEL</Text>
              </Pressable>

              <Pressable 
                onPress={confirmWipe}
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? '#dc2626' : '#ef4444' }
                ]}
              >
                <Text style={[styles.modalPrimaryBtnText, { fontSize: modalPrimaryBtnTextFontSize }]}>CLEAR NOW</Text>
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
  rowSkeleton: {
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 24,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rowTextBlock: {
    flex: 1,
    paddingRight: 20,
  },
  themeSelectorSkeleton: {
    padding: 24,
    borderRadius: 24,
    borderWidth: 1.5,
    marginTop: 8,
  },
});
