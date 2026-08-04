import {
  auth,
  db,
  ADMIN_EMAIL,
  isFirebaseConfigured,
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
  serverTimestamp
} from "./firebase-client.js";
import { validateActivityHtml, slugify, formatBytes, byteLength } from "./validator.js";

const $ = (id) => document.getElementById(id);
const ui = {
  connection: $("connection-status"),
  configWarning: $("config-warning"),
  authUser: $("auth-user"),
  login: $("login-btn"),
  logout: $("logout-btn"),
  title: $("title"),
  course: $("course"),
  subject: $("subject"),
  slug: $("slug"),
  description: $("description"),
  published: $("published"),
  code: $("game-code"),
  size: $("size-label"),
  currentId: $("current-id"),
  validate: $("validate-btn"),
  preview: $("preview-btn"),
  save: $("save-btn"),
  fresh: $("new-btn"),
  copyLink: $("copy-link-btn"),
  copyBlogger: $("copy-blogger-btn"),
  refresh: $("refresh-btn"),
  report: $("validation-report"),
  list: $("activity-list"),
  modal: $("preview-modal"),
  frame: $("preview-frame"),
  closePreview: $("close-preview"),
  previewFullscreen: $("preview-fullscreen")
};

let currentUser = null;
let currentDocId = null;
let slugTouched = false;
let lastValidation = null;

function isAdmin(user) {
  return Boolean(
    user?.email &&
    ADMIN_EMAIL &&
    ADMIN_EMAIL !== "TU_CORREO@gmail.com" &&
    user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );
}

function setReport(type, lines) {
  ui.report.className = `status ${type}`;
  ui.report.textContent = Array.isArray(lines) ? lines.join("\n") : lines;
}

function refreshPermissions() {
  const allowed = Boolean(isFirebaseConfigured() && isAdmin(currentUser) && lastValidation?.valid);
  ui.save.disabled = !allowed;
  ui.copyLink.disabled = !currentDocId;
  ui.copyBlogger.disabled = !currentDocId;
}

function updateSize() {
  ui.size.textContent = formatBytes(byteLength(ui.code.value));
  lastValidation = null;
  refreshPermissions();
}

function buildValidationReport(result) {
  const lines = [];
  if (result.errors.length) {
    lines.push("ERRORES:");
    result.errors.forEach((item) => lines.push(`• ${item}`));
  }
  if (result.warnings.length) {
    lines.push(result.errors.length ? "\nADVERTENCIAS:" : "ADVERTENCIAS:");
    result.warnings.forEach((item) => lines.push(`• ${item}`));
  }
  if (result.info.length) {
    lines.push(lines.length ? "\nINFORMACIÓN:" : "INFORMACIÓN:");
    result.info.forEach((item) => lines.push(`• ${item}`));
  }
  if (result.valid) lines.unshift("✅ CÓDIGO APROBADO POR LA VALIDACIÓN AUTOMÁTICA.");
  return lines;
}

function validateNow() {
  lastValidation = validateActivityHtml(ui.code.value);
  setReport(lastValidation.valid ? (lastValidation.warnings.length ? "warn" : "ok") : "error", buildValidationReport(lastValidation));
  refreshPermissions();
  return lastValidation;
}

function clearForm() {
  currentDocId = null;
  slugTouched = false;
  lastValidation = null;
  ui.title.value = "";
  ui.course.value = "";
  ui.subject.value = "Lenguaje";
  ui.slug.value = "";
  ui.description.value = "";
  ui.published.checked = true;
  ui.code.value = "";
  ui.currentId.textContent = "Actividad nueva";
  ui.copyLink.disabled = true;
  ui.copyBlogger.disabled = true;
  updateSize();
  setReport("warn", "Pega un código y pulsa “Validar”.");
  ui.title.focus();
}

