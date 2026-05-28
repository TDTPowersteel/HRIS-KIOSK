import React from 'react';
import { ActivityIndicator, Animated, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, CameraProps } from 'react-native-vision-camera';
import { styles } from './style/styles';

type Props = {
  device: CameraProps['device'];
  codeScanner: any;
  flashAnim: Animated.Value;
  formattedTime: string;
  formattedDate: string;
  isQrLoading: boolean;
  qrSuccessLocal: boolean;
  touchlessEnabled: boolean;
  offlineModeEnabled: boolean;
  pendingSyncCount: number;
  onBack: () => void;
  onOpenOffline: () => void;
};

export default function QRScanView({
  device,
  codeScanner,
  flashAnim,
  formattedTime,
  formattedDate,
  isQrLoading,
  qrSuccessLocal,
  touchlessEnabled,
  offlineModeEnabled,
  pendingSyncCount,
  onBack,
  onOpenOffline,
}: Props) {
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
      <View style={styles.cameraTint} pointerEvents="none" />

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
              style={[styles.miniOfflineBadge, offlineModeEnabled && styles.miniOfflineBadgeActive]}
            >
              <MaterialCommunityIcons name={offlineModeEnabled ? 'cloud-off' : 'cloud-check'} size={18} color="#fff" />
              <Text style={styles.miniOfflineText}>{offlineModeEnabled ? 'OFFLINE' : 'ONLINE'}</Text>
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
            <View style={styles.qrFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              {qrSuccessLocal ? (
                <MaterialCommunityIcons name="check-circle" size={100} color="#F27121" />
              ) : isQrLoading ? (
                <ActivityIndicator size={100} color="#F27121" />
              ) : (
                <MaterialCommunityIcons name="qrcode-scan" size={100} color="#F27121" />
              )}
            </View>
            <Text style={styles.scanInstructionText}>
              {qrSuccessLocal ? 'SUCCESS!' : isQrLoading ? 'QR CODE SCANNED' : 'READY TO SCAN QR'}
            </Text>
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
          {!touchlessEnabled && (
            <View style={styles.footerButtons}>
              <TouchableOpacity
                style={[styles.mainActionButton, { backgroundColor: '#F27121', opacity: 0.6 }]}
                disabled={true}
              >
                <Text style={styles.mainActionButtonText}>SCAN QR FIRST</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </>
  );
}
