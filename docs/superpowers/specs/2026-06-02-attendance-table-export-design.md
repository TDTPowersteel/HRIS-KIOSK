# Management Dashboard: Attendance Table & Export Design

## Goal
Transform the "Today's History" view in the Management Dashboard (`OfflineSync.tsx`) from a bulky card list into a professional, scannable data table. Add functionality to filter records by time/name and export the data to CSV for HR use (Excel compatible), keeping the UI minimalist via an expanding toolbar popup.

## Architecture & Data
1. **Data Source**: Re-uses the existing `history` state populated from `attendance_today.php`.
2. **Table Format**: Each row represents an employee's daily attendance. 
   - **Columns**: `ID` (Username), `Name`, `Time In`, `Time Out`.
3. **Export Engine**: A utility function will map the filtered history array into a CSV string. Because this is a mobile app (React Native), it will use `expo-file-system` and `expo-sharing` to generate the file and prompt the user to save/share it to their device.

## UI Components
1. **The Table View**:
   - Sticky header row with bold column titles.
   - Clean rows (zebra striping for readability) replacing the bulky avatar cards in the history panel.

2. **The "Action Hub" Popup**:
   - To maintain a clean UI, a single right-aligned circular icon button (e.g., "dots-vertical" or "filter-variant") will sit next to the "Today's History" title.
   - **On Click**: Opens a sleek modal or expanding drawer containing:
     - **Search Bar**: Text input to filter by Name or ID.
     - **Time Filter**: Dropdown or buttons to filter by specific hours (e.g., "8 AM - 9 AM").
     - **Export Button**: Prominent green button to "Export to Excel/CSV".

## Data Flow
- `history` (raw data) -> `filteredHistory` (derived state based on search/time filters).
- The Table renders `filteredHistory`.
- The Export function converts `filteredHistory` into a CSV file, so it only exports exactly what the user is currently looking at.

## Error Handling
- If history is empty, display the standard "No History Yet" empty state.
- If export fails (e.g., due to storage permissions), display a friendly error alert.
