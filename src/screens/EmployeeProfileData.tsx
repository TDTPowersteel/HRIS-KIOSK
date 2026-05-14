import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { refreshOfflineUserCache } from '../utils/offlineUsers';
import { useTheme, Colors } from '../config/theme';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

type SortOption = 'name_asc' | 'name_desc';

type Props = {
  onBack: () => void;
};

export default function EmployeeProfileData({ onBack }: Props) {
  type EmployeeRow = {
    emp_id: number;
    name: string;
    role: string | null;
    dept_id: number | null;
    log_id: number | null;
    accounts?: {
      log_id: number;
      username: string | null;
      qr_code?: string | null;
      profile_picture?: string | null;
    } | null;
    departments?: {
      name?: string | null;
    } | null;
  };

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('name_asc');
  const [selectedDept, setSelectedDept] = useState<string>('All Departments');
  const [selectedRole, setSelectedRole] = useState<string>('All Roles');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const { colors, theme } = useTheme();

  const departments = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach(emp => {
      if (emp.departments?.name) depts.add(emp.departments.name);
    });
    return ['All Departments', ...Array.from(depts).sort()];
  }, [employees]);

  const roles = useMemo(() => {
    const rls = new Set<string>();
    employees.forEach(emp => {
      if (emp.role) rls.add(emp.role);
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
    const fetchEmployees = async () => {
      let responseText = '';
      try {
        setIsLoading(true);
        const response = await fetch(`${BACKEND_URL}/employees.php`);
        responseText = await response.text();
        
        try {
          const payload = JSON.parse(responseText);
          if (payload?.ok && Array.isArray(payload?.data)) {
            setEmployees(payload.data);
            setTimeout(() => {
              refreshOfflineUserCache().catch(() => undefined);
            }, 100);
          }
        } catch (parseError) {
          console.log('employees.php JSON parse error:', parseError);
          // Truncate long base64 data in the log to keep it readable
          const sanitizedResponse = responseText.replace(/"(face|profile_picture|image)":"[^"]{100,}"/g, '"$1":"[face_data]"');
          console.log('Raw response that failed to parse:', sanitizedResponse);
        }
      } catch (error) {
        console.log('employees.php fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmployees();
  }, []);

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backText, { color: Colors.powerOrange }]}>{'<'} BACK</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Employee Directory</Text>
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
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.powerOrange} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Syncing Directory...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} scrollEnabled={!showDeptDropdown && !showRoleDropdown}>
          <View style={styles.gridContainer}>
            {sortedAndFilteredEmployees.map((emp) => (
              <View 
                key={emp.emp_id} 
                style={[styles.employeeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.accentStrip} />
                <View style={styles.cardContent}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.avatarRing, { borderColor: Colors.powerOrange }]}>
                      {emp.accounts?.profile_picture ? (
                        <Image 
                          source={{ uri: emp.accounts.profile_picture }} 
                          style={styles.profileImage}
                        />
                      ) : (
                        <View style={[styles.profileImage, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                          <Text style={{ color: colors.textSecondary, fontWeight: '800', fontSize: 24 }}>{emp.name.charAt(0)}</Text>
                        </View>
                      )}
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
          {sortedAndFilteredEmployees.length === 0 && (
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
  backText: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
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
  list: {
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'flex-start',
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
    width: (WINDOW_WIDTH - 84) / 2,
    maxWidth: WINDOW_WIDTH > 1000 ? 400 : 450,
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
});
