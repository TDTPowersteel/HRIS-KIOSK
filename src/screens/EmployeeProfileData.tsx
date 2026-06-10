import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import EmployeeDetailsModal from './settings/components/EmployeeDetailsModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { updateOfflineUserCacheFromEmployees, getOfflineUserCache, clearOfflineUserCache, mmkv } from '../utils/offlineUsers';
import { useTheme, Colors } from '../config/theme';

const DIRECTORY_POLL_INTERVAL_MS = 30000; // Increased to 30s to reduce background load
const LAST_SYNC_KEY = 'employee_directory_last_sync';

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

function enrichEmployeesWithCache(data: EmployeeRow[]): EmployeeRow[] {
  const normalizeAccount = (val: Account | Account[] | null | undefined): Account | null => {
    if (Array.isArray(val)) return val[0] ?? null;
    return val ?? null;
  };
  return data.map(emp => {
    if (!emp) return emp;
    const empId = emp.emp_id;
    if (empId) {
      const cachedRaw = mmkv.getString(`user_by_emp_id:${empId}`) || mmkv.getString(`user_by_id:${emp.log_id || normalizeAccount(emp.accounts)?.log_id}`);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          if (cached.profile_picture?.startsWith('file://')) {
            const acc = normalizeAccount(emp.accounts);
            const isArr = Array.isArray(emp.accounts);
            const enrichedAcc = {
              log_id: emp.log_id || acc?.log_id || parseInt(cached.userId) || 0,
              username: acc?.username ?? cached.username ?? null,
              qr_code: acc?.qr_code ?? cached.qrCode ?? null,
              profile_picture: cached.profile_picture
            };
            return {
              ...emp,
              accounts: isArr ? [enrichedAcc] : enrichedAcc
            };
          }
        } catch {}
      }
    }
    return emp;
  });
}

