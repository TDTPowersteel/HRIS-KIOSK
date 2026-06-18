import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, CameraProps } from 'react-native-vision-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import AnimatedReanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { styles } from './style/FaceScanViewStyle';
import { useTheme } from '../../config/theme';
import type { ResolvedUser } from './types';
import type { CameraVisionFaceTelemetry, FaceScanStage } from './types';

type Props = {
  device: CameraProps['device'];
  cameraFormat?: CameraProps['format'];
  cameraRef: React.RefObject<Camera | null>;
  frameProcessor: any;
  flashAnim: Animated.Value;
  formattedTime: string;
  formattedDate: string;
  isVerifying: boolean;
  isCapturingHardware: boolean;
  isClockingOut: boolean;
  touchlessEnabled: boolean;
  offlineModeEnabled: boolean;
  isOnline: boolean;
  livenessEnabled: boolean;
  scanStage: FaceScanStage;
  cameraVisionFaceDetected: boolean;
  cameraVisionReadiness: number;
  backgroundLivenessPassed: boolean;
  cameraVisionFaceBox: { left: number; top: number; width: number; height: number; frameWidth?: number; frameHeight?: number } | null;
  cameraVisionAllFaces?: Array<{ id: string; left: number; top: number; width: number; height: number; isTarget: boolean; frameWidth?: number; frameHeight?: number }> | null;
  cameraVisionFaceTelemetry: CameraVisionFaceTelemetry | null;
  successAnimationTick: number;
  pendingSyncCount: number;
  faceCountdown: number;
  clockInTime: string;
  selectedUser: ResolvedUser | null;
  accentColor: string;
  livenessMessage: string;
  showTelemetry?: boolean;
  showResultModal?: boolean;
  onBack: () => void;
  onOpenOffline: () => void;
  onAttendance: () => void;
};

