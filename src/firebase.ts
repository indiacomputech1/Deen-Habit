import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User as FbUser,
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: ReturnType<typeof initializeApp> | null = null;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  // If config is missing or invalid, app may fail to initialize — callers should handle nulls.
}

const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

export function onAuthChange(cb: (user: FbUser | null) => void) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle() {
  if (!auth) throw new Error("Firebase not configured");
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOut() {
  if (!auth) return;
  await fbSignOut(auth);
}

export async function saveUserData(uid: string, data: any) {
  if (!db) throw new Error("Firestore not configured");
  const ref = doc(db, "users", uid);
  await setDoc(ref, { data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function loadUserData(uid: string) {
  if (!db) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const obj = snap.data();
  return obj?.data ?? null;
}

export { auth };
