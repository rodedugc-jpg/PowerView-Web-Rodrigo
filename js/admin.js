import {
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
  dbRef,
  getRealtime,
  setRealtime,
  updateRealtime,
  removeRealtime
} from "./firebase-client.js";
import { validateActivityHtml, slugify, formatBytes, byteLength } from "./validator.js";

const FOLDER_DOC_ID = "__powerview_folders__";
const ALL_FOLDER = "__all__";
const UNFILED_FOLDER = "__unfiled__";
const HTML_CHUNK_MAX_BYTES = 700_000;

const $ = (id) => document.getElementById(id);
const ui = {
  connection: $("connection-status"), configWarning: $("config-warning"), authUser: $("auth-user"),
  login: $("login-btn"), logout: $("logout-btn"), title: $("title"), course: $("course"), subject: $("subject"),
  slug: $("slug"), description: $("description"), published: $("published"), code: $("game-code"),
  size: $("size-label"), currentId: $("current-id"), validate: $("validate-btn"), preview: $("preview-btn"),
  run: $("run-btn"), save: $("save-btn"), fresh: $("new-btn"), copyLink: $("copy-link-btn"),
  copyEmbed: $("copy-embed-btn"), refresh: $("refresh-btn"), report: $("validation-report"), list: $("activity-list"),
  modal: $("preview-modal"), frame: $("preview-frame"), closePreview: $("close-preview"),
  importHtml: $("import-html-btn"), fileInput: $("html-file-input"), search: $("activity-search"),
  newFolder: $("new-folder-btn"), folderList: $("folder-list"), currentFolderName: $("current-folder-name"),
  activityCount: $("activity-count"), reorderHint: $("reorder-hint"), moveModal: $("move-modal"),
  moveActivityName: $("move-activity-name"), moveFolderSelect: $("move-folder-select"),
  moveNewFolderName: $("move-new-folder-name"), cancelMove: $("cancel-move-btn"), confirmMove: $("confirm-move-btn"),
  createAndMove: $("create-and-move-btn")
};

let currentUser = null;
let currentDocId = null;
let slugTouched = false;
let lastValidation = null;
let activities = [];
let folders = [];
let selectedFolderId = ALL_FOLDER;
let pendingMoveActivity = null;
let draggedActivityId = null;

