import { createMMKV } from 'react-native-mmkv';
import { File, Paths } from 'expo-file-system';
import { BACKEND_URL } from '../config/backend';

export const mmkv = createMMKV({
  id: 'hris-kiosk-storage',
});

export const OFFLINE_USER_CACHE_KEY = 'offline_user_cache_v1';

export type CachedOfflineUser = {
  userId: string;
  empId: string;
  username: string;
  name?: string | null;
  qrCode?: string | null;
  profile_picture?: string | null;
  profile_picture_remote?: string | null;
  role?: string | null;
  department?: string | null;
  face_embedding?: string | number[] | number[][] | null;
};

export type EmployeePayloadRow = {
  emp_id?: number | string | null;
  name?: string | null;
  role?: string | null;
  log_id?: number | string | null;
  departments?: { name?: string | null } | null;
  face_embedding?: string | number[] | number[][] | null;
  accounts?:
    | {
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
        face_embedding?: string | number[] | number[][] | null;
      }
    | Array<{
        log_id?: number | string | null;
        username?: string | null;
        qr_code?: string | null;
        profile_picture?: string | null;
        face_embedding?: string | number[] | number[][] | null;
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

export async function cacheProfilePictureOnDisk(userId: string, remoteUrl: string): Promise<string | null> {
  if (!remoteUrl || !remoteUrl.startsWith('http')) {
    return remoteUrl || null;
  }
  try {
    const fileExtension = remoteUrl.split('.').pop()?.split('?')[0] || 'jpg';
    const localFilename = `profile_${userId}.${fileExtension}`;
    const file = new File(Paths.cache, localFilename);

    // Download standard 500x500px resolution profile photo directly to device cache
    const downloadedFile = await File.downloadFileAsync(remoteUrl, file);
    console.log(`[Profile Caching] Successfully cached profile for ${userId} at ${downloadedFile.uri}`);
    return downloadedFile.uri;
  } catch (err) {
    console.error(`[Profile Caching] Failed to cache profile for ${userId}:`, err);
    return null;
  }
}

export async function deleteCachedProfilePicture(userId: string): Promise<void> {
  try {
    const extensions = ['jpg', 'jpeg', 'png'];
    for (const ext of extensions) {
      const localFilename = `profile_${userId}.${ext}`;
      const file = new File(Paths.cache, localFilename);
      if (file.exists) {
        await file.delete();
        console.log(`[Profile Caching] Deleted cached profile for ${userId} at ${file.uri}`);
      }
    }
  } catch (err) {
    console.error(`[Profile Caching] Error deleting cached profile for ${userId}:`, err);
  }
}

export async function triggerBackgroundProfileCaching(users: CachedOfflineUser[]): Promise<void> {
  const batchSize = 5;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (user) => {
        const remoteUrl = user.profile_picture_remote;
        if (!remoteUrl) return;

        const existingRaw = mmkv.getString(`user_by_id:${user.userId}`);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw) as CachedOfflineUser;
            if (
              existing.profile_picture && 
              existing.profile_picture.startsWith('file://') && 
              existing.profile_picture_remote === remoteUrl
            ) {
              return;
            }
          } catch {}
        }

        const cachedUri = await cacheProfilePictureOnDisk(user.userId, remoteUrl);
        if (cachedUri) {
          const currentRaw = mmkv.getString(`user_by_id:${user.userId}`);
          let mergedUser: CachedOfflineUser = {
            ...user,
            profile_picture: cachedUri,
          };
          if (currentRaw) {
            try {
              const current = JSON.parse(currentRaw);
              mergedUser = {
                ...current,
                profile_picture: cachedUri,
              };
            } catch {}
          }
          mmkv.set(`user_by_id:${user.userId}`, JSON.stringify(mergedUser));
        }
      })
    );
  }
}

export async function getOfflineUserCache(): Promise<CachedOfflineUser[]> {
  try {
    const keys = mmkv.getAllKeys();
    const userKeys = keys.filter(k => k.startsWith('user_by_id:'));
    const users: CachedOfflineUser[] = [];
    for (const key of userKeys) {
      const raw = mmkv.getString(key);
      if (raw) {
        try {
          users.push(JSON.parse(raw));
        } catch {}
      }
    }
    return users;
  } catch {
    return [];
  }
}

