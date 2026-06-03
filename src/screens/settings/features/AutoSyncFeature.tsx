import { Switch } from 'react-native';
import { SettingRow } from '../components/SettingRow';
import { Colors } from '../../../config/theme';

type Props = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function AutoSyncFeature({ enabled, onToggle }: Props) {
  return (
    <SettingRow
      title="Auto-Sync Offline Logs"
      description="Automatically pushes pending attendance logs to the server when a stable internet connection is detected."
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
