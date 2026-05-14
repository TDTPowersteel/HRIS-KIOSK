import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, ThemeType, Theme, Colors } from '../../../config/theme';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

export function ThemeSelectorFeature() {
  const { theme, setTheme, colors } = useTheme();

  return (
    <View style={[styles.themeSection, { borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>APPLICATION THEME</Text>
      <View style={styles.themeGrid}>
        {(['light', 'dark', 'industrial', 'midnight'] as ThemeType[]).map((t) => (
          <Pressable 
            key={t}
            onPress={() => setTheme(t)}
            style={[
              styles.themeOption, 
              { 
                backgroundColor: Theme[t].background, 
                borderColor: theme === t ? Colors.powerOrange : colors.border 
              }
            ]}
          >
            <View style={[styles.themePreview, { backgroundColor: Theme[t].surface }]} />
            <Text style={[
              styles.themeLabel, 
              { color: Theme[t].text }
            ]}>
              {t.toUpperCase()}
            </Text>
            {theme === t && <View style={styles.themeActiveDot} />}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  themeSection: {
    marginTop: 10,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  themeOption: {
    width: (WINDOW_WIDTH - 120) / 4,
    minWidth: 80,
    height: 100,
    borderRadius: 16,
    borderWidth: 2,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  themePreview: {
    width: '100%',
    height: 40,
    borderRadius: 8,
    marginBottom: 8,
  },
  themeLabel: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  themeActiveDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.powerOrange,
  },
});
