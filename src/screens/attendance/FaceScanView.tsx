import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, CameraProps } from 'react-native-vision-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import AnimatedReanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { styles } from './styles';
import type { ResolvedUser } from './types';
import type { FaceEngine } from '../settings/features/FaceRecogEngineFeature';
import type { CameraVisionFaceTelemetry, FaceScanStage } from './types';

type Props = {
  device: CameraProps['device'];
  cameraRef: React.RefObject<Camera | null>;
  frameProcessor: any;
  flashAnim: Animated.Value;
  scanLineAnim: Animated.Value;
  formattedTime: string;
  formattedDate: string;
  isVerifying: boolean;
  isCapturingHardware: boolean;
  isClockingOut: boolean;
  touchlessEnabled: boolean;
  offlineModeEnabled: boolean;
  livenessEnabled: boolean;
  faceEngine: FaceEngine;
  scanStage: FaceScanStage;
  cameraVisionFaceDetected: boolean;
  cameraVisionReadiness: number;
  cameraVisionFaceBox: { left: number; top: number; width: number; height: number; frameWidth?: number; frameHeight?: number } | null;
  cameraVisionFaceTelemetry: CameraVisionFaceTelemetry | null;
  successAnimationTick: number;
  pendingSyncCount: number;
  faceCountdown: number;
  clockInTime: string;
  selectedUser: ResolvedUser | null;
  accentColor: string;
  livenessMessage: string;
  onBack: () => void;
  onOpenOffline: () => void;
  onAttendance: () => void;
};

