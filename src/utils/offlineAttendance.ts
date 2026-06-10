import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL } from '../config/backend';

export const OFFLINE_MODE_KEY = 'settings_offline_mode_enabled';
export const OFFLINE_ATTENDANCE_QUEUE_KEY = 'offline_attendance_queue';

export type AttendanceAction = 'clock_in' | 'clock_out';
export type OfflineAttendanceStatus = 'pending' | 'failed';

export type OfflineAttendanceItem = {
  id: string;
  userId: string;
  username: string;
  name?: string | null;
  action: AttendanceAction;
  date: string;
  time: string;
  createdAt: string;
  status: OfflineAttendanceStatus;
  errorMessage?: string | null;
  latitude?: number;
  longitude?: number;
  address?: string;
  isIntern?: boolean;
};

export async function getOfflineAttendanceQueue(): Promise<OfflineAttendanceItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_ATTENDANCE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOfflineAttendanceQueue(items: OfflineAttendanceItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_ATTENDANCE_QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueOfflineAttendance(
  input: Omit<OfflineAttendanceItem, 'id' | 'createdAt' | 'status' | 'errorMessage'>
): Promise<OfflineAttendanceItem> {
  const now = new Date().toISOString();
  const item: OfflineAttendanceItem = {
    ...input,
    id: `offline_${input.userId}_${input.action}_${now}`,
    createdAt: now,
    status: 'pending',
    errorMessage: null,
  };

  const queue = await getOfflineAttendanceQueue();
  queue.unshift(item);
  await saveOfflineAttendanceQueue(queue);
  return item;
}

export async function markOfflineAttendanceFailed(id: string, message: string): Promise<void> {
  const queue = await getOfflineAttendanceQueue();
  const next = queue.map((item) =>
    item.id === id
      ? {
          ...item,
          status: 'failed' as const,
          errorMessage: message,
        }
      : item
  );
  await saveOfflineAttendanceQueue(next);
}

export async function markOfflineAttendancePending(id: string): Promise<void> {
  const queue = await getOfflineAttendanceQueue();
  const next = queue.map((item) =>
    item.id === id
      ? {
          ...item,
          status: 'pending' as const,
          errorMessage: null,
        }
      : item
  );
  await saveOfflineAttendanceQueue(next);
}

export async function removeOfflineAttendanceItem(id: string): Promise<void> {
  const queue = await getOfflineAttendanceQueue();
  await saveOfflineAttendanceQueue(queue.filter((item) => item.id !== id));
}

/**
 * Synchronizes a single offline attendance item with the backend.
 * Only removes the item from local storage AFTER a successful response.
 */
export async function syncOfflineItem(item: OfflineAttendanceItem): Promise<void> {
  await markOfflineAttendancePending(item.id);

  const response = await fetch(`${BACKEND_URL}/record_attendance.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      user_id: item.userId,
      action: item.action,
      date: item.date,
      time: item.time,
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.address,
      isIntern: item.isIntern,
    }),
  });

  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || `Sync failed (${response.status})`);
  }

  await removeOfflineAttendanceItem(item.id);
}

/**
 * Synchronizes the entire offline attendance queue with the backend.
 * Loops through all pending and failed items.
 */
export async function syncOfflineQueue(): Promise<{ success: number; failed: number }> {
  const queue = await getOfflineAttendanceQueue();
  const candidates = queue.filter((item) => item.status === 'pending' || item.status === 'failed');
  
  let successCount = 0;
  let failedCount = 0;

  for (const item of candidates) {
    try {
      await syncOfflineItem(item);
      successCount++;
    } catch (error: any) {
      failedCount++;
      await markOfflineAttendanceFailed(
        item.id,
        error?.message || 'Connection error. Please check your network settings.'
      );
    }
  }

  return { success: successCount, failed: failedCount };
}
