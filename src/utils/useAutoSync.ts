import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { BACKEND_URL } from '../config/backend';
import { getOfflineAttendanceQueue, syncOfflineQueue } from './offlineAttendance';
import { mmkv } from './offlineUsers';

/**
 * Hook to handle automatic background syncing of offline attendance records.
 */
export function useAutoSync() {
  const [isOnline, setIsOnline] = useState(true);
  const stabilityCounterRef = useRef(0);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const checkAndSync = async () => {
      try {
        // Check if auto-sync is enabled
        const autoSyncRaw = await AsyncStorage.getItem('settings_auto_sync_enabled');
        const isAutoSyncEnabled = autoSyncRaw !== 'false'; // Default to true

        if (!isAutoSyncEnabled) {
          timeoutId = setTimeout(checkAndSync, 30000);
          return;
        }

        const queue = await getOfflineAttendanceQueue();
        
        // If queue is empty, sleep and check again in 30s (minimal cost)
        if (queue.length === 0) {
          stabilityCounterRef.current = 0;
          setIsOnline(true);
          timeoutId = setTimeout(checkAndSync, 30000);
          return;
        }

        // If we are already syncing, wait
        if (isSyncingRef.current) {
          timeoutId = setTimeout(checkAndSync, 30000);
          return;
        }

        const state = await NetInfo.fetch();
        const online = !!state.isConnected;

        if (online) {
          setIsOnline(true);
          stabilityCounterRef.current += 1;

          try {
            const response = await fetch(`${BACKEND_URL}/settings.php`, {
              headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
            });
            if (response.ok) {
              const data = await response.json();
              if (data && data.kiosk_mode) {
                mmkv.set('kiosk_mode', data.kiosk_mode);
              }
            }
          } catch (e) {}

          if (stabilityCounterRef.current >= 2) {
            isSyncingRef.current = true;
            try {
              await syncOfflineQueue();
            } finally {
              isSyncingRef.current = false;
              stabilityCounterRef.current = 0;
            }
          }
        } else {
          setIsOnline(false);
          stabilityCounterRef.current = 0;
        }
      } catch (error) {
        setIsOnline(false);
        stabilityCounterRef.current = 0;
      }

      timeoutId = setTimeout(checkAndSync, 30000);
    };

    checkAndSync();

    return () => clearTimeout(timeoutId);
  }, []);

  return { isOnline };
}
