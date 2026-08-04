// CONFIGURACIÓN DE POWERVIEW WEB

export const firebaseConfig = {
  apiKey: "AIzaSyBzBTEktwdTAe983QbmBmnPc8G4Gxtes2Y",
  authDomain: "powerview-web-rodrigo.firebaseapp.com",
  projectId: "powerview-web-rodrigo",
  storageBucket: "powerview-web-rodrigo.firebasestorage.app",
  messagingSenderId: "1036873237465",
  appId: "1:1036873237465:web:0c64ad1e7ab76ca3944fc8"
};

export const ADMIN_EMAIL = "rodedugc@gmail.com";

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(
    (value) =>
      typeof value === "string" &&
      value.trim() !== "" &&
      !value.includes("REEMPLAZAR")
  );
}