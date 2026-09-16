// MLF - Bookmarklet "Pegar Comparator" (correr parado en la herramienta
// interna). Versión final — reemplaza al viejo build minificado a mano
// (pegar.comparator.url.js sin fuente) por uno compilado igual que el
// resto, desde este archivo.
//
// Cero instalación. Lee el portapapeles (o, si el navegador bloquea leerlo
// por script, te pide que lo pegues vos con Ctrl+V en un cuadro) y completa
// los campos del formulario. No hace requests propios, no toca nada que no
// sea el formulario visible, y nunca clickea "Guardar"/"Finalizar"/"Enviar"
// — eso queda siempre en tus manos.
//
// Diferencias contra pegar.src.js (que sigue existiendo como "Pegar Item",
// para publicaciones sin comparador):
//   - findFieldByName también matchea nombres anidados (ej.
//     "variante.color[...]"), no solo el id "pelado" al principio — la
//     herramienta anida algunos campos de variante bajo un prefijo.
//   - Los atributos vienen con scope:"child" cuando distinguen la variante
//     (ver copiar.comparator.src.js) — se pegan en dos pasadas: primero los
//     comunes (parent), después los child, para que un campo compartido no
//     quede "duplicado" por el lado equivocado.
//   - Reintento automático: lo que da "sin match" en la primera pasada se
//     reintenta una vez más después de una pausa corta — cubre dropdowns
//     que todavía no terminaron de montar sus opciones la primera vez
//     (pasa más seguido acá por el volumen de campos que llegan juntos).

(async function () {
  "use strict";

  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  async function getPayloadText() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch (_) {
      /* el navegador bloqueó la lectura del portapapeles por script */
    }
    return window.prompt("Pegá acá el texto copiado con 'Copiar Comparator' (Ctrl+V):", "");
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

  function splitMultiValue(value) {
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

    const parts = splitMultiValue(value);
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
      const collapsed = Array.from(
        document.querySelectorAll('[aria-expanded="false"][role="button"]')
      );
      if (!collapsed.length) return;
      collapsed.forEach((el) => el.click());
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // A diferencia de pegar.src.js, también matchea un name ANIDADO bajo un
  // prefijo (ej. "variante.color[0]") — no solo uno que empieza
  // directamente con el id. La herramienta anida algunos campos de
  // variante así, y sin este patrón extra quedaban sin resolver por id
  // aunque el id copiado era correcto.
  function findFieldByName(id) {
    let escaped;
    try {
      escaped = CSS.escape(id);
    } catch (_) {
      escaped = null;
    }
    let el = escaped ? document.querySelector(`[name^="${escaped}["], [name*=".${escaped}["]`) : null;
    if (!el) {
      el = Array.from(document.querySelectorAll("input,select,textarea")).find((cand) => {
        const name = cand.getAttribute("name") || "";
        return name === id || name.startsWith(`${id}[`) || name.includes(`.${id}[`);
      });
    }
    return el || null;
  }

  async function fillByName(fieldEl, attr) {
    if (fieldEl.tagName === "SELECT") {
      const r = fillSelect(fieldEl, attr.value, isColorLabel(attr.label));
      return r.ok ? (r.exact ? "select" : "select-approx") : "sin-match";
    }
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

  function findContainerForLabel(label) {
    const target = normalize(label);
    const labels = Array.from(document.querySelectorAll("label"));
    const ariaCandidates = Array.from(document.querySelectorAll("section[aria-label], div[aria-label]"));

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
    const splitRoot = container.querySelector(".andes-form-control--split");
    if (!splitRoot) return null;
    const input = splitRoot.querySelector('input[type="text"], input:not([type])');
    const unitTrigger = splitRoot.querySelector('[role="combobox"]');
    if (!input || !unitTrigger) return null;
    return { input, unitTrigger };
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
    for (
      let wait = 0;
      wait < 4 && !document.querySelector('li[role="option"], li[data-key]');
      wait++
    ) {
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

  // Campos que este bookmarklet nunca debe tocar, pase lo que pase (ni por
  // id/name, ni por label exacto, ni por fuzzy). Ver misma constante en
  // pegar.src.js: "Tipo de lanzamiento" es config manual de la variante
  // que ya se decide a mano y no tiene que venir de ML.
  const PROTECTED_LABELS = ["Tipo de lanzamiento"];

  function protectedTargetsFor(labels) {
    const targets = new Set();
    for (const label of labels) {
      const container = findContainerForLabel(label);
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

  async function fillOne(attr, filledTargets, protectedTargets) {
    if (attr.id) {
      const fieldByName = findFieldByName(attr.id);
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
      const container = findContainerForLabel(candidateLabel);
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

  // Sin auto-cierre — se queda en pantalla hasta que lo cerrás con la ✕,
  // para poder leer con calma qué faltó o qué conviene revisar. Cada
  // categoría del detalle va en su propio renglón.
  function showSummary(text, detailLines) {
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

  const raw = await getPayloadText();
  if (!raw) {
    showSummary("Cancelado: no hay datos para pegar.");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    showSummary("El texto pegado no es válido (¿copiaste bien con 'Copiar Comparator'?).");
    return;
  }

  const attributes = payload && payload.attributes;
  if (!attributes || !attributes.length) {
    showSummary("No hay atributos en los datos pegados.");
    return;
  }

  await expandCollapsedSections();
  const protectedTargets = protectedTargetsFor(PROTECTED_LABELS);

  const results = {
    texto: 0, select: 0, dropdown: 0, toggle: 0,
    sinMatch: [], approx: [], added: [], duplicated: [], protegido: [],
  };
  const filledTargets = new Set();

  function attrLabel(attr) {
    return attr.id ? `${attr.label} (${attr.id})` : attr.label;
  }

  async function fillAttr(attr) {
    const outcome = await fillOne(attr, filledTargets, protectedTargets);
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

  /**
   * Reintenta UNA vez, después de una pausa corta, lo que dio "sin match"
   * en la primera pasada — cubre dropdowns que todavía no terminaron de
   * montar sus opciones (ver comentario al principio del archivo).
   */
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

  // Primero los atributos comunes (parent/sin scope), después los "child"
  // (los que distinguen la variante, ej. Color — ver
  // copiar.comparator.src.js) — así un campo compartido se completa por el
  // lado correcto antes de que un atributo de variante pueda pisarlo o
  // quedar marcado "duplicado" al revés.
  const parentAttrs = attributes.filter((a) => a.scope !== "child");
  const childAttrs = attributes.filter((a) => a.scope === "child");

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

  showSummary(parts.join(" · "), detailLines);
})();
