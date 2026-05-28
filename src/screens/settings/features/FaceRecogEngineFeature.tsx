import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Colors, useTheme } from '../../../config/theme';

export type FaceEngine = 'facepp' | 'camera_vision';

type Props = {
  engine: FaceEngine;
  onSelect: (engine: FaceEngine) => void;
};

export function FaceRecogEngineFeature({ engine, onSelect }: Props) {
  const { colors, theme } = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowTitle, { color: Colors.powerOrange }]}>
          Recognition Engine
        </Text>
        
        <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
          <Text style={{ fontWeight: '800', color: theme === 'light' ? '#555555' : colors.textSecondary }}>Local:</Text> Uses built-in AI model for instant verification. {'\n'}
          <Text style={{ fontWeight: '800', color: theme === 'light' ? '#555555' : colors.textSecondary }}>Cloud:</Text> Uses internet to verify photos on the server.
        </Text>
      </View>

      <View style={[styles.toggleWrapper, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable 
          onPress={() => onSelect('camera_vision')}
          style={[
            styles.toggleBtn, 
            engine === 'camera_vision' && { backgroundColor: Colors.powerOrange }
          ]}
        >
          <Text style={[
            styles.toggleBtnText, 
            { color: engine === 'camera_vision' ? '#fff' : colors.textSecondary }
          ]}>
            LOCAL
          </Text>
        </Pressable>
        <Pressable 
          onPress={() => onSelect('facepp')}
          style={[
            styles.toggleBtn, 
            engine === 'facepp' && { backgroundColor: Colors.powerOrange }
          ]}
        >
          <Text style={[
            styles.toggleBtnText, 
            { color: engine === 'facepp' ? '#fff' : colors.textSecondary }
          ]}>
            CLOUD
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 115,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  rowTextBlock: {
    flex: 1,
    paddingRight: 20,
  },
  rowTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  rowDescription: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  toggleWrapper: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 3,
    width: 150,
    height: 48,
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
