import { initializeApp, getApps } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyD_Q9pYgqNOiImfTnJYYjAj4ZOBlZ2bE8w',
  authDomain: 'ai-learning-platform-c1308.firebaseapp.com',
  projectId: 'ai-learning-platform-c1308',
  storageBucket: 'ai-learning-platform-c1308.firebasestorage.app',
  messagingSenderId: '201607982243',
  appId: '1:201607982243:web:0cb19296eeddd52c2ee316',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Web: getAuth() defaults to browserLocalPersistence — no initializeAuth needed.
// Native: must use initializeAuth with AsyncStorage persistence explicitly.
let auth: ReturnType<typeof getAuth>;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(app);
  }
}

export { auth };
export default app;
