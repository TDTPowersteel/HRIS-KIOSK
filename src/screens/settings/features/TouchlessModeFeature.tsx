import { Switch } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors } from '../../../config/theme';

type Props = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function TouchlessModeFeature({ enabled, onToggle }: Props) {
  return (
    <SettingRow
      title="Touchless Mode"
      description="Enable automatic face capture without manual trigger"
      action={
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: Colors.steelGray, true: Colors.powerOrange }}
          thumbColor="#ffffff"
        />
      }
    />
  );
}