export default function FaceScanView({
  device,
  cameraRef,
  frameProcessor,
  flashAnim,
  scanLineAnim,
  formattedTime,
  formattedDate,
  isVerifying,
  isCapturingHardware,
  isClockingOut,
  touchlessEnabled,
  offlineModeEnabled,
  livenessEnabled,
  faceEngine,
  scanStage,
  cameraVisionFaceDetected,
  cameraVisionReadiness,
  cameraVisionFaceBox,
  cameraVisionFaceTelemetry,
  successAnimationTick,
  pendingSyncCount,
  faceCountdown,
  clockInTime,
  selectedUser,
  accentColor,
  livenessMessage,
  onBack,
  onOpenOffline,
  onAttendance,
}: Props) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const rotateNormalizedBox = (
    box: { left: number; top: number; width: number; height: number },
    rotation: 0 | 90 | -90 | 180,
  ) => {
    if (rotation === 90) {
      return {
        left: box.top,
        top: 1 - (box.left + box.width),
        width: box.height,
        height: box.width,
      };
    }
    if (rotation === -90) {
      return {
        left: 1 - (box.top + box.height),
        top: box.left,
        width: box.height,
        height: box.width,
      };
    }
    if (rotation === 180) {
      return {
        left: 1 - (box.left + box.width),
        top: 1 - (box.top + box.height),
        width: box.width,
        height: box.height,
      };
    }
    return box;
  };
  const mirrorNormalizedBoxX = (box: { left: number; top: number; width: number; height: number }) => ({
    left: 1 - (box.left + box.width),
    top: box.top,
    width: box.width,
    height: box.height,
  });

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= 600;
  const [overlaySize, setOverlaySize] = useState({ width, height });

  // Track the actual device orientation via Expo to apply manual rotation fixes on Android
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

  // Determine if we need to apply a manual rotation fix for Android + FrameProcessor
  const requiresAndroidRotationFix = Platform.OS === 'android' && (livenessEnabled || faceEngine === 'camera_vision');
  
  // Calculate scale to prevent squishing when applying CSS rotation to a non-square container
  const cameraContainerWidth = isLandscape ? width * 0.6 : width;
  const cameraContainerHeight = height;
  const scaleRatio = Math.max(
    cameraContainerWidth / cameraContainerHeight,
    cameraContainerHeight / cameraContainerWidth
  );
  
  let cameraTransform: any[] = [];
  if (requiresAndroidRotationFix) {
    if (orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) {
      cameraTransform = [{ rotate: '90deg' }, { scale: scaleRatio }];
    } else if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
      cameraTransform = [{ rotate: '-90deg' }, { scale: scaleRatio }];
    } else if (orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
      cameraTransform = [{ rotate: '180deg' }];
    }
  }

  const isCameraVisionMode = faceEngine === 'camera_vision';
  const isFrontCamera = device?.position === 'front';
  const detectionPercent = Math.max(0, Math.min(100, Math.round(cameraVisionReadiness)));
  const overlayWidth = overlaySize.width > 0 ? overlaySize.width : (isLandscape ? Math.round(width * 0.6) : width);
  const overlayHeight = overlaySize.height > 0 ? overlaySize.height : height;

  // Fallback normalized box (0..1) and pixel fallback derived from window size
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
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight },
      );
    }
  };

  const animatedFaceBoxLeft = useSharedValue(fallbackFaceBoxPx.left);
  const animatedFaceBoxTop = useSharedValue(fallbackFaceBoxPx.top);
  const animatedFaceBoxWidth = useSharedValue(fallbackFaceBoxPx.width);
  const animatedFaceBoxHeight = useSharedValue(fallbackFaceBoxPx.height);

  useEffect(() => {
    const animation = { duration: 80 };
    if (!cameraVisionFaceBox) {
      animatedFaceBoxLeft.value = withTiming(fallbackFaceBoxPx.left, animation);
      animatedFaceBoxTop.value = withTiming(fallbackFaceBoxPx.top, animation);
      animatedFaceBoxWidth.value = withTiming(fallbackFaceBoxPx.width, animation);
      animatedFaceBoxHeight.value = withTiming(fallbackFaceBoxPx.height, animation);
      return;
    }

    let nextPx: { left: number; top: number; width: number; height: number };
    
    if (cameraVisionFaceBox.width <= 1 && cameraVisionFaceBox.height <= 1) {
      // The box is normalized 0..1 relative to the raw frame.
      const sourceFrameWidth = cameraVisionFaceBox.frameWidth && cameraVisionFaceBox.frameWidth > 0
        ? cameraVisionFaceBox.frameWidth
        : overlayWidth;
      const sourceFrameHeight = cameraVisionFaceBox.frameHeight && cameraVisionFaceBox.frameHeight > 0
        ? cameraVisionFaceBox.frameHeight
        : overlayHeight;

      const frameIsLandscape = sourceFrameWidth > sourceFrameHeight;
      const viewIsLandscape = overlayWidth > overlayHeight;

      // Determine if sensor rotation mismatch exists
      const isRotated = (frameIsLandscape && !viewIsLandscape) || (!frameIsLandscape && viewIsLandscape);

      const orientedFrameWidth = isRotated ? sourceFrameHeight : sourceFrameWidth;
      const orientedFrameHeight = isRotated ? sourceFrameWidth : sourceFrameHeight;

      // Recover the original pixel values (useAttendance.ts divided by raw frame dimensions)
      const originalX = cameraVisionFaceBox.left * sourceFrameWidth;
      const originalY = cameraVisionFaceBox.top * sourceFrameHeight;
      const originalW = cameraVisionFaceBox.width * sourceFrameWidth;
      const originalH = cameraVisionFaceBox.height * sourceFrameHeight;

      // MLKit returns upright coordinates, so re-normalize against the oriented dimensions
      let mapped = {
        left: originalX / orientedFrameWidth,
        top: originalY / orientedFrameHeight,
        width: originalW / orientedFrameWidth,
        height: originalH / orientedFrameHeight,
      };

      // Native frame buffers on front cameras are mirrored in preview
      if (isFrontCamera) {
        mapped.left = 1 - (mapped.left + mapped.width);
      }

      // Correct for camera resizeMode="cover" crop
      const srcW = orientedFrameWidth;
      const srcH = orientedFrameHeight;
      const coverScale = Math.max(overlayWidth / srcW, overlayHeight / srcH);
      const renderedW = srcW * coverScale;
      const renderedH = srcH * coverScale;
      const cropOffsetX = (overlayWidth - renderedW) / 2;
      const cropOffsetY = (overlayHeight - renderedH) / 2;

      nextPx = {
        left: Math.round(mapped.left * srcW * coverScale + cropOffsetX),
        top: Math.round(mapped.top * srcH * coverScale + cropOffsetY),
        width: Math.round(mapped.width * srcW * coverScale),
        height: Math.round(mapped.height * srcH * coverScale),
      };
    } else {
      nextPx = {
        left: cameraVisionFaceBox.left,
        top: cameraVisionFaceBox.top,
        width: cameraVisionFaceBox.width,
        height: cameraVisionFaceBox.height,
      };
    }

    const minSize = 42;
    const clampedWidth = Math.max(minSize, Math.min(overlayWidth, nextPx.width));
    const clampedHeight = Math.max(minSize, Math.min(overlayHeight, nextPx.height));
    const centerX = nextPx.left + nextPx.width / 2;
    const centerY = nextPx.top + nextPx.height / 2;
    const clampedLeft = clamp(centerX - clampedWidth / 2, 0, Math.max(0, overlayWidth - clampedWidth));
    const clampedTop = clamp(centerY - clampedHeight / 2, 0, Math.max(0, overlayHeight - clampedHeight));

    animatedFaceBoxLeft.value = withTiming(clampedLeft, animation);
    animatedFaceBoxTop.value = withTiming(clampedTop, animation);
    animatedFaceBoxWidth.value = withTiming(clampedWidth, animation);
    animatedFaceBoxHeight.value = withTiming(clampedHeight, animation);
  }, [
    cameraVisionFaceBox,
    animatedFaceBoxLeft,
    animatedFaceBoxTop,
    animatedFaceBoxWidth,
    animatedFaceBoxHeight,
    overlayWidth,
    overlayHeight,
    orientation,
    requiresAndroidRotationFix,
    isFrontCamera,
    fallbackFaceBoxPx.left,
    fallbackFaceBoxPx.top,
    fallbackFaceBoxPx.width,
    fallbackFaceBoxPx.height,
  ]);

  const animatedFaceBoxStyle = useAnimatedStyle(() => ({
    left: animatedFaceBoxLeft.value,
    top: animatedFaceBoxTop.value,
    width: animatedFaceBoxWidth.value,
    height: animatedFaceBoxHeight.value,
  }));
  const animatedStatusCardStyle = useAnimatedStyle(() => {
    const cardHeight = 74;
    const margin = 6;

    const left = animatedFaceBoxLeft.value + margin;
    const top = animatedFaceBoxTop.value + animatedFaceBoxHeight.value - cardHeight - margin;

    return {
      left,
      top,
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
        if (!eyesClosedSinceRef.current) {
          eyesClosedSinceRef.current = now;
        }
        const closedMs = now - eyesClosedSinceRef.current;
        setEyeStatusLabel(closedMs >= 1000 ? 'Closed' : 'Blinking');
        return;
      }
      if (eyesOpen) {
        eyesClosedSinceRef.current = null;
        setEyeStatusLabel('Open');
        return;
      }
      eyesClosedSinceRef.current = null;
      setEyeStatusLabel('Blinking');
      return;
    }

    eyesClosedSinceRef.current = null;
    switch (cameraVisionFaceTelemetry?.eyeStatus) {
      case 'open':
        setEyeStatusLabel('Open');
        break;
      case 'mixed':
      case 'closed':
        setEyeStatusLabel('Blinking');
        break;
      default:
        setEyeStatusLabel('Unknown');
        break;
    }
  }, [
    cameraVisionFaceTelemetry?.leftEyeOpenProbability,
    cameraVisionFaceTelemetry?.rightEyeOpenProbability,
    cameraVisionFaceTelemetry?.eyeStatus,
  ]);
  const formatAngle = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${value >= 0 ? '+' : ''}${Math.round(value)}°`
      : '--';
  const yawLabel = formatAngle(cameraVisionFaceTelemetry?.yaw);
  const pitchLabel = formatAngle(cameraVisionFaceTelemetry?.pitch);
  const showProcessingSpinner =
    isCapturingHardware ||
    isVerifying ||
    scanStage === 'capturing' ||
    scanStage === 'verifying' ||
    scanStage === 'recording';
  const showDetectionOverlay =
    isCameraVisionMode &&
    cameraVisionFaceDetected &&
    !!cameraVisionFaceBox &&
    !showProcessingSpinner &&
    scanStage !== 'success';

  const instructionText = (() => {
    if (scanStage === 'success') return 'FACE VERIFIED';
    if (showProcessingSpinner) return isClockingOut ? 'PROCESSING LOGOUT...' : 'VERIFYING IDENTITY...';
    if (isCameraVisionMode && scanStage === 'detecting') {
      return cameraVisionFaceDetected ? `FACE READY ${detectionPercent}%` : 'SEARCHING FOR FACE...';
    }
    if (faceCountdown > 0 && touchlessEnabled) return `GET READY... ${faceCountdown}`;
    return 'LOOK AT THE CAMERA';
  })();

  const hintText = (() => {
    if (scanStage === 'success') return 'Success';
    if (showProcessingSpinner) return 'Please wait...';
    if (isCameraVisionMode && scanStage === 'detecting') {
      return cameraVisionFaceDetected
        ? `Hold steady for automatic capture • Eyes: ${eyeStatusLabel}`
        : 'Center your face in the frame';
    }
    if (faceCountdown > 0) return 'Position your face';
    return livenessMessage;
  })();

  // Portrait mode (phones) — full-screen camera with compact profile bar
  if (!isLandscape) {
    return (
      <View style={styles.portraitFaceContainer} onLayout={handleOverlayLayout}>
        <Camera
          ref={cameraRef}
          style={[styles.fullScreenCamera, { transform: cameraTransform }]}
          device={device}
          isActive={true}
          photo={true}
          frameProcessor={frameProcessor}
          androidPreviewViewType="texture-view"
          outputOrientation="device"
          resizeMode="cover"
        />
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />
        {showDetectionOverlay && (
          <View style={styles.fullScreenDetectionOverlay} pointerEvents="none">      
            <AnimatedReanimated.View
              style={[
                styles.detectionFaceBox,
                cameraVisionFaceDetected && styles.detectionFaceBoxActive,
                animatedFaceBoxStyle,
              ]}
            />
            <AnimatedReanimated.View style={[styles.detectionStatusCard, animatedStatusCardStyle]}>
              <Text style={styles.detectionStatusText}>Yaw: {yawLabel}</Text>
              <Text style={styles.detectionStatusText}>Pitch: {pitchLabel}</Text>
              <Text style={styles.detectionStatusText}>Eyes: {eyeStatusLabel}</Text>
            </AnimatedReanimated.View>
          </View>
        )}

        <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'left', 'right', 'bottom']}>
          <View>
            <View style={styles.newHeader}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={onBack} style={styles.headerIconButton}>
                  <MaterialCommunityIcons name="chevron-left" size={28} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={onOpenOffline} style={[styles.headerIconButton, { marginLeft: 10 }]}>
                  <MaterialCommunityIcons name="history" size={22} color="#fff" />
                  {pendingSyncCount > 0 && <View style={styles.headerSyncBadge} />}
                </TouchableOpacity>
              </View>
              <View style={styles.headerCenter}>
                <Text style={styles.topTime}>{formattedTime}</Text>
                <Text style={styles.topDate}>{formattedDate}</Text>
              </View>
              <View style={styles.headerRight}>
                <View
                  style={[styles.miniOfflineBadge, offlineModeEnabled && styles.miniOfflineBadgeActive]}
                >
                  <MaterialCommunityIcons name={offlineModeEnabled ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" />
                  <Text style={styles.miniOfflineText}>{offlineModeEnabled ? 'OFFLINE' : 'ONLINE'}</Text>
                </View>
              </View>
            </View>

            <View style={[styles.portraitProfileBar, { backgroundColor: accentColor }]}>
              {selectedUser?.profile_picture ? (
                <Image source={{ uri: selectedUser.profile_picture }} style={styles.portraitProfileImage} />
              ) : (
                <View style={styles.portraitProfilePlaceholder}>
                  <MaterialCommunityIcons name="account" size={28} color="#fff" />
                </View>
              )}
              <View style={styles.portraitProfileInfo}>
                <Text style={styles.portraitProfileName} numberOfLines={1}>
                  {selectedUser?.name || selectedUser?.username || 'Employee'}
                </Text>
                <Text style={styles.portraitProfileRole} numberOfLines={1}>
                  {selectedUser?.role || 'Staff'} • {selectedUser?.department || 'Dept'}
                </Text>
              </View>
              {isClockingOut && clockInTime ? (
                <View style={styles.clockInTimeContainer}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color="rgba(255,255,255,0.8)" />
                  <Text style={[styles.clockInTimeText, { fontSize: 12 }]}>{clockInTime}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.scannerOverlayContainer}>
            <View style={styles.faceScannerArea}>
              <View style={styles.faceFrame}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                {!isVerifying && !isCapturingHardware && (
                  <Animated.View
                    style={[
                      styles.scanLine,
                      {
                        transform: [{
                          translateY: scanLineAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 240],
                          }),
                        }],
                      },
                    ]}
                  />
                )}
                {scanStage === 'success' ? (
                  <Animated.View style={[styles.successIconWrap, { transform: [{ scale: successScale }] }]}>
                    <MaterialCommunityIcons name="check-circle" size={118} color="#4ade80" />
                  </Animated.View>
                ) : showProcessingSpinner ? (
                  <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
                ) : (faceCountdown > 0 && touchlessEnabled) ? (
                  <Text style={styles.countdownText}>{faceCountdown}</Text>
                ) : (
                  <MaterialCommunityIcons name="face-recognition" size={120} color="rgba(255,255,255,0.2)" style={styles.faceIconBackground} />
                )}
              </View>
              <Text style={styles.scanInstructionText}>
                {instructionText}
              </Text>
              <Text style={styles.faceHintText}>
                {hintText}
              </Text>
            </View>
          </View>

          <View style={styles.portraitFooter}>
            {showProcessingSpinner ? (
              <View style={styles.verifyingPill}>
                <ActivityIndicator size="small" color="#F27121" />
                <Text style={styles.verifyingPillText}>
                  {scanStage === 'capturing' ? 'Capturing...' : isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}
                </Text>
              </View>
            ) : (
              !touchlessEnabled && (
                <View style={styles.footerButtons}>
                  <TouchableOpacity
                    style={[styles.mainActionButton, { backgroundColor: isClockingOut ? '#C0392B' : accentColor }]}
                    onPress={onAttendance}
                    disabled={isVerifying || isCapturingHardware}
                  >
                    <Text style={styles.mainActionButtonText}>
                      {isClockingOut ? 'CONFIRM CLOCK OUT' : 'CONFIRM CLOCK IN'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Landscape mode (tablets) — 40/60 split screen
  return (
    <View style={styles.splitScreenContainer}>
      <View style={[styles.leftPanel, { backgroundColor: accentColor }]}>
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'bottom']}>
          <View style={styles.leftPanelHeader}>
            <TouchableOpacity onPress={onBack} style={styles.headerIconButtonLight}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={accentColor} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onOpenOffline} style={[styles.headerIconButtonLight, { marginLeft: 10 }]}>
              <MaterialCommunityIcons name="history" size={22} color={accentColor} />
              {pendingSyncCount > 0 && <View style={styles.headerSyncBadge} />}
            </TouchableOpacity>
          </View>

          <View style={styles.profileInfoContainer}>
            <View style={styles.profileImageContainer}>
              {selectedUser?.profile_picture ? (
                <Image source={{ uri: selectedUser.profile_picture }} style={styles.profileImage} />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <MaterialCommunityIcons name="account" size={100} color={accentColor} />
                </View>
              )}
              {!isVerifying && !isCapturingHardware && (
                <View style={styles.verifiedBadge}>
                  <MaterialCommunityIcons name="check-circle" size={32} color="#4ade80" />
                </View>
              )}
            </View>
            <Text style={styles.profileName}>{selectedUser?.name || selectedUser?.username || 'Employee'}</Text>
            <Text style={styles.profileRole}>{selectedUser?.role || 'Staff Member'}</Text>
            <Text style={styles.profileDept}>{selectedUser?.department || 'Department'}</Text>
            {isClockingOut && clockInTime ? (
              <View style={styles.clockInTimeContainer}>
                <MaterialCommunityIcons name="clock-outline" size={18} color="rgba(255,255,255,0.8)" />
                <Text style={styles.clockInTimeText}>Clocked In at: {clockInTime}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.leftPanelFooter}>
            {showProcessingSpinner ? (
              <View style={styles.verifyingPillLeft}>
                <ActivityIndicator size="small" color={accentColor} />
                <Text style={[styles.verifyingPillTextLeft, { color: accentColor }]}>
                  {scanStage === 'capturing' ? 'Capturing...' : isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}
                </Text>
              </View>
            ) : (
              !touchlessEnabled && (
                <TouchableOpacity
                  style={[styles.mainActionButtonLeft, { backgroundColor: isClockingOut ? '#C0392B' : '#fff' }]}
                  onPress={onAttendance}
                  disabled={isVerifying || isCapturingHardware}
                >
                  <Text style={[styles.mainActionButtonTextLeft, { color: isClockingOut ? '#fff' : accentColor }]}>
                    {isClockingOut ? 'CONFIRM CLOCK OUT' : 'CONFIRM CLOCK IN'}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.rightPanel} onLayout={handleOverlayLayout}>
        <Camera
          ref={cameraRef}
          style={[styles.fullScreenCamera, { transform: cameraTransform }]}
          device={device}
          isActive={true}
          photo={true}
          frameProcessor={frameProcessor}
          androidPreviewViewType="texture-view"
          outputOrientation="device"
          resizeMode="cover"
        />
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />
        {showDetectionOverlay && (
          <View style={styles.fullScreenDetectionOverlay} pointerEvents="none">      
            <AnimatedReanimated.View
              style={[
                styles.detectionFaceBox,
                cameraVisionFaceDetected && styles.detectionFaceBoxActive,
                animatedFaceBoxStyle,
              ]}
            />
            <AnimatedReanimated.View style={[styles.detectionStatusCard, animatedStatusCardStyle]}>
              <Text style={styles.detectionStatusText}>Yaw: {yawLabel}</Text>
              <Text style={styles.detectionStatusText}>Pitch: {pitchLabel}</Text>
              <Text style={styles.detectionStatusText}>Eyes: {eyeStatusLabel}</Text>
            </AnimatedReanimated.View>
          </View>
        )}

        <SafeAreaView style={styles.cameraSafeArea} edges={['top', 'right', 'bottom']}>
          <View style={styles.rightPanelHeader}>
            <View style={styles.headerCenterRight}>
              <Text style={styles.topTimeRight}>{formattedTime}</Text>
              <Text style={styles.topDateRight}>{formattedDate}</Text>
            </View>
            <View
              style={[styles.miniOfflineBadge, offlineModeEnabled && styles.miniOfflineBadgeActive]}
            >
              <MaterialCommunityIcons name={offlineModeEnabled ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" />
              <Text style={styles.miniOfflineText}>{offlineModeEnabled ? 'OFFLINE' : 'ONLINE'}</Text>
            </View>
          </View>

          <View style={styles.faceScannerAreaRight}>
            <View style={styles.faceFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              {!isVerifying && !isCapturingHardware && (
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [{
                        translateY: scanLineAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 240],
                        }),
                      }],
                    },
                  ]}
                />
              )}
              {scanStage === 'success' ? (
                <Animated.View style={[styles.successIconWrap, { transform: [{ scale: successScale }] }]}>
                  <MaterialCommunityIcons name="check-circle" size={118} color="#4ade80" />
                </Animated.View>
              ) : showProcessingSpinner ? (
                <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
              ) : (faceCountdown > 0 && touchlessEnabled) ? (
                <Text style={styles.countdownText}>{faceCountdown}</Text>
              ) : (
                <MaterialCommunityIcons name="face-recognition" size={120} color="rgba(255,255,255,0.2)" style={styles.faceIconBackground} />
              )}
            </View>
            <Text style={styles.scanInstructionTextRight}>
              {instructionText}
            </Text>
            <Text style={styles.faceHintTextRight}>
              {hintText}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}