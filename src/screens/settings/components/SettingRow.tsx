import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, Colors } from '../../../config/theme';

export type SettingRowProps = {
  title: string;
  description?: string;
  extraText?: string[];
  action?: ReactNode;
  danger?: boolean;
  onPress?: () => void;
  disabled?: boolean;
};

export function SettingRow({ title, description, extraText = [], action, danger = false, onPress, disabled = false }: SettingRowProps) {
  const { colors } = useTheme();
  
  const renderContent = (pressed = false) => (
    <View style={[
      styles.row, 
      { 
        backgroundColor: (pressed && onPress) ? colors.background : colors.surface, 
        borderColor: colors.border 
      },
      disabled && styles.rowDisabled
    ]}>
      <View style={styles.rowTextBlock}>
        <Text style={[
          styles.rowTitle, 
          { color: danger ? '#ef4444' : Colors.powerOrange }
        ]}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
            {description}
          </Text>
        ) : null}
        {extraText.map((item) => (
          <Text key={item} style={[styles.rowMeta, { color: Colors.steelGray }]}>
            {item}
          </Text>
        ))}
      </View>
      {action ? <View style={styles.rowAction}>{action}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => renderContent(pressed)}
      </Pressable>
    );
  }

  return renderContent(false);
}

const styles = StyleSheet.create({
  row: {
    minHeight: 110,
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
  rowDisabled: {
    opacity: 1,
  },
  rowTextBlock: {
    flex: 1,
    paddingRight: 20,
  },
  rowTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  rowDescription: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  rowMeta: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  rowAction: {
    marginLeft: 10,
  },
});
