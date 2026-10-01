import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import {
  getDatabase,
  ref as dbRef,
  get as getRealtime,
  set as setRealtime,
  update as updateRealtime,
  remove as removeRealtime
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js";
import {
  firebaseConfig,
  REALTIME_DATABASE_URL,
  ADMIN_EMAIL,
  isFirebaseConfigured,
  isRealtimeConfigured
} from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let rtdb = null;

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  if (isRealtimeConfigured()) {
    rtdb = getDatabase(app, REALTIME_DATABASE_URL);
  }
}

export {
  app,
  auth,
  db,
  rtdb,
  ADMIN_EMAIL,
  isFirebaseConfigured,
  isRealtimeConfigured,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  dbRef,
  getRealtime,
  setRealtime,
  updateRealtime,
  removeRealtime
};