function isAdmin(user) {
  return Boolean(user?.email && ADMIN_EMAIL && ADMIN_EMAIL !== "TU_CORREO@gmail.com" && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

function setReport(type, lines) {
  ui.report.className = `status ${type}`;
  ui.report.textContent = Array.isArray(lines) ? lines.join("\n") : lines;
}

function refreshPermissions() {
  const allowed = Boolean(isFirebaseConfigured() && isRealtimeConfigured() && rtdb && isAdmin(currentUser) && lastValidation?.valid);
  ui.save.disabled = !allowed;
  ui.copyLink.disabled = !currentDocId;
  ui.copyEmbed.disabled = !currentDocId;
  ui.newFolder.disabled = !isAdmin(currentUser);
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
  if (result.valid) lines.unshift("✅ HTML ACEPTADO POR POWERVIEW.");
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
  ui.copyEmbed.disabled = true;
  updateSize();
  setReport("warn", "Pega o importa un HTML y pulsa “Validar”.");
  ui.title.focus();
}

function activityUrl(id) {
  const url = new URL("./visor.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function embedCode(id, title) {
  const src = activityUrl(id);
  const safeTitle = (title || "Actividad educativa interactiva").replace(/"/g, "&quot;");
  return `<div style="width:100%;max-width:1200px;margin:0 auto;">
  <iframe
    src="${src}"
    title="${safeTitle}"
    style="display:block;width:100%;height:clamp(520px,78vh,820px);border:0;border-radius:16px;background:#000;"
    loading="lazy"
    allow="fullscreen; autoplay; clipboard-read; clipboard-write; camera; microphone; geolocation; gyroscope; accelerometer; gamepad"
    allowfullscreen>
  </iframe>
</div>`;
}

async function copyText(text, successMessage) {
  await navigator.clipboard.writeText(text);
  setReport("ok", successMessage);
}

let previewObjectUrl = null;

function openPreview(html) {
  if (!html.trim()) return setReport("error", "No hay código para previsualizar.");
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  ui.frame.removeAttribute("srcdoc");
  ui.frame.src = previewObjectUrl;
  ui.modal.classList.add("open");
  ui.modal.setAttribute("aria-hidden", "false");
}

function closePreview() {
  ui.modal.classList.remove("open");
  ui.modal.setAttribute("aria-hidden", "true");
  ui.frame.src = "about:blank";
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

function runHtmlStandalone(html) {
  if (!html.trim()) return setReport("error", "No hay código HTML para ejecutar.");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) setReport("error", "El navegador bloqueó la nueva pestaña. Permite ventanas emergentes para PowerView.");
  else setReport("ok", "HTML abierto en una pestaña independiente para probarlo sin el marco de vista previa.");
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function importHtmlFile(file) {
  if (!file) return;
  try {
    const html = await file.text();
    if (!html.trim()) return setReport("error", "El archivo seleccionado está vacío.");
    if (currentDocId || ui.code.value.trim()) {
      const accepted = window.confirm("Importar reemplazará el contenido actual del editor. ¿Continuar?");
      if (!accepted) return;
    }
    clearForm();
    ui.code.value = html;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const inferredTitle = (parsed.title || file.name.replace(/\.(html?|HTML?)$/i, "")).trim();
    ui.title.value = inferredTitle;
    ui.slug.value = slugify(inferredTitle);
    slugTouched = false;
    ui.currentId.textContent = `Importado: ${file.name} · sin guardar`;
    updateSize();
    validateNow();
    setReport(lastValidation.valid ? "ok" : "error", [`📂 Archivo importado: ${file.name}`, ...buildValidationReport(lastValidation)]);
  } catch (error) {
    setReport("error", `No se pudo leer el archivo HTML: ${error.message}`);
  } finally {
    ui.fileInput.value = "";
  }
}

function splitUtf8IntoChunks(text, maxBytes = HTML_CHUNK_MAX_BYTES) {
  const encoder = new TextEncoder();
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxBytes);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(end))) end -= 1;
    let piece = text.slice(start, end);
    if (encoder.encode(piece).length > maxBytes) {
      let low = start + 1;
      let high = end;
      let best = low;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = text.slice(start, mid);
        if (encoder.encode(candidate).length <= maxBytes) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      end = best;
      if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(end))) end -= 1;
      piece = text.slice(start, end);
    }
    if (!piece) throw new Error("No se pudo dividir el archivo HTML en bloques seguros.");
    chunks.push(piece);
    start = end;
  }
  return chunks;
}

async function writeHtmlToRealtime(id, html, published) {
  if (!isRealtimeConfigured() || !rtdb) throw new Error("Realtime Database todavía no está configurado.");
  const chunks = splitUtf8IntoChunks(html);
  const root = dbRef(rtdb, `htmlActivities/${id}`);
  await setRealtime(root, {
    published: false,
    ready: false,
    size: byteLength(html),
    chunkCount: chunks.length,
    updatedAt: Date.now(),
    ownerEmail: currentUser?.email || ADMIN_EMAIL
  });
  for (let i = 0; i < chunks.length; i += 1) {
    const key = String(i).padStart(5, "0");
    setReport("warn", `Subiendo HTML… bloque ${i + 1}/${chunks.length} (${Math.round(((i + 1) / chunks.length) * 100)}%)`);
    await setRealtime(dbRef(rtdb, `htmlActivities/${id}/chunks/${key}`), chunks[i]);
  }
  await updateRealtime(root, {
    published: Boolean(published),
    ready: true,
    size: byteLength(html),
    chunkCount: chunks.length,
    updatedAt: Date.now()
  });
  return { chunkCount: chunks.length, size: byteLength(html) };
}