export async function saveOfflineUserCache(users: CachedOfflineUser[]): Promise<void> {
  const keys = mmkv.getAllKeys();
  const indexKeys = keys.filter(k => k.startsWith('user_by_id:') || k.startsWith('user_by_qr:'));
  for (const key of indexKeys) {
    (mmkv as any).delete(key);
  }

  for (const user of users) {
    mmkv.set(`user_by_id:${user.userId}`, JSON.stringify(user));
    if (user.qrCode) {
      mmkv.set(`user_by_qr:${user.qrCode}`, user.userId);
    }
  }
}

export async function clearOfflineUserCache(): Promise<void> {
  const keys = mmkv.getAllKeys();
  const indexKeys = keys.filter(k => k.startsWith('user_by_id:') || k.startsWith('user_by_qr:'));
  for (const key of indexKeys) {
    (mmkv as any).delete(key);
  }
}

export function mapEmployeesToOfflineUsers(data: EmployeePayloadRow[]): CachedOfflineUser[] {
  return data
    .filter(e => e !== null && typeof e === 'object')
    .map((employee): CachedOfflineUser | null => {
      const account = normalizeAccount(employee.accounts);
      const userId = String(account?.log_id ?? employee.log_id ?? '').trim();
      const username = String(account?.username ?? employee.name ?? '').trim();

      if (!userId || !username) {
        return null;
      }

      const remoteUrl = account?.profile_picture ?? null;

      return {
        userId,
        empId: String(employee.emp_id ?? '').trim(),
        username,
        name: employee.name ?? null,
        role: employee.role ?? null,
        department: employee.departments?.name ?? null,
        profile_picture: remoteUrl,
        profile_picture_remote: remoteUrl,
        qrCode: account?.qr_code ?? null,
        face_embedding: (account as any)?.face_embedding ?? (employee as any).face_embedding ?? null,
      };
    })
    .filter((u): u is CachedOfflineUser => u !== null);
}

export async function updateOfflineUserCacheFromEmployees(
  data: EmployeePayloadRow[],
  isFullSync: boolean = true
): Promise<CachedOfflineUser[]> {
  const incomingUsers = mapEmployeesToOfflineUsers(data);
  const incomingIds = new Set(incomingUsers.map(u => u.userId));
  
  // 1. Delete stale users (only on full synchronization)
  if (isFullSync) {
    const keys = mmkv.getAllKeys();
    const existingUserKeys = keys.filter(k => k.startsWith('user_by_id:'));
    for (const key of existingUserKeys) {
      const userId = key.substring('user_by_id:'.length);
      if (!incomingIds.has(userId)) {
        const userRaw = mmkv.getString(key);
        if (userRaw) {
          try {
            const user = JSON.parse(userRaw) as CachedOfflineUser;
            if (user.qrCode) {
              (mmkv as any).delete(`user_by_qr:${user.qrCode}`);
            }
          } catch {}
        }
        (mmkv as any).delete(key);
        await deleteCachedProfilePicture(userId);
      }
    }
  }

  // 2. Bulk-write incoming users
  for (const user of incomingUsers) {
    let finalUser = user;
    const existingRaw = mmkv.getString(`user_by_id:${user.userId}`);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as CachedOfflineUser;
        if (existing.profile_picture?.startsWith('file://') && existing.profile_picture_remote === user.profile_picture_remote) {
          finalUser = {
            ...user,
            profile_picture: existing.profile_picture,
          };
        }
      } catch {}
    }
    
    mmkv.set(`user_by_id:${user.userId}`, JSON.stringify(finalUser));
    if (user.qrCode) {
      mmkv.set(`user_by_qr:${user.qrCode}`, user.userId);
    }
  }
  
  // Trigger background downloading in the background asynchronously (non-blocking)
  triggerBackgroundProfileCaching(incomingUsers).catch(err => {
    console.error('[Profile Caching] Background caching failed:', err);
  });
  
  return getOfflineUserCache();
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

    if (!response.ok) {
      throw new Error('Unable to refresh offline user cache');
    }

    responseText = await response.text();
    const payload = JSON.parse(responseText) as EmployeesPayload;

    if (!payload?.ok || !Array.isArray(payload.data)) {
      throw new Error('Unable to refresh offline user cache');
    }

    const users = await updateOfflineUserCacheFromEmployees(payload.data);
    return users;
  } catch (error) {
    console.error('refreshOfflineUserCache error:', error);
    if (responseText) {
      const sanitizedResponse = responseText.replace(/"(face|profile_picture|image)":"[^"]{100,}"/g, '"$1":"[face_data]"');
      console.error('Raw response that failed to parse:', sanitizedResponse);
    }
    throw error;
  }
}

