import { useState, useEffect, useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import * as Location from 'expo-location';
import { SettingRow } from '../components/SettingRow';
import { Colors } from '../../../config/theme';

type Props = {
  attendance_location?: {
    latitude?: number;
    longitude?: number;
  };
  saveBackendSettings: (body: Record<string, any>) => Promise<any>;
};

export function SyncLocationFeature({ attendance_location, saveBackendSettings }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function resolveAddress() {
      if (attendance_location?.latitude && attendance_location?.longitude) {
        try {
          const geocode = await Location.reverseGeocodeAsync({
            latitude: attendance_location.latitude,
            longitude: attendance_location.longitude,
          });
          if (geocode.length > 0 && isMounted) {
            const loc = geocode[0];
            const formatted = [loc.name, loc.street, loc.city, loc.region, loc.country].filter(Boolean).join(', ');
            setAddress(formatted);
          }
        } catch (err) {
          console.log('Failed to reverse geocode', err);
        }
      } else {
        if (isMounted) setAddress(null);
      }
    }
    resolveAddress();
    return () => { isMounted = false; };
  }, [attendance_location]);

  const handleSetLocation = useCallback(async () => {
    setIsSaving(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Location permission is required.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      await saveBackendSettings({
        action: 'set_location',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      Alert.alert('Success', 'Attendance location updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to update location.');
    } finally {
      setIsSaving(false);
    }
  }, [saveBackendSettings]);

  const locationLines = useMemo(() => {
    const lat = attendance_location?.latitude;
    const lon = attendance_location?.longitude;
    const lines = [
      `Lat : ${lat ? lat.toFixed(7) : 'Not set'}`,
      `Long : ${lon ? lon.toFixed(7) : 'Not set'}`
    ];
    if (address) {
      lines.push(`Address : ${address}`);
    }
    return lines;
  }, [attendance_location, address]);

  return (
    <SettingRow
      title="Sync Location"
      description="Click to synchronize kiosk with current physical coordinates"
      extraText={locationLines}
      onPress={handleSetLocation}
      disabled={isSaving}
      action={isSaving ? <ActivityIndicator size="small" color={Colors.powerOrange} /> : null}
    />
  );
}
