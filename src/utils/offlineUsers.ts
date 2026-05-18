import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL } from '../config/backend';

export const OFFLINE_USER_CACHE_KEY = 'offline_user_cache_v1';

export type CachedOfflineUser = {
  userId: string;
  empId: string;
  username: string;
  name?: string | null;
  qrCode?: string | null;
  profile_picture?: string | null;
  role?: string | null;
  department?: string | null;
  face_embedding?: string | null;
};

export type EmployeePayloadRow = {
  emp_id?: number | string | null;
  name?: string | null;
  role?: string | null;
  log_id?: number | string | null;
  departments?: { name?: string | null } | null;
  accounts?:
    | {
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
      }
    | Array<{
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
      }>
    | null;
};

type EmployeesPayload = {
  ok?: boolean;
  data?: EmployeePayloadRow[];
};

function normalizeAccount(
  value:
    | {
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
      }
    | Array<{
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
      }>
    | null
    | undefined
) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function parseQrHints(qrData: string) {
  const exact = qrData.trim();
  const logIdMatch = exact.match(/LOG_?ID:([0-9]+)/i);
  const usernameMatch = exact.match(/USER:([^|]+)/i);

  return {
    exact,
    userId: logIdMatch?.[1]?.trim() ?? null,
    username: usernameMatch?.[1]?.trim().toLowerCase() ?? null,
  };
}

export async function getOfflineUserCache(): Promise<CachedOfflineUser[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_USER_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOfflineUserCache(users: CachedOfflineUser[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_USER_CACHE_KEY, JSON.stringify(users));
}

export async function clearOfflineUserCache(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_USER_CACHE_KEY);
}

export function mapEmployeesToOfflineUsers(data: EmployeePayloadRow[]): CachedOfflineUser[] {
  return data
    .filter(e => e !== null && typeof e === 'object')
    .map((employee): CachedOfflineUser | null => {
      const account = normalizeAccount(employee.accounts);
      const userId = String(account?.log_id ?? employee.log_id ?? '').trim();
      
      // Allow name as fallback for username if account is missing
      const username = String(account?.username ?? employee.name ?? '').trim();

      if (!userId || !username) {
        return null;
      }

      return {
        userId,
        empId: String(employee.emp_id ?? '').trim(),
        username,
        name: employee.name ?? null,
        role: employee.role ?? null,
        department: employee.departments?.name ?? null,
        profile_picture: account?.profile_picture ?? null,
        qrCode: account?.qr_code ?? null,
      };
    })
    .filter((u): u is CachedOfflineUser => u !== null);
}

export async function updateOfflineUserCacheFromEmployees(data: EmployeePayloadRow[]): Promise<CachedOfflineUser[]> {
  const incomingUsers = mapEmployeesToOfflineUsers(data);
  const existingUsers = await getOfflineUserCache();
  
  const userMap = new Map<string, CachedOfflineUser>();
  
  // Load existing
  existingUsers.forEach(u => userMap.set(u.userId, u));
  
  // Merge incoming (overwrite with fresh data)
  incomingUsers.forEach(u => userMap.set(u.userId, u));
  
  const merged = Array.from(userMap.values());
  await saveOfflineUserCache(merged);
  return merged;
}

export async function refreshOfflineUserCache(): Promise<CachedOfflineUser[]> {
  let responseText = '';
  try {
    const response = await fetch(`${BACKEND_URL}/employees.php`, {
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
    });

    responseText = await response.text();
    const payload = JSON.parse(responseText) as EmployeesPayload;

    if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
      throw new Error('Unable to refresh offline user cache');
    }

    const users = await updateOfflineUserCacheFromEmployees(payload.data);
    return users;
  } catch (error) {
    console.error('refreshOfflineUserCache error:', error);
    if (responseText) {
      // Truncate long base64 data in the log to keep it readable
      const sanitizedResponse = responseText.replace(/"(face|profile_picture|image)":"[^"]{100,}"/g, '"$1":"[face_data]"');
      console.error('Raw response that failed to parse:', sanitizedResponse);
    }
    throw error;
  }
}

export async function resolveOfflineUserFromQr(qrData: string): Promise<CachedOfflineUser | null> {
  const users = await getOfflineUserCache();
  if (!users.length) {
    return null;
  }

  const hints = parseQrHints(qrData);

  const exactMatch = users.find((user) => user.qrCode && user.qrCode.trim() === hints.exact);
  if (exactMatch) {
    return exactMatch;
  }

  if (hints.userId) {
    const byLogId = users.find((user) => user.userId === hints.userId);
    if (byLogId) {
      return byLogId;
    }
  }

  if (hints.username) {
    const byUsername = users.find((user) => user.username.trim().toLowerCase() === hints.username);
    if (byUsername) {
      return byUsername;
    }
  }

  return null;
}

export async function upsertOfflineUserCacheUser(
  user: CachedOfflineUser
): Promise<void> {
  const normalizedUsername = user.username.trim().toLowerCase();
  const normalizedQr = user.qrCode?.trim() || null;
  const queue = await getOfflineUserCache();

  const existingIndex = queue.findIndex((item) => {
    if (item.userId === user.userId) return true;
    if (item.username.trim().toLowerCase() === normalizedUsername) return true;
    if (normalizedQr && item.qrCode?.trim() === normalizedQr) return true;
    return false;
  });

  const merged: CachedOfflineUser = {
    ...(existingIndex >= 0 ? queue[existingIndex] : {}),
    ...user,
    username: user.username.trim(),
    qrCode: normalizedQr,
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = merged;
  } else {
    queue.unshift(merged);
  }

  await saveOfflineUserCache(queue);
}