export async function resolveOfflineUserFromQr(qrData: string): Promise<CachedOfflineUser | null> {
  const hints = parseQrHints(qrData);

  if (hints.exact) {
    const userId = mmkv.getString(`user_by_qr:${hints.exact}`);
    if (userId) {
      const userRaw = mmkv.getString(`user_by_id:${userId}`);
      if (userRaw) {
        try {
          return JSON.parse(userRaw);
        } catch {}
      }
    }
  }

  if (hints.userId) {
    const userRaw = mmkv.getString(`user_by_id:${hints.userId}`);
    if (userRaw) {
      try {
        return JSON.parse(userRaw);
      } catch {}
    }
  }

  if (hints.username) {
    const keys = mmkv.getAllKeys();
    const userKeys = keys.filter(k => k.startsWith('user_by_id:'));
    for (const key of userKeys) {
      const userRaw = mmkv.getString(key);
      if (userRaw) {
        try {
          const user = JSON.parse(userRaw) as CachedOfflineUser;
          if (user.username && user.username.trim().toLowerCase() === hints.username) {
            return user;
          }
        } catch {}
      }
    }
  }

  const exactQr = hints.exact;
  const keys = mmkv.getAllKeys();
  const userKeys = keys.filter(k => k.startsWith('user_by_id:'));
  for (const key of userKeys) {
    const userRaw = mmkv.getString(key);
    if (userRaw) {
      try {
        const user = JSON.parse(userRaw) as CachedOfflineUser;
        if (user.qrCode && user.qrCode.trim() === exactQr) {
          return user;
        }
      } catch {}
    }
  }

  return null;
}

export async function upsertOfflineUserCacheUser(
  user: CachedOfflineUser
): Promise<void> {
  const normalizedQr = user.qrCode?.trim() || null;
  const existingRaw = mmkv.getString(`user_by_id:${user.userId}`);
  let merged: CachedOfflineUser = {
    ...user,
    profile_picture_remote: user.profile_picture_remote ?? user.profile_picture,
  };

  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      merged = {
        ...existing,
        ...user,
        username: user.username.trim(),
        qrCode: normalizedQr,
        profile_picture_remote: user.profile_picture_remote ?? existing.profile_picture_remote ?? user.profile_picture ?? existing.profile_picture,
      };

      if (merged.profile_picture && !merged.profile_picture.startsWith('file://') && existing.profile_picture?.startsWith('file://') && existing.profile_picture_remote === merged.profile_picture_remote) {
        merged.profile_picture = existing.profile_picture;
      }
    } catch {}
  }

  mmkv.set(`user_by_id:${user.userId}`, JSON.stringify(merged));
  if (normalizedQr) {
    mmkv.set(`user_by_qr:${normalizedQr}`, user.userId);
  }

  if (merged.profile_picture_remote && (!merged.profile_picture || !merged.profile_picture.startsWith('file://'))) {
    cacheProfilePictureOnDisk(merged.userId, merged.profile_picture_remote).then(cachedUri => {
      if (cachedUri) {
        const finalRaw = mmkv.getString(`user_by_id:${merged.userId}`);
        if (finalRaw) {
          try {
            const finalUser = JSON.parse(finalRaw);
            finalUser.profile_picture = cachedUri;
            mmkv.set(`user_by_id:${merged.userId}`, JSON.stringify(finalUser));
          } catch {}
        }
      }
    }).catch(err => console.error('[Profile Caching] Single upsert caching failed:', err));
  }
}
