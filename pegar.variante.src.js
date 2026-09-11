// MLF - Bookmarklet "Pegar Variante" (PROTOTIPO, no deployado).
//
// Complementa "MLF Pegar" (pegar.src.js, sin cambios) para el caso de
// publicaciones con varias variantes de color/diseño/etc. Flujo pensado:
//   1. "MLF Copiar Variantes" en la publicación de ML -> junta TODAS las
//      variantes en un solo paquete (ver copiar.variantes.src.js).
//   2. En la herramienta interna: "MLF Pegar" (el de siempre, sin tocar)
//      completa el producto base con la primera variante.
//   3. Clickeás "Agregar otra variante" en la herramienta (vos, a mano —
//      este bookmarklet no lo hace por vos) y dejás esa tarjeta abierta.
//   4. "MLF Pegar Variante" -> elegís cuál de las variantes restantes
//      querés y completa SOLO la tarjeta que tenés abierta en pantalla.
//
// CONFIRMADO EN VIVO (categoryId=MLA1055, "Moto G47"): la herramienta real
// es un ACORDEÓN estricto — "Características del producto" y cada
// "Variante N" son mutuamente excluyentes, y una tarjeta colapsada
// DESMONTA sus campos del DOM por completo (no es solo un display:none).
// Por eso la primera versión de este archivo (que abría TODO por las
// dudas y después usaba "la última coincidencia" para adivinar cuál
// tarjeta era la nueva) fallaba: abrir "Variante 1" para buscar sus
// campos cerraba de nuevo la tarjeta que realmente quería completar, y no
// hay forma de tener dos tarjetas abiertas a la vez para comparar.
//
// El fix: en vez de abrir/adivinar, se apunta directo a la tarjeta que
// YA está abierta en pantalla (la que el acordeón deja expandida en ese
// momento — normalmente la que acabás de crear con "Agregar otra
// variante") y se busca cada campo SOLO ahí adentro. Si por algún motivo
// no hay ninguna tarjeta de variante abierta, cae de vuelta a buscar en
// toda la página (comportamiento anterior) en vez de fallar en seco.

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
    return window.prompt(
      "Pegá acá el texto copiado con 'MLF Copiar Variantes' (Ctrl+V):",
      ""
    );
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

  /**
   * La tarjeta (".expandible-card") cuyo toggle está actualmente abierto
   * — ver nota al principio del archivo. Devuelve `document` si no
   * encuentra ninguna (herramienta sin este patrón de acordeón, u otra
   * pantalla), para no romper el comportamiento en ese caso.
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
    const byAttr = escaped ? scopeRoot.querySelector(`[name^="${escaped}["]`) : null;
    if (byAttr) return byAttr;
    return (
      Array.from(scopeRoot.querySelectorAll("input,select,textarea")).find((cand) => {
        const name = cand.getAttribute("name") || "";
        return name === id || name.startsWith(`${id}[`);
      }) || null
    );
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

  /**
   * Idéntico a pegar.src.js, salvo que busca labels SOLO dentro de
   * `scopeRoot` (la tarjeta de variante abierta — ver getScopeRoot) en
   * vez de en toda la página. Es lo que reemplaza al viejo "última
   * coincidencia": acá no hace falta adivinar cuál es la tarjeta nueva
   * porque solo se mira adentro de la que está realmente abierta.
   */
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

  async function fillOne(scopeRoot, attr, filledTargets) {
    if (attr.id) {
      const fieldByName = findFieldByName(scopeRoot, attr.id);
      if (fieldByName) {
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
      if (filledTargets.has(container)) return "duplicado";
      const outcome = await fillByContainer(container, attr);
      if (outcome !== "sin-match") {
        filledTargets.add(container);
        return outcome;
      }
    }
    return "sin-match";
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
    setTimeout(() => box.remove(), 9000);
  }

  async function runFill(attributes) {
    // Se apunta a la tarjeta que esté abierta EN ESTE MOMENTO — la que el
    // acordeón dejó expandida (normalmente la que acabás de crear con
    // "Agregar otra variante"). No se abre ni cierra nada: hacerlo
    // rompería el acordeón (solo puede haber una tarjeta abierta a la
    // vez), que es justo lo que causaba que esto no pegara bien antes.
    const scopeRoot = getScopeRoot();
    const results = { texto: 0, select: 0, dropdown: 0, toggle: 0, sinMatch: [], approx: [], added: [], duplicated: [] };
    const filledTargets = new Set();
    for (const attr of attributes) {
      const outcome = await fillOne(scopeRoot, attr, filledTargets);
      const label = attr.id ? `${attr.label} (${attr.id})` : attr.label;
      if (outcome === "duplicado") {
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
    }
    const done = results.texto + results.select + results.dropdown + results.toggle;
    const parts = [`${done} campo(s) completados`];
    if (results.added.length) parts.push(`${results.added.length} agregados como opción nueva (confirmar)`);
    if (results.approx.length) parts.push(`${results.approx.length} aproximados (revisar)`);
    if (results.duplicated.length) parts.push(`${results.duplicated.length} repetidos`);
    if (results.sinMatch.length) parts.push(`${results.sinMatch.length} sin match`);
    const detailLines = [];
    if (results.added.length) detailLines.push(`Agregados: ${results.added.join(", ")}`);
    if (results.approx.length) detailLines.push(`Revisar: ${results.approx.join(", ")}`);
    if (results.duplicated.length) detailLines.push(`Repetidos: ${results.duplicated.join(", ")}`);
    if (results.sinMatch.length) detailLines.push(`Sin match: ${results.sinMatch.join(", ")}`);
    showSummary(parts.join(" · "), detailLines.join(" — "));
  }

  // --- Arranque: leer payload, resolver a lista de variantes -----------

  const raw = await getPayloadText();
  if (!raw) {
    showSummary("Cancelado: no hay datos para pegar.");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    showSummary("El texto pegado no es válido (¿copiaste bien con 'MLF Copiar Variantes'?).");
    return;
  }

  // v2 (copiar.variantes.src.js) trae payload.variants. Si vinieran datos
  // de la "MLF Copiar" de siempre (v1, sin variants), se trata como una
  // única variante sin nombre — igual sirve para completar un bloque de
  // variante nuevo con esos mismos atributos.
  const variantsList =
    payload && Array.isArray(payload.variants) && payload.variants.length
      ? payload.variants
      : payload && payload.attributes
      ? [{ label: "(sin nombre)", attributes: payload.attributes }]
      : [];

  if (!variantsList.length) {
    showSummary("No hay atributos en los datos pegados.");
    return;
  }

  if (variantsList.length === 1) {
    await runFill(variantsList[0].attributes);
    return;
  }

  // --- Picker: varias variantes en el paquete, elegir cuál pegar ahora -

  const baseAttrs = (variantsList.find((v) => v.selected) || variantsList[0]).attributes;
  function diffFromBase(attrs) {
    const baseKeys = new Set(baseAttrs.map((a) => a.label.trim().toLowerCase() + "|" + a.value.trim().toLowerCase()));
    return attrs.filter((a) => !baseKeys.has(a.label.trim().toLowerCase() + "|" + a.value.trim().toLowerCase()));
  }

  const picker = document.createElement("div");
  picker.id = "mlf-bk-variant-picker";
  picker.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "width:300px",
    "background:#fff", "color:#1f2328", "border-radius:10px",
    "box-shadow:0 4px 24px rgba(0,0,0,.3)", "z-index:2147483647",
    "font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif",
    "overflow:hidden",
  ].join(";");

  const pHeader = document.createElement("div");
  pHeader.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600";
  pHeader.textContent = "MLF Pegar Variante";
  const pClose = document.createElement("button");
  pClose.textContent = "✕";
  pClose.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;color:#6b7280";
  pClose.onclick = () => picker.remove();
  pHeader.appendChild(pClose);
  picker.appendChild(pHeader);

  const pBody = document.createElement("div");
  pBody.style.cssText = "padding:10px 12px;color:#374151;font-size:12.5px;line-height:1.4";
  pBody.textContent =
    'Elegí qué variante completar en el bloque que acabás de agregar con "Agregar variante" en la herramienta.';
  picker.appendChild(pBody);

  const diffOnlyRow = document.createElement("label");
  diffOnlyRow.style.cssText = "display:flex;gap:6px;align-items:center;padding:0 12px 10px;font-size:12px;color:#374151";
  const diffOnlyCb = document.createElement("input");
  diffOnlyCb.type = "checkbox";
  diffOnlyCb.checked = true;
  diffOnlyRow.appendChild(diffOnlyCb);
  diffOnlyRow.append(
    " Solo completar lo que cambia respecto a la primera variante (recomendado si el formulario ya trae precargados los campos compartidos)"
  );
  picker.appendChild(diffOnlyRow);

  const list = document.createElement("div");
  list.style.cssText = "border-top:1px solid #e5e7eb";
  variantsList.forEach((variant) => {
    const row = document.createElement("button");
    const isBase = variant === (variantsList.find((v) => v.selected) || variantsList[0]);
    row.textContent = variant.label + (isBase ? " (base, ya cargada con MLF Pegar)" : "");
    row.style.cssText = [
      "display:block", "width:100%", "text-align:left", "padding:8px 12px",
      "border:none", "border-bottom:1px solid #f1f2f4", "background:#fff",
      "cursor:pointer", "font-size:12.5px",
    ].join(";");
    row.onmouseenter = () => (row.style.background = "#f6f7fb");
    row.onmouseleave = () => (row.style.background = "#fff");
    row.onclick = async () => {
      const attrsToUse = diffOnlyCb.checked ? diffFromBase(variant.attributes) : variant.attributes;
      picker.remove();
      if (!attrsToUse.length) {
        showSummary(`"${variant.label}" no tiene diferencias respecto a la base — nada para completar.`);
        return;
      }
      await runFill(attrsToUse);
    };
    list.appendChild(row);
  });
  picker.appendChild(list);

  document.body.appendChild(picker);
})();
