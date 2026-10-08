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

  async function expandCollapsedSections() {
    for (let pass = 0; pass < 3; pass++) {
      const collapsed = Array.from(document.querySelectorAll('[aria-expanded="false"][role="button"]'));
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
      const r = fillSelect(fieldEl, attr.value, isColorLabel(attr.label));
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
      const r = fillSelect(select, attr.value, isColorLabel(attr.label));
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
    const r = await clickAndesOption(attr.value, isColorLabel(attr.label));
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
   * un solo resumen (ver pasteImages / runComparatorPaste).
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
  async function pasteImages(urls) {
    const input = findPhotoInput();
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

  function showAttributePicker({ headerText, attributes, notice, emptyText, copyButtonText, pasteHintLabel }) {
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

    if (!attributes.length) {
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
        .filter((attr) => attr.value.length > 0);
      if (!selected.length) {
        status.textContent = "Seleccioná al menos un atributo.";
        return;
      }
      const payload = JSON.stringify({
        v: 1,
        source: location.href,
        attributes: selected.map(({ id, label, value, multiValue, scope }) => ({ id, label, value, multiValue, scope })),
      });
      const countLabel = `${selected.length} atributo(s)`;
      try {
        await navigator.clipboard.writeText(payload);
        status.textContent = `Copiado (${countLabel}). Andá a la herramienta interna y usá "MLF V2 → ${pasteHintLabel}".`;
      } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.cssText = "position:fixed;top:-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        status.textContent = ok
          ? `Copiado (${countLabel}). Usá "MLF V2 → ${pasteHintLabel}".`
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
      pasteHintLabel: "Comparator",
    });
  }

  function runComparatorPaste() {
    return pasteFromClipboard("Comparator");
  }

  // Pegado "a toda la ficha" (sin acordeón de a una tarjeta) — lo comparten
  // Comparator y MO, solo cambia el nombre del botón en los mensajes.
  async function pasteFromClipboard(copiedWithLabel) {
    const raw = await getClipboardText(copiedWithLabel);
    if (!raw) {
      showToast("Cancelado: no hay datos para pegar.");
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      showToast(`El texto pegado no es válido (¿copiaste bien con "${copiedWithLabel}"?).`);
      return;
    }
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
      pasteHintLabel: "Pegar MO",
    });
  }

  function runMOPaste() {
    return pasteFromClipboard("Copiar MO");
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
      pasteHintLabel: "Variante",
    });
  }

  async function runVariantePaste() {
    const raw = await getClipboardText("Variante");
    if (!raw) {
      showToast("Cancelado: no hay datos para pegar.");
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      showToast('El texto pegado no es válido (¿copiaste bien con "Variante"?).');
      return;
    }
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
      const payload = JSON.stringify({ v: 1, source: location.href, images: selected });
      try {
        await navigator.clipboard.writeText(payload);
        status.textContent = `Copiadas (${selected.length}). Andá a la herramienta interna y usá "MLF V2 → Fotos".`;
      } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.cssText = "position:fixed;top:-1000px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        status.textContent = ok
          ? `Copiadas (${selected.length}). Usá "MLF V2 → Fotos".`
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

  async function runFotosPaste() {
    const raw = await getClipboardText("Fotos");
    if (!raw) {
      showToast("Cancelado: no hay datos para pegar.");
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      showToast('El texto pegado no es válido (¿copiaste bien con "Fotos"?).');
      return;
    }
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
  // Menú principal
  // ============================================================

  /**
   * Botones explícitos de Copiar/Pegar por grupo (no auto-detección) —
   * pedido expreso: el menú tiene que mantener el mismo patrón de
   * botones separados que la barra de favoritos de siempre (ver
   * index.html), solo que agrupados en un menú en vez de ocupar 6 lugares
   * en la barra. "Comparator" y "Variante" ya incluyen las fotos de la
   * galería en su propio picker (ver showAttributePicker) — "Fotos" queda
   * aparte para cuando hace falta llevar fotos sueltas, sin atributos.
   */
  const MENU_GROUPS = [
    {
      label: "Comparator",
      items: [
        { text: "Copiar Comp", run: runComparatorCopy },
        { text: "Pegar Comp", run: runComparatorPaste },
      ],
    },
    {
      label: "MO",
      items: [
        { text: "Copiar MO", run: runMOCopy },
        { text: "Pegar MO", run: runMOPaste },
      ],
    },
    {
      label: "Variante",
      items: [
        { text: "Copiar Variante", run: runVarianteCopy },
        { text: "Pegar Variante", run: runVariantePaste },
      ],
    },
    {
      label: "Fotos",
      items: [
        { text: "Copiar Fotos", run: runFotosCopy },
        { text: "Pegar Fotos", run: runFotosPaste },
      ],
    },
  ];

  function buildMenu() {
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "width:300px",
      "background:#fff", "color:#1f2328", "border-radius:10px",
      "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
      "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
      "overflow:hidden",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600";
    header.textContent = "MLF V2";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
    closeBtn.onclick = () => menu.remove();
    header.appendChild(closeBtn);
    menu.appendChild(header);

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:14px;padding:12px;";

    MENU_GROUPS.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.style.cssText = "display:flex;flex-direction:column;gap:6px";

      const labelEl = document.createElement("div");
      labelEl.style.cssText =
        "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.06em;" +
        "text-transform:uppercase;color:#8a8f98";
      labelEl.textContent = group.label;
      groupEl.appendChild(labelEl);

      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px";
      group.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        // Ancho fijo (no flex: crece/achica según el texto) para que los 6
        // botones del menú midan exactamente lo mismo, sin importar el
        // grupo — "Pegar Variante" es el texto más largo, el resto queda
        // centrado en el mismo ancho.
        btn.style.cssText = [
          "width:124px", "flex:0 0 auto", "display:flex", "align-items:center",
          "justify-content:center", "padding:9px 6px", "border:none", "border-radius:7px",
          "background:#3483fa", "color:#fff", "font-weight:600", "font-size:12.5px",
          "cursor:pointer", "white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis",
        ].join(";");
        btn.textContent = item.text;
        btn.onmouseenter = () => (btn.style.filter = "brightness(.92)");
        btn.onmouseleave = () => (btn.style.filter = "none");
        btn.onclick = () => {
          menu.remove();
          item.run();
        };
        row.appendChild(btn);
      });
      groupEl.appendChild(row);
      body.appendChild(groupEl);
    });

    menu.appendChild(body);
    document.body.appendChild(menu);
  }

  buildMenu();
})();
