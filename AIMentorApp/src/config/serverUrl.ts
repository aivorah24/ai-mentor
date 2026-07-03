import { Platform } from 'react-native';

// Backend base URL.
// - Web (production): '' → same-origin (served by the Express server).
// - Web (local dev):  local Express server.
// - Native (phone):   the LIVE backend, so Expo Go previews and shared APK builds
//   work anywhere without being on the same Wi-Fi as the dev machine.
//   (To test the mobile app against your LOCAL server instead, replace the native
//    value with your computer's LAN IP, e.g. 'http://10.104.63.1:3006', and keep
//    the phone on the same Wi-Fi with the server running.)
declare const __DEV__: boolean;

const LIVE_BACKEND = 'https://aivorah.ai';

const SERVER_URL =
  Platform.OS === 'web'
    ? (__DEV__ ? 'http://localhost:3006' : '')
    : LIVE_BACKEND;

export default SERVER_URL;
