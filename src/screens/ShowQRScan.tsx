import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
// import { CameraView, useCameraPermissions } from 'expo-camera'; // (RESERVED)
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  useFrameProcessor
} from 'react-native-vision-camera';
import { useFaceDetector, FaceDetectorDefaultProps } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../config/backend';
import { OFFLINE_MODE_KEY, enqueueOfflineAttendance, getOfflineAttendanceQueue } from '../utils/offlineAttendance';
import { refreshOfflineUserCache, resolveOfflineUserFromQr } from '../utils/offlineUsers';

const ATTENDANCE_SESSIONS_KEY = 'attendance_active_sessions';
const TOUCHLESS_SETTING_KEY = 'settings_touchless_enabled';

type Props = {
  onBack: () => void;
  onOpenOffline: () => void;
};

type ResolvedUser = {
  userId: string;
  username: string;
  name?: string | null;
};

type StoredAttendanceSession = {
  userId: string;
  username: string;
  name?: string | null;
  clockInTime: string;
  clockInDate: string;
};

export default function ShowQRScan({ onBack, onOpenOffline }: Props) {
  // --- VISION CAMERA SETUP ---
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);

  const livenessTriggeredRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const countdownRef = useRef(3);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalContextRef = useRef<'qr_success' | 'other'>('other');

  const [faceCountdown, setFaceCountdown] = useState(3);
  const [countdownActive, setCountdownActive] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockInTime, setClockInTime] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [lastScannedData, setLastScannedData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [qrVerified, setQrVerified] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<ResolvedUser | null>(null);
  const [attendanceAction, setAttendanceAction] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [isSavingOfflineMode, setIsSavingOfflineMode] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const lastScanRef = useRef<{ data: string | null; ts: number }>({ data: null, ts: 0 });
  const touchlessTriggeredRef = useRef(false);
  const qrProcessingRef = useRef(false);
  const faceProcessingRef = useRef(false);

  const [showResultModal, setShowResultModal] = useState(false);
  const modalVisibleRef = useRef(false);
  const [modalType, setModalType] = useState<'success' | 'error' | 'info' | 'warning'>('success');
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalHint, setModalHint] = useState('');
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [snapSound, setSnapSound] = useState<Audio.Sound | null>(null);

  // --- LIVENESS DETECTION LOGIC (ML KIT) ---
  const { detectFaces } = useFaceDetector({
    ...FaceDetectorDefaultProps,
    classificationMode: 'all',
    performanceMode: 'fast',
  });

  const onLivenessDetected = Worklets.createRunOnJS(() => {
    if (!livenessTriggeredRef.current && !modalVisibleRef.current && qrVerified && attendanceAction === 'clock_in' && countdownRef.current <= 0) {
      playSnapSound();
      handleAttendance();
      livenessTriggeredRef.current = true;
    }
  });

  // Liveness: triggers instantly when a face with at least one open eye is detected.
  // No smile or blink gesture required.
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    if (faces.length > 0) {
      const face = faces[0];
      const leftOpen = (face.leftEyeOpenProbability || 0) > 0.4;
      const rightOpen = (face.rightEyeOpenProbability || 0) > 0.4;
      if (leftOpen || rightOpen) {
        onLivenessDetected();
      }
    }
  }, [qrVerified, attendanceAction]);

  // --- QR SCANNER LOGIC (VISION CAMERA) ---
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value) {
        handleBarcodeScanned({ data: codes[0].value });
      }
    }
  });

  useEffect(() => {
    async function loadSound() {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: 'https://www.soundjay.com/camera/camera-shutter-click-08.mp3' }
        );
        setSnapSound(sound);
      } catch (error) {
        console.log('[Sound] Failed to load snap sound', error);
      }
    }
    loadSound();

    return () => {
      if (snapSound) {
        snapSound.unloadAsync();
      }
    };
  }, []);

  const playSnapSound = async () => {
    try {
      if (snapSound) {
        await snapSound.replayAsync();
      }
    } catch (error) {
      console.log('[Sound] Error playing sound', error);
    }
  };

  useEffect(() => {
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (qrVerified && !isVerifying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      scanLineAnim.setValue(0);
    }
  }, [qrVerified, isVerifying, scanLineAnim]);

  // Countdown: 3→2→1→0 after QR verified, before liveness activates
  useEffect(() => {
    if (!countdownActive || !qrVerified || attendanceAction !== 'clock_in' || isVerifying) return;
    if (faceCountdown <= 0) return;
    const timer = setTimeout(() => {
      const next = faceCountdown - 1;
      setFaceCountdown(next);
      countdownRef.current = next;
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdownActive, qrVerified, attendanceAction, isVerifying, faceCountdown]);

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, OFFLINE_MODE_KEY])
      .then((entries) => {
        if (active) {
          const mapped = Object.fromEntries(entries);
          setTouchlessEnabled(mapped[TOUCHLESS_SETTING_KEY] === 'true');
          setOfflineModeEnabled(mapped[OFFLINE_MODE_KEY] === 'true');
        }
      })
      .catch(() => {
        console.log('[Settings] Failed to load local settings');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formattedDate = currentTime.toDateString();
  const isClockingOut = attendanceAction === 'clock_out';

  const closeModal = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    modalVisibleRef.current = false;
    Animated.timing(scaleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowResultModal(false);
      scaleAnim.setValue(0);
      if (modalContextRef.current === 'qr_success') {
        setCountdownActive(true);
        modalContextRef.current = 'other';
      }
    });
  }, [scaleAnim]);

  const showModal = useCallback(
    (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string, hint: string, autoCloseMs?: number) => {
      modalVisibleRef.current = true;
      setModalType(type);
      setModalTitle(title);
      setModalMessage(message);
      setModalHint(hint);
      setShowResultModal(true);

      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }).start();

      if (autoCloseMs) {
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = setTimeout(() => {
          closeModal();
        }, autoCloseMs);
      }
    },
    [scaleAnim, closeModal]
  );


  const handleOfflineModeChange = useCallback(async (next: boolean) => {
    setOfflineModeEnabled(next);
    setIsSavingOfflineMode(true);
    try {
      await AsyncStorage.setItem(OFFLINE_MODE_KEY, next ? 'true' : 'false');
    } catch {
      setOfflineModeEnabled(!next);
      showModal('error', 'Offline Mode', 'Failed to save offline mode setting.', '');
    } finally {
      setIsSavingOfflineMode(false);
    }
  }, [showModal]);

  const refreshPendingSyncCount = useCallback(async () => {
    try {
      const queue = await getOfflineAttendanceQueue();
      setPendingSyncCount(queue.filter((item) => item.status === 'pending').length);
    } catch {
      setPendingSyncCount(0);
    }
  }, []);

  useEffect(() => {
    refreshPendingSyncCount();
  }, [refreshPendingSyncCount]);

  useEffect(() => {
    refreshOfflineUserCache().catch(() => {
      console.log('[Offline] Could not refresh offline user cache');
    });
  }, []);

  const getStoredSession = useCallback(async (userId: string): Promise<StoredAttendanceSession | null> => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const session = parsed?.[userId];
      if (!session || typeof session !== 'object') return null;
      if (!session.clockInTime || !session.clockInDate) return null;
      return {
        userId,
        username: String(session.username || ''),
        name: session.name ?? null,
        clockInTime: String(session.clockInTime),
        clockInDate: String(session.clockInDate),
      };
    } catch {
      console.log('[Attendance] Failed to read stored sessions');
      return null;
    }
  }, []);

  const saveStoredSession = useCallback(async (session: StoredAttendanceSession) => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[session.userId] = session;
      await AsyncStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(parsed));
    } catch {
      console.log('[Attendance] Failed to save stored session');
    }
  }, []);

  const clearStoredSession = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && parsed[userId]) {
        delete parsed[userId];
        await AsyncStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(parsed));
      }
    } catch {
      console.log('[Attendance] Failed to clear stored session');
    }
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
    // livenessTriggeredRef intentionally NOT reset here — keeps it true to block
    // any late frame-processor calls during the re-render window after success.
    // It is reset in handleBarcodeScanned when the next QR session starts.
    lastScanRef.current = { data: null, ts: 0 };
    touchlessTriggeredRef.current = false;
    qrProcessingRef.current = false;
    faceProcessingRef.current = false;
    try {
      await AsyncStorage.multiRemove(['userId', 'username']);
    } catch {
      console.log('Failed to clear selected user from storage');
    }
  }, []);

  const resolveUserFromQr = useCallback(async (qrData: string): Promise<ResolvedUser> => {
    try {
      const response = await fetch(`${BACKEND_URL}/resolve_qr.php?qr=${encodeURIComponent(qrData)}`, {
        headers: {
          Accept: 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      });
      const responseText = await response.text();
      console.log('[QR] Raw response', response.status, responseText?.slice?.(0, 200));

      let payload: any = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch (parseError) {
        console.error('[QR] JSON parse error:', parseError);
        throw new Error(`Server returned invalid response. Status: ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(payload?.message || `QR validation failed. Status: ${response.status}`);
      }

      if (!payload?.ok || !payload?.user?.log_id) {
        throw new Error(payload?.message || 'QR not recognized');
      }

      return {
        userId: String(payload.user.log_id),
        username: String(payload.user.username || ''),
        name: payload.user.name ?? null,
      };
    } catch (error) {
      if (!offlineModeEnabled) {
        throw error;
      }

      const cachedUser = await resolveOfflineUserFromQr(qrData);
      if (!cachedUser) {
        throw new Error('Offline mode needs a previously cached employee list for this QR code.');
      }

      return {
        userId: cachedUser.userId,
        username: cachedUser.username,
        name: cachedUser.name ?? null,
      };
    }
  }, [offlineModeEnabled]);

  const handleBarcodeScanned = async (event: any) => {
    if (qrProcessingRef.current || isVerifying || qrVerified) return;

    const data: string | undefined = event?.data;
    if (!data) return;

    const now = Date.now();
    if (lastScanRef.current.data === data && now - lastScanRef.current.ts < 1500) {
      return;
    }

    qrProcessingRef.current = true;
    lastScanRef.current = { data, ts: now };

    // Snap effect (flash + sound)
    playSnapSound();
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();

    // Immediate feedback to avoid perceived delay
    setIsQrLoading(true);
    setLastScannedData(data);

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
      setFaceCountdown(3);
      countdownRef.current = 3;
      // Reset liveness for this new session so the face scan triggers fresh.
      livenessTriggeredRef.current = false;
      touchlessTriggeredRef.current = false;

      if (touchlessEnabled) {
        // Touchless: show modal briefly for 2 seconds then auto-start countdown
        modalContextRef.current = 'qr_success';
        showModal(
          'success',
          'QR Code Verified',
          existingSession
            ? `Welcome back, ${resolved.name || resolved.username}! Clock-out starting...`
            : `Hello, ${resolved.name || resolved.username}! Get ready for face scan.`,
          '',
          2000
        );
      } else {
        modalContextRef.current = 'qr_success';
        showModal(
          'success',
          'QR Code Verified',
          existingSession
            ? offlineModeEnabled
              ? 'This user already has an active clock-in. Press CLOCK OUT to save the attendance offline.'
              : 'This user already has an active clock-in. Press CLOCK OUT to finish logout.'
            : offlineModeEnabled
              ? 'QR recognized. Face the camera to verify attendance.'
              : 'QR recognized. Face the camera to verify attendance automatically.',
          'No need to touch the screen. Just look at the camera!'
        );
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

  const verifyFace = async (photoUri1: string, photoUri2?: string) => {
    let userId = null;
    try {
      userId = await AsyncStorage.getItem('userId');
    } catch {
      console.log('Could not get userId from storage');
    }

    if (!userId) {
      throw new Error('User not logged in (missing userId). Please log in again.');
    }

    console.log('[Verify] Sending face to backend', { userId, hasLiveness: !!photoUri2 });
    const form = new FormData();

    // Main Photo for Recognition
    form.append(
      'photo',
      {
        uri: photoUri1,
        name: 'selfie_1.jpg',
        type: 'image/jpeg',
      } as any
    );

    // Secondary Photo for Liveness Check (Micro-movement detection)
    if (photoUri2) {
      form.append(
        'photo_liveness',
        {
          uri: photoUri2,
          name: 'selfie_2.jpg',
          type: 'image/jpeg',
        } as any
      );
    }

    const requestTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    form.append('clock_time', requestTime);
    form.append('user_id', userId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);
    const response = await fetch(`${BACKEND_URL}/verify.php`, {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log('[Verify] Raw response', response.status, responseText?.slice?.(0, 200));

    let json: any = {};
    try {
      json = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      console.error('[Verify] JSON parse error:', parseError);
      throw new Error(`Server returned invalid response. Status: ${response.status}`);
    }

    if (response.status === 401 && json.message) {
      console.log('[Verify] Face mismatch or Liveness failure', json);
      return {
        ok: false,
        verified: false,
        message: json.message,
        hint: json.hint,
        match_score: json.match_score,
        threshold: json.threshold,
        liveness_score: json.liveness_score,
      };
    }

    if (!response.ok || !json.ok) {
      console.log('[Verify] Error response', json);
      let errorMsg = json.message || 'Verification failed';
      if (json.detail) errorMsg += `\n\nDetail: ${json.detail}`;
      if (json.hint) errorMsg += `\n\n${json.hint}`;
      throw new Error(errorMsg);
    }

    return json;
  };

  const runVerification = useCallback(async () => {
    if (!cameraRef.current) throw new Error('Camera not ready');

    // SHOT 1
    const photo1 = await cameraRef.current.takePhoto({
      qualityPrioritization: 'speed',
      flash: 'off',
    });
    if (!photo1?.path) throw new Error('No image captured (Shot 1)');

    // BURST DELAY (200ms) - Invisible micro-movement check optimized for speed
    await new Promise(resolve => setTimeout(resolve, 200));

    // SHOT 2
    const photo2 = await cameraRef.current.takePhoto({
      qualityPrioritization: 'speed',
      flash: 'off',
    });
    if (!photo2?.path) throw new Error('No image captured (Shot 2)');

    if (offlineModeEnabled) {
      return {
        ok: true,
        verified: true,
        offlineCaptured: true,
        message: 'Face photos captured offline.',
        photoUri: `file://${photo1.path}`,
      };
    }

    return verifyFace(`file://${photo1.path}`, `file://${photo2.path}`);
  }, [offlineModeEnabled]);

  const recordAttendance = useCallback(async (action: 'clock_in' | 'clock_out') => {
    const userId = await AsyncStorage.getItem('userId');
    if (!userId) return;

    console.log('[Attendance] Recording', { userId, action });
    const res = await fetch(`${BACKEND_URL}/record_attendance.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ user_id: userId, action }),
    });

    const responseText = await res.text();
    console.log('[Attendance] Raw response', res.status, responseText?.slice?.(0, 200));

    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      console.warn('[Attendance] record_attendance invalid JSON:', responseText?.slice?.(0, 300) || responseText);
    }

    if (!res.ok || !data.ok) {
      console.warn(
        '[Attendance] record_attendance failed:',
        data.message || res.status,
        data.detail ? `detail=${JSON.stringify(data.detail).slice(0, 300)}` : ''
      );
    }

    return data;
  }, []);

  const storeClockInNotification = useCallback(async (payload: { date?: string; timein?: string }) => {
    try {
      const date = payload?.date ? String(payload.date) : '';
      const timein = payload?.timein ? String(payload.timein) : '';
      if (!date || !timein) return;

      const id = `attendance_in_${date}_${timein}`;
      const timestamp = `${date}T${timein}`;

      const raw = await AsyncStorage.getItem('attendance_clockins');
      const prev: any[] = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(prev) ? prev : [];

      if (!next.some((x) => x && x.id === id)) {
        next.unshift({ id, date, timein, timestamp });
      }

      await AsyncStorage.setItem('attendance_clockins', JSON.stringify(next.slice(0, 20)));
    } catch {
      console.log('[Attendance] Failed to store clock-in notification');
    }
  }, []);

  const handleAttendance = useCallback(async () => {
    if (faceProcessingRef.current || isVerifying) return;

    if (!qrVerified || !selectedUser) {
      showModal(
        'warning',
        'Scan QR Code First',
        'Please scan your personal QR code before continuing.',
        'The user must scan a QR code. Face-verification is required for clock-in but skipped for clock-out.'
      );
      return;
    }

    if (!hasPermission) {
      showModal('warning', 'Camera Required', 'Please allow camera access to verify your identity.', '');
      return;
    }

    faceProcessingRef.current = true;
    console.log('[Attendance] Starting verification', { action: attendanceAction, userId: selectedUser.userId });
    setIsVerifying(true);

    try {
      let result;
      if (attendanceAction === 'clock_out') {
        result = { ok: true, verified: true, message: 'Clock out authorized.' };
      } else {
        result = await runVerification();
        if (result?.liveness_score != null) {
          console.log(`[Verify] Liveness Accuracy: ${(result.liveness_score * 100).toFixed(2)}%`);
        }
        if (result?.match_score != null) {
          console.log(`[Verify] Identity Match Accuracy: ${(result.match_score * 100).toFixed(2)}%`);
        }
      }
      const action = attendanceAction;

      if (result?.ok === true) {
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
          now.getDate()
        ).padStart(2, '0')}`;
        const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
          2,
          '0'
        )}:${String(now.getSeconds()).padStart(2, '0')}`;
        let data: any = null;

        if (offlineModeEnabled) {
          await enqueueOfflineAttendance({
            userId: selectedUser.userId,
            username: selectedUser.username,
            name: selectedUser.name ?? null,
            action,
            date: localDate,
            time: localTime,
          });
          await refreshPendingSyncCount();
        } else {
          data = await recordAttendance(action);
        }

        if (action === 'clock_in') {
          await storeClockInNotification({ date: data?.date || localDate, timein: data?.timein || localTime });
          await saveStoredSession({
            userId: selectedUser.userId,
            username: selectedUser.username,
            name: selectedUser.name ?? null,
            clockInTime: data?.timein || localTime,
            clockInDate: data?.date || localDate,
          });
          if (!offlineModeEnabled && data?.emp_id != null) {
            await AsyncStorage.setItem('emp_id', String(data.emp_id));
          }
        } else {
          await clearStoredSession(selectedUser.userId);
        }

        await resetAttendanceFlow();
        showModal(
          'success',
          offlineModeEnabled
            ? action === 'clock_in' ? 'Saved For Sync' : 'Clock Out Saved For Sync'
            : action === 'clock_in' ? 'Clock In Complete' : 'Clock Out Complete',
          offlineModeEnabled
            ? action === 'clock_in'
              ? 'Face captured. This attendance was saved offline. Open LIST OFFLINE and press SYNC NOW when ready.'
              : 'Face captured. This clock out was saved offline. Open LIST OFFLINE and press SYNC NOW when ready.'
            : action === 'clock_in'
              ? result?.message || 'Face verified. Attendance recorded. The scanner is ready for the next user.'
              : result?.message || 'Face verified. Logout recorded. The scanner is ready for the next user.',
          '',
          touchlessEnabled ? 2000 : undefined
        );
      } else if (result?.verified === false) {
        faceProcessingRef.current = false;
        livenessTriggeredRef.current = false; // allow retry
        showModal(
          'error',
          'Verification Failed',
          result?.message || 'Face verification failed.',
          result?.hint || 'Please try again.',
          touchlessEnabled ? 2000 : undefined
        );
      } else {
        faceProcessingRef.current = false;
        livenessTriggeredRef.current = false; // allow retry
        showModal('error', 'Verification Failed', 'Please try again.', '', touchlessEnabled ? 2000 : undefined);
      }
    } catch (e: any) {
      faceProcessingRef.current = false;
      livenessTriggeredRef.current = false; // allow retry
      console.error('Verification error:', e);
      showModal(
        'error',
        offlineModeEnabled ? 'Offline Mode Error' : 'Connection Error',
        e?.message || 'Please try again.',
        offlineModeEnabled
          ? 'Connect once to refresh employee QR cache if this device has never seen that QR before.'
          : 'Check your internet connection',
        touchlessEnabled ? 2000 : undefined
      );
    } finally {
      setIsVerifying(false);
    }
  }, [
    attendanceAction,
    clearStoredSession,
    hasPermission,
    qrVerified,
    recordAttendance,
    resetAttendanceFlow,
    saveStoredSession,
    selectedUser,
    showModal,
    offlineModeEnabled,
    refreshPendingSyncCount,
    runVerification,
    storeClockInNotification,
  ]);

  // Touchless mode: auto-trigger clock-out after QR verified (face scan handles clock-in automatically)
  useEffect(() => {
    if (!qrVerified || !touchlessEnabled || isVerifying || touchlessTriggeredRef.current) return;
    if (attendanceAction !== 'clock_out') return; // clock-in is handled by face detection
    touchlessTriggeredRef.current = true;
    const timer = setTimeout(() => {
      handleAttendance();
    }, 1500);
    return () => clearTimeout(timer);
  }, [attendanceAction, handleAttendance, isVerifying, qrVerified, touchlessEnabled]);

  if (isLoading || !device) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F27121" />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Camera access needed.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* QR SCAN MODE: only codeScanner, no frameProcessor or photo */}
      {!qrVerified && (
        <Camera
          style={styles.fullScreenCamera}
          device={device}
          isActive={true}
          codeScanner={codeScanner}
        />
      )}

      {/* FACE DETECTION MODE: frameProcessor + photo, no codeScanner */}
      {qrVerified && (
        <Camera
          ref={cameraRef}
          style={styles.fullScreenCamera}
          device={device}
          isActive={true}
          photo={true}
          frameProcessor={frameProcessor}
        />
      )}

      <Animated.View
        style={[
          styles.snapFlash,
          { opacity: flashAnim }
        ]}
        pointerEvents="none"
      />

      <View style={styles.cameraTint} pointerEvents="none" />

      <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* TOP HEADER SECTION */}
        <View style={styles.newHeader}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={onBack} style={styles.headerIconButton}>
              <MaterialCommunityIcons name="chevron-left" size={28} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onOpenOffline}
              style={[styles.headerIconButton, { marginLeft: 10 }]}
            >
              <MaterialCommunityIcons name="history" size={22} color="#fff" />
              {pendingSyncCount > 0 && (
                <View style={styles.headerSyncBadge} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <Text style={styles.topTime}>{formattedTime}</Text>
            <Text style={styles.topDate}>{formattedDate}</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => handleOfflineModeChange(!offlineModeEnabled)}
              style={[styles.miniOfflineBadge, offlineModeEnabled && styles.miniOfflineBadgeActive]}
            >
              <MaterialCommunityIcons
                name={offlineModeEnabled ? "cloud-off" : "cloud-check"}
                size={18}
                color="#fff"
              />
              <Text style={styles.miniOfflineText}>{offlineModeEnabled ? "OFFLINE" : "ONLINE"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* STEP INDICATOR - HIGHLIGHTED */}
        <View style={styles.topStepsRow}>
          <View style={[styles.stepPill, !qrVerified && styles.stepPillActive, qrVerified && styles.stepPillDone]}>
            <Text style={[styles.stepPillText, (!qrVerified || qrVerified) && styles.stepPillTextActive]}>
              {qrVerified ? '✓ ' : '1. '}QR CODE
            </Text>
            {!qrVerified && <View style={styles.activeDot} />}
          </View>

          {!isClockingOut && (
            <>
              <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.4)" />

              <View style={[styles.stepPill, qrVerified && !isVerifying && styles.stepPillActive, isVerifying && styles.stepPillDone]}>
                <Text style={[styles.stepPillText, qrVerified && styles.stepPillTextActive]}>
                  2. SCAN FACE
                </Text>
                {qrVerified && !isVerifying && <View style={styles.activeDot} />}
              </View>
            </>
          )}
        </View>

        {/* CENTER SCANNING AREA */}
        <View style={styles.scannerOverlayContainer} pointerEvents="none">
          {!qrVerified ? (
            <View style={styles.qrScannerArea}>
              <View style={styles.qrFrame}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                {isQrLoading ? (
                  <ActivityIndicator size={100} color="#F27121" />
                ) : (
                  <MaterialCommunityIcons name="qrcode-scan" size={100} color="#F27121" />
                )}
              </View>
              <Text style={styles.scanInstructionText}>
                {isQrLoading ? 'QR CODE SCANNED' : 'READY TO SCAN QR'}
              </Text>
            </View>
          ) : isClockingOut ? (
            <View style={styles.qrScannerArea}>
              <View style={styles.qrFrame}>
                <MaterialCommunityIcons name="account-check" size={120} color="#F27121" />
              </View>
              <Text style={styles.scanInstructionText}>READY TO CLOCK OUT</Text>
            </View>
          ) : (
            <View style={styles.faceScannerArea}>
              <View style={styles.faceFrame}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                {!isVerifying && (
                  <Animated.View
                    style={[
                      styles.scanLine,
                      {
                        transform: [
                          {
                            translateY: scanLineAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 240],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                )}
                {isVerifying ? (
                  <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
                ) : faceCountdown > 0 ? (
                  <Text style={styles.countdownText}>{faceCountdown}</Text>
                ) : (
                  <MaterialCommunityIcons
                    name="face-recognition"
                    size={120}
                    color="rgba(255,255,255,0.2)"
                    style={styles.faceIconBackground}
                  />
                )}
              </View>
              <Text style={styles.scanInstructionText}>
                {isVerifying ? 'VERIFYING IDENTITY...' : faceCountdown > 0 ? `GET READY... ${faceCountdown}` : 'LOOK AT THE CAMERA'}
              </Text>
              <Text style={styles.faceHintText}>
                {isVerifying
                  ? 'Please wait while we verify your identity'
                  : faceCountdown > 0
                    ? 'Position your face inside the frame'
                    : 'Face the camera directly \u2022 Keep eyes open \u2022 Stay still  \u2022  SMILE :)'}
              </Text>
            </View>
          )}
        </View>

        {/* FOOTER SECTION */}
        <View style={styles.newFooter}>
          {isQrLoading && (
            <View style={[styles.verifyingPill, { borderColor: '#4A90E2' }]}>
              <ActivityIndicator size="small" color="#4A90E2" />
              <Text style={styles.verifyingPillText}>QR Code Scanned</Text>
            </View>
          )}

          {isVerifying && (
            <View style={styles.verifyingPill}>
              <ActivityIndicator size="small" color="#F27121" />
              <Text style={styles.verifyingPillText}>
                {isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}
              </Text>
            </View>
          )}

          {qrVerified ? (
            <View style={styles.welcomeContainer}>
              <Text style={styles.welcomeLabel}>Good Morning,</Text>
              <Text style={styles.welcomeValue}>{welcomeName ?? 'Employee'}</Text>

              <View style={[styles.actionTag, { backgroundColor: isClockingOut ? '#C0392B' : '#F27121' }]}>
                <Text style={styles.actionTagText}>{isClockingOut ? 'CLOCK OUT' : 'CLOCK IN'}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.welcomeContainer}>
              <Text style={styles.waitingText}>Waiting for employee QR...</Text>
            </View>
          )}

          {!touchlessEnabled && (
            <View style={styles.footerButtons}>
              <TouchableOpacity
                style={[
                  styles.mainActionButton,
                  { backgroundColor: isClockingOut ? '#C0392B' : '#F27121', opacity: (isVerifying || !qrVerified) ? 0.6 : 1 },
                ]}
                onPress={handleAttendance}
                disabled={isVerifying || !qrVerified}
              >
                {isVerifying ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.mainActionButtonText}>
                    {!qrVerified ? 'SCAN QR FIRST' : (isClockingOut ? 'CONFIRM CLOCK OUT' : 'CONFIRM CLOCK IN')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>

      <Modal visible={showResultModal} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <Animated.View
            style={[
              styles.modalContainer,
              {
                transform: [{ scale: scaleAnim }],
                backgroundColor: '#fff',
              },
            ]}
          >
            <View
              style={[
                styles.modalIconContainer,
                {
                  backgroundColor:
                    modalType === 'success'
                      ? '#d4edda'
                      : modalType === 'warning'
                        ? '#fff3cd'
                        : modalType === 'info'
                          ? '#d1ecf1'
                          : '#f8d7da',
                },
              ]}
            >
              <Text style={styles.modalIcon}>
                {modalType === 'success' ? 'OK' : modalType === 'warning' ? '!' : modalType === 'info' ? 'i' : 'X'}
              </Text>
            </View>

            <Text style={styles.modalTitle}>{modalTitle}</Text>
            <Text style={styles.modalMessage}>{modalMessage}</Text>

            {modalHint ? (
              <View style={styles.modalHintContainer}>
                <Text style={styles.modalHintIcon}>i</Text>
                <Text style={styles.modalHint}>{modalHint}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.modalButton,
                {
                  backgroundColor:
                    modalType === 'success'
                      ? '#28a745'
                      : modalType === 'warning'
                        ? '#ffc107'
                        : modalType === 'info'
                          ? '#17a2b8'
                          : '#dc3545',
                },
              ]}
              onPress={closeModal}
            >
              <Text style={styles.modalButtonText}>
                {modalType === 'success' ? 'Great' : modalType === 'warning' ? 'Got it' : modalType === 'info' ? 'OK' : 'Try Again'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  permissionButton: {
    marginTop: 12,
    backgroundColor: '#F27121',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  permissionText: { color: '#fff', fontWeight: '600' },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  snapFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    zIndex: 99,
  },
  cameraTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  overlaySafeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  // NEW HEADER
  newHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    height: 70,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerSyncBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F27121',
    borderWidth: 1,
    borderColor: '#fff',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  topTime: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  topDate: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    fontWeight: '600',
    marginTop: -2,
  },
  headerRight: { width: 85, alignItems: 'flex-end' },
  miniOfflineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  miniOfflineBadgeActive: {
    borderColor: '#F27121',
    backgroundColor: 'rgba(242,113,33,0.2)',
  },
  miniOfflineText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 4,
  },

  // STEPS
  topStepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    gap: 8,
  },
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stepPillActive: {
    backgroundColor: 'rgba(242,113,33,0.2)',
    borderColor: '#F27121',
  },
  stepPillDone: {
    backgroundColor: 'rgba(154,230,180,0.2)',
  },
  stepPillText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
  },
  stepPillTextActive: {
    color: '#fff',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F27121',
    marginLeft: 6,
  },

  // CENTER SCANNER
  scannerOverlayContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrScannerArea: { alignItems: 'center' },
  faceScannerArea: { alignItems: 'center' },
  qrFrame: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  faceFrame: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  faceIconBackground: {
    position: 'absolute',
    top: 60,
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#F27121',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 15,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 15,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 15,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 15,
  },
  scanLine: {
    width: '100%',
    height: 4,
    backgroundColor: '#F27121',
    shadowColor: '#F27121',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 10,
  },
  scanInstructionText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  countdownText: {
    position: 'absolute',
    top: 40,
    fontSize: 100,
    fontWeight: '900',
    color: '#F27121',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  faceHintText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  // FOOTER
  newFooter: {
    paddingHorizontal: 20,
    paddingBottom: 25,
    alignItems: 'center',
  },
  verifyingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#F27121',
  },
  verifyingPillText: {
    color: '#fff',
    marginLeft: 8,
    fontWeight: '700',
  },
  welcomeContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  welcomeValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 8,
  },
  actionTag: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  actionTagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  waitingText: {
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
    fontSize: 14,
  },
  footerButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  syncButton: {
    flex: 0.4,
    height: 60,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  syncBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#F27121',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  syncBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  mainActionButton: {
    flex: 1,
    height: 60,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  mainActionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 25,
    padding: 30,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  modalIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalIcon: { fontSize: 32, fontWeight: '800' },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#1f2a37',
  },
  modalMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 24,
    color: '#5b6674',
  },
  modalHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d1ecf1',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 20,
  },
  modalHintIcon: { color: '#17a2b8', fontWeight: '800', marginRight: 8 },
  modalHint: {
    fontSize: 14,
    color: '#0c5460',
    marginLeft: 8,
    flex: 1,
  },
  modalButton: {
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 12,
    marginTop: 10,
    minWidth: 150,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
