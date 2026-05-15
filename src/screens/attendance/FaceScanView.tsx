import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
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
import { styles } from './styles';
import type { ResolvedUser } from './types';

type Props = {
  device: CameraProps['device'];
  cameraRef: React.RefObject<Camera | null>;
  frameProcessor: any;
  flashAnim: Animated.Value;
  scanLineAnim: Animated.Value;
  formattedTime: string;
  formattedDate: string;
  isVerifying: boolean;
  isClockingOut: boolean;
  touchlessEnabled: boolean;
  offlineModeEnabled: boolean;
  livenessEnabled: boolean;
  pendingSyncCount: number;
  faceCountdown: number;
  clockInTime: string;
  selectedUser: ResolvedUser | null;
  accentColor: string;
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
  isClockingOut,
  touchlessEnabled,
  offlineModeEnabled,
  livenessEnabled,
  pendingSyncCount,
  faceCountdown,
  clockInTime,
  selectedUser,
  accentColor,
  onBack,
  onOpenOffline,
  onAttendance,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= 600;

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

  // Determine if we need to apply a manual rotation fix for Android + FrameProcessor
  const requiresAndroidRotationFix = Platform.OS === 'android' && livenessEnabled;
  
  // Calculate scale to prevent squishing when applying CSS rotation to a non-square container
  // For portrait, the camera takes full screen (width x height)
  // For landscape, the camera takes the right panel (width * 0.6 x height)
  const cameraContainerWidth = isLandscape ? width * 0.6 : width;
  const cameraContainerHeight = height;
  const scaleRatio = Math.max(
    cameraContainerWidth / cameraContainerHeight,
    cameraContainerHeight / cameraContainerWidth
  );
  
  let cameraTransform = [];
  if (requiresAndroidRotationFix) {
    if (orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) {
      cameraTransform = [{ rotate: '90deg' }, { scale: scaleRatio }];
    } else if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
      cameraTransform = [{ rotate: '-90deg' }, { scale: scaleRatio }];
    } else if (orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
      cameraTransform = [{ rotate: '180deg' }];
    }
  }

  // Portrait mode (phones) — full-screen camera with compact profile bar
  if (!isLandscape) {
    return (
      <View style={styles.portraitFaceContainer}>
        <Camera
          ref={cameraRef}
          style={[styles.fullScreenCamera, { transform: cameraTransform }]}
          device={device}
          isActive={true}
          photo={true}
          frameProcessor={livenessEnabled ? frameProcessor : undefined}
          androidPreviewViewType="texture-view"
          resizeMode="cover"
        />
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />

        <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'left', 'right', 'bottom']}>
          {/* Header with back + profile info */}
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

            {/* Compact profile bar */}
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

          {/* Face scan area */}
          <View style={styles.scannerOverlayContainer}>
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
                {isVerifying ? (
                  <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
                ) : (faceCountdown > 0 && touchlessEnabled) ? (
                  <Text style={styles.countdownText}>{faceCountdown}</Text>
                ) : (
                  <MaterialCommunityIcons name="face-recognition" size={120} color="rgba(255,255,255,0.2)" style={styles.faceIconBackground} />
                )}
              </View>
              <Text style={styles.scanInstructionText}>
                {isVerifying ? 'VERIFYING IDENTITY...' : (faceCountdown > 0 && touchlessEnabled) ? `GET READY... ${faceCountdown}` : 'LOOK AT THE CAMERA'}
              </Text>
              <Text style={styles.faceHintText}>
                {isVerifying ? 'Please wait...' : faceCountdown > 0 ? 'Position your face' : 'Face the camera • Keep eyes open • SMILE :)'}
              </Text>
            </View>
          </View>

          {/* Footer action button */}
          <View style={styles.portraitFooter}>
            {isVerifying ? (
              <View style={styles.verifyingPill}>
                <ActivityIndicator size="small" color="#F27121" />
                <Text style={styles.verifyingPillText}>
                  {isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}
                </Text>
              </View>
            ) : (
              !touchlessEnabled && (
                <View style={styles.footerButtons}>
                  <TouchableOpacity
                    style={[styles.mainActionButton, { backgroundColor: isClockingOut ? '#C0392B' : accentColor }]}
                    onPress={onAttendance}
                    disabled={isVerifying}
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
      {/* LEFT PANEL - Profile (40%) */}
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
              {!isVerifying && (
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
            {isVerifying ? (
              <View style={styles.verifyingPillLeft}>
                <ActivityIndicator size="small" color={accentColor} />
                <Text style={[styles.verifyingPillTextLeft, { color: accentColor }]}>
                  {isClockingOut ? 'Processing Logout...' : 'Verifying Identity...'}
                </Text>
              </View>
            ) : (
              !touchlessEnabled && (
                <TouchableOpacity
                  style={[styles.mainActionButtonLeft, { backgroundColor: isClockingOut ? '#C0392B' : '#fff' }]}
                  onPress={onAttendance}
                  disabled={isVerifying}
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

      {/* RIGHT PANEL - Camera (60%) */}
      <View style={styles.rightPanel}>
        <Camera
          ref={cameraRef}
          style={[styles.fullScreenCamera, { transform: cameraTransform }]}
          device={device}
          isActive={true}
          photo={true}
          frameProcessor={livenessEnabled ? frameProcessor : undefined}
          androidPreviewViewType="texture-view"
          resizeMode="cover"
        />
        <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />
        <View style={styles.cameraTintLight} pointerEvents="none" />

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
              {!isVerifying && (
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
              {isVerifying ? (
                <ActivityIndicator size={80} color="#F27121" style={styles.faceIconBackground} />
              ) : (faceCountdown > 0 && touchlessEnabled) ? (
                <Text style={styles.countdownText}>{faceCountdown}</Text>
              ) : (
                <MaterialCommunityIcons name="face-recognition" size={120} color="rgba(255,255,255,0.2)" style={styles.faceIconBackground} />
              )}
            </View>
            <Text style={styles.scanInstructionTextRight}>
              {isVerifying ? 'VERIFYING IDENTITY...' : (faceCountdown > 0 && touchlessEnabled) ? `GET READY... ${faceCountdown}` : 'LOOK AT THE CAMERA'}
            </Text>
            <Text style={styles.faceHintTextRight}>
              {isVerifying ? 'Please wait while we verify your identity' : faceCountdown > 0 ? 'Position your face inside the frame' : 'Face the camera directly \u2022 Keep eyes open \u2022 Stay still \u2022 SMILE :)'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
