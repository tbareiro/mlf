// MLF - Bookmarklet "Copiar Fotos" (correr parado en una página de producto
// de ML, o en el carrusel de imágenes de la herramienta interna). Junta las
// URLs de las fotos (la versión de mayor resolución de cada una, no la
// miniatura chica) y las copia como JSON al portapapeles. "Pegar Fotos" las
// descarga del lado de la herramienta interna y las carga todas de una — el
// puente es texto (URLs), nunca la imagen en sí, así que no depende de
// escribir binario al portapapeles del sistema desde esta página (ver nota
// en pegar.fotos.src.js sobre por qué eso se probó y falló acá).

(function () {
  "use strict";

  const OVERLAY_ID = "mlf-bk-fotos-overlay";
  document.getElementById(OVERLAY_ID)?.remove();

  /**
   * Las URLs de fotos de ML traen un código de tamaño antes de la
   * extensión (ej. "...-O.jpg"). "O" es una versión chica (bajo 500px de
   * lado) — "F" es la misma foto pero expandida. Se pide expandida
   * siempre que el link tenga ese sufijo; si no lo tiene (ya viene en otro
   * tamaño, ej. la "-F" que ya trae data-zoom en la galería de ML), se
   * deja tal cual.
   */
  function upscaleImageUrl(url) {
    return url.replace(/-O(\.[a-zA-Z0-9]+)$/, "-F$1");
  }

  /**
   * Carrusel de imágenes de la herramienta interna (img-carousel__main +
   * img-carousel__thumb-img): la imagen grande de arriba es SIEMPRE una
   * (la miniatura seleccionada, ya sea) de las de abajo — no una foto
   * distinta. Si se leyeran las dos listas, la seleccionada quedaría
   * copiada dos veces. Por eso esto lee SOLO las miniaturas (que, en este
   * carrusel, ya apuntan a la imagen en su resolución completa — no hace
   * falta buscar una versión más grande aparte).
   */
  function extractFromInternalCarousel() {
    const thumbs = document.querySelectorAll(".img-carousel__thumb-img");
    const out = [];
    const seen = new Set();
    thumbs.forEach((img) => {
      const url = img.src;
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({ url: upscaleImageUrl(url), thumb: url });
    });
    return out;
  }

  /**
   * Las miniaturas de la galería de ML (.ui-pdp-gallery__figure) apuntan a
   * una imagen chica por defecto — la versión grande vive en el atributo
   * data-zoom de un ancestro cercano. Se prueba esa primero y se cae a
   * img.src solo si no está.
   */
  function extractFromMLGallery() {
    const figs = document.querySelectorAll(".ui-pdp-gallery__figure, [class*='gallery__figure']");
    const out = [];
    const seen = new Set();
    figs.forEach((fig) => {
      const img = fig.querySelector("img");
      if (!img) return;
      const zoomEl = img.closest("[data-zoom]");
      const url = (zoomEl && zoomEl.getAttribute("data-zoom")) || img.getAttribute("data-zoom") || img.src;
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({ url: upscaleImageUrl(url), thumb: img.src || url });
    });
    return out;
  }

  /**
   * Si no hay miniaturas de ningún lado pero sí una imagen grande sola
   * (ej. el carrusel interno con una sola foto todavía, sin miniaturas
   * montadas), se usa esa — mejor una foto que ninguna.
   */
  function extractFallbackSingleImage() {
    const main = document.querySelector(".img-carousel__main");
    if (!main || !main.src) return [];
    return [{ url: upscaleImageUrl(main.src), thumb: main.src }];
  }

  function extractGalleryImages() {
    const fromCarousel = extractFromInternalCarousel();
    if (fromCarousel.length) return fromCarousel;
    const fromGallery = extractFromMLGallery();
    if (fromGallery.length) return fromGallery;
    return extractFallbackSingleImage();
  }

  const images = extractGalleryImages();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "width:340px", "max-height:80vh",
    "background:#fff", "color:#1f2328", "border-radius:10px",
    "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
    "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
    "display:flex", "flex-direction:column", "overflow:hidden",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600";
  header.textContent = "MLF — Fotos (" + images.length + ")";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);

  const list = document.createElement("div");
  list.style.cssText = "overflow-y:auto;padding:8px;flex:1;display:flex;flex-wrap:wrap;gap:8px";

  if (!images.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:24px 8px;text-align:center;color:#9aa1ab";
    empty.textContent = "No se encontraron fotos en esta página.";
    list.appendChild(empty);
  }

  const checkboxes = [];
  images.forEach((image, idx) => {
    const cell = document.createElement("label");
    cell.style.cssText =
      "position:relative;width:72px;height:72px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid transparent;display:block";

    const img = document.createElement("img");
    img.src = image.thumb;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
    cell.appendChild(img);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.idx = String(idx);
    cb.style.cssText = "position:absolute;top:3px;left:3px;cursor:pointer";
    checkboxes.push(cb);
    cell.appendChild(cb);

    list.appendChild(cell);
  });

  const footer = document.createElement("div");
  footer.style.cssText = "padding:8px 12px 12px;border-top:1px solid #e5e7eb";

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:#6b7280;min-height:16px;margin-bottom:6px";

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copiar fotos seleccionadas";
  copyBtn.disabled = !images.length;
  copyBtn.style.cssText =
    "width:100%;padding:8px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer";

  copyBtn.onclick = async () => {
    const selected = checkboxes.filter((cb) => cb.checked).map((cb) => images[Number(cb.dataset.idx)].url);
    if (!selected.length) {
      status.textContent = "Seleccioná al menos una foto.";
      return;
    }
    const payload = JSON.stringify({ v: 1, source: location.href, images: selected });
    try {
      await navigator.clipboard.writeText(payload);
      status.textContent = `Copiadas (${selected.length}). Andá a la herramienta interna y usá "MLF Pegar Fotos".`;
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      status.textContent = ok
        ? `Copiadas (${selected.length}). Andá a la herramienta interna y usá "MLF Pegar Fotos".`
        : "No se pudo copiar. Probá seleccionar manualmente.";
    }
  };

  footer.appendChild(status);
  footer.appendChild(copyBtn);

  overlay.appendChild(header);
  overlay.appendChild(list);
  overlay.appendChild(footer);
  document.body.appendChild(overlay);
})();
