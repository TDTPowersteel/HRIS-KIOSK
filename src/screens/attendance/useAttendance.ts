import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  useFrameProcessor,
  runAsync,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Alert, Animated, Platform, ToastAndroid } from 'react-native';
import { BACKEND_URL } from '../../config/backend';
import { enqueueOfflineAttendance, getOfflineAttendanceQueue } from '../../utils/offlineAttendance';
import { resolveOfflineUserFromQr, upsertOfflineUserCacheUser } from '../../utils/offlineUsers';
import { useTheme } from '../../config/theme';
import { compareEmbeddings, isMatch } from '../../utils/face-embedding';
import type { TfliteModel, TfliteModule } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import { NitroModules } from 'react-native-nitro-modules';
import { Asset } from 'expo-asset';
import type { FaceEngine } from '../settings/features/FaceRecogEngineFeature';
import {
  ATTENDANCE_SESSIONS_KEY,
  TOUCHLESS_SETTING_KEY,
  ResolvedUser,
  StoredAttendanceSession,
  ModalType,
} from './types';


// Worklet-safe nearest-neighbour resize: RGB/RGBA frame → Float32 [1,112,112,3] tensor buffer
function resizeFrameToTensor(buffer: ArrayBuffer, srcW: number, srcH: number): ArrayBuffer {
  'worklet';
  const SIZE = 112;
  const src = new Uint8Array(buffer);
  const bytesPerPx = Math.round(src.length / (srcW * srcH)); // 3=RGB, 4=RGBA
  const dst = new Float32Array(SIZE * SIZE * 3);
  const xr = srcW / SIZE;
  const yr = srcH / SIZE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(Math.floor(x * xr), srcW - 1);
      const sy = Math.min(Math.floor(y * yr), srcH - 1);
      const si = (sy * srcW + sx) * bytesPerPx;
      const di = (y * SIZE + x) * 3;
      dst[di]     = src[si]     / 255.0;
      dst[di + 1] = src[si + 1] / 255.0;
      dst[di + 2] = src[si + 2] / 255.0;
    }
  }
  return dst.buffer;
}

// Module-level singleton — loads TFLite model once via fetch + NitroModules (no GPU delegate = no .outputs error)
let _tfliteModelCache: TfliteModel | null = null;
let _tfliteModelLoading: Promise<TfliteModel | null> | null = null;

async function getOrLoadTfliteModel(): Promise<TfliteModel | null> {
  if (_tfliteModelCache) return _tfliteModelCache;
  if (_tfliteModelLoading) return _tfliteModelLoading;
  _tfliteModelLoading = (async () => {
    try {
      const asset = await Asset.fromModule(
        require('../../../assets/models/mobilefacenet.tflite')
      ).downloadAsync();
      if (!asset.localUri) return null;
      // Read bytes via fetch (bypasses java.net.URL issues in assetLoader)
      const response = await fetch(asset.localUri);
      const buffer = await response.arrayBuffer();
      // Create model directly with CPU — no GPU delegate means no .outputs NativeState error
      const tfliteModule = NitroModules.createHybridObject<TfliteModule>('TfliteModule');
      const model = tfliteModule.createModel(buffer, []);
      _tfliteModelCache = model;
      console.log('[TFLite] Model loaded (CPU)');
      return model;
    } catch (e) {
      _tfliteModelLoading = null;
      console.error('[TFLite] Failed to load model:', e);
      return null;
    }
  })();
  return _tfliteModelLoading;
}


const sanitizeForLog = (obj: any) => {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = { ...obj };
  ['face', 'profile_picture', 'photo', 'photo_liveness'].forEach(key => {
    if (sanitized[key] && typeof sanitized[key] === 'string' && sanitized[key].length > 100) {
      const val = sanitized[key];
      sanitized[key] = `${val.substring(0, 50)}...${val.slice(-10)} [truncated ${val.length} chars]`;
    }
  });
  return sanitized;
};

