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
  onBack,
  onOpenOffline,
}: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const SCAN_BOX_SIZE = 300; 
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
      <View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }} pointerEvents="none">
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

      {/* 2. SafeAreaView (Header, steps row, texts, buttons - 100% bright on top!) */}
      <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'left', 'right', 'bottom']}>
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
              style={[styles.miniOfflineBadge, !isOnline && styles.miniOfflineBadgeActive]}
            >
              <MaterialCommunityIcons name={!isOnline ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" />
              <Text style={styles.miniOfflineText}>{!isOnline ? 'OFFLINE' : 'ONLINE'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.topStepsRow}>
          <View style={[styles.stepPill, styles.stepPillActive]}>
            <Text style={[styles.stepPillText, styles.stepPillTextActive]}>1. QR CODE</Text>
            <View style={styles.activeDot} />
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.4)" />
          <View style={styles.stepPill}>
            <Text style={styles.stepPillText}>2. SCAN FACE</Text>
          </View>
        </View>

        <View style={styles.scannerOverlayContainer} pointerEvents="none">
          <View style={styles.qrScannerArea}>
            {/* Transparent placeholder that keeps the flex layout aligned with absolute cutout */}
            <View style={{ width: SCAN_BOX_SIZE, height: SCAN_BOX_SIZE, marginBottom: 20 }} />
            
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              {!qrSuccessLocal && !isQrLoading && (
                <MaterialCommunityIcons name="qrcode" size={24} color="#F27121" style={{ marginRight: 8 }} />
              )}
              <Text style={styles.scanInstructionText}>
                {qrSuccessLocal ? 'SUCCESS!' : isQrLoading ? 'QR CODE SCANNED' : 'SCAN QR CODE HERE'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.newFooter}>
          {(isQrLoading || qrSuccessLocal) && (
            <View style={[styles.verifyingPill, { borderColor: qrSuccessLocal ? '#F27121' : '#4A90E2' }]}>
              {qrSuccessLocal ? (
                <MaterialCommunityIcons name="check-circle" size={16} color="#F27121" style={{ marginRight: 6 }} />
              ) : (
                <ActivityIndicator size="small" color="#4A90E2" />
              )}
              <Text style={[styles.verifyingPillText, qrSuccessLocal && { color: '#F27121' }]}>
                {qrSuccessLocal ? 'QR Verified!' : 'QR Code Scanned'}
              </Text>
            </View>
          )}
          <View style={styles.welcomeContainer}>
            <Text style={styles.waitingText}>Waiting for employee QR...</Text>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
