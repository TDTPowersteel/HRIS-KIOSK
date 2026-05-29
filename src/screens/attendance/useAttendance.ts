import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as jpeg from 'jpeg-js';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner, useFrameProcessor, useCameraFormat } from 'react-native-vision-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Platform, ToastAndroid, useWindowDimensions } from 'react-native';
import { BACKEND_URL } from '../../config/backend';
import { enqueueOfflineAttendance, getOfflineAttendanceQueue } from '../../utils/offlineAttendance';
import { resolveOfflineUserFromQr, upsertOfflineUserCacheUser } from '../../utils/offlineUsers';
import { useTheme } from '../../config/theme';
import { compareEmbeddings, compareMultiAngleEmbeddings, isMatch, MODEL_CONFIG } from '../../utils/face-embedding';
import { loadFaceModel, getEmbedding, isModelLoaded } from '../../faceEngine/model';
import { rgbaBufferToCHWTensor } from '../../faceEngine/preprocess';
import type { FaceEngine } from '../settings/features/FaceRecogEngineFeature';
import {
  ATTENDANCE_SESSIONS_KEY,
  TOUCHLESS_SETTING_KEY,
  ResolvedUser,
  StoredAttendanceSession,
  ModalType,
  FaceScanStage,
  CameraVisionEyeStatus,
  CameraVisionFaceTelemetry,
} from './types';






type NormalizedFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type UiFaceBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  frameWidth?: number;
  frameHeight?: number;
};

type FaceSelection = {
  box: NormalizedFaceBox;
  confidence: number | null;
  sourceFace: any;
};

function extractNormalizedFaceBox(face: any, frameWidth: number, frameHeight: number): NormalizedFaceBox | null {
  'worklet';
  if (!face) return null;
  const rawBounds = face.bounds ?? face.boundaries ?? face.frame ?? face.boundingBox ?? face.box ?? face.rect ?? null;
  if (!rawBounds) return null;

  const bx = rawBounds.x ?? rawBounds.left ?? rawBounds.origin?.x;
  const by = rawBounds.y ?? rawBounds.top ?? rawBounds.origin?.y;
  const bw = rawBounds.width ?? rawBounds.w ?? rawBounds.size?.width;
  const bh = rawBounds.height ?? rawBounds.h ?? rawBounds.size?.height;
  if (bx == null || by == null || bw == null || bh == null) return null;
  if (frameWidth <= 0 || frameHeight <= 0) return null;

  const toNumber = (value: unknown): number => {
    'worklet';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
    return Number.NaN;
  };
  const xVal = toNumber(bx);
  const yVal = toNumber(by);
  const wVal = toNumber(bw);
  const hVal = toNumber(bh);
  if (!Number.isFinite(xVal) || !Number.isFinite(yVal) || !Number.isFinite(wVal) || !Number.isFinite(hVal)) return null;

  // Some detectors return normalized [0..1], others return pixel coordinates.
  const looksNormalized = xVal >= -0.5 && yVal >= -0.5 && wVal > 0 && hVal > 0 && xVal <= 1.5 && yVal <= 1.5 && wVal <= 1.5 && hVal <= 1.5;
  const nx = looksNormalized ? xVal : xVal / frameWidth;
  const ny = looksNormalized ? yVal : yVal / frameHeight;
  const nw = looksNormalized ? wVal : wVal / frameWidth;
  const nh = looksNormalized ? hVal : hVal / frameHeight;

  const clampedX = Math.max(0, Math.min(1, nx));
  const clampedY = Math.max(0, Math.min(1, ny));
  const clampedW = Math.max(0.04, Math.min(1 - clampedX, nw));
  const clampedH = Math.max(0.04, Math.min(1 - clampedY, nh));
  if (clampedW <= 0 || clampedH <= 0) return null;
  return { x: clampedX, y: clampedY, width: clampedW, height: clampedH };
}

function isFaceBoxDetected(faceBox: NormalizedFaceBox): boolean {
  'worklet';
  if (faceBox.width < 0.04 || faceBox.height < 0.04) return false;
  if (faceBox.width > 0.98 || faceBox.height > 0.98) return false;
  if (faceBox.x + faceBox.width < 0.02 || faceBox.y + faceBox.height < 0.02) return false;
  if (faceBox.x > 0.98 || faceBox.y > 0.98) return false;
  return true;
}

function selectBestDetectedFace(faces: any[], frameWidth: number, frameHeight: number): FaceSelection | null {
  'worklet';
  let best: { box: NormalizedFaceBox; confidence: number | null; score: number; sourceFace: any } | null = null;
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const box = extractNormalizedFaceBox(face, frameWidth, frameHeight);
    if (!box || !isFaceBoxDetected(box)) continue;
    const rawConfidence =
      face?.faceProbability ??
      face?.probability ??
      face?.confidence ??
      face?.score ??
      face?.trackingConfidence;
    const confidence = typeof rawConfidence === 'number' && !Number.isNaN(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : null;
    const aspectRatio = box.width / Math.max(0.001, box.height);
    if (aspectRatio < 0.5 || aspectRatio > 1.8) continue;

    const landmarks = face?.landmarks;
    const landmarkCount = landmarks && typeof landmarks === 'object' ? Object.keys(landmarks).length : 0;
    const leftEyeProb = face?.leftEyeOpenProbability;
    const rightEyeProb = face?.rightEyeOpenProbability;
    const hasEyeProbabilities =
      typeof leftEyeProb === 'number' &&
      typeof rightEyeProb === 'number' &&
      leftEyeProb >= 0 &&
      leftEyeProb <= 1 &&
      rightEyeProb >= 0 &&
      rightEyeProb <= 1;

    const yaw = face?.yawAngle;
    const roll = face?.rollAngle;
    const hasPlausiblePose =
      typeof yaw === 'number' &&
      typeof roll === 'number' &&
      Math.abs(yaw) <= 35 &&
      Math.abs(roll) <= 35;

    if (confidence != null && confidence < 0.62) continue;
    if (confidence == null && landmarkCount < 3 && !hasEyeProbabilities && !hasPlausiblePose) continue;

    const areaScore = box.width * box.height;
    const confidenceScore = confidence ?? 0.5;
    const landmarkScore = Math.min(1, landmarkCount / 6);
    const score = areaScore + confidenceScore * 0.12 + landmarkScore * 0.08;
    if (!best || score > best.score) best = { box, confidence, score, sourceFace: face };
  }
  if (!best) return null;
  return { box: best.box, confidence: best.confidence, sourceFace: best.sourceFace };
}

function isFaceBoxUsableForRecognition(faceBox: NormalizedFaceBox, face?: any): boolean {
  'worklet';
  const area = faceBox.width * faceBox.height;
  const centerX = faceBox.x + faceBox.width / 2;
  const centerY = faceBox.y + faceBox.height / 2;

  // Basic size and position
  if (faceBox.width < 0.12 || faceBox.height < 0.16) return false;
  if (area < 0.022) return false;
  if (faceBox.x < 0.005 || faceBox.y < 0.005) return false;
  if (faceBox.x + faceBox.width > 0.995 || faceBox.y + faceBox.height > 0.995) return false;
  if (centerX < 0.14 || centerX > 0.86 || centerY < 0.14 || centerY > 0.86) return false;

  // Frontal gate (Pose check - tightened from 18 to 14 to avoid bad verification angles)
  if (face) {
    const yaw = face?.yawAngle ?? 0;
    const pitch = face?.pitchAngle ?? 0;
    const roll = face?.rollAngle ?? 0;
    if (Math.abs(yaw) > 14 || Math.abs(pitch) > 14 || Math.abs(roll) > 14) return false;
  }

  return true;
}

function selectBestRecognitionFace(faces: any[], frameWidth: number, frameHeight: number): FaceSelection | null {
  'worklet';
  const detectedFace = selectBestDetectedFace(faces, frameWidth, frameHeight);
  if (!detectedFace) return null;
  if (isFaceBoxUsableForRecognition(detectedFace.box, detectedFace.sourceFace)) return detectedFace;

  // Fallback to detected face if quality gate is too strict on specific devices.
  // Embedding validation + matching threshold still protect against false positives.
  return detectedFace;
}

