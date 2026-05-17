import React, { useEffect, useState, useMemo } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator, Image, ScrollView, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, useTheme } from '../../../config/theme';
import { BACKEND_URL } from '../../../config/backend';

type AttendanceLog = {
  date: string;
  timein: string | null;
  timeout: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  employee: any;
};

type FilterType = 'week' | 'month' | string;

export default function EmployeeDetailsModal({ visible, onClose, employee }: Props) {
  const { colors, theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<AttendanceLog[]>([]);
  const [filter, setFilter] = useState<FilterType>('week');
  const [hqImage, setHqImage] = useState<string | null>(null);
  const [hqLoading, setHqLoading] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);

  useEffect(() => {
    if (visible && employee?.emp_id) {
      fetchHistory();
      fetchHqDetails();
    } else {
      setHistory([]);
      setHqImage(null);
      setHqLoading(false);
      setShowMonthDropdown(false);
    }
  }, [visible, employee, filter]);

  const fetchHqDetails = async () => {
    if (!employee?.emp_id) return;
    
    setHqLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/employees.php?detail_id=${employee.emp_id}`);
      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        if (payload.ok && payload.user?.profile_picture_hq) {
          setHqImage(payload.user.profile_picture_hq);
        } else if (payload.ok && payload.user?.profile_picture) {
          setHqImage(payload.user.profile_picture);
        }
      } catch (jsonErr) {
        console.error('Invalid JSON from employees.php:', text.substring(0, 200));
      }
    } catch (e) {
      console.error('Failed to fetch HQ image', e);
    } finally {
      setHqLoading(false);
    }
  };

  const fetchHistory = async () => {
    if (!employee?.emp_id) return;
    setLoading(true);
    try {
      let url = `${BACKEND_URL}/record_attendance.php?emp_id=${employee.emp_id}`;
      
      const now = new Date();
      if (filter === 'week') {
        const lastWeek = new Date();
        lastWeek.setDate(now.getDate() - 7);
        url += `&since=${lastWeek.toISOString().split('T')[0]}&limit=50`;
      } else if (filter === 'month') {
        const lastMonth = new Date();
        lastMonth.setDate(now.getDate() - 30);
        url += `&since=${lastMonth.toISOString().split('T')[0]}&limit=50`;
      } else if (filter !== 'all') {
        // filter is a month index '0' to '11'
        const year = now.getFullYear();
        const monthIdx = parseInt(filter, 10);
        const startDate = new Date(year, monthIdx, 1);
        url += `&since=${startDate.toISOString().split('T')[0]}&limit=100`;
      } else {
        url += `&limit=100`;
      }

      const response = await fetch(url);
      const payload = await response.json();
      if (payload.ok) {
        let fetchedData = payload.data || [];
        // Local filtering if a specific month is selected
        if (filter !== 'all' && filter !== 'week' && filter !== 'month') {
          const targetMonth = parseInt(filter, 10);
          fetchedData = fetchedData.filter((log: any) => new Date(log.date).getMonth() === targetMonth);
        }
        setHistory(fetchedData);
      } else {
        setHistory([]);
      }
    } catch (e) {
      console.error('Failed to fetch attendance history', e);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const getProfilePicture = () => {
    if (hqImage) return hqImage;
    if (!employee) return null;
    const acc = Array.isArray(employee.accounts) ? employee.accounts[0] : employee.accounts;
    return acc?.profile_picture;
  };

  const isTablet = windowWidth > 600;

  const modalWidth = useMemo(() => {
    if (windowWidth > 1200) return 900;
    if (windowWidth > 800) return windowWidth * 0.8;
    return windowWidth * 0.95;
  }, [windowWidth]);

  const modalHeight = useMemo(() => {
    return windowHeight * 0.85;
  }, [windowHeight]);

  const FilterButton = ({ type, label, icon }: { type: FilterType, label: string, icon: any }) => (
    <Pressable 
      onPress={() => setFilter(type)}
      style={[
        styles.filterBtn, 
        { backgroundColor: filter === type ? Colors.powerOrange : (theme === 'light' ? '#f3f4f6' : '#2a2a2a') }
      ]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={filter === type ? '#fff' : colors.textSecondary} />
      <Text style={[styles.filterBtnText, { color: filter === type ? '#fff' : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );

  const MonthDropdown = () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const isActive = filter !== 'week' && filter !== 'month';
    const label = filter === 'all' ? 'All Time' : (isActive ? months[parseInt(filter as string, 10)] : 'Month');
    
    return (
      <View style={{ position: 'relative', zIndex: 50 }}>
        <Pressable 
          onPress={() => setShowMonthDropdown(!showMonthDropdown)}
          style={[
            styles.filterBtn, 
            { backgroundColor: isActive ? Colors.powerOrange : (theme === 'light' ? '#f3f4f6' : '#2a2a2a') }
          ]}
        >
          <MaterialCommunityIcons name="calendar-range" size={18} color={isActive ? '#fff' : colors.textSecondary} />
          <Text style={[styles.filterBtnText, { color: isActive ? '#fff' : colors.textSecondary }]}>
            {label} ▼
          </Text>
        </Pressable>

        {showMonthDropdown && (
          <View style={[styles.dropdownList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }} showsVerticalScrollIndicator={true}>
              <Pressable 
                onPress={() => { setFilter('all'); setShowMonthDropdown(false); }}
                style={[styles.dropdownOption, filter === 'all' && { backgroundColor: theme === 'light' ? '#f3f4f6' : '#322721' }]}
              >
                <Text style={[styles.optionText, { color: colors.text }]}>All Time</Text>
              </Pressable>
              {months.map((m, idx) => {
                const typeVal = idx.toString();
                return (
                  <Pressable 
                    key={m} 
                    onPress={() => {
                      setFilter(typeVal);
                      setShowMonthDropdown(false);
                    }}
                    style={[
                      styles.dropdownOption,
                      filter === typeVal && { backgroundColor: theme === 'light' ? '#f3f4f6' : '#322721' }
                    ]}
                  >
                    <Text style={[styles.optionText, { color: colors.text }]}>{m}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { width: modalWidth, height: modalHeight, backgroundColor: colors.surface }]}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <MaterialCommunityIcons name="close-circle" size={36} color={colors.textSecondary} />
          </Pressable>
          
          <View style={[styles.contentLayout, !isTablet && { flexDirection: 'column' }]}>
            {/* Left Panel: Profile */}
            <View style={[styles.profilePanel, isTablet ? { width: '35%', borderRightWidth: 1, borderRightColor: colors.border } : { width: '100%', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 20 }]}>
              <View style={[styles.avatarContainer, { borderColor: Colors.powerOrange, width: isTablet ? 160 : 100, height: isTablet ? 160 : 100, borderRadius: isTablet ? 80 : 50 }]}>
                {getProfilePicture() ? (
                  <Image source={{ uri: getProfilePicture() }} style={styles.profileImage} />
                ) : (
                  <View style={styles.placeholderAvatar}>
                    <Text style={[styles.placeholderText, { color: colors.textSecondary, fontSize: isTablet ? 64 : 40 }]}>{employee?.name?.charAt(0) || '?'}</Text>
                  </View>
                )}
                {hqLoading && (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size={isTablet ? 'large' : 'small'} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={[styles.name, { color: colors.text, fontSize: isTablet ? 32 : 22 }]} numberOfLines={2}>{employee?.name || 'No Name'}</Text>
              <Text style={[styles.role, { color: colors.textSecondary, fontSize: isTablet ? 18 : 14 }]}>{employee?.role || 'No Role'}</Text>
              
              <View style={[styles.deptTag, { backgroundColor: theme === 'light' ? '#f3f4f6' : '#333' }]}>
                <Text style={[styles.deptText, { color: colors.textSecondary }]}>
                  {employee?.departments?.name || 'General'}
                </Text>
              </View>

              {isTablet && (
                <View style={styles.statsContainer}>
                  <View style={[styles.statBox, { backgroundColor: theme === 'light' ? '#fff9f0' : '#2a2420' }]}>
                    <Text style={[styles.statValue, { color: Colors.powerOrange }]}>{history.length}</Text>
                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>LOGS</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Right Panel: History */}
            <View style={styles.historyPanel}>
              <View style={[styles.historyHeader, !isTablet && { flexDirection: 'column', alignItems: 'flex-start', gap: 15 }]}>
                <View style={styles.headerLeftInfo}>
                  <Text style={[styles.historyTitle, { color: colors.text, fontSize: isTablet ? 24 : 18 }]}>Attendance Records</Text>
                  <View style={styles.filterRow}>
                    <FilterButton type="week" label="7D" icon="calendar-week" />
                    <FilterButton type="month" label="30D" icon="calendar-month" />
                    <MonthDropdown />
                  </View>
                </View>
              </View>
              
              {loading ? (
                <View style={styles.centered}>
                  <ActivityIndicator size="large" color={Colors.powerOrange} />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Updating history...</Text>
                </View>
              ) : (
                <ScrollView 
                  style={styles.historyList} 
                  contentContainerStyle={history.length === 0 && { flexGrow: 1 }}
                  showsVerticalScrollIndicator={false}
                >
                  {history.length > 0 ? (
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableLabel, { flex: 2, color: colors.textSecondary }]}>DATE</Text>
                      <Text style={[styles.tableLabel, { flex: 1, textAlign: 'center', color: colors.textSecondary }]}>IN</Text>
                      <Text style={[styles.tableLabel, { flex: 1, textAlign: 'center', color: colors.textSecondary }]}>OUT</Text>
                    </View>
                  ) : null}

                  {history.length > 0 ? (
                    history.map((log, index) => (
                      <View key={index} style={[styles.logRow, { borderBottomColor: colors.border }]}>
                        <View style={{ flex: 2 }}>
                          <Text style={[styles.logDate, { color: colors.text, fontSize: isTablet ? 18 : 14 }]}>{new Date(log.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                        </View>
                        <View style={styles.timeBox}>
                          <Text style={[styles.logTime, { color: Colors.powerOrange, fontSize: isTablet ? 18 : 14 }]}>{log.timein?.substring(0, 5) || '--:--'}</Text>
                        </View>
                        <View style={styles.timeBox}>
                          <Text style={[styles.logTime, { color: colors.text, fontSize: isTablet ? 18 : 14 }]}>{log.timeout?.substring(0, 5) || '--:--'}</Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <View style={styles.centered}>
                      <MaterialCommunityIcons name="calendar-blank" size={64} color={colors.border} />
                      <Text style={[styles.noData, { color: colors.textSecondary }]}>No records found for this period.</Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.75)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  container: { 
    borderRadius: 40, 
    overflow: 'hidden',
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 15 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 25, 
    elevation: 20 
  },
  closeButton: { 
    position: 'absolute', 
    right: 25, 
    top: 25, 
    zIndex: 100 
  },
  contentLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  profilePanel: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyPanel: {
    flex: 1,
    padding: 30,
  },
  avatarContainer: { 
    marginBottom: 20, 
    overflow: 'hidden', 
    borderWidth: 6, 
    backgroundColor: 'rgba(0,0,0,0.05)'
  },
  profileImage: { width: '100%', height: '100%' },
  placeholderAvatar: { 
    width: '100%', 
    height: '100%', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  placeholderText: { fontWeight: '800' },
  name: { fontWeight: '900', textAlign: 'center', lineHeight: 32 },
  role: { marginTop: 6, fontWeight: '600', letterSpacing: 0.5 },
  deptTag: {
    marginTop: 15,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  deptText: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statsContainer: {
    marginTop: 30,
    width: '100%',
  },
  statBox: {
    padding: 20,
    borderRadius: 24,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 36,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingRight: 60, // Ensure no overlap with close button
  },
  headerLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 20,
  },
  historyTitle: { fontWeight: '900' },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    zIndex: 50,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
  },
  filterBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  dropdownList: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 130,
    borderRadius: 12,
    borderWidth: 1.5,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    zIndex: 1000,
  },
  dropdownOption: {
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyList: { flex: 1 },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    marginBottom: 10,
  },
  tableLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 15, 
    borderBottomWidth: 1, 
  },
  logDate: { fontWeight: '800' },
  timeBox: { flex: 1, alignItems: 'center' },
  logTime: { fontWeight: '700', fontFamily: 'monospace' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 15, fontWeight: '700', fontSize: 16 },
  noData: { textAlign: 'center', marginTop: 15, fontWeight: '600', fontSize: 18 }
});
