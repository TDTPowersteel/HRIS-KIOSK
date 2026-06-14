import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { BACKEND_URL } from '../config/backend';
import { Colors, useTheme } from '../config/theme';
import {
  getOfflineAttendanceQueue,
  syncOfflineQueue,
  removeOfflineAttendanceItem,
  type OfflineAttendanceItem,
} from '../utils/offlineAttendance';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { mmkv } from '../utils/offlineUsers';

const APP_VERSION = 'v1.0.41';

interface HistoryItem {
  id: string;
  name: string;
  username: string;
  profilePicture?: string;
  action: 'clock_in' | 'clock_out';
  time: string;
  date: string;
  timein?: string | null;
  timeout?: string | null;
  userId?: string | null;
  emp_id?: string | null;
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
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour = hours24 % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatMilitaryTime(rawTime?: string | null) {
  const value = rawTime?.trim();
  if (!value) return '';

  const militaryMatch = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (militaryMatch) {
    const hours24 = Number(militaryMatch[1]);
    const minutes = Number(militaryMatch[2]);
    if (!Number.isNaN(hours24) && !Number.isNaN(minutes) && hours24 >= 0 && hours24 <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`;
  }

  return value;
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const shortDimension = Math.min(windowWidth, windowHeight);
  const isTablet = shortDimension >= 768;
  const isSmallTablet = shortDimension >= 480 && shortDimension < 768;
  const useSplitLayout = isTablet || (isSmallTablet && windowWidth > windowHeight);
  const isPhone = shortDimension < 480;

  const [items, setItems] = useState<OfflineAttendanceItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState('ALL');
  const [isActionHubOpen, setIsActionHubOpen] = useState(false);
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });

  const { hasGoodInternet, isChecking, checkStatus } = useNetworkStatus();
  const prevHasGoodInternetRef = useRef<boolean>(true);

  const cardHeight = isPhone ? 70 : isSmallTablet ? 74 : 80;
  const avatarSize = isPhone ? 40 : 48;

  const headerFontSize = isTablet ? 24 : isSmallTablet ? 20 : 18;
  const subtitleFontSize = isTablet ? 14 : isSmallTablet ? 12 : 10;
  const panelTitleFontSize = isTablet ? 20 : isSmallTablet ? 18 : 16;
  const panelIconSize = isTablet ? 24 : isSmallTablet ? 22 : 18;
  const refreshTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  
  const backButtonSize = isTablet ? 48 : isSmallTablet ? 42 : 36;
  const backIconSize = isTablet ? 32 : isSmallTablet ? 28 : 24;
  
  const connectionIconSize = isTablet ? 16 : isSmallTablet ? 14 : 12;
  const connectionTextFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;

  const noobTitleFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const noobTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const tabTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;

  const standardNameFontSize = isTablet ? 16 : isSmallTablet ? 14 : 12;
  const standardTimeFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const standardBadgeTextFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;

  const syncButtonHeight = isTablet ? 68 : isSmallTablet ? 60 : 50;
  const syncButtonTextFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
  const syncButtonIconSize = isTablet ? 24 : isSmallTablet ? 22 : 18;

  const historyCountFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;

  const actionHubTextFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const actionHubFilterTextFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;

  const tableHeaderFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;
  const rowNameFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const rowIdFontSize = isTablet ? 11 : isSmallTablet ? 10 : 9;
  const rowTimeFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const avatarTextFontSize = isTablet ? 16 : isSmallTablet ? 14 : 12;
  const emptyTextFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;

  const reloadQueue = useCallback(async () => {
    const queue = await getOfflineAttendanceQueue();
    setItems(queue);
  }, []);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    
    // Check if we have internet before trying to fetch
    if (!hasGoodInternet) {
      try {
        const cached = await AsyncStorage.getItem('cached_attendance_today_history');
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch (e) {
        console.error('[OfflineSync] Failed to load cached history', e);
      }
      setIsHistoryLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    try {
      const res = await fetch(`${BACKEND_URL}/attendance_today.php?t=${Date.now()}`, {
        headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const json = await res.json();
      if (json.ok) {
        const fetchedHistory = json.history || [];
        setHistory(fetchedHistory);
        await AsyncStorage.setItem('cached_attendance_today_history', JSON.stringify(fetchedHistory));
      }
    } catch (e) {
      clearTimeout(timeoutId);
      // Only log if it's not a standard connectivity error
      const message = String((e as any)?.message || '').toLowerCase();
      const isConnectivity = message.includes('network request failed') || message.includes('aborted');
      if (!isConnectivity) {
        console.error('[OfflineSync] Failed to fetch history', e);
      }

      try {
        const cached = await AsyncStorage.getItem('cached_attendance_today_history');
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch {}
    } finally {
      setIsHistoryLoading(false);
    }
  }, [hasGoodInternet]);

  useEffect(() => {
    const initHistoryFromCache = async () => {
      try {
        const cached = await AsyncStorage.getItem('cached_attendance_today_history');
        if (cached) {
          setHistory(JSON.parse(cached));
        }
      } catch (e) {
        console.error('Failed to load cached history', e);
      }
    };
    initHistoryFromCache();
  }, []);

  useEffect(() => {
    if (hasGoodInternet && !prevHasGoodInternetRef.current) {
      loadHistory().catch(() => undefined);
    }
    prevHasGoodInternetRef.current = hasGoodInternet;
  }, [hasGoodInternet, loadHistory]);

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
    if (isSyncing || !hasGoodInternet) return;

    setIsSyncing(true);
    try {
      await syncOfflineQueue();
      await loadHistory();
    } finally {
      await reloadQueue();
      setIsSyncing(false);
    }
  }, [isSyncing, reloadQueue, loadHistory, hasGoodInternet]);

  const handleDeleteItem = useCallback(async (id: string) => {
    try {
      await removeOfflineAttendanceItem(id);
      await reloadQueue();
    } catch (e) {
      console.error('[OfflineSync] Failed to delete item', e);
    }
  }, [reloadQueue]);

  const exportToCSV = async (dataToExport: any[]) => {
    try {
      const headerString = 'ID,Name,Time In,Time Out\n';
      const rowString = dataToExport.map(item => {
        const displayName = item.name?.trim() || item.username;
        const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
        const timeoutVal = item.timeout || (item.action === 'clock_out' ? item.time : null);
        const csvId = item.emp_id || item.userId || item.id || item.username;
        return `"\t${csvId}","${displayName}","${formatMilitaryTime(timeinVal)}","${formatMilitaryTime(timeoutVal)}"`;
      }).join('\n');
      
      const csvString = `${headerString}${rowString}`;
      
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const fileName = `${year}_${month}_${day}_ATTENDANCE_TODAY.csv`;
      
      const file = new File(Paths.document, fileName);
      file.write(csvString, { encoding: 'utf8' });
      
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert('Sharing', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Export Error', 'Failed to export data');
    }
  };

  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const displayName = item.name?.trim() || item.username;
      const matchesSearch = displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.username.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
      if (timeFilter === 'ALL') return true;
      
      const displayTime = formatTimeDisplay(timeinVal).toLowerCase();
      if (timeFilter === 'AM' && displayTime.includes('am')) return true;
      if (timeFilter === 'PM' && displayTime.includes('pm')) return true;
      if (displayTime === '-' || !displayTime) return true; // Include items without time in filtered view if they match search
      
      return false;
    });
  }, [history, searchQuery, timeFilter]);

  const DashboardWrapper = useSplitLayout ? View : ScrollView;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.mainHeader}>
        <View style={styles.headerLeftRow}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: pressed ? withAlpha(colors.border, 0.2) : 'transparent',
                borderColor: colors.border,
                width: backButtonSize,
                height: backButtonSize,
                borderRadius: backButtonSize / 2,
                marginRight: isTablet ? 16 : isSmallTablet ? 12 : 8,
              },
            ]}
          >
            <MaterialCommunityIcons name="chevron-left" size={backIconSize} color={colors.text} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={[styles.headerTitle, { color: colors.text, fontSize: headerFontSize }]} numberOfLines={1}>
              Management Dashboard
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary, fontSize: subtitleFontSize }]} numberOfLines={1}>
              {kioskMode === 'intern' 
                ? 'Monitor and synchronize local Intern DTR logs.' 
                : 'Monitor and synchronize local Employee DTR logs.'}
            </Text>
          </View>
        </View>

        <View style={[
          styles.headerConnectionBanner,
          { 
            backgroundColor: hasGoodInternet ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
            borderColor: hasGoodInternet ? '#22c55e' : '#ef4444' 
          }
        ]}>
          <MaterialCommunityIcons 
            name={hasGoodInternet ? "wifi" : "wifi-off"} 
            size={connectionIconSize} 
            color={hasGoodInternet ? "#22c55e" : "#ef4444"} 
          />
          <Text style={[styles.connectionBannerText, { color: hasGoodInternet ? "#16a34a" : "#dc2626", fontSize: connectionTextFontSize }]}>
            {hasGoodInternet ? "ONLINE" : "OFFLINE"}
          </Text>
        </View>
      </View>

      <DashboardWrapper
        style={[
          styles.dashboardContainer, 
          useSplitLayout ? styles.tabletRow : styles.mobileColumn
        ]}
        {...(!useSplitLayout ? {
          contentContainerStyle: styles.mobileScrollContainer,
          showsVerticalScrollIndicator: false,
          refreshControl: (
            <RefreshControl
              refreshing={isHistoryLoading}
              onRefresh={loadHistory}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          )
        } : {})}
      >
        {/* Left Panel: Offline Sync Queue */}
        <View style={[
          styles.syncPanel, 
          useSplitLayout ? { 
            flex: 0.5, 
            backgroundColor: theme === 'light' ? '#FFFFFF' : colors.surface, 
            borderRightWidth: 1, 
            borderRightColor: colors.border,
            zIndex: 10,
            shadowColor: '#000',
            shadowOffset: { width: 4, height: 0 },
            shadowOpacity: 0.08,
            shadowRadius: 10,
            elevation: 8, 
          } : {
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
          }
        ]}>


          <View style={styles.panelHeaderRow}>
            <View style={styles.panelTitleContainer}>
              <MaterialCommunityIcons name="cloud-off-outline" size={panelIconSize} color="#f97316" />
              <Text style={[styles.panelTitle, { color: colors.text, fontSize: panelTitleFontSize }]}>Offline Queue</Text>
            </View>
          </View>

          <View style={[styles.noobInfoBox, { backgroundColor: withAlpha('#f97316', 0.08) }]}>
            <Text style={[styles.noobTitle, { color: '#ea580c', fontSize: noobTitleFontSize }]}>WAITING TO SYNC</Text>
            <Text style={[styles.noobText, { color: colors.textSecondary, fontSize: noobTextFontSize }]}>
              These logs were saved offline. Click <Text style={{fontWeight: '800', color: '#ea580c'}}>SYNC NOW</Text> to send to server.
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
              <Text style={[styles.tabText, { color: activeTab === 'pending' ? '#ea580c' : colors.textSecondary, fontSize: tabTextFontSize }]}>
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
              <Text style={[styles.tabText, { color: activeTab === 'failed' ? '#ef4444' : colors.textSecondary, fontSize: tabTextFontSize }]}>
                Errors ({failedItems.length})
              </Text>
            </Pressable>
          </View>

          <ScrollView scrollEnabled={useSplitLayout} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
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
                         height: isFailedItem ? undefined : cardHeight,
                         paddingVertical: isFailedItem ? 12 : undefined,
                       },
                    ]}
                  >
                    <View style={[
                      styles.standardAvatar,
                      {
                        backgroundColor: isFailedItem ? '#ef4444' : '#f97316',
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: isPhone ? 10 : 12,
                      }
                    ]}>
                      <Text style={[styles.avatarText, { fontSize: avatarTextFontSize }]}>{getInitials(displayName)}</Text>
                    </View>
                    <View style={styles.standardContent}>
                      <View style={styles.standardTopRow}>
                        <Text style={[styles.standardName, { color: colors.text, fontSize: standardNameFontSize }]} numberOfLines={1}>{displayName}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={[styles.standardBadge, { backgroundColor: isFailedItem ? withAlpha('#ef4444', 0.15) : withAlpha('#f97316', 0.15) }]}>
                            <Text style={[styles.standardBadgeText, { color: isFailedItem ? '#ef4444' : '#ea580c', fontSize: standardBadgeTextFontSize }]}>
                              {item.action === 'clock_in' ? 'IN' : 'OUT'}
                            </Text>
                          </View>
                          {isFailedItem && (
                            <Pressable
                              onPress={() => handleDeleteItem(item.id)}
                              style={({ pressed }) => [{ marginLeft: 12, opacity: pressed ? 0.6 : 1 }]}
                            >
                              <MaterialCommunityIcons name="delete-outline" size={20} color="#ef4444" />
                            </Pressable>
                          )}
                        </View>
                      </View>
                      <Text style={[styles.standardTime, { color: colors.textSecondary, fontSize: standardTimeFontSize }]}>{formatTimeDisplay(item.time)}</Text>
                      {isFailedItem && item.errorMessage ? (
                        <Text style={{ color: '#ef4444', fontSize: 11, marginTop: 4, fontWeight: '500' }}>
                          Error: {item.errorMessage}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.border} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: emptyTextFontSize }]}>Queue is Clear</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.syncButton,
                { 
                  backgroundColor: pressed ? withAlpha(Colors.powerOrange, 0.85) : Colors.powerOrange,
                  height: syncButtonHeight
                },
                (isSyncing || !hasGoodInternet) && styles.syncButtonDisabled,
              ]}
              onPress={handleSyncNow}
              disabled={isSyncing || !hasGoodInternet}
            >
              {isSyncing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.btnInner}>
                  <MaterialCommunityIcons name="cloud-upload" size={syncButtonIconSize} color="#fff" />
                  <Text style={[styles.syncButtonText, { fontSize: syncButtonTextFontSize }]}>SYNC NOW</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* Right Panel: Today's History */}
        <View style={[
          styles.historyPanel, 
          useSplitLayout ? { 
            flex: 0.5, 
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background, 
          } : {
            backgroundColor: theme === 'light' ? '#F4F4F5' : colors.background,
            paddingHorizontal: isPhone ? 12 : 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }
        ]}>
          <View style={styles.panelHeaderRow}>
            <View style={styles.panelTitleContainer}>
              <MaterialCommunityIcons name="history" size={panelIconSize} color={colors.accent} />
              <Text style={[styles.panelTitle, { color: colors.text, fontSize: panelTitleFontSize }]}>Today's History</Text>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <Pressable onPress={loadHistory} disabled={isHistoryLoading}>
                <Text style={[styles.refreshText, { color: colors.accent, fontSize: refreshTextFontSize }]}>
                  {isHistoryLoading ? '...' : 'REFRESH'}
                </Text>
              </Pressable>
              {!hasGoodInternet && (
                <Text style={{fontSize: 9, color: colors.textSecondary, fontWeight: '700', marginTop: 2}}>CACHED DATA</Text>
              )}
            </View>
          </View>

          <View style={[styles.historySubHeader, { zIndex: 50 }]}>
            <Text style={[styles.historyCount, { color: colors.textSecondary, fontSize: historyCountFontSize }]}>{filteredHistory.length} RECORDS ON SERVER</Text>
            
            <View style={{position: 'relative', zIndex: 50}}>
              <Pressable 
                onPress={() => setIsActionHubOpen(!isActionHubOpen)}
                style={({ pressed }) => [
                  {
                    width: 36, height: 36, borderRadius: 18, 
                    backgroundColor: pressed ? withAlpha(colors.accent, 0.2) : withAlpha(colors.accent, 0.1),
                    alignItems: 'center', justifyContent: 'center'
                  }
                ]}
              >
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.accent} />
              </Pressable>
              
              {isActionHubOpen && (
                <View style={{
                  position: 'absolute', top: 45, right: 0,
                  backgroundColor: theme === 'light' ? '#fff' : colors.surface,
                  padding: 16, borderRadius: 12, width: 250,
                  shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
                  borderWidth: 1, borderColor: colors.border, zIndex: 100
                }}>
                  {/* Search Input */}
                  <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: withAlpha(colors.border, 0.2), borderRadius: 8, paddingHorizontal: 10, marginBottom: 12, height: 40}}>
                    <MaterialCommunityIcons name="magnify" size={20} color={colors.textSecondary} />
                    <TextInput 
                      placeholder="Search Name/ID"
                      placeholderTextColor={colors.textSecondary}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      style={{flex: 1, marginLeft: 8, color: colors.text, fontSize: actionHubTextFontSize}}
                    />
                  </View>
                  
                  {/* Time Filter Row */}
                  <View style={{flexDirection: 'row', gap: 8, marginBottom: 16}}>
                    {['ALL', 'AM', 'PM'].map(f => (
                      <Pressable 
                        key={f}
                        onPress={() => setTimeFilter(f)}
                        style={{flex: 1, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: timeFilter === f ? colors.accent : withAlpha(colors.border, 0.2)}}
                      >
                        <Text style={{fontSize: actionHubFilterTextFontSize, fontWeight: '800', color: timeFilter === f ? '#fff' : colors.text}}>{f}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable 
                    onPress={() => {
                      setIsActionHubOpen(false);
                      exportToCSV(filteredHistory);
                    }}
                    style={{backgroundColor: '#22c55e', height: 44, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8}}
                  >
                    <MaterialCommunityIcons name="file-excel" size={20} color="#fff" />
                    <Text style={{color: '#fff', fontWeight: '900', fontSize: actionHubTextFontSize}}>EXPORT CSV</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>

          <ScrollView
            scrollEnabled={useSplitLayout}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              useSplitLayout ? (
                <RefreshControl
                  refreshing={isHistoryLoading}
                  onRefresh={loadHistory}
                  colors={[colors.accent]}
                  tintColor={colors.accent}
                />
              ) : undefined
            }
          >
            {filteredHistory.length > 0 ? (
              <View style={{backgroundColor: theme === 'light' ? '#fff' : colors.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border}}>
                <View style={{flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: withAlpha(colors.border, 0.3), borderBottomWidth: 1, borderBottomColor: colors.border}}>
                  <Text style={{flex: 1.5, fontSize: tableHeaderFontSize, fontWeight: '900', color: colors.textSecondary, textAlign: 'left'}}>NAME</Text>
                  <Text style={{flex: 1, fontSize: tableHeaderFontSize, fontWeight: '900', color: colors.textSecondary, textAlign: 'left'}}>TIME IN</Text>
                  <Text style={{flex: 1, fontSize: tableHeaderFontSize, fontWeight: '900', color: colors.textSecondary, textAlign: 'left'}}>TIME OUT</Text>
                </View>
                {filteredHistory.map((item, index) => {
                  const displayName = item.name?.trim() || item.username;
                  const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
                  const timeoutVal = item.timeout || (item.action === 'clock_out' ? item.time : null);
                  const displayId = item.emp_id || item.userId || item.id || item.username;
                  const isEven = index % 2 === 0;

                  return (
                    <View key={item.id} style={{flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: isEven ? 'transparent' : withAlpha(colors.border, 0.1), borderBottomWidth: index === filteredHistory.length - 1 ? 0 : 1, borderBottomColor: withAlpha(colors.border, 0.4), alignItems: 'center'}}>
                      <View style={{flex: 1.5, alignItems: 'flex-start'}}>
                        <Text style={{fontSize: rowNameFontSize, fontWeight: '800', color: colors.text, textAlign: 'left'}} numberOfLines={1}>{displayName}</Text>
                        {kioskMode !== 'intern' && (
                          <Text style={{fontSize: rowIdFontSize, color: colors.textSecondary, marginTop: 2, textAlign: 'left'}} numberOfLines={1}>{displayId}</Text>
                        )}
                      </View>
                      <Text style={{flex: 1, fontSize: rowTimeFontSize, fontWeight: '700', color: '#22c55e', textAlign: 'left'}}>
                        {timeinVal ? formatTimeDisplay(timeinVal) : '--:--'}
                      </Text>
                      <Text style={{flex: 1, fontSize: rowTimeFontSize, fontWeight: '700', color: '#ef4444', textAlign: 'left'}}>
                        {timeoutVal ? formatTimeDisplay(timeoutVal) : '--:--'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="table-search" size={48} color={colors.border} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: emptyTextFontSize }]}>
                  {history.length > 0 ? "No Matching Records" : "No History Yet"}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </DashboardWrapper>
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
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerConnectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    marginLeft: 16,
  },
  dashboardContainer: {
    flex: 1,
  },
  mobileColumn: {
    flexDirection: 'column',
    flex: 1,
  },
  tabletRow: {
    flexDirection: 'row',
  },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  connectionBannerText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
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
  mobileScrollContainer: {
    flexGrow: 1,
    flexDirection: 'column',
  },
  standardUsername: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  timeGrid: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  gridLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  gridValue: {
    fontSize: 11,
    fontWeight: '800',
  },
});
