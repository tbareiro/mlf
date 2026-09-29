// MLF - Bookmarklet "Copiar Variante" (correr parado en el comparador de
// fichas de ML — mismo comparador que usa "Copiar Comparator"). Junta SOLO
// lo que distingue a esta variante de sus hermanas — título, descripción,
// GTIN y los atributos "hijo" (los que varían entre variantes, ej. Color,
// Memoria) — para crear una variante nueva a partir de una publicación que
// ya tenés como comparador. Los atributos "padre" (compartidos entre todas
// las variantes, ej. Marca/Modelo) quedan afuera a propósito: esos ya se
// cargaron una vez al crear el producto base, no hace falta repetirlos acá.
//
// Reemplaza a la versión anterior de "Copiar Variantes" (que recorría los
// swatches de color/diseño en la publicación pública, clickeándolos uno
// por uno) — el comparador ya trae la distinción padre/hijo lista, sin
// necesidad de recorrer ni clickear nada.
//
// Las fotos NO viajan por acá — para eso está "Copiar Fotos" (funciona
// igual parado en el comparador, mismo botón que ya usás para
// publicaciones sueltas).
//
// El comparador tiene dos variantes de tabla (ver copiar.comparator.src.js
// para más detalle): una AGRUPADA (.comparator-result__attr-group, con
// título de grupo — ahí "hijo" es directo: el título del grupo dice
// "Identificadores Hijo"/"Identificadores de Producto") y una PLANA (tabla
// simple, sin título de grupo). En la plana no hay forma de saber qué es
// "hijo" por el título, así que se usa el estado de cada fila como proxy:
// una fila "mismatch" (difiere del producto de catálogo con el que se
// compara) o "solo en item" con valor (ej. GTIN, que no tiene con qué
// compararse del otro lado) cuenta como distintiva. Una fila "match"
// (idéntica en los dos lados) es compartida — exactamente lo que NO
// queremos acá.

