import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { BACKEND_URL } from '../config/backend';

// Global state to prevent spamming the backend
let globalLastCheckTime = 0;
let globalLastResult = true;
let globalCheckPromise: Promise<boolean> | null = null;

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [hasGoodInternet, setHasGoodInternet] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    
    try {
      const state = await NetInfo.fetch();
      setIsConnected(state.isConnected);
      if (!state.isConnected) {
        setHasGoodInternet(false);
        setIsChecking(false);
        return false;
      }

      const now = Date.now();
      // Throttle: If we checked within the last 5 seconds, return cached result
      if (now - globalLastCheckTime < 5000) {
        setHasGoodInternet(globalLastResult);
        setIsChecking(false);
        return globalLastResult;
      }

      // If another component is already checking, wait for its result
      if (globalCheckPromise) {
        const result = await globalCheckPromise;
        setHasGoodInternet(result);
        setIsChecking(false);
        return result;
      }

      globalCheckPromise = (async () => {
        try {
          const controller = new AbortController();
          // Increased timeout to 8000ms
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          // Use HEAD request and cache busting
          const res = await fetch(`${BACKEND_URL}/attendance_today.php?t=${Date.now()}`, {
            method: 'HEAD',
            headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const isOk = res.status >= 200 && res.status < 300;
          globalLastResult = isOk;
          globalLastCheckTime = Date.now();
          return isOk;
        } catch {
          globalLastResult = false;
          globalLastCheckTime = Date.now();
          return false;
        } finally {
          globalCheckPromise = null;
        }
      })();

      const result = await globalCheckPromise;
      setHasGoodInternet(result);
      setIsChecking(false);
      return result;
    } catch {
      setHasGoodInternet(false);
      setIsChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
      if (!state.isConnected) {
        setHasGoodInternet(false);
        // Force new check next time by clearing throttle
        globalLastCheckTime = 0; 
      } else {
        checkStatus();
      }
    });

    checkStatus();

    return () => unsubscribe();
  }, [checkStatus]);

  return { isConnected, hasGoodInternet, isChecking, checkStatus };
}
