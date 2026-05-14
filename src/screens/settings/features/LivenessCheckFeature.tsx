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
      description="Confirms a live person is present to prevent using photos or videos for attendance. Turn this off for faster scanning."
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
