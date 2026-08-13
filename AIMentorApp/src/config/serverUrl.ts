import { Platform } from 'react-native';

// Backend base URL.
// - Web (production, served FROM the real backend host, e.g. aivorah.ai -
//   see ../../vercel.json, which points server/index.js at every route
//   including the static frontend build): '' → same-origin.
// - Web (any OTHER host - a standalone/frontend-only static deployment,
//   e.g. a separate Vercel project that only builds AIMentorApp/dist2
//   without server/index.js behind it): same-origin has no API at all, so
//   every fetch 404/405s (and any fetch expecting JSON fails parsing the
//   SPA's index.html instead). Falls back to the LIVE backend instead.
//   Confirmed live at https://aivorah-frontend.vercel.app - every request
//   405'd until this fallback was added.
// - Web (local dev): local Express server.
// - Native (phone):   the LIVE backend, so Expo Go previews and shared APK builds
//   work anywhere without being on the same Wi-Fi as the dev machine.
//   (To test the mobile app against your LOCAL server instead, replace the native
//    value with your computer's LAN IP, e.g. 'http://10.104.63.1:3006', and keep
//    the phone on the same Wi-Fi with the server running.)
declare const __DEV__: boolean;

const LIVE_BACKEND = 'https://aivorah.ai';

// Hosts that are known to serve the backend themselves (same-origin API
// calls will work there). Anything else on web falls back to LIVE_BACKEND.
const SELF_HOSTED_WEB_HOSTNAMES = ['aivorah.ai', 'www.aivorah.ai'];

function resolveWebServerUrl(): string {
  if (__DEV__) return 'http://localhost:3006';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  return SELF_HOSTED_WEB_HOSTNAMES.includes(hostname) ? '' : LIVE_BACKEND;
}

const SERVER_URL = Platform.OS === 'web' ? resolveWebServerUrl() : LIVE_BACKEND;

export default SERVER_URL;
