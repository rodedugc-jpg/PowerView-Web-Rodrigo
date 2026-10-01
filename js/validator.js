const OMIT_MARKERS = [
  "... existing code ...",
  "existing code",
  "rest of code",
  "same as above",
  "resto del código",
  "contenido omitido",
  "código anterior",
  "se omite por brevedad",
  "inserta aquí el código original"
];

export function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function validateActivityHtml(html) {
  const errors = [];
  const warnings = [];
  const info = [];

  const text = html || "";
  const lower = text.toLowerCase();
  const bytes = byteLength(text);

  if (!text.trim()) errors.push("No se proporcionó ningún código HTML.");

  if (!/^\s*<!doctype html>/i.test(text)) {
    warnings.push("No comienza con <!DOCTYPE html>. PowerView permite publicarlo, pero conviene conservar un documento HTML completo.");
  }

  for (const tag of ["html", "head", "body"]) {
    if (!new RegExp(`<${tag}\\b`, "i").test(text)) warnings.push(`No se encontró <${tag}>.`);
    if (!new RegExp(`</${tag}>`, "i").test(text)) warnings.push(`No se encontró </${tag}>.`);
  }

  for (const marker of OMIT_MARKERS) {
    if (lower.includes(marker.toLowerCase())) {
      errors.push(`Marcador de omisión detectado: “${marker}”. Parece que el HTML está incompleto.`);
    }
  }

  if (/\\`/.test(text)) warnings.push("Se encontró \\` en el código. Revisa que no haya acentos graves escapados por accidente.");
  if (/\\\$\{/.test(text)) warnings.push("Se encontró \\${ en el código. Revisa que no haya interpolaciones JavaScript dañadas.");

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const ids = new Map();
  doc.querySelectorAll("[id]").forEach((element) => {
    ids.set(element.id, (ids.get(element.id) || 0) + 1);
  });
  [...ids.entries()].filter(([, count]) => count > 1).forEach(([id, count]) => {
    warnings.push(`ID duplicado: #${id} aparece ${count} veces.`);
  });

  const signatureCount = (text.match(/Actividad elaborada por el Prof\. Rodrigo/g) || []).length;
  if (signatureCount === 0) {
    warnings.push("No se encontró la firma «Actividad elaborada por el Prof. Rodrigo». Esto NO impide publicar.");
  } else if (signatureCount > 1) {
    warnings.push(`La firma aparece ${signatureCount} veces. Esto NO impide publicar.`);
  }

  // En v4 el tamaño ya no se bloquea por Firestore. El HTML se divide en bloques
  // y se guarda en Realtime Database, mientras Firestore conserva solo metadatos.
  if (bytes >= 1_000_000) {
    info.push(`Archivo grande detectado: ${formatBytes(bytes)}. PowerView v4 lo guardará por bloques en Realtime Database.`);
  }
  if (bytes >= 50_000_000) {
    warnings.push("El archivo supera 50 MB. Puede funcionar, pero tardará más en subir y consumir más transferencia al abrirse.");
  }

  info.push(`Tamaño del código: ${formatBytes(bytes)}.`);
  info.push(`IDs encontrados: ${ids.size}.`);
  info.push("El tamaño del HTML ya no está limitado a 900 KB por Firestore.");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
    bytes
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}