function activityUrl(id) {
  const url = new URL("./visor.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function bloggerEmbedCode(id, title) {
  const src = activityUrl(id);
  const safeTitle = (title || "Actividad educativa interactiva").replace(/"/g, "&quot;");
  return `<iframe
  src="${src}"
  title="${safeTitle}"
  style="display:block;width:100%;height:clamp(520px,78vh,820px);border:0;border-radius:16px;background:#000;"
  loading="lazy"
  allow="fullscreen; autoplay"
  allowfullscreen>
</iframe>`;
}

async function copyText(text, successMessage) {
  await navigator.clipboard.writeText(text);
  setReport("ok", successMessage);
}

function openPreview(html) {
  if (!html.trim()) {
    setReport("error", "No hay código para previsualizar.");
    return;
  }
  ui.frame.srcdoc = html;
  ui.modal.classList.add("open");
  ui.modal.setAttribute("aria-hidden", "false");
}

function closePreview() {
  ui.modal.classList.remove("open");
  ui.modal.setAttribute("aria-hidden", "true");
  ui.frame.srcdoc = "";
}

async function loadActivities() {
  if (!db || !isAdmin(currentUser)) {
    ui.list.innerHTML = '<div class="status warn">Inicia sesión con el correo administrador para cargar la biblioteca.</div>';
    return;
  }
  ui.list.innerHTML = '<div class="status warn">Cargando…</div>';
  try {
    const snapshot = await getDocs(collection(db, "activities"));
    const items = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    items.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
    if (!items.length) {
      ui.list.innerHTML = '<div class="status warn">Todavía no hay actividades guardadas.</div>';
      return;
    }
    ui.list.innerHTML = "";
    items.forEach((item) => ui.list.appendChild(renderActivityCard(item)));
  } catch (error) {
    ui.list.innerHTML = `<div class="status error">No se pudo cargar la biblioteca: ${escapeHtml(error.message)}</div>`;
  }
}

function renderActivityCard(item) {
  const card = document.createElement("article");
  card.className = "activity-card";
  const statusClass = item.published ? "live" : "draft";
  const statusText = item.published ? "Publicada" : "Borrador";
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
      <h3>${escapeHtml(item.title || item.id)}</h3>
      <span class="pill ${statusClass}">${statusText}</span>
    </div>
    <p>${escapeHtml(item.course || "Sin curso")} · ${escapeHtml(item.subject || "Sin materia")}<br>${formatBytes(byteLength(item.html || ""))}</p>
    <div class="activity-actions">
      <button class="btn small ghost" data-action="edit">Editar</button>
      <button class="btn small ghost" data-action="open">Abrir</button>
      <button class="btn small success" data-action="link">Copiar enlace</button>
      <button class="btn small danger" data-action="delete">Eliminar</button>
    </div>`;

  card.querySelector('[data-action="edit"]').addEventListener("click", () => loadIntoForm(item));
  card.querySelector('[data-action="open"]').addEventListener("click", () => window.open(activityUrl(item.id), "_blank", "noopener"));
  card.querySelector('[data-action="link"]').addEventListener("click", () => copyText(activityUrl(item.id), "Enlace público copiado."));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => removeActivity(item.id, item.title));
  return card;
}

function loadIntoForm(item) {
  currentDocId = item.id;
  slugTouched = true;
  ui.title.value = item.title || "";
  ui.course.value = item.course || "";
  ui.subject.value = item.subject || "Lenguaje";
  ui.slug.value = item.id;
  ui.description.value = item.description || "";
  ui.published.checked = Boolean(item.published);
  ui.code.value = item.html || "";
  ui.currentId.textContent = `Editando: ${item.id}`;
  updateSize();
  validateNow();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveActivity() {
  if (!isAdmin(currentUser)) {
    setReport("error", "No tienes autorización para guardar actividades.");
    return;
  }
  const result = validateNow();
  if (!result.valid) return;

  const title = ui.title.value.trim();
  const id = slugify(ui.slug.value || title);
  if (!title) return setReport("error", "Debes escribir el título de la actividad.");
  if (!id) return setReport("error", "No se pudo generar un identificador válido para el enlace.");
  if (currentDocId && currentDocId !== id) {
    return setReport("error", "Para cambiar el identificador de una actividad existente, duplícala como una actividad nueva.");
  }

  ui.save.disabled = true;
  setReport("warn", "Guardando la actividad en internet…");
  try {
    const ref = doc(db, "activities", id);
    const previous = await getDoc(ref);
    if (previous.exists() && !currentDocId) {
      setReport("error", `Ya existe una actividad con el identificador “${id}”. Abre esa actividad para editarla o usa otro identificador.`);
      return;
    }
    const payload = {
      title,
      course: ui.course.value.trim(),
      subject: ui.subject.value.trim(),
      description: ui.description.value.trim(),
      published: ui.published.checked,
      html: ui.code.value,
      ownerEmail: currentUser.email,
      updatedAt: serverTimestamp()
    };
    if (!previous.exists()) payload.createdAt = serverTimestamp();
    await setDoc(ref, payload, { merge: true });
    currentDocId = id;
    ui.currentId.textContent = `Guardada: ${id}`;
    setReport("ok", `✅ Actividad guardada correctamente.\nEnlace: ${activityUrl(id)}`);
    refreshPermissions();
    await loadActivities();
  } catch (error) {
    setReport("error", `No se pudo guardar: ${error.message}`);
  } finally {
    refreshPermissions();
  }
}

async function removeActivity(id, title) {
  if (!isAdmin(currentUser)) return;
  const accepted = window.confirm(`¿Eliminar definitivamente “${title || id}”?`);
  if (!accepted) return;
  try {
    await deleteDoc(doc(db, "activities", id));
    if (currentDocId === id) clearForm();
    setReport("ok", "Actividad eliminada.");
    await loadActivities();
  } catch (error) {
    setReport("error", `No se pudo eliminar: ${error.message}`);
  }
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

ui.title.addEventListener("input", () => {
  if (!slugTouched) ui.slug.value = slugify(ui.title.value);
});
ui.slug.addEventListener("input", () => {
  slugTouched = true;
  ui.slug.value = slugify(ui.slug.value);
});
ui.code.addEventListener("input", updateSize);
ui.validate.addEventListener("click", validateNow);
ui.preview.addEventListener("click", () => openPreview(ui.code.value));
ui.save.addEventListener("click", saveActivity);
ui.fresh.addEventListener("click", clearForm);
ui.refresh.addEventListener("click", loadActivities);
ui.copyLink.addEventListener("click", () => currentDocId && copyText(activityUrl(currentDocId), "Enlace público copiado."));
ui.copyBlogger.addEventListener("click", () => currentDocId && copyText(bloggerEmbedCode(currentDocId, ui.title.value), "Código corto para Blogger copiado."));
ui.closePreview.addEventListener("click", closePreview);
ui.modal.addEventListener("click", (event) => { if (event.target === ui.modal) closePreview(); });
ui.previewFullscreen.addEventListener("click", () => ui.frame.requestFullscreen?.());

if (!isFirebaseConfigured()) {
  ui.configWarning.classList.remove("hidden");
  ui.configWarning.textContent = "CONFIGURACIÓN PENDIENTE: abre js/firebase-config.js y reemplaza los datos REEMPLAZAR por la configuración de tu proyecto Firebase.";
  ui.login.disabled = true;
  ui.connection.textContent = "Firebase todavía no está configurado";
}
if (ADMIN_EMAIL === "TU_CORREO@gmail.com") {
  ui.configWarning.classList.remove("hidden");
  ui.configWarning.textContent += `${ui.configWarning.textContent ? "\n" : ""}También debes sustituir TU_CORREO@gmail.com por tu correo de Google.`;
}

ui.login.addEventListener("click", async () => {
  if (!auth) return;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    setReport("error", `No se pudo iniciar sesión: ${error.message}`);
  }
});
ui.logout.addEventListener("click", () => auth && signOut(auth));

if (auth) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      ui.authUser.textContent = "No has iniciado sesión.";
      ui.login.classList.remove("hidden");
      ui.logout.classList.add("hidden");
      ui.connection.textContent = "Panel privado del Prof. Rodrigo";
      refreshPermissions();
      await loadActivities();
      return;
    }

    ui.login.classList.add("hidden");
    ui.logout.classList.remove("hidden");
    ui.authUser.textContent = `${user.displayName || "Usuario"}\n${user.email}`;
    if (isAdmin(user)) {
      ui.connection.textContent = "Conectado a la biblioteca de actividades";
      setReport("ok", "Sesión de administrador iniciada. Pega una actividad o selecciona una de la biblioteca.");
      await loadActivities();
    } else {
      ui.connection.textContent = "Cuenta sin autorización";
      setReport("error", `Esta cuenta no coincide con ADMIN_EMAIL.\nCuenta actual: ${user.email}\nCorreo autorizado: ${ADMIN_EMAIL}`);
    }
    refreshPermissions();
  });
}

updateSize();