export function useAttendance() {
  const { colors } = useTheme();
  const NETWORK_TIMEOUT_MS = 2500;
  const NETWORK_TOAST_COOLDOWN_MS = 15000;

  // Camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;
  const cameraRef = useRef<Camera>(null);

  // Refs
  const livenessTriggeredRef = useRef(false);
  const countdownRef = useRef(0);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalContextRef = useRef<'qr_success' | 'face_error' | 'other'>('other');
  const lastScanRef = useRef<{ data: string | null; ts: number }>({ data: null, ts: 0 });
  const touchlessTriggeredRef = useRef(false);
  const qrProcessingRef = useRef(false);
  const faceProcessingRef = useRef(false);
  const modalVisibleRef = useRef(false);
  const previousOfflineStateRef = useRef(false);
  const lastOfflineToastAtRef = useRef(0);
  const identityStatusRef = useRef<'idle' | 'pending' | 'passed' | 'failed'>('idle');
  const livenessStatusRef = useRef<'idle' | 'pending' | 'passed'>('idle');
  const livenessScoreRef = useRef<number | null>(null);

  // Shared Values (moved up to avoid use-before-declaration)
  const workletPhase = useSharedValue(0);
  const blinkState = useSharedValue(0);
  const isProcessingFace = useSharedValue(false);
  const isCapturingHardwareRef = useSharedValue(false);
  const sharedTouchlessEnabled = useSharedValue(false);
  const sharedLivenessEnabled = useSharedValue(true);
  const sharedCountdownValue = useSharedValue(0);

  // State
  const [faceCountdown, setFaceCountdown] = useState(0);

  // Sync state with shared values
  useEffect(() => {
    sharedCountdownValue.value = faceCountdown;
  }, [faceCountdown, sharedCountdownValue]);
  const [countdownActive, setCountdownActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockInTime, setClockInTime] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrSuccessLocal, setQrSuccessLocal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [qrVerified, setQrVerified] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<ResolvedUser | null>(null);
  const [attendanceAction, setAttendanceAction] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const [faceEngine, setFaceEngine] = useState<FaceEngine>('facepp');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);


  // Camera Vision TFLite model — singleton ensures it loads only once (StrictMode-safe)
  const [tfliteModel, setTfliteModel] = useState<TfliteModel | null>(null);
  useEffect(() => {
    let active = true;
    getOrLoadTfliteModel().then(m => { if (active && m) setTfliteModel(m); });
    return () => { active = false; };
  }, []);
  
  const boxedTfliteModel = useMemo(() => {
    return tfliteModel ? NitroModules.box(tfliteModel) : undefined;
  }, [tfliteModel]);

  const captureEmbeddingFlag = useSharedValue(false);
  const embeddingResolveRef = useRef<((emb: number[]) => void) | null>(null);
  const embeddingRejectRef = useRef<((err: Error) => void) | null>(null);

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
    } catch { }
  };

  const showOfflineToast = useCallback(() => {
    const now = Date.now();
    if (now - lastOfflineToastAtRef.current < NETWORK_TOAST_COOLDOWN_MS) return;
    lastOfflineToastAtRef.current = now;
    const message = 'Internet connection not detected. Scanner is now in offline mode.';
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.LONG);
      return;
    }
    Alert.alert('No Internet Connection', message);
  }, []);

  const isLikelyConnectivityError = useCallback((error: any): boolean => {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('network request failed') ||
      message.includes('failed to fetch') ||
      message.includes('timeout') ||
      message.includes('abort') ||
      message.includes('connection')
    );
  }, []);

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
        if (touchlessEnabled) {
          setCountdownActive(true);
        } else {
          setFaceCountdown(0);
          countdownRef.current = 0;
          setCountdownActive(false);
        }
        modalContextRef.current = 'other';
      } else if (modalContextRef.current === 'face_error') {
        workletPhase.value = 0;
        blinkState.value = 0;
        setLivenessMessage('Face the camera directly');
        identityStatusRef.current = 'idle';
        livenessStatusRef.current = 'idle';
        livenessScoreRef.current = null;
        modalContextRef.current = 'other';
      }
    });
  }, [scaleAnim, touchlessEnabled, workletPhase, blinkState]);

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
    } catch { }
  }, []);

  const clearStoredSession = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed?.[userId]) { delete parsed[userId]; await AsyncStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(parsed)); }
    } catch { }
  }, []);

  const resetAttendanceFlow = useCallback(async () => {
    setQrVerified(false);
    setClockInTime('');
    setWelcomeName(null);
    setSelectedUser(null);
    setAttendanceAction('clock_in');
    setFaceCountdown(0);
    countdownRef.current = 0;
    setCountdownActive(false);
    modalContextRef.current = 'other';
    lastScanRef.current = { data: null, ts: 0 };
    touchlessTriggeredRef.current = false;
    qrProcessingRef.current = false;
    faceProcessingRef.current = false;
    identityStatusRef.current = 'idle';
    livenessStatusRef.current = 'idle';

    // Reset liveness state machine
    blinkState.value = 0;
    setLivenessMessage('Face the camera directly');
    workletPhase.value = 0;

    try { await AsyncStorage.multiRemove(['userId', 'username']); } catch { }
  }, []);

  const refreshPendingSyncCount = useCallback(async () => {
    try {
      const queue = await getOfflineAttendanceQueue();
      setPendingSyncCount(queue.filter((item) => item.status === 'pending').length);
    } catch { setPendingSyncCount(0); }
  }, []);

  // QR resolve
  const resolveUserFromQr = useCallback(async (qrData: string): Promise<ResolvedUser> => {
    try {
      // FORCE SYNC: Add timestamp to URL to bypass any server/proxy cache
      const timestamp = Date.now();
      const response = await fetch(`${BACKEND_URL}/resolve_qr.php?qr=${encodeURIComponent(qrData)}&_t=${timestamp}`, {
        headers: { 
          'Accept': 'application/json', 
          'ngrok-skip-browser-warning': 'true',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });
      const responseText = await response.text();
      console.log('[QR] Raw response', response.status, responseText?.slice?.(0, 200));
      let payload: any = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; }
      catch { throw new Error(`Server returned invalid response. Status: ${response.status}`); }
      if (!response.ok) throw new Error(payload?.message || `QR validation failed. Status: ${response.status}`);
      if (!payload?.ok || !payload?.user?.log_id) throw new Error(payload?.message || 'QR not recognized');
      
      const user = {
        userId: String(payload.user.log_id),
        username: String(payload.user.username || ''),
        name: payload.user.name ?? null,
        profile_picture: payload.user.profile_picture ?? null,
        face: payload.user.face ?? null,
        face_embedding: payload.user.face_embedding ?? null,
        role: payload.user.role ?? null,
        department: payload.user.department ?? null,
        open_session: payload.user.open_session ?? null,
      };

      // FORCE SYNC LOCAL CACHE: If server says user is clocked out, we MUST clear local session
      if (!user.open_session) {
        console.log(`[QR] Server says NO open session for ${user.username}. Clearing local cache.`);
        await clearStoredSession(user.userId);
      } else {
        console.log(`[QR] Server says OPEN session found for ${user.username}. Saving to local cache.`);
        await saveStoredSession({
          userId: user.userId,
          username: user.username,
          name: user.name ?? null,
          clockInTime: user.open_session.timein,
          clockInDate: user.open_session.date
        });
      }

      setOfflineModeEnabled(false);
      await upsertOfflineUserCacheUser({
        userId: user.userId,
        username: user.username,
        name: user.name ?? null,
        qrCode: qrData,
        profile_picture: user.profile_picture ?? null,
        role: user.role ?? null,
        department: user.department ?? null,
        face_embedding: user.face_embedding ?? null,
      });
      return user;
    } catch (error) {
      if (!offlineModeEnabled && !isLikelyConnectivityError(error)) throw error;
      setOfflineModeEnabled(true);
      showOfflineToast();
      const cachedUser = await resolveOfflineUserFromQr(qrData);
      if (!cachedUser) throw new Error('Offline mode needs cached QR/user data for this code. Connect online and open Employee Directory or scan once online to cache it.');
      return { userId: cachedUser.userId, username: cachedUser.username, name: cachedUser.name ?? null, profile_picture: cachedUser.profile_picture ?? null, role: cachedUser.role ?? null, department: cachedUser.department ?? null, face_embedding: cachedUser.face_embedding ?? null };
    }
  }, [offlineModeEnabled, isLikelyConnectivityError, showOfflineToast]);

  // Face verify
  const verifyFace = async (photoUri1: string, photoUri2?: string) => {
    let userId = null;
    try { userId = await AsyncStorage.getItem('userId'); } catch { }
    if (!userId) throw new Error('User not logged in (missing userId). Please log in again.');
    console.log('[Verify] Sending face to backend', sanitizeForLog({
      userId,
      isSendingSecondPhoto: !!photoUri2,
      face_reference: selectedUser?.face
    }));
    const form = new FormData();
    form.append('photo', { uri: photoUri1, name: 'selfie_1.jpg', type: 'image/jpeg' } as any);
    if (photoUri2) form.append('photo_liveness', { uri: photoUri2, name: 'selfie_2.jpg', type: 'image/jpeg' } as any);
    form.append('clock_time', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    form.append('user_id', userId);
    
    // Add client-side active liveness score if available
    if (livenessScoreRef.current !== null) {
      form.append('liveness_score', livenessScoreRef.current.toFixed(4));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);
    const response = await fetch(`${BACKEND_URL}/verify.php`, { method: 'POST', body: form, headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }, signal: controller.signal });
    clearTimeout(timeoutId);
    const responseText = await response.text();
    console.log('[Verify] Raw response', response.status, responseText?.slice?.(0, 200));
    let json: any = {};
    try { json = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error(`Server returned invalid response. Status: ${response.status}`); }
    if (response.status === 401 && json.message) {
      if (json.message.includes('Liveness')) {
        console.log('[Verify] Liveness Failure', sanitizeForLog(json));
      } else {
        console.log('[Verify] Identity Mismatch', sanitizeForLog(json));
      }
      if (json.captured_faces_count != null || json.reference_faces_count != null) {
        console.log(`[Verify] Debug Info: Faces detected in Live Capture: ${json.captured_faces_count ?? 0}, Faces detected in Database Reference: ${json.reference_faces_count ?? 0}`);
      }
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
    const photo1 = await cameraRef.current.takePhoto({ 
      flash: 'off',
      enableAutoRedEyeReduction: true,
    });
    if (!photo1?.path) throw new Error('No image captured');

    if (offlineModeEnabled) return { ok: true, verified: true, offlineCaptured: true, message: 'Face photos captured offline.', photoUri: `file://${photo1.path}` };
    return verifyFace(`file://${photo1.path}`);
  }, [offlineModeEnabled]);

  // Worklet → JS callbacks for frame-based embedding capture
  const onEmbeddingCaptured = Worklets.createRunOnJS((embedding: number[]) => {
    embeddingResolveRef.current?.(embedding);
    embeddingResolveRef.current = null;
    embeddingRejectRef.current = null;
  });
  const onEmbeddingFailed = Worklets.createRunOnJS((msg: string) => {
    embeddingRejectRef.current?.(new Error(msg));
    embeddingResolveRef.current = null;
    embeddingRejectRef.current = null;
  });

  // Promise-based: sets a flag the frame processor watches; resolves with the embedding
  const captureEmbeddingFromFrame = useCallback((): Promise<number[]> => {
    return new Promise((resolve, reject) => {
      embeddingResolveRef.current = resolve;
      embeddingRejectRef.current = reject;
      captureEmbeddingFlag.value = true;
      setTimeout(() => {
        if (embeddingResolveRef.current) {
          captureEmbeddingFlag.value = false;
          embeddingResolveRef.current = null;
          embeddingRejectRef.current = null;
          reject(new Error('Face capture timed out. Ensure good lighting and face the camera directly.'));
        }
      }, 5000);
    });
  }, [captureEmbeddingFlag]);

  // Sync comparator — receives the already-captured live embedding from the frame processor
  const verifyFaceLocal = useCallback((liveEmbedding: number[]): { ok: boolean; verified: boolean; message?: string; hint?: string } => {
    const storedEmbeddingStr = selectedUser?.face_embedding;
    if (!storedEmbeddingStr) {
      return { ok: false, verified: false, message: 'No face profile registered for this employee.', hint: 'Ask the employee to register their face in the HRIS mobile app first.' };
    }
    let storedEmbedding: number[];
    try { storedEmbedding = JSON.parse(storedEmbeddingStr); }
    catch { return { ok: false, verified: false, message: 'Face profile data is corrupted.', hint: 'Ask the employee to re-register their face in the HRIS mobile app.' }; }

    const similarity = compareEmbeddings(liveEmbedding, storedEmbedding);
    console.log(`[CameraVision] Cosine similarity: ${(similarity * 100).toFixed(2)}%`);
    if (isMatch(similarity)) return { ok: true, verified: true };
    return { ok: false, verified: false, message: `Face does not match. Similarity: ${(similarity * 100).toFixed(0)}%`, hint: 'Ensure good lighting and face the camera directly.' };
  }, [selectedUser]);

  const recordAttendance = useCallback(async (action: 'clock_in' | 'clock_out', location: { address?: string; latitude?: number; longitude?: number } = {}) => {
    const userId = await AsyncStorage.getItem('userId');
    if (!userId) return;
    console.log('[Attendance] Recording', { userId, action, location });
    const payload = { 
      user_id: userId, 
      action, 
      ...location 
    };
    const res = await fetch(`${BACKEND_URL}/record_attendance.php`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }, 
      body: JSON.stringify(payload) 
    });
    const responseText = await res.text();
    let data: any = {};
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Attendance response invalid. Status: ${res.status}`); }
    if (!res.ok || !data?.ok) throw new Error(data?.message || `Unable to record attendance (${res.status})`);
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
    } catch { }
  }, []);

  const executeAttendanceRecording = useCallback(async () => {
    setIsVerifying(true);
    faceProcessingRef.current = true;
    try {
      const action = attendanceAction;
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      
      // Capture location
      let locationData: { address?: string; latitude?: number; longitude?: number; radius?: number } = {};
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const [addressRes] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          locationData = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            radius: loc.coords.accuracy ?? 0,
            address: addressRes ? `${addressRes.street || ''}, ${addressRes.city || ''}, ${addressRes.region || ''}`.replace(/^, |, $/g, '') : 'Unknown'
          };
        }
      } catch (e) {
        console.log('[Attendance] Could not capture location', e);
      }

      let data: any = null;
      let capturedOffline = offlineModeEnabled;

      if (capturedOffline) {
        await enqueueOfflineAttendance({ 
            userId: selectedUser!.userId, 
            username: selectedUser!.username, 
            name: selectedUser!.name ?? null, 
            action, 
            date: localDate, 
            time: localTime,
            ...locationData
        });
        await refreshPendingSyncCount();
      } else {
        try {
          console.log(`[Attendance] Recording finalized. Identity Passed. Active Liveness Passed (Score: ${livenessScoreRef.current?.toFixed(3) ?? 'N/A'})`);
          data = await recordAttendance(action, locationData);
        } catch (error) {
          if (!isLikelyConnectivityError(error)) throw error;
          capturedOffline = true;
          setOfflineModeEnabled(true);
          showOfflineToast();
          await enqueueOfflineAttendance({ 
              userId: selectedUser!.userId, 
              username: selectedUser!.username, 
              name: selectedUser!.name ?? null, 
              action, 
              date: localDate, 
              time: localTime,
              ...locationData
          });
          await refreshPendingSyncCount();
        }
      }

      if (action === 'clock_in') {
        await storeClockInNotification({ date: data?.date || localDate, timein: data?.timein || localTime });
        await saveStoredSession({ userId: selectedUser!.userId, username: selectedUser!.username, name: selectedUser!.name ?? null, clockInTime: data?.timein || localTime, clockInDate: data?.date || localDate });
        if (!capturedOffline && data?.emp_id != null) await AsyncStorage.setItem('emp_id', String(data.emp_id));
      } else {
        await clearStoredSession(selectedUser!.userId);
      }
      
      await resetAttendanceFlow();
      workletPhase.value = 0; // Reset worklet phase
      showModal('success',
        action === 'clock_in' ? 'Clock In Success' : 'Clock Out Success',
        capturedOffline ? 'Captured and saved offline.' : 'Face verified and recorded.',
        '', 2000);
    } catch (e: any) {
      faceProcessingRef.current = false;
      livenessTriggeredRef.current = false;
      const showOfflineError = offlineModeEnabled || isLikelyConnectivityError(e);
      showModal('error', showOfflineError ? 'Offline Mode Error' : 'Connection Error', e?.message || 'Please try again.', showOfflineError ? 'Connect once to refresh employee QR cache.' : 'Check your internet connection', 2000);
    } finally {
      setIsVerifying(false);
    }
  }, [attendanceAction, clearStoredSession, enqueueOfflineAttendance, isLikelyConnectivityError, offlineModeEnabled, recordAttendance, refreshPendingSyncCount, resetAttendanceFlow, saveStoredSession, selectedUser, showModal, showOfflineToast, storeClockInNotification, workletPhase]);

  // Main attendance handler (Concurrent Phase 1 & 2)
  const handleAttendance = useCallback(async () => {
    if (faceProcessingRef.current || isVerifying) return;
    if (!qrVerified || !selectedUser) {
      showModal('warning', 'Scan QR Code First', 'Please scan your personal QR code before continuing.', 'The user must scan a QR code.');
      return;
    }
    
    // Auto-clockout in touchless mode: skip face verification
    if (attendanceAction === 'clock_out' && touchlessEnabled) {
      faceProcessingRef.current = true;
      setIsVerifying(true);
      await executeAttendanceRecording();
      return;
    }

    if (!hasPermission) { showModal('warning', 'Camera Required', 'Please allow camera access to verify your identity.', ''); return; }

    faceProcessingRef.current = true;
    identityStatusRef.current = 'pending';
    console.log('[Attendance] Starting Concurrent Identity & Liveness Verification', { action: attendanceAction, userId: selectedUser.userId });

    // Visual + audio snap
    playSnapSound();
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    setIsCapturingHardware(true);
    setLivenessMessage('Capturing...');
    await new Promise(resolve => setTimeout(resolve, 50));

    let result: any;
    try {
      if (faceEngine === 'camera_vision' && !offlineModeEnabled) {
        // Camera Vision: capture embedding directly from the live frame (no photo file needed)
        const liveEmbedding = await captureEmbeddingFromFrame();
        setIsCapturingHardware(false);
        result = verifyFaceLocal(liveEmbedding);
      } else {
        // Face++ or offline: take a photo then verify
        if (!cameraRef.current) throw new Error('Camera not ready');
        const photo1 = await cameraRef.current.takePhoto({ flash: 'off', enableAutoRedEyeReduction: true });
        setIsCapturingHardware(false);
        if (!photo1?.path) throw new Error('No image captured');
        const photoUri = `file://${photo1.path}`;
        result = offlineModeEnabled
          ? { ok: true, verified: true, offlineCaptured: true, message: 'Face photos captured offline.', photoUri }
          : await verifyFace(photoUri);
      }
    } catch (e: any) {
      setIsCapturingHardware(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      identityStatusRef.current = 'failed';
      modalContextRef.current = 'face_error';
      showModal('error', 'Camera Error', e?.message || 'Failed to capture photo', '', 2000);
      return;
    }

    if (livenessEnabled) {
      livenessStatusRef.current = 'pending';
      workletPhase.value = 2;
      setLivenessMessage('Verifying Identity...\nPlease Blink or Smile');
    } else {
      setIsVerifying(true);
    }

    try {
      if (result?.match_score != null) console.log(`[Verify] Identity Match Accuracy: ${(result.match_score * 100).toFixed(2)}%`);

      if (result?.ok === true) {
        identityStatusRef.current = 'passed';
        if (!livenessEnabled || livenessStatusRef.current === 'passed') {
          await executeAttendanceRecording();
        } else {
          setLivenessMessage('Identity Match!\nWaiting for Blink or Smile...');
        }
      } else if (result?.verified === false) {
        identityStatusRef.current = 'failed';
        workletPhase.value = 3;
        setIsVerifying(false);
        faceProcessingRef.current = false; // reset so touchless can auto-retry
        modalContextRef.current = 'face_error';
        showModal('error', 'Verification Failed', result?.message || 'Face verification failed.', result?.hint || 'Please try again.', 2000);
      } else {
        identityStatusRef.current = 'failed';
        workletPhase.value = 3;
        setIsVerifying(false);
        faceProcessingRef.current = false; // reset so touchless can auto-retry
        modalContextRef.current = 'face_error';
        showModal('error', 'Verification Failed', 'Please try again.', '', 2000);
      }
    } catch (e: any) {
      identityStatusRef.current = 'failed';
      workletPhase.value = 3;
      setIsVerifying(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      modalContextRef.current = 'face_error';
      const showOfflineError = offlineModeEnabled || isLikelyConnectivityError(e);
      showModal('error', showOfflineError ? 'Offline Mode Error' : 'Connection Error', e?.message || 'Please try again.', showOfflineError ? 'Connect once to refresh employee QR cache.' : 'Check your internet connection', 2000);
    }
  }, [attendanceAction, touchlessEnabled, hasPermission, isLikelyConnectivityError, livenessEnabled, offlineModeEnabled, qrVerified, selectedUser, showModal, workletPhase, executeAttendanceRecording, verifyFace, verifyFaceLocal, faceEngine, flashAnim, captureEmbeddingFromFrame]);

  const onFaceDetectedForIdentity = Worklets.createRunOnJS(() => {
    if (!touchlessEnabled || modalVisibleRef.current || !qrVerified || attendanceAction !== 'clock_in' || countdownRef.current > 0 || faceProcessingRef.current || isVerifying) return;
    console.log('[Face] Face detected! Triggering Identity Capture...');
    handleAttendance();
  });

  const onActiveLivenessPassed = Worklets.createRunOnJS((score: number) => {
    if (livenessStatusRef.current === 'passed' || modalVisibleRef.current || !qrVerified) return;
    console.log(`[Liveness] ✅ Active Liveness (Physical Blink/Smile) Verified! Accuracy Score: ${score.toFixed(3)}`);
    livenessStatusRef.current = 'passed';
    livenessScoreRef.current = score;

    if (identityStatusRef.current === 'passed') {
      executeAttendanceRecording();
    } else if (identityStatusRef.current === 'pending') {
      setLivenessMessage(`Liveness passed (${(score * 100).toFixed(0)}%)\nWaiting for verification...`);
      setIsVerifying(true);
    }
  });

  const [livenessMessage, setLivenessMessage] = useState('Face the camera directly');
  
  const updateLivenessMessage = Worklets.createRunOnJS((msg: string) => {
    setLivenessMessage((prev) => {
      if (prev !== msg) return msg;
      return prev;
    });
  });

  const [uiCapturingHardware, setUiCapturingHardware] = useState(false);
  const setIsCapturingHardware = (val: boolean) => {
    setUiCapturingHardware(val);
    isCapturingHardwareRef.value = val;
  };
  const updateUiCapturingHardware = Worklets.createRunOnJS((isCapturing: boolean) => {
    setUiCapturingHardware(isCapturing);
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    // 1. Check for manual embedding capture FIRST, bypassing other pauses
    if (captureEmbeddingFlag.value && boxedTfliteModel && !isProcessingFace.value) {
      isProcessingFace.value = true;
      runAsync(frame, () => {
        'worklet';
        try {
          captureEmbeddingFlag.value = false;
          try {
            const actualModel = boxedTfliteModel.unbox();
            const buffer = frame.toArrayBuffer();
            const tensor = resizeFrameToTensor(buffer, frame.width, frame.height);
            const output = actualModel.runSync([tensor]);
            const raw = new Float32Array(output[0]);
            let norm = 0;
            for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
            norm = Math.sqrt(norm);
            const normalized: number[] = [];
            for (let i = 0; i < raw.length; i++) normalized.push(norm > 0 ? raw[i] / norm : raw[i]);
            onEmbeddingCaptured(normalized);
          } catch (embErr: any) {
            onEmbeddingFailed(embErr?.message || 'Frame embedding failed');
          }
        } finally {
          isProcessingFace.value = false;
        }
      });
      return;
    }

    if (isProcessingFace.value || workletPhase.value === 1 || workletPhase.value === 3 || isCapturingHardwareRef.value) return;
    
    // Auto-capture logic move to worklet thread for higher precision
    if (workletPhase.value === 0) {
      if (!sharedTouchlessEnabled.value || sharedCountdownValue.value > 0) return;
    }

    isProcessingFace.value = true;
    runAsync(frame, () => {
      'worklet';
      try {
        const faces = detectFaces(frame);
        if (faces.length > 0) {
          const face = faces[0];
          const leftOpenProb = face.leftEyeOpenProbability ?? 1;
          const rightOpenProb = face.rightEyeOpenProbability ?? 1;
          const smileProb = face.smilingProbability ?? 0;
          
          const isEyesOpen = leftOpenProb > 0.4 && rightOpenProb > 0.4; // Relaxed for Phase 1
          const isEyesClosed = leftOpenProb < 0.2 && rightOpenProb < 0.2;
          const isSmiling = smileProb > 0.7;
          const isNotSmiling = smileProb < 0.3;

          if (workletPhase.value === 0) {
            // PHASE 1: Trigger Identity Capture when face is fully visible
            if (isEyesOpen) {
              onFaceDetectedForIdentity();
            }
          } else if (workletPhase.value === 2) {
            // PHASE 2: Active Liveness (Blink or Smile)
            if (blinkState.value === 0 && isEyesOpen) {
              if (isNotSmiling) {
                blinkState.value = 1; 
                updateLivenessMessage('Please Blink or Smile to verify');
              } else {
                // If they are already smiling when they walk up, they MUST blink to prove a physical action
                blinkState.value = 10;
                updateLivenessMessage('Please Blink to verify');
              }
            } else if (blinkState.value === 1) {
              if (isEyesClosed) {
                blinkState.value = 2; // Blink started
                updateLivenessMessage('Open your eyes');
              } else if (isSmiling) {
                blinkState.value = 3; // Genuine new smile detected
                updateLivenessMessage('Verified!');
                onActiveLivenessPassed(smileProb);
              }
            } else if (blinkState.value === 10) {
              if (isEyesClosed) {
                blinkState.value = 2; // Blink started
                updateLivenessMessage('Open your eyes');
              } else if (isNotSmiling) {
                // They stopped smiling, reset baseline to 1 so they can now smile or blink
                blinkState.value = 1;
                updateLivenessMessage('Please Blink or Smile to verify');
              }
            } else if (blinkState.value === 2) {
              if (isEyesOpen) {
                blinkState.value = 3; // Blink completed
                updateLivenessMessage('Verified!');
                // For a blink, "accuracy" is how deep the blink was (lowest eye prob seen)
                // Since we're here, we already passed the threshold. We'll send a high confidence score.
                const blinkDepth = 1 - Math.min(leftOpenProb, rightOpenProb);
                onActiveLivenessPassed(blinkDepth);
              }
            }
          }
        } else {
          // Reset if face is lost
          if (workletPhase.value === 2 && blinkState.value !== 0 && blinkState.value !== 3) {
            blinkState.value = 0;
            updateLivenessMessage('Face the camera directly');
          }
        }
      } finally {
        isProcessingFace.value = false;
      }
    });
  }, [detectFaces, sharedTouchlessEnabled, sharedCountdownValue, onFaceDetectedForIdentity, onActiveLivenessPassed, updateLivenessMessage, isCapturingHardwareRef, workletPhase, blinkState, isProcessingFace, tfliteModel, captureEmbeddingFlag, onEmbeddingCaptured, onEmbeddingFailed]);

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
      
      // 1. FAST PATH: Check Local Cache for instant UI transition
      let cachedUser = null;
      try {
        cachedUser = await resolveOfflineUserFromQr(data);
      } catch (e) {
        console.log('[QR] Cache lookup error', e);
      }

      if (cachedUser) {
        console.log('[QR] Loaded from local cache -> Instant UI transition for:', cachedUser.username);
        const localSession = await getStoredSession(cachedUser.userId);
        
        await AsyncStorage.setItem('userId', cachedUser.userId);
        await AsyncStorage.setItem('username', cachedUser.username);
        setSelectedUser(cachedUser as ResolvedUser);
        setWelcomeName(cachedUser.name || cachedUser.username || 'Employee');
        setClockInTime(localSession?.clockInTime || '');
        setAttendanceAction(localSession ? 'clock_out' : 'clock_in');
        
        setQrSuccessLocal(true);
        setIsQrLoading(false);

        // Show the success checkmark for 600ms before transitioning
        setTimeout(async () => {
          setQrSuccessLocal(false);
          setQrVerified(true);
          
          const isClockOut = localSession ? true : false;
          
          // Automatic clock-out if touchless is enabled
          if (isClockOut && touchlessEnabled) {
             setAttendanceAction('clock_out');
             await handleAttendance();
          } else {
             const initialCountdown = livenessEnabled ? 2 : 0;
             setFaceCountdown(initialCountdown);
             countdownRef.current = initialCountdown;
             livenessTriggeredRef.current = false;
             touchlessTriggeredRef.current = false;
             if (touchlessEnabled) {
               setCountdownActive(true);
             } else {
               setCountdownActive(false);
             }
          }
        }, 600);

        // Background server sync to correct session state if needed
        resolveUserFromQr(data).then(async (resolved) => {
           let existingSession = null;
           if (!offlineModeEnabled && resolved.open_session) {
             existingSession = {
               clockInTime: resolved.open_session.timein,
               clockInDate: resolved.open_session.date,
             };
           } else {
             existingSession = await getStoredSession(resolved.userId);
           }
           console.log('[QR] Background sync complete. Updated session state for:', resolved.username);
           setClockInTime(existingSession?.clockInTime || '');
           setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');
        }).catch(e => console.log('[QR] Background sync failed (Safe to ignore if offline)', e));

        return; // Exit early so we don't block the UI thread!
      }

      // 2. SERVER PATH: If not in cache, fetch and await normally
      console.log('[QR] Not in local cache, fetching from server...');
      const resolved = await resolveUserFromQr(data);
      
      // Determine session state: Server-first (if online), Local fallback (if offline)
      let existingSession = null;
      if (!offlineModeEnabled && resolved.open_session) {
        existingSession = {
          clockInTime: resolved.open_session.timein,
          clockInDate: resolved.open_session.date,
        };
      } else {
        existingSession = await getStoredSession(resolved.userId);
      }

      console.log('[QR] Resolved user from server', sanitizeForLog(resolved));
      await AsyncStorage.setItem('userId', resolved.userId);
      await AsyncStorage.setItem('username', resolved.username);
      setSelectedUser(resolved);
      setWelcomeName(resolved.name || resolved.username || 'Employee');
      setClockInTime(existingSession?.clockInTime || '');
      setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');
      
      setQrSuccessLocal(true);
      setIsQrLoading(false);
      
      setTimeout(() => {
        setQrSuccessLocal(false);
        setQrVerified(true);
        const initialCountdown = livenessEnabled ? 2 : 0;
        setFaceCountdown(initialCountdown);
        countdownRef.current = initialCountdown;
        livenessTriggeredRef.current = false;
        touchlessTriggeredRef.current = false;
        if (touchlessEnabled) {
          setCountdownActive(true);
        } else {
          setCountdownActive(false);
        }
      }, 800);
    } catch (e: any) {
      console.log('[QR] Validation error', e?.message || e);
      setQrVerified(false);
      qrProcessingRef.current = false;
      setSelectedUser(null);
      showModal('error', 'QR Validation Error', e?.message || 'Could not validate QR code.', '', 2000);
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
      } catch { }
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
    AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, 'settings_liveness_enabled', 'settings_face_engine']).then((entries) => {
      if (active) {
        const mapped = Object.fromEntries(entries);
        const touchless = mapped[TOUCHLESS_SETTING_KEY] === 'true';
        const liveness = mapped['settings_liveness_enabled'] !== 'false';
        setTouchlessEnabled(touchless);
        setLivenessEnabled(liveness);
        setFaceEngine((mapped['settings_face_engine'] as FaceEngine) || 'facepp');
        sharedTouchlessEnabled.value = touchless;
        sharedLivenessEnabled.value = liveness;
      }
    }).catch(() => { });
    return () => { active = false; };
  }, [sharedTouchlessEnabled, sharedLivenessEnabled]);

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { refreshPendingSyncCount(); }, [refreshPendingSyncCount]);
  useEffect(() => {
    if (offlineModeEnabled && !previousOfflineStateRef.current) {
      showOfflineToast();
    }
    previousOfflineStateRef.current = offlineModeEnabled;
  }, [offlineModeEnabled, showOfflineToast]);

  useEffect(() => {
    if (!qrVerified || !touchlessEnabled || isVerifying || touchlessTriggeredRef.current) return;
    if (attendanceAction !== 'clock_out') return;
    touchlessTriggeredRef.current = true;
    const timer = setTimeout(() => handleAttendance(), 200);
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
    isLoading, isVerifying, isQrLoading, isClockingOut, isCapturingHardware: uiCapturingHardware,
    qrVerified, qrSuccessLocal, selectedUser, clockInTime: displayClockInTime, faceCountdown,
    touchlessEnabled, offlineModeEnabled, livenessEnabled, faceEngine, pendingSyncCount,
    showResultModal, modalType, modalTitle, modalMessage, modalHint, livenessMessage,
    closeModal, handleAttendance,
  };
}
