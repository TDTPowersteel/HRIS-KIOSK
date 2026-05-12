import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { OFFLINE_MODE_KEY } from '../utils/offlineAttendance';
import { useTheme, Colors, ThemeType, Theme } from '../config/theme';

const TOUCHLESS_SETTING_KEY = 'settings_touchless_enabled';
const { width: WINDOW_WIDTH } = Dimensions.get('window');

type Props = {
  onBack: () => void;
};

type SettingRowProps = {
  title: string;
  description?: string;
  extraText?: string[];
  action?: ReactNode;
  danger?: boolean;
  onPress?: () => void;
  disabled?: boolean;
};

type BackendSettings = {
  attendance_location?: {
    latitude?: number;
    longitude?: number;
  };
  attendance_interval_minutes?: number;
  updated_at?: string;
};

type DialogMode = 'password' | 'interval' | null;

function formatCoordinate(label: string, value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return `${label} : Not set`;
  }
  return `${label} : ${value.toFixed(7)}`;
}

function SettingRow({ title, description, extraText = [], action, danger = false, onPress, disabled = false }: SettingRowProps) {
  const { colors } = useTheme();
  
  const content = (
    <View style={[
      styles.row, 
      { backgroundColor: colors.surface, borderColor: colors.border },
      disabled && styles.rowDisabled
    ]}>
      <View style={styles.rowTextBlock}>
        <Text style={[
          styles.rowTitle, 
          { color: danger ? '#ef4444' : Colors.powerOrange }
        ]}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
            {description}
          </Text>
        ) : null}
        {extraText.map((item) => (
          <Text key={item} style={[styles.rowMeta, { color: Colors.steelGray }]}>
            {item}
          </Text>
        ))}
      </View>
      {action ? <View style={styles.rowAction}>{action}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [
        { opacity: pressed ? 0.7 : 1 }
      ]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function Settings({ onBack }: Props) {
  const { theme, setTheme, colors } = useTheme();
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTouchless, setIsSavingTouchless] = useState(false);
  const [isSavingOfflineMode, setIsSavingOfflineMode] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isSubmittingDialog, setIsSubmittingDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [intervalInput, setIntervalInput] = useState('');
  const [backendSettings, setBackendSettings] = useState<BackendSettings>({
    attendance_location: {
      latitude: 14.6130261,
      longitude: 120.9937274,
    },
    attendance_interval_minutes: 5,
  });

  const locationLines = useMemo(() => {
    const location = backendSettings.attendance_location || {};
    return [formatCoordinate('Lat', location.latitude), formatCoordinate('Long', location.longitude)];
  }, [backendSettings.attendance_location]);

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
        setIntervalInput(String(payload.settings?.attendance_interval_minutes ?? 5));
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
    setIsSavingTouchless(true);
    try {
      await AsyncStorage.setItem(TOUCHLESS_SETTING_KEY, value ? 'true' : 'false');
    } catch {
      setTouchlessEnabled(!value);
    } finally {
      setIsSavingTouchless(false);
    }
  }, []);

  const handleOfflineModeChange = useCallback(async (value: boolean) => {
    setOfflineModeEnabled(value);
    setIsSavingOfflineMode(true);
    try {
      await AsyncStorage.setItem(OFFLINE_MODE_KEY, value ? 'true' : 'false');
    } catch {
      setOfflineModeEnabled(!value);
    } finally {
      setIsSavingOfflineMode(false);
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

  const handleSetAttendanceLocation = useCallback(async () => {
    setIsSavingLocation(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Location permission is required.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      await saveBackendSettings({
        action: 'set_location',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      Alert.alert('Success', 'Attendance location updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to update location.');
    } finally {
      setIsSavingLocation(false);
    }
  }, [saveBackendSettings]);

  const openPasswordDialog = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setDialogMode('password');
  }, []);

  const openIntervalDialog = useCallback(() => {
    setIntervalInput(String(backendSettings.attendance_interval_minutes ?? 5));
    setDialogMode('interval');
  }, [backendSettings.attendance_interval_minutes]);

  const closeDialog = useCallback(() => {
    if (isSubmittingDialog) return;
    setDialogMode(null);
  }, [isSubmittingDialog]);

  const handleDialogSubmit = useCallback(async () => {
    if (!dialogMode) return;
    setIsSubmittingDialog(true);
    try {
      if (dialogMode === 'password') {
        await saveBackendSettings({
          action: 'change_admin_password',
          current_password: currentPassword,
          new_password: newPassword,
        });
      } else if (dialogMode === 'interval') {
        await saveBackendSettings({
          action: 'set_interval',
          interval_minutes: Number(intervalInput),
        });
      }
      closeDialog();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save.');
    } finally {
      setIsSubmittingDialog(false);
    }
  }, [closeDialog, currentPassword, dialogMode, intervalInput, newPassword, saveBackendSettings]);

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

           <SettingRow
          title="Touchless Mode"
          description="Enable automatic face capture without manual trigger"
          action={
            <Switch
              value={touchlessEnabled}
              onValueChange={handleTouchlessChange}
              trackColor={{ false: Colors.steelGray, true: Colors.powerOrange }}
              thumbColor="#ffffff"
            />
          }
        />


        <SettingRow
          title="Sync Location"
          description="Click to synchronize kiosk with current physical coordinates"
          extraText={locationLines}
          onPress={handleSetAttendanceLocation}
          disabled={isSavingLocation}
          action={isSavingLocation ? <ActivityIndicator size="small" color={Colors.powerOrange} /> : null}
        />

        <SettingRow
          title="Reporting Interval"
          description={`Click to set the data sync frequency (currently set to ${backendSettings.attendance_interval_minutes} minutes)`}
          onPress={openIntervalDialog}
        />

        <SettingRow 
          title="Administrative Access" 
          description="Click to update the secure admin password" 
          onPress={openPasswordDialog} 
        />

        <SettingRow
          title="Offline Redundancy"
          description="Buffer attendance locally when network is unstable"
          action={
            <Switch
              value={offlineModeEnabled}
              onValueChange={handleOfflineModeChange}
              trackColor={{ false: Colors.steelGray, true: Colors.powerOrange }}
              thumbColor="#ffffff"
            />
          }
        />

        <View style={[styles.themeSection, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>APPLICATION THEME</Text>
          <View style={styles.themeGrid}>
            {(['light', 'dark', 'industrial', 'midnight'] as ThemeType[]).map((t) => (
              <Pressable 
                key={t}
                onPress={() => setTheme(t)}
                style={[
                  styles.themeOption, 
                  { 
                    backgroundColor: Theme[t].background, 
                    borderColor: theme === t ? Colors.powerOrange : colors.border 
                  }
                ]}
              >
                <View style={[styles.themePreview, { backgroundColor: Theme[t].surface }]} />
                <Text style={[
                  styles.themeLabel, 
                  { color: Theme[t].text }
                ]}>
                  {t.toUpperCase()}
                </Text>
                {theme === t && <View style={styles.themeActiveDot} />}
              </Pressable>
            ))}
          </View>
        </View>

        <SettingRow title="System Logout" danger onPress={handleLogout} />
      </View>
      </ScrollView>
      <Modal visible={dialogMode !== null} transparent animationType="fade" onRequestClose={closeDialog}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {dialogMode === 'password' ? 'Administrative Access' : 'Reporting Interval'}
            </Text>

            {dialogMode === 'password' ? (
              <>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="Current Password"
                  placeholderTextColor={colors.textSecondary}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                />
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="New Secure Password"
                  placeholderTextColor={colors.textSecondary}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                />
              </>
            ) : (
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="Minutes (1-60)"
                placeholderTextColor={colors.textSecondary}
                value={intervalInput}
                onChangeText={setIntervalInput}
                keyboardType="number-pad"
              />
            )}

            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, { backgroundColor: colors.background }]} onPress={closeDialog}>
                <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>CANCEL</Text>
              </Pressable>
              <Pressable 
                style={[styles.modalButton, { backgroundColor: Colors.powerOrange }]} 
                onPress={handleDialogSubmit}
                disabled={isSubmittingDialog}
              >
                {isSubmittingDialog ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>SAVE CHANGES</Text>
                )}
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
  row: {
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
  rowDisabled: {
    opacity: 0.5,
  },
  rowTextBlock: {
    flex: 1,
    paddingRight: 20,
  },
  rowTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  rowDescription: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  rowAction: {
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  modalCard: {
    width: '100%',
    maxWidth: 550,
    borderRadius: 32,
    padding: 35,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 25,
    textAlign: 'center',
  },
  input: {
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    borderWidth: 1.5,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
    gap: 15,
  },
  modalButton: {
    flex: 1,
    height: 65,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeSection: {
    marginTop: 10,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  themeOption: {
    width: (WINDOW_WIDTH - 120) / 4,
    minWidth: 80,
    height: 100,
    borderRadius: 16,
    borderWidth: 2,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  themePreview: {
    width: '100%',
    height: 40,
    borderRadius: 8,
    marginBottom: 8,
  },
  themeLabel: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  themeActiveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.powerOrange,
  },
});
