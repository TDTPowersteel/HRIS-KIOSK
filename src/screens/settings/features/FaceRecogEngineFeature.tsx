import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Colors, useTheme } from '../../../config/theme';

export type FaceEngine = 'facepp' | 'camera_vision';

type Props = {
  engine: FaceEngine;
  onSelect: (engine: FaceEngine) => void;
};

export function FaceRecogEngineFeature({ engine, onSelect }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;

  const options: { value: FaceEngine; label: string }[] = [
    { value: 'facepp', label: 'Face++' },
    { value: 'camera_vision', label: 'Camera Vision' },
  ];

  return (
    <View style={[
      styles.card,
      { backgroundColor: colors.surface, borderColor: colors.border },
      isTablet && styles.cardTablet,
    ]}>
      <Text style={[styles.title, isTablet && styles.titleTablet]}>
        Face Recognition Engine
      </Text>
      <Text style={[styles.description, { color: colors.textSecondary }, isTablet && styles.descriptionTablet]}>
        Face++ sends photos to the cloud. Camera Vision runs on-device (offline-capable, faster).
      </Text>
      <View style={styles.pillRow}>
        {options.map((opt, i) => {
          const isActive = engine === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={[
                styles.pill,
                i === 0 ? styles.pillLeft : styles.pillRight,
                isTablet && styles.pillTablet,
                isActive
                  ? { backgroundColor: Colors.powerOrange, borderColor: Colors.powerOrange }
                  : { backgroundColor: 'transparent', borderColor: colors.border },
              ]}
            >
              <Text style={[
                styles.pillText,
                { color: isActive ? '#fff' : colors.textSecondary },
                isTablet && styles.pillTextTablet,
              ]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 24,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTablet: {
    paddingHorizontal: 36,
    paddingVertical: 26,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: -0.2,
    color: Colors.powerOrange,
  },
  titleTablet: {
    fontSize: 26,
  },
  description: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 16,
  },
  descriptionTablet: {
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 20,
  },
  pillRow: {
    flexDirection: 'row',
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  pillTablet: {
    paddingVertical: 14,
  },
  pillLeft: {
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    borderRightWidth: 0.75,
  },
  pillRight: {
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    borderLeftWidth: 0.75,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pillTextTablet: {
    fontSize: 17,
  },
});
