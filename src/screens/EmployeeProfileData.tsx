import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { updateOfflineUserCacheFromEmployees, getOfflineUserCache, clearOfflineUserCache } from '../utils/offlineUsers';
import { useTheme, Colors } from '../config/theme';

const DIRECTORY_POLL_INTERVAL_MS = 30000; // Increased to 30s to reduce background load
const LAST_SYNC_KEY = 'employee_directory_last_sync';

type SortOption = 'name_asc' | 'name_desc';

type Account = {
  log_id: number;
  username: string | null;
  qr_code?: string | null;
  profile_picture?: string | null;
};

type EmployeeRow = {
  emp_id: number;
  name: string;
  role: string | null;
  dept_id: number | null;
  log_id: number | null;
  accounts?: Account | Account[] | null;
  departments?: {
    name?: string | null;
  } | null;
};

type Props = {
  onBack: () => void;
};

// Global in-memory cache to handle "already opened" case instantly
let globalEmployeesCache: EmployeeRow[] = [];
let globalLastSyncCache: number | null = null;

export default function EmployeeProfileData({ onBack }: Props) {
  const normalizeAccount = (val: Account | Account[] | null | undefined): Account | null => {
    if (Array.isArray(val)) return val[0] ?? null;
    return val ?? null;
  };

  const [employees, setEmployees] = useState<EmployeeRow[]>(globalEmployeesCache);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const ITEMS_PER_PAGE = 25;
  
  const setUniqueEmployees = useCallback((data: EmployeeRow[], append: boolean = false) => {
    const seen = new Set<number>();
    const sourceData = append ? [...employeesRef.current, ...data] : data;
    const unique = sourceData.filter(emp => {
      if (!emp.emp_id || seen.has(emp.emp_id)) return false;
      seen.add(emp.emp_id);
      return true;
    });
    setEmployees(unique);
    globalEmployeesCache = unique;
    
    // If we got fewer items than requested, there's no more data
    if (data.length < ITEMS_PER_PAGE) {
      setHasMore(false);
    } else {
      setHasMore(true);
    }
  }, []);

  const employeesRef = useRef<EmployeeRow[]>(globalEmployeesCache);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('name_asc');
  const [selectedDept, setSelectedDept] = useState<string>('All Departments');
  const [selectedRole, setSelectedRole] = useState<string>('All Roles');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(globalEmployeesCache.length === 0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(globalLastSyncCache);
  const { colors, theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(true);

  // Animation for sliding shimmer
  const shimmerTranslate = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (isRefreshing || (isLoading && employees.length === 0)) {
      Animated.loop(
        Animated.timing(shimmerTranslate, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        })
      ).start();
    } else {
      shimmerTranslate.setValue(-1);
    }
  }, [isRefreshing, isLoading, employees.length, shimmerTranslate]);

  const updateLastSync = useCallback(async (timestamp: number) => {
    setLastUpdatedAt(timestamp);
    globalLastSyncCache = timestamp;
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(timestamp));
  }, []);

  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  const fetchEmployees = useCallback(async (options?: { showLoading?: boolean; manual?: boolean; page?: number }) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    
    const page = options?.page ?? 0;
    const isInitial = page === 0;

    if (options?.showLoading && isInitial && employeesRef.current.length === 0) {
      setIsLoading(true);
    }
    
    if (!isInitial) setIsLoadingMore(true);
    if (options?.manual && isInitial) setIsRefreshing(true);

    try {
      const response = await fetch(`${BACKEND_URL}/employees.php?page=${page}&limit=${ITEMS_PER_PAGE}`);
      const payload = await response.json();

      if (!payload?.ok || !Array.isArray(payload?.data)) {
        throw new Error('Unable to sync employee directory');
      }

      const rows = payload.data as EmployeeRow[];
      
      // Update local cache only on first few pages to save storage, 
      // or update it fully but with compressed thumbnails.
      if (isInitial) {
        await updateOfflineUserCacheFromEmployees(rows);
      }
      
      const now = Date.now();
      if (!mountedRef.current) return;
      
      setUniqueEmployees(rows, !isInitial);
      if (isInitial) {
        await updateLastSync(now);
        setCurrentPage(0);
      } else {
        setCurrentPage(page);
      }
    } catch (error) {
      console.log('fetchEmployees error:', error);
    } finally {
      isFetchingRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [setUniqueEmployees, updateLastSync]);

  const departments = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach(emp => {
      const deptName = emp?.departments?.name;
      if (deptName) depts.add(deptName);
    });
    return ['All Departments', ...Array.from(depts).sort()];
  }, [employees]);

  const roles = useMemo(() => {
    const rls = new Set<string>();
    employees.forEach(emp => {
      if (emp?.role) rls.add(emp.role);
    });
    return ['All Roles', ...Array.from(rls).sort()];
  }, [employees]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    mountedRef.current = true;
    const bootstrap = async () => {
      try {
        const [cached, lastSync] = await Promise.all([
          getOfflineUserCache(),
          AsyncStorage.getItem(LAST_SYNC_KEY)
        ]);
        if (!mountedRef.current) return;
        if (lastSync) {
          const ts = parseInt(lastSync);
          setLastUpdatedAt(ts);
          globalLastSyncCache = ts;
        }

        if (cached && cached.length > 0) {
          const mapped: EmployeeRow[] = cached.map(u => ({
            emp_id: parseInt(u.userId) || 0,
            name: u.name || '',
            role: u.role || null,
            dept_id: null,
            log_id: parseInt(u.userId) || null,
            accounts: {
              log_id: parseInt(u.userId) || 0,
              username: u.username,
              qr_code: u.qrCode,
              profile_picture: u.profile_picture
            },
            departments: { name: u.department }
          }));
          setUniqueEmployees(mapped);
          setIsBootstrapping(false);
          // Sync silently in background (first page)
          fetchEmployees({ showLoading: false, page: 0 });
        } else if (globalEmployeesCache.length > 0) {
          setIsBootstrapping(false);
          fetchEmployees({ showLoading: false, page: 0 });
        } else {
          await fetchEmployees({ showLoading: true, page: 0 });
          setIsBootstrapping(false);
        }
      } catch (e) {
        console.error('Bootstrap error:', e);
        if (employeesRef.current.length === 0) {
          await fetchEmployees({ showLoading: true, page: 0 });
        }
        setIsBootstrapping(false);
      }
    };
    bootstrap();
    // Poll only first page periodically
    const pollTimer = setInterval(() => fetchEmployees({ showLoading: false, page: 0 }), DIRECTORY_POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(pollTimer);
    };
  }, [fetchEmployees, setUniqueEmployees]);

  const handleManualRefresh = useCallback(() => {
    fetchEmployees({ manual: true, page: 0 });
  }, [fetchEmployees]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchEmployees({ page: currentPage + 1 });
    }
  }, [fetchEmployees, currentPage, isLoadingMore, hasMore]);

  const sortedAndFilteredEmployees = useMemo(() => {
    let result = employees.filter(emp => {
      const matchesSearch = emp.name.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
        (emp.role && emp.role.toLowerCase().includes(debouncedSearchText.toLowerCase()));
      
      const matchesDept = selectedDept === 'All Departments' || emp.departments?.name === selectedDept;
      const matchesRole = selectedRole === 'All Roles' || emp.role === selectedRole;

      return matchesSearch && matchesDept && matchesRole;
    });

    if (sortBy === 'name_asc') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'name_desc') {
      result.sort((a, b) => b.name.localeCompare(a.name));
    }

    return result;
  }, [employees, debouncedSearchText, sortBy, selectedDept, selectedRole]);

  const DropdownSelector = ({ 
    label, 
    value, 
    options, 
    isOpen, 
    onToggle, 
    onSelect 
  }: { 
    label: string, 
    value: string, 
    options: string[], 
    isOpen: boolean, 
    onToggle: () => void, 
    onSelect: (val: string) => void 
  }) => (
    <View style={styles.dropdownContainer}>
      <Pressable 
        onPress={onToggle}
        style={[
          styles.dropdownButton, 
          { 
            backgroundColor: colors.surface,
            borderColor: value !== label ? Colors.powerOrange : colors.border 
          }
        ]}
      >
        <Text style={[styles.dropdownValue, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={{ color: Colors.powerOrange, fontSize: 12 }}>{isOpen ? '▲' : '▼'}</Text>
      </Pressable>
      
      {isOpen && (
        <View style={[styles.dropdownList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 250 }}>
            {options.map((opt) => (
              <Pressable 
                key={opt} 
                onPress={() => {
                  onSelect(opt);
                  onToggle();
                }}
                style={[
                  styles.dropdownOption,
                  value === opt && { backgroundColor: theme === 'light' ? '#f3f4f6' : '#322721' }
                ]}
              >
                <Text style={[styles.optionText, { color: colors.text }]}>{opt}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const cardWidth = useMemo(() => {
    const availableWidth = windowWidth - 64; // 32 horizontal padding on each side
    const gap = 20;
    let cols = 1;
    if (windowWidth >= 1200) cols = 4;
    else if (windowWidth >= 900) cols = 3;
    else if (windowWidth >= 600) cols = 2;
    
    return Math.max(availableWidth - (gap * (cols - 1)), 0) / cols;
  }, [windowWidth]);

  const SkeletonCard = () => (
    <View style={[styles.employeeCard, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border, overflow: 'hidden' }]}>
      <Animated.View 
        style={[
          styles.shimmerStreak, 
          { 
            transform: [{ 
              translateX: shimmerTranslate.interpolate({
                inputRange: [-1, 1],
                outputRange: [-200, 600]
              }) 
            }] 
          }
        ]} 
      />
      <View style={[styles.accentStrip, { backgroundColor: colors.border, opacity: 0.3 }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatarRing, { borderColor: colors.border, opacity: 0.3 }]}>
            <View style={[styles.profileImage, { backgroundColor: theme === 'light' ? '#e5e7eb' : '#5c5c5c' }]} />
          </View>
          <View style={styles.infoBlock}>
            <View style={[styles.skeletonLine, { width: '80%', height: 20, marginBottom: 8, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242' }]} />
            <View style={[styles.skeletonLine, { width: '50%', height: 14, backgroundColor: theme === 'light' ? '#f3f4f6' : '#404040' }]} />
          </View>
        </View>
        <View style={styles.cardFooter}>
          <View style={[styles.deptBadge, { width: 80, height: 24, backgroundColor: theme === 'light' ? '#f3f4f6' : '#2f2f2f' }]} />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backText, { color: Colors.powerOrange }]}>{'<'} BACK</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.title, { color: colors.text }]}>Employee Directory</Text>
        </View>
        <Pressable
          onPress={handleManualRefresh}
          disabled={isRefreshing}
          style={[
            styles.refreshButton,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity: isRefreshing ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.refreshButtonText}>{isRefreshing ? 'SYNCING...' : 'REFRESH'}</Text>
        </Pressable>
      </View>

      <View style={styles.stickyContainer}>
        <View style={[
          styles.searchContainer, 
          { 
            backgroundColor: colors.surface, 
            borderColor: isSearchFocused ? Colors.powerOrange : colors.border 
          }
        ]}>
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search by name or role..."
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')} style={styles.clearButton}>
              <Text style={{ color: Colors.steelGray, fontSize: 20, fontWeight: '800' }}>✕</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.filterBar}>
          <DropdownSelector 
            label="All Departments" 
            value={selectedDept} 
            options={departments} 
            isOpen={showDeptDropdown} 
            onToggle={() => {
              setShowDeptDropdown(!showDeptDropdown);
              setShowRoleDropdown(false);
            }} 
            onSelect={setSelectedDept}
          />
          <DropdownSelector 
            label="All Roles" 
            value={selectedRole} 
            options={roles} 
            isOpen={showRoleDropdown} 
            onToggle={() => {
              setShowRoleDropdown(!showRoleDropdown);
              setShowDeptDropdown(false);
            }} 
            onSelect={setSelectedRole}
          />
          <Pressable 
            onPress={() => setSortBy(sortBy === 'name_asc' ? 'name_desc' : 'name_asc')}
            style={[styles.sortToggle, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={{ color: colors.textSecondary, fontWeight: '900', fontSize: 13 }}>
              {sortBy === 'name_asc' ? 'A-Z' : 'Z-A'}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.cacheStatusText, { color: colors.textSecondary }]}>
          {lastUpdatedAt
            ? `Last Sync: ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'Last Sync: Not yet synced'}
        </Text>
      </View>

      {(isRefreshing || (isLoading && employees.length === 0)) ? (
        <ScrollView contentContainerStyle={styles.list} scrollEnabled={false}>
          <View style={styles.gridContainer}>
            {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list} scrollEnabled={!showDeptDropdown && !showRoleDropdown}>
          <View style={styles.gridContainer}>
            {sortedAndFilteredEmployees.map((emp) => (
              <View 
                key={emp.emp_id} 
                style={[styles.employeeCard, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.accentStrip} />
                <View style={styles.cardContent}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.avatarRing, { borderColor: Colors.powerOrange }]}>
                      {(() => {
                        const acc = normalizeAccount(emp.accounts);
                        return acc?.profile_picture ? (
                          <Image 
                            source={{ uri: acc.profile_picture }} 
                            style={styles.profileImage}
                          />
                        ) : (
                          <View style={[styles.profileImage, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={{ color: colors.textSecondary, fontWeight: '800', fontSize: 24 }}>{emp.name.charAt(0)}</Text>
                          </View>
                        );
                      })()}
                    </View>
                    <View style={styles.infoBlock}>
                      <Text style={[styles.employeeName, { color: colors.text }]} numberOfLines={1}>{emp.name}</Text>
                      <Text style={[styles.employeeRole, { color: Colors.steelGray }]} numberOfLines={1}>{emp.role ?? 'Unassigned Role'}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.cardFooter}>
                    <View style={[styles.deptBadge, { backgroundColor: theme === 'light' ? '#f3f4f6' : '#322721' }]}>
                      <Text style={[styles.deptText, { color: colors.textSecondary }]}>
                        {emp.departments?.name ?? 'General'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
          
          {hasMore && !searchText && selectedDept === 'All Departments' && selectedRole === 'All Roles' && (
            <Pressable 
              onPress={handleLoadMore} 
              disabled={isLoadingMore}
              style={[styles.loadMoreButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              {isLoadingMore ? (
                <ActivityIndicator color={Colors.powerOrange} />
              ) : (
                <Text style={[styles.loadMoreText, { color: Colors.powerOrange }]}>LOAD MORE EMPLOYEES</Text>
              )}
            </Pressable>
          )}

          {sortedAndFilteredEmployees.length === 0 && !isBootstrapping && !isLoading && (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No matching employees found.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 32,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 20,
  },
  headerTitleWrap: {
    flex: 1,
  },
  backText: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  refreshButton: {
    minWidth: 108,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  refreshButtonText: {
    color: Colors.powerOrange,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  stickyContainer: {
    paddingHorizontal: 32,
    paddingBottom: 20,
    zIndex: 100,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 70,
    borderRadius: 20,
    borderWidth: 2,
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
  },
  clearButton: {
    padding: 10,
  },
  filterBar: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  cacheStatusText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
  },
  dropdownContainer: {
    flex: 1,
    position: 'relative',
  },
  dropdownButton: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    justifyContent: 'space-between',
  },
  dropdownValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 5,
  },
  dropdownList: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
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
  sortToggle: {
    width: 60,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  skeletonLine: {
    borderRadius: 4,
  },
  shimmerStreak: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: 'rgba(61, 61, 61, 0.15)',
    zIndex: 10,
    transform: [{ skewX: '-25deg' }],
  },
  list: {
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  gridContainer: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 20,
  },
  emptyContainer: {
    paddingTop: 100,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
  },
  employeeCard: {
    minHeight: 140,
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  accentStrip: {
    width: 8,
    backgroundColor: Colors.powerOrange,
  },
  cardContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2.5,
    padding: 3,
    marginRight: 15,
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
  },
  infoBlock: {
    flex: 1,
  },
  employeeName: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  employeeRole: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardFooter: {
    marginTop: 15,
    alignItems: 'flex-start',
  },
  deptBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  deptText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadMoreButton: {
    width: '100%',
    height: 60,
    borderRadius: 15,
    borderWidth: 1.5,
    marginTop: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
