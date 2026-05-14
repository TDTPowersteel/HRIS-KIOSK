import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { BACKEND_URL } from '../../config/backend';
import { OFFLINE_MODE_KEY, enqueueOfflineAttendance, getOfflineAttendanceQueue } from '../../utils/offlineAttendance';
import { refreshOfflineUserCache, resolveOfflineUserFromQr } from '../../utils/offlineUsers';
import { useTheme } from '../../config/theme';
import {
  ATTENDANCE_SESSIONS_KEY,
  TOUCHLESS_SETTING_KEY,
  ResolvedUser,
  StoredAttendanceSession,
  ModalType,
} from './types';

export function useAttendance() {
  const { colors } = useTheme();

  // Camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;
  const cameraRef = useRef<Camera>(null);

  // Refs
  const livenessTriggeredRef = useRef(false);
  const countdownRef = useRef(1);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalContextRef = useRef<'qr_success' | 'other'>('other');
  const lastScanRef = useRef<{ data: string | null; ts: number }>({ data: null, ts: 0 });
  const touchlessTriggeredRef = useRef(false);
  const qrProcessingRef = useRef(false);
  const faceProcessingRef = useRef(false);
  const modalVisibleRef = useRef(false);

  // State
  const [faceCountdown, setFaceCountdown] = useState(1);
  const [countdownActive, setCountdownActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockInTime, setClockInTime] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [qrVerified, setQrVerified] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<ResolvedUser | null>(null);
  const [attendanceAction, setAttendanceAction] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Modal state
  const [showResultModal, setShowResultModal] = useState(false);
  const [modalType, setModalType] = useState<ModalType>('success');
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalHint, setModalHint] = useState('');

  // Animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [snapSound, setSnapSound] = useState<Audio.Sound | null>(null);

  // Liveness detection
  const { detectFaces } = useFaceDetector({
    classificationMode: 'all',
    performanceMode: 'fast',
  });

  const playSnapSound = async () => {
    try {
      if (snapSound) await snapSound.replayAsync();
    } catch {}
  };

  // Modal helpers
  const closeModal = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    modalVisibleRef.current = false;
    Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowResultModal(false);
      scaleAnim.setValue(0);
      if (modalContextRef.current === 'qr_success') {
        setCountdownActive(true);
        modalContextRef.current = 'other';
      }
    });
  }, [scaleAnim]);

  const showModal = useCallback(
    (type: ModalType, title: string, message: string, hint: string, autoCloseMs?: number) => {
      modalVisibleRef.current = true;
      setModalType(type);
      setModalTitle(title);
      setModalMessage(message);
      setModalHint(hint);
      setShowResultModal(true);
      Animated.spring(scaleAnim, { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }).start();
      if (autoCloseMs) {
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = setTimeout(() => closeModal(), autoCloseMs);
      }
    },
    [scaleAnim, closeModal],
  );

  // Session helpers
  const getStoredSession = useCallback(async (userId: string): Promise<StoredAttendanceSession | null> => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const session = parsed?.[userId];
      if (!session || typeof session !== 'object' || !session.clockInTime || !session.clockInDate) return null;
      return { userId, username: String(session.username || ''), name: session.name ?? null, clockInTime: String(session.clockInTime), clockInDate: String(session.clockInDate) };
    } catch { return null; }
  }, []);

  const saveStoredSession = useCallback(async (session: StoredAttendanceSession) => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[session.userId] = session;
      await AsyncStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(parsed));
    } catch {}
  }, []);

  const clearStoredSession = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed?.[userId]) { delete parsed[userId]; await AsyncStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(parsed)); }
    } catch {}
  }, []);

  const resetAttendanceFlow = useCallback(async () => {
    setQrVerified(false);
    setClockInTime('');
    setWelcomeName(null);
    setSelectedUser(null);
    setAttendanceAction('clock_in');
    setFaceCountdown(3);
    countdownRef.current = 3;
    setCountdownActive(false);
    modalContextRef.current = 'other';
    lastScanRef.current = { data: null, ts: 0 };
    touchlessTriggeredRef.current = false;
    qrProcessingRef.current = false;
    faceProcessingRef.current = false;
    try { await AsyncStorage.multiRemove(['userId', 'username']); } catch {}
  }, []);

  const handleOfflineModeChange = useCallback(async (next: boolean) => {
    setOfflineModeEnabled(next);
    try { await AsyncStorage.setItem(OFFLINE_MODE_KEY, next ? 'true' : 'false'); }
    catch { setOfflineModeEnabled(!next); showModal('error', 'Offline Mode', 'Failed to save offline mode setting.', ''); }
  }, [showModal]);

  const refreshPendingSyncCount = useCallback(async () => {
    try {
      const queue = await getOfflineAttendanceQueue();
      setPendingSyncCount(queue.filter((item) => item.status === 'pending').length);
    } catch { setPendingSyncCount(0); }
  }, []);

  // QR resolve
  const resolveUserFromQr = useCallback(async (qrData: string): Promise<ResolvedUser> => {
    try {
      const response = await fetch(`${BACKEND_URL}/resolve_qr.php?qr=${encodeURIComponent(qrData)}`, {
        headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
      });
      const responseText = await response.text();
      console.log('[QR] Raw response', response.status, responseText?.slice?.(0, 200));
      let payload: any = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; }
      catch { throw new Error(`Server returned invalid response. Status: ${response.status}`); }
      if (!response.ok) throw new Error(payload?.message || `QR validation failed. Status: ${response.status}`);
      if (!payload?.ok || !payload?.user?.log_id) throw new Error(payload?.message || 'QR not recognized');
      return {
        userId: String(payload.user.log_id),
        username: String(payload.user.username || ''),
        name: payload.user.name ?? null,
        profile_picture: payload.user.profile_picture ?? null,
        role: payload.user.role ?? null,
        department: payload.user.department ?? null,
      };
    } catch (error) {
      if (!offlineModeEnabled) throw error;
      const cachedUser = await resolveOfflineUserFromQr(qrData);
      if (!cachedUser) throw new Error('Offline mode needs a previously cached employee list for this QR code.');
      return { userId: cachedUser.userId, username: cachedUser.username, name: cachedUser.name ?? null, profile_picture: cachedUser.profile_picture ?? null, role: cachedUser.role ?? null, department: cachedUser.department ?? null };
    }
  }, [offlineModeEnabled]);

  // Face verify
  const verifyFace = async (photoUri1: string, photoUri2?: string) => {
    let userId = null;
    try { userId = await AsyncStorage.getItem('userId'); } catch {}
    if (!userId) throw new Error('User not logged in (missing userId). Please log in again.');
    console.log('[Verify] Sending face to backend', { userId, hasLiveness: !!photoUri2 });
    const form = new FormData();
    form.append('photo', { uri: photoUri1, name: 'selfie_1.jpg', type: 'image/jpeg' } as any);
    if (photoUri2) form.append('photo_liveness', { uri: photoUri2, name: 'selfie_2.jpg', type: 'image/jpeg' } as any);
    form.append('clock_time', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    form.append('user_id', userId);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);
    const response = await fetch(`${BACKEND_URL}/verify.php`, { method: 'POST', body: form, headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }, signal: controller.signal });
    clearTimeout(timeoutId);
    const responseText = await response.text();
    console.log('[Verify] Raw response', response.status, responseText?.slice?.(0, 200));
    let json: any = {};
    try { json = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error(`Server returned invalid response. Status: ${response.status}`); }
    if (response.status === 401 && json.message) {
      console.log('[Verify] Face mismatch or Liveness failure', json);
      return { ok: false, verified: false, message: json.message, hint: json.hint, match_score: json.match_score, threshold: json.threshold, liveness_score: json.liveness_score };
    }
    if (!response.ok || !json.ok) {
      let errorMsg = json.message || 'Verification failed';
      if (json.detail) errorMsg += `\n\nDetail: ${json.detail}`;
      if (json.hint) errorMsg += `\n\n${json.hint}`;
      throw new Error(errorMsg);
    }
    return json;
  };

  const runVerification = useCallback(async () => {
    if (!cameraRef.current) throw new Error('Camera not ready');
    const photo1 = await cameraRef.current.takePhoto({ flash: 'off' });
    if (!photo1?.path) throw new Error('No image captured (Shot 1)');
    
    let photo2;
    if (livenessEnabled) {
      await new Promise(resolve => setTimeout(resolve, 600));
      photo2 = await cameraRef.current.takePhoto({ flash: 'off' });
      if (!photo2?.path) throw new Error('No image captured (Shot 2)');
    }
    
    if (offlineModeEnabled) return { ok: true, verified: true, offlineCaptured: true, message: 'Face photos captured offline.', photoUri: `file://${photo1.path}` };
    return verifyFace(`file://${photo1.path}`, photo2 ? `file://${photo2.path}` : undefined);
  }, [offlineModeEnabled, livenessEnabled]);

  const recordAttendance = useCallback(async (action: 'clock_in' | 'clock_out') => {
    const userId = await AsyncStorage.getItem('userId');
    if (!userId) return;
    console.log('[Attendance] Recording', { userId, action });
    const res = await fetch(`${BACKEND_URL}/record_attendance.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }, body: JSON.stringify({ user_id: userId, action }) });
    const responseText = await res.text();
    let data: any = {};
    try { data = responseText ? JSON.parse(responseText) : {}; } catch {}
    return data;
  }, []);

  const storeClockInNotification = useCallback(async (payload: { date?: string; timein?: string }) => {
    try {
      const date = payload?.date ? String(payload.date) : '';
      const timein = payload?.timein ? String(payload.timein) : '';
      if (!date || !timein) return;
      const id = `attendance_in_${date}_${timein}`;
      const raw = await AsyncStorage.getItem('attendance_clockins');
      const prev: any[] = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(prev) ? prev : [];
      if (!next.some((x) => x && x.id === id)) next.unshift({ id, date, timein, timestamp: `${date}T${timein}` });
      await AsyncStorage.setItem('attendance_clockins', JSON.stringify(next.slice(0, 20)));
    } catch {}
  }, []);

  // Main attendance handler
  const handleAttendance = useCallback(async () => {
    if (faceProcessingRef.current || isVerifying) return;
    if (!qrVerified || !selectedUser) {
      showModal('warning', 'Scan QR Code First', 'Please scan your personal QR code before continuing.', 'The user must scan a QR code.');
      return;
    }
    if (!hasPermission) { showModal('warning', 'Camera Required', 'Please allow camera access to verify your identity.', ''); return; }
    faceProcessingRef.current = true;
    console.log('[Attendance] Starting verification', { action: attendanceAction, userId: selectedUser.userId });
    setIsVerifying(true);
    try {
      let result;
      if (attendanceAction === 'clock_out') {
        result = { ok: true, verified: true, message: 'Clock out authorized.' };
      } else {
        result = await runVerification();
        if (result?.liveness_score != null) console.log(`[Verify] Liveness Accuracy: ${(result.liveness_score * 100).toFixed(2)}%`);
        if (result?.match_score != null) console.log(`[Verify] Identity Match Accuracy: ${(result.match_score * 100).toFixed(2)}%`);
      }
      const action = attendanceAction;
      if (result?.ok === true) {
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        let data: any = null;
        if (offlineModeEnabled) {
          await enqueueOfflineAttendance({ userId: selectedUser.userId, username: selectedUser.username, name: selectedUser.name ?? null, action, date: localDate, time: localTime });
          await refreshPendingSyncCount();
        } else {
          data = await recordAttendance(action);
        }
        if (action === 'clock_in') {
          await storeClockInNotification({ date: data?.date || localDate, timein: data?.timein || localTime });
          await saveStoredSession({ userId: selectedUser.userId, username: selectedUser.username, name: selectedUser.name ?? null, clockInTime: data?.timein || localTime, clockInDate: data?.date || localDate });
          if (!offlineModeEnabled && data?.emp_id != null) await AsyncStorage.setItem('emp_id', String(data.emp_id));
        } else {
          await clearStoredSession(selectedUser.userId);
        }
        await resetAttendanceFlow();
        showModal('success',
          offlineModeEnabled ? (action === 'clock_in' ? 'Saved For Sync' : 'Clock Out Saved For Sync') : (action === 'clock_in' ? 'Clock In Complete' : 'Clock Out Complete'),
          offlineModeEnabled ? (action === 'clock_in' ? 'Face captured. Saved offline. Press SYNC NOW when ready.' : 'Clock out saved offline. Press SYNC NOW when ready.') : (action === 'clock_in' ? (result?.message || 'Face verified. Attendance recorded.') : (result?.message || 'Face verified. Logout recorded.')),
          '', touchlessEnabled ? 1000 : undefined);
      } else if (result?.verified === false) {
        faceProcessingRef.current = false;
        livenessTriggeredRef.current = false;
        showModal('error', 'Verification Failed', result?.message || 'Face verification failed.', result?.hint || 'Please try again.', touchlessEnabled ? 2000 : undefined);
      } else {
        faceProcessingRef.current = false;
        livenessTriggeredRef.current = false;
        showModal('error', 'Verification Failed', 'Please try again.', '', touchlessEnabled ? 2000 : undefined);
      }
    } catch (e: any) {
      faceProcessingRef.current = false;
      livenessTriggeredRef.current = false;
      showModal('error', offlineModeEnabled ? 'Offline Mode Error' : 'Connection Error', e?.message || 'Please try again.', offlineModeEnabled ? 'Connect once to refresh employee QR cache.' : 'Check your internet connection', touchlessEnabled ? 2000 : undefined);
    } finally {
      setIsVerifying(false);
    }
  }, [attendanceAction, clearStoredSession, hasPermission, qrVerified, recordAttendance, resetAttendanceFlow, saveStoredSession, selectedUser, showModal, offlineModeEnabled, refreshPendingSyncCount, runVerification, storeClockInNotification, touchlessEnabled]);

  // Liveness callback
  const onLivenessDetected = Worklets.createRunOnJS(() => {
    if (!livenessTriggeredRef.current && !modalVisibleRef.current && qrVerified && attendanceAction === 'clock_in' && countdownRef.current <= 0) {
      playSnapSound();
      handleAttendance();
      livenessTriggeredRef.current = true;
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    if (faces.length > 0) {
      const face = faces[0];
      const leftOpen = (face.leftEyeOpenProbability || 0) > 0.4;
      const rightOpen = (face.rightEyeOpenProbability || 0) > 0.4;
      if (leftOpen || rightOpen) onLivenessDetected();
    }
  }, [qrVerified, attendanceAction]);

  // QR scanner
  const handleBarcodeScanned = async (event: any) => {
    if (qrProcessingRef.current || isVerifying || qrVerified) return;
    const data: string | undefined = event?.data;
    if (!data) return;
    const now = Date.now();
    if (lastScanRef.current.data === data && now - lastScanRef.current.ts < 1500) return;
    qrProcessingRef.current = true;
    lastScanRef.current = { data, ts: now };
    playSnapSound();
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    setIsQrLoading(true);
    try {
      console.log('[QR] Scanned', data);
      const resolved = await resolveUserFromQr(data);
      const existingSession = await getStoredSession(resolved.userId);
      console.log('[QR] Resolved user', resolved);
      await AsyncStorage.setItem('userId', resolved.userId);
      await AsyncStorage.setItem('username', resolved.username);
      setSelectedUser(resolved);
      setWelcomeName(resolved.name || resolved.username || 'Employee');
      setClockInTime(existingSession?.clockInTime || '');
      setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');
      setQrVerified(true);
      setFaceCountdown(1);
      countdownRef.current = 1;
      livenessTriggeredRef.current = false;
      touchlessTriggeredRef.current = false;
      if (touchlessEnabled) {
        modalContextRef.current = 'qr_success';
        showModal('success', 'QR Code Verified', existingSession ? `Welcome back, ${resolved.name || resolved.username}! Clock-out starting...` : `Hello, ${resolved.name || resolved.username}! Get ready for face scan.`, '', 800);
      } else {
        modalContextRef.current = 'qr_success';
        showModal('success', 'QR Code Verified', existingSession ? 'This user already has an active clock-in. Press CLOCK OUT to finish logout.' : 'QR recognized. Face the camera to verify attendance.', 'No need to touch the screen. Just look at the camera!');
      }
    } catch (e: any) {
      console.log('[QR] Validation error', e);
      setQrVerified(false);
      qrProcessingRef.current = false;
      setSelectedUser(null);
      showModal('error', 'QR Validation Error', e?.message || 'Could not validate QR code.', '');
    } finally {
      setIsQrLoading(false);
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) handleBarcodeScanned({ data: codes[0].value });
    },
  });

  // Effects
  useEffect(() => {
    async function loadSound() {
      try {
        const { sound } = await Audio.Sound.createAsync({ uri: 'https://www.soundjay.com/camera/camera-shutter-click-08.mp3' });
        setSnapSound(sound);
      } catch {}
    }
    loadSound();
    return () => { if (snapSound) snapSound.unloadAsync(); };
  }, []);

  useEffect(() => { setIsLoading(false); }, []);

  useEffect(() => {
    if (qrVerified && !isVerifying) {
      Animated.loop(Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])).start();
    } else { scanLineAnim.setValue(0); }
  }, [qrVerified, isVerifying, scanLineAnim]);

  useEffect(() => {
    if (!countdownActive || !qrVerified || attendanceAction !== 'clock_in' || isVerifying) return;
    if (faceCountdown <= 0) return;
    const timer = setTimeout(() => { const next = faceCountdown - 1; setFaceCountdown(next); countdownRef.current = next; }, 1000);
    return () => clearTimeout(timer);
  }, [countdownActive, qrVerified, attendanceAction, isVerifying, faceCountdown]);

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, OFFLINE_MODE_KEY, 'settings_liveness_enabled']).then((entries) => {
      if (active) {
        const mapped = Object.fromEntries(entries);
        setTouchlessEnabled(mapped[TOUCHLESS_SETTING_KEY] === 'true');
        setOfflineModeEnabled(mapped[OFFLINE_MODE_KEY] === 'true');
        setLivenessEnabled(mapped['settings_liveness_enabled'] !== 'false'); // Default true
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { refreshPendingSyncCount(); }, [refreshPendingSyncCount]);
  useEffect(() => { refreshOfflineUserCache().catch(() => {}); }, []);

  useEffect(() => {
    if (!qrVerified || !touchlessEnabled || isVerifying || touchlessTriggeredRef.current) return;
    if (attendanceAction !== 'clock_out') return;
    touchlessTriggeredRef.current = true;
    const timer = setTimeout(() => handleAttendance(), 1500);
    return () => clearTimeout(timer);
  }, [attendanceAction, handleAttendance, isVerifying, qrVerified, touchlessEnabled]);

  const formatTo12Hour = (timeStr: string) => {
    if (!timeStr) return '';
    if (timeStr.toUpperCase().includes('AM') || timeStr.toUpperCase().includes('PM')) return timeStr;
    try {
      const [hours, minutes] = timeStr.split(':');
      if (!hours || !minutes) return timeStr;
      const h = parseInt(hours, 10);
      const m = parseInt(minutes, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour12 = h % 12 || 12;
      return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  const formattedTime = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const formattedDate = currentTime.toDateString();
  const isClockingOut = attendanceAction === 'clock_out';
  const displayClockInTime = formatTo12Hour(clockInTime);

  return {
    colors, device, cameraRef, hasPermission, requestPermission,
    codeScanner, frameProcessor,
    flashAnim, scanLineAnim, scaleAnim,
    formattedTime, formattedDate,
    isLoading, isVerifying, isQrLoading, isClockingOut,
    qrVerified, selectedUser, clockInTime: displayClockInTime, faceCountdown,
    touchlessEnabled, offlineModeEnabled, livenessEnabled, pendingSyncCount,
    showResultModal, modalType, modalTitle, modalMessage, modalHint,
    closeModal, handleOfflineModeChange, handleAttendance,
  };
}
