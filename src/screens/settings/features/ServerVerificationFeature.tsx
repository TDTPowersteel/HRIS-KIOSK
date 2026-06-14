import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors, useTheme } from '../../../config/theme';

type Props = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function ServerVerificationFeature({ enabled, onToggle }: Props) {
  const { colors } = useTheme();

  return (
    <SettingRow
      title="Face Verification Mode"
      description={
        <Text>
          Uses the <Text style={{ color: Colors.powerOrange, fontWeight: 'bold' }}>server</Text> for face verification instead of the local built-in face verification for lower-spec devices, but automatically falls back to local verification if the server is offline.
        </Text>
      }
      action={
        <View style={[styles.segmentContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            onPress={() => onToggle(false)}
            style={[
              styles.segmentButton,
              !enabled && { backgroundColor: Colors.powerOrange }
            ]}
          >
            <Text style={[styles.segmentText, { color: !enabled ? '#ffffff' : colors.textSecondary }]}>
              Local
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onToggle(true)}
            style={[
              styles.segmentButton,
              enabled && { backgroundColor: Colors.powerOrange }
            ]}
          >
            <Text style={[styles.segmentText, { color: enabled ? '#ffffff' : colors.textSecondary }]}>
              Server
            </Text>
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 3,
  },
  segmentButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
