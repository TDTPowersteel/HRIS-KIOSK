import React, { useEffect } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { styles } from './styles';
import { useAttendance } from './useAttendance';
import QRScanView from './QRScanView';
import FaceScanView from './FaceScanView';
import ResultModal from './ResultModal';
import type { AttendanceProps } from './types';

export default function AttendanceScanner({ onBack, onOpenOffline }: AttendanceProps) {
  const state = useAttendance();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  useEffect(() => {
    async function lockOrientation() {
      try {
        if (isTablet) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch (e) {
        // Ignore
      }
    }
    lockOrientation();
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, [isTablet]);

  if (state.isLoading || !state.device) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F27121" />
        <Text style={{ color: 'rgba(255,255,255,0.7)', marginTop: 20, fontSize: 16 }}>
          {state.isLoading ? 'Loading Scanner...' : 'Waiting for Camera Hardware...'}
        </Text>
        {!state.isLoading && !state.device && (
          <TouchableOpacity onPress={onBack} style={{ marginTop: 40, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#333', borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Go Back to Home</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!state.hasPermission) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ color: '#fff' }}>Camera access needed.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={state.requestPermission}>
          <Text style={styles.permissionText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!state.qrVerified ? (
        <QRScanView
          device={state.device}
          codeScanner={state.codeScanner}
          flashAnim={state.flashAnim}
          formattedTime={state.formattedTime}
          formattedDate={state.formattedDate}
          isQrLoading={state.isQrLoading}
          touchlessEnabled={state.touchlessEnabled}
          offlineModeEnabled={state.offlineModeEnabled}
          pendingSyncCount={state.pendingSyncCount}
          onBack={onBack}
          onOpenOffline={onOpenOffline}
          onOfflineModeChange={state.handleOfflineModeChange}
        />
      ) : (
        <FaceScanView
          device={state.device}
          cameraRef={state.cameraRef}
          frameProcessor={state.frameProcessor}
          flashAnim={state.flashAnim}
          scanLineAnim={state.scanLineAnim}
          formattedTime={state.formattedTime}
          formattedDate={state.formattedDate}
          isVerifying={state.isVerifying}
          isClockingOut={state.isClockingOut}
          touchlessEnabled={state.touchlessEnabled}
          offlineModeEnabled={state.offlineModeEnabled}
          pendingSyncCount={state.pendingSyncCount}
          faceCountdown={state.faceCountdown}
          clockInTime={state.clockInTime}
          selectedUser={state.selectedUser}
          accentColor={state.colors.accent}
          onBack={onBack}
          onOpenOffline={onOpenOffline}
          onOfflineModeChange={state.handleOfflineModeChange}
          onAttendance={state.handleAttendance}
        />
      )}

      <ResultModal
        visible={state.showResultModal}
        type={state.modalType}
        title={state.modalTitle}
        message={state.modalMessage}
        hint={state.modalHint}
        scaleAnim={state.scaleAnim}
        onClose={state.closeModal}
      />
    </View>
  );
}
