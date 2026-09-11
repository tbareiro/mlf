// MLF - Bookmarklet "Copiar" (correr parado en una página de producto de ML).
//
// Cero instalación: es un bookmark común, no una extensión. Solo lectura del
// DOM (tabla de "Características" visible) — no llama a la API de ML, no
// manda nada a ningún servidor. El puente hacia la otra página es el
// portapapeles del sistema operativo.
//
// (La extracción por JSON embebido se probó contra una publicación real y
// nunca encontró nada — las páginas de producto de ML no traen ese bloque
// en el HTML inicial. Por eso acá se va directo a la tabla visible, que sí
// funciona de forma confiable.)

(function () {
  "use strict";

  const OVERLAY_ID = "mlf-bk-overlay";
  document.getElementById(OVERLAY_ID)?.remove();

  function extractFromSpecsTable() {
    const rows = document.querySelectorAll("table tr, .andes-table__row, [class*='specs'] tr");
    const out = [];
    const seen = new Set();
    rows.forEach((row) => {
      const th = row.querySelector("th");
      const td = row.querySelector("td");
      const label = (th?.textContent || "").trim();
      const value = (td?.textContent || "").trim();
      if (!label || !value) return;
      const key = label.toLowerCase() + "|" + value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label, value });
    });
    return out;
  }

  /**
   * Bullets "Lo que tienes/debes saber de este producto" — aparecen en vez
   * de (o además de) la tabla en algunas publicaciones (ej. productos "no
   * disponibles" en este momento). Cada <li> viene como "Label: value".
   */
  function extractFromHighlightedFeatures() {
    const items = document.querySelectorAll(
      ".ui-vpp-highlighted-specs__features-list-item, [class*='highlighted-specs__features-list-item']"
    );
    const out = [];
    items.forEach((li) => {
      const text = (li.textContent || "").trim();
      const sep = text.indexOf(":");
      if (sep === -1) return;
      const label = text.slice(0, sep).trim();
      // Los bullets son oraciones ("ISBN: 123....") y suelen cerrar con un
      // punto final que no es parte del valor real — se saca.
      const value = text.slice(sep + 1).trim().replace(/\.+$/, "").trim();
      if (!label || !value) return;
      out.push({ label, value });
    });
    return out;
  }

  /**
   * Selector de variación arriba de la publicación (ej. "Color: Blanco"),
   * separado de la tabla de specs y de los bullets. ML marca el valor
   * elegido con una clase que contiene "variations__title__value" (BEM,
   * doble guion bajo — verificado en vivo contra una publicación real;
   * "variationstitlevalue" sin separadores, que se probó antes, NUNCA
   * matcheó nada y dejaba esta extracción muerta en producción). Se dejan
   * los dos patrones por las dudas de que varíen entre categorías/locales.
   * El sufijo de color en la clase, ej. "--BLACK", es decorativo y no hace
   * falta parsearlo. El label ("Color") no tiene su propio elemento — es
   * el texto del párrafo contenedor menos el valor, así que se restan
   * directamente en vez de adivinar una clase para el label.
   */
  function extractFromVariationSelector() {
    const out = [];
    const seen = new Set();
    const valueEls = document.querySelectorAll(
      "[class*='variationstitlevalue'], [class*='variations__title__value']"
    );
    valueEls.forEach((valueEl) => {
      const value = (valueEl.textContent || "").trim();
      const parent = valueEl.parentElement;
      if (!value || !parent) return;
      const fullText = (parent.textContent || "").trim();
      const label = fullText.slice(0, fullText.length - value.length).replace(/:\s*$/, "").trim();
      if (!label) return;
      const key = label.toLowerCase() + "|" + value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label, value });
    });
    return out;
  }

  /**
   * Detecta si la publicación tiene más de un color/variante disponible
   * (los "swatches" de arriba, ej. Negro/Gris). Solo avisa — NO los
   * recorre ni los clickea: cambiar de swatch en ML cambia de oferta
   * completa (precio, stock, a veces vendedor), no es un cambio cosmético,
   * así que copiar todas de una queda para una vuelta futura si hace
   * falta. Por ahora, si hay más de una, se muestra un aviso para que
   * sepas que hay que cambiar el color a mano arriba y correr "Copiar" de
   * nuevo por cada variante.
   */
  function detectVariantSiblings() {
    const items = document.querySelectorAll("[class*='variations__thumbnails__item']");
    const out = [];
    items.forEach((el) => {
      const img = el.querySelector("img[alt]");
      const label = (img?.getAttribute("alt") || "").trim();
      if (!label) return;
      out.push({ label, selected: /--SELECTED/.test(el.className) });
    });
    return out;
  }

  /** Título y descripción de la publicación (no están en la tabla de specs). */
  function extractTitleAndDescription() {
    const out = [];

    const titleEl = document.querySelector("h1.ui-pdp-title, h1[class*='title'], h1");
    const title = (titleEl?.textContent || "").trim();
    if (title) out.push({ label: "Título", value: title });

    const descEl = document.querySelector(
      ".ui-pdp-description__content, [class*='description__content'], .ui-pdp-description p"
    );
    const description = (descEl?.textContent || "").trim();
    if (description) out.push({ label: "Descripción", value: description });

    return out;
  }

  /**
   * ML a veces junta varias dimensiones en un solo renglón, tanto en el
   * label como en el valor, separados por " x " en el mismo orden (ej.
   * label "Ancho x Profundidad x Altura", valor "31 cm x 4 cm x 6.5 cm").
   * La herramienta interna casi siempre tiene un campo por dimensión, así
   * que conviene partirlo en attrs separados en vez de pegar el combo
   * entero en el primer campo que matchee por casualidad (ver bug: eso
   * terminaba escribiendo el string completo en un input numérico).
   * Solo se activa si el label Y el valor parten en la MISMA cantidad de
   * pedazos — si no coinciden, se deja como venía (más seguro que adivinar).
   */
  function splitCombinedDimensions(attr) {
    if (!/\sx\s/i.test(attr.label) || !/\sx\s/i.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  // ¿Este valor es lo bastante "distintivo" como para usarlo de pista de
  // duplicado? Cadenas cortas/genéricas (Sí, No, N/A, 0, 1...) NO cuentan —
  // dos atributos reales y distintos (ej. "Con índice" y "Con garantía")
  // pueden compartir perfectamente el mismo "No", y ahí deduplicar por
  // valor sería incorrecto. Números de 2+ dígitos y textos de 4+
  // caracteres sí alcanzan para asumir que es el mismo dato repetido con
  // otro label (ej. "Número de páginas" y "Cantidad de páginas" ambos "172").
  function isDistinctiveValue(value) {
    const v = value.trim();
    if (/^-?\d+([.,]\d+)?$/.test(v)) return v.replace(/[^0-9]/g, "").length >= 2;
    return v.length >= 4;
  }

  function dedupeByLabel(list) {
    const seenLabels = new Set();
    const seenValues = new Set();
    const out = [];
    for (const attr of list) {
      const labelKey = attr.label.trim().toLowerCase();
      const valueKey = attr.value.trim().toLowerCase();
      if (seenLabels.has(labelKey)) continue;
      if (isDistinctiveValue(attr.value) && seenValues.has(valueKey)) continue;
      seenLabels.add(labelKey);
      if (isDistinctiveValue(attr.value)) seenValues.add(valueKey);
      out.push(attr);
    }
    return out;
  }

  // Orden de prioridad si el mismo label aparece en más de un lado: título
  // y descripción primero, después la tabla (más confiable/completa que
  // los bullets), y los bullets solo rellenan lo que la tabla no traiga.
  const rawAttributes = [
    ...extractTitleAndDescription(),
    ...extractFromVariationSelector(),
    ...extractFromSpecsTable(),
    ...extractFromHighlightedFeatures(),
  ];
  const attributes = dedupeByLabel(rawAttributes.flatMap(splitCombinedDimensions));
  const variantSiblings = detectVariantSiblings();

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
  header.textContent = "MLF — Atributos (" + attributes.length + ")";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);

  // Si hay más de un color/variante disponible, avisar acá arriba — no se
  // recorren solos (ver detectVariantSiblings), así que conviene dejar
  // claro que hay que repetir "Copiar" por cada uno.
  let variantNotice = null;
  if (variantSiblings.length > 1) {
    variantNotice = document.createElement("div");
    variantNotice.style.cssText =
      "padding:8px 12px;background:#fff7e6;color:#8a5a00;font-size:12px;line-height:1.4;border-bottom:1px solid #f1e2bd";
    const current = variantSiblings.find((v) => v.selected);
    const names = variantSiblings.map((v) => v.label).join(", ");
    variantNotice.textContent =
      `Esta publicación tiene ${variantSiblings.length} variantes de color (${names}). ` +
      `Estás copiando: ${current ? current.label : "la seleccionada"}. Cambiá el color arriba y ` +
      `volvé a correr "Copiar" para cada una.`;
  }

  const list = document.createElement("div");
  list.style.cssText = "overflow-y:auto;padding:4px 8px;flex:1";

  if (!attributes.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:24px 8px;text-align:center;color:#9aa1ab";
    empty.textContent = "No se encontraron atributos en esta página.";
    list.appendChild(empty);
  }

  const checkboxes = [];
  attributes.forEach((attr, idx) => {
    const row = document.createElement("label");
    row.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #f1f2f4;cursor:pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.idx = String(idx);
    checkboxes.push(cb);

    const text = document.createElement("div");
    const labelEl = document.createElement("div");
    labelEl.style.cssText = "font-weight:600";
    labelEl.textContent = attr.label;
    const valueEl = document.createElement("div");
    valueEl.style.cssText =
      "color:#374151;word-break:break-word;max-height:4.5em;overflow-y:auto";
    valueEl.textContent = attr.value.length > 400 ? attr.value.slice(0, 400) + "…" : attr.value;
    text.appendChild(labelEl);
    text.appendChild(valueEl);

    row.appendChild(cb);
    row.appendChild(text);
    list.appendChild(row);
  });

  const footer = document.createElement("div");
  footer.style.cssText = "padding:8px 12px 12px;border-top:1px solid #e5e7eb";

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:#6b7280;min-height:16px;margin-bottom:6px";

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copiar seleccionados";
  copyBtn.disabled = !attributes.length;
  copyBtn.style.cssText =
    "width:100%;padding:8px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer";

  copyBtn.onclick = async () => {
    const selected = checkboxes.filter((cb) => cb.checked).map((cb) => attributes[Number(cb.dataset.idx)]);
    if (!selected.length) {
      status.textContent = "Seleccioná al menos un atributo.";
      return;
    }
    const payload = JSON.stringify({ v: 1, source: location.href, attributes: selected });
    try {
      await navigator.clipboard.writeText(payload);
      status.textContent = `Copiado (${selected.length}). Andá a la otra página y usá el bookmarklet "MLF Pegar".`;
    } catch (err) {
      // Fallback si el navegador bloquea el Clipboard API en este contexto.
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      status.textContent = ok
        ? `Copiado (${selected.length}). Andá a la otra página y usá "MLF Pegar".`
        : "No se pudo copiar. Probá seleccionar manualmente.";
    }
  };

  footer.appendChild(status);
  footer.appendChild(copyBtn);

  overlay.appendChild(header);
  if (variantNotice) overlay.appendChild(variantNotice);
  overlay.appendChild(list);
  overlay.appendChild(footer);
  document.body.appendChild(overlay);
})();
