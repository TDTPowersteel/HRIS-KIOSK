import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BACKEND_URL } from '../config/backend';
import { Colors, useTheme } from '../config/theme';
import {
  getOfflineAttendanceQueue,
  syncOfflineQueue,
  type OfflineAttendanceItem,
} from '../utils/offlineAttendance';

const APP_VERSION = 'v1.0.41';

interface HistoryItem {
  id: string;
  name: string;
  username: string;
  profilePicture?: string;
  action: 'clock_in' | 'clock_out';
  time: string;
  date: string;
}

type Props = {
  onBack: () => void;
  onOpenScanner: () => void;
};

type TabKey = 'pending' | 'failed';

function getDisplayName(item: OfflineAttendanceItem) {
  return item.name?.trim() || item.username || item.userId;
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

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

function formatTimeValue(hours24: number, minutes: number) {
  const period = hours24 >= 12 ? 'pm' : 'am';
  const hour = hours24 % 12 || 12;
  return minutes === 0 ? `${hour}${period}` : `${hour}:${String(minutes).padStart(2, '0')}${period}`;
}

function formatTimeDisplay(rawTime?: string | null) {
  const value = rawTime?.trim();
  if (!value) return '-';

  const militaryMatch = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (militaryMatch) {
    const hours24 = Number(militaryMatch[1]);
    const minutes = Number(militaryMatch[2]);
    if (!Number.isNaN(hours24) && !Number.isNaN(minutes) && hours24 >= 0 && hours24 <= 23 && minutes >= 0 && minutes <= 59) {
      return formatTimeValue(hours24, minutes);
    }
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return formatTimeValue(parsedDate.getHours(), parsedDate.getMinutes());
  }

  return value;
}

export default function OfflineSync({ onBack, onOpenScanner }: Props) {
  const { theme, colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [items, setItems] = useState<OfflineAttendanceItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const isTablet = windowWidth >= 768;

  const reloadQueue = useCallback(async () => {
    const queue = await getOfflineAttendanceQueue();
    setItems(queue);
  }, []);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/attendance_today.php`, {
        headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
      });
      const json = await res.json();
      if (json.ok) {
        setHistory(json.history || []);
      }
    } catch (e) {
      console.error('Failed to fetch history', e);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      reloadQueue().catch(() => undefined),
      loadHistory().catch(() => undefined),
    ]).finally(() => setIsLoading(false));
  }, [reloadQueue, loadHistory]);

  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);
  const failedItems = useMemo(() => items.filter((item) => item.status === 'failed'), [items]);
  const displayedItems = activeTab === 'pending' ? pendingItems : failedItems;

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      await syncOfflineQueue();
    } finally {
      await reloadQueue();
      setIsSyncing(false);
    }
  }, [isSyncing, reloadQueue]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.mainHeader}>
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
        <View style={styles.titleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Management Dashboard</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Real-time monitor and sync terminal.
          </Text>
        </View>
      </View>

      <View style={[styles.dashboardContainer, isTablet && styles.tabletRow]}>
        {/* LEFT PANEL: OFFLINE SYNC (The "Front" panel) */}
        <View style={[
          styles.syncPanel, 
          isTablet && { 
            flex: 0.6, 
            backgroundColor: theme === 'light' ? '#FFFFFF' : colors.surface, 
            borderRightWidth: 1, 
            borderRightColor: colors.border,
            zIndex: 10,
            // Subtle Shadow for "Pop"
            shadowColor: '#000',
            shadowOffset: { width: 4, height: 0 },
            shadowOpacity: 0.08,
            shadowRadius: 10,
            elevation: 8, 
          }
        ]}>
          <View style={styles.panelHeaderRow}>
            <View style={styles.panelTitleContainer}>
              <MaterialCommunityIcons name="cloud-off-outline" size={24} color="#f97316" />
              <Text style={[styles.panelTitle, { color: colors.text }]}>Offline Queue</Text>
            </View>
          </View>

          <View style={[styles.noobInfoBox, { backgroundColor: withAlpha('#f97316', 0.08) }]}>
            <Text style={[styles.noobTitle, { color: '#ea580c' }]}>WAITING TO SYNC</Text>
            <Text style={[styles.noobText, { color: colors.textSecondary }]}>
              These logs were saved offline. Click <Text style={{fontWeight: '800'}}>SYNC NOW</Text> to send to server.
            </Text>
          </View>

          <View style={[styles.tabRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Pressable
              onPress={() => setActiveTab('pending')}
              style={[
                styles.tabButton,
                activeTab === 'pending' && {
                  backgroundColor: theme === 'light' ? '#FFFFFF' : colors.surface,
                  borderColor: withAlpha('#f97316', 0.45),
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.tabText, { color: activeTab === 'pending' ? '#ea580c' : colors.textSecondary }]}>
                Pending ({pendingItems.length})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('failed')}
              style={[
                styles.tabButton,
                activeTab === 'failed' && {
                  backgroundColor: theme === 'light' ? '#FFFFFF' : colors.surface,
                  borderColor: withAlpha('#ef4444', 0.45),
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.tabText, { color: activeTab === 'failed' ? '#ef4444' : colors.textSecondary }]}>
                Errors ({failedItems.length})
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <ActivityIndicator size="large" color={colors.accent} style={{marginTop: 40}} />
            ) : displayedItems.length ? (
              displayedItems.map((item) => {
                const displayName = getDisplayName(item);
                const isFailedItem = item.status === 'failed';

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.standardCard,
                      {
                        backgroundColor: isFailedItem ? 'rgba(239, 68, 68, 0.04)' : colors.background,
                        borderColor: isFailedItem ? '#ef4444' : colors.border,
                      },
                    ]}
                  >
                    <View style={[styles.standardAvatar, { backgroundColor: isFailedItem ? '#ef4444' : '#f97316' }]}>
                      <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
                    </View>
                    <View style={styles.standardContent}>
                      <View style={styles.standardTopRow}>
                        <Text style={[styles.standardName, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
                        <View style={[styles.standardBadge, { backgroundColor: isFailedItem ? withAlpha('#ef4444', 0.15) : withAlpha('#f97316', 0.15) }]}>
                          <Text style={[styles.standardBadgeText, { color: isFailedItem ? '#ef4444' : '#ea580c' }]}>
                            {item.action === 'clock_in' ? 'IN' : 'OUT'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.standardTime, { color: colors.textSecondary }]}>{formatTimeDisplay(item.time)}</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.border} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Queue is Clear</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.syncButton,
                { backgroundColor: pressed ? withAlpha(Colors.powerOrange, 0.85) : Colors.powerOrange },
                isSyncing && styles.syncButtonDisabled,
              ]}
              onPress={handleSyncNow}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.btnInner}>
                  <MaterialCommunityIcons name="cloud-upload" size={24} color="#fff" />
                  <Text style={styles.syncButtonText}>SYNC NOW</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* RIGHT PANEL: TODAY'S HISTORY (The "Back" panel) */}
        <View style={[
          styles.historyPanel, 
          isTablet && { 
            flex: 0.4, 
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background, 
          }
        ]}>
          <View style={styles.panelHeaderRow}>
            <View style={styles.panelTitleContainer}>
              <MaterialCommunityIcons name="history" size={24} color={colors.accent} />
              <Text style={[styles.panelTitle, { color: colors.text }]}>Today's History</Text>
            </View>
            <Pressable onPress={loadHistory} disabled={isHistoryLoading}>
              <Text style={[styles.refreshText, { color: colors.accent }]}>
                {isHistoryLoading ? '...' : 'REFRESH'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.historySubHeader}>
            <Text style={[styles.historyCount, { color: colors.textSecondary }]}>{history.length} RECORDS ON SERVER</Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isHistoryLoading}
                onRefresh={loadHistory}
                colors={[colors.accent]}
                tintColor={colors.accent}
              />
            }
          >
            {history.length > 0 ? (
              history.map((item) => {
                const isClockIn = item.action === 'clock_in';
                const badgeColor = isClockIn ? '#22c55e' : colors.accent;
                const displayName = item.name?.trim() || item.username;

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.standardCard,
                      { backgroundColor: theme === 'light' ? 'rgba(255,255,255,0.7)' : colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={[styles.standardAvatar, { backgroundColor: withAlpha(colors.accent, 0.1) }]}>
                      {item.profilePicture ? (
                        <Image source={{ uri: item.profilePicture }} style={styles.avatarImage} />
                      ) : (
                        <Text style={[styles.historyAvatarText, { color: colors.accent }]}>{getInitials(displayName)}</Text>
                      )}
                    </View>
                    <View style={styles.standardContent}>
                      <View style={styles.standardTopRow}>
                        <Text style={[styles.standardName, { color: colors.text, fontSize: 15 }]} numberOfLines={1}>{displayName}</Text>
                        <View style={[styles.standardBadge, { backgroundColor: withAlpha(badgeColor, 0.15) }]}>
                          <Text style={[styles.standardBadgeText, { color: badgeColor, fontSize: 10 }]}>
                            {isClockIn ? 'IN' : 'OUT'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.standardTime, { color: colors.textSecondary, fontSize: 11 }]}>{formatTimeDisplay(item.time)}</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="history" size={48} color={colors.border} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No History Yet</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  mainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  dashboardContainer: {
    flex: 1,
  },
  tabletRow: {
    flexDirection: 'row',
  },
  syncPanel: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  historyPanel: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 45,
  },
  panelTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
    textTransform: 'uppercase',
  },
  panelContent: {
    flex: 1,
  },
  noobInfoBox: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(249, 115, 22, 0.25)',
  },
  noobTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
    letterSpacing: 0.8,
  },
  noobText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
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
  titleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    marginTop: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 5,
    gap: 5,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  listContent: {
    flexGrow: 1,
    gap: 12,
    paddingBottom: 20,
  },
  standardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    height: 80,
  },
  standardAvatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  standardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  standardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  standardName: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
    flex: 1,
  },
  standardTime: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  standardBadge: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginLeft: 10,
  },
  standardBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  historyAvatarText: {
    fontSize: 16,
    fontWeight: '900',
  },
  syncButton: {
    height: 68,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: Colors.powerOrange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  historySubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  historyCount: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 160,
    gap: 12,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  buttonRow: {
    marginTop: 16,
  },
});