(function () {
  "use strict";

  const OVERLAY_ID = "mlf-bk-overlay";
  document.getElementById(OVERLAY_ID)?.remove();

  const CHILD_GROUP_TITLES = ["Identificadores Hijo", "Identificadores de Producto"];

  // Ver misma lista en copiar.comparator.src.js — campos "de sistema" de
  // ML (logística, impuestos, flags internos de marketing) que no son
  // características reales del producto, universales sin importar la
  // categoría. Nunca por prefijo (IS_FACTORY_KIT sí es una característica
  // real, aunque empiece con "IS_" igual que IS_TOM_BRAND).
  const EXCLUDED_ATTR_IDS = [
    "FILTRABLE_CHARACTER",
    "GIFTABLE",
    "IMPORT_DUTY",
    "IS_HIGHLIGHT_BRAND",
    "IS_TOM_BRAND",
    "ITEM_CONDITION",
    "SELLER_PACKAGE_HEIGHT",
    "SELLER_PACKAGE_LENGTH",
    "SELLER_PACKAGE_WEIGHT",
    "SELLER_PACKAGE_WIDTH",
    "VALUE_ADDED_TAX",
  ];

  function isExcludedAttrId(id) {
    return EXCLUDED_ATTR_IDS.includes((id || "").trim());
  }

  /** Título + descripción del lado "USER PRODUCT" del comparador — igual que copiar.comparator.src.js. */
  function extractComparatorTitleAndDescription() {
    const out = [];
    const idBlocks = document.querySelectorAll(".comparator-result__id-block");
    let userProductBlock = null;
    idBlocks.forEach((block) => {
      const label = (block.querySelector(".comparator-result__id-label")?.textContent || "").trim();
      if (label === "USER PRODUCT") userProductBlock = block;
    });
    const titleEl =
      userProductBlock?.querySelector(".comparator-result__id-title") ||
      document.querySelector(".comparator-result__id-title");
    const title = (titleEl?.textContent || "").trim();
    if (title) out.push({ label: "Título", value: title });

    document.querySelectorAll(".comparator-result__description-column").forEach((col) => {
      if ((col.querySelector("span")?.textContent || "").trim() !== "ITEM") return;
      const description = (col.querySelector("p.comparator-result__description")?.textContent || "").trim();
      if (description) out.push({ label: "Descripción", value: description });
    });
    return out;
  }

  /** Filas "hijo" de la variante AGRUPADA — solo grupos con título en CHILD_GROUP_TITLES. */
  function extractChildAttrsGrouped() {
    const out = [];
    document.querySelectorAll(".comparator-result__attr-group").forEach((group) => {
      const title = (group.querySelector(".comparator-result__attr-group-title")?.textContent || "").trim();
      if (!CHILD_GROUP_TITLES.includes(title)) return;
      group.querySelectorAll("tr.attr-row").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) return;
        const id = (cells[0].querySelector("span")?.textContent || "").trim();
        if (isExcludedAttrId(id)) return;
        const label = (cells[0].querySelector(".attr-row__name")?.textContent || "").trim() || id;
        const value = (cells[1].querySelector(".attr-row__value")?.textContent || "").trim();
        if (!label || !value) return;
        out.push({ id, label, value });
      });
    });
    return out;
  }

  /** Filas "hijo" de la variante PLANA — ver nota de arriba (estado de la fila como proxy de "hijo"). */
  function extractChildAttrsFlat() {
    const rows = document.querySelectorAll("tr.attr-row:not(.attr-row--match)");
    const out = [];
    const seen = new Set();
    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;
      const id = (cells[0].querySelector("span")?.textContent || "").trim();
      if (isExcludedAttrId(id)) return;
      const label =
        (cells[0].querySelector('[class*="attr-row"][class*="name"]')?.textContent || "").trim() || id;
      const valueCell = cells[1];
      if (!label || !valueCell || valueCell.querySelector('[class*="empty"]')) return;
      const value = (valueCell.querySelector("span")?.textContent || "").trim();
      if (!value) return;
      const key = id + "|" + label;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id, label, value });
    });
    return out;
  }

  function extractChildAttrs() {
    const grouped = extractChildAttrsGrouped();
    if (grouped.length) return grouped;
    return extractChildAttrsFlat();
  }

  const usingComparator = !!document.querySelector(
    ".comparator-result__attr-group, .attr-row, table.comparator-result_table"
  );

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
  header.textContent = "MLF — Copiar Variante";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  // Sin comparador en pantalla no hay forma de distinguir padre/hijo —
  // avisa en vez de copiar cualquier cosa (o nada) en silencio.
  if (!usingComparator) {
    const msg = document.createElement("div");
    msg.style.cssText = "padding:16px 14px;color:#374151;line-height:1.5";
    msg.textContent =
      'Esto necesita el comparador de fichas en pantalla (el mismo que usa "Copiar Comparator") — no funciona parado en una publicación suelta.';
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
    return;
  }

  const childAttrs = extractChildAttrs();

  // Pedido explícito: si no hay nada que distinga esta variante de sus
  // hermanas, avisar que el botón no aplica acá en vez de copiar vacío.
  if (!childAttrs.length) {
    const msg = document.createElement("div");
    msg.style.cssText = "padding:16px 14px;color:#374151;line-height:1.5";
    msg.textContent =
      "Esta publicación no tiene atributos que distingan variantes (Color, Memoria, GTIN...) — no se puede usar este botón acá.";
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
    return;
  }

  const attributes = [...extractComparatorTitleAndDescription(), ...childAttrs];

  const list = document.createElement("div");
  list.style.cssText = "overflow-y:auto;padding:4px 8px;flex:1";

  // Mismo patrón editable que copiar.src.js / copiar.comparator.src.js: el
  // checkbox se asocia al label por id/for solo, y el valor editable va
  // AFUERA de cualquier <label> — clickear el valor para editarlo no debe
  // destildar el checkbox (bug ya resuelto antes, ver copiar.src.js).
  const checkboxes = [];
  const valueEls = [];
  attributes.forEach((attr, idx) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #f1f2f4";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = OVERLAY_ID + "-cb-" + idx;
    cb.checked = true;
    cb.dataset.idx = String(idx);
    cb.style.cssText = "margin-top:2px;cursor:pointer;flex:0 0 auto";
    checkboxes.push(cb);

    const text = document.createElement("div");
    text.style.cssText = "min-width:0;flex:1";
    const labelEl = document.createElement("label");
    labelEl.htmlFor = cb.id;
    labelEl.style.cssText = "font-weight:600;display:block;cursor:pointer";
    labelEl.textContent = attr.label;
    const valueEl = document.createElement("div");
    valueEl.contentEditable = "true";
    valueEl.spellcheck = false;
    valueEl.style.cssText =
      "color:#374151;word-break:break-word;max-height:6em;overflow-y:auto;cursor:text;" +
      "border:1px solid transparent;border-radius:4px;padding:2px 4px;margin:2px -4px 0;outline:none";
    valueEl.textContent = attr.value;
    valueEl.addEventListener("focus", () => {
      valueEl.style.borderColor = "#3483fa";
      valueEl.style.background = "#f7f9fc";
    });
    valueEl.addEventListener("blur", () => {
      valueEl.style.borderColor = "transparent";
      valueEl.style.background = "transparent";
    });
    valueEls.push(valueEl);
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
  copyBtn.textContent = "Copiar variante";
  copyBtn.style.cssText =
    "width:100%;padding:8px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer";

  copyBtn.onclick = async () => {
    const selected = checkboxes
      .filter((cb) => cb.checked)
      .map((cb) => {
        const idx = Number(cb.dataset.idx);
        return { ...attributes[idx], value: valueEls[idx].textContent.trim() };
      })
      .filter((attr) => attr.value.length > 0);
    if (!selected.length) {
      status.textContent = "Seleccioná al menos un atributo con un valor.";
      return;
    }
    const payload = JSON.stringify({
      v: 1,
      source: location.href,
      attributes: selected.map(({ id, label, value }) => ({ id, label, value })),
    });
    try {
      await navigator.clipboard.writeText(payload);
      status.textContent =
        `Copiado (${selected.length}). Clickeá "Agregar variante" en la herramienta y usá "Pegar Variante".`;
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      status.textContent = ok
        ? `Copiado (${selected.length}). Usá "Pegar Variante".`
        : "No se pudo copiar. Probá seleccionar manualmente.";
    }
  };

  footer.appendChild(status);
  footer.appendChild(copyBtn);

  overlay.appendChild(list);
  overlay.appendChild(footer);
  document.body.appendChild(overlay);
})();
