import { Switch } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors } from '../../../config/theme';

type Props = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function LivenessCheckFeature({ enabled, onToggle }: Props) {
  return (
    <SettingRow
      title="Liveness Check"
      description="When enabled, uses on-device face detection for liveness verification before sending to Face++. When disabled, only Face++ matching is used."
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