export default function FaceScanView({
  device,
  cameraFormat,
  cameraRef,
  frameProcessor,
  flashAnim,
  formattedTime,
  formattedDate,
  isVerifying,
  isCapturingHardware,
  isClockingOut,
  touchlessEnabled,
  offlineModeEnabled,
  isOnline,
  livenessEnabled,
  scanStage,
  cameraVisionFaceDetected,
  cameraVisionReadiness,
  backgroundLivenessPassed,
  cameraVisionFaceBox,
  cameraVisionAllFaces = [],
  cameraVisionFaceTelemetry,
  successAnimationTick,
  pendingSyncCount,
  faceCountdown,
  clockInTime,
  selectedUser,
  accentColor,
  livenessMessage,
  showTelemetry = false,
  showResultModal = false,
  onBack,
  onOpenOffline,
  onAttendance,
}: Props) {
  const { theme, colors } = useTheme();

  const isThemeLight = theme === 'light';
  const profileBgColor = isThemeLight ? '#F4EFE6' : colors.surface;
  const nameTextColor = isThemeLight ? colors.text : '#fff';
  const roleTextColor = isThemeLight ? colors.textSecondary : 'rgba(255,255,255,0.7)';
  const iconColor = isThemeLight ? colors.text : '#fff';
  const placeholderBg = isThemeLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.2)';
  const portraitBorderColor = isThemeLight ? colors.border : '#fff';

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [overlaySize, setOverlaySize] = useState({ width, height });

  const [orientation, setOrientation] = useState<ScreenOrientation.Orientation>(
    ScreenOrientation.Orientation.PORTRAIT_UP
  );

  useEffect(() => {
    let subscription: ScreenOrientation.Subscription;
    ScreenOrientation.getOrientationAsync().then(setOrientation);
    subscription = ScreenOrientation.addOrientationChangeListener((evt) => {
      setOrientation(evt.orientationInfo.orientation);
    });
    return () => {
      ScreenOrientation.removeOrientationChangeListener(subscription);
    };
  }, []);

  const successScale = useState(() => new Animated.Value(0.75))[0];
  useEffect(() => {
    if (scanStage !== 'success') return;
    successScale.setValue(0.75);
    Animated.sequence([
      Animated.spring(successScale, { toValue: 1.15, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.spring(successScale, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
    ]).start();
  }, [scanStage, successAnimationTick, successScale]);

  const isCameraVisionMode = true;
  const isFrontCamera = device?.position === 'front';
  const detectionPercent = Math.max(0, Math.min(100, Math.round(cameraVisionReadiness)));
  const overlayWidth = overlaySize.width > 0 ? overlaySize.width : (isLandscape ? Math.round(width * 0.6) : width);
  const overlayHeight = overlaySize.height > 0 ? overlaySize.height : height;

  const requiresAndroidRotationFix = Platform.OS === 'android';

  const getDynamicCameraStyle = () => {
    if (!requiresAndroidRotationFix) return styles.fullScreenCamera;

    if (orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) {
      return {
        position: 'absolute' as const,
        width: overlayHeight,
        height: overlayWidth,
        top: (overlayHeight - overlayWidth) / 2,
        left: (overlayWidth - overlayHeight) / 2,
        transform: [{ rotate: '90deg' }],
        overflow: 'hidden' as const
      };
    } else if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
      return {
        position: 'absolute' as const,
        width: overlayHeight,
        height: overlayWidth,
        top: (overlayHeight - overlayWidth) / 2,
        left: (overlayWidth - overlayHeight) / 2,
        transform: [{ rotate: '-90deg' }],
        overflow: 'hidden' as const
      };
    } else if (orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
      return [styles.fullScreenCamera, { transform: [{ rotate: '180deg' }], overflow: 'hidden' as const }];
    }
    return styles.fullScreenCamera;
  };

  const fallbackFaceBoxNormalized = { left: 0.42, top: 0.08, width: 0.36, height: 0.5 };
  const fallbackFaceBoxPx = {
    left: Math.round(overlayWidth * fallbackFaceBoxNormalized.left),
    top: Math.round(overlayHeight * fallbackFaceBoxNormalized.top),
    width: Math.round(overlayWidth * fallbackFaceBoxNormalized.width),
    height: Math.round(overlayHeight * fallbackFaceBoxNormalized.height),
  };

  const handleOverlayLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (nextWidth > 0 && nextHeight > 0) {
      setOverlaySize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight },
      );
    }
  };

  const animatedFaceBoxLeft = useSharedValue(fallbackFaceBoxPx.left);
  const animatedFaceBoxTop = useSharedValue(fallbackFaceBoxPx.top);
  const animatedFaceBoxWidth = useSharedValue(fallbackFaceBoxPx.width);
  const animatedFaceBoxHeight = useSharedValue(fallbackFaceBoxPx.height);

  const mapFaceBoxToPx = (box: { left: number; top: number; width: number; height: number; frameWidth?: number; frameHeight?: number }) => {
    let nextPx: { left: number; top: number; width: number; height: number };
    if (box.width <= 1 && box.height <= 1) {
      const sourceFrameWidth = box.frameWidth || overlayWidth;
      const sourceFrameHeight = box.frameHeight || overlayHeight;
      const isRotated = (sourceFrameWidth > sourceFrameHeight && overlayWidth < overlayHeight) ||
        (sourceFrameWidth < sourceFrameHeight && overlayWidth > overlayHeight);

      // 1. Raw face coordinates from detector
      let rawX = box.left;
      let rawY = box.top;
      let rawW = box.width;
      let rawH = box.height;

      // 2. Map coordinates to screen space
      let nx = rawX;
      let ny = rawY;
      let nw = rawW;
      let nh = rawH;

      if (isRotated) {
        if (orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) {
          nx = 1 - (rawY + rawH);
          ny = rawX;
          nw = rawH;
          nh = rawW;
        } else if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
          nx = rawY;
          ny = 1 - (rawX + rawW);
          nw = rawH;
          nh = rawW;
        } else if (orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
          nx = 1 - (rawY + rawH);
          ny = 1 - rawX;
          nw = rawH;
          nh = rawW;
        } else {
          // PORTRAIT_UP: 90° CW rotation from landscape sensor to portrait screen
          nx = rawY;
          ny = rawX;
          nw = rawH;
          nh = rawW;
        }
      } else if (orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
        nx = 1 - (rawX + rawW);
        ny = 1 - (rawY + rawH);
      }

      // 3. Apply horizontal mirroring in screen space for front camera
      if (isFrontCamera) {
        nx = 1 - (nx + nw);
      }

      const orientedFrameWidth = isRotated ? sourceFrameHeight : sourceFrameWidth;
      const orientedFrameHeight = isRotated ? sourceFrameWidth : sourceFrameHeight;

      let mapped = {
        left: nx,
        top: ny,
        width: nw,
        height: nh,
      };

      const coverScale = Math.max(overlayWidth / orientedFrameWidth, overlayHeight / orientedFrameHeight);
      const renderedW = orientedFrameWidth * coverScale;
      const renderedH = orientedFrameHeight * coverScale;
      const cropOffsetX = (overlayWidth - renderedW) / 2;
      const cropOffsetY = (overlayHeight - renderedH) / 2;

      nextPx = {
        left: Math.round(mapped.left * orientedFrameWidth * coverScale + cropOffsetX),
        top: Math.round(mapped.top * orientedFrameHeight * coverScale + cropOffsetY),
        width: Math.round(mapped.width * orientedFrameWidth * coverScale),
        height: Math.round(mapped.height * orientedFrameHeight * coverScale),
      };
    } else {
      nextPx = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      };
    }

    const minSize = 42;
    const faceSizePx = Math.max(nextPx.width, nextPx.height);
    const uiSide = faceSizePx * 0.85;

    const clampedWidth = Math.max(minSize, Math.min(overlayWidth, uiSide));
    const clampedHeight = Math.max(minSize, Math.min(overlayHeight, uiSide));
    const centerX = nextPx.left + nextPx.width / 2;
    const centerY = nextPx.top + nextPx.height / 2;
    const clampedLeft = clamp(centerX - clampedWidth / 2, 0, Math.max(0, overlayWidth - clampedWidth));
    const clampedTop = clamp(centerY - clampedHeight / 2, 0, Math.max(0, overlayHeight - clampedHeight));

    return {
      left: clampedLeft,
      top: clampedTop,
      width: clampedWidth,
      height: clampedHeight,
    };
  };

  useEffect(() => {
    const animation = { duration: 80 };
    if (!cameraVisionFaceBox) {
      animatedFaceBoxLeft.value = withTiming(fallbackFaceBoxPx.left, animation);
      animatedFaceBoxTop.value = withTiming(fallbackFaceBoxPx.top, animation);
      animatedFaceBoxWidth.value = withTiming(fallbackFaceBoxPx.width, animation);
      animatedFaceBoxHeight.value = withTiming(fallbackFaceBoxPx.height, animation);
      return;
    }

    const px = mapFaceBoxToPx(cameraVisionFaceBox);
    animatedFaceBoxLeft.value = withTiming(px.left, animation);
    animatedFaceBoxTop.value = withTiming(px.top, animation);
    animatedFaceBoxWidth.value = withTiming(px.width, animation);
    animatedFaceBoxHeight.value = withTiming(px.height, animation);
  }, [cameraVisionFaceBox, overlayWidth, overlayHeight, isFrontCamera, fallbackFaceBoxPx]);

  const animatedFaceBoxStyle = useAnimatedStyle(() => {
    return {
      left: animatedFaceBoxLeft.value,
      top: animatedFaceBoxTop.value,
      width: animatedFaceBoxWidth.value,
      height: animatedFaceBoxHeight.value,
    };
  });

  const showProcessingSpinner = isCapturingHardware || isVerifying || scanStage === 'capturing' || scanStage === 'verifying' || scanStage === 'recording';
  const showDetectionOverlay = isCameraVisionMode && cameraVisionFaceDetected && !!cameraVisionFaceBox && !showProcessingSpinner && scanStage !== 'success' && !showResultModal;
  const isLivenessPending = livenessEnabled && !backgroundLivenessPassed;

  const animatedStatusCardStyle = useAnimatedStyle(() => {
    const cardHeight = 74;
    const margin = 6;
    return {
      left: animatedFaceBoxLeft.value + margin,
      top: animatedFaceBoxTop.value + animatedFaceBoxHeight.value - cardHeight - margin,
      opacity: (showDetectionOverlay && showTelemetry) ? 1 : 0,
    };
  });

  const animatedInstructionCardStyle = useAnimatedStyle(() => {
    return {
      left: animatedFaceBoxLeft.value - 40,
      top: animatedFaceBoxTop.value - 50,
      width: animatedFaceBoxWidth.value + 80,
      opacity: (showDetectionOverlay && livenessEnabled) ? 1 : 0,
      alignItems: 'center',
      justifyContent: 'center',
    };
  });

  const [eyeStatusLabel, setEyeStatusLabel] = useState('Unknown');
  const eyesClosedSinceRef = useRef<number | null>(null);
  useEffect(() => {
    const left = cameraVisionFaceTelemetry?.leftEyeOpenProbability;
    const right = cameraVisionFaceTelemetry?.rightEyeOpenProbability;
    if (typeof left === 'number' && typeof right === 'number') {
      const now = Date.now();
      const eyesClosed = left < 0.35 && right < 0.35;
      const eyesOpen = left > 0.55 && right > 0.55;
      if (eyesClosed) {
        if (!eyesClosedSinceRef.current) eyesClosedSinceRef.current = now;
        setEyeStatusLabel((now - eyesClosedSinceRef.current) >= 1000 ? 'Closed' : 'Blinking');
      } else if (eyesOpen) {
        eyesClosedSinceRef.current = null;
        setEyeStatusLabel('Open');
      } else {
        eyesClosedSinceRef.current = null;
        setEyeStatusLabel('Blinking');
      }
    } else {
      eyesClosedSinceRef.current = null;
      setEyeStatusLabel(cameraVisionFaceTelemetry?.eyeStatus === 'open' ? 'Open' : (cameraVisionFaceTelemetry?.eyeStatus === 'mixed' || cameraVisionFaceTelemetry?.eyeStatus === 'closed' ? 'Blinking' : 'Unknown'));
    }
  }, [cameraVisionFaceTelemetry]);

  const getYawLabel = (yaw: number | null | undefined) => {
    if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return '--';
    const rounded = Math.round(yaw);
    if (yaw > 12) return `Left (${rounded}°)`;
    if (yaw < -12) return `Right (${rounded}°)`;
    return `Center (${rounded}°)`;
  };
  const getPitchLabel = (pitch: number | null | undefined) => {
    if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return '--';
    const rounded = Math.round(pitch);
    if (pitch > 12) return `Up (${rounded}°)`;
    if (pitch < -12) return `Down (${rounded}°)`;
    return `Center (${rounded}°)`;
  };
  const yawLabel = getYawLabel(cameraVisionFaceTelemetry?.yaw);
  const pitchLabel = getPitchLabel(cameraVisionFaceTelemetry?.pitch);

  const isFaceStraight = (() => {
    if (!cameraVisionFaceTelemetry) return true;
    const yaw = cameraVisionFaceTelemetry.yaw;
    const pitch = cameraVisionFaceTelemetry.pitch;
    if (typeof yaw === 'number' && (yaw > 12 || yaw < -12)) return false;
    if (typeof pitch === 'number' && (pitch > 12 || pitch < -12)) return false;
    return true;
  })();

  const instructionText = (() => {
    if (scanStage === 'success') return 'FACE VERIFIED';
    if (showProcessingSpinner) return isClockingOut ? 'PROCESSING LOGOUT...' : 'VERIFYING IDENTITY...';
    if (isCameraVisionMode && scanStage === 'detecting') {
      if (!cameraVisionFaceDetected) return 'SEARCHING FOR FACE...';
      if (!isFaceStraight) return 'PLEASE LOOK STRAIGHT TO THE CAMERA';
      if (livenessEnabled) {
        if (!backgroundLivenessPassed) return livenessMessage.toUpperCase();
        return 'LIVENESS VERIFIED • SCAN NOW';
      }
      return `FACE READY ${detectionPercent}%`;
    }
    if (faceCountdown > 0 && touchlessEnabled) return `GET READY... ${faceCountdown}`;
    return 'LOOK AT THE CAMERA';
  })();

  const hintText = (() => {
    if (scanStage === 'success') return 'Success';
    if (showProcessingSpinner) return 'Please wait...';
    if (isCameraVisionMode && scanStage === 'detecting') {
      if (!cameraVisionFaceDetected) return 'Center your face in the frame';
      if (!isFaceStraight) {
        const yaw = cameraVisionFaceTelemetry?.yaw;
        const pitch = cameraVisionFaceTelemetry?.pitch;
        if (typeof yaw === 'number' && yaw > 12) return 'Turn your face slightly to the right';
        if (typeof yaw === 'number' && yaw < -12) return 'Turn your face slightly to the left';
        if (typeof pitch === 'number' && pitch > 12) return 'Lower your chin slightly';
        if (typeof pitch === 'number' && pitch < -12) return 'Raise your chin slightly';
        return 'Look directly at the camera';
      }
      return 'Hold steady for automatic capture';
    }
    if (faceCountdown > 0) return 'Position your face';
    return livenessMessage;
  })();

  const renderDetectionOverlay = () => {
    if (!showDetectionOverlay) return null;
    return (
      <View style={styles.fullScreenDetectionOverlay} pointerEvents="none">
        {/* Bystander faces overlay removed for A7 Lite performance */}
        {(() => {
          const isFaceReady = livenessEnabled ? backgroundLivenessPassed : (detectionPercent === 100);
          return (
            <AnimatedReanimated.View style={[styles.detectionFaceBox, (cameraVisionFaceDetected && isFaceReady) && styles.detectionFaceBoxActive, animatedFaceBoxStyle]} />
          );
        })()}
        
        <AnimatedReanimated.View style={[{ position: 'absolute' }, animatedInstructionCardStyle]}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.5 }}>
              {instructionText}
            </Text>
          </View>
        </AnimatedReanimated.View>

        {showTelemetry && (
          <AnimatedReanimated.View style={[styles.detectionStatusCard, animatedStatusCardStyle]}>
            <Text style={styles.detectionStatusText}>Horizontal: {yawLabel}</Text>
            <Text style={styles.detectionStatusText}>Vertical: {pitchLabel}</Text>
          </AnimatedReanimated.View>
        )}
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.newHeader}>
      <View style={styles.headerLeft}>
        <TouchableOpacity onPress={onBack} style={[styles.headerIconButton, showProcessingSpinner && { opacity: 0.5 }]} disabled={showProcessingSpinner}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenOffline} style={[styles.headerIconButton, styles.marginLeft10, showProcessingSpinner && { opacity: 0.5 }]} disabled={showProcessingSpinner}>
          <MaterialCommunityIcons name="history" size={22} color="#fff" />
          {pendingSyncCount > 0 && <View style={styles.headerSyncBadge} />}
        </TouchableOpacity>
      </View>
      <View style={styles.headerCenter}>
        <Text style={[styles.topTime, width < 380 && { fontSize: 24 }]}>{formattedTime}</Text>
        <Text style={styles.topDate}>{formattedDate}</Text>
      </View>
      <View style={styles.headerRight}>
        <View style={[styles.miniOfflineBadge, !isOnline && styles.miniOfflineBadgeActive]}>
          <MaterialCommunityIcons name={!isOnline ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" />
          <Text style={styles.miniOfflineText}>{!isOnline ? 'OFFLINE' : 'ONLINE'}</Text>
        </View>
      </View>
    </View>
  );

  const renderProfileBar = () => (
    <View style={[styles.portraitProfileBar, { backgroundColor: profileBgColor }]}>
      {selectedUser?.profile_picture ? (
        <Image source={{ uri: selectedUser.profile_picture }} style={[styles.portraitProfileImage, { borderColor: portraitBorderColor }]} />
      ) : (
        <View style={[styles.portraitProfilePlaceholder, { backgroundColor: placeholderBg, borderColor: portraitBorderColor }]}>
          <MaterialCommunityIcons name="account" size={28} color={iconColor} />
        </View>
      )}
      <View style={styles.portraitProfileInfo}>
        <Text style={[styles.portraitProfileName, { color: nameTextColor }]} numberOfLines={1}>{selectedUser?.name || selectedUser?.username || (selectedUser?.isIntern ? 'Intern' : 'Employee')}</Text>
        <Text style={[styles.portraitProfileRole, { color: roleTextColor }]} numberOfLines={1}>{selectedUser?.role || 'Staff'} • {selectedUser?.department || 'Dept'}</Text>
      </View>
      {isClockingOut && clockInTime ? (
        <View style={[styles.clockInTimeContainer, { backgroundColor: isThemeLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.2)', marginTop: 0 }]}>
          <MaterialCommunityIcons name="clock-outline" size={14} color={roleTextColor} />
          <Text style={[styles.clockInTimeTextMini, { color: roleTextColor }]}>{clockInTime}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderScannerArea = (isRight = false) => (
    <View style={isRight ? styles.faceScannerAreaRight : styles.faceScannerArea}>
      <View style={styles.faceFrame}>
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
        {scanStage === 'success' ? (
          <Animated.View style={[styles.successIconWrap, { transform: [{ scale: successScale }] }]}>
            <MaterialCommunityIcons name="check-circle" size={118} color="#4ade80" />
          </Animated.View>
        ) : showProcessingSpinner ? (
          <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
        ) : (faceCountdown > 0 && touchlessEnabled) ? (
          <Text style={styles.countdownText}>{faceCountdown}</Text>
        ) : null}
      </View>
      {(!showDetectionOverlay || !livenessEnabled) && (
        <Text style={isRight ? styles.scanInstructionTextRight : styles.scanInstructionText}>{instructionText}</Text>
      )}
      <Text style={isRight ? styles.faceHintTextRight : styles.faceHintText}>{hintText}</Text>
    </View>
  );

  if (!isLandscape) {
    return (
      <View style={styles.portraitFaceContainer} onLayout={handleOverlayLayout}>
        <View style={getDynamicCameraStyle()}>
          <Camera ref={cameraRef} style={styles.fullScreenCamera} device={device} format={cameraFormat} isActive={true} photo={true} pixelFormat="yuv" frameProcessor={frameProcessor} androidPreviewViewType="texture-view" outputOrientation="device" resizeMode="cover" photoQualityBalance="speed" />
        </View>
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />
        {renderDetectionOverlay()}
        <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'left', 'right', 'bottom']}>
          <View>
            {renderHeader()}
            {renderProfileBar()}
          </View>
          <View style={styles.scannerOverlayContainer}>
            {renderScannerArea()}
          </View>
          <View style={styles.portraitFooter}>
            {showProcessingSpinner ? (
              <View style={styles.verifyingPill}>
                <ActivityIndicator size="small" color="#F27121" />
                <Text style={styles.verifyingPillText}>{scanStage === 'capturing' ? 'Capturing...' : isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}</Text>
              </View>
            ) : (!touchlessEnabled && (
              <View style={styles.footerButtons}>
                <TouchableOpacity style={[styles.mainActionButton, isClockingOut ? styles.mainActionButtonClockOut : { backgroundColor: accentColor }, (isVerifying || isCapturingHardware || isLivenessPending) && { opacity: 0.5, backgroundColor: '#9CA3AF' }]} onPress={onAttendance} disabled={isVerifying || isCapturingHardware || isLivenessPending}>
                  <Text style={styles.mainActionButtonText}>{isClockingOut ? 'CONFIRM CLOCK OUT' : 'CONFIRM CLOCK IN'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.splitScreenContainer}>
      <View style={[styles.employeeDetailPanel, { backgroundColor: profileBgColor }]}>
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'bottom']}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }} showsVerticalScrollIndicator={false}>
            <View>
              <View style={styles.employeeDetailPanelHeader}>
                <TouchableOpacity onPress={onBack} style={[styles.headerIconButtonLight, { backgroundColor: isThemeLight ? '#fff' : colors.background }, showProcessingSpinner && { opacity: 0.5 }]} disabled={showProcessingSpinner}><MaterialCommunityIcons name="chevron-left" size={28} color={iconColor} /></TouchableOpacity>
                <TouchableOpacity onPress={onOpenOffline} style={[styles.headerIconButtonLight, styles.marginLeft10, { backgroundColor: isThemeLight ? '#fff' : colors.background }, showProcessingSpinner && { opacity: 0.5 }]} disabled={showProcessingSpinner}><MaterialCommunityIcons name="history" size={22} color={iconColor} />{pendingSyncCount > 0 && <View style={styles.headerSyncBadge} />}</TouchableOpacity>
              </View>
              <View style={styles.profileInfoContainer}>
                <View style={styles.profileImageContainer}>
                  {selectedUser?.profile_picture ? <Image source={{ uri: selectedUser.profile_picture }} style={[styles.profileImage, { borderColor: portraitBorderColor }]} /> : <View style={[styles.profileImagePlaceholder, { backgroundColor: placeholderBg, borderColor: portraitBorderColor }]}><MaterialCommunityIcons name="account" size={100} color={iconColor} /></View>}
                </View>
                <Text style={[styles.profileName, { color: nameTextColor }]}>{selectedUser?.name || selectedUser?.username || (selectedUser?.isIntern ? 'Intern' : 'Employee')}</Text>
                <Text style={[styles.profileRole, { color: roleTextColor }]}>{selectedUser?.role || 'Staff Member'}</Text>
                <Text style={[styles.profileDept, { color: roleTextColor }]}>{selectedUser?.department || 'Department'}</Text>
                {isClockingOut && clockInTime ? <View style={[styles.clockInTimeContainer, { backgroundColor: isThemeLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.2)' }]}><MaterialCommunityIcons name="clock-outline" size={18} color={roleTextColor} /><Text style={[styles.clockInTimeText, { color: roleTextColor }]}>Clocked In at: {clockInTime}</Text></View> : null}
              </View>
            </View>
            <View style={styles.employeeDetailPanelFooter}>
              {showProcessingSpinner ? (
                <View style={[styles.verifyingPillLeft, { backgroundColor: isThemeLight ? '#fff' : colors.background }]}><ActivityIndicator size="small" color={accentColor} /><Text style={[styles.verifyingPillTextLeft, { color: accentColor }]}>{scanStage === 'capturing' ? 'Capturing...' : isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}</Text></View>
              ) : (!touchlessEnabled && <TouchableOpacity style={[styles.mainActionButtonLeft, isClockingOut ? styles.mainActionButtonLeftClockOut : [styles.mainActionButtonLeftClockIn, { backgroundColor: colors.accent }], (isVerifying || isCapturingHardware || isLivenessPending) && { opacity: 0.5, backgroundColor: '#9CA3AF' }]} onPress={onAttendance} disabled={isVerifying || isCapturingHardware || isLivenessPending}><Text style={[styles.mainActionButtonTextLeft, isClockingOut ? styles.mainActionButtonTextLeftClockOut : { color: '#fff' }]}>{isClockingOut ? 'CONFIRM CLOCK OUT' : 'CONFIRM CLOCK IN'}</Text></TouchableOpacity>)}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
      <View style={styles.cameraPanel} onLayout={handleOverlayLayout}>
        <View style={getDynamicCameraStyle()}>
          <Camera ref={cameraRef} style={styles.fullScreenCamera} device={device} format={cameraFormat} isActive={true} photo={true} pixelFormat="yuv" frameProcessor={frameProcessor} androidPreviewViewType="texture-view" outputOrientation="device" resizeMode="cover" photoQualityBalance="speed" />
        </View>
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />
        {renderDetectionOverlay()}
        <SafeAreaView style={styles.cameraSafeArea} edges={['top', 'right', 'bottom']}>
          <View style={styles.cameraPanelHeader}>
            <View style={styles.headerCenterRight}><Text style={styles.topTimeRight}>{formattedTime}</Text><Text style={styles.topDateRight}>{formattedDate}</Text></View>
            <View style={[styles.miniOfflineBadge, !isOnline && styles.miniOfflineBadgeActive]}><MaterialCommunityIcons name={!isOnline ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" /><Text style={styles.miniOfflineText}>{!isOnline ? 'OFFLINE' : 'ONLINE'}</Text></View>
          </View>
          <View style={styles.faceScannerAreaRight}>
            {renderScannerArea(true)}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
