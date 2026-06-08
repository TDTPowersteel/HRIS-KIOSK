import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { styles } from './style/styles';
import { useAttendance } from './useAttendance';
import QRScanView from './QRScanView';
import FaceScanView from './FaceScanView';
import ResultModal from './ResultModal';
import type { AttendanceProps } from './types';

export default function AttendanceScanner({ onBack, onOpenOffline }: AttendanceProps) {
  const state = useAttendance();

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

  if (!state.hasLocationPermission) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ color: '#fff', fontSize: 18, marginBottom: 10, fontWeight: 'bold' }}>Location access needed.</Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginHorizontal: 40, marginBottom: 20 }}>
          The kiosk requires location services to record secure and verified attendance.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={state.requestLocationPermission}>
          <Text style={styles.permissionText}>Allow Location</Text>
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
          scanLineAnim={state.scanLineAnim}
          formattedTime={state.formattedTime}
          formattedDate={state.formattedDate}
          isQrLoading={state.isQrLoading}
          qrSuccessLocal={state.qrSuccessLocal}
          touchlessEnabled={state.touchlessEnabled}
          offlineModeEnabled={state.offlineModeEnabled}
          pendingSyncCount={state.pendingSyncCount}
          isOnline={state.isOnline}
          onBack={onBack}
          onOpenOffline={onOpenOffline}
        />
      ) : (
        <FaceScanView
          device={state.device}
          cameraFormat={state.cameraFormat}
          cameraRef={state.cameraRef}
          frameProcessor={state.frameProcessor}
          flashAnim={state.flashAnim}
          formattedTime={state.formattedTime}
          formattedDate={state.formattedDate}
          isVerifying={state.isVerifying}
          isCapturingHardware={state.isCapturingHardware}
          isClockingOut={state.isClockingOut}
          touchlessEnabled={state.touchlessEnabled}
          offlineModeEnabled={state.offlineModeEnabled}
          livenessEnabled={state.livenessEnabled}
          scanStage={state.scanStage}
          cameraVisionFaceDetected={state.cameraVisionFaceDetected}
          cameraVisionReadiness={state.cameraVisionReadiness}
          backgroundLivenessPassed={state.backgroundLivenessPassed}
          cameraVisionFaceBox={state.cameraVisionFaceBox}
          cameraVisionAllFaces={state.cameraVisionAllFaces}
          cameraVisionFaceTelemetry={state.cameraVisionFaceTelemetry}
          successAnimationTick={state.successAnimationTick}
          pendingSyncCount={state.pendingSyncCount}
          isOnline={state.isOnline}
          faceCountdown={state.faceCountdown}
          clockInTime={state.clockInTime}
          selectedUser={state.selectedUser}
          accentColor={state.colors.accent}
          livenessMessage={state.livenessMessage}
          showResultModal={state.showResultModal}
          onBack={state.resetAttendanceFlow}
          onOpenOffline={onOpenOffline}
          onAttendance={state.handleAttendance}
        />
      )}

      <ResultModal
        visible={state.showResultModal}
        type={state.modalType}
        title={state.modalTitle}
        hint={state.modalHint}
        scaleAnim={state.scaleAnim}
        onClose={state.closeModal}
      />
    </View>
  );
}