async function readHtmlFromRealtime(id) {
  if (!isRealtimeConfigured() || !rtdb) throw new Error("Realtime Database todavía no está configurado.");
  const snapshot = await getRealtime(dbRef(rtdb, `htmlActivities/${id}`));
  if (!snapshot.exists()) throw new Error("No se encontró el HTML almacenado para esta actividad.");
  const data = snapshot.val() || {};
  const chunks = data.chunks || {};
  const html = Object.keys(chunks).sort().map((key) => chunks[key]).join("");
  if (!html) throw new Error("La actividad no contiene bloques HTML.");
  return html;
}

async function deleteHtmlFromRealtime(id) {
  if (!isRealtimeConfigured() || !rtdb) return;
  await removeRealtime(dbRef(rtdb, `htmlActivities/${id}`));
}

async function htmlForItem(item) {
  if (item?.html) return item.html; // compatibilidad con v1/v2
  return readHtmlFromRealtime(item.id);
}

function normalizeFolderId(value) {
  return value && value !== UNFILED_FOLDER && value !== ALL_FOLDER ? value : "";
}

function folderName(id) {
  if (id === ALL_FOLDER) return "Todas las actividades";
  if (id === UNFILED_FOLDER || !id) return "Sin carpeta";
  return folders.find((f) => f.id === id)?.name || "Carpeta";
}

function nextOrderForFolder(folderId) {
  const same = activities.filter((item) => (item.folderId || "") === (folderId || ""));
  const max = same.reduce((value, item) => Math.max(value, Number(item.order) || 0), 0);
  return max + 1000;
}

async function loadActivities() {
  if (!db || !isAdmin(currentUser)) {
    ui.list.innerHTML = '<div class="status warn">Inicia sesión con el correo administrador para cargar la biblioteca.</div>';
    ui.folderList.innerHTML = "";
    return;
  }
  ui.list.innerHTML = '<div class="status warn">Cargando…</div>';
  try {
    const snapshot = await getDocs(collection(db, "activities"));
    const folderSnap = snapshot.docs.find((snap) => snap.id === FOLDER_DOC_ID);
    const folderData = folderSnap?.data();
    folders = Array.isArray(folderData?.folders) ? folderData.folders.filter((f) => f?.id && f?.name) : [];
    folders.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || a.name.localeCompare(b.name, "es"));
    activities = snapshot.docs
      .filter((snap) => snap.id !== FOLDER_DOC_ID && snap.data()?.type !== "system")
      .map((snap) => ({ id: snap.id, ...snap.data() }));
    renderLibrary();
  } catch (error) {
    ui.list.innerHTML = `<div class="status error">No se pudo cargar la biblioteca: ${escapeHtml(error.message)}</div>`;
  }
}

function matchesSelectedFolder(item) {
  if (selectedFolderId === ALL_FOLDER) return true;
  if (selectedFolderId === UNFILED_FOLDER) return !item.folderId;
  return item.folderId === selectedFolderId;
}

