// MLF - Bookmarklet "Copiar Variantes" (PROTOTIPO, no deployado).
//
// Extiende "Copiar" (copiar.src.js): si la publicación tiene más de un
// color/variante, la recorre SOLA (clickeando cada swatch) y arma un
// paquete con los atributos de TODAS, no solo la seleccionada. Sigue
// siendo de solo lectura — no clickea nada fuera de esta misma página de
// ML, y al terminar vuelve a dejar seleccionada la variante que estaba
// original. Si la publicación no tiene variantes, se comporta exactamente
// igual que copiar.src.js (mismo payload v1).
//
// Pensado para usarse junto con pegar.variante.src.js — ver ese archivo
// para cómo se consume el payload de variantes múltiples.

(async function () {
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

  function splitCombinedVariation(attr) {
    if (!/\sy\s/i.test(attr.label) || !/\s\|\s/.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+y\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s*\|\s*/).map((s) => s.trim());
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  function isEmptyPlaceholder(value) {
    return /^-+$/.test(value.trim());
  }

  function splitCombinedDimensions(attr) {
    if (!/\sx\s/i.test(attr.label) || !/\sx\s/i.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s+x\s+/i).map((s) => s.trim()).filter(Boolean);
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  // Al revés de una lista negra de patrones a excluir (números con coma
  // decimal, "Apellido, Nombre" de autor, direcciones, fechas... la lista
  // de formas en que una coma NO es una lista real es interminable) esto
  // es una lista BLANCA de labels donde sí sabemos, por uso real, que ML
  // junta una lista real separada por coma. Si el label no matchea acá,
  // el valor se deja entero pase lo que pase — más simple de razonar y
  // más difícil de romper con un caso nuevo que no vimos todavía.
  const MULTI_VALUE_LABEL_KEYWORDS = ["material"];

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
      out.push({ label: attr.label, value, multiValue: true });
    }
    return out.length >= 2 ? out : [attr];
  }

  function isDistinctiveValue(value) {
    const v = value.trim();
    if (/^-?\d+([.,]\d+)?$/.test(v)) return v.replace(/[^0-9]/g, "").length >= 2;
    return v.length >= 4;
  }

  const VALUE_DEDUP_EXEMPT_LABELS = ["marca", "fabricante"];

  // Ver copiar.src.js: en vez de descartar el candidato repetido en
  // silencio (nunca llegaba ni al picker), se ofrece igual con un aviso
  // de "posible repetido" — tildado por default, la decisión final queda
  // en manos de quien copia.
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

  function extractAllForCurrentState() {
    const rawAttributes = [
      ...extractTitleAndDescription(),
      ...extractFromVariationSelector(),
      ...extractFromSpecsTable(),
      ...extractFromHighlightedFeatures(),
    ];
    return dedupeByLabel(
      rawAttributes
        .flatMap(splitCombinedVariation)
        .flatMap(splitCombinedDimensions)
        .flatMap(splitMultiValue)
        .filter((attr) => !isEmptyPlaceholder(attr.value))
    );
  }

  // --- Recorrido automático de TODAS las variantes -----------------
  //
  // Algunas publicaciones tienen más de un "eje" de variación a la vez
  // (ej. Color Y Memoria RAM por separado, cada uno con su propia fila de
  // botones) — confirmado en vivo en una publicación real de celulares.
  // Los botones de ambos ejes comparten la misma clase CSS
  // ("variations__thumbnails__item"), así que hay que agruparlos por su
  // contenedor real (el padre directo de cada botón, distinto por eje) en
  // vez de tratarlos todos como si fueran colores.
  //
  // No todas las combinaciones existen — ej. "Azul marino" puede no venir
  // en 4 GB. ML marca esas como "--DISABLED" en la clase (y lo confirma en
  // el aria-label: "Disponible en otras opciones") pero si se clickean
  // igual, ML cambia SOLO de esa combinación sin avisar (ej. te cambia la
  // RAM sola para poder mostrarte ese color). Para no arrastrar cambios no
  // pedidos de un eje a otro, achica el recorrido a SOLO las opciones
  // habilitadas en cada paso — nunca se clickea algo marcado --DISABLED.

  function isSelected(el) {
    return /--SELECTED/.test(el.className);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Texto de un botón de variante: para colores viene del alt de la
   * imagen ("Azul"); para ejes sin imagen (ej. "4 GB"/"8 GB") no hay
   * img, así que se cae al aria-label del botón, sacándole el prefijo
   * "Botón X de Y" y los sufijos "Seleccionado"/"Disponible en otras
   * opciones" que ML le agrega ahí mismo.
   */
  function getItemLabel(el) {
    const img = el.querySelector("img[alt]");
    if (img) return (img.getAttribute("alt") || "").trim();
    const aria = el.getAttribute("aria-label") || "";
    const parts = aria
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => !/^bot[oó]n\b/i.test(p) && !/^seleccionado$/i.test(p) && !/^disponible en otras opciones$/i.test(p));
    if (parts.length) return parts[0];
    return (el.textContent || "").trim();
  }

  /**
   * Agrupa los botones de variante por eje (Color, Memoria RAM, etc.),
   * leyendo el nombre de cada eje del título que ML pone arriba de cada
   * fila ("Color:Gris", "Memoria RAM:4 GB" — se le resta el valor
   * actualmente seleccionado para quedarse solo con el nombre). Ejes con
   * un solo botón (nada para elegir) se descartan.
   */
  function queryAxisGroups() {
    const items = Array.from(document.querySelectorAll("[class*='variations__thumbnails__item']")).filter(
      (el) => el.tagName === "A"
    );
    const groups = [];
    items.forEach((item) => {
      const parent = item.parentElement;
      let g = groups.find((g) => g.parent === parent);
      if (!g) {
        g = { parent, items: [] };
        groups.push(g);
      }
      g.items.push(item);
    });
    return groups
      .map(({ parent, items }) => {
        const titleText = (parent.previousElementSibling?.textContent || "").trim();
        const selectedItem = items.find(isSelected);
        const selectedLabel = selectedItem ? getItemLabel(selectedItem) : "";
        let axisName = titleText;
        if (selectedLabel && titleText.endsWith(selectedLabel)) {
          axisName = titleText.slice(0, titleText.length - selectedLabel.length).replace(/:\s*$/, "").trim();
        }
        return {
          axisName: axisName || "Variante",
          options: items.map((el) => ({
            label: getItemLabel(el),
            selected: isSelected(el),
            disabled: /--DISABLED/.test(el.className),
            el,
          })),
        };
      })
      .filter((axis) => axis.options.length > 1);
  }

  /**
   * Clickea la opción `label` del eje `axisName` y espera a que quede
   * seleccionada. Re-busca en vivo (no guarda la referencia vieja) porque
   * ML re-renderiza toda la fila al cambiar de combinación.
   */
  async function clickAxisOption(axisName, label) {
    const axis = queryAxisGroups().find((a) => a.axisName === axisName);
    const opt = axis?.options.find((o) => o.label === label);
    if (!opt) return false;
    opt.el.click();
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const now = queryAxisGroups()
        .find((a) => a.axisName === axisName)
        ?.options.find((o) => o.label === label);
      if (now && now.selected) break;
    }
    // Aunque ya figure seleccionado, la tabla de specs/precio/stock puede
    // tardar un toque más en actualizarse — margen extra antes de leer.
    await sleep(450);
    return true;
  }

  /**
   * Marca como scope:"child" los atributos cuyo label coincide con el
   * nombre de un eje de variación (ej. "Color", "Memoria RAM") — son el
   * dato que efectivamente cambia de una variante a otra y la convierte en
   * "otra" (misma idea que copiar.comparator.src.js con Padre/Hijo). Todo
   * lo demás queda sin scope (parent): se repite igual en cada variante.
   */
  function tagAxisScope(attrs, axisNames) {
    const axisKeys = new Set(axisNames.map((n) => n.trim().toLowerCase()));
    return attrs.map((attr) =>
      axisKeys.has(attr.label.trim().toLowerCase()) ? { ...attr, scope: "child" } : attr
    );
  }

  const MAX_VARIANTS = 30; // tope de seguridad para no recorrer combinaciones enormes

  /**
   * Producto cartesiano de las opciones de cada eje: [["Rojo","Azul"],["4
   * GB","8 GB"]] -> [["Rojo","4 GB"],["Rojo","8 GB"],["Azul","4
   * GB"],["Azul","8 GB"]]. Se prueban TODAS estas combinaciones (no solo
   * las que ML marca disponibles en el estado actual) porque cuál está
   * disponible depende del resto de los ejes: "Azul" puede figurar
   * deshabilitado mientras la RAM esté en 4 GB pero ser válido en 8 GB —
   * si esto se decidiera antes de tocar la RAM, "Azul" nunca se
   * recorrería. Ver verificación posterior en collectAllVariants.
   */
  function cartesianProduct(arrays) {
    return arrays.reduce((acc, arr) => acc.flatMap((prefix) => arr.map((v) => [...prefix, v])), [[]]);
  }

  /**
   * Recorre TODAS las combinaciones posibles entre los ejes detectados
   * (Color x Memoria RAM x ...) y devuelve un array {label, selected,
   * attributes} con solo las que realmente existen. No hay forma de saber
   * de antemano cuáles son válidas (depende de cómo estén combinados los
   * demás ejes en cada momento), así que se prueba cada combinación del
   * producto cartesiano completo: se clickea cada eje en orden y, si al
   * terminar la selección real coincide exactamente con lo que se quería
   * (ningún eje quedó pisado por otra oferta), se guarda como variante
   * válida — si no coincide, esa combinación no existe y se descarta sin
   * registrar nada. Al final deja la publicación de vuelta en la
   * combinación original. Devuelve null si no hay ningún eje con más de
   * una opción — el llamador cae al comportamiento de "Copiar" normal.
   */
  async function collectAllVariants() {
    const initialAxes = queryAxisGroups();
    if (!initialAxes.length) return null;

    const axisNames = initialAxes.map((a) => a.axisName);
    const axisLabelLists = initialAxes.map((a) => a.options.map((o) => o.label));
    const originalSelection = initialAxes.map((a) => a.options.find((o) => o.selected)?.label);

    let candidates = cartesianProduct(axisLabelLists);
    // Tope de seguridad: con ejes grandes (o 3+ ejes) el producto cartesiano
    // puede crecer mucho — se recorta a las primeras MAX_VARIANTS
    // combinaciones en vez de tardar minutos clickeando cientos de ellas.
    if (candidates.length > MAX_VARIANTS) candidates = candidates.slice(0, MAX_VARIANTS);

    const variants = [];
    const seenFinal = new Set();

    for (const candidate of candidates) {
      for (let i = 0; i < axisNames.length; i++) {
        await clickAxisOption(axisNames[i], candidate[i]);
      }
      // Verifica que la combinación pedida haya quedado realmente
      // seleccionada tal cual — si ML pisó algún eje (ej. cambió la RAM
      // sola al elegir un color que no viene en la RAM actual), esta
      // combinación puntual no existe: se descarta sin registrar nada
      // (evita guardar datos de una combinación distinta con la etiqueta
      // equivocada).
      const finalAxes = queryAxisGroups();
      const finalSelection = axisNames.map(
        (name) => finalAxes.find((a) => a.axisName === name)?.options.find((o) => o.selected)?.label
      );
      const matches = finalSelection.every((v, i) => v === candidate[i]);
      if (!matches) continue;
      const key = finalSelection.join("|");
      if (seenFinal.has(key)) continue;
      seenFinal.add(key);
      variants.push({
        label: finalSelection.join(" · "),
        selected: finalSelection.every((v, i) => v === originalSelection[i]),
        // Los atributos cuyo label coincide con el nombre de un eje (ej.
        // "Color") son justo lo que hace a esta variante distinta de las
        // demás — se marcan scope:"child" (misma convención que
        // copiar.comparator.src.js) para poder distinguirlos en el picker;
        // todo lo demás es "parent" (se repite igual en cada variante).
        attributes: tagAxisScope(extractAllForCurrentState(), axisNames),
      });
    }

    for (let i = 0; i < axisNames.length; i++) {
      if (originalSelection[i]) await clickAxisOption(axisNames[i], originalSelection[i]);
    }

    return variants.length > 1 ? variants : null;
  }

  // --- UI --------------------------------------------------------------
  //
  // Antes esto SIEMPRE recorría todas las combinaciones apenas corrías el
  // bookmarklet, aunque solo quisieras copiar la variante que ya tenías
  // abierta — clickeaba de más (cambiando precio/stock momentáneamente de
  // paso, ver collectAllVariants) para terminar descartando casi todo en
  // el picker. Ahora, si hay ejes de variación, primero se pregunta qué
  // se quiere: solo la variante actual (sin clickear nada) o recorrerlas
  // todas (comportamiento de antes).

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "width:360px", "max-height:82vh",
    "background:#fff", "color:#1f2328", "border-radius:10px",
    "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
    "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
    "display:flex", "flex-direction:column", "overflow:hidden",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600";
  header.textContent = "MLF — Copiar Variantes";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const body = document.createElement("div");
  body.style.cssText = "flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0";
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  function clearBody() {
    body.innerHTML = "";
  }

  let rowIdSeq = 0;

  /**
   * Una fila editable de atributo (checkbox + nombre + valor editable) —
   * mismo mecanismo que copiar.src.js: el checkbox se asocia al nombre por
   * id/for (nunca envuelve el valor en un <label>, eso lo destildaría al
   * clickear para editar) y copyBtn.onclick lee el texto ACTUAL del
   * valueEl, no attr.value, así se puede corregir a mano antes de copiar.
   * defaultChecked controla el estado inicial del checkbox.
   */
  function buildAttrRow(attr, defaultChecked) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid #f1f2f4";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = OVERLAY_ID + "-cb-" + rowIdSeq++;
    cb.checked = defaultChecked;
    cb.style.cssText = "margin-top:2px;cursor:pointer;flex:0 0 auto";

    const text = document.createElement("div");
    text.style.cssText = "min-width:0;flex:1";
    const labelEl = document.createElement("label");
    labelEl.htmlFor = cb.id;
    labelEl.style.cssText = "font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer";
    labelEl.textContent = attr.label;
    // Las filas "child" son justo lo que distingue a esta variante de las
    // demás (ver tagAxisScope) — se marcan aparte para que se note de un
    // vistazo cuál es el dato que cambia.
    if (attr.scope === "child") {
      const badge = document.createElement("span");
      badge.style.cssText =
        "font:600 9.5px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase;" +
        "color:#2f5fe0;background:#e9edfc;padding:2px 6px;border-radius:9px";
      badge.textContent = "distingue variante";
      labelEl.appendChild(badge);
    }
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
    return { row, cb, valueEl };
  }

  async function copyPayload(payload, status, count) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      status.textContent = `Copiado (${count}). Andá a la otra página y usá "MLF Pegar".`;
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = JSON.stringify(payload);
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      status.textContent = ok
        ? `Copiado (${count}). Andá a la otra página y usá "MLF Pegar".`
        : "No se pudo copiar. Probá seleccionar manualmente.";
    }
  }

  // --- Picker de un solo set de atributos: sin ejes de variación, o
  // "copiar solo esta variante" — payload v1, mismo formato que
  // copiar.src.js/"MLF Pegar" de siempre. -------------------------------
  function renderSinglePicker(attributes, noticeText) {
    clearBody();
    header.textContent = "MLF — Atributos (" + attributes.length + ")";

    if (noticeText) {
      const notice = document.createElement("div");
      notice.style.cssText =
        "padding:8px 12px;background:#e9edfc;color:#2f5fe0;font-size:12px;line-height:1.4;border-bottom:1px solid #d7defb";
      notice.textContent = noticeText;
      body.appendChild(notice);
    }

    const list = document.createElement("div");
    list.style.cssText = "overflow-y:auto;padding:4px 8px;flex:1";
    if (!attributes.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:24px 8px;text-align:center;color:#9aa1ab";
      empty.textContent = "No se encontraron atributos en esta página.";
      list.appendChild(empty);
    }
    const rows = attributes.map((attr) => buildAttrRow(attr, !attr.multiValue));
    rows.forEach(({ row }) => list.appendChild(row));
    body.appendChild(list);

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
      const selectedAttrs = [];
      rows.forEach(({ cb, valueEl }, idx) => {
        if (!cb.checked) return;
        const value = valueEl.textContent.trim();
        if (!value) return;
        selectedAttrs.push({ ...attributes[idx], value });
      });
      if (!selectedAttrs.length) {
        status.textContent = "Seleccioná al menos un atributo con un valor.";
        return;
      }
      const payload = {
        v: 1,
        source: location.href,
        attributes: selectedAttrs.map(({ label, value, multiValue, scope }) => ({ label, value, multiValue, scope })),
      };
      await copyPayload(payload, status, selectedAttrs.length);
    };
    footer.appendChild(status);
    footer.appendChild(copyBtn);
    body.appendChild(footer);
  }

  // --- Picker agrupado por variante: "recorrer todas". Payload v2, igual
  // formato que antes (attributes = base + variants[]). -----------------
  function renderGroupedPicker(variants) {
    clearBody();
    header.textContent = `MLF — ${variants.length} variantes`;

    const notice = document.createElement("div");
    notice.style.cssText =
      "padding:8px 12px;background:#e9edfc;color:#2f5fe0;font-size:12px;line-height:1.4;border-bottom:1px solid #d7defb";
    notice.textContent =
      `Se recorrieron ${variants.length} variantes solas (${variants.map((v) => v.label).join(", ")}). ` +
      `La publicación ya volvió a mostrar la que tenías abierta. Elegí qué incluir de cada una.`;
    body.appendChild(notice);

    const list = document.createElement("div");
    list.style.cssText = "overflow-y:auto;padding:4px 8px;flex:1";
    body.appendChild(list);

    // groups: [{ label, selected, attrRows: [{attr, cb, valueEl}], groupCb }]
    const groups = variants.map((variant) => {
      const groupHeader = document.createElement("div");
      groupHeader.style.cssText =
        "display:flex;gap:8px;align-items:center;padding:8px 4px 4px;font-weight:600;border-top:1px solid #e5e7eb;margin-top:4px";
      const groupCb = document.createElement("input");
      groupCb.type = "checkbox";
      groupCb.checked = variant.selected;
      const groupLabel = document.createElement("span");
      groupLabel.textContent = variant.label + (variant.selected ? " (la que tenías abierta)" : "");
      groupHeader.appendChild(groupCb);
      groupHeader.appendChild(groupLabel);
      list.appendChild(groupHeader);

      const attrRows = variant.attributes.map((attr) => {
        const built = buildAttrRow(attr, variant.selected && !attr.multiValue);
        built.row.style.paddingLeft = "26px";
        list.appendChild(built.row);
        return { attr, cb: built.cb, valueEl: built.valueEl };
      });

      groupCb.onchange = () => {
        attrRows.forEach(({ cb }) => (cb.checked = groupCb.checked));
      };

      if (!variant.attributes.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:4px 4px 4px 26px;color:#9aa1ab;font-size:12px";
        empty.textContent = "Sin atributos detectados para esta variante.";
        list.appendChild(empty);
      }

      return { label: variant.label, selected: variant.selected, attrRows };
    });

    const footer = document.createElement("div");
    footer.style.cssText = "padding:8px 12px 12px;border-top:1px solid #e5e7eb";
    const status = document.createElement("div");
    status.style.cssText = "font-size:12px;color:#6b7280;min-height:16px;margin-bottom:6px";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copiar seleccionadas";
    copyBtn.style.cssText =
      "width:100%;padding:8px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer";

    copyBtn.onclick = async () => {
      const chosenVariants = groups
        .map((g) => ({
          label: g.label,
          selected: g.selected,
          attributes: g.attrRows
            .filter(({ cb }) => cb.checked)
            .map(({ attr, valueEl }) => {
              const value = valueEl.textContent.trim();
              return value ? { ...attr, value } : null;
            })
            .filter(Boolean)
            // Solo label/value/multiValue/scope viajan al portapapeles —
            // possibleDuplicate y duplicateReason son detalle del picker.
            .map(({ label, value, multiValue, scope }) => ({ label, value, multiValue, scope })),
        }))
        .filter((v) => v.attributes.length);

      if (!chosenVariants.length) {
        status.textContent = "Seleccioná al menos un atributo con un valor de alguna variante.";
        return;
      }

      const base = chosenVariants.find((v) => v.selected) || chosenVariants[0];
      const payload = {
        v: 2,
        source: location.href,
        attributes: base.attributes, // compat: "MLF Pegar" sin cambios lee esto como siempre
        variants: chosenVariants,
      };
      const totalAttrs = chosenVariants.reduce((n, v) => n + v.attributes.length, 0);
      await copyPayload(
        payload,
        status,
        `${chosenVariants.length} variante(s), ${totalAttrs} atributo(s)`
      );
    };
    footer.appendChild(status);
    footer.appendChild(copyBtn);
    body.appendChild(footer);
  }

  // --- Elegir qué recorrer, si hay ejes de variación --------------------
  function renderModeChooser(axes) {
    header.textContent = "MLF — variantes detectadas";
    const axisNames = axes.map((a) => a.axisName);
    const axisSummary = axes.map((a) => `${a.axisName} (${a.options.length})`).join(", ");
    const totalCombos = axes.reduce((n, a) => n * a.options.length, 1);

    const info = document.createElement("div");
    info.style.cssText = "padding:12px;font-size:12.5px;color:#374151;line-height:1.5";
    info.textContent =
      `Esta publicación varía en: ${axisSummary}. Cada combinación de eso es una variante ` +
      `distinta (todo lo demás se mantiene igual). ¿Qué querés copiar?`;
    body.appendChild(info);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "padding:0 12px 12px;display:flex;flex-direction:column;gap:8px";

    const btnOne = document.createElement("button");
    btnOne.textContent = "Copiar solo esta variante (la que tenés abierta)";
    btnOne.style.cssText =
      "padding:9px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;text-align:left";
    btnOne.onclick = () => {
      const attributes = tagAxisScope(extractAllForCurrentState(), axisNames);
      renderSinglePicker(attributes);
    };

    const btnAll = document.createElement("button");
    btnAll.textContent = `Recorrer todas (hasta ${Math.min(totalCombos, MAX_VARIANTS)} combinaciones)`;
    btnAll.style.cssText =
      "padding:9px 10px;background:#fff;color:#3483fa;border:1px solid #3483fa;border-radius:6px;font-weight:600;cursor:pointer;text-align:left";
    btnAll.onclick = async () => {
      clearBody();
      header.textContent = "MLF — buscando variantes…";
      const hint = document.createElement("div");
      hint.style.cssText = "padding:24px 12px;text-align:center;color:#9aa1ab;font-size:12.5px";
      hint.textContent = "Recorriendo combinaciones — la página puede parpadear de precio/stock, es esperado.";
      body.appendChild(hint);
      const variants = await collectAllVariants();
      if (!variants) {
        renderSinglePicker(tagAxisScope(extractAllForCurrentState(), axisNames));
        return;
      }
      renderGroupedPicker(variants);
    };

    btnRow.appendChild(btnOne);
    btnRow.appendChild(btnAll);
    body.appendChild(btnRow);
  }

  const axes = queryAxisGroups();
  if (!axes.length) {
    renderSinglePicker(extractAllForCurrentState());
  } else {
    renderModeChooser(axes);
  }
})();
