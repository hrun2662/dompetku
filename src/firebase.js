import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';
import defaultFirebaseConfig from '../firebase-applet-config.json';

// Safe Local Storage Config Loader
let firebaseConfig = defaultFirebaseConfig;
let usingCustom = false;

try {
  const customConfigStr = localStorage.getItem('dompetku_custom_firebase_config');
  if (customConfigStr) {
    const parsed = JSON.parse(customConfigStr);
    if (parsed && parsed.apiKey && parsed.projectId) {
      firebaseConfig = parsed;
      usingCustom = true;
      console.log('[Firebase] Menggunakan konfigurasi Firebase kustom:', firebaseConfig.projectId);
    }
  }
} catch (e) {
  console.warn('[Firebase] Gagal membaca konfigurasi kustom dari localStorage:', e);
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Metadata details
export const activeFirebaseConfig = firebaseConfig;
export const isUsingCustomConfig = usingCustom;

export function saveCustomFirebaseConfig(configObj) {
  try {
    localStorage.setItem('dompetku_custom_firebase_config', JSON.stringify(configObj));
    return true;
  } catch (e) {
    console.error('[Firebase] Gagal menyimpan konfigurasi kustom:', e);
    return false;
  }
}

export function resetFirebaseConfig() {
  try {
    localStorage.removeItem('dompetku_custom_firebase_config');
    return true;
  } catch (e) {
    console.error('[Firebase] Gagal menghapus konfigurasi kustom:', e);
    return false;
  }
}

// Safe Analytics initialization
export let analytics;
isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
});

