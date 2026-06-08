import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as jpeg from 'jpeg-js';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner, useFrameProcessor, useCameraFormat } from 'react-native-vision-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image as RNImage, Platform, ToastAndroid, useWindowDimensions } from 'react-native';
import { BACKEND_URL } from '../../config/backend';
import { enqueueOfflineAttendance, getOfflineAttendanceQueue, syncOfflineQueue } from '../../utils/offlineAttendance';
import { resolveOfflineUserFromQr, upsertOfflineUserCacheUser } from '../../utils/offlineUsers';
import { useTheme } from '../../config/theme';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { compareEmbeddings, compareMultiAngleEmbeddings, isMatch, MODEL_CONFIG } from '../../utils/face-embedding';
import { loadFaceModel, getEmbedding, isModelLoaded } from '../../faceEngine/model';
import { rgbaBufferToCHWTensor, prepareEmbeddingInput } from '../../faceEngine/preprocess';
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
  const { isConnected, hasGoodInternet } = useNetworkStatus();
  const NETWORK_TIMEOUT_MS = 1500;
  const NETWORK_TOAST_COOLDOWN_MS = 15000;
    const CAMERA_VISION_STABLE_FACE_FRAMES = 8;
  const CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY = 65;
  const CAMERA_VISION_MANUAL_MIN_READINESS_TO_VERIFY = 30;
  const CAMERA_VISION_GATE_LOG_COOLDOWN_MS = 2000;

  // Camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;
  const cameraFormat = useCameraFormat(device, [
    { photoResolution: { width: 1920, height: 1080 } },
    { videoResolution: { width: 1920, height: 1080 } }
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
    const cameraVisionAutoTriggeredRef = useRef(false);
  const touchlessEnabledRef = useRef(false);
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
  const [backgroundLivenessPassed, setBackgroundLivenessPassed] = useState(false);
  const onBackgroundLivenessChange = Worklets.createRunOnJS((passed: boolean) => {
    setBackgroundLivenessPassed(passed);
  });
  // Last tracked face box from continuous detection — reused during capture to avoid calling detectFaces twice
  const lastTrackedFaceX = useSharedValue(0);
  const lastTrackedFaceY = useSharedValue(0);
  const lastTrackedFaceW = useSharedValue(0);
  const lastTrackedFaceH = useSharedValue(0);
  const hasTrackedFace = useSharedValue(false);

  // PASSIVE LIVENESS HISTORY
  const leftEyeHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  const rightEyeHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  const smileHistory = useSharedValue<number[]>([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  const historyIndex = useSharedValue(0);
  const livenessConsecutiveFrames = useSharedValue(0);
  const consecutiveNoFaceFrames = useSharedValue(0);
  const hasPassedPassiveLiveness = useSharedValue(false);
  const isHumanDetected = useSharedValue(false);

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
    (type: ModalType, title: string, hint: string, autoCloseMs?: number) => {
      modalVisibleRef.current = true;
      setModalType(type);
      setModalTitle(title);
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
    livenessScoreRef.current = null;
    setOfflineModeEnabled(false);

    // Reset liveness state machine
    consecutiveNoFaceFrames.value = 0;
    hasPassedPassiveLiveness.value = false;
    setBackgroundLivenessPassed(false);
    cameraVisionAutoTriggeredRef.current = false;
    consecutiveNoFaceFrames.value = 0;
    setLivenessMessage('Face the camera directly');
    workletPhase.value = 0;

    try { await AsyncStorage.multiRemove(['userId', 'username']); } catch { }
  }, [hasPassedPassiveLiveness, livenessConsecutiveFrames, consecutiveNoFaceFrames]);

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
    touchlessEnabledRef.current = touchless;
    setTouchlessEnabled(touchless);
    setLivenessEnabled(liveness);
    sharedTouchlessEnabled.value = touchless;
    sharedLivenessEnabled.value = liveness;
    sharedFaceEngineIsCameraVision.value = true;
    return { touchless, liveness };
  }, [sharedTouchlessEnabled, sharedLivenessEnabled]);

  // QR resolve
  const resolveUserFromQr = useCallback(async (qrData: string): Promise<ResolvedUser> => {
    try {
      // FORCE SYNC: Add timestamp to URL to bypass any server/proxy cache
      const timestamp = Date.now();
      const response = await fetch(`${BACKEND_URL}/resolve_qr.php?qr=${encodeURIComponent(qrData)}&engine=camera_vision&_t=${timestamp}`, {
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


  // Helper to run ONNX inference and normalize the output
  const runOnnxAndNormalize = async (tensor: Float32Array): Promise<number[]> => {
    const raw = await getEmbedding(tensor);
    if (raw.length < 64) throw new Error('Embedding output is too small');

    // L2 Normalize
    const normalized: number[] = Array.from(raw);
    const norm = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < normalized.length; i++) normalized[i] /= norm;
    }

    if (!isValidEmbeddingVector(normalized)) {
      throw new Error('Captured face data is invalid. Please center your face and try again.');
    }

    return normalized;
  };

  // Photo-based embedding capture: takes a photo, decodes JPEG, runs buffalo_sc ONNX inference.
  const captureEmbeddingFromPhoto = useCallback(async (): Promise<number[]> => {
    if (!cameraRef.current) throw new Error('Camera not ready');
    if (!isModelLoaded()) throw new Error('Face model not loaded');

    console.log('[CameraVision] Taking photo for embedding (buffalo_sc ONNX)...');
    if(!cameraRef.current) throw new Error('Camera not ready');
    const photo = await cameraRef.current.takePhoto({
      flash: 'off',
      enableShutterSound: false,
      enableAutoRedEyeReduction: false,
    });
    if (!photo?.path) throw new Error('No image captured');

    const faceBox = cameraVisionFaceBox;
    console.log(`[CameraVision] Photo raw: ${photo.width}x${photo.height}, Face box: ${faceBox ? `x=${faceBox.left.toFixed(3)} y=${faceBox.top.toFixed(3)} w=${faceBox.width.toFixed(3)} h=${faceBox.height.toFixed(3)}` : 'full frame'}`);

    let imageToProcess = `file://${photo.path}`;

    if (faceBox) {
      // Resolve actual decoded dimensions natively (avoids full ImageManipulator decode)
      let photoW = photo.width;
      let photoH = photo.height;
      try {
        const [resolvedW, resolvedH] = await new Promise<[number, number]>((resolve, reject) => {
          RNImage.getSize(imageToProcess, (w, h) => resolve([w, h]), reject);
        });
        photoW = resolvedW;
        photoH = resolvedH;
      } catch (err) {
        console.warn('[CameraVision] Failed to get image dimensions, using photo metadata:', err);
      }
      
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
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.95, base64: true }
          );
          imageToProcess = manipResult.uri;
          if (manipResult.base64) {
            const tensor = prepareEmbeddingInput(manipResult.base64);
            return await runOnnxAndNormalize(tensor);
          }
        } catch (e) {
          console.warn('[CameraVision] Native crop failed, falling back to full-frame resize:', e);
        }
      }
    }

    // Fallback: no faceBox or crop failed — resize full image to 112px and use base64 path
    try {
      const fallbackResult = await ImageManipulator.manipulateAsync(
        imageToProcess,
        [{ resize: { width: 112 } }],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9, base64: true }
      );
      if (fallbackResult.base64) {
        const tensor = prepareEmbeddingInput(fallbackResult.base64);
        return await runOnnxAndNormalize(tensor);
      }
      imageToProcess = fallbackResult.uri;
    } catch (e) {
      console.warn('[CameraVision] Fallback resize failed:', e);
    }

    // Last resort: fetch file and decode via jpeg-js (only reached if base64 paths all failed)
    const response = await fetch(imageToProcess);
    const jpegBuffer = await response.arrayBuffer();
    const jpegData = new Uint8Array(jpegBuffer);
    const decoded = jpeg.decode(jpegData, { useTArray: true, formatAsRGBA: true });
    const tensor = rgbaBufferToCHWTensor(decoded.data, decoded.width, decoded.height, undefined);
    return await runOnnxAndNormalize(tensor);
  }, [cameraVisionFaceBox]);

  const verifyFaceViaAPI = useCallback(async (liveEmbedding: number[]): Promise<{ ok: boolean; verified: boolean; message?: string; hint?: string; similarity?: number; angle_count?: number; best_angle_index?: number; agreeing_angles?: number } | null> => {
    try {
      const userId = selectedUserRef.current?.userId;
      if (!userId) return null;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${BACKEND_URL}/verify_embedding.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ log_id: userId, live_embedding: liveEmbedding }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const json = await response.json();
      const isVerified = json.verified === true || json.is_match === true;
      console.log(`[Face Verification API] Response:`, { verified: isVerified, similarity: json.similarity, threshold: json.threshold, angle_count: json.angle_count, best_angle: json.best_angle_index });

      if (json.ok === false && json.message) {
        return { ok: false, verified: false, message: json.message, hint: json.hint, similarity: json.similarity, angle_count: json.angle_count, best_angle_index: json.best_angle_index ?? json.best_angle, agreeing_angles: json.agreeing_angles };
      }

      return {
        ok: isVerified,
        verified: isVerified,
        message: isVerified ? undefined : (json.message || `Face does not match. Similarity: ${((json.similarity || 0) * 100).toFixed(0)}%`),
        hint: isVerified ? undefined : (json.hint || 'Ensure good lighting and face the camera directly.'),
        similarity: json.similarity,
        angle_count: json.angle_count,
        best_angle_index: json.best_angle_index ?? json.best_angle,
        agreeing_angles: json.agreeing_angles,
      };
    } catch (err: any) {
      console.log('[Face Verification API] Unavailable, falling back to local:', err?.message);
      return null;
    }
  }, []);

  const verifyFaceLocal = useCallback((liveEmbedding: number[]): { ok: boolean; verified: boolean; message?: string; hint?: string; similarity?: number; angle_count?: number; best_angle_index?: number; agreeing_angles?: number } => {
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

    const ret = {
      ok: isMatched,
      verified: isMatched,
      similarity: result.maxSimilarity,
      angle_count: result.angleCount,
      best_angle_index: result.bestAngleIndex,
      agreeing_angles: agreeingAngles,
    };
    if (isMatched) return ret;
    return {
      ...ret,
      message: 'Verification failed.',
      hint: 'Please try again.',
    };
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

  const recordAttendance = useCallback(async (userId: string, action: 'clock_in' | 'clock_out', location: { address?: string; latitude?: number; longitude?: number } = {}) => {
    if (!userId) return;
    console.log('[Attendance] Recording', { userId, action, location });
    const payload = { 
      user_id: userId, 
      action, 
      ...location 
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    try {
      const res = await fetch(`${BACKEND_URL}/record_attendance.php`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' }, 
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const responseText = await res.text();
      let data: any = {};
      try { data = responseText ? JSON.parse(responseText) : {}; }
      catch { throw new Error(`Attendance response invalid. Status: ${res.status}`); }
      if (!res.ok || !data?.ok) throw new Error(data?.message || `Unable to record attendance (${res.status})`);
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
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

      // HYPER-FAST: Always queue locally first
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

      // Optimistically update local session state
      if (action === 'clock_in') {
        await storeClockInNotification({ date: localDate, timein: localTime });
        await saveStoredSession({ userId: selectedUserRef.current!.userId, username: selectedUserRef.current!.username, name: selectedUserRef.current!.name ?? null, clockInTime: localTime, clockInDate: localDate });
      } else {
        await clearStoredSession(selectedUserRef.current!.userId);
      }

      // Determine true offline status for UI message
      const isActuallyOffline = !isConnected || !hasGoodInternet || offlineModeEnabled;

      setScanStage('success');
      setSuccessAnimationTick((prev) => prev + 1);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await resetAttendanceFlow();
      workletPhase.value = 0; // Reset worklet phase
      
      showModal('success',
        action === 'clock_in'
          ? (isActuallyOffline ? 'Clocked In — Saved Offline' : "You're Clocked In!")
          : (isActuallyOffline ? 'Clocked Out — Saved Offline' : "You're Clocked Out!"),
        isActuallyOffline ? 'Will sync automatically when connected.' : '', 2000);

      // Sync trigger logic:
      if (!isActuallyOffline) {
        // If we are online, ALWAYS auto-sync the queue immediately
        console.log('[Attendance] Online: Triggering automatic sync in background...');
        syncOfflineQueue().catch(e => console.log('[Attendance] Background sync error', e));
      } else {
        // If offline, check settings for auto-sync
        const autoSyncRaw = await AsyncStorage.getItem('settings_auto_sync_enabled');
        if (autoSyncRaw !== 'false') {
          console.log('[Attendance] Offline but auto-sync is enabled. Background sync will retry when connection is back.');
          syncOfflineQueue().catch(e => console.log('[Attendance] Background sync error (safe to ignore)', e));
        } else {
          console.log('[Attendance] Offline and auto-sync is disabled. Record remains pending in offline queue.');
        }
      }

    } catch (e: any) {
      faceProcessingRef.current = false;
      livenessTriggeredRef.current = false;
      setScanStage('idle');
    } finally {
      setIsVerifying(false);
    }
  }, [attendanceAction, clearStoredSession, enqueueOfflineAttendance, isConnected, hasGoodInternet, offlineModeEnabled, refreshPendingSyncCount, resetAttendanceFlow, saveStoredSession, showModal, storeClockInNotification, workletPhase, recordAttendance]);

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
            
            // Check if this shot is already a clear pass under local verification thresholds
            const threshold = MODEL_CONFIG.matchThreshold;
            const subThreshold = MODEL_CONFIG.subThreshold;
            const agreeingAngles = r.perAngleScores.filter((s: number) => s >= subThreshold).length;
            const top2Required = r.angleCount >= 3;
            const top2Agrees = !top2Required || agreeingAngles >= 2;
            const isMatched = r.maxSimilarity >= threshold && top2Agrees;

            if (isMatched && attempt === 1) {
              console.log(`[CameraVision] Shot 1 is a clear pass (${(r.maxSimilarity * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%), skipping shot 2.`);
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
      // Perform authoritative comparison locally to eliminate network latency (<1ms)
      result = verifyFaceLocal(liveEmbedding);
      methodUsed = 'Local (Camera Vision)';
      compareDuration = Date.now() - compareStart;
    } catch (e: any) {
      setIsCapturingHardware(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      identityStatusRef.current = 'failed';
      modalContextRef.current = 'face_error';
      setScanStage('idle');
      showModal('camera_error', 'Camera could not capture', 'Make sure nothing is blocking the lens.', 2000);
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
      if (result?.angle_count != null) {
        console.log(`📐 Angles:      ${result.angle_count} profiles (Best angle: #${result.best_angle_index})`);
        console.log(`🤝 Agreement:   ${result.agreeing_angles ?? 0} matching angles (At least 2 required)`);
        if (!isSuccess && scoreVal >= MODEL_CONFIG.matchThreshold) {
          console.log(`⚠️ Reason:      Failed multi-angle alignment check (less than 2 angles matched above sub-threshold)`);
        }
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
        showModal('face_error', 'Face not recognized', result?.hint || 'Ensure good lighting and try again.', 2000);
      }
    } catch (e: any) {
      identityStatusRef.current = 'failed';
      workletPhase.value = 3;
      setIsVerifying(false);
      faceProcessingRef.current = false; // reset so touchless can auto-retry
      modalContextRef.current = 'face_error';
      setScanStage('idle');
    }
  }, [qrVerified, offlineModeEnabled, verifyFaceLocal, captureEmbeddingFromPhoto, executeAttendanceRecording, showModal, flashAnim, isLikelyConnectivityError, workletPhase]);

  // Main attendance handler (Concurrent Phase 1 & 2)
  const handleAttendance = useCallback(async () => {
    if (faceProcessingRef.current || isVerifying) return;
    if (!qrVerified || !selectedUserRef.current) {
      setScanStage('idle');
      showModal('warning', 'Scan your QR code first', 'Place your personal QR code in front of the camera.');
      return;
    }
    

    if (!hasPermission) {
      setScanStage('idle');
      showModal('warning', 'Camera access is needed', 'Allow camera permission to continue.');
      return;
    }

    if (!offlineModeEnabled) {
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
          'Hold still — face not detected',
          'Center your face with good lighting.',
          1500,
        );
        return;
      }
    }

    faceProcessingRef.current = true;

    if (livenessEnabled) {
      if (hasPassedPassiveLiveness.value) {
        livenessStatusRef.current = 'passed';
        livenessScoreRef.current = 1.0;
        await executeFaceVerification();
      } else {
        // Reject click instantly since background liveness is not passed yet
        faceProcessingRef.current = false;
        showModal(
          'warning',
          'Liveness check pending',
          'Please blink or smile at the camera to verify you are a real person.',
          2000
        );
        return;
      }
    } else {
      await executeFaceVerification();
    }
  }, [attendanceAction, touchlessEnabled, hasPermission, isLikelyConnectivityError, livenessEnabled, offlineModeEnabled, qrVerified, showModal, workletPhase, executeAttendanceRecording, cameraVisionFaceDetected, cameraVisionReadiness, logCameraVisionGateSkip, executeFaceVerification, hasPassedPassiveLiveness]);

  const onFaceDetectedForIdentity = Worklets.createRunOnJS(() => {
    if (!touchlessEnabledRef.current || modalVisibleRef.current || !qrVerified || countdownRef.current > 0 || countdownActive || faceProcessingRef.current || isVerifying) return;
    if (false) return;
    {
      setScanStage('detecting');
      return;
    }
  });
  const onTouchlessFaceLost = Worklets.createRunOnJS(() => {
    if (!touchlessEnabledRef.current || faceProcessingRef.current || isVerifying) return;
    cameraVisionAutoTriggeredRef.current = false;
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
      if (faces.length === 0) {
        consecutiveNoFaceFrames.value += 1;
        if (consecutiveNoFaceFrames.value >= 15) {
          if (hasPassedPassiveLiveness.value) {
            hasPassedPassiveLiveness.value = false;
            onBackgroundLivenessChange(false);
          }
          blinkState.value = 0;
          livenessConsecutiveFrames.value = 0;
        }
      } else {
        consecutiveNoFaceFrames.value = 0;
      }

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
        const isUsable = detectedFace && isFaceBoxUsableForRecognition(detectedFace.box, detectedFace.sourceFace);
        if (isUsable) {
          stableFaceFrames.value = Math.min(stableFaceFrames.value + 1, CAMERA_VISION_STABLE_FACE_FRAMES);
        } else {
          if (stableFaceFrames.value !== 0) {
            stableFaceFrames.value = Math.max(0, stableFaceFrames.value - 1);
          }
        }

          if (detectedFace) {
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
            // Phase 0 completed, waiting for JS thread to trigger handleAttendance and set Phase 2
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

        if (workletPhase.value === 0 || workletPhase.value === 2) {
            if (faces.length > 0) {
              const faceRaw = faces[0];
              const leftEye = typeof faceRaw?.leftEyeOpenProbability === 'number' ? faceRaw.leftEyeOpenProbability : 0.5;
              const rightEye = typeof faceRaw?.rightEyeOpenProbability === 'number' ? faceRaw.rightEyeOpenProbability : 0.5;
              
              const isEyesOpen = leftEye > 0.6 && rightEye > 0.6;
              const isEyesClosed = leftEye < 0.3 && rightEye < 0.3;

              if (!hasPassedPassiveLiveness.value) {
                if (blinkState.value === 0) {
                  if (isEyesOpen) {
                    livenessConsecutiveFrames.value += 1;
                    if (livenessConsecutiveFrames.value >= 3) {
                      blinkState.value = 1; // Ready
                      livenessConsecutiveFrames.value = 0;
                    }
                  } else {
                    livenessConsecutiveFrames.value = 0;
                  }
                  if (workletPhase.value === 0 && sharedLivenessEnabled.value) updateLivenessMessage('Look straight with a neutral face');
                } else if (blinkState.value === 1) {
                  if (isEyesClosed) {
                    livenessConsecutiveFrames.value += 1;
                    if (livenessConsecutiveFrames.value >= 1) { 
                      blinkState.value = 2; // Blink started
                      livenessConsecutiveFrames.value = 0;
                    }
                  } else {
                    livenessConsecutiveFrames.value = 0;
                    if (workletPhase.value === 0 && sharedLivenessEnabled.value) updateLivenessMessage('Please Blink');
                  }
                } else if (blinkState.value === 2) {
                  if (isEyesOpen) {
                    livenessConsecutiveFrames.value += 1;
                    if (livenessConsecutiveFrames.value >= 2) { 
                      blinkState.value = 3; // Blink complete
                      hasPassedPassiveLiveness.value = true;
                      onBackgroundLivenessChange(true);
                    }
                  } else {
                    livenessConsecutiveFrames.value = Math.max(0, livenessConsecutiveFrames.value - 1);
                    if (workletPhase.value === 0 && sharedLivenessEnabled.value) updateLivenessMessage('Open your eyes');
                  }
                }
              }

              if (hasPassedPassiveLiveness.value) {
                 if (workletPhase.value === 0 && sharedLivenessEnabled.value) updateLivenessMessage('Liveness passed! Ready to verify.');
              }
            } else {
               if (workletPhase.value === 0 && sharedLivenessEnabled.value) updateLivenessMessage('Face the camera directly');
            }
        }
      } finally {
        isProcessingFace.value = false;
      }
  }, [detectFaces, sharedTouchlessEnabled, sharedFaceEngineIsCameraVision, onFaceDetectedForIdentity, onTouchlessFaceLost, onCameraVisionDetectionProgress, onBackgroundLivenessChange, updateLivenessMessage, isCapturingHardwareRef, workletPhase, blinkState, isProcessingFace, stableFaceFrames, lastCameraVisionReadinessSent, lastCameraVisionDetectedSent, frameCounter, lastFaceProcessedFrame, lastTrackedFaceX, lastTrackedFaceY, lastTrackedFaceW, lastTrackedFaceH, hasTrackedFace, consecutiveNoFaceFrames, hasPassedPassiveLiveness, sharedLivenessEnabled]);

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
        engine: 'camera_vision',
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
        const hasNeededFaceData = true 
          ? !!cachedUser.face_embedding 
          : true; // Face++ sends the live photo to backend, backend fetches stored face

        // If we are missing the embedding locally, we CANNOT auto-trigger handleAttendance yet.
        // We must wait for the background sync to finish fetching it!
        const shouldWaitSync = currentSettings.touchless && true && !hasNeededFaceData;

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
                        stableFaceFrames.value = 0;
            setCountdownActive(false);
            if (currentSettings.touchless && true) {
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
                stableFaceFrames.value = 0;
        setCountdownActive(false);
        if (currentSettings.touchless && true) {
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
      showModal('qr_error', 'QR code not recognized', 'Make sure you are using a valid employee QR.', 2000);
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

  useEffect(() => {
    if (!qrVerified) {
      Animated.loop(Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])).start();
    } else { 
      scanLineAnim.stopAnimation();
      scanLineAnim.setValue(0); 
    }
  }, [qrVerified, scanLineAnim]);

  useEffect(() => { setIsLoading(false); }, []);

  useEffect(() => {
    if (!countdownActive || !qrVerified || isVerifying) return;
    if (faceCountdown <= 0) return;
    const interval = 500;
    const step = 0.5;
    const timer = setTimeout(() => {
      const next = Math.max(0, faceCountdown - step);
      setFaceCountdown(next);
      countdownRef.current = next;
    }, interval);
    return () => clearTimeout(timer);
  }, [countdownActive, qrVerified, isVerifying, faceCountdown]);

  useEffect(() => {
    if (!countdownActive || !touchlessEnabled || !qrVerified) return;
    if (showResultModal || modalVisibleRef.current) return;
    if (faceCountdown > 0 || isVerifying || faceProcessingRef.current) return;
    setCountdownActive(false);
        setScanStage('capturing');
    handleAttendance();
  }, [countdownActive, faceCountdown, handleAttendance, isVerifying, qrVerified, showResultModal, touchlessEnabled]);

  useEffect(() => {
    if (!touchlessEnabled || !qrVerified) return;
    return;
    if (isVerifying || faceProcessingRef.current || showResultModal || modalVisibleRef.current) return;
        
        setScanStage('capturing');
    handleAttendance();
  }, [handleAttendance, isVerifying, qrVerified, showResultModal, touchlessEnabled]);

  useEffect(() => {
    if (!touchlessEnabled || !qrVerified) return;
    
    if (isVerifying || faceProcessingRef.current || showResultModal || modalVisibleRef.current) return;

    setScanStage('detecting');
    const autoReadinessThreshold = CAMERA_VISION_TOUCHLESS_MIN_READINESS_TO_VERIFY;

    if (
      cameraVisionFaceDetected &&
      cameraVisionReadiness >= autoReadinessThreshold &&
      !cameraVisionAutoTriggeredRef.current
    ) {
      if (livenessEnabled && !backgroundLivenessPassed) {
        return; // Gated: wait for liveness
      }

      cameraVisionAutoTriggeredRef.current = true;
      setScanStage('capturing');
      handleAttendance();
      return;
    }

    if (
      !cameraVisionFaceDetected ||
      cameraVisionReadiness < Math.max(12, autoReadinessThreshold - 15)
    ) {
      cameraVisionAutoTriggeredRef.current = false;
    }
  }, [
    cameraVisionFaceDetected,
    cameraVisionReadiness,
    backgroundLivenessPassed,
    livenessEnabled,
    handleAttendance,
    isVerifying,
    qrVerified,
    showResultModal,
    touchlessEnabled,
  ]);

  useEffect(() => {
        if (countdownRef.current > 0 || countdownActive || faceCountdown > 0) {
      setFaceCountdown(0);
      countdownRef.current = 0;
      setCountdownActive(false);
    }
  }, []);

  useEffect(() => {
    touchlessEnabledRef.current = touchlessEnabled;
    sharedTouchlessEnabled.value = touchlessEnabled;
  }, [touchlessEnabled]);

  useEffect(() => {
            lastCameraVisionReadinessSent.value = -1;
    lastCameraVisionDetectedSent.value = false;
  }, []);

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
  const isOnline = isConnected && hasGoodInternet;

  return {
    colors, device, hasPermission, requestPermission,
    hasLocationPermission, requestLocationPermission,
    cameraFormat, cameraRef, codeScanner, frameProcessor,
    flashAnim, scanLineAnim, scaleAnim,
    formattedTime, formattedDate,
    isLoading, isVerifying, isQrLoading, isClockingOut, isCapturingHardware: uiCapturingHardware,
    qrVerified, qrSuccessLocal, selectedUser, clockInTime: displayClockInTime, faceCountdown,
    touchlessEnabled, offlineModeEnabled, livenessEnabled, pendingSyncCount, isOnline,
    scanStage, cameraVisionFaceDetected, cameraVisionReadiness, cameraVisionFaceBox, cameraVisionAllFaces, cameraVisionFaceTelemetry, successAnimationTick,
    showResultModal, modalType, modalTitle, modalMessage: '', modalHint, livenessMessage,
    closeModal, handleAttendance, resetAttendanceFlow, backgroundLivenessPassed,
  };
}
