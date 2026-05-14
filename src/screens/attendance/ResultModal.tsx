import React from 'react';
import { Animated, Modal, Text, TouchableOpacity, View } from 'react-native';
import { styles } from './styles';
import type { ModalType } from './types';

type Props = {
  visible: boolean;
  type: ModalType;
  title: string;
  message: string;
  hint: string;
  scaleAnim: Animated.Value;
  onClose: () => void;
};

const MODAL_COLORS: Record<ModalType, { bg: string; btn: string; icon: string; label: string }> = {
  success: { bg: '#d4edda', btn: '#28a745', icon: 'OK', label: 'Great' },
  warning: { bg: '#fff3cd', btn: '#ffc107', icon: '!', label: 'Got it' },
  info:    { bg: '#d1ecf1', btn: '#17a2b8', icon: 'i', label: 'OK' },
  error:   { bg: '#f8d7da', btn: '#dc3545', icon: 'X', label: 'Try Again' },
};

export default function ResultModal({ visible, type, title, message, hint, scaleAnim, onClose }: Props) {
  const colors = MODAL_COLORS[type];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            styles.modalContainer,
            { transform: [{ scale: scaleAnim }], backgroundColor: '#fff' },
          ]}
        >
          <View style={[styles.modalIconContainer, { backgroundColor: colors.bg }]}>
            <Text style={styles.modalIcon}>{colors.icon}</Text>
          </View>

          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>

          {hint ? (
            <View style={styles.modalHintContainer}>
              <Text style={styles.modalHintIcon}>i</Text>
              <Text style={styles.modalHint}>{hint}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.modalButton, { backgroundColor: colors.btn }]}
            onPress={onClose}
          >
            <Text style={styles.modalButtonText}>{colors.label}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}
