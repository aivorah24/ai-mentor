// ── Push notifications (mobile only) ─────────────────────────────────────────
// Registers the device for Expo push and reports the token to the backend so the
// server can notify teachers/parents about new assignments, messages, etc.
// Everything here is a no-op on web — the web app never touches it.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import SERVER_URL from '../config/serverUrl';

let _registered = false;

// Lazy-require the native modules so the web bundle never imports them.
function nativeModules() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Device = require('expo-device');
  return { Notifications, Device };
}

// Show alerts/banners while the app is foregrounded.
export function configureForegroundHandler() {
  if (Platform.OS === 'web') return;
  try {
    const { Notifications } = nativeModules();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch {}
}

// Ask permission, get the Expo push token, and POST it to the backend for `email`.
export async function registerPushToken(email?: string): Promise<string | null> {
  if (Platform.OS === 'web' || !email) return null;
  try {
    const { Notifications, Device } = nativeModules();
    if (!Device.isDevice) return null; // simulators can't get a push token

    // Android needs an explicit channel for heads-up notifications.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Aivorah',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#C5A56A',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResp?.data;
    if (!token) return null;

    await fetch(`${SERVER_URL}/user/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, platform: Platform.OS }),
    }).catch(() => {});

    _registered = true;
    return token;
  } catch {
    return null;
  }
}

export function hasRegistered() {
  return _registered;
}