export default function EmployeeProfileData({ onBack }: Props) {
  const normalizeAccount = (val: Account | Account[] | null | undefined): Account | null => {
    if (Array.isArray(val)) return val[0] ?? null;
    return val ?? null;
  };

  const [employees, setEmployees] = useState<EmployeeRow[]>(globalEmployeesCache);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const ITEMS_PER_PAGE = 50;
  
  const setUniqueEmployees = useCallback((data: EmployeeRow[], append: boolean = false) => {
    const seen = new Set<number>();
    
    let sourceData: EmployeeRow[] = [];
    if (append) {
      sourceData = [...employeesRef.current, ...data];
    } else {
      const existingMap = new Map<number, EmployeeRow>();
      employeesRef.current.forEach(emp => {
        if (emp && emp.emp_id != null) existingMap.set(Number(emp.emp_id), emp);
      });
      data.forEach(emp => {
        if (emp && emp.emp_id != null) existingMap.set(Number(emp.emp_id), emp);
      });
      sourceData = Array.from(existingMap.values());
    }

    const unique = sourceData.filter(emp => {
      if (!emp || emp.emp_id == null) return false;
      const id = Number(emp.emp_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    setEmployees(unique);
    globalEmployeesCache = unique;
    
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
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [kioskMode, setKioskMode] = useState<'employee' | 'intern'>(() => {
    return (mmkv.getString('kiosk_mode') as 'employee' | 'intern') || 'employee';
  });
  const localMatchCount = useMemo(() => {
    if (!searchText) return 0;
    return employees.filter(emp => {
      if (!emp) return false;
      const acc = normalizeAccount(emp.accounts ?? null);
      return emp.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (emp.role && emp.role.toLowerCase().includes(searchText.toLowerCase())) ||
        (acc?.username && acc.username.toLowerCase().includes(searchText.toLowerCase()));
    }).length;
  }, [employees, searchText]);
  const { colors, theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const shortDimension = Math.min(windowWidth, windowHeight);
  const isTablet = shortDimension >= 768;
  const isSmallTablet = shortDimension >= 480 && shortDimension < 768;
  const isPhone = shortDimension < 480;

  const titleFontSize = isTablet ? 24 : isSmallTablet ? 20 : 18;
  const subtitleFontSize = isTablet ? 14 : isSmallTablet ? 12 : 10;
  const refreshButtonTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const searchInputFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
  const cacheStatusTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const dropdownValueFontSize = isTablet ? 14 : isSmallTablet ? 12 : 11;
  const optionTextFontSize = isTablet ? 14 : isSmallTablet ? 12 : 11;
  const dropdownArrowFontSize = isTablet ? 12 : isSmallTablet ? 11 : 10;
  const emptyTextFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
  const employeeNameFontSize = isTablet ? 20 : isSmallTablet ? 17 : 14;
  const employeeRoleFontSize = isTablet ? 14 : isSmallTablet ? 12 : 10;
  const deptTextFontSize = isTablet ? 12 : isSmallTablet ? 11 : 9;
  const loadMoreTextFontSize = isTablet ? 14 : isSmallTablet ? 12 : 11;
  const notSyncedTextFontSize = isTablet ? 20 : isSmallTablet ? 17 : 15;
  const notSyncedSubtextFontSize = isTablet ? 14 : isSmallTablet ? 12 : 11;
  const syncNowButtonTextFontSize = isTablet ? 16 : isSmallTablet ? 14 : 12;
  const avatarPlaceholderTextFontSize = isTablet ? 24 : isSmallTablet ? 20 : 16;
  const sortToggleTextFontSize = isTablet ? 13 : isSmallTablet ? 12 : 11;
  const deleteIconFontSize = isTablet ? 18 : isSmallTablet ? 16 : 14;
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const isBackgroundSyncingRef = useRef(false);

  // Animation for sliding shimmer
  const shimmerTranslate = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (isRefreshing || isLoading) {
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
  }, [isRefreshing, isLoading, shimmerTranslate]);

  const updateLastSync = useCallback(async (timestamp: number) => {
    setLastUpdatedAt(timestamp);
    globalLastSyncCache = timestamp;
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(timestamp));
  }, []);

  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  const handleProfileCached = useCallback((userId: string, localUri: string) => {
    if (!mountedRef.current) return;
    setEmployees(prev => {
      const updated = prev.map(emp => {
        const acc = Array.isArray(emp.accounts) ? emp.accounts[0] : emp.accounts;
        const logId = emp.log_id || acc?.log_id;
        if ((logId && String(logId) === String(userId)) || (emp.emp_id && String(emp.emp_id) === String(userId))) {
          const isArr = Array.isArray(emp.accounts);
          const enrichedAcc: Account = {
            ...(acc ?? {}),
            log_id: logId || parseInt(userId) || 0,
            username: acc?.username ?? null,
            profile_picture: localUri
          };
          return {
            ...emp,
            accounts: isArr ? [enrichedAcc] : enrichedAcc
          };
        }
        return emp;
      });
      globalEmployeesCache = updated;
      return updated;
    });
  }, []);

  const syncRemainingEmployeesInBackground = useCallback(async () => {
    if (isBackgroundSyncingRef.current) return;
    isBackgroundSyncingRef.current = true;
    try {
      let page = 1;
      let keepFetching = true;
      while (keepFetching && mountedRef.current) {
        const url = `${BACKEND_URL}/employees.php?page=${page}&limit=${ITEMS_PER_PAGE}`;
        console.log('[BackgroundSync] Fetching URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
          keepFetching = false;
          break;
        }
        const text = await response.text();
        const payload = JSON.parse(text);
        if (payload?.ok && Array.isArray(payload?.data)) {
          if (payload.kiosk_mode) {
            mmkv.set('kiosk_mode', payload.kiosk_mode);
            if (kioskMode !== payload.kiosk_mode) {
              setKioskMode(payload.kiosk_mode);
            }
          }
          const rows = payload.data as EmployeeRow[];
          if (rows.length === 0) {
            keepFetching = false;
            break;
          }
          const enriched = enrichEmployeesWithCache(rows);
          await updateOfflineUserCacheFromEmployees(rows, false, handleProfileCached);
          if (!mountedRef.current) break;
          setUniqueEmployees(enriched, true);
          setCurrentPage(page);
          if (rows.length < ITEMS_PER_PAGE) {
            keepFetching = false;
          } else {
            page++;
          }
        } else {
          keepFetching = false;
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.log('[BackgroundSync] error:', err);
    } finally {
      isBackgroundSyncingRef.current = false;
    }
  }, [setUniqueEmployees, handleProfileCached, kioskMode, setKioskMode]);

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

    const url = `${BACKEND_URL}/employees.php?page=${page}&limit=${ITEMS_PER_PAGE}`;
    console.log('[fetchEmployees] Fetching URL:', url);
    try {
      const response = await fetch(url);
      console.log('[fetchEmployees] Response Status:', response.status);
      const responseText = await response.text();
      console.log('[fetchEmployees] Raw Response (first 500 chars):', responseText.slice(0, 500));

      let payload: any;
      try {
        payload = JSON.parse(responseText);
      } catch (parseErr) {
        console.log('[fetchEmployees] JSON Parse Error:', parseErr);
        throw new Error('Invalid JSON response');
      }

      if (!payload?.ok || !Array.isArray(payload?.data)) {
        console.log('[fetchEmployees] Payload validation failed:', payload);
        throw new Error('Unable to sync employee directory');
      }

      if (payload.kiosk_mode) {
        mmkv.set('kiosk_mode', payload.kiosk_mode);
        if (kioskMode !== payload.kiosk_mode) {
          setKioskMode(payload.kiosk_mode);
        }
      }

      let rows = payload.data as EmployeeRow[];
      
      if (isInitial) {
        await updateOfflineUserCacheFromEmployees(rows, false, handleProfileCached);
      }

      rows = enrichEmployeesWithCache(rows);
      
      const now = Date.now();
      if (!mountedRef.current) return;
      
      setUniqueEmployees(rows, !isInitial);
      if (isInitial) {
        await updateLastSync(now);
        setCurrentPage(0);
        setTimeout(() => {
          syncRemainingEmployeesInBackground();
        }, 500);
      } else {
        setCurrentPage(page);
      }
    } catch (error) {
      console.log('[fetchEmployees] fetchEmployees error:', error);
    } finally {
      isFetchingRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [setUniqueEmployees, updateLastSync, handleProfileCached, syncRemainingEmployeesInBackground]);

  const departments = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach(emp => {
      if (!emp) return;
      const deptName = emp?.departments?.name;
      if (deptName) depts.add(deptName);
    });
    return ['All Departments', ...Array.from(depts).sort()];
  }, [employees]);

  const roles = useMemo(() => {
    const rls = new Set<string>();
    employees.forEach(emp => {
      if (!emp) return;
      const matchesDept = selectedDept === 'All Departments' || emp.departments?.name === selectedDept;
      if (matchesDept && emp?.role) rls.add(emp.role);
    });
    return ['All Roles', ...Array.from(rls).sort()];
  }, [employees, selectedDept]);

  useEffect(() => {
    if (!searchText) {
      setHasMore(true);
    }
  }, [searchText]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!debouncedSearchText) return;
    
    let isCurrent = true;
    const fetchSearchResults = async () => {
      setIsLoading(true);
      const url = `${BACKEND_URL}/employees.php?search=${encodeURIComponent(debouncedSearchText)}&limit=100`;
      console.log('[fetchSearchResults] Fetching URL:', url);
      try {
        const response = await fetch(url);
        console.log('[fetchSearchResults] Response Status:', response.status);
        const responseText = await response.text();
        console.log('[fetchSearchResults] Raw Response (first 500 chars):', responseText.slice(0, 500));

        let payload: any;
        try {
          payload = JSON.parse(responseText);
        } catch (parseErr) {
          console.log('[fetchSearchResults] JSON Parse Error:', parseErr);
          throw new Error('Invalid JSON response');
        }

        if (payload?.ok && Array.isArray(payload?.data) && isCurrent) {
          if (payload.kiosk_mode) {
            mmkv.set('kiosk_mode', payload.kiosk_mode);
            if (kioskMode !== payload.kiosk_mode) {
              setKioskMode(payload.kiosk_mode);
            }
          }
          let rows = payload.data as EmployeeRow[];
          rows = enrichEmployeesWithCache(rows);
          setUniqueEmployees(rows, false);
        }
      } catch (err) {
        console.log('[fetchSearchResults] Search fetch error:', err);
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };
    fetchSearchResults();
    return () => {
      isCurrent = false;
    };
  }, [debouncedSearchText, setUniqueEmployees]);

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
          const mapped: EmployeeRow[] = cached
            .filter(u => u !== null && typeof u === 'object')
            .map(u => ({
              emp_id: parseInt(u.empId) || 0,
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
      const acc = normalizeAccount(emp.accounts ?? null);
      const matchesSearch = emp.name.toLowerCase().includes(debouncedSearchText.toLowerCase()) ||
        (emp.role && emp.role.toLowerCase().includes(debouncedSearchText.toLowerCase())) ||
        (acc?.username && acc.username.toLowerCase().includes(debouncedSearchText.toLowerCase()));
      
      const matchesDept = selectedDept === 'All Departments' || emp.departments?.name === selectedDept;
      const matchesRole = selectedRole === 'All Roles' || emp.role === selectedRole;

      return matchesSearch && matchesDept && matchesRole;
    });

    if (sortBy === 'name_asc') {
      result.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });
    } else if (sortBy === 'name_desc') {
      result.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        if (nameA > nameB) return -1;
        if (nameA < nameB) return 1;
        return 0;
      });
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
        <Text style={[styles.dropdownValue, { color: colors.text, fontSize: dropdownValueFontSize }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={{ color: Colors.powerOrange, fontSize: dropdownArrowFontSize }}>{isOpen ? '▲' : '▼'}</Text>
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
                <Text style={[styles.optionText, { color: colors.text, fontSize: optionTextFontSize }]}>{opt}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const cardWidth = useMemo(() => {
    const horizontalPadding = 48; // 24 horizontal padding on each side
    const availableWidth = windowWidth - horizontalPadding;
    const gap = 20;
    let cols = 1;
    if (windowWidth >= 1200) cols = 4;
    else if (windowWidth >= 900) cols = 3;
    else if (windowWidth >= 600) cols = 2;
    
    return Math.max(availableWidth - (gap * (cols - 1)), 0) / cols;
  }, [windowWidth]);

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

  const SkeletonCard = () => (
    <View style={[styles.employeeCard, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border, overflow: 'hidden' }]}>
      <View style={[styles.accentStrip, { backgroundColor: colors.border, opacity: 0.2 }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatarRing, { borderColor: colors.border, opacity: 0.3 }]}>
            <View style={[styles.profileImage, { backgroundColor: theme === 'light' ? '#e5e7eb' : '#5c5c5c', overflow: 'hidden', position: 'relative' }]}>
              <Animated.View style={getShimmerStyle(50)} />
            </View>
          </View>
          <View style={styles.infoBlock}>
            <View style={[styles.skeletonLine, { width: '80%', height: 20, marginBottom: 8, backgroundColor: theme === 'light' ? '#e5e7eb' : '#424242', overflow: 'hidden', position: 'relative' }]}>
              <Animated.View style={getShimmerStyle(200)} />
            </View>
            <View style={[styles.skeletonLine, { width: '50%', height: 14, backgroundColor: theme === 'light' ? '#f3f4f6' : '#404040', overflow: 'hidden', position: 'relative' }]}>
              <Animated.View style={getShimmerStyle(120)} />
            </View>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <View style={[styles.deptBadge, { width: 80, height: 24, backgroundColor: theme === 'light' ? '#f3f4f6' : '#2f2f2f', overflow: 'hidden', position: 'relative' }]}>
            <Animated.View style={getShimmerStyle(80)} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
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
          <Text style={[styles.title, { color: colors.text, fontSize: titleFontSize }]}>
            {kioskMode === 'intern' ? 'Intern List' : 'Employee Directory'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary, fontSize: subtitleFontSize }]}>
            {kioskMode === 'intern' ? 'Intern information and records.' : 'Employee information and records.'}
          </Text>
        </View>
        <Pressable
          onPress={handleManualRefresh}
          disabled={isRefreshing}
          style={[
            styles.refreshButton,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity: isRefreshing ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.refreshButtonText, { fontSize: refreshButtonTextFontSize }]}>{isRefreshing ? 'SYNCING...' : 'REFRESH'}</Text>
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
            style={[styles.searchInput, { color: colors.text, fontSize: searchInputFontSize }]}
            placeholder={kioskMode === 'intern' ? 'Search by intern name...' : 'Search by name or role...'}
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')} style={styles.clearButton}>
              <Text style={{ color: Colors.steelGray, fontSize: deleteIconFontSize, fontWeight: '800' }}>✕</Text>
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
            <Text style={{ color: colors.textSecondary, fontWeight: '900', fontSize: sortToggleTextFontSize }}>
              {sortBy === 'name_asc' ? 'A-Z' : 'Z-A'}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.cacheStatusText, { color: colors.textSecondary, fontSize: cacheStatusTextFontSize }]}>
          {lastUpdatedAt
            ? `Last Sync: ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'})}`
            : 'Last Sync: Not yet synced'}
        </Text>
      </View>

      <EmployeeDetailsModal 
        visible={!!selectedEmployee} 
        onClose={() => setSelectedEmployee(null)} 
        employee={selectedEmployee} 
      />

      {(isRefreshing || (isLoading && (employees.length === 0 || searchText.trim().length > 0))) ? (
        <ScrollView contentContainerStyle={styles.list} scrollEnabled={false}>
          <View style={styles.gridContainer}>
            {Array.from({ length: searchText ? (localMatchCount > 0 ? localMatchCount : 3) : 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list} scrollEnabled={!showDeptDropdown && !showRoleDropdown}>
          <View style={styles.gridContainer}>
            {sortedAndFilteredEmployees.map((emp) => (
              <Pressable 
                key={emp.emp_id} 
                onPress={() => setSelectedEmployee(emp)}
                style={[styles.employeeCard, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.accentStrip} />
                <View style={styles.cardContent}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.avatarRing, { borderColor: Colors.powerOrange }]}>
                      {(() => {
                        if (!emp) return null;
                        const acc = normalizeAccount(emp.accounts ?? null);
                        return acc?.profile_picture ? (
                          <Image 
                            source={{ uri: acc.profile_picture }} 
                            style={styles.profileImage}
                          />
                        ) : (
                          <View style={[styles.profileImage, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={{ color: colors.textSecondary, fontWeight: '800', fontSize: avatarPlaceholderTextFontSize }}>{emp.name?.charAt(0) || '?'}</Text>
                          </View>
                        );
                      })()}
                    </View>
                    <View style={styles.infoBlock}>
                      <Text style={[styles.employeeName, { color: colors.text, fontSize: employeeNameFontSize }]} numberOfLines={1}>{emp?.name || 'Unknown'}</Text>
                      <Text style={[styles.employeeRole, { color: Colors.steelGray, fontSize: employeeRoleFontSize }]} numberOfLines={1}>{emp?.role ?? 'Unassigned Role'}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.cardFooter}>
                    <View style={[styles.deptBadge, { backgroundColor: theme === 'light' ? '#f3f4f6' : '#322721' }]}>
                      <Text style={[styles.deptText, { color: colors.textSecondary, fontSize: deptTextFontSize }]}>
                        {emp.departments?.name ?? 'General'}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
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
                <Text style={[styles.loadMoreText, { color: Colors.powerOrange, fontSize: loadMoreTextFontSize }]}>
                  {kioskMode === 'intern' ? 'LOAD MORE INTERNS' : 'LOAD MORE EMPLOYEES'}
                </Text>
              )}
            </Pressable>
          )}

          {sortedAndFilteredEmployees.length === 0 && !isBootstrapping && !isLoading && (
            !lastUpdatedAt ? (
              <View style={styles.notSyncedContainer}>
                <MaterialCommunityIcons name="database-sync" size={80} color={colors.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={[styles.notSyncedText, { color: colors.text, fontSize: notSyncedTextFontSize }]}>Directory Not Synced Yet</Text>
                <Text style={[styles.notSyncedSubtext, { color: colors.textSecondary, fontSize: notSyncedSubtextFontSize }]}>
                  {kioskMode === 'intern' ? 'You need to sync to load intern records.' : 'You need to sync to load employee records.'}
                </Text>
                <Pressable
                  onPress={handleManualRefresh}
                  style={({ pressed }) => [
                    styles.syncNowButton,
                    {
                      backgroundColor: colors.accent,
                      opacity: pressed ? 0.85 : 1,
                    }
                  ]}
                >
                  <Text style={[styles.syncNowButtonText, { fontSize: syncNowButtonTextFontSize }]}>SYNC NOW</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="account-search-outline" size={80} color={colors.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: emptyTextFontSize }]}>No result found in searching</Text>
              </View>
            )
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
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 1,
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
    paddingHorizontal: 24,
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
  list: {
    paddingHorizontal: 24,
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
  notSyncedContainer: {
    flex: 1,
    paddingTop: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  notSyncedText: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  notSyncedSubtext: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  syncNowButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: Colors.powerOrange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  syncNowButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
