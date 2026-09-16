// MLF - Bookmarklet "Pegar Fotos" (correr parado en la herramienta interna,
// con la sección de fotos de la variante ya visible en pantalla). Lee las
// URLs copiadas con "MLF Copiar Fotos", descarga cada imagen y las carga
// TODAS de una en el campo de fotos — un solo click, sin ir pegando de a
// una.
//
// Por qué no se copia la imagen en sí (binario) al portapapeles del lado de
// ML: se probó (navigator.clipboard.write con un blob de imagen) y
// clipboard.write() queda colgado sin resolver nunca en
// www.mercadolibre.com.ar — anda bien en vendedores.mercadolibre.com.ar,
// pero no del lado de la publicación. Por eso el puente es la URL de la
// foto (texto), y la descarga/conversión a File pasa acá, del lado de la
// herramienta interna, donde clipboard.write() no hace falta para nada:
// alcanza con fetch + asignar los File directo al <input type="file"> (ver
// más abajo), sin pasar por el portapapeles del sistema en ningún momento.

(async function () {
  "use strict";

  async function getPayloadText() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch (_) {
      /* el navegador bloqueó la lectura del portapapeles por script */
    }
    return window.prompt("Pegá acá el texto copiado con el bookmarklet 'MLF Copiar Fotos' (Ctrl+V):", "");
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * El <input type="file"> del uploader de fotos no tiene un id/nombre
   * estable entre categorías — se identifica por type=file + estar
   * visible. Si hay más de una variante con su sección de fotos abierta a
   * la vez, se usa la primera visible: por eso el flujo pide tener SOLO la
   * sección de la variante que corresponde abierta antes de correr esto.
   */
  function findPhotoInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((el) => isVisible(el) && !el.disabled) || null;
  }

  async function urlToFile(url, index) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const blob = await resp.blob();
    const ext = (blob.type && blob.type.split("/")[1]) || "webp";
    return new File([blob], `foto-${index + 1}.${ext}`, { type: blob.type || "image/webp" });
  }

  function showSummary(text, detail) {
    document.getElementById("mlf-bk-toast")?.remove();
    const box = document.createElement("div");
    box.id = "mlf-bk-toast";
    box.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "max-width:340px",
      "background:#1f2328", "color:#fff", "border-radius:8px", "padding:10px 12px",
      "z-index:2147483647", "font:500 12px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "box-shadow:0 2px 10px rgba(0,0,0,.3)",
    ].join(";");
    box.textContent = text;
    if (detail) {
      const d = document.createElement("div");
      d.style.cssText = "margin-top:4px;color:#cbd3dc;font-weight:400";
      d.textContent = detail;
      box.appendChild(d);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 7000);
  }

  const raw = await getPayloadText();
  if (!raw) {
    showSummary("Cancelado: no hay datos para pegar.");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    showSummary("El texto pegado no es válido (¿copiaste bien con 'MLF Copiar Fotos'?).");
    return;
  }

  const urls = payload && payload.images;
  if (!urls || !urls.length) {
    showSummary("No hay fotos en los datos pegados.");
    return;
  }

  const input = findPhotoInput();
  if (!input) {
    showSummary("No encontré un campo de fotos visible.", "Abrí la sección de fotos de la variante y volvé a correr esto.");
    return;
  }

  showSummary(`Descargando ${urls.length} foto(s)...`);

  const results = await Promise.allSettled(urls.map((url, i) => urlToFile(url, i)));
  const files = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") files.push(r.value);
    else failed.push(i + 1);
  });

  if (!files.length) {
    showSummary("No se pudo descargar ninguna foto.", failed.length ? `Fallaron: ${failed.join(", ")}` : "");
    return;
  }

  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  showSummary(
    `${files.length} foto(s) pegada(s).`,
    failed.length ? `${failed.length} fallaron (foto ${failed.join(", ")}) — probá copiarlas de nuevo.` : ""
  );
})();
