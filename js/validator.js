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

const MAX_SAFE_BYTES = 900_000;

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
  if (!/^\s*<!doctype html>/i.test(text)) errors.push("El documento debe comenzar con <!DOCTYPE html>.");

  for (const tag of ["html", "head", "body"]) {
    if (!new RegExp(`<${tag}\\b`, "i").test(text)) errors.push(`Falta la etiqueta <${tag}>.`);
    if (!new RegExp(`</${tag}>`, "i").test(text)) errors.push(`Falta la etiqueta </${tag}>.`);
  }

  if (!/<script\b/i.test(text) || !/<\/script>/i.test(text)) {
    warnings.push("No se encontró un bloque <script> completo. Puede ser válido si la actividad no usa JavaScript.");
  }

  if (/\\`/.test(text)) errors.push("Se encontró \\` y eso indica acentos graves dañados.");
  if (/\\\$\{/.test(text)) errors.push("Se encontró \\${ y eso indica interpolaciones JavaScript dañadas.");

  for (const marker of OMIT_MARKERS) {
    if (lower.includes(marker.toLowerCase())) {
      errors.push(`Marcador de omisión prohibido: “${marker}”.`);
    }
  }

  if (/<iframe\b/i.test(text) || /\bsrcdoc\s*=/i.test(text)) {
    warnings.push("El código ya contiene un iframe o srcdoc. Este visor está pensado para recibir el HTML normal de la etapa 3.");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");

  const ids = new Map();
  doc.querySelectorAll("[id]").forEach((element) => {
    const id = element.id;
    ids.set(id, (ids.get(id) || 0) + 1);
  });
  const duplicates = [...ids.entries()].filter(([, count]) => count > 1);
  duplicates.forEach(([id, count]) => errors.push(`ID duplicado: #${id} aparece ${count} veces.`));

  const inlineHandlers = [...doc.querySelectorAll("[onclick]")]
    .map((el) => el.getAttribute("onclick") || "")
    .filter(Boolean);
  const functionCalls = new Set();
  inlineHandlers.forEach((handler) => {
    const matches = handler.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g);
    for (const match of matches) functionCalls.add(match[1]);
  });

  const scriptText = [...doc.scripts]
    .filter((script) => !script.src)
    .map((script) => script.textContent || "")
    .join("\n");

  for (const call of functionCalls) {
    const last = call.split(".").pop();
    const patterns = [
      new RegExp(`function\\s+${escapeRegex(last)}\\s*\\(`),
      new RegExp(`${escapeRegex(last)}\\s*\\([^)]*\\)\\s*\\{`),
      new RegExp(`(?:const|let|var)\\s+${escapeRegex(last)}\\s*=\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>)`)
    ];
    if (!patterns.some((pattern) => pattern.test(scriptText))) {
      warnings.push(`No se pudo confirmar automáticamente la función usada en onclick: ${call}().`);
    }
  }

  if (scriptText && !/<script[^>]*type=["']module["']/i.test(text)) {
    try {
      // Comprueba sintaxis sin ejecutar el código.
      new Function(scriptText);
      info.push("La sintaxis del JavaScript integrado supera la comprobación básica.");
    } catch (error) {
      errors.push(`Error de sintaxis JavaScript: ${error.message}`);
    }
  } else if (/<script[^>]*type=["']module["']/i.test(text)) {
    warnings.push("La actividad contiene scripts de tipo module; la validación de sintaxis completa no se ejecutó.");
  }

  const qIds = [...text.matchAll(/\bqId\s*:\s*(["']?)([^,"'\s}\]]+)\1/g)].map((m) => m[2]);
  const qIdCounts = new Map();
  qIds.forEach((id) => qIdCounts.set(id, (qIdCounts.get(id) || 0) + 1));
  [...qIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .forEach(([id, count]) => errors.push(`qId duplicado: ${id} aparece ${count} veces.`));

  const signatureCount = (text.match(/Actividad elaborada por el Prof\. Rodrigo/g) || []).length;
  if (signatureCount > 1) errors.push(`La firma aparece ${signatureCount} veces; debe aparecer una sola vez.`);
  if (signatureCount === 1) {
    const menuStart = text.search(/id=["']screen-menu["']/i);
    const signatureAt = text.indexOf("Actividad elaborada por el Prof. Rodrigo");
    if (menuStart === -1 || signatureAt < menuStart) {
      warnings.push("No se pudo confirmar que la firma esté dentro de screen-menu.");
    }
  }

  if (bytes > MAX_SAFE_BYTES) {
    errors.push(
      `El HTML pesa ${formatBytes(bytes)}. Esta versión usa Firestore y admite hasta 900 KB por seguridad.`
    );
  } else if (bytes > 700_000) {
    warnings.push(`El HTML pesa ${formatBytes(bytes)} y está cerca del límite recomendado de Firestore.`);
  }

  info.push(`Tamaño del código: ${formatBytes(bytes)}.`);
  info.push(`IDs encontrados: ${ids.size}.`);
  if (qIds.length) info.push(`Reactivos qId detectados: ${qIds.length}.`);

  return { valid: errors.length === 0, errors, warnings, info, bytes };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
