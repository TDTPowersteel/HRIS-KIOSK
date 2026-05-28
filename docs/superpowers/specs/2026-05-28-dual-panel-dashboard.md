# Spec: Dual-Panel Kiosk Dashboard (History + Sync)

## Background
The HRIS-KIOSK requires a robust way for admins to verify attendance status and manage offline records. This spec defines a responsive dashboard that combines real-time server history with local offline sync management.

## Architecture: The Split Dashboard
To optimize for Tablet and Mobile devices, the dashboard uses a responsive grid:

- **Tablet Layout:** Side-by-side (60/40 Split).
    - **Left (60%):** "Live History" - Records already on the server.
    - **Right (40%):** "Sync Queue" - Records waiting to be synced.
- **Mobile Layout:** Stacked.
    - **Top:** "Sync Queue" (Priority for attention).
    - **Bottom:** "Live History".

## UI Components (Art Major Refinement)

### 1. History Panel (Success Feed)
- **Style:** Clean, solid surface cards.
- **Badge System:** High-contrast pill badges (Green: "CLOCK IN", Blue: "CLOCK OUT").
- **Content:** Employee name, ID, exact timestamp, and profile photo/initials.
- **Interaction:** Pull-to-refresh to fetch latest server data.

### 2. Sync Panel (Work-in-Progress)
- **Style:** Outlined "Hollow" cards. This visually distinguishes them from finalized records.
- **Status Indicators:** 
    - **Pending:** Neutral gray text.
    - **Failed:** Soft red background tint with explicit error message.
- **Interaction:** Floating "Sync All" button (Power Orange).

## Data & API Requirements
- **Local State:** Uses existing `offline_attendance_queue` from `AsyncStorage`.
- **Remote State:** Requires a new endpoint `GET /attendance_today.php` (or similar) to return a list of attendance logs for the current date.
- **Responsive Logic:** Uses `windowWidth` to toggle between `flexDirection: 'row'` (Tablet) and `'column'` (Mobile).

## Performance Optimization (Low-Spec Focus)
- **Virtualization:** Uses `FlatList` or `ScrollView` with `initialNumToRender` optimization for long history feeds.
- **GPU Savings:** No blurring or complex shadows on the cards. Uses 1px borders and tonal colors instead.

## Design Rationale
- **Hierarchy:** Placing History on the left (or bottom on mobile) provides a foundation of "Success," while the right panel highlights "Actions Required."
- **Typography:** Uses weights 700/800 for high legibility on a kiosk terminal.
- **Gestalt Principles:** Grouping related info into clean 12px-radius cards for better information processing.
