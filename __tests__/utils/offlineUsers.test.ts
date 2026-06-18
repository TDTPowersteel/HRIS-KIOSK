import {
  mapEmployeesToOfflineUsers,
  getOfflineUserCache,
  saveOfflineUserCache,
  clearOfflineUserCache,
  resolveOfflineUserFromQr,
  upsertOfflineUserCacheUser,
  cacheProfilePictureOnDisk,
  deleteCachedProfilePicture,
  triggerBackgroundProfileCaching,
  updateOfflineUserCacheFromEmployees,
  refreshOfflineUserCache,
  mmkv
} from '../../src/utils/offlineUsers';
import * as FileSystem from 'expo-file-system';

describe('Offline Users Caching Utils', () => {
  beforeEach(() => {
    // Clear storage before each test
    mmkv.clearAll();
  });

  it('maps raw employee payload rows correctly into CachedOfflineUser type', () => {
    const rawData = [
      {
        emp_id: '123',
        name: 'Keith',
        role: 'Engineer',
        log_id: '10',
        departments: { name: 'IT' },
        accounts: {
          log_id: '10',
          username: 'keith123',
          qr_code: 'LOG_ID:10|USER:keith123',
          profile_picture: 'https://example.com/pic.jpg',
          face_embedding: [0.1, 0.2, 0.3]
        }
      }
    ];

    const mapped = mapEmployeesToOfflineUsers(rawData);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual({
      userId: '10',
      empId: '123',
      username: 'keith123',
      name: 'Keith',
      role: 'Engineer',
      department: 'IT',
      profile_picture: 'https://example.com/pic.jpg',
      profile_picture_remote: 'https://example.com/pic.jpg',
      qrCode: 'LOG_ID:10|USER:keith123',
      face_embedding: [0.1, 0.2, 0.3],
      isIntern: false
    });
  });

  it('correctly reads and writes the cache using MMKV', async () => {
    const mockUser = {
      userId: '10',
      empId: '123',
      username: 'keith123',
      name: 'Keith',
      profile_picture: 'https://example.com/pic.jpg',
      profile_picture_remote: 'https://example.com/pic.jpg',
      qrCode: 'LOG_ID:10|USER:keith123',
      face_embedding: [0.1, 0.2, 0.3]
    };

    await saveOfflineUserCache([mockUser]);

    const retrieved = await getOfflineUserCache();
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].userId).toBe('10');
    expect(retrieved[0].username).toBe('keith123');

    // Verify clear cache works
    await clearOfflineUserCache();
    const cleared = await getOfflineUserCache();
    expect(cleared).toHaveLength(0);
  });

  it('resolves offline users from QR code efficiently', async () => {
    const mockUser = {
      userId: '10',
      empId: '123',
      username: 'keith123',
      name: 'Keith',
      profile_picture: 'https://example.com/pic.jpg',
      profile_picture_remote: 'https://example.com/pic.jpg',
      qrCode: 'LOG_ID:10|USER:keith123',
      face_embedding: [0.1, 0.2, 0.3]
    };

    await saveOfflineUserCache([mockUser]);

    // Test exact QR match
    const resolvedExact = await resolveOfflineUserFromQr('LOG_ID:10|USER:keith123');
    expect(resolvedExact).not.toBeNull();
    expect(resolvedExact?.userId).toBe('10');

    // Test userId/logId pointer fallback
    const resolvedLogId = await resolveOfflineUserFromQr('LOG_ID:10');
    expect(resolvedLogId).not.toBeNull();
    expect(resolvedLogId?.userId).toBe('10');

    // Test username match
    const resolvedUsername = await resolveOfflineUserFromQr('USER:keith123');
    expect(resolvedUsername).not.toBeNull();
    expect(resolvedUsername?.userId).toBe('10');
  });

  it('upserts a user and correctly preserves cached local URI if remote has not changed', async () => {
    const initialUser = {
      userId: '10',
      empId: '123',
      username: 'keith123',
      name: 'Keith',
      profile_picture: 'file:///mock/profile_10.jpg', // Local cached image
      profile_picture_remote: 'https://example.com/pic.jpg',
      qrCode: 'LOG_ID:10|USER:keith123',
      face_embedding: [0.1, 0.2, 0.3]
    };

    await saveOfflineUserCache([initialUser]);

    // Upsert with remote URL
    const updatedUser = {
      userId: '10',
      empId: '123',
      username: 'keith123',
      name: 'Keith',
      profile_picture: 'https://example.com/pic.jpg', // Remote URL in payload
      qrCode: 'LOG_ID:10|USER:keith123',
      face_embedding: [0.1, 0.2, 0.3]
    };

    await upsertOfflineUserCacheUser(updatedUser);

    const raw = mmkv.getString('user_by_id:10');
    expect(raw).toBeDefined();

    const finalUser = JSON.parse(raw!);
    // Should preserve the existing file:// URI because the remote URL hasn't changed!
    expect(finalUser.profile_picture).toBe('file:///mock/profile_10.jpg');
    expect(finalUser.profile_picture_remote).toBe('https://example.com/pic.jpg');
  });

  describe('Profile Picture Filesystem Caching', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('cacheProfilePictureOnDisk skips caching if remoteUrl is not a http/https url', async () => {
      const result = await cacheProfilePictureOnDisk('10', 'file:///already/local.jpg');
      expect(result).toBe('file:///already/local.jpg');
      expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    });

    it('cacheProfilePictureOnDisk downloads and returns local uri if remoteUrl is a http url', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValueOnce({ status: 200, uri: 'file:///mock/cacheDirectory/profile_10.jpg' });

      const result = await cacheProfilePictureOnDisk('10', 'https://example.com/pic.jpg');
      expect(result).toBe('file:///mock/cacheDirectory/profile_10.jpg');
      expect(mockDownload).toHaveBeenCalledWith('https://example.com/pic.jpg', 'file:///mock/cacheDirectory/profile_10.jpg');
    });

    it('cacheProfilePictureOnDisk returns null if download status is not 200', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValueOnce({ status: 404, uri: '' });

      const result = await cacheProfilePictureOnDisk('10', 'https://example.com/pic.jpg');
      expect(result).toBeNull();
    });

    it('cacheProfilePictureOnDisk returns null and logs error if download throws exception', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockRejectedValueOnce(new Error('Network failure'));

      const result = await cacheProfilePictureOnDisk('10', 'https://example.com/pic.jpg');
      expect(result).toBeNull();
    });

    it('deleteCachedProfilePicture deletes matching cached extension files if they exist', async () => {
      const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
      const mockDelete = FileSystem.deleteAsync as jest.Mock;

      mockGetInfo.mockImplementation(async (uri: string) => {
        return { exists: uri.endsWith('.jpg') };
      });

      await deleteCachedProfilePicture('10');

      expect(mockDelete).toHaveBeenCalledWith('file:///mock/cacheDirectory/profile_10.jpg', { idempotent: true });
      expect(mockDelete).not.toHaveBeenCalledWith('file:///mock/cacheDirectory/profile_10.jpeg', { idempotent: true });
      expect(mockDelete).not.toHaveBeenCalledWith('file:///mock/cacheDirectory/profile_10.png', { idempotent: true });
    });

    it('triggerBackgroundProfileCaching queues batch downloads of missing/outdated profile pictures', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValue({ status: 200, uri: 'file:///mock/cacheDirectory/profile_10.jpg' });

      const users = [
        {
          userId: '10',
          empId: '123',
          username: 'keith123',
          profile_picture_remote: 'https://example.com/pic10.jpg',
        },
        {
          userId: '11',
          empId: '124',
          username: 'john124',
          profile_picture_remote: 'https://example.com/pic11.jpg',
        }
      ];

      mmkv.set('user_by_id:10', JSON.stringify(users[0]));

      await triggerBackgroundProfileCaching(users);

      const user10Raw = mmkv.getString('user_by_id:10');
      const user11Raw = mmkv.getString('user_by_id:11');

      expect(user10Raw).toBeDefined();
      expect(user11Raw).toBeDefined();

      const user10 = JSON.parse(user10Raw!);
      const user11 = JSON.parse(user11Raw!);

      expect(user10.profile_picture).toBe('file:///mock/cacheDirectory/profile_10.jpg');
      expect(user11.profile_picture).toBe('file:///mock/cacheDirectory/profile_10.jpg');
    });

    it('updateOfflineUserCacheFromEmployees deletes stale users and caches new ones in the background', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValue({ status: 200, uri: 'file:///mock/cacheDirectory/profile_99.jpg' });
      const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
      mockGetInfo.mockResolvedValue({ exists: true });
      const mockDelete = FileSystem.deleteAsync as jest.Mock;

      const staleUser = {
        userId: '88',
        empId: '888',
        username: 'stale_user',
        profile_picture: 'file:///mock/cacheDirectory/profile_88.jpg',
        profile_picture_remote: 'https://example.com/pic88.jpg',
        qrCode: 'QR_STALE',
      };
      mmkv.set('user_by_id:88', JSON.stringify(staleUser));
      mmkv.set('user_by_qr:QR_STALE', '88');

      const employeePayload = [
        {
          emp_id: '999',
          name: 'New Employee',
          log_id: '99',
          accounts: {
            log_id: '99',
            username: 'new_emp',
            qr_code: 'QR_NEW',
            profile_picture: 'https://example.com/pic99.jpg',
          }
        }
      ];

      await updateOfflineUserCacheFromEmployees(employeePayload);

      expect(mmkv.getString('user_by_id:88')).toBeUndefined();
      expect(mmkv.getString('user_by_qr:QR_STALE')).toBeUndefined();
      expect(mockDelete).toHaveBeenCalledWith('file:///mock/cacheDirectory/profile_88.jpg', { idempotent: true });

      const newUserRaw = mmkv.getString('user_by_id:99');
      expect(newUserRaw).toBeDefined();
      expect(mmkv.getString('user_by_qr:QR_NEW')).toBe('99');
    });

    it('refreshOfflineUserCache handles successful API call and updates cache', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          ok: true,
          data: [
            {
              emp_id: '1',
              name: 'Alice',
              log_id: '1',
              accounts: {
                log_id: '1',
                username: 'alice',
                qr_code: 'QR_ALICE',
                profile_picture: 'https://example.com/alice.jpg',
              }
            }
          ]
        }))
      });

      const users = await refreshOfflineUserCache();
      expect(users).toHaveLength(1);
      expect(users[0].userId).toBe('1');
      expect(users[0].username).toBe('alice');
    });

    it('refreshOfflineUserCache throws error when API call fails', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: jest.fn().mockResolvedValue('Internal Server Error')
      });

      await expect(refreshOfflineUserCache()).rejects.toThrow('Unable to refresh offline user cache');
    });

    it('calls onProfileCached callback when already cached locally', async () => {
      const users = [
        {
          userId: '10',
          empId: '123',
          username: 'keith123',
          profile_picture: 'file:///mock/cacheDirectory/profile_10.jpg',
          profile_picture_remote: 'https://example.com/pic10.jpg',
        }
      ];
      mmkv.set('user_by_id:10', JSON.stringify(users[0]));

      const onProfileCached = jest.fn();
      await triggerBackgroundProfileCaching(users, onProfileCached);

      expect(onProfileCached).toHaveBeenCalledWith('10', 'file:///mock/cacheDirectory/profile_10.jpg');
    });

    it('calls onProfileCached callback after fresh download succeeds', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValue({ status: 200, uri: 'file:///mock/cacheDirectory/profile_10.jpg' });

      const users = [
        {
          userId: '10',
          empId: '123',
          username: 'keith123',
          profile_picture_remote: 'https://example.com/pic10.jpg',
        }
      ];

      const onProfileCached = jest.fn();
      await triggerBackgroundProfileCaching(users, onProfileCached);

      expect(onProfileCached).toHaveBeenCalledWith('10', 'file:///mock/cacheDirectory/profile_10.jpg');
    });

    it('updateOfflineUserCacheFromEmployees forwards the callback to triggerBackgroundProfileCaching', async () => {
      const mockDownload = FileSystem.downloadAsync as jest.Mock;
      mockDownload.mockResolvedValue({ status: 200, uri: 'file:///mock/cacheDirectory/profile_99.jpg' });
      const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;
      mockGetInfo.mockResolvedValue({ exists: true });

      const employeePayload = [
        {
          emp_id: '999',
          name: 'New Employee',
          log_id: '99',
          accounts: {
            log_id: '99',
            username: 'new_emp',
            qr_code: 'QR_NEW',
            profile_picture: 'https://example.com/pic99.jpg',
          }
        }
      ];

      const onProfileCached = jest.fn();
      await updateOfflineUserCacheFromEmployees(employeePayload, true, onProfileCached);

      expect(onProfileCached).toHaveBeenCalledWith('99', 'file:///mock/cacheDirectory/profile_99.jpg');
    });
  });
});

