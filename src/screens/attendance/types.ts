export const ATTENDANCE_SESSIONS_KEY = 'attendance_active_sessions';
export const TOUCHLESS_SETTING_KEY = 'settings_touchless_enabled';
export const LIVENESS_SETTING_KEY = 'settings_liveness_enabled';

export type AttendanceProps = {
  onBack: () => void;
  onOpenOffline: () => void;
};

export type ResolvedUser = {
  userId: string;
  username: string;
  name?: string | null;
  profile_picture?: string | null;
  role?: string | null;
  department?: string | null;
};

export type StoredAttendanceSession = {
  userId: string;
  username: string;
  name?: string | null;
  clockInTime: string;
  clockInDate: string;
};

export type ModalType = 'success' | 'error' | 'info' | 'warning';
