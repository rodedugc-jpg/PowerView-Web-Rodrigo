import {
  db,
  isFirebaseConfigured,
  collection,
  getDocs,
  query,
  where
} from "./firebase-client.js";

const grid = document.getElementById("library-grid");
const status = document.getElementById("library-status");
const search = document.getElementById("search");
const courseFilter = document.getElementById("course-filter");
const subjectFilter = document.getElementById("subject-filter");
let activities = [];

function activityUrl(id) {
  const url = new URL("./visor.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function render() {
  const needle = search.value.trim().toLowerCase();
  const course = courseFilter.value;
  const subject = subjectFilter.value;
  const filtered = activities.filter((item) => {
    const haystack = `${item.title || ""} ${item.description || ""} ${item.course || ""} ${item.subject || ""}`.toLowerCase();
    return (!needle || haystack.includes(needle)) && (!course || item.course === course) && (!subject || item.subject === subject);
  });

  grid.innerHTML = "";
  if (!filtered.length) {
    status.className = "status warn";
    status.textContent = "No se encontraron actividades con esos filtros.";
    status.classList.remove("hidden");
    return;
  }
  status.classList.add("hidden");
  filtered.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass public-card";
    card.innerHTML = `
      <h2>${escapeHtml(item.title || item.id)}</h2>
      <div class="public-meta">
        <span class="pill">${escapeHtml(item.course || "Curso no indicado")}</span>
        <span class="pill">${escapeHtml(item.subject || "Materia no indicada")}</span>
      </div>
      <p>${escapeHtml(item.description || "Actividad educativa interactiva.")}</p>
      <a class="btn primary" href="${activityUrl(item.id)}">Abrir actividad</a>`;
    grid.appendChild(card);
  });
}

function setOptions(select, values, firstLabel) {
  select.innerHTML = `<option value="">${firstLabel}</option>`;
  values.filter(Boolean).sort((a, b) => a.localeCompare(b, "es")).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

async function load() {
  if (!isFirebaseConfigured() || !db) {
    status.className = "status error";
    status.textContent = "La biblioteca todavía no está conectada a Firebase.";
    return;
  }
  try {
    const snapshot = await getDocs(query(collection(db, "activities"), where("published", "==", true)));
    activities = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    activities.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "es"));
    setOptions(courseFilter, [...new Set(activities.map((item) => item.course))], "Todos los cursos");
    setOptions(subjectFilter, [...new Set(activities.map((item) => item.subject))], "Todas las materias");
    render();
  } catch (error) {
    status.className = "status error";
    status.textContent = `No se pudo cargar la biblioteca: ${error.message}`;
  }
}

[search, courseFilter, subjectFilter].forEach((element) => element.addEventListener("input", render));
load();
