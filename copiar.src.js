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
   * ML a veces junta dos variantes en el mismo selector de arriba (ej. "Color
   * y Patrón: Gris Humo | -"), separadas por " y " en el label y " | " en el
   * valor, en el mismo orden. Si no se parte, el valor de Color termina con
   * caracteres de más pegados ("Gris Humo | -" en vez de "Gris Humo") — bug
   * real reportado: "el campo color me lo agrego con mas caracteres". Cuando
   * la otra mitad del combo no aplica a esta publicación, ML la deja como
   * "-"; esa mitad se descarta directo (ver isEmptyPlaceholder) en vez de
   * dejarla como un atributo vacío.
   */
  function splitCombinedVariation(attr) {
    if (!/\sy\s/i.test(attr.label) || !/\s\|\s/.test(attr.value)) return [attr];
    const labelParts = attr.label.split(/\s+y\s+/i).map((s) => s.trim()).filter(Boolean);
    const valueParts = attr.value.split(/\s*\|\s*/).map((s) => s.trim());
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return [attr];
    return labelParts.map((label, i) => ({ label, value: valueParts[i] }));
  }

  // ML deja "-" como placeholder cuando un campo de la publicación no aplica
  // (ej. "Nombre del diseño: -" en una carcasa lisa, sin diseño). No es un
  // dato real — copiarlo pega un "-" literal en el campo de destino en vez
  // de dejarlo vacío para completar a mano. Bug real reportado: "el diseño
  // no se copio" (en realidad SÍ se "copiaba", pero como "-", que la
  // herramienta interna probablemente rechaza o ignora por ser basura).
  function isEmptyPlaceholder(value) {
    return /^-+$/.test(value.trim());
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

  // Saca una aclaración entre paréntesis al final de un valor (ej. "TPU
  // (poliuretano termoplástico)" -> "TPU"). Consulta real del equipo: en
  // campos como "impacto" la herramienta interna suele tener una lista
  // cerrada de opciones cortas, y el texto completo con la aclaración no
  // matchea nada — conviene ofrecer la versión corta.
  function stripParenthetical(value) {
    const stripped = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return stripped || value.trim();
  }

  /**
   * ML junta varios materiales/valores en un solo campo separados por coma
   * (ej. "Materiales del exterior: TPU (poliuretano termoplástico), Silicona
   * (caucho sintético)"). Pegar el combo entero en un campo de selección
   * única falla siempre — consulta real: "si necesitas hacer pruebas...
   * porque luego fallan en impacto". En vez de adivinar cuál de los valores
   * es el correcto, se ofrece cada uno como una fila aparte (mismo label,
   * checkbox propio) para que elijas cuál pegar — sin tildar ninguna por
   * default, así no se pega el combo entero por descuido (ver cb.checked
   * más abajo). Cada valor se limpia de su aclaración entre paréntesis.
   *
   * Solo se activa si el LABEL está en MULTI_VALUE_LABEL_KEYWORDS (ver
   * arriba) — nunca se adivina a partir del valor. Encontramos en vivo dos
   * formas distintas en que una coma NO es una lista real y cada una
   * requería su propia detección ad hoc: "Peso: 3,9 kg" (coma decimal,
   * quedaba partido en "3" y "9 kg") y "Autor: Rothfuss, Patrick" (formato
   * "Apellido, Nombre", quedaba partido en dos autores). Restringir por
   * label de entrada evita toda esa familia de casos de una sola vez, en
   * vez de sumar una excepción nueva cada vez que aparece un patrón nuevo.
   */
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

  // "Marca" y "Fabricante" vienen seguido con el MISMO valor en ML (ej.
  // "Fabricante: Cuisinart" y "Marca: Cuisinart" en la misma publicación)
  // sin ser una duplicación real — son dos atributos distintos que la
  // herramienta interna a veces pide como campos separados y obligatorios
  // cada uno. El dedup por valor de abajo (pensado para "Número de
  // páginas" vs "Cantidad de páginas") los confundía: como comparten
  // valor, descartaba uno de los dos ACÁ, antes de que llegara siquiera al
  // portapapeles — por eso el campo faltante no aparecía ni para elegirlo
  // a mano en el picker (bug real reportado: "Marca y Fabricante eran
  // iguales y solo pegó en Fabricante").
  const VALUE_DEDUP_EXEMPT_LABELS = ["marca", "fabricante"];

  // Antes esto DESCARTABA el candidato repetido en silencio (nunca
  // llegaba ni al picker) — bug real reportado: un "Modelo" que no
  // aparecía para copiar porque compartía valor con otro atributo, sin
  // forma de enterarse ni de pegarlo a mano. Ahora en vez de decidir
  // solo, se ofrece igual con un aviso de "posible repetido" — tildado
  // por default (el resto de la decisión queda en manos de quien copia,
  // no de una heurística que puede estar mal en cualquier categoría
  // nueva que no probamos).
  function dedupeByLabel(list) {
    const firstByLabel = new Map();
    const firstByValue = new Map();
    const seenLabelValue = new Set();
    const out = [];
    for (const attr of list) {
      const labelKey = attr.label.trim().toLowerCase();
      const valueKey = attr.value.trim().toLowerCase();
      // Las filas de splitMultiValue comparten label a propósito (son
      // candidatos del mismo campo) — acá solo se descarta un candidato
      // exactamente repetido, nunca el resto de filas con ese label.
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

  // Orden de prioridad si el mismo label aparece en más de un lado: título
  // y descripción primero, después la tabla (más confiable/completa que
  // los bullets), y los bullets solo rellenan lo que la tabla no traiga.
  const rawAttributes = [
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
    // Las filas candidatas de un campo multi-valor (ver splitMultiValue)
    // arrancan destildadas — son opciones a elegir, no algo para pegar
    // todo junto por default.
    cb.checked = !attr.multiValue;
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

    // Ver dedupeByLabel: esto NO se descarta solo, se ofrece igual
    // (tildado) con un aviso — la decisión de si es o no el mismo dato
    // queda en manos de quien copia, no de la heurística.
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
    const selected = checkboxes.filter((cb) => cb.checked).map((cb) => attributes[Number(cb.dataset.idx)]);
    if (!selected.length) {
      status.textContent = "Seleccioná al menos un atributo.";
      return;
    }
    // Solo label/value viajan al portapapeles — possibleDuplicate y
    // duplicateReason son detalle del picker, "MLF Pegar" no los usa.
    const payload = JSON.stringify({
      v: 1,
      source: location.href,
      attributes: selected.map(({ label, value, multiValue }) => ({ label, value, multiValue })),
    });
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
