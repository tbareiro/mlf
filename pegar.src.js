// MLF - Bookmarklet "Pegar" (correr parado en la herramienta interna).
//
// Cero instalación. Lee el portapapeles (o, si el navegador bloquea leerlo
// por script, te pide que lo pegues vos con Ctrl+V en un cuadro) y completa
// los campos del formulario. No hace requests propios, no toca nada que no
// sea el formulario visible, y nunca clickea "Guardar"/"Finalizar"/"Enviar"
// — eso queda siempre en tus manos.
//
// Lógica de matching idéntica a la validada en la extensión (src/content-tool.js),
// fix de toggles Sí/No incluido.

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
    return window.prompt("Pegá acá el texto copiado con el bookmarklet 'MLF Copiar' (Ctrl+V):", "");
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

  // Categorías amplias que algunos dropdowns usan en vez del material/valor
  // específico que trae ML (ej. el desplegable solo distingue "Metal" /
  // "Nailon" para cuerdas, pero ML dice "Bronce fosforado" o "Acero
  // inoxidable"). Esto es una regla genérica y reutilizable entre
  // categorías (cuerdas de guitarra, bajo, violín...), a diferencia de
  // mapear categoría por categoría. Un match por acá SIEMPRE cuenta como
  // aproximado — es una inferencia, no un dato textual que coincide.
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

  // "strict" corta el matching en el exacto — sin fuzzy por substring ni
  // fallback de categoría. Se usa para atributos tipo Color (ver
  // isColorLabel): esas listas aceptan colores "inventados" o específicos
  // de marca, así que aproximar a la opción existente más parecida
  // arriesga pegar un color que NO es el que trae ML. Mejor exacto o,
  // si no existe, agregarlo tal cual (ver resolveAndesOption).
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

  // ¿Este label es de color? Uso \b para no agarrar "Con Páginas para
  // colorear" (un toggle Sí/No sin relación) — "colorear" no tiene borde
  // de palabra después de "color", así que el regex no lo matchea.
  function isColorLabel(label) {
    return /\bcolor\b/i.test(normalize(label));
  }

  /** ¿Este listbox es de selección múltiple? Sus opciones traen un checkbox real adentro. */
  function isMultiSelectOption(li) {
    return !!li.querySelector('.andes-checkbox, input[type="checkbox"]');
  }

  /**
   * Un atributo puede traer varios valores juntos (ej. "Caoba, Nogal" o
   * "Caoba y Nogal"). Se separa por coma, "/", ";" o " y " para poder
   * tildar cada uno por separado en un dropdown multi-selección.
   */
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

  /**
   * Escribe en el buscador del listbox abierto (dispara el filtro en vivo
   * de Andes). Devuelve false si este dropdown no tiene buscador.
   */
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

  /**
   * Muchos de estos dropdowns son "abiertos": si escribís algo que no
   * está en la lista, aparece una opción "Agregar "valor"" que crea un
   * ítem nuevo con exactamente ese texto. `data-key` de esa opción es el
   * valor tal cual se escribió, así que se identifica por ahí (no por
   * texto, que viene envuelto en 'Agregar "..."').
   */
  function findAddOption(items, rawValue) {
    const wanted = rawValue.trim();
    return items.find(
      (li) => li.getAttribute("data-key") === wanted && /^agregar\b/i.test(normalize(li.textContent))
    );
  }

  /**
   * Busca (y si hace falta, escribe en el buscador para revelar "Agregar")
   * una opción para un único valor. No clickea nada — devuelve el elemento
   * y si el match fue exacto/aproximado/agregado, para que el que llama
   * decida cuándo clickear (importante en multi-selección, donde no
   * queremos reabrir el buscador ya limpio de vuelta a la lista completa
   * antes de terminar de leer el resultado).
   */
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

    // Selección múltiple: el listbox queda abierto entre clicks — hay que
    // tildar cada valor por separado, sin cerrar hasta terminar todos.
    // Si un valor puntual necesitó escribirse en el buscador para
    // resolverse (ver resolveAndesOption), limpiamos el buscador después
    // para que la lista completa vuelva a estar disponible para el
    // próximo valor.
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
      await typeIntoSearch(""); // volver a ver la lista completa para el próximo valor
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
   * Abre toda sección colapsable (ej. "Variante 1") antes de buscar campos.
   * Estas tarjetas Andes ("expandible-card") no montan su contenido en el
   * DOM hasta que se abren — por eso un campo puede "no existir" para el
   * matching aunque esté ahí, simplemente plegado. Clickea cualquier
   * disparador role="button" con aria-expanded="false" que encuentre, en un
   * par de pasadas por si abrir una revela otra anidada.
   */
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

  function findFieldByName(id) {
    let escaped;
    try {
      escaped = CSS.escape(id);
    } catch (_) {
      escaped = null;
    }
    let el = escaped ? document.querySelector(`[name^="${escaped}["]`) : null;
    if (!el) {
      el = Array.from(document.querySelectorAll("input,select,textarea")).find((cand) => {
        const name = cand.getAttribute("name") || "";
        return name === id || name.startsWith(`${id}[`);
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

  /** Escribe texto en un editor "contenteditable" (ej. Descripción, que no es un <textarea>). */
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

  /**
   * Encuentra el contenedor de un campo por su label visible. Dos patrones
   * distintos conviven en esta herramienta:
   *   1. <label for="...">Texto</label> apuntando a un id (Andes clásico).
   *   2. <section aria-label="Texto">...</section> envolviendo el campo,
   *      sin ningún <label> real (ej. Título/Descripción/Código universal
   *      dentro de una variante). Ojo: NO alcanza con buscar cualquier
   *      [aria-label] — los inputs internos también tienen aria-label
   *      (identificadores técnicos), por eso se prioriza un contenedor tipo
   *      "section" y se excluyen inputs/botones sueltos.
   */
  function containerFromLabelEl(labelEl) {
    const forId = labelEl.getAttribute("for");
    return (forId && document.getElementById(forId)) || labelEl.parentElement;
  }

  // Último recurso para labels que refieren al MISMO campo pero con
  // palabras distintas de cada lado — ej. la publicación de ML dice
  // "Modelo del forro" o "Marca de la carcasa", pero esta herramienta
  // pide "Modelo de la funda" / "Marca de la funda" para esa misma
  // categoría. El fuzzy normal (substring) no alcanza porque además la
  // preposición cambia ("del" vs "de la"), así que se sacan artículos/
  // preposiciones y se unifica forro/carcasa/funda a una sola palabra
  // antes de comparar. Es más laxo que el fuzzy normal, por eso corre
  // último y exige igualdad exacta de las palabras que quedan (no
  // substring) — para no inventar matches raros.
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

    // Tier 1: SOLO matches exactos, en cualquiera de las dos estrategias.
    // Un exacto siempre gana, sin importar de dónde venga — si no, un
    // fuzzy de <label> (ver Tier 2) puede robarse el match antes de
    // llegar al aria-label correcto (ej. "Título" matcheaba por texto
    // contenido dentro de "Título del libro" antes de probar el
    // aria-label="Título" real de la variante).
    let labelEl = labels.find((l) => normalize(l.getAttribute("for") || "") === target);
    if (!labelEl) labelEl = labels.find((l) => normalize(l.textContent) === target);
    if (labelEl) {
      const container = containerFromLabelEl(labelEl);
      if (container) return container;
    }
    const ariaExact = ariaCandidates.find((el) => normalize(el.getAttribute("aria-label") || "") === target);
    if (ariaExact) return ariaExact;

    // Tier 2: fuzzy, solo si no hubo NINGÚN exacto en ningún lado.
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

    // Tier 3: canónico (ver canonicalizePhrase) — solo si nada de arriba
    // encontró nada. Se compara primero contra "for" (siempre limpio, sin
    // el texto de ayuda/tooltip que a veces trae el <label>) y recién si
    // no hay ninguno se prueba contra el textContent completo.
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

  // Variantes del mismo concepto ("código universal de producto") que ML
  // agrupa en un solo campo GTIN: si el atributo copiado viene con alguno
  // de estos labels, probar también contra "Código universal".
  const UNIVERSAL_CODE_SYNONYMS = ["isbn", "ean", "upc", "gtin", "codigo de barras", "codigo ean", "codigo upc"];

  function candidateLabelsFor(label) {
    const candidates = [label];
    if (UNIVERSAL_CODE_SYNONYMS.includes(normalize(label))) candidates.push("Código universal");
    return candidates;
  }

  /**
   * Campos "número + unidad" (Ancho/Profundidad/Altura/Peso en mm, cm, g...):
   * un input de texto normal PERO acompañado de un dropdown Andes con la
   * unidad al lado, dentro de un contenedor ".andes-form-control--split".
   * Si no se detecta esto por separado, el valor completo de ML (ej. "31
   * cm") termina metido tal cual en el input, y peor todavía si ML trae
   * varias dimensiones juntas — ver splitCombinedDimensions del lado de
   * "Copiar", que ya separa eso antes de llegar acá.
   */
  function findSplitUnitField(container) {
    const splitRoot = container.querySelector(".andes-form-control--split");
    if (!splitRoot) return null;
    const input = splitRoot.querySelector('input[type="text"], input:not([type])');
    const unitTrigger = splitRoot.querySelector('[role="combobox"]');
    if (!input || !unitTrigger) return null;
    return { input, unitTrigger };
  }

  /** "31 cm" -> {number:"31", unit:"cm"}. Sin unidad reconocible, unit queda "". */
  function parseNumberUnit(value) {
    const m = String(value).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) return { number: String(value).trim(), unit: "" };
    return { number: m[1].replace(",", "."), unit: m[2].trim() };
  }

  /**
   * Elige una opción de unidad por texto exacto/aproximado, SIN el flujo
   * de "escribir y Agregar" que usa clickAndesOption para listas de
   * catálogo — acá no tiene sentido inventar una unidad nueva si "m" no
   * está en la lista (cm/mm/"), así que si no matchea ninguna se deja la
   * unidad como estaba (y el llamador lo marca como aproximado).
   */
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
    // Si la unidad de ML no está entre las opciones (ej. "m" y acá solo hay
    // cm/mm/"), el número quedó cargado pero con la unidad que ya tenía el
    // campo — puede ser la incorrecta, así que se marca para revisar.
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
    // Solo .click() acá — este botón escucha "mousedown" para abrir/cerrar,
    // así que sumarle un mousedown manual ANTES de .click() (que ya
    // dispara su propia secuencia completa, mousedown incluido) puede
    // togglear dos veces y dejarlo cerrado en el mismo tick en el que
    // pensás que lo abriste. Costó encontrarlo porque las opciones internas
    // (li) sí toleran el mousedown extra — solo el trigger es sensible.
    trigger.click();
    await new Promise((r) => setTimeout(r, 250));
    if (trigger.getAttribute("aria-expanded") !== "true") {
      // No abrió a la primera (puede pasar por timing) — un segundo intento.
      trigger.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    // A veces "aria-expanded" ya dice "true" pero la lista de opciones
    // todavía no se montó en el DOM — se vio en secuencias de varios
    // dropdowns seguidos (ej. pegando 4+ atributos con "Agregar" cada
    // uno), donde el 4to o 5to quedaba con 0 <li> un instante después de
    // abrir. Sin este reintento, clickAndesOption ve la lista vacía y
    // aborta directo (ni siquiera prueba el buscador), así que el atributo
    // quedaba "sin match" aunque el campo y el valor eran correctos.
    for (
      let wait = 0;
      wait < 4 && !document.querySelector('li[role="option"], li[data-key]');
      wait++
    ) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const r = await clickAndesOption(attr.value, isColorLabel(attr.label));
    // El multi-selección no se cierra solo al tildar una opción (a
    // diferencia del single-select, que sí lo hace) — si sigue abierto
    // (aria-expanded="true"), lo cerramos como harías vos a mano, con
    // Escape, para no dejarlo tapando el campo siguiente. Si ya se cerró
    // solo (single-select), no lo tocamos — reabrirlo sería el mismo bug
    // que el de los toggles Sí/No de antes.
    if (trigger.getAttribute("aria-expanded") === "true") {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.click();
    }
    if (!r.ok) return "sin-match";
    // "added": no había ninguna opción parecida, así que se creó una nueva
    // con el valor tal cual — no es una aproximación (el texto es exacto),
    // pero sí agrega una opción nueva a la lista del catálogo, así que
    // conviene que alguien confirme que corresponde antes de dar por
    // bueno el campo.
    if (r.added) return "dropdown-added";
    return r.exact ? "dropdown" : "dropdown-approx";
  }

  /**
   * Dos atributos de ML distintos (ej. "Color" y "Color principal") pueden
   * resolver al MISMO campo de la herramienta interna, porque "Color
   * principal" matchea por fuzzy contra el <label> "Color" cuando no hay un
   * campo separado. Sin este chequeo, el segundo atributo pisaba en
   * silencio el valor que el primero ya había dejado bien cargado. Se
   * trackea el nodo destino (el <select>/input resuelto por nombre, o el
   * contenedor resuelto por label) y, si un atributo posterior cae en el
   * mismo nodo, se deja como "duplicado" en vez de tocarlo — se avisa en
   * vez de arriesgar pisar el dato bueno con uno peor.
   */
  // Campos que este bookmarklet nunca debe tocar, pase lo que pase (ni por
  // id/name, ni por label exacto, ni por fuzzy). Pedido explícito: "Tipo de
  // lanzamiento" es una config manual de la variante (lanzamiento/preventa)
  // que ya se decide a mano y no tiene que venir de ML. Se resuelve UNA vez
  // al contenedor real (ver protectedTargetsFor) y de ahí en más cualquier
  // atributo que caiga ahí — por la razón que sea — se frena antes de
  // escribir nada, nunca se descarta en silencio (se lista aparte como
  // "protegido" en el resumen).
  const PROTECTED_LABELS = ["Tipo de lanzamiento"];

  function protectedTargetsFor(labels) {
    const targets = new Set();
    for (const label of labels) {
      const container = findContainerForLabel(label);
      if (container) targets.add(container);
    }
    return targets;
  }

  // true si `el` ES uno de los contenedores protegidos, o está adentro de
  // uno — cubre tanto el match por label (que devuelve el contenedor
  // mismo) como el match por id/name (que devuelve el input/select de
  // adentro).
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

  // Sin auto-cierre: antes desaparecía solo a los 7s, muy poco tiempo para
  // leer con calma qué faltó o qué conviene revisar (repetidos, mal
  // escritos, aproximados). Ahora se queda en pantalla hasta que lo cerrás
  // vos con la ✕ — y cada categoría del detalle va en su propio renglón
  // (antes era una sola línea larga separada por " — ", difícil de leer).
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
    showSummary("El texto pegado no es válido (¿copiaste bien con 'MLF Copiar'?).");
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
  for (const attr of attributes) {
    const outcome = await fillOne(attr, filledTargets, protectedTargets);
    const label = attr.id ? `${attr.label} (${attr.id})` : attr.label;
    if (outcome === "protegido") {
      // Campo en la lista de PROTECTED_LABELS (ver arriba) — nunca se
      // toca, ni siquiera para avisar que "no matcheó": se deja afuera a
      // propósito, así que se lista aparte de "sin match".
      results.protegido.push(label);
    } else if (outcome === "duplicado") {
      // Otro atributo ya completó este mismo campo antes (ej. "Color" y
      // "Color principal" cayendo en el mismo dropdown) — no se pisa el
      // valor que ya quedó bien cargado.
      results.duplicated.push(label);
    } else if (outcome === "sin-match") {
      results.sinMatch.push(label);
    } else if (outcome.endsWith("-approx")) {
      // Se completó, pero por una coincidencia aproximada (texto parcial o
      // una categoría inferida, ej. "Bronce fosforado" -> "Metal") — no es
      // un error, pero conviene que alguien lo revise antes de confiar en
      // el dato tal cual quedó.
      results[outcome.replace("-approx", "")]++;
      results.approx.push(label);
    } else if (outcome === "dropdown-added") {
      // No había ninguna opción parecida en la lista — se creó una nueva
      // con el valor tal cual. El texto es exacto, pero es una opción
      // nueva en el catálogo de esa lista, así que conviene confirmarla.
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
