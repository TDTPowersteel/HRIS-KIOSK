import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [hasGoodInternet, setHasGoodInternet] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      setIsConnected(state.isConnected);
      const online = !!state.isConnected;
      setHasGoodInternet(online);
      setIsChecking(false);
      return online;
    } catch {
      setHasGoodInternet(false);
      setIsChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
      setHasGoodInternet(!!state.isConnected);
    });

    checkStatus();

    return () => unsubscribe();
  }, [checkStatus]);

  return { isConnected, hasGoodInternet, isChecking, checkStatus };
}
