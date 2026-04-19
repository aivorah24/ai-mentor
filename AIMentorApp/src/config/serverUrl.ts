import { Platform } from 'react-native';

// In production web, point to the deployed backend.
// In local development, point to the local Express server.
declare const __DEV__: boolean;
const SERVER_URL =
  Platform.OS === 'web' && !__DEV__ ? '' : 'http://localhost:3001';

export default SERVER_URL;
