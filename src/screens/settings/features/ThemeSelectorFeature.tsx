import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, ThemeType, Theme, Colors } from '../../../config/theme';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

export function ThemeSelectorFeature() {
  const { theme, setTheme, colors } = useTheme();

  return (
    <View style={styles.container}>
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
  container: {
    marginTop: 8,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  themeOption: {
    flex: 1,
    minWidth: '22%',
    height: 110,
    borderRadius: 18,
    borderWidth: 2,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  themePreview: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    marginBottom: 10,
  },
  themeLabel: {
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  themeActiveDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.powerOrange,
  },
});
