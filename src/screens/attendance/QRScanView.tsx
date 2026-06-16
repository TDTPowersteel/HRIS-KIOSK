import React from 'react';
import { ActivityIndicator, Animated, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, CameraProps } from 'react-native-vision-camera';
import { styles } from './style/styles';

type Props = {
  device: CameraProps['device'];
  codeScanner: any;
  flashAnim: Animated.Value;
  scanLineAnim: Animated.Value;
  formattedTime: string;
  formattedDate: string;
  isQrLoading: boolean;
  qrSuccessLocal: boolean;
  touchlessEnabled: boolean;
  offlineModeEnabled: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  kioskMode?: 'employee' | 'intern';
  onBack: () => void;
  onOpenOffline: () => void;
};

export default function QRScanView({
  device,
  codeScanner,
  flashAnim,
  scanLineAnim,
  formattedTime,
  formattedDate,
  isQrLoading,
  qrSuccessLocal,
  touchlessEnabled,
  offlineModeEnabled,
  isOnline,
  pendingSyncCount,
  kioskMode = 'employee',
  onBack,
  onOpenOffline,
}: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = Math.min(screenWidth, screenHeight) >= 600;
  const SCAN_BOX_SIZE = isTablet ? 300 : 190;
  const maxDim = Math.max(screenWidth, screenHeight);
  const overlaySize = Math.max(maxDim, 1000) * 3.5;
  const overlayBorderWidth = (overlaySize - SCAN_BOX_SIZE) / 2;

  return (
    <>
      <Camera
        style={styles.fullScreenCamera}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
        outputOrientation="device"
        resizeMode="cover"
      />
      <Animated.View style={[styles.snapFlash, { opacity: flashAnim }]} pointerEvents="none" />

      {/* 1. Behind-the-scenes scanner overlay (renders under SafeAreaView) */}
      <View style={[{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }, !isTablet && { transform: [{ translateY: 15 }] }]} pointerEvents="none">
        {/* Giant border overlay at screen level to avoid container clipping */}
        <View style={{
          position: 'absolute',
          width: overlaySize,
          height: overlaySize,
          borderWidth: overlayBorderWidth,
          borderColor: 'rgba(0, 0, 0, 0.50)',
          backgroundColor: 'transparent',
        }} />

        {/* frame centered exactly inside the transparent cutout */}
        <View style={{ width: SCAN_BOX_SIZE, height: SCAN_BOX_SIZE, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <View style={[styles.corner, styles.cornerTopLeft, { borderTopLeftRadius: 0 }]} />
          <View style={[styles.corner, styles.cornerTopRight, { borderTopRightRadius: 0 }]} />
          <View style={[styles.corner, styles.cornerBottomLeft, { borderBottomLeftRadius: 0 }]} />
          <View style={[styles.corner, styles.cornerBottomRight, { borderBottomRightRadius: 0 }]} />
          
          {qrSuccessLocal ? (
            <MaterialCommunityIcons name="check-circle" size={100} color="#4ade80" />
          ) : isQrLoading ? (
            <ActivityIndicator size={80} color="#F27121" />
          ) : (
            <Animated.View style={[styles.scanLine, { width: SCAN_BOX_SIZE, position: 'absolute', top: 0, transform: [{ translateY: scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SCAN_BOX_SIZE - 4] }) }] }]} />
          )}
        </View>
      </View>

      {/* 2. Foreground scanner layout placeholder and instructions (absolute at screen level) */}
      <View style={[styles.scannerOverlayContainer, !isTablet && { transform: [{ translateY: 15 }] }]} pointerEvents="none">
        <View style={styles.qrScannerArea}>
          {/* Transparent placeholder that keeps the flex layout aligned with absolute cutout */}
          <View style={{ width: SCAN_BOX_SIZE, height: SCAN_BOX_SIZE, marginBottom: isTablet ? 95 : 35 }} />
          
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            {!qrSuccessLocal && !isQrLoading && (
              <MaterialCommunityIcons name="qrcode" size={isTablet ? 24 : 18} color="#F27121" style={{ marginRight: 8 }} />
            )}
            <Text style={[styles.scanInstructionText, !isTablet && { fontSize: 13 }]}>
              {qrSuccessLocal ? 'SUCCESS!' : isQrLoading ? 'QR CODE SCANNED' : 'SCAN QR CODE HERE'}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. SafeAreaView (Header and Footer - 100% bright on top!) */}
      <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'bottom']}>
        <View style={[styles.topHeaderContainer, !isTablet && { paddingTop: 0 }]}>
          <View style={[styles.newHeader, !isTablet && { height: 45 }]}>
            <View style={[styles.headerCenter, !isTablet && { paddingTop: 0 }]}>
              <Text style={[styles.topTime, { textAlign: 'center' }, !isTablet ? { fontSize: 26 } : (screenWidth < 380 && { fontSize: 32 })]}>{formattedTime}</Text>
              <Text style={[styles.topDate, { textAlign: 'center' }, !isTablet && { fontSize: 11, marginTop: -2 }]}>{formattedDate}</Text>
            </View>

            <View style={[styles.headerLeft, !isTablet && { left: 50 }]}>
              <TouchableOpacity onPress={onBack} style={[styles.headerIconButton, !isTablet && { width: 34, height: 34, borderRadius: 17 }]}>
                <MaterialCommunityIcons name="chevron-left" size={isTablet ? 28 : 22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={onOpenOffline} style={[styles.headerIconButton, { marginLeft: 10 }, !isTablet && { width: 34, height: 34, borderRadius: 17 }]}>
                <MaterialCommunityIcons name="history" size={isTablet ? 22 : 18} color="#fff" />
                {pendingSyncCount > 0 && <View style={[styles.headerSyncBadge, !isTablet && { top: 5, right: 5, width: 6, height: 6, borderRadius: 3 }]} />}
              </TouchableOpacity>
            </View>

            <View style={[styles.headerRight, !isTablet && { right: 50 }]}>
              <View
                style={[
                  styles.miniOfflineBadge,
                  !isOnline && styles.miniOfflineBadgeActive,
                  !isTablet && { paddingHorizontal: 6, paddingVertical: 3.5 },
                ]}
              >
                <MaterialCommunityIcons name={!isOnline ? 'cloud-off' : 'cloud-check'} size={isTablet ? 18 : 14} color="#fff" />
                <Text style={[styles.miniOfflineText, !isTablet && { fontSize: 8.5 }]}>{!isOnline ? 'OFFLINE' : 'ONLINE'}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.topStepsRow, { alignSelf: 'center' }, !isTablet && { marginTop: 6 }]}>
            <View style={[styles.stepPill, styles.stepPillActive, !isTablet && { paddingHorizontal: 8, paddingVertical: 4 }]}>
              <Text style={[styles.stepPillText, styles.stepPillTextActive, !isTablet && { fontSize: 10 }]}>1. QR CODE</Text>
              <View style={[styles.activeDot, !isTablet && { width: 4, height: 4, borderRadius: 2, marginLeft: 4 }]} />
            </View>
            <MaterialCommunityIcons name="chevron-right" size={isTablet ? 20 : 16} color="rgba(255,255,255,0.4)" />
            <View style={[styles.stepPill, !isTablet && { paddingHorizontal: 8, paddingVertical: 4 }]}>
              <Text style={[styles.stepPillText, !isTablet && { fontSize: 10 }]}>2. SCAN FACE</Text>
            </View>
          </View>
        </View>

        <View style={[styles.newFooter, !isTablet && { paddingBottom: 12 }]}>
          {(isQrLoading || qrSuccessLocal) && (
            <View style={[styles.verifyingPill, { borderColor: qrSuccessLocal ? '#F27121' : '#4A90E2' }, !isTablet && { paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8 }]}>
              {qrSuccessLocal ? (
                <MaterialCommunityIcons name="check-circle" size={16} color="#F27121" style={{ marginRight: 6 }} />
              ) : (
                <ActivityIndicator size="small" color="#4A90E2" />
              )}
              <Text style={[styles.verifyingPillText, qrSuccessLocal && { color: '#F27121' }, !isTablet && { fontSize: 12, marginLeft: 6 }, { textAlign: 'center' }]}>
                {qrSuccessLocal ? 'QR Verified!' : 'QR Code Scanned'}
              </Text>
            </View>
          )}
          <View style={styles.welcomeContainer}>
            <Text style={[styles.waitingText, { textAlign: 'center' }, !isTablet && { fontSize: 12 }]}>
              {kioskMode === 'intern' ? 'Waiting for intern QR...' : 'Waiting for employee QR...'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
