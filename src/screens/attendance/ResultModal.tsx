import React from 'react';
import { Animated, Image, Modal, Text, TouchableOpacity, View } from 'react-native';
import { styles } from './style/styles';
import type { ModalType } from './types';

type Props = {
  visible: boolean;
  type: ModalType;
  title: string;
  hint: string;
  scaleAnim: Animated.Value;
  onClose: () => void;
};

const MODAL_ICONS: Record<ModalType, any> = {
  success: require('../../../assets/modal-icons/success.png'),
  error: require('../../../assets/modal-icons/error.png'),
  info: require('../../../assets/modal-icons/warning.png'),
  warning: require('../../../assets/modal-icons/warning.png'),
  qr_error: require('../../../assets/modal-icons/qr_error.png'),
  camera_error: require('../../../assets/modal-icons/error.png'),
  face_error: require('../../../assets/modal-icons/error.png'),
};

const MODAL_CIRCLE_COLORS: Record<ModalType, string> = {
  success:      '#22c55e',
  warning:      '#f59e0b',
  info:         '#3b82f6',
  error:        '#ef4444',
  qr_error:     '#f97316',
  camera_error: '#ef4444',
  face_error:   '#ef4444',
};

const MODAL_BTN: Record<ModalType, { btn: string; label: string }> = {
  success:      { btn: '#22c55e', label: 'Done' },
  warning:      { btn: '#f59e0b', label: 'Got it' },
  info:         { btn: '#3b82f6', label: 'OK' },
  error:        { btn: '#ef4444', label: 'Try Again' },
  qr_error:     { btn: '#f97316', label: 'Try Again' },
  camera_error: { btn: '#ef4444', label: 'Try Again' },
  face_error:   { btn: '#ef4444', label: 'Try Again' },
};

export default function ResultModal({ visible, type, title, hint, scaleAnim, onClose }: Props) {
  const btnConfig = MODAL_BTN[type];
  const iconSource = MODAL_ICONS[type];
  const circleColor = MODAL_CIRCLE_COLORS[type];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[styles.modalWrapper, { transform: [{ scale: scaleAnim }] }]}
        >
          <View style={[styles.modalCircle, { backgroundColor: circleColor }]}>
            <Image source={iconSource} style={styles.modalCircleIcon} resizeMode="cover" />
          </View>

          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>

            {hint ? (
              <View style={styles.modalHintContainer}>
                <Text style={styles.modalHint}>{hint}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: btnConfig.btn }]}
              onPress={onClose}
            >
              <Text style={styles.modalButtonText}>{btnConfig.label}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
