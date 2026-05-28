import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { Colors, useTheme } from '../config/theme';
import {
  getOfflineAttendanceQueue,
  markOfflineAttendanceFailed,
  markOfflineAttendancePending,
  removeOfflineAttendanceItem,
  type OfflineAttendanceItem,
} from '../utils/offlineAttendance';

const APP_VERSION = 'v1.0.39';

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

  const twelveHourMatch = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2] ?? '0');
    if (!Number.isNaN(hour) && !Number.isNaN(minutes) && hour >= 1 && hour <= 12 && minutes >= 0 && minutes <= 59) {
      return minutes === 0
        ? `${hour}${twelveHourMatch[3].toLowerCase()}m`
        : `${hour}:${String(minutes).padStart(2, '0')}${twelveHourMatch[3].toLowerCase()}m`;
    }
  }

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
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [items, setItems] = useState<OfflineAttendanceItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const isTablet = windowWidth >= 768;
  const horizontalPadding = windowWidth >= 1024 ? 36 : windowWidth >= 768 ? 26 : 16;

  const reloadQueue = useCallback(async () => {
    const queue = await getOfflineAttendanceQueue();
    setItems(queue);
  }, []);

  useEffect(() => {
    reloadQueue()
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [reloadQueue]);

  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);
  const failedItems = useMemo(() => items.filter((item) => item.status === 'failed'), [items]);
  const displayedItems = activeTab === 'pending' ? pendingItems : failedItems;

  const syncItem = useCallback(async (item: OfflineAttendanceItem) => {
    await markOfflineAttendancePending(item.id);

    const response = await fetch(`${BACKEND_URL}/record_attendance.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ user_id: item.userId, action: item.action }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || `Sync failed (${response.status})`);
    }

    await removeOfflineAttendanceItem(item.id);
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      const queue = await getOfflineAttendanceQueue();
      const candidates = queue.filter((item) => item.status === 'pending' || item.status === 'failed');

      for (const item of candidates) {
        try {
          await syncItem(item);
        } catch (error: any) {
          await markOfflineAttendanceFailed(
            item.id,
            error?.message || 'Connection error. Please check your network settings.'
          );
        }
      }
    } finally {
      await reloadQueue();
      setIsSyncing(false);
    }
  }, [isSyncing, reloadQueue, syncItem]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.topBar, { backgroundColor: colors.accent }]} />
      <View style={[styles.container, { paddingHorizontal: horizontalPadding }]}>
        <View style={[styles.contentWrap, isTablet && styles.contentWrapTablet]}>
          <View
            style={[
              styles.headerCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <View style={styles.headerRow}>
              <Pressable
                onPress={onBack}
                style={({ pressed }) => [
                  styles.backButton,
                  {
                    backgroundColor: withAlpha(colors.accent, pressed ? 0.16 : 0.11),
                    borderColor: withAlpha(colors.accent, 0.35),
                  },
                ]}
              >
                <Text style={[styles.backArrow, { color: colors.text }]}>{'<'}</Text>
              </Pressable>
              <View style={styles.titleWrap}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Offline Sync Queue</Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Review and sync saved attendance records.
                </Text>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <View style={[styles.summaryChip, { backgroundColor: withAlpha(colors.accent, 0.1) }]}>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{pendingItems.length}</Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Pending</Text>
              </View>
              <View style={[styles.summaryChip, { backgroundColor: withAlpha('#ef4444', 0.12) }]}>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{failedItems.length}</Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Failed</Text>
              </View>
              <View style={[styles.summaryChip, { backgroundColor: withAlpha(colors.accentSecondary, 0.14) }]}>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{items.length}</Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Total</Text>
              </View>
            </View>
          </View>

          <View style={[styles.tabRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              onPress={() => setActiveTab('pending')}
              style={[
                styles.tabButton,
                activeTab === 'pending' && {
                  backgroundColor: withAlpha(colors.accent, 0.14),
                  borderColor: withAlpha(colors.accent, 0.45),
                },
              ]}
            >
              <Text style={[styles.tabText, { color: activeTab === 'pending' ? colors.text : colors.textSecondary }]}>
                Wait to Sync ({pendingItems.length})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('failed')}
              style={[
                styles.tabButton,
                activeTab === 'failed' && {
                  backgroundColor: withAlpha('#ef4444', 0.14),
                  borderColor: withAlpha('#ef4444', 0.45),
                },
              ]}
            >
              <Text style={[styles.tabText, { color: activeTab === 'failed' ? colors.text : colors.textSecondary }]}>
                Sync Failed ({failedItems.length})
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : displayedItems.length ? (
              displayedItems.map((item) => {
                const displayName = getDisplayName(item);
                const actionLabel = item.action === 'clock_in' ? 'Clock In' : 'Clock Out';
                const isFailedItem = item.status === 'failed';
                const message = isFailedItem
                  ? item.errorMessage || 'Connection error. Please check your network settings.'
                  : 'Saved locally. Waiting to sync.';

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        shadowColor: colors.shadow,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.avatar,
                        { backgroundColor: isFailedItem ? '#ef4444' : colors.accent },
                        isTablet && styles.avatarTablet,
                      ]}
                    >
                      <Text style={[styles.avatarText, isTablet && styles.avatarTextTablet]}>{getInitials(displayName)}</Text>
                    </View>

                    <View style={styles.cardContent}>
                      <View style={styles.cardTopRow}>
                        <View style={styles.nameBlock}>
                          <Text style={[styles.secondaryText, { color: colors.text }]}>{displayName}</Text>
                          <Text style={[styles.primaryText, { color: colors.textSecondary }]}>{item.userId}</Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor: isFailedItem ? withAlpha('#ef4444', 0.14) : withAlpha(colors.accent, 0.14),
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              { color: isFailedItem ? '#ef4444' : colors.accent },
                            ]}
                          >
                            {isFailedItem ? 'Failed' : 'Pending'}
                          </Text>
                        </View>
                      </View>

                      <View style={[styles.metaGrid, isTablet && styles.metaGridTablet]}>
                        <View style={styles.metaItem}>
                          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Date</Text>
                          <Text style={[styles.metaValue, { color: colors.text }]}>{item.date}</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Time</Text>
                          <Text style={[styles.metaValue, { color: colors.text }]}>{formatTimeDisplay(item.time)}</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Action</Text>
                          <Text style={[styles.metaValue, { color: colors.text }]}>{actionLabel}</Text>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.messageWrap,
                          { backgroundColor: isFailedItem ? withAlpha('#ef4444', 0.08) : withAlpha(colors.accentSecondary, 0.1) },
                        ]}
                      >
                        <Text style={[styles.messageLabel, { color: colors.textSecondary }]}>Message</Text>
                        <Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No Data</Text>
              </View>
            )}
          </ScrollView>

          <View style={[styles.buttonRow, isTablet && styles.buttonRowTablet]}>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: withAlpha(colors.accent, 0.35),
                  backgroundColor: withAlpha(colors.accent, pressed ? 0.2 : 0.1),
                },
                isTablet && styles.tabletButton,
              ]}
              onPress={onOpenScanner}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Show QR Scan</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.syncButton,
                {
                  backgroundColor: pressed ? withAlpha(colors.accent, 0.78) : colors.accent,
                },
                isTablet && styles.tabletButton,
                isSyncing && styles.syncButtonDisabled,
              ]}
              onPress={handleSyncNow}
              disabled={isSyncing}
            >
              {isSyncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncButtonText}>Sync Now</Text>}
            </Pressable>
          </View>

          <Text style={[styles.versionText, { color: colors.textSecondary }]}>{APP_VERSION}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topBar: {
    height: 6,
  },
  container: {
    flex: 1,
  },
  contentWrap: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  contentWrapTablet: {
    maxWidth: 920,
  },
  backButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  backArrow: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '500',
  },
  headerCard: {
    borderRadius: 22,
    borderWidth: 1.2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 12,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryChip: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  summaryLabel: {
    marginTop: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1.2,
    borderRadius: 14,
    padding: 5,
    gap: 6,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
    gap: 10,
    paddingBottom: 22,
  },
  card: {
    flexDirection: 'row',
    borderWidth: 1.2,
    borderRadius: 18,
    padding: 14,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  avatarTablet: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginRight: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  avatarTextTablet: {
    fontSize: 18,
  },
  cardContent: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  nameBlock: {
    flex: 1,
    minWidth: 0,
  },
  primaryText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  secondaryText: {
    fontSize: 17,
    fontWeight: '700',
  },
  statusBadge: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  metaGridTablet: {
    gap: 14,
  },
  metaItem: {
    minWidth: 84,
    flexGrow: 1,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  messageWrap: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  messageLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 19,
    fontWeight: '600',
  },
  buttonRow: {
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  buttonRowTablet: {
    flexDirection: 'row',
  },
  tabletButton: {
    flex: 1,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.powerOrange,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  syncButton: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  syncButtonDisabled: {
    opacity: 0.75,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 10,
  },
});