function visibleActivities() {
  const needle = ui.search.value.trim().toLowerCase();
  const filtered = activities.filter((item) => {
    const text = `${item.title || ""} ${item.course || ""} ${item.subject || ""} ${item.description || ""}`.toLowerCase();
    return matchesSelectedFolder(item) && (!needle || text.includes(needle));
  });
  if (selectedFolderId === ALL_FOLDER) {
    filtered.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
  } else {
    filtered.sort((a, b) => (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER) || timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
  }
  return filtered;
}

function renderLibrary() {
  renderFolders();
  renderActivities();
}

function renderFolders() {
  const countFor = (folderId) => activities.filter((item) => folderId === ALL_FOLDER ? true : folderId === UNFILED_FOLDER ? !item.folderId : item.folderId === folderId).length;
  ui.folderList.innerHTML = "";

  const baseFolders = [
    { id: ALL_FOLDER, name: "Todas las actividades", icon: "🏠", system: true },
    { id: UNFILED_FOLDER, name: "Sin carpeta", icon: "📄", system: true }
  ];
  [...baseFolders, ...folders.map((f) => ({ ...f, icon: "📁", system: false }))].forEach((folder) => {
    const row = document.createElement("div");
    row.className = `folder-row ${selectedFolderId === folder.id ? "active" : ""}`;
    row.innerHTML = `
      <button class="folder-open" type="button" data-open-folder="${escapeHtml(folder.id)}">
        <span>${folder.icon}</span><span class="folder-name">${escapeHtml(folder.name)}</span><span class="folder-count">${countFor(folder.id)}</span>
      </button>
      ${folder.system ? "" : `<div class="folder-menu-wrap"><button class="kebab folder-kebab" type="button" aria-label="Opciones de carpeta">⋮</button><div class="popover-menu hidden"><button data-folder-action="rename">✏️ Renombrar</button><button data-folder-action="delete" class="danger-text">🗑️ Eliminar carpeta</button></div></div>`}`;
    row.querySelector("[data-open-folder]").addEventListener("click", () => {
      selectedFolderId = folder.id;
      renderLibrary();
    });
    if (!folder.system) {
      const kebab = row.querySelector(".folder-kebab");
      const menu = row.querySelector(".popover-menu");
      kebab.addEventListener("click", (event) => { event.stopPropagation(); closeAllMenus(menu); menu.classList.toggle("hidden"); });
      row.querySelector('[data-folder-action="rename"]').addEventListener("click", () => renameFolder(folder.id));
      row.querySelector('[data-folder-action="delete"]').addEventListener("click", () => deleteFolder(folder.id));
    }
    ui.folderList.appendChild(row);
  });
}

function renderActivities() {
  const items = visibleActivities();
  ui.currentFolderName.textContent = folderName(selectedFolderId);
  ui.activityCount.textContent = `${items.length} ${items.length === 1 ? "actividad" : "actividades"}`;
  ui.reorderHint.textContent = selectedFolderId === ALL_FOLDER || ui.search.value.trim() ? "" : "Arrastra para ordenar";
  ui.list.innerHTML = "";
  if (!items.length) {
    ui.list.innerHTML = `<div class="status warn">${ui.search.value.trim() ? "No se encontraron actividades con esa búsqueda." : "Esta carpeta todavía no tiene actividades."}</div>`;
    return;
  }
  items.forEach((item) => ui.list.appendChild(renderActivityCard(item)));
}

function renderActivityCard(item) {
  const card = document.createElement("article");
  card.className = "activity-card";
  card.dataset.activityId = item.id;
  const canReorder = selectedFolderId !== ALL_FOLDER && !ui.search.value.trim();
  card.draggable = canReorder;
  const statusClass = item.published ? "live" : "draft";
  const statusText = item.published ? "Publicada" : "Borrador";
  card.innerHTML = `
    <div class="activity-card-head">
      <div class="activity-title-wrap"><span class="drag-handle" title="Arrastrar">${canReorder ? "☰" : ""}</span><h3>${escapeHtml(item.title || item.id)}</h3></div>
      <div class="card-top-actions"><span class="pill ${statusClass}">${statusText}</span><div class="card-menu-wrap"><button class="kebab activity-kebab" type="button" aria-label="Opciones">⋮</button><div class="popover-menu activity-menu hidden">
        <button data-action="edit">✏️ Editar</button>
        <button data-action="open">▶️ Abrir</button>
        <button data-action="link">🔗 Copiar enlace</button>
        <button data-action="embed">🧩 Copiar inserción</button>
        <div class="menu-separator"></div>
        <button data-action="move">📁 Mover a carpeta</button>
        <button data-action="newfoldermove">➕ Crear carpeta y mover</button>
        <button data-action="duplicate">📄 Duplicar</button>
        <div class="menu-separator"></div>
        <button data-action="delete" class="danger-text">🗑️ Eliminar</button>
      </div></div></div>
    </div>
    <p>${escapeHtml(item.course || "Sin curso")} · ${escapeHtml(item.subject || "Sin materia")}<br>${formatBytes(Number(item.htmlSize) || byteLength(item.html || ""))}${item.folderId ? ` · 📁 ${escapeHtml(folderName(item.folderId))}` : ""}</p>
    <div class="activity-quick-actions"><button class="btn small ghost" data-quick-open>▶ Abrir</button><button class="btn small success" data-quick-link>Copiar enlace</button></div>`;

  const menu = card.querySelector(".activity-menu");
  card.querySelector(".activity-kebab").addEventListener("click", (event) => { event.stopPropagation(); closeAllMenus(menu); menu.classList.toggle("hidden"); });
  card.querySelector('[data-action="edit"]').addEventListener("click", () => loadIntoForm(item));
  card.querySelector('[data-action="open"]').addEventListener("click", () => window.open(activityUrl(item.id), "_blank", "noopener"));
  card.querySelector('[data-action="link"]').addEventListener("click", () => copyText(activityUrl(item.id), "Enlace público copiado."));
  card.querySelector('[data-action="embed"]').addEventListener("click", () => copyText(embedCode(item.id, item.title), "Código de inserción universal copiado."));
  card.querySelector('[data-action="move"]').addEventListener("click", () => openMoveModal(item));
  card.querySelector('[data-action="newfoldermove"]').addEventListener("click", () => createFolderAndMoveFromPrompt(item));
  card.querySelector('[data-action="duplicate"]').addEventListener("click", () => duplicateActivity(item));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => removeActivity(item.id, item.title));
  card.querySelector("[data-quick-open]").addEventListener("click", () => window.open(activityUrl(item.id), "_blank", "noopener"));
  card.querySelector("[data-quick-link]").addEventListener("click", () => copyText(activityUrl(item.id), "Enlace público copiado."));

  if (canReorder) {
    card.addEventListener("dragstart", (event) => {
      draggedActivityId = item.id;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });
    card.addEventListener("dragend", () => { draggedActivityId = null; card.classList.remove("dragging"); document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over")); });
    card.addEventListener("dragover", (event) => { event.preventDefault(); if (draggedActivityId && draggedActivityId !== item.id) card.classList.add("drag-over"); });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      if (!draggedActivityId || draggedActivityId === item.id) return;
      await reorderActivities(draggedActivityId, item.id);
    });
  }
  return card;
}

