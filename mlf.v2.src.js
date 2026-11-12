// MLF V2 — un solo bookmarklet con un menú chico, agrupado igual que la
// barra de favoritos de siempre: 3 grupos (Comparator / Variante / Fotos),
// cada uno con su par de botones "Copiar X" / "Pegar X" — reemplaza, en un
// solo lugar, a los 6 bookmarklets por separado. La lógica de cada botón
// es la misma que esos archivos (copiar/pegar.comparator.src.js,
// copiar.variantes.src.js, pegar.variante.src.js, copiar/pegar.fotos.src.js),
// solo que acá vive junta.
//
// "Copiar Comparator" y "Copiar Variante" también dejan elegir fotos de la
// galería en el mismo picker (checkboxes aparte, abajo de los atributos) —
// así un solo "Copiar" lleva atributos y fotos juntos, sin tener que correr
// "Copiar Fotos" aparte. "Pegar Comparator"/"Pegar Variante" pegan las dos
// cosas si el payload las trae. "Copiar Fotos"/"Pegar Fotos" se mantienen
// aparte para cuando hace falta llevar fotos sueltas, sin atributos.

(function () {
  "use strict";

  const MENU_ID = "mlf-v2-menu";
  document.getElementById(MENU_ID)?.remove();
  document.getElementById("mlf-bk-overlay")?.remove();
  document.getElementById("mlf-bk-fotos-overlay")?.remove();
  document.getElementById("mlf-bk-toast")?.remove();
  document.getElementById("mlf-bk-summary")?.remove();

  // ============================================================
  // Helpers compartidos del lado "pegar" — idénticos a
  // pegar.comparator.src.js / pegar.variante.src.js (ya convergían salvo
  // en el scope de búsqueda, que acá queda explícito en cada función vía
  // el parámetro scopeRoot).
  // ============================================================

  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const MATERIAL_CATEGORY_HINTS = [
    { target: "metal", keywords: ["bronce", "acero", "niquel", "nickel", "metal", "cobre", "laton", "hierro"] },
    { target: "nailon", keywords: ["nylon", "nailon"] },
  ];

  function findMaterialCategoryFallback(optionTexts, value) {
    const v = normalize(value);
    for (const { target, keywords } of MATERIAL_CATEGORY_HINTS) {
      if (!keywords.some((k) => v.includes(k))) continue;
      const idx = optionTexts.findIndex((t) => normalize(t) === target);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function fillSelect(select, value, strict) {
    const target = normalize(value);
    const options = Array.from(select.options);
    const texts = options.map((o) => o.textContent);
    let idx = texts.findIndex((t) => normalize(t) === target);
    let exact = idx !== -1;
    if (!strict) {
      if (idx === -1) idx = texts.findIndex((t) => normalize(t).includes(target) || target.includes(normalize(t)));
      if (idx === -1) idx = findMaterialCategoryFallback(texts, value);
    }
    if (idx === -1) return { ok: false };
    select.value = options[idx].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, exact };
  }

  function matchOptionIndex(texts, rawValue, strict) {
    const target = normalize(rawValue);
    let idx = texts.findIndex((t) => normalize(t) === target);
    const exact = idx !== -1;
    if (!strict) {
      if (idx === -1) idx = texts.findIndex((t) => normalize(t).includes(target) || target.includes(normalize(t)));
      if (idx === -1) idx = findMaterialCategoryFallback(texts, rawValue);
    }
    return { idx, exact };
  }

  function isColorLabel(label) {
    return /\bcolor\b/i.test(normalize(label));
  }

  function needsExactOption(attr) {
    return !!attr.exactOption || isColorLabel(attr.label);
  }

  function isMultiSelectOption(li) {
    return !!li.querySelector('.andes-checkbox, input[type="checkbox"]');
  }

  function splitMultiValueStr(value) {
    return String(value)
      .split(/\s*(?:,|\/|;|\by\b)\s*/i)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  function findSearchInput() {
    return (
      document.querySelector('[data-andes-searchbox-input="true"]') ||
      document.querySelector('input[aria-label="Buscar"]')
    );
  }

  async function typeIntoSearch(rawValue) {
    const input = findSearchInput();
    if (!input) return false;
    const proto = window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(input, rawValue);
    else input.value = rawValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    return true;
  }

  function readOpenListItems() {
    return Array.from(document.querySelectorAll('li[role="option"], li[data-key]')).filter(
      (li) => normalize(li.textContent) !== "sin resultados..."
    );
  }

  function findAddOption(items, rawValue) {
    const wanted = rawValue.trim();
    return items.find(
      (li) => li.getAttribute("data-key") === wanted && /^agregar\b/i.test(normalize(li.textContent))
    );
  }

  async function resolveAndesOption(items, texts, rawValue, strict) {
    let { idx, exact } = matchOptionIndex(texts, rawValue, strict);
    if (idx !== -1) return { li: items[idx], exact, added: false };

    if (!(await typeIntoSearch(rawValue))) return { li: null };
    const filtered = readOpenListItems();
    const addOption = findAddOption(filtered, rawValue);
    const realItems = filtered.filter((li) => li !== addOption);
    const realTexts = realItems.map((li) => li.textContent);
    ({ idx, exact } = matchOptionIndex(realTexts, rawValue, strict));
    if (idx !== -1) return { li: realItems[idx], exact, added: false };
    if (addOption) return { li: addOption, exact: true, added: true };
    return { li: null };
  }

  async function clickAndesOption(value, strict) {
    const items = Array.from(document.querySelectorAll('li[role="option"][data-key], li[data-key]'));
    if (!items.length) return { ok: false };
    const texts = items.map((li) => li.textContent);

    if (!isMultiSelectOption(items[0])) {
      const { li, exact, added } = await resolveAndesOption(items, texts, value, strict);
      if (!li) return { ok: false };
      li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      li.click();
      return { ok: true, exact, added: !!added };
    }

    const parts = splitMultiValueStr(value);
    let matchedCount = 0;
    let allExact = true;
    let anyAdded = false;
    for (const part of parts) {
      const currentItems = readOpenListItems();
      const currentTexts = currentItems.map((li) => li.textContent);
      const { li, exact, added } = await resolveAndesOption(currentItems, currentTexts, part, strict);
      if (!li) {
        allExact = false;
        continue;
      }
      if (li.getAttribute("aria-selected") !== "true") {
        li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        li.click();
      }
      matchedCount++;
      if (!exact) allExact = false;
      if (added) anyAdded = true;
      await typeIntoSearch("");
    }
    if (!matchedCount) return { ok: false };
    return { ok: true, exact: allExact && matchedCount === parts.length, added: anyAdded };
  }

  const BOOLEAN_SYNONYMS = { si: ["si", "sí", "yes", "true", "1"], no: ["no", "not", "false", "0"] };

  function clickToggleButton(buttons, value) {
    const target = normalize(value);
    let match = buttons.find((b) => normalize(b.textContent) === target);
    if (!match) {
      const bucket = BOOLEAN_SYNONYMS.si.includes(target) ? "si" : BOOLEAN_SYNONYMS.no.includes(target) ? "no" : null;
      if (bucket) match = buttons.find((b) => BOOLEAN_SYNONYMS[bucket].includes(normalize(b.textContent)));
    }
    if (!match) return false;
    match.click();
    return true;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function expandCollapsedSections(root = document) {
    for (let pass = 0; pass < 3; pass++) {
      const collapsed = Array.from(root.querySelectorAll('[aria-expanded="false"][role="button"]'));
      if (!collapsed.length) return;
      collapsed.forEach((el) => el.click());
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /**
   * La tarjeta (".expandible-card") cuyo toggle está actualmente abierto —
   * usado por "Variante" al pegar, para apuntar SOLO a la tarjeta de
   * variante que tenés abierta en pantalla (ver pegar.variante.src.js).
   * Devuelve `document` si no encuentra ninguna.
   */
  function getScopeRoot() {
    const cards = Array.from(document.querySelectorAll(".expandible-card"));
    const open = cards.find((card) => {
      const toggle = card.querySelector(".expandible-card__toggle, [aria-expanded]");
      return toggle && toggle.getAttribute("aria-expanded") === "true";
    });
    return open || document;
  }

  function findFieldByName(scopeRoot, id) {
    let escaped;
    try {
      escaped = CSS.escape(id);
    } catch (_) {
      escaped = null;
    }
    const byAttr = escaped ? scopeRoot.querySelector(`[name^="${escaped}["], [name*=".${escaped}["]`) : null;
    if (byAttr) return byAttr;
    return (
      Array.from(scopeRoot.querySelectorAll("input,select,textarea")).find((cand) => {
        const name = cand.getAttribute("name") || "";
        return name === id || name.startsWith(`${id}[`) || name.includes(`.${id}[`);
      }) || null
    );
  }

  async function fillByName(fieldEl, attr) {
    if (fieldEl.tagName === "SELECT") {
      const r = fillSelect(fieldEl, attr.value, needsExactOption(attr));
      return r.ok ? (r.exact ? "select" : "select-approx") : "sin-match";
    }
    const splitField = findSplitUnitFieldFromInput(fieldEl);
    if (splitField) return fillSplitUnitField(splitField, attr);
    const type = (fieldEl.getAttribute("type") || "text").toLowerCase();
    const isPlainTextField =
      fieldEl.tagName === "TEXTAREA" || ["text", "search", "tel", "email", "number", "url"].includes(type);
    if (isPlainTextField && isVisible(fieldEl) && !fieldEl.readOnly && !fieldEl.disabled) {
      setNativeValue(fieldEl, attr.value);
      return "texto";
    }
    return "sin-match";
  }

  function setContentEditableValue(el, value) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, value);
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function containerFromLabelEl(labelEl) {
    const forId = labelEl.getAttribute("for");
    return (forId && document.getElementById(forId)) || labelEl.parentElement;
  }

  const STOPWORDS = ["de", "del", "la", "el", "las", "los", "al", "un", "una"];
  const CASE_WORD_CANON = { funda: "funda", forro: "funda", carcasa: "funda", case: "funda" };

  function canonicalizePhrase(text) {
    return text
      .split(" ")
      .filter((w) => w && !STOPWORDS.includes(w))
      .map((w) => CASE_WORD_CANON[w] || w)
      .join(" ");
  }

  function findContainerForLabel(scopeRoot, label) {
    const target = normalize(label);
    const labels = Array.from(scopeRoot.querySelectorAll("label"));
    const ariaCandidates = Array.from(scopeRoot.querySelectorAll("section[aria-label], div[aria-label]"));

    let labelEl = labels.find((l) => normalize(l.getAttribute("for") || "") === target);
    if (!labelEl) labelEl = labels.find((l) => normalize(l.textContent) === target);
    if (labelEl) {
      const container = containerFromLabelEl(labelEl);
      if (container) return container;
    }
    const ariaExact = ariaCandidates.find((el) => normalize(el.getAttribute("aria-label") || "") === target);
    if (ariaExact) return ariaExact;

    let fuzzy = labels.find((l) => normalize(l.textContent).startsWith(target));
    if (!fuzzy) {
      fuzzy = labels.find(
        (l) => normalize(l.textContent).includes(target) || target.includes(normalize(l.textContent))
      );
    }
    if (fuzzy) {
      const container = containerFromLabelEl(fuzzy);
      if (container) return container;
    }

    const canonTarget = canonicalizePhrase(target);
    if (canonTarget) {
      let canonMatch = labels.find((l) => {
        const forText = l.getAttribute("for");
        return forText && canonicalizePhrase(normalize(forText)) === canonTarget;
      });
      if (!canonMatch) {
        canonMatch = labels.find((l) => canonicalizePhrase(normalize(l.textContent)) === canonTarget);
      }
      if (canonMatch) {
        const container = containerFromLabelEl(canonMatch);
        if (container) return container;
      }
    }
    return null;
  }

  const UNIVERSAL_CODE_SYNONYMS = ["isbn", "ean", "upc", "gtin", "codigo de barras", "codigo ean", "codigo upc"];

  function candidateLabelsFor(label) {
    const candidates = [label];
    if (UNIVERSAL_CODE_SYNONYMS.includes(normalize(label))) candidates.push("Código universal");
    return candidates;
  }

  function findSplitUnitField(container) {
    const input = container.querySelector(
      'input[type="text"]:not([role="combobox"]), input:not([type]):not([role="combobox"])'
    );
    if (!input) return null;
    const unitTrigger = container.querySelector('[role="combobox"]');
    if (!unitTrigger || unitTrigger === input) return null;
    return { input, unitTrigger };
  }

  function findSplitUnitFieldFromInput(inputEl, maxDepth) {
    let node = inputEl.parentElement;
    for (let i = 0; i < (maxDepth || 5) && node; i++, node = node.parentElement) {
      const splitField = findSplitUnitField(node);
      if (splitField && splitField.input === inputEl) return splitField;
    }
    return null;
  }

  function parseNumberUnit(value) {
    const m = String(value).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) return { number: String(value).trim(), unit: "" };
    return { number: m[1].replace(",", "."), unit: m[2].trim() };
  }

  function selectUnitOption(unit) {
    const items = Array.from(document.querySelectorAll('li[role="option"][data-key], li[data-key]'));
    if (!items.length) return false;
    const texts = items.map((li) => li.textContent);
    const { idx } = matchOptionIndex(texts, unit);
    if (idx === -1) return false;
    const li = items[idx];
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    li.click();
    return true;
  }

  async function fillSplitUnitField(splitField, attr) {
    const { number, unit } = parseNumberUnit(attr.value);
    setNativeValue(splitField.input, number);
    if (!unit) return "texto";

    splitField.unitTrigger.click();
    await new Promise((r) => setTimeout(r, 250));
    if (splitField.unitTrigger.getAttribute("aria-expanded") !== "true") {
      splitField.unitTrigger.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    const matched = selectUnitOption(unit);
    if (splitField.unitTrigger.getAttribute("aria-expanded") === "true") {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.click();
    }
    return matched ? "texto" : "texto-approx";
  }

  async function fillByContainer(container, attr) {
    const select = container.querySelector("select");
    if (select) {
      const r = fillSelect(select, attr.value, needsExactOption(attr));
      return r.ok ? (r.exact ? "select" : "select-approx") : "sin-match";
    }

    const editable = container.querySelector('[contenteditable="true"]');
    if (editable) {
      setContentEditableValue(editable, attr.value);
      return "texto";
    }

    const splitField = findSplitUnitField(container);
    if (splitField) return fillSplitUnitField(splitField, attr);

    const plainField = container.querySelector(
      'input[type="text"]:not([role="combobox"]), input:not([type]):not([role="combobox"]), textarea:not([role="combobox"])'
    );
    if (plainField && isVisible(plainField) && !plainField.readOnly && !plainField.disabled) {
      setNativeValue(plainField, attr.value);
      return "texto";
    }

    const toggleButtons = Array.from(container.querySelectorAll('button:not([role="combobox"])'));
    if (toggleButtons.length >= 2) {
      return clickToggleButton(toggleButtons, attr.value) ? "toggle" : "sin-match";
    }

    const trigger = container.querySelector('[role="combobox"]');
    if (!trigger) return "sin-match";
    trigger.click();
    await new Promise((r) => setTimeout(r, 250));
    if (trigger.getAttribute("aria-expanded") !== "true") {
      trigger.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    for (let wait = 0; wait < 4 && !document.querySelector('li[role="option"], li[data-key]'); wait++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const r = await clickAndesOption(attr.value, needsExactOption(attr));
    if (trigger.getAttribute("aria-expanded") === "true") {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.click();
    }
    if (!r.ok) return "sin-match";
    if (r.added) return "dropdown-added";
    return r.exact ? "dropdown" : "dropdown-approx";
  }

  const PROTECTED_LABELS = ["Tipo de lanzamiento"];

  function protectedTargetsFor(scopeRoot, labels) {
    const targets = new Set();
    for (const label of labels) {
      const container = findContainerForLabel(scopeRoot, label);
      if (container) targets.add(container);
    }
    return targets;
  }

  function isProtected(el, protectedTargets) {
    if (!el) return false;
    for (const target of protectedTargets) {
      if (target === el || target.contains(el)) return true;
    }
    return false;
  }

  /**
   * ¿El campo destino de este atributo está en la sección de la variante?
   * En la página de creación los campos de la variante viven dentro de
   * `.child-sections` (y los que tienen name vienen como
   * `CHILD[n].CODIGO[0]`) — eso cambia por dominio, así que se lee de la
   * página en vez de tener una lista fija. Busca el campo igual que
   * fillOne (por código y después por nombre), pero sin tocar nada. Si no
   * lo encuentra todavía, cuenta como padre (se completa primero).
   */
  function isChildTarget(scopeRoot, attr) {
    let target = attr.id ? findFieldByName(scopeRoot, attr.id) : null;
    if (!target) {
      for (const candidateLabel of candidateLabelsFor(attr.label)) {
        target = findContainerForLabel(scopeRoot, candidateLabel);
        if (target) break;
      }
    }
    if (!target) return false;
    return /^CHILD\[/.test(target.getAttribute("name") || "") || !!target.closest(".child-sections");
  }

  async function fillOne(scopeRoot, attr, filledTargets, protectedTargets) {
    if (attr.id) {
      const fieldByName = findFieldByName(scopeRoot, attr.id);
      if (fieldByName) {
        if (isProtected(fieldByName, protectedTargets)) return "protegido";
        if (filledTargets.has(fieldByName)) return "duplicado";
        const outcome = await fillByName(fieldByName, attr);
        if (outcome !== "sin-match") {
          filledTargets.add(fieldByName);
          return outcome;
        }
      }
    }
    for (const candidateLabel of candidateLabelsFor(attr.label)) {
      const container = findContainerForLabel(scopeRoot, candidateLabel);
      if (!container) continue;
      if (isProtected(container, protectedTargets)) return "protegido";
      if (filledTargets.has(container)) return "duplicado";
      const outcome = await fillByContainer(container, attr);
      if (outcome !== "sin-match") {
        filledTargets.add(container);
        return outcome;
      }
    }
    return "sin-match";
  }

  // Toast persistente (sin auto-cierre) — se usa para el resumen de pegado
  // y para avisos cortos ("no se puede usar acá", etc.).
  function showToast(text, detailLines) {
    document.getElementById("mlf-bk-toast")?.remove();
    const box = document.createElement("div");
    box.id = "mlf-bk-toast";
    box.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "max-width:380px", "max-height:70vh",
      "background:#1f2328", "color:#fff", "border-radius:8px", "padding:10px 12px",
      "z-index:2147483647", "font:500 12px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "box-shadow:0 2px 10px rgba(0,0,0,.3)", "display:flex", "flex-direction:column", "gap:6px",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:8px";
    const headerText = document.createElement("div");
    headerText.style.cssText = "flex:1";
    headerText.textContent = text;
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:13px;color:#9aa1ab;flex:0 0 auto";
    closeBtn.onclick = () => box.remove();
    header.appendChild(headerText);
    header.appendChild(closeBtn);
    box.appendChild(header);

    if (detailLines && detailLines.length) {
      const detail = document.createElement("div");
      detail.style.cssText =
        "overflow-y:auto;max-height:50vh;color:#cbd3dc;font-weight:400;line-height:1.5;border-top:1px solid #333a44;padding-top:6px";
      detailLines.forEach((line) => {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:4px";
        row.textContent = line;
        detail.appendChild(row);
      });
      box.appendChild(detail);
    }
    document.body.appendChild(box);
  }

  async function getClipboardText(copiedWithLabel) {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch (_) {
      /* el navegador bloqueó la lectura del portapapeles por script */
    }
    return window.prompt(`Pegá acá el texto copiado con '${copiedWithLabel}' (Ctrl+V):`, "");
  }

  /**
   * Motor de pegado compartido por "Comparator" y "Variante". Primero los
   * atributos comunes (parent/sin scope), después los "child" (los que
   * distinguen la variante) — así un campo compartido se completa por el
   * lado correcto antes de que un atributo de variante pueda pisarlo.
   * Reintenta una vez, después de una pausa corta, lo que dio "sin match"
   * en la primera pasada (dropdowns que todavía no montaron sus opciones).
   * `expand` solo tiene sentido para "Comparator" (pegado sin scope,
   * conviene abrir las secciones colapsadas antes de buscar campos) — para
   * "Variante" NO se usa: abrir/cerrar rompería el acordeón de a una
   * tarjeta (ver getScopeRoot).
   *
   * Devuelve { parts, detailLines } en vez de mostrar el toast directo —
   * así quien llama puede combinarlo con el resultado de pegar fotos en
   * un solo resumen (ver pasteImages / pasteWholeForm).
   */
  async function pasteAttributes(attributes, { scopeRoot, expand }) {
    if (expand) await expandCollapsedSections();
    const protectedTargets = protectedTargetsFor(scopeRoot, PROTECTED_LABELS);
    const results = {
      texto: 0, select: 0, dropdown: 0, toggle: 0,
      sinMatch: [], approx: [], added: [], duplicated: [], protegido: [],
    };
    const filledTargets = new Set();

    function attrLabel(attr) {
      return attr.id ? `${attr.label} (${attr.id})` : attr.label;
    }

    async function fillAttr(attr) {
      const outcome = await fillOne(scopeRoot, attr, filledTargets, protectedTargets);
      const label = attrLabel(attr);
      if (outcome === "protegido") {
        results.protegido.push(label);
      } else if (outcome === "duplicado") {
        results.duplicated.push(label);
      } else if (outcome === "sin-match") {
        results.sinMatch.push(label);
      } else if (outcome.endsWith("-approx")) {
        results[outcome.replace("-approx", "")]++;
        results.approx.push(label);
      } else if (outcome === "dropdown-added") {
        results.dropdown++;
        results.added.push(label);
      } else {
        results[outcome]++;
      }
      return outcome;
    }

    async function fillList(attrs) {
      const failed = [];
      for (const attr of attrs) {
        if ((await fillAttr(attr)) === "sin-match") failed.push(attr);
      }
      if (!failed.length) return;
      await new Promise((r) => setTimeout(r, 800));
      for (const attr of failed) {
        const idx = results.sinMatch.indexOf(attrLabel(attr));
        if (idx !== -1) results.sinMatch.splice(idx, 1);
        await fillAttr(attr);
      }
    }

    // Si el atributo no trae scope (fuentes sin separación padre/hijo,
    // como MO), lo decide la propia página de creación: ver isChildTarget.
    const isChild = (a) => (a.scope ? a.scope === "child" : isChildTarget(scopeRoot, a));
    const parentAttrs = attributes.filter((a) => !isChild(a));
    const childAttrs = attributes.filter(isChild);
    await fillList(parentAttrs);
    if (childAttrs.length) {
      await new Promise((r) => setTimeout(r, 400));
      await fillList(childAttrs);
    }

    const done = results.texto + results.select + results.dropdown + results.toggle;
    const parts = [`${done} campo(s) completados`];
    if (results.added.length) parts.push(`${results.added.length} agregados como opción nueva (confirmar)`);
    if (results.approx.length) parts.push(`${results.approx.length} aproximados (revisar)`);
    if (results.duplicated.length) parts.push(`${results.duplicated.length} repetidos (mismo campo que otro atributo)`);
    if (results.protegido.length) parts.push(`${results.protegido.length} protegidos (no se tocan)`);
    if (results.sinMatch.length) parts.push(`${results.sinMatch.length} sin match`);

    const detailLines = [];
    if (results.added.length) detailLines.push(`Agregados: ${results.added.join(", ")}`);
    if (results.approx.length) detailLines.push(`Revisar: ${results.approx.join(", ")}`);
    if (results.duplicated.length) detailLines.push(`Repetidos: ${results.duplicated.join(", ")}`);
    if (results.protegido.length) detailLines.push(`Protegidos (sin tocar): ${results.protegido.join(", ")}`);
    if (results.sinMatch.length) detailLines.push(`Sin match: ${results.sinMatch.join(", ")}`);

    return { parts, detailLines };
  }

  /**
   * Pegado de fotos, reutilizado por "Comparator"/"Variante" (cuando el
   * payload copiado también trae imágenes — ver showAttributePicker) y
   * por "Fotos" en solitario. Devuelve { parts, detailLines } igual que
   * pasteAttributes, para poder combinar los dos resúmenes en un solo
   * toast cuando se pegan juntos.
   */
  async function pasteImages(urls, root = document) {
    const input = findPhotoInput(root);
    if (!input) {
      return {
        parts: ["fotos: sin campo visible"],
        detailLines: ["Fotos: abrí la sección de fotos de la variante y volvé a correr esto."],
      };
    }
    const results = await Promise.allSettled(urls.map((url, i) => urlToFile(url, i)));
    const files = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") files.push(r.value);
      else failed.push(i + 1);
    });
    if (!files.length) {
      return {
        parts: ["0 fotos pegadas"],
        detailLines: failed.length ? [`Fotos: no se pudo descargar ninguna (fallaron: ${failed.join(", ")})`] : [],
      };
    }
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      parts: [`${files.length} foto(s) pegada(s)`],
      detailLines: failed.length ? [`Fotos: ${failed.length} fallaron (foto ${failed.join(", ")})`] : [],
    };
  }

  // ============================================================
  // Comparator — extracción del lado "copiar"
  // ============================================================

  const PARENT_GROUP_TITLES = ["Identificadores Padre", "Otros atributos"];
  const CHILD_GROUP_TITLES = ["Identificadores Hijo", "Identificadores de Producto"];

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

  function isDistinctiveValue(value) {
    const v = value.trim();
    if (/^-?\d+([.,]\d+)?$/.test(v)) return v.replace(/[^0-9]/g, "").length >= 2;
    return v.length >= 4;
  }

  const VALUE_DEDUP_EXEMPT_LABELS = ["marca", "fabricante"];

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

  function extractFromGroupedComparatorTable() {
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
          if (isExcludedAttrId(id)) return;
          const label = (cells[0].querySelector(".attr-row__name")?.textContent || "").trim() || id;
          const value = (cells[1].querySelector(".attr-row__value")?.textContent || "").trim();
          if (!label || !value) return;
          out.push(isChildGroup ? { id, label, value, scope: "child" } : { id, label, value });
        });
      });
    });
    return out;
  }

  function extractFromFlatComparatorTable() {
    const rows = document.querySelectorAll("tr.attr-row");
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

  function extractComparatorAttrGroups() {
    const grouped = extractFromGroupedComparatorTable();
    if (grouped.length) return grouped;
    return extractFromFlatComparatorTable();
  }

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

  function splitMultiValueAttr(attr) {
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
      out.push({ id: attr.id, label: attr.label, value, multiValue: true, scope: attr.scope });
    }
    return out.length >= 2 ? out : [attr];
  }

  function isEmptyPlaceholder(value) {
    return /^-+$/.test(value.trim());
  }

  function isComparatorPresent() {
    return !!document.querySelector(".comparator-result__attr-group, .attr-row, table.comparator-result_table");
  }

  // ============================================================
  // Variante — extracción child-only del lado "copiar"
  // ============================================================

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

  // ============================================================
  // Fotos — extracción del lado "copiar"
  // ============================================================

  function upscaleImageUrl(url) {
    return url.replace(/-O(\.[a-zA-Z0-9]+)(\?[^#]*)?$/, "-F$1$2");
  }

  function extractFromInternalCarousel() {
    const scope = document.querySelector(".img-carousel");
    if (!scope) return [];
    const thumbs = scope.querySelectorAll(".img-carousel__thumb-img");
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

  function extractFromMLGallery() {
    const figs = document.querySelectorAll(".ui-pdp-gallery__figure, [class*='gallery__figure']");
    const out = [];
    const seen = new Set();
    figs.forEach((fig) => {
      if (fig.matches(".clip-wrapper") || fig.querySelector(".clip-wrapper")) return;
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

  function extractFallbackSingleImage() {
    const scope = document.querySelector(".img-carousel");
    const main = scope?.querySelector(".img-carousel__main");
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

  // ============================================================
  // Fotos — lado "pegar"
  // ============================================================

  function findPhotoInput(root = document) {
    const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
    return inputs.find((el) => isVisible(el) && !el.disabled) || null;
  }

  async function urlToFile(url, index) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const blob = await resp.blob();
    const ext = (blob.type && blob.type.split("/")[1]) || "webp";
    return new File([blob], `foto-${index + 1}.${ext}`, { type: blob.type || "image/webp" });
  }

  // ============================================================
  // UI: overlay de atributos (checkboxes + valor editable) — compartido
  // entre "Comparator" y "Variante" al copiar.
  // ============================================================

  /**
   * Header compartido por los overlays de "copiar" (showAttributePicker,
   * runFotosCopy): título + flechita "←" para volver al menú (por si
   * clickeaste la opción que no era — ej. "Copiar Comparator" cuando en
   * realidad solo querías "Copiar Fotos") + "✕" para cerrar sin volver a
   * nada. onBack cierra cualquier overlay/toast abierto antes de reabrir
   * el menú, así no queda nada viejo tapando atrás.
   */
  function buildOverlayHeader(titleText) {
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;gap:8px";

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = "←";
    backBtn.title = "Volver al menú";
    backBtn.style.cssText =
      "border:none;background:none;cursor:pointer;font-size:15px;color:#6b7280;flex:0 0 auto;padding:0;line-height:1";
    backBtn.onclick = () => {
      document.getElementById("mlf-bk-overlay")?.remove();
      document.getElementById("mlf-bk-fotos-overlay")?.remove();
      buildMenu();
    };

    const titleEl = document.createElement("div");
    titleEl.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    titleEl.textContent = titleText;

    left.appendChild(backBtn);
    left.appendChild(titleEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280;flex:0 0 auto";
    closeBtn.onclick = () => {
      document.getElementById("mlf-bk-overlay")?.remove();
      document.getElementById("mlf-bk-fotos-overlay")?.remove();
    };

    header.appendChild(left);
    header.appendChild(closeBtn);
    return header;
  }

  // Largo máximo por atributo. Los "padre" (identifican al producto) tienen
  // un tope más corto; Título y Descripción no tienen tope; el resto usa
  // el tope general. Pasarse solo avisa en rojo, no bloquea el copiado.
  const PARENT_ATTR_LABELS = ["fabricante", "marca", "linea", "modelo", "modelo alfanumerico"];
  const PARENT_ATTR_MAX_LENGTH = 30;
  const GENERAL_ATTR_MAX_LENGTH = 75;
  const NO_LENGTH_LIMIT_LABELS = ["titulo", "descripcion"];

  function normalizeAttrLabel(label) {
    return String(label || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function maxLengthForLabel(label) {
    const key = normalizeAttrLabel(label);
    if (NO_LENGTH_LIMIT_LABELS.includes(key)) return Infinity;
    return PARENT_ATTR_LABELS.includes(key) ? PARENT_ATTR_MAX_LENGTH : GENERAL_ATTR_MAX_LENGTH;
  }

  function parentLengthWarning(label, value) {
    const max = maxLengthForLabel(label);
    const len = String(value || "").trim().length;
    return len > max
      ? `⚠ Supera los ${max} caracteres (${len}) — acortalo antes de pegar.`
      : "";
  }

  function showAttributePicker({
    headerText, attributes, images = [], kind, notice, emptyText, copyButtonText,
  }) {
    const OVERLAY_ID = "mlf-bk-overlay";
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "width:340px", "max-height:80vh",
      "background:#fff", "color:#1f2328", "border-radius:10px",
      "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
      "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "display:flex", "flex-direction:column", "overflow:hidden",
    ].join(";");

    overlay.appendChild(buildOverlayHeader(headerText));

    if (notice) {
      const noticeEl = document.createElement("div");
      noticeEl.style.cssText =
        "padding:8px 12px;background:#fff7e6;color:#8a5a00;font-size:12px;line-height:1.4;border-bottom:1px solid #f1e2bd";
      noticeEl.textContent = notice;
      overlay.appendChild(noticeEl);
    }

    if (!attributes.length && !images.length) {
      const msg = document.createElement("div");
      msg.style.cssText = "padding:16px 14px;color:#374151;line-height:1.5";
      msg.textContent = emptyText;
      overlay.appendChild(msg);
      document.body.appendChild(overlay);
      return;
    }

    const list = document.createElement("div");
    list.style.cssText = "overflow-y:auto;padding:4px 8px;flex:1";

    const checkboxes = [];
    const valueEls = [];
    attributes.forEach((attr, idx) => {
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

      const lenWarn = document.createElement("div");
      lenWarn.style.cssText =
        "margin-top:3px;font-size:11px;color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:5px;padding:3px 6px;display:inline-block";
      const refreshLenWarn = () => {
        const msg = parentLengthWarning(attr.label, valueEl.textContent);
        lenWarn.textContent = msg;
        lenWarn.style.display = msg ? "inline-block" : "none";
      };
      refreshLenWarn();
      valueEl.addEventListener("input", refreshLenWarn);
      text.appendChild(lenWarn);

      if (attr.possibleDuplicate) {
        const warn = document.createElement("div");
        warn.style.cssText =
          "margin-top:3px;font-size:11px;color:#8a5a00;background:#fff7e6;border:1px solid #f1e2bd;border-radius:5px;padding:3px 6px;display:inline-block";
        warn.textContent = "⚠ Posible repetido — " + attr.duplicateReason;
        text.appendChild(warn);
      }

      // Línea informativa opcional (hoy solo la usa Fallas para mostrar el
      // valor original). Comp, MO y Variante no la pasan y no cambian.
      if (attr.hint) {
        const hintEl = document.createElement("div");
        hintEl.style.cssText = "margin-top:3px;font-size:11px;color:#6b7280";
        hintEl.textContent = attr.hint;
        text.appendChild(hintEl);
      }

      row.appendChild(cb);
      row.appendChild(text);
      list.appendChild(row);
    });

    // Fotos opcionales, abajo de los atributos. Hoy solo las pasa Fallas.
    const imageCheckboxes = [];
    if (images.length) {
      const imagesHeading = document.createElement("div");
      imagesHeading.style.cssText =
        "padding:10px 4px 4px;font-weight:600;font-size:12px;color:#1f2328;border-top:1px solid #f1f2f4;margin-top:4px";
      imagesHeading.textContent = "Fotos (" + images.length + ")";
      list.appendChild(imagesHeading);

      const imagesGrid = document.createElement("div");
      imagesGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:6px 4px";
      images.forEach((image, idx) => {
        const cell = document.createElement("label");
        cell.style.cssText =
          "position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;cursor:pointer;display:block";
        const img = document.createElement("img");
        img.src = image.thumb;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        cell.appendChild(img);
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.idx = String(idx);
        cb.style.cssText = "position:absolute;top:3px;left:3px;cursor:pointer";
        imageCheckboxes.push(cb);
        cell.appendChild(cb);
        imagesGrid.appendChild(cell);
      });
      list.appendChild(imagesGrid);
    }

    const footer = document.createElement("div");
    footer.style.cssText = "padding:8px 12px 12px;border-top:1px solid #e5e7eb";

    const status = document.createElement("div");
    status.style.cssText = "font-size:12px;color:#6b7280;min-height:16px;margin-bottom:6px";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = copyButtonText;
    copyBtn.style.cssText =
      "width:100%;padding:8px 10px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer";

    copyBtn.onclick = async () => {
      const selected = checkboxes
        .filter((cb) => cb.checked)
        .map((cb) => {
          const idx = Number(cb.dataset.idx);
          return { ...attributes[idx], value: valueEls[idx].textContent.trim() };
        })
        .filter((attr) => attr.value.length > 0 || attr.action === "Eliminado");
      const selectedImages = imageCheckboxes
        .filter((cb) => cb.checked)
        .map((cb) => images[Number(cb.dataset.idx)].url);
      if (!selected.length && !selectedImages.length) {
        status.textContent = images.length ? "Seleccioná al menos un atributo o una foto." : "Seleccioná al menos un atributo.";
        return;
      }
      const payload = JSON.stringify({
        v: 1,
        kind,
        ts: Date.now(),
        source: location.href,
        images: selectedImages.length ? selectedImages : undefined,
        attributes: selected.map(({ id, label, value, multiValue, scope, action, original }) => ({
          id, label, value, multiValue, scope, action, original,
        })),
      });
      const countLabel = [
        selected.length || !selectedImages.length ? `${selected.length} atributo(s)` : null,
        selectedImages.length ? `${selectedImages.length} foto(s)` : null,
      ].filter(Boolean).join(" + ");
      try {
        await navigator.clipboard.writeText(payload);
        status.textContent = `Copiado (${countLabel}). Andá a la herramienta interna y usá "MLF V2 → Pegar".`;
      } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.cssText = "position:fixed;top:-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        status.textContent = ok
          ? `Copiado (${countLabel}). Usá "MLF V2 → Pegar".`
          : "No se pudo copiar. Probá seleccionar manualmente.";
      }
    };

    footer.appendChild(status);
    footer.appendChild(copyBtn);

    overlay.appendChild(list);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
  }

  // ============================================================
  // Acciones — Comparator
  // ============================================================

  function runComparatorCopy() {
    const usingComparator = isComparatorPresent();
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
        .flatMap(splitMultiValueAttr)
        .filter((attr) => !isEmptyPlaceholder(attr.value))
    );

    const variantSiblings = detectVariantSiblings();
    let notice = null;
    if (variantSiblings.length > 1) {
      const current = variantSiblings.find((v) => v.selected);
      const names = variantSiblings.map((v) => v.label).join(", ");
      notice =
        `Esta publicación tiene ${variantSiblings.length} variantes de color (${names}). ` +
        `Estás copiando: ${current ? current.label : "la seleccionada"}. Cambiá el color arriba y ` +
        `volvé a correr "Comparator" para cada una.`;
    }

    showAttributePicker({
      headerText: "MLF — Atributos (" + attributes.length + ")",
      attributes,
      notice,
      emptyText: "No se encontraron atributos en esta página.",
      copyButtonText: "Copiar seleccionados",
      kind: "comp",
    });
  }

  // Pegado "a toda la ficha" (sin acordeón de a una tarjeta) — lo comparten
  // Comp y MO (y los datos sin tipo de versiones viejas).
  async function pasteWholeForm(payload) {
    const attributes = (payload && payload.attributes) || [];
    const images = (payload && payload.images) || [];
    if (!attributes.length && !images.length) {
      showToast("No hay atributos ni fotos en los datos pegados.");
      return;
    }
    const attrResult = attributes.length
      ? await pasteAttributes(attributes, { scopeRoot: document, expand: true })
      : { parts: [], detailLines: [] };
    const imgResult = images.length ? await pasteImages(images) : { parts: [], detailLines: [] };
    showToast(
      [...attrResult.parts, ...imgResult.parts].join(" · "),
      [...attrResult.detailLines, ...imgResult.detailLines]
    );
  }

  // ============================================================
  // Acciones — MO (visor de sugerencias: "Atributos propuestos")
  // ============================================================

  // La tabla de MO no separa padre/hijo — los atributos salen sin scope y
  // al pegar decide la página de creación (ver isChildTarget).
  function extractFromMOPage() {
    const out = [];
    const title = (document.querySelector(".suggestion-title")?.textContent || "").trim();
    if (title) out.push({ label: "Título", value: title });
    document.querySelectorAll("table.changes-table tbody tr").forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;
      const id = (cells[0].querySelector(".attr-id")?.textContent || "").trim();
      const label = (cells[0].querySelector("strong")?.textContent || "").trim();
      const value = (cells[1].textContent || "").trim();
      if (!label || !value || isExcludedAttrId(id)) return;
      out.push(id ? { id, label, value } : { label, value });
    });
    const description = (document.querySelector(".description-preview")?.textContent || "").trim();
    if (description) out.push({ label: "Descripción", value: description });
    return out;
  }

  function runMOCopy() {
    if (!document.querySelector("table.changes-table")) {
      showToast('No encontré "Atributos propuestos" — usá "Copiar MO" parado en la sugerencia.');
      return;
    }
    const attributes = dedupeByLabel(
      extractFromMOPage()
        .flatMap(splitCombinedDimensions)
        .flatMap(splitMultiValueAttr)
        .filter((attr) => !isEmptyPlaceholder(attr.value))
    );
    showAttributePicker({
      headerText: "MLF — Atributos MO (" + attributes.length + ")",
      attributes,
      notice: null,
      emptyText: "No se encontraron atributos en esta sugerencia.",
      copyButtonText: "Copiar seleccionados",
      kind: "mo",
    });
  }

  // ============================================================
  // Acciones — Variante
  // ============================================================

  function runVarianteCopy() {
    if (!isComparatorPresent()) {
      showAttributePicker({
        headerText: "MLF — Copiar Variante",
        attributes: [],
        emptyText:
          'Esto necesita el comparador de fichas en pantalla (el mismo que usa "Comparator") — no funciona parado en una publicación suelta.',
      });
      return;
    }

    const childAttrs = extractChildAttrs();
    if (!childAttrs.length) {
      showAttributePicker({
        headerText: "MLF — Copiar Variante",
        attributes: [],
        emptyText:
          "Esta publicación no tiene atributos que distingan variantes (Color, Memoria, GTIN...) — no se puede usar este botón acá.",
      });
      return;
    }

    const attributes = [...extractComparatorTitleAndDescription(), ...childAttrs];
    showAttributePicker({
      headerText: "MLF — Copiar Variante",
      attributes,
      emptyText: "",
      copyButtonText: "Copiar variante",
      kind: "variante",
    });
  }

  async function pasteVariante(payload) {
    const attributes = (payload && payload.attributes) || [];
    const images = (payload && payload.images) || [];
    if (!attributes.length && !images.length) {
      showToast("No hay atributos ni fotos en los datos pegados.");
      return;
    }
    // Se apunta a la tarjeta que esté abierta EN ESTE MOMENTO (ver
    // getScopeRoot) — sin auto-expandir nada, para no romper el acordeón
    // de a una tarjeta a la vez.
    const attrResult = attributes.length
      ? await pasteAttributes(attributes, { scopeRoot: getScopeRoot(), expand: false })
      : { parts: [], detailLines: [] };
    const imgResult = images.length ? await pasteImages(images) : { parts: [], detailLines: [] };
    showToast(
      [...attrResult.parts, ...imgResult.parts].join(" · "),
      [...attrResult.detailLines, ...imgResult.detailLines]
    );
  }

  // ============================================================
  // Acciones — Fotos
  // ============================================================

  function runFotosCopy() {
    const OVERLAY_ID = "mlf-bk-fotos-overlay";
    document.getElementById(OVERLAY_ID)?.remove();

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

    const header = buildOverlayHeader("MLF — Fotos (" + images.length + ")");

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
      const payload = JSON.stringify({ v: 1, kind: "fotos", ts: Date.now(), source: location.href, images: selected });
      try {
        await navigator.clipboard.writeText(payload);
        status.textContent = `Copiadas (${selected.length}). Andá a la herramienta interna y usá "MLF V2 → Pegar".`;
      } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.cssText = "position:fixed;top:-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        status.textContent = ok
          ? `Copiadas (${selected.length}). Usá "MLF V2 → Pegar".`
          : "No se pudo copiar. Probá seleccionar manualmente.";
      }
    };

    footer.appendChild(status);
    footer.appendChild(copyBtn);

    overlay.appendChild(header);
    overlay.appendChild(list);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
  }

  async function pasteFotos(payload) {
    const urls = payload && payload.images;
    if (!urls || !urls.length) {
      showToast("No hay fotos en los datos pegados.");
      return;
    }
    showToast(`Descargando ${urls.length} foto(s)...`);
    const result = await pasteImages(urls);
    showToast(result.parts.join(" · "), result.detailLines);
  }

  // ============================================================
  // Acciones — Fallas (sugerencias "Sin impacto automático")
  // ============================================================

  function cleanText(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Cada campo muestra su nivel y su código ("CHILD_PK - LENGTH"), tanto en
  // la sugerencia como en BC. El código es lo único que no cambia por sitio.
  function fieldCode(field) {
    return (cleanText(field.querySelector(".cp-form-field__hierarchy")).match(/([A-Z0-9_]+)$/) || [])[1] || "";
  }

  // Valor sugerido, según cómo lo muestre el control. Además del recuadro,
  // el control trae leyendas de ayuda y textos ocultos para lectores de
  // pantalla ("number_unit_control"): no son parte del valor, por eso no
  // alcanza con leer el textContent.
  function readReviewValue(field) {
    const control = field.querySelector(".cp-form-field__control");
    if (!control) return "";
    const tags = Array.from(control.querySelectorAll(".andes-tag__label")).map(cleanText).filter(Boolean);
    if (tags.length) return tags.join(", ");
    const number = cleanText(control.querySelector(".cp-custom-number-unit-field__number"));
    if (number) {
      return [number, cleanText(control.querySelector(".cp-custom-number-unit-field__unit"))].filter(Boolean).join(" ");
    }
    const readOnlyText = cleanText(control.querySelector(".cp-custom-text-field"));
    if (readOnlyText) return readOnlyText;
    const input = control.querySelector("input,textarea");
    if (input) {
      const unit = cleanText(control.querySelector(".andes-dropdown__display-values"));
      return [input.value.trim(), unit].filter(Boolean).join(" ");
    }
    const clone = control.cloneNode(true);
    clone
      .querySelectorAll(
        ".andes-visually-hidden, .andes-helper, .andes-form-control__bottom, .andes-typography--color-secondary"
      )
      .forEach((el) => el.remove());
    const text = cleanText(control.querySelector(".andes-dropdown__display-values")) || cleanText(clone);
    return /^selec+ionar/i.test(text) ? "" : text;
  }

  // Solo interesan las correcciones aprobadas que el sistema avisa que no
  // se aplican solas. Las rechazadas no traen el aviso y quedan afuera. El
  // bloque de fotos usa el mismo contenedor pero no tiene botones de
  // aprobar: se trata aparte.
  function extractManualImpactCorrections() {
    const attributes = [];
    const notes = [];
    const unreadable = [];
    document.querySelectorAll(".review-input-decorator__wrapper").forEach((card) => {
      if (!card.querySelector(".review-input-decorator__manual-impact")) return;
      if (!card.querySelector(".review-action-buttons__approve--selected")) return;

      const freeText = card.querySelector(".review-additional-suggestions__field textarea");
      if (freeText) {
        const note = (freeText.value || freeText.textContent || "").trim();
        if (note) notes.push(note);
        return;
      }

      const field = card.querySelector(".cp-form-field");
      if (!field) return;
      const labelEl = field.querySelector(".cp-form-field__label");
      const label = (labelEl?.getAttribute("title") || cleanText(labelEl)).replace(/\s*\(Obligatorio\)\s*$/i, "");
      const id = fieldCode(field);
      const action = cleanText(card.querySelector(".review-input-decorator__correction-meta .andes-badge__content"));
      const originalEl = card.querySelector(".review-input-decorator__original-value")?.cloneNode(true);
      originalEl?.querySelector(".review-input-decorator__original-label")?.remove();
      const original = cleanText(originalEl);
      const value = action === "Eliminado" ? "" : readReviewValue(field);

      // Sí/No todavía no tiene una captura que muestre cómo se marca el
      // valor elegido: mejor avisar que pegar algo inventado.
      if (!id || field.classList.contains("cp-form-field--boolean") || (!value && action !== "Eliminado")) {
        unreadable.push(label || "Campo sin nombre");
        return;
      }
      const hint = action === "Eliminado"
        ? `Se va a vaciar. Original: ${original || "(vacío)"}`
        : `${action}. Original: ${original || "(vacío)"}`;
      attributes.push({ id, label, value, action, original, hint });
    });
    return { attributes, notes, unreadable };
  }

  // Las miniaturas vienen en 160px (-T). Con -F el CDN entrega la foto
  // completa, igual que hace upscaleImageUrl con las -O.
  function fullSizeReviewImage(url) {
    return url.replace(/-T(\.[a-zA-Z0-9]+)(\?[^#]*)?$/, "-F$1$2");
  }

  // Cada aviso "Foto N: Aprobado" tiene al lado el de "Sin impacto
  // automático" si esa foto no se aplicó sola. Se copian solo las agregadas:
  // las reordenadas ya están en el producto y se repetirían. La misma foto
  // puede venir dos veces en la sugerencia, por eso se filtra por URL.
  function extractManualImpactPhotos() {
    const manualPhotos = new Set();
    let needsReorder = false;
    document.querySelectorAll(".andes-card--tertiary").forEach((card) => {
      if (!card.nextElementSibling?.matches(".review-input-decorator__manual-impact")) return;
      const text = cleanText(card.querySelector(".andes-badge__content"));
      if (/^Reorden de imagen: Aprobado/i.test(text)) needsReorder = true;
      const match = text.match(/^(Foto \d+): Aprobado/i);
      if (match) manualPhotos.add(match[1]);
    });

    const images = [];
    const seen = new Set();
    let hasNewCover = false;
    document.querySelectorAll("button.review-picture-item--approved").forEach((item) => {
      if (!manualPhotos.has(item.getAttribute("aria-label"))) return;
      if (!item.querySelector(".review-picture-item__action-pill--add")) return;
      const thumb = item.querySelector(".review-picture-item__thumbnail")?.src;
      if (!thumb) return;
      if (item.querySelector(".review-picture-item__portada-clip")) hasNewCover = true;
      const url = fullSizeReviewImage(thumb);
      if (seen.has(url)) return;
      seen.add(url);
      images.push({ url, thumb });
    });
    return { images, needsReorder, hasNewCover };
  }

  function runFallasCopy() {
    if (!document.querySelector(".review-form-content")) {
      showToast('No encontré la sugerencia: usá "Copiar Fallas" parado en la herramienta de sugerencias.');
      return;
    }
    const { attributes, notes, unreadable } = extractManualImpactCorrections();
    const { images, needsReorder, hasNewCover } = extractManualImpactPhotos();
    const notices = [];
    if (needsReorder) notices.push("Reordenar a mano: seguí el orden de la grilla de fotos de la sugerencia");
    if (hasNewCover) notices.push("Una foto nueva va de portada: revisá que quede primera en BC");
    if (notes.length) notices.push(`Leer, no se pega: ${notes.join(" / ")}`);
    if (unreadable.length) notices.push(`Revisar a mano: ${unreadable.join(", ")}`);
    showAttributePicker({
      headerText: "MLF — Fallas (" + (attributes.length + images.length) + ")",
      attributes,
      images,
      kind: "fallas",
      notice: notices.join(" · ") || null,
      emptyText: "No hay atributos ni fotos para copiar en esta sugerencia.",
      copyButtonText: "Copiar seleccionados",
    });
  }

  // Las variantes de BC son `div#child-N`. La que importa es la que el
  // colaborador dejó abierta: elegirla queda de su lado, no se adivina.
  function openVariantCards() {
    return Array.from(document.querySelectorAll("[id^='child-']"))
      .filter((el) => /^child-\d+$/.test(el.id))
      .filter((el) => {
        const toggle = el.querySelector(".expandible-card__header [aria-expanded]") || el.querySelector("[aria-expanded]");
        return toggle?.getAttribute("aria-expanded") === "true";
      });
  }

  // Búsqueda exacta: por código y, para los campos que no son
  // `.cp-form-field` (Título, por ejemplo), por name. Sin parecidos por
  // nombre: acá el producto ya tiene datos y un match dudoso pisaría uno bueno.
  function findBcField(root, id) {
    if (!root) return null;
    return (
      Array.from(root.querySelectorAll(".cp-form-field")).find((field) => fieldCode(field) === id) ||
      root.querySelector(`[name="${id}"], [name^="${id}["], [name*=".${id}["], [name$=".${id}"]`)
    );
  }

  function isMultiValueTarget(target) {
    return !!target.closest(".cp-form-field--multivalued, .cp-custom-multivalue-field");
  }

  // Solo vacía campos de texto o número. En desplegables y Sí/No no sabemos
  // si BC acepta dejarlos sin opción: esos quedan para hacerlos a mano. En
  // número + unidad se borra solo el número; la unidad queda como estaba.
  function clearBcField(target) {
    const input = target.matches("input,textarea")
      ? target
      : target.matches(".cp-form-field--string, .cp-form-field--numeric, .cp-form-field--number_unit")
        ? target.querySelector('input:not([role="combobox"]), textarea:not([role="combobox"])')
        : null;
    if (!input || input.readOnly || input.disabled || !isVisible(input)) return false;
    setNativeValue(input, "");
    return input.value === "";
  }

  // Valor que BC muestra hoy en un campo. Se lee de la pantalla, no de lo
  // que se intentó escribir: así el resumen dice lo que realmente quedó.
  function readBcValue(field) {
    const tags = Array.from(field.querySelectorAll(".andes-tag__label")).map(cleanText).filter(Boolean);
    if (tags.length) return tags.join(", ");
    const booleanControl = field.querySelector(".cp-boolean-control");
    if (booleanControl) return cleanText(booleanControl.querySelector("button:not(.andes-button--mute)"));
    const display = cleanText(field.querySelector(".andes-dropdown__display-values"));
    if (field.matches(".cp-form-field--string, .cp-form-field--numeric, .cp-form-field--number_unit")) {
      const number = field.querySelector('input:not([role="combobox"]), textarea')?.value.trim();
      return number ? [number, display].filter(Boolean).join(" ") : "";
    }
    return /^selec+ionar/i.test(display) ? "" : display;
  }

  // Foto de todos los campos de las zonas que se van a tocar. Comparar la de
  // antes con la de después detecta si BC cambió algo que nadie pidió.
  function snapshotBc(...roots) {
    const values = new Map();
    roots.filter(Boolean).forEach((root) => {
      root.querySelectorAll(".cp-form-field").forEach((field) => {
        const id = fieldCode(field);
        if (!id) return;
        const labelEl = field.querySelector(".cp-form-field__label");
        const label = (labelEl?.getAttribute("title") || cleanText(labelEl)).replace(/\s*\(Obligatorio\)\s*$/i, "");
        values.set(id, { label, value: readBcValue(field) });
      });
      root.querySelectorAll("input[name],textarea[name]").forEach((el) => {
        const id = (el.name.match(/([A-Z0-9_]+)(\[\d+\])?$/) || [])[1];
        if (id && !el.closest(".cp-form-field")) values.set(id, { label: id, value: el.value.trim() });
      });
      root.querySelectorAll(".cp-custom-multivalue-field").forEach((el) => {
        if (el.closest(".cp-form-field")) return;
        const tags = Array.from(el.querySelectorAll(".andes-tag__label")).map(cleanText);
        const label = el.getAttribute("aria-label") || "Varios valores";
        values.set(label, { label, value: tags.join(", ") });
      });
      root.querySelectorAll('[contenteditable="true"]').forEach((el) => {
        values.set("Descripción", { label: "Descripción", value: cleanText(el) });
      });
    });
    return values;
  }

  function sameValue(a, b) {
    const comparable = (text) => normalize(text).replace(/,/g, ".").replace(/\s+/g, "");
    return comparable(a) === comparable(b);
  }

  const FALLAS_NOT_WRITTEN = {
    "sin-match": "No se encontró en BC",
    "no-en-lista": "BC no tiene ese valor en la lista o no dejó escribirlo: cargar a mano",
    manual: "Varios valores: cargar a mano",
    pendiente: "Vaciar a mano",
    protegido: "Campo protegido",
  };

  async function pasteFallas(attributes, images) {
    const parent = document.getElementById("parent");
    if (!parent) {
      return { blocked: 'No encontré el formulario: usá "Pegar Fallas" parado en BC.' };
    }
    await expandCollapsedSections(parent);

    // Se revisa antes de escribir para no dejar un pegado por la mitad.
    const needsVariant = images.length > 0 || attributes.some((attr) => !findBcField(parent, attr.id));
    const variants = openVariantCards();
    if (needsVariant && variants.length !== 1) {
      return {
        blocked: variants.length
          ? "Hay más de una variante abierta: dejá abierta solo la que corresponde y volvé a pegar."
          : "Abrí la variante que corresponde y volvé a pegar. No se pegó nada.",
      };
    }
    if (needsVariant) await expandCollapsedSections(variants[0]);

    const variant = variants.length === 1 ? variants[0] : null;
    const before = snapshotBc(parent, variant);
    const protectedTargets = protectedTargetsFor(document, PROTECTED_LABELS);
    const outcomes = new Map();

    // El campo se busca recién al escribirlo: BC puede volver a dibujar el
    // formulario después de cada cambio y dejar vieja una referencia anterior.
    async function fillAttr(attr) {
      const target = findBcField(parent, attr.id) || findBcField(openVariantCards()[0], attr.id);
      if (!target) return "sin-match";
      if (isProtected(target, protectedTargets)) return "protegido";
      if (isMultiValueTarget(target)) return "manual";
      const current = target.matches(".cp-form-field") ? readBcValue(target) : target.value.trim();
      if (sameValue(current, attr.action === "Eliminado" ? "" : attr.value)) return "ya-estaba";
      if (attr.action === "Eliminado") return clearBcField(target) ? "vaciado" : "pendiente";
      // Sobre un producto real, una opción parecida es un dato equivocado:
      // sin coincidencia exacta se avisa en vez de elegir la más cercana.
      const exactAttr = { ...attr, exactOption: true };
      const outcome = target.matches(".cp-form-field")
        ? await fillByContainer(target, exactAttr)
        : await fillByName(target, exactAttr);
      return outcome === "sin-match" ? "no-en-lista" : outcome;
    }

    async function fillList(attrs) {
      const failed = [];
      for (const attr of attrs) {
        const outcome = await fillAttr(attr);
        outcomes.set(attr, outcome);
        if (outcome === "sin-match" || outcome === "no-en-lista") failed.push(attr);
      }
      if (!failed.length) return;
      await new Promise((r) => setTimeout(r, 800));
      for (const attr of failed) outcomes.set(attr, await fillAttr(attr));
    }

    // Primero lo general: completarlo puede resetear la sección de variante.
    const generalAttrs = attributes.filter((attr) => findBcField(parent, attr.id));
    const variantAttrs = attributes.filter((attr) => !findBcField(parent, attr.id));
    await fillList(generalAttrs);
    if (variantAttrs.length) {
      await new Promise((r) => setTimeout(r, 400));
      await fillList(variantAttrs);
    }

    // Las fotos son de la variante. Se vuelve a pedir la tarjeta porque si
    // BC la cerró, pasteImages buscaría en toda la página.
    const photoLines = [];
    const photoWarnings = [];
    if (images.length) {
      const openVariant = openVariantCards()[0];
      if (!openVariant) {
        photoWarnings.push("Fotos: la variante se cerró, abrila y pegá de nuevo.");
      } else {
        const imageResult = await pasteImages(images, openVariant);
        photoLines.push(...imageResult.parts);
        photoWarnings.push(...imageResult.detailLines);
      }
    }

    await new Promise((r) => setTimeout(r, 300));
    const after = snapshotBc(parent, variant ? openVariantCards()[0] : null);

    const rows = attributes.map((attr) => {
      const outcome = outcomes.get(attr);
      const oldValue = before.get(attr.id)?.value ?? "";
      const newValue = after.get(attr.id)?.value ?? "";
      const expected = attr.action === "Eliminado" ? "" : attr.value;
      let warning = FALLAS_NOT_WRITTEN[outcome] || "";
      const alreadySet = outcome === "ya-estaba";
      if (!warning && !sameValue(newValue, expected)) warning = `Quedó distinto a lo pedido: ${expected || "(vacío)"}`;
      else if (!warning && outcome === "dropdown-added") warning = "Se agregó como opción nueva: revisá que esté bien escrito";
      else if (!warning && !alreadySet && attr.original && !sameValue(oldValue, attr.original)) {
        warning = `La sugerencia decía original ${attr.original}`;
      }
      return { label: attr.label, oldValue, newValue, warning, alreadySet, changed: !sameValue(oldValue, newValue) };
    });

    const pastedIds = new Set(attributes.map((attr) => attr.id));
    const others = [];
    new Set([...before.keys(), ...after.keys()]).forEach((id) => {
      if (pastedIds.has(id)) return;
      const oldField = before.get(id);
      const newField = after.get(id);
      if (sameValue(oldField?.value ?? "", newField?.value ?? "") && oldField && newField) return;
      others.push({
        label: (oldField || newField).label,
        oldValue: oldField?.value ?? "",
        newValue: newField ? newField.value : "(ya no aparece)",
      });
    });
    return { rows, others, photoLines, photoWarnings };
  }

  // Reemplaza al toast en Fallas. Si todo salió bien queda en una línea para
  // no molestar, y se abre solo cuando hay algo para revisar.
  function showFallasSummary({ rows, others, photoLines, photoWarnings }) {
    const changed = rows.filter((row) => row.changed).length;
    const alreadySet = rows.filter((row) => row.alreadySet).length;
    const toReview = rows.filter((row) => row.warning).length + others.length + photoWarnings.length;

    const box = document.createElement("div");
    box.id = "mlf-bk-summary";
    box.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "width:400px", "max-height:70vh",
      "background:#fff", "color:#1f2328", "border-radius:10px", "z-index:2147483647",
      "box-shadow:0 4px 24px rgba(0,0,0,.3)", "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "display:flex", "flex-direction:column", "overflow:hidden",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 12px;font-weight:600";
    const title = document.createElement("div");
    title.style.cssText = "flex:1";
    title.textContent = [
      `✓ ${changed} cambiado(s)`,
      alreadySet ? `${alreadySet} ya estaba(n) bien` : null,
      ...photoLines,
      toReview ? `⚠ ${toReview} para revisar` : null,
    ].filter(Boolean).join(" · ");
    const toggle = document.createElement("button");
    toggle.style.cssText = "border:none;background:none;cursor:pointer;font-size:13px;color:#6b7280";
    const close = document.createElement("button");
    close.textContent = "✕";
    close.style.cssText = toggle.style.cssText;
    close.onclick = () => box.remove();
    header.append(title, toggle, close);

    const detail = document.createElement("div");
    detail.style.cssText = "overflow-y:auto;padding:0 12px 10px;border-top:1px solid #e5e7eb";

    const addLine = (parent, text, style) => {
      const line = document.createElement("div");
      line.style.cssText = style;
      line.textContent = text;
      parent.appendChild(line);
    };
    const showValue = (value) => value || "(vacío)";
    const WARNING_STYLE = "margin-top:2px;font-size:11px;color:#8a5a00";

    rows.forEach((row) => {
      const item = document.createElement("div");
      item.style.cssText = "padding:7px 0;border-bottom:1px solid #f1f2f4";
      addLine(item, row.label, "font-weight:600");
      addLine(
        item,
        row.changed
          ? `${showValue(row.oldValue)} → ${showValue(row.newValue)}`
          : `${showValue(row.newValue)} (${row.alreadySet ? "BC ya tenía este valor" : "sin cambios"})`,
        "color:#374151;word-break:break-word"
      );
      if (row.warning) addLine(item, "⚠ " + row.warning, WARNING_STYLE);
      detail.appendChild(item);
    });

    photoWarnings.forEach((line) => addLine(detail, "⚠ " + line, "padding-top:6px;font-size:11px;color:#8a5a00"));

    if (others.length) {
      addLine(detail, "⚠ Otros campos que cambiaron:", "padding-top:8px;font-weight:600;color:#b42318");
      others.forEach((other) => {
        addLine(
          detail,
          `${other.label}: ${showValue(other.oldValue)} → ${showValue(other.newValue)}`,
          "font-size:12px;color:#b42318;word-break:break-word"
        );
      });
    } else {
      addLine(detail, "Otros campos que cambiaron: ninguno", "padding-top:8px;font-size:12px;color:#6b7280");
    }

    const setOpen = (open) => {
      detail.style.display = open ? "block" : "none";
      toggle.textContent = open ? "▾" : "▴";
    };
    toggle.onclick = () => setOpen(detail.style.display === "none");
    setOpen(toReview > 0);

    box.append(header, detail);
    document.getElementById("mlf-bk-summary")?.remove();
    document.body.appendChild(box);
  }

  async function pasteFallasPayload(payload) {
    const attributes = (payload?.attributes || []).filter((attr) => attr.id);
    const images = payload?.images || [];
    if (!attributes.length && !images.length) {
      showToast('No hay datos de "Copiar Fallas" para pegar.');
      return;
    }
    const result = await pasteFallas(attributes, images);
    if (result.blocked) showToast(result.blocked);
    else showFallasSummary(result);
  }

  // ============================================================
  // Rastrear GTIN (código universal)
  // ============================================================

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  // Lee los GTIN (código universal) cargados en la herramienta interna.
  // Cada variante es un `div#child-N` con una tarjeta `.expandible-card`;
  // adentro hay un campo `.cp-custom-multivalue-field` con aria-label
  // "CHILD[n].GTIN" y un tag (`.andes-tag__label`) por código.
  const GTIN_FIELD_SELECTOR = '.cp-custom-multivalue-field[aria-label*="GTIN"]';

  function readGtinCodes(root) {
    const codes = [];
    root.querySelectorAll(GTIN_FIELD_SELECTOR).forEach((field) => {
      field.querySelectorAll(".andes-tag__label").forEach((tag) => {
        const code = (tag.textContent || "").trim();
        if (code) codes.push(code);
      });
    });
    return codes;
  }

  // Título de la variante: del header de la tarjeta, desde el "#N" en
  // adelante (el header trae también el id MLMS, estado, etc.).
  function variantLabelFor(childEl, index) {
    const header = childEl.querySelector(".expandible-card__header") || childEl;
    const text = (header.textContent || "").replace(/\s+/g, " ").trim();
    const m = text.match(/#\d+\s.*/);
    return (m ? m[0] : `Variante ${index + 1}`).slice(0, 70);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Si la tarjeta está colapsada y todavía no tiene el campo GTIN en el
  // DOM, la abre, espera a que aparezca, lee y la vuelve a cerrar (deja la
  // pantalla como estaba).
  async function readGtinCodesExpanding(childEl) {
    const direct = readGtinCodes(childEl);
    if (direct.length || childEl.querySelector(GTIN_FIELD_SELECTOR)) return direct;
    const toggle =
      childEl.querySelector('.expandible-card__header [aria-expanded]') ||
      childEl.querySelector("[aria-expanded]") ||
      childEl.querySelector(".expandible-card__header");
    if (!toggle || toggle.getAttribute("aria-expanded") === "true") return direct;
    toggle.click();
    for (let i = 0; i < 20 && !childEl.querySelector(GTIN_FIELD_SELECTOR); i++) await sleep(100);
    await sleep(150);
    const codes = readGtinCodes(childEl);
    if (toggle.getAttribute("aria-expanded") === "true") toggle.click();
    return codes;
  }

  // Devuelve [{ code, variantLabel }] — una entrada por código. Una
  // variante sin ningún código sale con code "" (se muestra como "sin GTIN").
  async function extractUniversalCodes() {
    const children = Array.from(document.querySelectorAll("[id^='child-']"))
      .filter((el) => /^child-\d+$/.test(el.id))
      .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)));

    if (!children.length) {
      return readGtinCodes(document).map((code) => ({ code, variantLabel: "Código universal" }));
    }

    const out = [];
    for (let i = 0; i < children.length; i++) {
      const childEl = children[i];
      const variantLabel = variantLabelFor(childEl, i);
      const codes = await readGtinCodesExpanding(childEl);
      if (!codes.length) out.push({ code: "", variantLabel });
      codes.forEach((code) => out.push({ code, variantLabel }));
    }
    return out;
  }

  function buildGtinRow({ code, variantLabel }) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 4px;border-bottom:1px solid #f1f2f4";

    const variantEl = document.createElement("div");
    variantEl.style.cssText = "font-size:11px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    variantEl.textContent = variantLabel;

    if (!code) {
      const emptyEl = document.createElement("div");
      emptyEl.style.cssText = "font-size:12px;color:#9aa1ab;font-style:italic";
      emptyEl.textContent = "Sin GTIN cargado";
      row.appendChild(variantEl);
      row.appendChild(emptyEl);
      return row;
    }

    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:8px;align-items:center";

    const codeEl = document.createElement("div");
    codeEl.style.cssText =
      "flex:1;min-width:0;font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2328;word-break:break-all";
    codeEl.textContent = code;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copiar";
    copyBtn.style.cssText =
      "flex:0 0 auto;padding:6px 10px;border:none;border-radius:6px;background:#3483fa;color:#fff;font-weight:600;font-size:12px;cursor:pointer";
    copyBtn.onclick = async () => {
      const ok = await copyTextToClipboard(code);
      copyBtn.textContent = ok ? "¡Copiado!" : "Error";
      setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
    };

    // "G": copia el código y abre la búsqueda en Google en otra pestaña.
    const googleBtn = document.createElement("button");
    googleBtn.type = "button";
    googleBtn.textContent = "G";
    googleBtn.title = "Buscar en Google";
    googleBtn.style.cssText =
      "flex:0 0 auto;width:30px;height:30px;border:1px solid #dadce0;border-radius:50%;background:#fff;" +
      "color:#4285f4;font:700 15px Arial,sans-serif;cursor:pointer;line-height:1;padding:0";
    googleBtn.onclick = () => {
      copyTextToClipboard(code);
      window.open("https://www.google.com/search?q=" + encodeURIComponent(code), "_blank", "noopener");
    };

    line.appendChild(codeEl);
    line.appendChild(copyBtn);
    line.appendChild(googleBtn);
    row.appendChild(variantEl);
    row.appendChild(line);
    return row;
  }

  async function runGtinTrack() {
    const OVERLAY_ID = "mlf-bk-overlay";
    document.getElementById(OVERLAY_ID)?.remove();
    showToast("Leyendo GTIN de las variantes...");
    const entries = await extractUniversalCodes();
    document.getElementById("mlf-bk-toast")?.remove();
    const found = entries.filter((e) => e.code).length;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "width:340px", "max-height:80vh",
      "background:#fff", "color:#1f2328", "border-radius:10px",
      "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
      "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "display:flex", "flex-direction:column", "overflow:hidden",
    ].join(";");
    overlay.appendChild(buildOverlayHeader(`MLF — Rastrear GTIN (${found})`));

    const body = document.createElement("div");
    if (!entries.length) {
      body.style.cssText = "padding:16px 14px;color:#374151;line-height:1.5";
      body.textContent =
        "No encontré GTIN en esta página. Abrí la ficha con la sección \"Código universal\" de las variantes.";
    } else {
      body.style.cssText = "overflow-y:auto;padding:4px 12px 8px";
      entries.forEach((entry) => body.appendChild(buildGtinRow(entry)));
    }
    overlay.appendChild(body);
    document.body.appendChild(overlay);
  }

  // ============================================================
  // Pegar unificado + menú principal
  // ============================================================

  const KIND_INFO = {
    comp: { label: "Comp", color: "#3483fa" },
    mo: { label: "MO", color: "#7c3aed" },
    variante: { label: "Variante", color: "#0e9f6e" },
    fotos: { label: "Fotos", color: "#d97706" },
    fallas: { label: "Fallas", color: "#dc2626" },
  };

  function parseMlfPayload(raw) {
    if (!raw || !raw.trim()) return null;
    try {
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object") return null;
      if (!Array.isArray(payload.attributes) && !Array.isArray(payload.images)) return null;
      return payload;
    } catch (err) {
      return null;
    }
  }

  // Datos de versiones viejas no traen `kind`: solo fotos => Fotos, el resto
  // se pega como Comp (a toda la ficha).
  function payloadKind(payload) {
    if (KIND_INFO[payload.kind]) return payload.kind;
    return !(payload.attributes || []).length && (payload.images || []).length ? "fotos" : "comp";
  }

  function describePayload(payload) {
    const kind = payloadKind(payload);
    const parts = [];
    const attrCount = (payload.attributes || []).length;
    const imgCount = (payload.images || []).length;
    if (attrCount) parts.push(`${attrCount} atributo(s)`);
    if (imgCount) parts.push(`${imgCount} foto(s)`);
    let host = "";
    try { host = new URL(payload.source).hostname.replace(/^www\./, ""); } catch (_) { /* sin source */ }
    let age = "";
    if (payload.ts) {
      const mins = Math.max(0, Math.round((Date.now() - payload.ts) / 60000));
      age = mins < 1 ? "recién" : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
    }
    return { kind, info: KIND_INFO[kind], summary: parts.join(" + ") || "vacío", meta: [host, age].filter(Boolean).join(" · ") };
  }

  async function runPaste() {
    const raw = await getClipboardText("MLF");
    if (!raw) {
      showToast("Cancelado: no hay datos para pegar.");
      return;
    }
    const payload = parseMlfPayload(raw);
    if (!payload) {
      showToast("El portapapeles no tiene datos de MLF: copiá primero con alguno de los botones Copiar.");
      return;
    }
    const kind = payloadKind(payload);
    if (kind === "fotos") return pasteFotos(payload);
    if (kind === "variante") return pasteVariante(payload);
    if (kind === "fallas") return pasteFallasPayload(payload);
    return pasteWholeForm(payload);
  }

  const COPY_BUTTONS = [
    { text: "Comp", kind: "comp", run: runComparatorCopy },
    { text: "MO", kind: "mo", run: runMOCopy },
    { text: "Variante", kind: "variante", run: runVarianteCopy },
    { text: "Fotos", kind: "fotos", run: runFotosCopy },
    { text: "Fallas", kind: "fallas", run: runFallasCopy },
  ];

  function buildMenu() {
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "width:300px",
      "background:#fff", "color:#1f2328", "border-radius:12px",
      "box-shadow:0 6px 28px rgba(0,0,0,.3)", "z-index:2147483647",
      "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "overflow:hidden",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700";
    header.textContent = "MLF V2";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
    closeBtn.onclick = () => menu.remove();
    header.appendChild(closeBtn);
    menu.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:14px;padding:12px 14px 14px";

    const section = (label) => {
      const el = document.createElement("div");
      const labelEl = document.createElement("div");
      labelEl.style.cssText =
        "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.08em;" +
        "text-transform:uppercase;color:#8a8f98;margin-bottom:6px";
      labelEl.textContent = label;
      el.appendChild(labelEl);
      return el;
    };
    const hover = (btn) => {
      btn.onmouseenter = () => (btn.style.filter = "brightness(.92)");
      btn.onmouseleave = () => (btn.style.filter = "none");
    };

    // Copiar: un botón por origen, cada uno con su color.
    const copySec = section("Copiar");
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:6px";
    COPY_BUTTONS.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.text;
      btn.style.cssText =
        `padding:9px 4px;border:none;border-radius:7px;background:${KIND_INFO[item.kind].color};color:#fff;` +
        "font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      hover(btn);
      btn.onclick = () => { menu.remove(); item.run(); };
      grid.appendChild(btn);
    });
    copySec.appendChild(grid);
    body.appendChild(copySec);

    // Pegar: un solo botón + qué hay en el portapapeles.
    const pasteSec = section("Pegar");
    const card = document.createElement("div");
    card.style.cssText =
      "display:flex;flex-direction:column;gap:2px;padding:8px 10px;margin-bottom:8px;background:#f6f7f9;" +
      "border:1px solid #e5e7eb;border-left:4px solid #c4c8cf;border-radius:7px;font-size:12px;line-height:1.35";
    const cardTitle = document.createElement("div");
    cardTitle.style.cssText = "font-weight:600";
    cardTitle.textContent = "Leyendo portapapeles…";
    const cardSub = document.createElement("div");
    cardSub.style.cssText = "color:#6b7280";
    card.append(cardTitle, cardSub);
    pasteSec.appendChild(card);

    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.textContent = "Pegar";
    pasteBtn.style.cssText =
      "width:100%;padding:10px;border:none;border-radius:7px;background:#1f2328;color:#fff;" +
      "font-weight:700;font-size:13px;cursor:pointer";
    hover(pasteBtn);
    pasteBtn.onclick = () => { menu.remove(); runPaste(); };
    pasteSec.appendChild(pasteBtn);
    body.appendChild(pasteSec);

    const otherSec = section("Código universal");
    const gtinBtn = document.createElement("button");
    gtinBtn.type = "button";
    gtinBtn.textContent = "Rastrear GTIN";
    gtinBtn.style.cssText =
      "width:100%;padding:8px;border:1px solid #d0d5dd;border-radius:7px;background:#fff;color:#1f2328;" +
      "font-weight:600;font-size:12.5px;cursor:pointer";
    hover(gtinBtn);
    gtinBtn.onclick = () => { menu.remove(); runGtinTrack(); };
    otherSec.appendChild(gtinBtn);
    body.appendChild(otherSec);

    menu.appendChild(body);
    document.body.appendChild(menu);

    // Si el navegador no deja leer el portapapeles sin permiso, no se
    // insiste: el botón Pegar lo vuelve a pedir (o abre el prompt de Ctrl+V).
    const showClipboard = (text) => {
      const payload = parseMlfPayload(text);
      if (!payload) {
        cardTitle.textContent = text === null ? "Portapapeles sin leer" : "Sin datos de MLF";
        cardSub.textContent = text === null ? "Tocá Pegar para leerlo." : "Copiá algo con los botones de arriba.";
        return;
      }
      const d = describePayload(payload);
      cardTitle.textContent = `${d.info.label} · ${d.summary}`;
      cardSub.textContent = d.meta || "Listo para pegar";
      card.style.borderLeftColor = d.info.color;
      pasteBtn.textContent = `Pegar ${d.info.label}`;
    };
    navigator.clipboard.readText().then(showClipboard, () => showClipboard(null));
  }

  buildMenu();
})();
