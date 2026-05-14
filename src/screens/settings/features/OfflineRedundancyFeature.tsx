import { Switch } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors } from '../../../config/theme';

type Props = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function OfflineRedundancyFeature({ enabled, onToggle }: Props) {
  return (
    <SettingRow
      title="Offline Redundancy"
      description="Buffer attendance locally when network is unstable"
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
