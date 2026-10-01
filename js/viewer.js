import {
  db,
  rtdb,
  isFirebaseConfigured,
  isRealtimeConfigured,
  doc,
  getDoc,
  dbRef,
  getRealtime
} from "./firebase-client.js";

const message = document.getElementById("viewer-message");

function showMessage(title, body) {
  message.classList.remove("hidden");
  message.innerHTML = `<div class="glass"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(body)}</p></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function runAsDocument(html) {
  document.open("text/html", "replace");
  document.write(html);
  document.close();
}

async function readChunkedHtml(id) {
  if (!isRealtimeConfigured() || !rtdb) {
    throw new Error("Realtime Database todavía no está configurado para esta versión de PowerView.");
  }
  const snapshot = await getRealtime(dbRef(rtdb, `htmlActivities/${id}`));
  if (!snapshot.exists()) throw new Error("No se encontró el archivo HTML de esta actividad.");
  const data = snapshot.val() || {};
  if (!data.ready) throw new Error("El archivo HTML todavía no terminó de cargarse.");
  const chunks = data.chunks || {};
  const html = Object.keys(chunks).sort().map((key) => chunks[key]).join("");
  if (!html) throw new Error("El archivo HTML está vacío.");
  return html;
}

async function loadActivity() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) return showMessage("Falta el enlace de la actividad", "El enlace debe incluir ?id=nombre-de-la-actividad.");
  if (!isFirebaseConfigured() || !db) return showMessage("Visor no configurado", "Todavía falta conectar este sitio con Firebase.");

  try {
    const snapshot = await getDoc(doc(db, "activities", id));
    if (!snapshot.exists()) return showMessage("Actividad no encontrada", "Revisa que el enlace sea correcto.");
    const activity = snapshot.data();
    if (!activity.published) return showMessage("Actividad no publicada", "Esta actividad todavía está en borrador.");

    // Compatibilidad automática con actividades antiguas guardadas directamente en Firestore.
    if (activity.html) return runAsDocument(activity.html);

    const html = await readChunkedHtml(id);
    runAsDocument(html);
  } catch (error) {
    showMessage("No se pudo abrir la actividad", error.message);
  }
}

loadActivity();