function closeAllMenus(except = null) {
  document.querySelectorAll(".popover-menu").forEach((menu) => { if (menu !== except) menu.classList.add("hidden"); });
}

async function reorderActivities(sourceId, targetId) {
  const ids = visibleActivities().map((item) => item.id);
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  setReport("warn", "Guardando el nuevo orden…");
  try {
    await Promise.all(ids.map((id, index) => setDoc(doc(db, "activities", id), { order: (index + 1) * 1000 }, { merge: true })));
    ids.forEach((id, index) => { const item = activities.find((x) => x.id === id); if (item) item.order = (index + 1) * 1000; });
    renderActivities();
    setReport("ok", "Orden guardado.");
  } catch (error) {
    setReport("error", `No se pudo guardar el orden: ${error.message}`);
  }
}

async function saveFolders() {
  await setDoc(doc(db, "activities", FOLDER_DOC_ID), { type: "system", published: false, folders, ownerEmail: currentUser?.email || "", updatedAt: serverTimestamp() }, { merge: true });
}

async function createFolder(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const id = `folder-${slugify(clean) || "carpeta"}-${Date.now().toString(36)}`;
  const order = folders.reduce((max, f) => Math.max(max, Number(f.order) || 0), 0) + 1000;
  folders.push({ id, name: clean, order });
  await saveFolders();
  renderFolders();
  return id;
}

async function promptNewFolder() {
  if (!isAdmin(currentUser)) return;
  const name = window.prompt("Nombre de la nueva carpeta:");
  if (!name?.trim()) return;
  try {
    const id = await createFolder(name);
    selectedFolderId = id || selectedFolderId;
    renderLibrary();
    setReport("ok", `Carpeta “${name.trim()}” creada.`);
  } catch (error) {
    setReport("error", `No se pudo crear la carpeta: ${error.message}`);
  }
}

async function renameFolder(id) {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  const name = window.prompt("Nuevo nombre de la carpeta:", folder.name);
  if (!name?.trim()) return;
  try {
    folder.name = name.trim();
    await saveFolders();
    renderLibrary();
    setReport("ok", "Carpeta renombrada.");
  } catch (error) {
    setReport("error", `No se pudo renombrar: ${error.message}`);
  }
}

