# Attendance Table & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bulky card list in Management Dashboard with a clean Table view, add a floating Action Hub (search, time filter), and export to CSV.

**Architecture:** Modifies `OfflineSync.tsx` to include new states (`searchQuery`, `timeFilter`, `isActionHubOpen`). Uses `expo-file-system` and `expo-sharing` to handle CSV generation and device export.

**Tech Stack:** React Native, Expo, TypeScript

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install expo-sharing**

Run: `npx expo install expo-sharing`
Expected: Installs `expo-sharing` successfully.

---

### Task 2: Update OfflineSync.tsx UI and Logic

**Files:**
- Modify: `src/screens/OfflineSync.tsx`

- [ ] **Step 1: Add state variables and imports**

In `OfflineSync.tsx`, import `* as FileSystem from 'expo-file-system'` and `* as Sharing from 'expo-sharing'`. 
Add state variables:
```tsx
const [searchQuery, setSearchQuery] = useState('');
const [timeFilter, setTimeFilter] = useState('ALL'); // 'ALL', 'AM', 'PM'
const [isActionHubOpen, setIsActionHubOpen] = useState(false);
```

- [ ] **Step 2: Add CSV Export Function**

Add this function inside the component:
```tsx
const exportToCSV = async (dataToExport: any[]) => {
  try {
    const headerString = 'ID,Name,Time In,Time Out\n';
    const rowString = dataToExport.map(item => {
      const displayName = item.name?.trim() || item.username;
      const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
      const timeoutVal = item.timeout || (item.action === 'clock_out' ? item.time : null);
      return `"${item.username}","${displayName}","${formatTimeDisplay(timeinVal)}","${formatTimeDisplay(timeoutVal)}"`;
    }).join('\n');
    
    const csvString = `${headerString}${rowString}`;
    
    const fileUri = `${FileSystem.documentDirectory}Attendance_Today.csv`;
    await FileSystem.writeAsStringAsync(fileUri, csvString, { encoding: FileSystem.EncodingType.UTF8 });
    
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(fileUri);
    } else {
      alert('Sharing is not available on this device');
    }
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export data');
  }
};
```

- [ ] **Step 3: Add Filter Logic**

Above the `return` statement:
```tsx
const filteredHistory = history.filter(item => {
  const displayName = item.name?.trim() || item.username;
  const matchesSearch = displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        item.username.toLowerCase().includes(searchQuery.toLowerCase());
  
  if (!matchesSearch) return false;

  const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
  if (timeFilter === 'ALL') return true;
  
  const displayTime = formatTimeDisplay(timeinVal);
  if (timeFilter === 'AM' && displayTime.includes('am')) return true;
  if (timeFilter === 'PM' && displayTime.includes('pm')) return true;
  if (displayTime === '-' || !displayTime) return true; // Include items without time in filtered view if they match search
  
  return false;
});
```

- [ ] **Step 4: Update UI Header for Action Hub**

Replace the current `historySubHeader` with the Action Hub button and the popover:
```tsx
<View style={[styles.historySubHeader, { zIndex: 50 }]}>
  <Text style={[styles.historyCount, { color: colors.textSecondary }]}>{filteredHistory.length} RECORDS</Text>
  <View style={{position: 'relative'}}>
    <Pressable 
      onPress={() => setIsActionHubOpen(!isActionHubOpen)}
      style={{
        width: 36, height: 36, borderRadius: 18, 
        backgroundColor: withAlpha(colors.accent, 0.1),
        alignItems: 'center', justifyContent: 'center'
      }}
    >
      <MaterialCommunityIcons name="dots-horizontal" size={24} color={colors.accent} />
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
            style={{flex: 1, marginLeft: 8, color: colors.text, fontSize: 13}}
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
              <Text style={{fontSize: 11, fontWeight: '800', color: timeFilter === f ? '#fff' : colors.text}}>{f}</Text>
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
          <Text style={{color: '#fff', fontWeight: '900', fontSize: 13}}>EXPORT CSV</Text>
        </Pressable>
      </View>
    )}
  </View>
</View>
```

- [ ] **Step 5: Replace Cards with Table View**

In the ScrollView for history, map over `filteredHistory` instead of `history`. 
Change the map return to be a sleek table row:
```tsx
{filteredHistory.length > 0 ? (
  <View style={{backgroundColor: theme === 'light' ? '#fff' : colors.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border}}>
    <View style={{flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: withAlpha(colors.border, 0.3), borderBottomWidth: 1, borderBottomColor: colors.border}}>
      <Text style={{flex: 1.5, fontSize: 11, fontWeight: '900', color: colors.textSecondary}}>ID & NAME</Text>
      <Text style={{flex: 1, fontSize: 11, fontWeight: '900', color: colors.textSecondary, textAlign: 'center'}}>TIME IN</Text>
      <Text style={{flex: 1, fontSize: 11, fontWeight: '900', color: colors.textSecondary, textAlign: 'center'}}>TIME OUT</Text>
    </View>
    {filteredHistory.map((item, index) => {
      const displayName = item.name?.trim() || item.username;
      const timeinVal = item.timein || (item.action === 'clock_in' ? item.time : null);
      const timeoutVal = item.timeout || (item.action === 'clock_out' ? item.time : null);
      const isEven = index % 2 === 0;

      return (
        <View key={item.id} style={{flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: isEven ? 'transparent' : withAlpha(colors.border, 0.1), borderBottomWidth: index === filteredHistory.length - 1 ? 0 : 1, borderBottomColor: withAlpha(colors.border, 0.4), alignItems: 'center'}}>
          <View style={{flex: 1.5}}>
            <Text style={{fontSize: 13, fontWeight: '800', color: colors.text}} numberOfLines={1}>{displayName}</Text>
            <Text style={{fontSize: 11, color: colors.textSecondary}} numberOfLines={1}>@{item.username}</Text>
          </View>
          <Text style={{flex: 1, fontSize: 12, fontWeight: '700', color: '#22c55e', textAlign: 'center'}}>
            {timeinVal ? formatTimeDisplay(timeinVal) : '--:--'}
          </Text>
          <Text style={{flex: 1, fontSize: 12, fontWeight: '700', color: '#ef4444', textAlign: 'center'}}>
            {timeoutVal ? formatTimeDisplay(timeoutVal) : '--:--'}
          </Text>
        </View>
      );
    })}
  </View>
) : (
  <View style={styles.emptyState}>
    <MaterialCommunityIcons name="table-off" size={48} color={colors.border} />
    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No Matching Records</Text>
  </View>
)}
```

- [ ] **Step 6: Import TextInput if missing**
Ensure `TextInput` is imported from `react-native`.

---