function extractFaceTelemetry(face: any): CameraVisionFaceTelemetry | null {
  'worklet';
  if (!face) return null;
  const toFiniteNumber = (value: unknown): number | null => {
    'worklet';
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const yaw = toFiniteNumber(face?.yawAngle ?? face?.eulerY ?? face?.headEulerAngleY);
  const pitch = toFiniteNumber(face?.pitchAngle ?? face?.eulerX ?? face?.headEulerAngleX);
  const roll = toFiniteNumber(face?.rollAngle ?? face?.eulerZ ?? face?.headEulerAngleZ);
  const leftEyeOpenProbability = toFiniteNumber(
    face?.leftEyeOpenProbability ?? face?.leftEyeOpenProb ?? face?.leftEyeProbability,
  );
  const rightEyeOpenProbability = toFiniteNumber(
    face?.rightEyeOpenProbability ?? face?.rightEyeOpenProb ?? face?.rightEyeProbability,
  );

  let eyeStatus: CameraVisionEyeStatus = 'unknown';
  if (leftEyeOpenProbability != null && rightEyeOpenProbability != null) {
    const isLeftOpen = leftEyeOpenProbability >= 0.5;
    const isRightOpen = rightEyeOpenProbability >= 0.5;
    if (isLeftOpen && isRightOpen) eyeStatus = 'open';
    else if (!isLeftOpen && !isRightOpen) eyeStatus = 'closed';
    else eyeStatus = 'mixed';
  }

  return {
    yaw,
    pitch,
    roll,
    leftEyeOpenProbability,
    rightEyeOpenProbability,
    eyeStatus,
  };
}

function isValidEmbeddingVector(embedding: number[]): boolean {
  if (!Array.isArray(embedding) || embedding.length < 64) return false;
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    const value = embedding[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    norm += value * value;
  }
  return norm > 0.5;
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
  const FACEPP_TOUCHLESS_COUNTDOWN_SECONDS = 3;
  const CAMERA_VISION_STABLE_FACE_FRAMES = 3;
  const CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY = 90;
  const CAMERA_VISION_MANUAL_MIN_READINESS_TO_VERIFY = 30;
  const CAMERA_VISION_GATE_LOG_COOLDOWN_MS = 2000;

  // Camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;
  const cameraFormat = useCameraFormat(device, [
    { photoResolution: 'max' },
    { videoResolution: 'max' }
  ]);
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
  const faceppCountdownStartedRef = useRef(false);
  const cameraVisionAutoTriggeredRef = useRef(false);
  const touchlessEnabledRef = useRef(false);
  const faceEngineRef = useRef<FaceEngine>('facepp');
  const lastCameraVisionGateLogRef = useRef(0);

  // Shared Values (moved up to avoid use-before-declaration)
  const workletPhase = useSharedValue(0);
  const blinkState = useSharedValue(0);
  const isProcessingFace = useSharedValue(false);
  const isCapturingHardwareRef = useSharedValue(false);
  const sharedTouchlessEnabled = useSharedValue(false);
  const sharedLivenessEnabled = useSharedValue(true);
  const sharedFaceEngineIsCameraVision = useSharedValue(false);
  const stableFaceFrames = useSharedValue(0);
  const lastCameraVisionReadinessSent = useSharedValue(-1);
  const lastCameraVisionDetectedSent = useSharedValue(false);
  const frameCounter = useSharedValue(0);
  const lastFaceProcessedFrame = useSharedValue(0);
  // Last tracked face box from continuous detection — reused during capture to avoid calling detectFaces twice
  const lastTrackedFaceX = useSharedValue(0);
  const lastTrackedFaceY = useSharedValue(0);
  const lastTrackedFaceW = useSharedValue(0);
  const lastTrackedFaceH = useSharedValue(0);
  const hasTrackedFace = useSharedValue(false);

  // State
  const [hasLocationPermission, setHasLocationPermission] = useState(false);

  const requestLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(status === 'granted');
      return status === 'granted';
    } catch {
      setHasLocationPermission(false);
      return false;
    }
  }, []);

  const [faceCountdown, setFaceCountdown] = useState(0);
  const [countdownActive, setCountdownActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockInTime, setClockInTime] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrSuccessLocal, setQrSuccessLocal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [qrVerified, setQrVerified] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const [selectedUser, _setSelectedUser] = useState<ResolvedUser | null>(null);
  const selectedUserRef = useRef<ResolvedUser | null>(null);
  const setSelectedUser = useCallback((u: ResolvedUser | null) => {
    selectedUserRef.current = u;
    _setSelectedUser(u);
  }, []);
  const [attendanceAction, setAttendanceAction] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [touchlessEnabled, setTouchlessEnabled] = useState(false);
  const [offlineModeEnabled, setOfflineModeEnabled] = useState(false);
  const [livenessEnabled, setLivenessEnabled] = useState(true);
  const [faceEngine, setFaceEngine] = useState<FaceEngine>('facepp');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [scanStage, setScanStage] = useState<FaceScanStage>('idle');
  const [cameraVisionFaceDetected, setCameraVisionFaceDetected] = useState(false);
  const [cameraVisionReadiness, setCameraVisionReadiness] = useState(0);
  const [cameraVisionFaceBox, setCameraVisionFaceBox] = useState<UiFaceBox | null>(null);
  const [cameraVisionAllFaces, setCameraVisionAllFaces] = useState<Array<{ id: string; left: number; top: number; width: number; height: number; isTarget: boolean; frameWidth?: number; frameHeight?: number }>>([]);
  const [cameraVisionFaceTelemetry, setCameraVisionFaceTelemetry] = useState<CameraVisionFaceTelemetry | null>(null);
  const [successAnimationTick, setSuccessAnimationTick] = useState(0);


  // buffalo_sc ONNX model — loads once at startup
  const [onnxModelReady, setOnnxModelReady] = useState(false);
  useEffect(() => {
    let active = true;
    loadFaceModel()
      .then(() => { if (active) setOnnxModelReady(true); })
      .catch(e => console.error('[FaceEngine] Failed to load ONNX model:', e));
    return () => { active = false; };
  }, []);
  

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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { detectFaces, stopListeners } = useFaceDetector({
    cameraFacing: frontDevice ? 'front' : 'back',
    classificationMode: 'all',
    performanceMode: 'fast',
    landmarkMode: 'all',
    trackingEnabled: true,
    minFaceSize: 0.08,
  });

  useEffect(() => {
    return () => {
      stopListeners();
    };
  }, [stopListeners]);

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
        setFaceCountdown(0);
        countdownRef.current = 0;
        setCountdownActive(false);
        faceppCountdownStartedRef.current = false;
        cameraVisionAutoTriggeredRef.current = false;
        stableFaceFrames.value = 0;
        setCameraVisionFaceDetected(false);
        setCameraVisionReadiness(0);
        setCameraVisionFaceBox(null);
        setCameraVisionAllFaces([]);
        setCameraVisionFaceTelemetry(null);
        setScanStage('idle');
        modalContextRef.current = 'other';
      } else if (modalContextRef.current === 'face_error') {
        workletPhase.value = 0;
        blinkState.value = 0;
        setLivenessMessage('Face the camera directly');
        setFaceCountdown(0);
        countdownRef.current = 0;
        setCountdownActive(false);
        faceppCountdownStartedRef.current = false;
        cameraVisionAutoTriggeredRef.current = false;
        stableFaceFrames.value = 0;
        setCameraVisionFaceDetected(false);
        setCameraVisionReadiness(0);
        setCameraVisionFaceBox(null);
        setCameraVisionAllFaces([]);
        setCameraVisionFaceTelemetry(null);
        identityStatusRef.current = 'idle';
        livenessStatusRef.current = 'idle';
        livenessScoreRef.current = null;
        if (
          touchlessEnabledRef.current &&
          faceEngineRef.current === 'camera_vision' &&
          attendanceAction === 'clock_in' &&
          qrVerified
        ) {
          setScanStage('detecting');
        } else {
          setScanStage('idle');
        }
        modalContextRef.current = 'other';
      }
    });
  }, [scaleAnim, workletPhase, blinkState, stableFaceFrames, attendanceAction, qrVerified]);

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
    faceppCountdownStartedRef.current = false;
    cameraVisionAutoTriggeredRef.current = false;
    stableFaceFrames.value = 0;
    setCameraVisionFaceDetected(false);
    setCameraVisionReadiness(0);
    setCameraVisionFaceBox(null);
    setCameraVisionAllFaces([]);
    setCameraVisionFaceTelemetry(null);
    setScanStage('idle');
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

  const applyScannerSettings = useCallback(async () => {
    const entries = await AsyncStorage.multiGet([TOUCHLESS_SETTING_KEY, 'settings_liveness_enabled', 'settings_face_engine']);
    const mapped = Object.fromEntries(entries);
    const touchless = mapped[TOUCHLESS_SETTING_KEY] === 'true';
    const liveness = mapped['settings_liveness_enabled'] !== 'false';
    const engine: FaceEngine = mapped['settings_face_engine'] === 'camera_vision' ? 'camera_vision' : 'facepp';
    touchlessEnabledRef.current = touchless;
    faceEngineRef.current = engine;
    setTouchlessEnabled(touchless);
    setLivenessEnabled(liveness);
    setFaceEngine(engine);
    sharedTouchlessEnabled.value = touchless;
    sharedLivenessEnabled.value = liveness;
    sharedFaceEngineIsCameraVision.value = engine === 'camera_vision';
    return { touchless, liveness, engine };
  }, [sharedTouchlessEnabled, sharedLivenessEnabled, sharedFaceEngineIsCameraVision]);

  // QR resolve
  const resolveUserFromQr = useCallback(async (qrData: string): Promise<ResolvedUser> => {
    try {
      // FORCE SYNC: Add timestamp to URL to bypass any server/proxy cache
      const timestamp = Date.now();
      const currentEngine = faceEngineRef.current;
      const response = await fetch(`${BACKEND_URL}/resolve_qr.php?qr=${encodeURIComponent(qrData)}&engine=${currentEngine}&_t=${timestamp}`, {
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

      try {
        const cachedUser = await resolveOfflineUserFromQr(qrData);
        if (cachedUser && cachedUser.profile_picture?.startsWith('file://') && cachedUser.profile_picture_remote === user.profile_picture) {
          user.profile_picture = cachedUser.profile_picture;
        }
      } catch {}

      console.log(`[QR] Resolve details for ${user.username}:`, {
        log_id: user.userId,
        has_face: !!user.face,
        embedding_type: typeof user.face_embedding,
        embedding_val: user.face_embedding ? (typeof user.face_embedding === 'string' ? user.face_embedding.substring(0, 50) + '...' : 'object/array') : 'NULL'
      });

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
        empId: user.userId,
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
      face_reference: selectedUserRef.current?.face
    }));
    const form = new FormData();
    form.append('photo', { uri: photoUri1, name: 'selfie_1.jpg', type: 'image/jpeg' } as any);
    if (photoUri2) form.append('photo_liveness', { uri: photoUri2, name: 'selfie_2.jpg', type: 'image/jpeg' } as any);
    form.append('clock_time', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    form.append('user_id', userId);
    form.append('engine', faceEngineRef.current);
    
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


  // Photo-based embedding capture: takes a photo, decodes JPEG, runs buffalo_sc ONNX inference.
  const captureEmbeddingFromPhoto = useCallback(async (): Promise<number[]> => {
    if (!cameraRef.current) throw new Error('Camera not ready');
    if (!isModelLoaded()) throw new Error('Face model not loaded');

    console.log('[CameraVision] Taking photo for embedding (buffalo_sc ONNX)...');
    const photo = await cameraRef.current.takePhoto({ flash: 'off' });
    if (!photo?.path) throw new Error('No image captured');

    const faceBox = cameraVisionFaceBox;
    console.log(`[CameraVision] Photo raw: ${photo.width}x${photo.height}, Face box: ${faceBox ? `x=${faceBox.left.toFixed(3)} y=${faceBox.top.toFixed(3)} w=${faceBox.width.toFixed(3)} h=${faceBox.height.toFixed(3)}` : 'full frame'}`);

    let imageToProcess = `file://${photo.path}`;

    if (faceBox) {
      const photoW = photo.width;
      const photoH = photo.height;
      
      // Determine if the frame is rotated relative to the physical photo
      const frameW = faceBox.frameWidth || (photoW > photoH ? 1280 : 720);
      const frameH = faceBox.frameHeight || (photoW > photoH ? 720 : 1280);
      
      const isFrameLandscape = frameW > frameH;
      const isPhotoLandscape = photoW > photoH;
      const isRotated = isFrameLandscape !== isPhotoLandscape;

      const orientedFrameWidth = isRotated ? frameH : frameW;
      const orientedFrameHeight = isRotated ? frameW : frameH;

      // Recover the raw x, y coordinates from the face detector (which are in the oriented space)
      const rawFaceX = faceBox.left * orientedFrameWidth;
      const rawFaceY = faceBox.top * orientedFrameHeight;
      const rawFaceW = faceBox.width * orientedFrameWidth;
      const rawFaceH = faceBox.height * orientedFrameHeight;
      
      // Math contain-scale preserves native field of view and centers of sensor cropping
      const scale = Math.min(photoW / orientedFrameWidth, photoH / orientedFrameHeight);
      const renderedW = orientedFrameWidth * scale;
      const renderedH = orientedFrameHeight * scale;
      const offsetX = (photoW - renderedW) / 2;
      const offsetY = (photoH - renderedH) / 2;

      // Map from oriented frame space to photo space
      let photoFaceX = (rawFaceX * scale) + offsetX;
      let photoFaceY = (rawFaceY * scale) + offsetY;
      const photoFaceW = rawFaceW * scale;
      const photoFaceH = rawFaceH * scale;

      // Mirror the horizontal coordinate back if the front camera is active
      if (device?.position === 'front') {
        photoFaceX = photoW - (photoFaceX + photoFaceW);
      }

      const pxCenterX = photoFaceX + photoFaceW / 2;
      const pxCenterY = photoFaceY + photoFaceH / 2;

      // Calculate face scale relative to the frame. Far faces are small, close faces are large.
      const faceRatio = Math.max(photoFaceW / photoW, photoFaceH / photoH);
      
      // Far faces (ratio ≤ 0.15): 2.0x padding to compensate for stale tracking box
      // Close faces (ratio ≥ 0.35): 1.6x standard padding
      let paddingMult: number;
      if (faceRatio >= 0.35) {
        paddingMult = 1.6;
      } else if (faceRatio <= 0.15) {
        paddingMult = 2.0;
      } else {
        const t = (faceRatio - 0.15) / (0.35 - 0.15);
        paddingMult = 2.0 - t * (2.0 - 1.6);
      }

      const pxSide = Math.max(photoFaceW, photoFaceH) * paddingMult;
      
      let originX = Math.floor(pxCenterX - pxSide / 2);
      let originY = Math.floor(pxCenterY - pxSide * 0.45);
      const size = Math.floor(pxSide);

      // Clamp to bounds using actual photo dimensions (handles landscape raw frames robustly)
      let safeSize = Math.min(size, photoW, photoH);
      originX = Math.max(0, Math.min(photoW - safeSize, originX));
      originY = Math.max(0, Math.min(photoH - safeSize, originY));

      console.log(`[CameraVision] Square Crop (Far Compensation): origin=${originX},${originY} size=${safeSize}x${safeSize}, paddingMult=${paddingMult.toFixed(2)}x (photo raw: ${photoW}x${photoH})`);

      if (safeSize > 0) {
        try {
          const manipResult = await ImageManipulator.manipulateAsync(
            imageToProcess,
            [
              { crop: { originX, originY, width: safeSize, height: safeSize } },
              { resize: { width: 112, height: 112 } }
            ],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.95 }
          );
          imageToProcess = manipResult.uri;
        } catch (e) {
          console.warn('[CameraVision] Native crop failed:', e);
        }
      }
    } else {
      try {
        const manipResult = await ImageManipulator.manipulateAsync(
          imageToProcess,
          [{ resize: { width: 112 } }],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
        );
        imageToProcess = manipResult.uri;
      } catch (e) {}
    }

    // Read JPEG file and decode to raw RGBA pixels
    const response = await fetch(imageToProcess);
    const jpegBuffer = await response.arrayBuffer();
    const jpegData = new Uint8Array(jpegBuffer);
    console.log(`[CameraVision] JPEG size: ${jpegData.length} bytes`);

    const decoded = jpeg.decode(jpegData, { useTArray: true, formatAsRGBA: true });
    console.log(`[CameraVision] Decoded: ${decoded.width}x${decoded.height}, RGBA pixels: ${decoded.data.length} bytes`);

    // Convert to CHW Float32 tensor for buffalo_sc ONNX model
    const tensor = rgbaBufferToCHWTensor(decoded.data, decoded.width, decoded.height, undefined);
    console.log(`[CameraVision] CHW Tensor created: ${tensor.byteLength} bytes (expected: ${112 * 112 * 3 * 4})`);

    // Run buffalo_sc ONNX inference → 512-dim embedding
    const raw = await getEmbedding(tensor);
    if (raw.length < 64) throw new Error('Embedding output is too small');

    // L2 Normalize (must match HRIS-APP registration)
    const normalized: number[] = Array.from(raw);
    const norm = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < normalized.length; i++) normalized[i] /= norm;
    }

    if (!isValidEmbeddingVector(normalized)) {
      throw new Error('Captured face data is invalid. Please center your face and try again.');
    }

    console.log(`[CameraVision] Embedding captured: ${normalized.length} dimensions (buffalo_sc)`);
    return normalized;
  }, [cameraVisionFaceBox]);

  // Sync comparator — receives the already-captured live embedding from the frame processor
  const verifyFaceViaAPI = useCallback(async (liveEmbedding: number[]): Promise<{ ok: boolean; verified: boolean; message?: string; hint?: string; similarity?: number } | null> => {
    try {
      const userId = selectedUserRef.current?.userId;
      if (!userId) return null;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${BACKEND_URL}/verify_face_api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ log_id: userId, live_embedding: liveEmbedding }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const json = await response.json();
      console.log(`[Face Verification API] Response:`, { verified: json.verified, similarity: json.similarity, threshold: json.threshold, angle_count: json.angle_count, best_angle: json.best_angle_index });

      if (json.ok === false && json.message) {
        return { ok: false, verified: false, message: json.message, hint: json.hint };
      }

      return {
        ok: json.verified === true,
        verified: json.verified === true,
        message: json.verified ? undefined : `Face does not match. Similarity: ${((json.similarity || 0) * 100).toFixed(0)}%`,
        hint: json.verified ? undefined : 'Ensure good lighting and face the camera directly.',
        similarity: json.similarity,
      };
    } catch (err: any) {
      console.log('[Face Verification API] Unavailable, falling back to local:', err?.message);
      return null;
    }
  }, []);

  const verifyFaceLocal = useCallback((liveEmbedding: number[]): { ok: boolean; verified: boolean; message?: string; hint?: string; similarity?: number } => {
    console.log('[Face Verification] === LOCAL VERIFICATION START ===');
    console.log(`[Face Verification] Target Employee: ${selectedUserRef.current?.name || 'Unknown'} (Username: ${selectedUserRef.current?.username || 'N/A'}, ID: ${selectedUserRef.current?.userId || 'N/A'})`);
    if (!isValidEmbeddingVector(liveEmbedding)) {
      console.log('[Face Verification] ❌ Live embedding is invalid or empty.');
      console.log('[Face Verification] === LOCAL VERIFICATION END ===');
      return { ok: false, verified: false, message: 'Invalid live face capture.', hint: 'Center your face and try again in better lighting.' };
    }
    console.log(`[Face Verification] Live Embedding Length: ${liveEmbedding.length}`);
    const storedEmbeddingVal = selectedUserRef.current?.face_embedding;
    if (!storedEmbeddingVal) {
      console.log('[Face Verification] ❌ No stored face embedding found for this employee.');
      console.log('[Face Verification] === LOCAL VERIFICATION END ===');
      return { ok: false, verified: false, message: 'No face profile registered for this employee.', hint: 'Ask the employee to register their face in the HRIS mobile app first.' };
    }
    let storedEmbedding: number[] | number[][];
    if (Array.isArray(storedEmbeddingVal)) {
      storedEmbedding = storedEmbeddingVal;
      console.log('[Face Verification] Stored Embedding Source: Array');
    } else if (typeof storedEmbeddingVal === 'string') {
      try {
        storedEmbedding = JSON.parse(storedEmbeddingVal);
        console.log('[Face Verification] Stored Embedding Source: JSON String (Parsed successfully)');
      } catch {
        console.log('[Face Verification] ❌ Failed to parse stored embedding JSON string.');
        console.log('[Face Verification] === LOCAL VERIFICATION END ===');
        return { ok: false, verified: false, message: 'Face profile data is corrupted.', hint: 'Ask the employee to re-register their face in the HRIS mobile app.' };
      }
    } else {
      console.log('[Face Verification] ❌ Stored embedding has unknown type:', typeof storedEmbeddingVal);
      console.log('[Face Verification] === LOCAL VERIFICATION END ===');
      return { ok: false, verified: false, message: 'Face profile data is corrupted.', hint: 'Ask the employee to re-register their face in the HRIS mobile app.' };
    }

    const result = compareMultiAngleEmbeddings(liveEmbedding, storedEmbedding);

    if (result.maxSimilarity === -1) {
      console.log('[Face Verification] ❌ Failed to calculate valid similarity score against any stored profile.');
      console.log('[Face Verification] === LOCAL VERIFICATION END ===');
      return { ok: false, verified: false, message: 'Face profile format mismatch.', hint: 'Please re-register face profile.' };
    }
    
    const threshold = MODEL_CONFIG.matchThreshold;
    const subThreshold = MODEL_CONFIG.subThreshold;

    // top2_agree: for multi-angle registrations, require at least 2 angles above sub-threshold
    const agreeingAngles = result.perAngleScores.filter(s => s >= subThreshold).length;
    const top2Required = result.angleCount >= 3;
    const top2Agrees = !top2Required || agreeingAngles >= 2;

    const isMatched = isMatch(result.maxSimilarity, threshold) && top2Agrees;
    
    console.log(`[Face Verification] Angles: ${result.angleCount}, Per-angle scores: [${result.perAngleScores.map(s => s.toFixed(4)).join(', ')}]`);
    console.log(`[Face Verification] Best Cosine Similarity: ${result.maxSimilarity.toFixed(4)} (${(result.maxSimilarity * 100).toFixed(2)}%) from angle ${result.bestAngleIndex}`);
    console.log(`[Face Verification] Agreeing angles (≥${subThreshold}): ${agreeingAngles} / ${result.angleCount}${top2Required ? ' (top2 required)' : ''}`);
    console.log(`[Face Verification] Match Threshold Required: ${threshold.toFixed(2)} (${(threshold * 100).toFixed(0)}%)`);
    console.log(`[Face Verification] Match Verdict: ${isMatched ? '✅ [PASS]' : '❌ [FAIL]'}`);
    console.log('[Face Verification] === LOCAL VERIFICATION END ===');

    if (isMatched) return { ok: true, verified: true, similarity: result.maxSimilarity };
    return { ok: false, verified: false, similarity: result.maxSimilarity, message: `Face does not match. Similarity: ${(result.maxSimilarity * 100).toFixed(0)}%`, hint: 'Ensure good lighting and face the camera directly.' };
  }, []);

  const logCameraVisionGateSkip = useCallback((reason: string, details?: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastCameraVisionGateLogRef.current < CAMERA_VISION_GATE_LOG_COOLDOWN_MS) return;
    lastCameraVisionGateLogRef.current = now;
    if (details) {
      console.log(`[CameraVision] Verification gate blocked: ${reason}`, details);
      return;
    }
    console.log(`[CameraVision] Verification gate blocked: ${reason}`);
  }, []);

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
    setScanStage('recording');
    faceProcessingRef.current = true;
    try {
      const action = attendanceAction;
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const localTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      
      // Try to load cached location first to make transactions instant
      let locationData: { address?: string; latitude?: number; longitude?: number; radius?: number } = {};
      try {
        const cachedRaw = await AsyncStorage.getItem('kiosk_cached_location');
        if (cachedRaw) {
          locationData = JSON.parse(cachedRaw);
        } else {
          // Fallback to live fetch if cache is somehow missing
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const [addressRes] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            locationData = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              radius: loc.coords.accuracy ?? 0,
              address: addressRes ? `${addressRes.streetNumber ? addressRes.streetNumber + ' ' : ''}${addressRes.street || ''}, ${addressRes.city || ''}, ${addressRes.region || ''}`.trim().replace(/^, |, $/g, '') : 'Unknown'
            };
            await AsyncStorage.setItem('kiosk_cached_location', JSON.stringify(locationData));
          }
        }
      } catch (e) {
        console.log('[Attendance] Could not capture location', e);
      }

      let data: any = null;
      let capturedOffline = offlineModeEnabled;

      if (capturedOffline) {
        await enqueueOfflineAttendance({ 
            userId: selectedUserRef.current!.userId, 
            username: selectedUserRef.current!.username, 
            name: selectedUserRef.current!.name ?? null, 
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
              userId: selectedUserRef.current!.userId, 
              username: selectedUserRef.current!.username, 
              name: selectedUserRef.current!.name ?? null, 
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
        await saveStoredSession({ userId: selectedUserRef.current!.userId, username: selectedUserRef.current!.username, name: selectedUserRef.current!.name ?? null, clockInTime: data?.timein || localTime, clockInDate: data?.date || localDate });
        if (!capturedOffline && data?.emp_id != null) await AsyncStorage.setItem('emp_id', String(data.emp_id));
      } else {
        await clearStoredSession(selectedUserRef.current!.userId);
      }
      
      setScanStage('success');
      setSuccessAnimationTick((prev) => prev + 1);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await resetAttendanceFlow();
      workletPhase.value = 0; // Reset worklet phase
      showModal('success',
        action === 'clock_in' ? 'Clock In Success' : 'Clock Out Success',
        capturedOffline ? 'Captured and saved offline.' : 'Face verified and recorded.',
        '', 2000);
    } catch (e: any) {
      faceProcessingRef.current = false;
      livenessTriggeredRef.current = false;
      setScanStage('idle');
      const showOfflineError = offlineModeEnabled || isLikelyConnectivityError(e);
      showModal('error', showOfflineError ? 'Offline Mode Error' : 'Connection Error', e?.message || 'Please try again.', showOfflineError ? 'Connect once to refresh employee QR cache.' : 'Check your internet connection', 2000);
    } finally {
      setIsVerifying(false);
    }
  }, [attendanceAction, clearStoredSession, enqueueOfflineAttendance, isLikelyConnectivityError, offlineModeEnabled, recordAttendance, refreshPendingSyncCount, resetAttendanceFlow, saveStoredSession, showModal, showOfflineToast, storeClockInNotification, workletPhase]);

  // Main attendance handler (Concurrent Phase 1 & 2)
  const executeFaceVerification = useCallback(async () => {
    if (!qrVerified || !selectedUserRef.current) return;
    setIsVerifying(true);
    setScanStage('capturing');
    identityStatusRef.current = 'pending';

    // Visual + audio snap
    playSnapSound();
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    setIsCapturingHardware(true);
    setLivenessMessage('Capturing...');
    await new Promise(resolve => setTimeout(resolve, 50));

    const verificationStart = Date.now();
    let captureDuration = 0;
    let compareDuration = 0;
    let methodUsed = 'Unknown';
    let result: any;

    try {
      if (faceEngine === 'camera_vision') {
        const captureStart = Date.now();
        let liveEmbedding: number[] | null = null;
        let bestScore = -1;
        let lastError: any = null;

        // Pre-parse stored embedding for quick scoring between shots
        const storedRaw = selectedUserRef.current?.face_embedding;
        let parsedStored: number[] | number[][] | null = null;
        if (storedRaw) {
          try { parsedStored = Array.isArray(storedRaw) ? storedRaw : JSON.parse(storedRaw as string); } catch {}
        }

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const embedding = await captureEmbeddingFromPhoto();
            if (parsedStored) {
              const r = compareMultiAngleEmbeddings(embedding, parsedStored);
              if (r.maxSimilarity > bestScore) {
                bestScore = r.maxSimilarity;
                liveEmbedding = embedding;
              }
              // First shot already clear pass — skip second (Only if similarity score > 0.92, otherwise proceed to 2nd shot)
              if (bestScore >= 0.92 && attempt === 1) {
                console.log(`[CameraVision] Shot 1 scored well (${(bestScore * 100).toFixed(1)}% >= 92%), skipping shot 2.`);
                break;
              }
            } else {
              if (!liveEmbedding) liveEmbedding = embedding;
              break;
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, 200));
          } catch (err) {
            console.log(`[CameraVision] Photo capture attempt ${attempt} failed:`, err);
            lastError = err;
            if (attempt < 2) await new Promise(r => setTimeout(r, 100));
          }
        }
        if (!liveEmbedding) throw lastError || new Error('Failed to capture face embedding');
        
        captureDuration = Date.now() - captureStart;
        setIsCapturingHardware(false);

        const compareStart = Date.now();
        // Try API verification first (authoritative server-side check), fall back to local
        if (!offlineModeEnabled) {
          const apiResult = await verifyFaceViaAPI(liveEmbedding);
          if (apiResult !== null) {
            result = apiResult;
            methodUsed = 'API (Camera Vision)';
          } else {
            result = verifyFaceLocal(liveEmbedding);
            methodUsed = 'Local Fallback (Camera Vision)';
          }
        } else {
          result = verifyFaceLocal(liveEmbedding);
          methodUsed = 'Local Offline (Camera Vision)';
        }
        compareDuration = Date.now() - compareStart;
      } else {
        const captureStart = Date.now();
        // Face++ or offline photo capture
        if (!cameraRef.current) throw new Error('Camera not ready');
        const photo1 = await cameraRef.current.takePhoto({ flash: 'off', enableAutoRedEyeReduction: true });
        captureDuration = Date.now() - captureStart;
        setIsCapturingHardware(false);
        if (!photo1?.path) throw new Error('No image captured');
        const photoUri = `file://${photo1.path}`;

        const compareStart = Date.now();
        if (offlineModeEnabled) {
          result = { ok: true, verified: true, offlineCaptured: true, message: 'Face photos captured offline.', photoUri };
          methodUsed = 'Offline Photo Capture (Face++)';
        } else {
          result = await verifyFace(photoUri);
          methodUsed = 'API (Face++)';
        }
        compareDuration = Date.now() - compareStart;
      }
    } catch (e: any) {
      setIsCapturingHardware(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      identityStatusRef.current = 'failed';
      modalContextRef.current = 'face_error';
      setScanStage('idle');
      showModal('error', 'Camera Error', e?.message || 'Failed to capture photo', '', 2000);
      return;
    }

    try {
      const totalTime = Date.now() - verificationStart;
      const userName = selectedUserRef.current?.name || 'Unknown';
      const userId = selectedUserRef.current?.userId || 'N/A';
      const scoreVal = result?.similarity != null ? result.similarity : (result?.match_score != null ? result.match_score : null);
      const isSuccess = result?.ok === true || result?.verified === true;

      console.log('\n==================================================');
      console.log('       [Face Verification TEST METRICS]           ');
      console.log('==================================================');
      console.log(`👤 Employee:    ${userName} (ID: ${userId})`);
      console.log(`⚡ Method:      ${methodUsed}`);
      console.log(`🏆 Result:      ${isSuccess ? '✅ [PASSED]' : '❌ [FAILED]'}`);
      if (scoreVal !== null) {
        console.log(`📈 Score:       ${(scoreVal * 100).toFixed(2)}% (Threshold: ${(MODEL_CONFIG.matchThreshold * 100).toFixed(0)}%)`);
      } else {
        console.log(`📈 Score:       N/A`);
      }
      console.log('--------------------------------------------------');
      console.log('Performance Details:');
      console.log(`📸 Image Capture/ONNX:  ${captureDuration} ms`);
      console.log(`⚖️ Comparison Math:     ${compareDuration} ms`);
      console.log(`⏱️ Total Cycle Time:    ${totalTime} ms`);
      console.log('==================================================\n');

      if (result?.ok === true || result?.verified === true) {
        identityStatusRef.current = 'passed';
        await executeAttendanceRecording();
      } else {
        identityStatusRef.current = 'failed';
        workletPhase.value = 3;
        setIsVerifying(false);
        faceProcessingRef.current = false; // reset so touchless can auto-retry
        modalContextRef.current = 'face_error';
        setScanStage('idle');
        showModal('error', 'Verification Failed', result?.message || 'Face verification failed.', result?.hint || 'Please try again.', 2000);
      }
    } catch (e: any) {
      identityStatusRef.current = 'failed';
      workletPhase.value = 3;
      setIsVerifying(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      modalContextRef.current = 'face_error';
      setScanStage('idle');
      const showOfflineError = offlineModeEnabled || isLikelyConnectivityError(e);
      showModal('error', showOfflineError ? 'Offline Mode Error' : 'Connection Error', e?.message || 'Please try again.', showOfflineError ? 'Connect once to refresh employee QR cache.' : 'Check your internet connection', 2000);
    }
  }, [qrVerified, faceEngine, offlineModeEnabled, verifyFace, verifyFaceLocal, captureEmbeddingFromPhoto, executeAttendanceRecording, showModal, flashAnim, isLikelyConnectivityError, workletPhase]);

  // Main attendance handler (Concurrent Phase 1 & 2)
  const handleAttendance = useCallback(async () => {
    if (faceProcessingRef.current || isVerifying) return;
    if (!qrVerified || !selectedUserRef.current) {
      setScanStage('idle');
      showModal('warning', 'Scan QR Code First', 'Please scan your personal QR code before continuing.', 'The user must scan a QR code.');
      return;
    }
    

    if (!hasPermission) {
      setScanStage('idle');
      showModal('warning', 'Camera Required', 'Please allow camera access to verify your identity.', '');
      return;
    }

    if (faceEngine === 'camera_vision' && !offlineModeEnabled) {
      const minReadiness = touchlessEnabled
        ? CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY
        : CAMERA_VISION_MANUAL_MIN_READINESS_TO_VERIFY;
      if (!cameraVisionFaceDetected || cameraVisionReadiness < minReadiness) {
        setScanStage('detecting');
        logCameraVisionGateSkip('Face not ready for verification', {
          detected: cameraVisionFaceDetected,
          readiness: cameraVisionReadiness,
          required: minReadiness,
          mode: touchlessEnabled ? 'touchless' : 'manual',
        });
        showModal(
          'warning',
          'Face Not Ready',
          'No stable face detected yet. Please center your face and hold still.',
          'Ensure your full face is visible with good lighting.',
          1500,
        );
        return;
      }
    }

    faceProcessingRef.current = true;

    if (livenessEnabled) {
      // PHASE 1: Active Liveness (Detect blinking first)
      livenessStatusRef.current = 'pending';
      livenessScoreRef.current = null;
      workletPhase.value = 2; // Trigger blinking check in worklet
      setScanStage('verifying');
      setLivenessMessage('Please Blink or Smile to verify');
    } else {
      // Skip active liveness: start verifying face immediately
      await executeFaceVerification();
    }
  }, [attendanceAction, touchlessEnabled, hasPermission, isLikelyConnectivityError, livenessEnabled, offlineModeEnabled, qrVerified, showModal, workletPhase, executeAttendanceRecording, faceEngine, cameraVisionFaceDetected, cameraVisionReadiness, logCameraVisionGateSkip, executeFaceVerification]);

  const onFaceDetectedForIdentity = Worklets.createRunOnJS(() => {
    if (!touchlessEnabledRef.current || modalVisibleRef.current || !qrVerified || countdownRef.current > 0 || countdownActive || faceProcessingRef.current || isVerifying) return;
    if (faceEngineRef.current === 'facepp') return;
    if (faceEngineRef.current === 'camera_vision') {
      setScanStage('detecting');
      return;
    }
  });

  const onTouchlessFaceLost = Worklets.createRunOnJS(() => {
    if (!touchlessEnabledRef.current || faceProcessingRef.current || isVerifying) return;
    if (faceEngineRef.current === 'facepp' && faceppCountdownStartedRef.current) return;
    if (faceEngineRef.current === 'camera_vision') {
      cameraVisionAutoTriggeredRef.current = false;
    }
    setLivenessMessage('Face the camera directly');
  });

  const onCameraVisionDetectionProgress = Worklets.createRunOnJS((
    detected: boolean,
    readinessPercent: number,
    box?: NormalizedFaceBox | null,
    telemetry?: CameraVisionFaceTelemetry | null,
    frameWidth?: number,
    frameHeight?: number,
    allFaces?: Array<{ x: number; y: number; width: number; height: number; isTarget: boolean }> | null,
  ) => {
    setCameraVisionFaceDetected(detected);
    setCameraVisionReadiness(readinessPercent);
    setCameraVisionFaceTelemetry(detected ? (telemetry ?? null) : null);
    if (!detected) {
      if (readinessPercent <= 0) {
        setCameraVisionFaceBox(null);
        setCameraVisionAllFaces([]);
      }
    } else {
      if (!box) {
        setCameraVisionFaceBox({
          left: 0.42,
          top: 0.08,
          width: 0.36,
          height: 0.5,
          frameWidth,
          frameHeight,
        });
      } else {
        setCameraVisionFaceBox({
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          frameWidth,
          frameHeight,
        });
      }

      if (allFaces && allFaces.length > 0) {
        const mapped = allFaces.map((f, idx) => ({
          id: `face_${idx}_${f.x.toFixed(3)}_${f.y.toFixed(3)}`,
          left: f.x,
          top: f.y,
          width: f.width,
          height: f.height,
          isTarget: f.isTarget,
          frameWidth,
          frameHeight,
        }));
        setCameraVisionAllFaces(mapped);
      } else {
        const primaryBox = box ?? { x: 0.42, y: 0.08, width: 0.36, height: 0.5 };
        setCameraVisionAllFaces([{
          id: 'primary',
          left: primaryBox.x,
          top: primaryBox.y,
          width: primaryBox.width,
          height: primaryBox.height,
          isTarget: true,
          frameWidth,
          frameHeight,
        }]);
      }
    }
    if (
      faceEngineRef.current === 'camera_vision' &&
      qrVerified &&
      !isVerifying &&
      !faceProcessingRef.current &&
      !modalVisibleRef.current
    ) {
      setScanStage('detecting');
    }
  });

  const onActiveLivenessPassed = Worklets.createRunOnJS((score: number) => {
    if (livenessStatusRef.current === 'passed' || modalVisibleRef.current || !qrVerified) return;
    console.log(`[Liveness] ✅ Active Liveness (Physical Blink/Smile) Verified! Accuracy Score: ${score.toFixed(3)}`);
    livenessStatusRef.current = 'passed';
    livenessScoreRef.current = score;
    setLivenessMessage(`Liveness passed (${(score * 100).toFixed(0)}%)\nVerifying face...`);
    executeFaceVerification();
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

    frameCounter.value++;
    
    // SAFETY RESET: If the lock is held but no face has been processed for 30 frames (~1s), force reset.
    // This prevents permanent "freezes" if runAsync callbacks are dropped by the system.
    if (isProcessingFace.value && (frameCounter.value - lastFaceProcessedFrame.value > 30)) {
      isProcessingFace.value = false;
    }

    // Skip capture block — embedding capture now happens via takePhoto() on JS thread
    // (see captureEmbeddingFromPhoto). Frame processor only handles tracking + liveness.

    if (isProcessingFace.value || workletPhase.value === 1 || isCapturingHardwareRef.value) return;
    
    // Throttle continuous tracking to ~10 FPS (every 3rd frame) to prevent UI lag
    if (frameCounter.value % 3 !== 0) return;

    // Auto-capture logic move to worklet thread for higher precision
    if (workletPhase.value === 0) {
      if (!sharedTouchlessEnabled.value && !sharedFaceEngineIsCameraVision.value) return;
    }

    isProcessingFace.value = true;
    lastFaceProcessedFrame.value = frameCounter.value;
    try {
      // Run detection synchronously on the frame processor main thread to prevent hardware buffer lock errors
      const faces = detectFaces(frame);
        const detectedFace = selectBestDetectedFace(faces, frame.width, frame.height);
        const recognitionFace = selectBestRecognitionFace(faces, frame.width, frame.height);
        const trackedFace = detectedFace ?? recognitionFace;

        // Store the best face box in shared values for the capture block to reuse
        if (trackedFace) {
          lastTrackedFaceX.value = trackedFace.box.x;
          lastTrackedFaceY.value = trackedFace.box.y;
          lastTrackedFaceW.value = trackedFace.box.width;
          lastTrackedFaceH.value = trackedFace.box.height;
          hasTrackedFace.value = true;
        }

        if (workletPhase.value === 0) {
          if (detectedFace) {
            stableFaceFrames.value = Math.min(stableFaceFrames.value + 1, CAMERA_VISION_STABLE_FACE_FRAMES);

            if (sharedFaceEngineIsCameraVision.value) {
              const readinessPercent = Math.min(
                100,
                Math.round((stableFaceFrames.value / CAMERA_VISION_STABLE_FACE_FRAMES) * 100),
              );
              const telemetry = extractFaceTelemetry(trackedFace?.sourceFace);

              const allFacesList = [];
              for (let i = 0; i < faces.length; i++) {
                const f = faces[i];
                const fBox = extractNormalizedFaceBox(f, frame.width, frame.height);
                if (fBox && isFaceBoxDetected(fBox)) {
                  const isTarget = trackedFace && 
                    Math.abs(fBox.x - trackedFace.box.x) < 0.08 && 
                    Math.abs(fBox.y - trackedFace.box.y) < 0.08;
                  allFacesList.push({
                    x: fBox.x,
                    y: fBox.y,
                    width: fBox.width,
                    height: fBox.height,
                    isTarget: !!isTarget,
                  });
                }
              }

              if (
                readinessPercent !== lastCameraVisionReadinessSent.value ||
                lastCameraVisionDetectedSent.value !== true
              ) {
                lastCameraVisionReadinessSent.value = readinessPercent;
                lastCameraVisionDetectedSent.value = true;
                onCameraVisionDetectionProgress(
                  true,
                  readinessPercent,
                  trackedFace?.box ?? null,
                  telemetry,
                  frame.width,
                  frame.height,
                  allFacesList,
                );
              } else {
                onCameraVisionDetectionProgress(
                  true,
                  readinessPercent,
                  trackedFace?.box ?? null,
                  telemetry,
                  frame.width,
                  frame.height,
                  allFacesList,
                );
              }
            }
            if (stableFaceFrames.value >= CAMERA_VISION_STABLE_FACE_FRAMES) {
              onFaceDetectedForIdentity();
            }
          } else {
            if (stableFaceFrames.value !== 0) {
              stableFaceFrames.value = Math.max(0, stableFaceFrames.value - 1);
            }
            if (
              sharedFaceEngineIsCameraVision.value &&
              (lastCameraVisionReadinessSent.value !== 0 || lastCameraVisionDetectedSent.value !== false || stableFaceFrames.value > 0)
            ) {
              const readinessPercent = Math.min(
                100,
                Math.round((stableFaceFrames.value / CAMERA_VISION_STABLE_FACE_FRAMES) * 100),
              );
              lastCameraVisionReadinessSent.value = readinessPercent;
              lastCameraVisionDetectedSent.value = false;
              onCameraVisionDetectionProgress(false, readinessPercent, null, null, frame.width, frame.height, []);
            }
            onTouchlessFaceLost();
          }
        }

        if (faces.length > 0) {
          const face = faces[0];
          if (workletPhase.value === 2) {
            // PHASE 2: Active Liveness (Blink or Smile)
            const leftOpenProb = face.leftEyeOpenProbability ?? 1;
            const rightOpenProb = face.rightEyeOpenProbability ?? 1;
            const smileProb = face.smilingProbability ?? 0;
            const isEyesOpen = leftOpenProb > 0.4 && rightOpenProb > 0.4;
            const isEyesClosed = leftOpenProb < 0.2 && rightOpenProb < 0.2;
            const isSmiling = smileProb > 0.7;
            const isNotSmiling = smileProb < 0.3;
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
  }, [detectFaces, sharedTouchlessEnabled, sharedFaceEngineIsCameraVision, onFaceDetectedForIdentity, onTouchlessFaceLost, onCameraVisionDetectionProgress, onActiveLivenessPassed, updateLivenessMessage, isCapturingHardwareRef, workletPhase, blinkState, isProcessingFace, stableFaceFrames, lastCameraVisionReadinessSent, lastCameraVisionDetectedSent, frameCounter, lastFaceProcessedFrame, lastTrackedFaceX, lastTrackedFaceY, lastTrackedFaceW, lastTrackedFaceH, hasTrackedFace]);

  // QR scanner
  const handleBarcodeScanned = async (event: any) => {
    if (qrProcessingRef.current || isVerifying || qrVerified) return;
    const data: string | undefined = event?.data;
    if (!data) return;
    const now = Date.now();
    if (lastScanRef.current.data === data && now - lastScanRef.current.ts < 1500) return;
    qrProcessingRef.current = true;
    lastScanRef.current = { data, ts: now };
    touchlessTriggeredRef.current = false;
    cameraVisionAutoTriggeredRef.current = false;
    playSnapSound();
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    
    setIsQrLoading(true);
    try {
      const currentSettings = await applyScannerSettings().catch(() => ({
        touchless: touchlessEnabledRef.current,
        liveness: livenessEnabled,
        engine: faceEngineRef.current,
      }));
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

        // Check if we have the necessary offline data to do a fast-path face verify
        const hasNeededFaceData = currentSettings.engine === 'camera_vision' 
          ? !!cachedUser.face_embedding 
          : true; // Face++ sends the live photo to backend, backend fetches stored face

        // If we are missing the embedding locally, we CANNOT auto-trigger handleAttendance yet.
        // We must wait for the background sync to finish fetching it!
        const shouldWaitSync = currentSettings.touchless && currentSettings.engine === 'camera_vision' && !hasNeededFaceData;

        // Show the success checkmark for 600ms before transitioning
        setTimeout(async () => {
          setQrSuccessLocal(false);
          workletPhase.value = 0;
          setQrVerified(true);
          
          const isClockOut = localSession ? true : false;
          
          // Automatic clock-out if touchless is enabled
          if (isClockOut && currentSettings.touchless) {
             setAttendanceAction('clock_out');
             // Removed explicit await handleAttendance() here to avoid stale state. The useEffect will catch it.
          } else {
            setFaceCountdown(0);
            countdownRef.current = 0;
            livenessTriggeredRef.current = false;
            touchlessTriggeredRef.current = false;
            faceppCountdownStartedRef.current = false;
            stableFaceFrames.value = 0;
            setCountdownActive(false);
            if (currentSettings.touchless && currentSettings.engine === 'camera_vision') {
              if (!shouldWaitSync) {
                setScanStage('detecting');
              } else {
                setScanStage('idle');
                console.log('[QR] Waiting for background sync to fetch face_embedding...');
              }
            } else {
              setScanStage('idle');
            }
          }
        }, 300);

        // Background server sync to correct session state and fetch face data
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
           console.log('[QR] Background sync complete. Updated user data for:', resolved.username);
           
           // Update the selected user with the fresh data from the server (including face_embedding)
           setSelectedUser(resolved);
           setWelcomeName(resolved.name || resolved.username || 'Employee');
           setClockInTime(existingSession?.clockInTime || '');
           setAttendanceAction(existingSession ? 'clock_out' : 'clock_in');

           // If touchless is enabled and it's a clock-in, we trigger handleAttendance NOW 
           // because the 600ms timeout above might have already fired with stale data
           // Also trigger if we were waiting for the sync to finish for clock_out
           const isClockOutNow = existingSession ? true : false;
           if (currentSettings.touchless) {
              if ((!isClockOutNow) || (isClockOutNow && shouldWaitSync)) {
                console.log('[QR] Background sync finished. Relying on useEffect for touchless transition.');
                // Removed explicit await handleAttendance() to avoid stale state issues.
              }
           }
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
        workletPhase.value = 0;
        setQrVerified(true);
        setFaceCountdown(0);
        countdownRef.current = 0;
        livenessTriggeredRef.current = false;
        touchlessTriggeredRef.current = false;
        faceppCountdownStartedRef.current = false;
        stableFaceFrames.value = 0;
        setCountdownActive(false);
        if (currentSettings.touchless && currentSettings.engine === 'camera_vision') {
          setScanStage('detecting');
        } else {
          setScanStage('idle');
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
    if (!countdownActive || !qrVerified || isVerifying) return;
    if (faceCountdown <= 0) return;
    const interval = faceEngine === 'camera_vision' ? 500 : 1000;
    const step = faceEngine === 'camera_vision' ? 0.5 : 1;
    const timer = setTimeout(() => {
      const next = Math.max(0, faceCountdown - step);
      setFaceCountdown(next);
      countdownRef.current = next;
    }, interval);
    return () => clearTimeout(timer);
  }, [countdownActive, qrVerified, isVerifying, faceCountdown, faceEngine]);

  useEffect(() => {
    if (!countdownActive || !touchlessEnabled || !qrVerified) return;
    if (showResultModal || modalVisibleRef.current) return;
    if (faceCountdown > 0 || isVerifying || faceProcessingRef.current) return;
    setCountdownActive(false);
    faceppCountdownStartedRef.current = false;
    setScanStage('capturing');
    handleAttendance();
  }, [countdownActive, faceCountdown, faceEngine, handleAttendance, isVerifying, qrVerified, showResultModal, touchlessEnabled]);

  useEffect(() => {
    if (!touchlessEnabled || !qrVerified) return;
    if (faceEngine !== 'facepp') return;
    if (isVerifying || faceProcessingRef.current || showResultModal || modalVisibleRef.current) return;
    if (countdownActive || faceCountdown > 0 || faceppCountdownStartedRef.current) return;
    faceppCountdownStartedRef.current = true;
    setFaceCountdown(FACEPP_TOUCHLESS_COUNTDOWN_SECONDS);
    countdownRef.current = FACEPP_TOUCHLESS_COUNTDOWN_SECONDS;
    setCountdownActive(true);
    setScanStage('countdown');
    setLivenessMessage(`Capturing in ${FACEPP_TOUCHLESS_COUNTDOWN_SECONDS}...`);
  }, [countdownActive, faceCountdown, faceEngine, isVerifying, qrVerified, showResultModal, touchlessEnabled]);

  useEffect(() => {
    if (!touchlessEnabled || !qrVerified) return;
    if (faceEngine !== 'camera_vision') return;
    if (isVerifying || faceProcessingRef.current || showResultModal || modalVisibleRef.current) return;

    if (countdownActive) return;

    setScanStage('detecting');
    const autoReadinessThreshold = CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY;

    if (
      cameraVisionFaceDetected &&
      cameraVisionReadiness >= autoReadinessThreshold &&
      !cameraVisionAutoTriggeredRef.current
    ) {
      setFaceCountdown(0.5);
      countdownRef.current = 0.5;
      setCountdownActive(true);
      setScanStage('countdown');
      setLivenessMessage('Capturing...');
      cameraVisionAutoTriggeredRef.current = true;
      return;
    }

    if (
      !cameraVisionFaceDetected ||
      cameraVisionReadiness < Math.max(12, autoReadinessThreshold - 15)
    ) {
      cameraVisionAutoTriggeredRef.current = false;
      if (countdownActive) {
        setCountdownActive(false);
        setFaceCountdown(0);
        countdownRef.current = 0;
        setScanStage('detecting');
      }
    }
  }, [
    countdownActive,
    cameraVisionFaceDetected,
    cameraVisionReadiness,
    faceEngine,
    handleAttendance,
    isVerifying,
    qrVerified,
    showResultModal,
    touchlessEnabled,
  ]);

  useEffect(() => {
    faceppCountdownStartedRef.current = false;
    if (countdownRef.current > 0 || countdownActive || faceCountdown > 0) {
      setFaceCountdown(0);
      countdownRef.current = 0;
      setCountdownActive(false);
    }
  }, [countdownActive, faceCountdown, faceEngine]);

  useEffect(() => {
    touchlessEnabledRef.current = touchlessEnabled;
    sharedTouchlessEnabled.value = touchlessEnabled;
  }, [touchlessEnabled]);

  useEffect(() => {
    faceEngineRef.current = faceEngine;
    sharedFaceEngineIsCameraVision.value = faceEngine === 'camera_vision';
    lastCameraVisionReadinessSent.value = -1;
    lastCameraVisionDetectedSent.value = false;
  }, [faceEngine]);

  useEffect(() => {
    if (!qrVerified) {
      setScanStage('idle');
      setCameraVisionFaceDetected(false);
      setCameraVisionReadiness(0);
      setCameraVisionFaceBox(null);
      setCameraVisionAllFaces([]);
      setCameraVisionFaceTelemetry(null);
      cameraVisionAutoTriggeredRef.current = false;
    }
  }, [qrVerified]);

  useEffect(() => {
    applyScannerSettings().catch(() => { });
  }, [applyScannerSettings]);

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { refreshPendingSyncCount(); }, [refreshPendingSyncCount]);
  useEffect(() => {
    if (offlineModeEnabled && !previousOfflineStateRef.current) {
      showOfflineToast();
    }
    previousOfflineStateRef.current = offlineModeEnabled;
  }, [offlineModeEnabled, showOfflineToast]);

  // Pre-fetch and cache location in background at mount time if not cached
  useEffect(() => {
    async function initLocation() {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          setHasLocationPermission(true);
          const cached = await AsyncStorage.getItem('kiosk_cached_location');
          if (!cached) {
            console.log('[Location] Cache empty, pre-fetching Kiosk location in background...');
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const [addressRes] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            const locationData = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              radius: loc.coords.accuracy ?? 0,
              address: addressRes ? `${addressRes.streetNumber ? addressRes.streetNumber + ' ' : ''}${addressRes.street || ''}, ${addressRes.city || ''}, ${addressRes.region || ''}`.trim().replace(/^, |, $/g, '') : 'Unknown'
            };
            await AsyncStorage.setItem('kiosk_cached_location', JSON.stringify(locationData));
            console.log('[Location] Background pre-fetch successful:', locationData.address);
          } else {
            console.log('[Location] Using cached Kiosk location:', JSON.parse(cached).address);
          }
        } else {
          // Auto-prompt location request once it opens
          const res = await Location.requestForegroundPermissionsAsync();
          setHasLocationPermission(res.status === 'granted');
          if (res.status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const [addressRes] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            const locationData = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              radius: loc.coords.accuracy ?? 0,
              address: addressRes ? `${addressRes.streetNumber ? addressRes.streetNumber + ' ' : ''}${addressRes.street || ''}, ${addressRes.city || ''}, ${addressRes.region || ''}`.trim().replace(/^, |, $/g, '') : 'Unknown'
            };
            await AsyncStorage.setItem('kiosk_cached_location', JSON.stringify(locationData));
            console.log('[Location] Background pre-fetch successful after request:', locationData.address);
          }
        }
      } catch (e) {
        console.log('[Location] Background pre-fetch failed:', e);
      }
    }
    initLocation();
  }, []);

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
  const formattedDate = currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const isClockingOut = attendanceAction === 'clock_out';
  const displayClockInTime = formatTo12Hour(clockInTime);

  return {
    colors, device, hasPermission, requestPermission,
    hasLocationPermission, requestLocationPermission,
    cameraFormat, cameraRef, codeScanner, frameProcessor,
    flashAnim, scanLineAnim, scaleAnim,
    formattedTime, formattedDate,
    isLoading, isVerifying, isQrLoading, isClockingOut, isCapturingHardware: uiCapturingHardware,
    qrVerified, qrSuccessLocal, selectedUser, clockInTime: displayClockInTime, faceCountdown,
    touchlessEnabled, offlineModeEnabled, livenessEnabled, faceEngine, pendingSyncCount,
    scanStage, cameraVisionFaceDetected, cameraVisionReadiness, cameraVisionFaceBox, cameraVisionAllFaces, cameraVisionFaceTelemetry, successAnimationTick,
    showResultModal, modalType, modalTitle, modalMessage, modalHint, livenessMessage,
    closeModal, handleAttendance, resetAttendanceFlow,
  };
}
