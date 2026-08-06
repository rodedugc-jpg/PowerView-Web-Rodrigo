import { db, isFirebaseConfigured, doc, getDoc } from "./firebase-client.js";

const message = document.getElementById("viewer-message");
const stage = document.getElementById("viewer-stage");
const frame = document.getElementById("activity-frame");

function showMessage(title, body) {
  message.classList.remove("hidden");
  stage.classList.add("hidden");
  message.innerHTML = `<div class="glass"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(body)}</p></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
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
    if (!activity.html) return showMessage("Actividad vacía", "No existe código HTML guardado.");

    document.title = activity.title || "Actividad interactiva";
    frame.title = activity.title || "Actividad educativa";
    frame.srcdoc = activity.html;
    message.classList.add("hidden");
    stage.classList.remove("hidden");
  } catch (error) {
    showMessage("No se pudo abrir la actividad", error.message);
  }
}


loadActivity();