async function deleteFolder(id) {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  const inside = activities.filter((item) => item.folderId === id);
  const message = inside.length ? `La carpeta “${folder.name}” contiene ${inside.length} actividades. Se moverán a “Sin carpeta”. ¿Continuar?` : `¿Eliminar la carpeta “${folder.name}”?`;
  if (!window.confirm(message)) return;
  try {
    if (inside.length) {
      await Promise.all(inside.map((item, index) => setDoc(doc(db, "activities", item.id), { folderId: "", order: nextOrderForFolder("") + index * 1000 }, { merge: true })));
      inside.forEach((item) => { item.folderId = ""; });
    }
    folders = folders.filter((f) => f.id !== id);
    await saveFolders();
    if (selectedFolderId === id) selectedFolderId = UNFILED_FOLDER;
    renderLibrary();
    setReport("ok", "Carpeta eliminada. Las actividades se conservaron.");
  } catch (error) {
    setReport("error", `No se pudo eliminar la carpeta: ${error.message}`);
  }
}

function openMoveModal(item) {
  pendingMoveActivity = item;
  ui.moveActivityName.textContent = item.title || item.id;
  ui.moveFolderSelect.innerHTML = `<option value="">Sin carpeta</option>` + folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`).join("");
  ui.moveFolderSelect.value = item.folderId || "";
  ui.moveNewFolderName.value = "";
  ui.moveModal.classList.add("open");
  ui.moveModal.setAttribute("aria-hidden", "false");
}

function closeMoveModal() {
  pendingMoveActivity = null;
  ui.moveModal.classList.remove("open");
  ui.moveModal.setAttribute("aria-hidden", "true");
}

async function moveActivity(item, folderId) {
  const normalized = normalizeFolderId(folderId);
  try {
    const order = nextOrderForFolder(normalized);
    await setDoc(doc(db, "activities", item.id), { folderId: normalized, order }, { merge: true });
    item.folderId = normalized;
    item.order = order;
    closeMoveModal();
    renderLibrary();
    setReport("ok", `Actividad movida a “${folderName(normalized || UNFILED_FOLDER)}”.`);
  } catch (error) {
    setReport("error", `No se pudo mover la actividad: ${error.message}`);
  }
}

async function createFolderAndMoveFromPrompt(item) {
  const name = window.prompt("Nombre de la nueva carpeta:");
  if (!name?.trim()) return;
  try {
    const id = await createFolder(name);
    if (id) await moveActivity(item, id);
  } catch (error) {
    setReport("error", `No se pudo crear la carpeta: ${error.message}`);
  }
}

async function duplicateActivity(item) {
  if (!isAdmin(currentUser)) return;
  if (!isRealtimeConfigured() || !rtdb) return setReport("error", "Configura Realtime Database antes de duplicar actividades.");
  let base = slugify(`${item.id}-copia`) || `${item.id}-copia`;
  let id = base;
  let n = 2;
  while (activities.some((x) => x.id === id)) id = `${base}-${n++}`;
  try {
    setReport("warn", "Preparando la copia…");
    const html = await htmlForItem(item);
    const stored = await writeHtmlToRealtime(id, html, false);
    const payload = {
      title: `${item.title || item.id} (copia)`, course: item.course || "", subject: item.subject || "", description: item.description || "",
      published: false, ownerEmail: currentUser.email, folderId: item.folderId || "", storageType: "realtime-chunks",
      htmlSize: stored.size, chunkCount: stored.chunkCount,
      order: nextOrderForFolder(item.folderId || ""), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "activities", id), payload);
    setReport("ok", `Copia creada como borrador: ${id}`);
    await loadActivities();
  } catch (error) {
    setReport("error", `No se pudo duplicar: ${error.message}`);
  }
}

async function loadIntoForm(item) {
  currentDocId = item.id;
  slugTouched = true;
  ui.title.value = item.title || "";
  ui.course.value = item.course || "";
  ui.subject.value = item.subject || "Lenguaje";
  ui.slug.value = item.id;
  ui.description.value = item.description || "";
  ui.published.checked = Boolean(item.published);
  ui.code.value = "";
  ui.currentId.textContent = `Cargando: ${item.id}`;
  updateSize();
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    setReport("warn", "Cargando el HTML completo…");
    ui.code.value = await htmlForItem(item);
    ui.currentId.textContent = `Editando: ${item.id}`;
    updateSize();
    validateNow();
  } catch (error) {
    setReport("error", `No se pudo cargar el HTML: ${error.message}`);
  }
}

async function saveActivity() {
  if (!isAdmin(currentUser)) return setReport("error", "No tienes autorización para guardar actividades.");
  if (!isRealtimeConfigured() || !rtdb) return setReport("error", "Falta configurar Realtime Database. El HTML grande no puede publicarse todavía.");
  const result = validateNow();
  if (!result.valid) return;

  const title = ui.title.value.trim();
  const id = slugify(ui.slug.value || title);
  if (!title) return setReport("error", "Debes escribir el título de la actividad.");
  if (!id) return setReport("error", "No se pudo generar un identificador válido para el enlace.");
  if (id === FOLDER_DOC_ID) return setReport("error", "Ese identificador está reservado por PowerView.");
  if (currentDocId && currentDocId !== id) return setReport("error", "Para cambiar el identificador de una actividad existente, duplícala como una actividad nueva.");

  ui.save.disabled = true;
  try {
    const ref = doc(db, "activities", id);
    const previous = await getDoc(ref);
    if (previous.exists() && !currentDocId) return setReport("error", `Ya existe una actividad con el identificador “${id}”. Abre esa actividad para editarla o usa otro identificador.`);
    const prevData = previous.exists() ? previous.data() : null;
    const defaultFolder = selectedFolderId !== ALL_FOLDER && selectedFolderId !== UNFILED_FOLDER ? selectedFolderId : "";
    const folderId = prevData?.folderId ?? defaultFolder;

    const stored = await writeHtmlToRealtime(id, ui.code.value, ui.published.checked);
    setReport("warn", "HTML subido. Guardando datos de la actividad…");
    const payload = {
      title,
      course: ui.course.value.trim(),
      subject: ui.subject.value.trim(),
      description: ui.description.value.trim(),
      published: ui.published.checked,
      ownerEmail: currentUser.email,
      folderId,
      order: Number(prevData?.order) || nextOrderForFolder(folderId),
      storageType: "realtime-chunks",
      htmlSize: stored.size,
      chunkCount: stored.chunkCount,
      createdAt: prevData?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    // Sobrescribe el documento para retirar el antiguo campo html de Firestore.
    await setDoc(ref, payload);
    currentDocId = id;
    ui.currentId.textContent = `Guardada: ${id}`;
    setReport("ok", `✅ Actividad guardada correctamente (${formatBytes(stored.size)} en ${stored.chunkCount} bloques).\nEnlace: ${activityUrl(id)}`);
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
  if (!window.confirm(`¿Eliminar definitivamente “${title || id}”?`)) return;
  try {
    await deleteDoc(doc(db, "activities", id));
    await deleteHtmlFromRealtime(id);
    activities = activities.filter((item) => item.id !== id);
    if (currentDocId === id) clearForm();
    setReport("ok", "Actividad eliminada.");
    renderLibrary();
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
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

ui.title.addEventListener("input", () => { if (!slugTouched) ui.slug.value = slugify(ui.title.value); });
ui.slug.addEventListener("input", () => { slugTouched = true; ui.slug.value = slugify(ui.slug.value); });
ui.code.addEventListener("input", updateSize);
ui.validate.addEventListener("click", validateNow);
ui.preview.addEventListener("click", () => openPreview(ui.code.value));
ui.run.addEventListener("click", () => runHtmlStandalone(ui.code.value));
ui.save.addEventListener("click", saveActivity);
ui.fresh.addEventListener("click", clearForm);
ui.refresh.addEventListener("click", loadActivities);
ui.importHtml.addEventListener("click", () => ui.fileInput.click());
ui.fileInput.addEventListener("change", () => importHtmlFile(ui.fileInput.files?.[0]));
ui.search.addEventListener("input", renderActivities);
ui.newFolder.addEventListener("click", promptNewFolder);
ui.copyLink.addEventListener("click", () => currentDocId && copyText(activityUrl(currentDocId), "Enlace público copiado."));
ui.copyEmbed.addEventListener("click", () => currentDocId && copyText(embedCode(currentDocId, ui.title.value), "Código de inserción universal copiado."));
ui.closePreview.addEventListener("click", closePreview);
ui.modal.addEventListener("click", (event) => { if (event.target === ui.modal) closePreview(); });
ui.cancelMove.addEventListener("click", closeMoveModal);
ui.moveModal.addEventListener("click", (event) => { if (event.target === ui.moveModal) closeMoveModal(); });
ui.confirmMove.addEventListener("click", () => pendingMoveActivity && moveActivity(pendingMoveActivity, ui.moveFolderSelect.value));
ui.createAndMove.addEventListener("click", async () => {
  if (!pendingMoveActivity) return;
  const name = ui.moveNewFolderName.value.trim();
  if (!name) return setReport("error", "Escribe el nombre de la nueva carpeta.");
  try { const id = await createFolder(name); if (id) await moveActivity(pendingMoveActivity, id); }
  catch (error) { setReport("error", `No se pudo crear la carpeta: ${error.message}`); }
});
document.addEventListener("click", () => closeAllMenus());

if (!isFirebaseConfigured()) {
  ui.configWarning.classList.remove("hidden");
  ui.configWarning.textContent = "CONFIGURACIÓN PENDIENTE: abre js/firebase-config.js y reemplaza los datos REEMPLAZAR por la configuración de tu proyecto Firebase.";
  ui.login.disabled = true;
  ui.connection.textContent = "Firebase todavía no está configurado";
}
if (isFirebaseConfigured() && !isRealtimeConfigured()) {
  ui.configWarning.classList.remove("hidden");
  ui.configWarning.textContent += `${ui.configWarning.textContent ? "\n" : ""}POWERVIEW V4: crea Realtime Database en Firebase y pega su URL exacta en REALTIME_DATABASE_URL dentro de js/firebase-config.js. Las actividades antiguas siguen visibles, pero no podrás publicar HTML nuevos hasta completar este paso.`;
}
if (ADMIN_EMAIL === "TU_CORREO@gmail.com") {
  ui.configWarning.classList.remove("hidden");
  ui.configWarning.textContent += `${ui.configWarning.textContent ? "\n" : ""}También debes sustituir TU_CORREO@gmail.com por tu correo de Google.`;
}

ui.login.addEventListener("click", async () => {
  if (!auth) return;
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) { setReport("error", `No se pudo iniciar sesión: ${error.message}`); }
});
ui.logout.addEventListener("click", () => auth && signOut(auth));

if (auth) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      ui.authUser.textContent = "No has iniciado sesión.";
      ui.login.classList.remove("hidden"); ui.logout.classList.add("hidden");
      ui.connection.textContent = "Panel privado del Prof. Rodrigo";
      refreshPermissions(); await loadActivities(); return;
    }
    ui.login.classList.add("hidden"); ui.logout.classList.remove("hidden");
    ui.authUser.textContent = `${user.displayName || "Usuario"}\n${user.email}`;
    if (isAdmin(user)) {
      ui.connection.textContent = "Conectado a la biblioteca de actividades";
      setReport("ok", "Sesión de administrador iniciada. Importa un HTML, pega una actividad o selecciona una de la biblioteca.");
      await loadActivities();
    } else {
      ui.connection.textContent = "Cuenta sin autorización";
      setReport("error", `Esta cuenta no coincide con ADMIN_EMAIL.\nCuenta actual: ${user.email}\nCorreo autorizado: ${ADMIN_EMAIL}`);
    }
    refreshPermissions();
  });
}

updateSize();
refreshPermissions();
