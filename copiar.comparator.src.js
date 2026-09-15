// MLF - Bookmarklet "Copiar Comparator" (correr parado en el comparador de
// fichas de ML — comparator-result__*). Igual a copiar.src.js pero agrega
// una extracción específica del comparador (con noción de padre/hijo) y cae
// de vuelta a la extracción de página de publicación normal si el
// comparador no está presente.
//
// Reconstruido a partir del build minificado que se pasó a mano (no había
// .src.js legible para esta variante todavía) — mismo estilo/comentarios
// que copiar.src.js para no divergir en dos formas de escribir lo mismo.

(function () {
  "use strict";

  const OVERLAY_ID = "mlf-bk-overlay";
  document.getElementById(OVERLAY_ID)?.remove();

  // Orden de prioridad de los grupos de atributos del comparador: primero
  // los de "padre", después cualquier grupo no reconocido, y al final los
  // de "hijo" — así el orden de copiado queda padre→hijo aunque el DOM los
  // traiga mezclados.
  const PARENT_GROUP_TITLES = ["Identificadores Padre", "Otros atributos"];
  const CHILD_GROUP_TITLES = ["Identificadores Hijo", "Identificadores de Producto"];

  // Ver isDistinctiveValue en copiar.src.js — misma regla.
  function isDistinctiveValue(value) {
    const v = value.trim();
    if (/^-?\d+([.,]\d+)?$/.test(v)) return v.replace(/[^0-9]/g, "").length >= 2;
    return v.length >= 4;
  }

  const VALUE_DEDUP_EXEMPT_LABELS = ["marca", "fabricante"];

  // Igual que dedupeByLabel en copiar.src.js — se mantiene acá aparte
  // (en vez de compartir un solo archivo) porque cada bookmarklet se
  // instala como un bookmark independiente y tiene que poder correr solo.
  function dedupeByLabel(list) {
    const firstByLabel = new Map();
    const firstByValue = new Map();
    const seenLabelValue = new Set();
    const out = [];
    for (const attr of list) {
      const labelKey = attr.label.trim().toLowerCase();
      const valueKey = attr.value.trim().toLowerCase();
      if (attr.multiValue) {
        const labelValueKey = labelKey + "|" + valueKey;
        if (seenLabelValue.has(labelValueKey)) continue;
        seenLabelValue.add(labelValueKey);
        out.push(attr);
        continue;
      }
      const exemptFromValueDedup = VALUE_DEDUP_EXEMPT_LABELS.includes(labelKey);
      const sameLabelAs = firstByLabel.get(labelKey);
      const sameValueAs =
        !exemptFromValueDedup && isDistinctiveValue(attr.value) ? firstByValue.get(valueKey) : null;
      const duplicateOf = sameLabelAs || sameValueAs;
      if (!firstByLabel.has(labelKey)) firstByLabel.set(labelKey, attr);
      if (!exemptFromValueDedup && isDistinctiveValue(attr.value) && !firstByValue.has(valueKey)) {
        firstByValue.set(valueKey, attr);
      }
      if (duplicateOf) {
        out.push({
          ...attr,
          possibleDuplicate: true,
          duplicateReason: sameLabelAs
            ? `Ya hay otro atributo "${attr.label}" más arriba.`
            : `Mismo valor que "${duplicateOf.label}".`,
        });
      } else {
        out.push(attr);
      }
    }
    return out;
  }

  /** Título + descripción del lado "USER PRODUCT" del comparador. */
  function extractComparatorTitleAndDescription() {
    const out = [];
    const idBlocks = document.querySelectorAll(".comparator-result__id-block");
    let userProductBlock = null;
    idBlocks.forEach((block) => {
      const label = (block.querySelector(".comparator-result__id-label")?.textContent || "").trim();
      if (label === "USER PRODUCT") userProductBlock = block;
    });
    const title = (userProductBlock?.querySelector(".comparator-result__id-title")?.textContent || "").trim();
    if (title) out.push({ label: "Título", value: title });

    document.querySelectorAll(".comparator-result__description-column").forEach((col) => {
      if ((col.querySelector("span")?.textContent || "").trim() !== "ITEM") return;
      const description = (col.querySelector("p.comparator-result__description")?.textContent || "").trim();
      if (description) out.push({ label: "Descripción", value: description });
    });
    return out;
  }

  /**
   * Filas de atributo del comparador (.comparator-result__attr-group >
   * tr.attr-row), agrupadas por título de grupo y reordenadas
   * padre→desconocido→hijo (ver PARENT_GROUP_TITLES/CHILD_GROUP_TITLES).
   * Las filas de un grupo "hijo" se marcan con scope:"child" — "Pegar
   * Comparator" usa eso para completar primero los campos de padre y
   * recién después los de hijo.
   */
  function extractComparatorAttrGroups() {
    const groupsByTitle = new Map();
    document.querySelectorAll(".comparator-result__attr-group").forEach((group) => {
      const title = (group.querySelector(".comparator-result__attr-group-title")?.textContent || "").trim();
      if (!groupsByTitle.has(title)) groupsByTitle.set(title, []);
      groupsByTitle.get(title).push(group);
    });

    const orderedTitles = [
      ...PARENT_GROUP_TITLES.filter((t) => groupsByTitle.has(t)),
      ...Array.from(groupsByTitle.keys()).filter(
        (t) => !PARENT_GROUP_TITLES.includes(t) && !CHILD_GROUP_TITLES.includes(t)
      ),
      ...CHILD_GROUP_TITLES.filter((t) => groupsByTitle.has(t)),
    ];

    const out = [];
    orderedTitles.forEach((title) => {
      const isChildGroup = CHILD_GROUP_TITLES.includes(title);
      groupsByTitle.get(title).forEach((group) => {
        group.querySelectorAll("tr.attr-row").forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) return;
          const id = (cells[0].querySelector("span")?.textContent || "").trim();
          const label = (cells[0].querySelector(".attr-row__name")?.textContent || "").trim() || id;
          const value = (cells[1].querySelector(".attr-row__value")?.textContent || "").trim();
          if (!label || !value) return;
          out.push(isChildGroup ? { id, label, value, scope: "child" } : { id, label, value });
        });
      });
    });
    return out;
  }

  // --- Extracción de página de publicación normal (fallback cuando el
  // comparador no está presente en pantalla) — idéntica a copiar.src.js.

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
      const value = text.slice(sep + 1).trim().replace(/\.+$/, "").trim();
      if (!label || !value) return;
      out.push({ label, value });
    });
    return out;
  }

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

  // --- Splits combinados — idénticos a copiar.src.js.

  function splitCombinedVariation(attr) {
    if (!/\sy\s/i.test(attr.label) || !/\s\|\s/.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+y\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s*\|\s*/).map((s) => s.trim());
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  function splitCombinedDimensions(attr) {
    if (!/\sx\s/i.test(attr.label) || !/\sx\s/i.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  const MULTI_VALUE_LABEL_KEYWORDS = ["material", "materiais"];

  function labelAllowsMultiValue(label) {
    const key = label.trim().toLowerCase();
    return MULTI_VALUE_LABEL_KEYWORDS.some((kw) => key.includes(kw));
  }

  function stripParenthetical(value) {
    const stripped = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return stripped || value.trim();
  }

  function splitMultiValue(attr) {
    if (!labelAllowsMultiValue(attr.label)) return [attr];
    if (!attr.value.includes(",")) return [attr];
    const parts = attr.value
      .split(",")
      .map((s) => stripParenthetical(s.trim()))
      .filter(Boolean);
    if (parts.length < 2 || parts.some((p) => p.length > 80)) return [attr];
    const seen = new Set();
    const out = [];
    for (const value of parts) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // id/scope viajan también acá — son filas candidatas del mismo
      // campo de comparador, no atributos nuevos.
      out.push({ id: attr.id, label: attr.label, value, multiValue: true, scope: attr.scope });
    }
    return out.length >= 2 ? out : [attr];
  }

  function isEmptyPlaceholder(value) {
    return /^-+$/.test(value.trim());
  }

  // Si el comparador está en pantalla (.comparator-result__attr-group o
  // .attr-row presentes), usar esa extracción; si no, caer en la de
  // página de publicación normal — así el mismo bookmark sirve para
  // ambos contextos sin tener que elegir a mano.
  const usingComparator = !!document.querySelector(".comparator-result__attr-group, .attr-row");
  const rawAttributes = usingComparator
    ? [...extractComparatorTitleAndDescription(), ...extractComparatorAttrGroups()]
    : [
        ...extractTitleAndDescription(),
        ...extractFromVariationSelector(),
        ...extractFromSpecsTable(),
        ...extractFromHighlightedFeatures(),
      ];

  const attributes = dedupeByLabel(
    rawAttributes
      .flatMap(splitCombinedVariation)
      .flatMap(splitCombinedDimensions)
      .flatMap(splitMultiValue)
      .filter((attr) => !isEmptyPlaceholder(attr.value))
  );
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
  // Un <div> editable por fila — copyBtn.onclick lee el texto ACTUAL de
  // acá, no attr.value, así se puede corregir un dato a mano antes de
  // copiarlo (ver copiar.src.js, mismo mecanismo).
  const valueEls = [];
  attributes.forEach((attr, idx) => {
    // Ver copiar.src.js: NO es un <label> envolviendo toda la fila — eso
    // tilda/destilda el checkbox con solo clickear el valor para editarlo
    // (activación nativa del browser, stopPropagation no la frena). El
    // checkbox se asocia por id/for solo con el nombre del atributo.
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #f1f2f4";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = OVERLAY_ID + "-cb-" + idx;
    cb.checked = !attr.multiValue;
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

    if (attr.possibleDuplicate) {
      const warn = document.createElement("div");
      warn.style.cssText =
        "margin-top:3px;font-size:11px;color:#8a5a00;background:#fff7e6;border:1px solid #f1e2bd;border-radius:5px;padding:3px 6px;display:inline-block";
      warn.textContent = "⚠ Posible repetido — " + attr.duplicateReason;
      text.appendChild(warn);
    }

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
    // id/scope viajan al portapapeles acá (a diferencia de copiar.src.js) —
    // "Pegar Comparator" los usa para matchear por name/id y para
    // secuenciar padre antes que hijo.
    const payload = JSON.stringify({
      v: 1,
      source: location.href,
      attributes: selected.map(({ id, label, value, multiValue, scope }) => ({ id, label, value, multiValue, scope })),
    });
    try {
      await navigator.clipboard.writeText(payload);
      status.textContent = `Copiado (${selected.length}). Andá a la otra página y usá el bookmarklet "MLF Pegar".`;
    } catch (err) {
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
