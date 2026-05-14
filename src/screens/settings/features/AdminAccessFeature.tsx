import { useState, useCallback } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors, useTheme } from '../../../config/theme';

type Props = {
  saveBackendSettings: (body: Record<string, any>) => Promise<any>;
};

export function AdminAccessFeature({ saveBackendSettings }: Props) {
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openDialog = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    if (isSubmitting) return;
    setIsOpen(false);
  }, [isSubmitting]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await saveBackendSettings({
        action: 'change_admin_password',
        current_password: currentPassword,
        new_password: newPassword,
      });
      closeDialog();
      Alert.alert('Success', 'Admin password updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save.');
    } finally {
      setIsSubmitting(false);
    }
  }, [currentPassword, newPassword, saveBackendSettings, closeDialog]);

  return (
    <>
      <SettingRow 
        title="Administrative Access" 
        description="Click to update the secure admin password" 
        onPress={openDialog} 
      />

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={closeDialog}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Administrative Access</Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Current Password"
              placeholderTextColor={colors.textSecondary}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="New Secure Password"
              placeholderTextColor={colors.textSecondary}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />

            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, { backgroundColor: colors.background }]} onPress={closeDialog}>
                <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>CANCEL</Text>
              </Pressable>
              <Pressable 
                style={[styles.modalButton, { backgroundColor: Colors.powerOrange }]} 
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>SAVE CHANGES</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  modalCard: {
    width: '100%',
    maxWidth: 550,
    borderRadius: 32,
    padding: 35,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 25,
    textAlign: 'center',
  },
  input: {
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    borderWidth: 1.5,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
    gap: 15,
  },
  modalButton: {
    flex: 1,
    height: 65,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
