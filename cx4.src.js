// Cx4 — bookmarklet para las tareas de comparación "mi item vs producto de
// catálogo" cuando hay que POSTERGAR la tarea sin perder lo ya resuelto.
//
// Qué hace:
//   · Guardar: lee Identificador + Dominio (identifican la tarea) y, por cada
//     fila de la grilla, Item ID / Variation ID (para reconocer la fila),
//     N° de fila, Resolución (lista cerrada), Producto a forzar y Comentario.
//     Además cada fila tiene un campo GID (Group ID) que se escribe a mano en
//     el panel — ese dato no figura en la grilla de la herramienta.
//   · Muchas tareas a la vez: se guardan en una lista, cada una con su ID +
//     Dominio.
//   · Se queda residente: después de tocar el bookmarklet UNA vez en la
//     página, vigila cuál es la tarea abierta. Si cambiás a una que tiene
//     algo guardado, avisa solo y pregunta si querés retomarla. (Un
//     bookmarklet no puede correr solo al abrir la página — eso requeriría
//     una extensión —, así que hay que tocarlo una vez por carga completa de
//     la página.)
//   · Autoguardado: después de Guardar o Retomar, los cambios que hagas en
//     esa tarea se guardan solos.
//   · Retomar/Restaurar: vuelve a cargar los valores matcheando por Item ID
//     + Variation ID, nunca por posición.
//   · Borrar: tick por tarea, con confirmación antes de borrar.
//   · Persistencia: localStorage + copia en IndexedDB (si la herramienta
//     limpia uno, queda el otro), pedido de almacenamiento persistente al
//     navegador, y respaldo manual (archivo .json o portapapeles). El
//     panel avisa si hace mucho que no hacés un respaldo.
//
// Nunca clickea Enviar/Finalizar/Postergar/Guardar de la herramienta: solo
// lee la grilla y, al restaurar, completa los campos editables.

(function () {
  "use strict";

  const HOST_ID = "mlf-cx4-host";
  document.getElementById(HOST_ID)?.remove();
  if (window.__mlfCx4Timer) clearInterval(window.__mlfCx4Timer);

  const STORE_KEY = "mlf.cx4.tasks.v1";
  const BACKUP_KEY = "mlf.cx4.lastBackup";
  const BACKUP_WARN_DAYS = 7;
  const MAX_SHOWN = 3; // tareas guardadas visibles a la vez (el resto, con el buscador)
  const GID_URL = "https://catalog-domains.adminml.com/catalogo/bc-admin/crear-productos/";
  const NO_CREADO = "No se creó";
  const RESOLUTIONS = ["Optin a misma PDP", "Optin a otra PDP", "Producto generico", "PDP Indefinida", "Item Indefinido", "No se encontro GTIN", "Variante sin stock", "Pain APD", "Sin info Childs", "Desestimar - Otros motivos"];
  const PASTE_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="3" width="11" height="14" rx="2.5"/><path d="M6.5 8C5.5 8.6 5 9.6 5 10.8V18a3 3 0 0 0 3 3h6.5c1.2 0 2.2-.6 2.8-1.6"/></svg>';
  const POLL_MS = 1000;

  // ============================================================
  // Utilidades
  // ============================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  async function waitFor(fn, timeout, step) {
    const end = Date.now() + (timeout || 1500);
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step || 50);
    }
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Escribe como si se tipeara (foco + insertText): los campos controlados por
  // React/Andes lo toman igual que un tipeo real. Si no pega, cae a setNativeValue.
  // Devuelve true si el valor quedó en el campo.
  function writeField(el, value) {
    try {
      el.focus();
      el.select();
      document.execCommand("insertText", false, value);
    } catch (e) {}
    if (el.value !== value) {
      setNativeValue(el, value);
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      } catch (e) {}
    }
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new Event("blur"));
    try { el.blur(); } catch (e) {}
    return el.value === value;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // ============================================================
  // Storage: memoria (verdad de la sesión) + localStorage + IndexedDB
  // ============================================================

  let memStore = {};
  let lastBackupAt = 0;

  try {
    const raw = localStorage.getItem(STORE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === "object") memStore = obj;
    lastBackupAt = parseInt(localStorage.getItem(BACKUP_KEY) || "0", 10) || 0;
  } catch (e) {
    /* localStorage bloqueado: queda solo IndexedDB */
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      try {
        const rq = indexedDB.open("mlf-cx4", 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve) => {
        const r = db.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      });
    } catch (e) {
      return undefined;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  }

  const loadStore = () => memStore;

  async function saveStore() {
    let ls = false;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(memStore));
      ls = true;
    } catch (e) {
      /* ignorar */
    }
    const idb = await idbSet(STORE_KEY, JSON.parse(JSON.stringify(memStore)));
    return ls || idb;
  }

  function markBackup() {
    lastBackupAt = Date.now();
    try {
      localStorage.setItem(BACKUP_KEY, String(lastBackupAt));
    } catch (e) {
      /* ignorar */
    }
  }

  // Si la herramienta (o el usuario) limpió uno de los dos almacenes, el
  // otro lo repone. Se pide además almacenamiento persistente (el
  // navegador puede ignorarlo, pero no cuesta nada).
  async function initPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) {
      /* ignorar */
    }
    const mirror = await idbGet(STORE_KEY);
    let added = 0;
    if (mirror && typeof mirror === "object") {
      for (const [k, v] of Object.entries(mirror)) {
        if (!memStore[k]) {
          memStore[k] = v;
          added++;
        }
      }
    }
    if (added || Object.keys(memStore).length) await saveStore();
    return added;
  }

  const taskKey = (id, domain) => id + "|" + domain;
  // Varias filas pueden tener el mismo Item ID + Variation ID (como en la
  // captura con 2 filas iguales): se distinguen por su orden de aparición
  // (r.dup = 0, 1, 2...) para que cada fila tenga su propio GID.
  const rowKey = (r) => r.itemId + "|" + (r.variationId || "") + "|" + (r.dup || 0);
  function withDup(rows) {
    const seen = {};
    rows.forEach((r) => {
      const b = r.itemId + "|" + (r.variationId || "");
      r.dup = seen[b] = (seen[b] === undefined ? 0 : seen[b] + 1);
    });
    return rows;
  }

  // ============================================================
  // Lectura de la página
  // ============================================================

  function readTaskMeta() {
    const idEl =
      document.querySelector('[data-testid="task-identifier"]') || document.querySelector(".task-identifier");
    const idMatch = idEl ? idEl.textContent.match(/(\d{3,})/) : null;
    const id = idMatch ? idMatch[1] : "";

    let domain = "";
    const items = document.querySelectorAll("li.andes-list__item, li[data-andes-list-item]");
    for (const li of items) {
      const title = li.querySelector("[data-andes-list-title], .andes-list__item-primary");
      if (title && normalize(title.textContent) === "dominio") {
        const val = li.querySelector(".task-context__value");
        if (val) domain = val.textContent.trim();
        break;
      }
    }
    return { id, domain };
  }

  function rowElements() {
    const root = document.getElementById("table-group-table") || document;
    return Array.from(root.querySelectorAll('[data-testid^="backoffice-row-"]'))
      .map((el) => ({ el, idx: parseInt(el.getAttribute("data-testid").replace("backoffice-row-", ""), 10) }))
      .filter((r) => !isNaN(r.idx))
      .sort((a, b) => a.idx - b.idx);
  }

  const cellOf = (rowEl, prefix) => rowEl.querySelector('[data-testid^="backoffice-cell-' + prefix + '"]');

  function resolutionTrigger(rowEl) {
    const cell = cellOf(rowEl, "resolution");
    return cell ? cell.querySelector('[role="combobox"], button.andes-dropdown__trigger') : null;
  }

  function readResolution(rowEl) {
    const trig = resolutionTrigger(rowEl);
    if (!trig) return "";
    const disp = trig.querySelector(".andes-dropdown__display-values") || trig;
    const text = disp.textContent.trim();
    return /^selec/i.test(text) ? "" : text;
  }

  // El GID no está en la página: se escribe a mano en el panel y se
  // conserva en state.gids (por Item ID + Variation ID).
  function readRows(gids) {
    const out = rowElements().map((r, i) => {
      const txt = (p) => {
        const c = cellOf(r.el, p);
        return c ? c.textContent.trim() : "";
      };
      const inp = (p) => {
        const c = cellOf(r.el, p);
        const input = c && c.querySelector("input, textarea");
        return input ? input.value : "";
      };
      const row = {
        n: i + 1,
        itemId: txt("item_id"),
        variationId: txt("variation_id"),
        gid: "",
        resolution: readResolution(r.el),
        force: inp("force_pdp"),
        comment: inp("comment"),
      };
      return row;
    });
    withDup(out);
    out.forEach((row) => {
      row.gid = (gids && gids[rowKey(row)]) || "";
      row.created = state.crea[rowKey(row)] || "";
    });
    return out;
  }

  // ============================================================
  // Restaurar en la página
  // ============================================================

  // react-aria (la librería de los desplegables) escucha eventos de
  // puntero, no solo "click": se emiten los mismos que haría un mouse real.
  function pressLike(el) {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const ptr = Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1 }, base);
    const fire = (type, buttons) => {
      const isPointer = type.indexOf("pointer") === 0 && typeof PointerEvent === "function";
      el.dispatchEvent(isPointer ? new PointerEvent(type, Object.assign({ buttons }, ptr)) : new MouseEvent(type, Object.assign({ buttons }, base)));
    };
    fire("pointerdown", 1);
    fire("mousedown", 1);
    if (el.focus) el.focus({ preventScroll: true });
    fire("pointerup", 0);
    fire("mouseup", 0);
    fire("click", 0);
  }

  function pressKey(el, key) {
    const init = { key, code: key, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  const optionText = (li) => (li.querySelector(".andes-list__item-primary") || li).textContent.trim();

  async function setResolution(rowEl, wanted) {
    const trig = resolutionTrigger(rowEl);
    if (!trig) return { ok: false, why: "no encontré el desplegable" };
    if (normalize(readResolution(rowEl)) === normalize(wanted)) return { ok: true };

    // El menú vive en un popper fuera de la grilla; su id se deriva del del
    // botón: "_r_0_-trigger" -> "_r_0_-menu-list".
    const menuId = trig.id ? trig.id.replace(/-trigger$/, "-menu-list") : "";
    const getOpts = () => {
      const scoped = menuId && document.getElementById(menuId);
      const list = (scoped || document).querySelectorAll('[role="option"]');
      return list.length ? Array.from(list) : null;
    };

    pressLike(trig);
    let opts = await waitFor(getOpts, 1500);
    if (!opts) {
      pressKey(trig, "Enter"); // plan B por teclado
      opts = await waitFor(getOpts, 1500);
    }
    if (!opts) return { ok: false, why: "no se abrió el desplegable" };

    const target = opts.find((li) => normalize(optionText(li)) === normalize(wanted));
    if (!target) {
      pressKey(trig, "Escape");
      pressKey(document.body, "Escape");
      await sleep(100);
      return { ok: false, why: "«" + wanted + "» ya no está entre las opciones" };
    }

    pressLike(target);
    await sleep(200);
    if (normalize(readResolution(rowEl)) !== normalize(wanted)) {
      if (target.isConnected) {
        target.focus && target.focus();
        pressKey(target, "Enter"); // plan B por teclado
        await sleep(200);
      }
    }
    if (normalize(readResolution(rowEl)) === normalize(wanted)) return { ok: true };
    pressKey(document.body, "Escape");
    return { ok: false, why: "se hizo click pero el desplegable no cambió" };
  }

  async function restoreEntry(entry) {
    await waitFor(() => rowElements().length, 6000, 100); // la grilla puede tardar en cargar
    const pageRows = rowElements();
    const used = new Set();
    const report = [];

    for (const saved of entry.rows) {
      const hit = pageRows.find((r) => {
        if (used.has(r.idx)) return false;
        const itemId = (cellOf(r.el, "item_id")?.textContent || "").trim();
        const varId = (cellOf(r.el, "variation_id")?.textContent || "").trim();
        return itemId === saved.itemId && varId === (saved.variationId || "");
      });
      if (!hit) {
        report.push({ n: saved.n, itemId: saved.itemId, ok: false, issues: ["la fila ya no está en la grilla"] });
        continue;
      }
      used.add(hit.idx);
      const issues = [];

      for (const [prefix, field, label] of [
        ["force_pdp", "force", "Producto a forzar"],
        ["comment", "comment", "Comentario"],
      ]) {
        const input = cellOf(hit.el, prefix)?.querySelector("input, textarea");
        if (!input) {
          if (saved[field]) issues.push(label + ": no encontré el campo");
          continue;
        }
        // No se pisa lo que haya cargado el colaborador con un vacío.
        if (saved[field] && input.value !== saved[field] && !writeField(input, saved[field])) issues.push(label + ": la grilla no aceptó el valor");
      }

      if (saved.resolution) {
        const r = await setResolution(hit.el, saved.resolution);
        if (!r.ok) issues.push("Resolución: " + r.why);
      }
      report.push({ n: saved.n, itemId: saved.itemId, ok: !issues.length, issues });
    }
    return report;
  }

  // ============================================================
  // UI (Shadow DOM: los estilos de la herramienta no se cuelan)
  // ============================================================

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { width: 540px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow-y: auto;
      background: #17171a; color: #ececf0; border: 1px solid #34343c; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.55); font-size: 13px; line-height: 1.4; }
    .chip { display: flex; align-items: center; gap: 8px; background: #17171a; color: #ececf0; border: 1px solid #34343c;
      border-radius: 99px; padding: 7px 14px; box-shadow: 0 6px 20px rgba(0,0,0,.5); font-weight: 600; }
    .chip.has { border-color: #f2c14e; color: #f2c14e; }
    .chip.on { border-color: #6fdc8c; }
    .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: #6d6d78; }
    .chip.has .dot { background: #f2c14e; }
    .chip.on .dot { background: #6fdc8c; }
    header { display: flex; align-items: center; gap: 4px; padding: 12px 14px; border-bottom: 1px solid #2a2a31;
      position: sticky; top: 0; background: #17171a; z-index: 1; }
    header h1 { font-size: 15px; margin: 0; flex: 1; }
    header h1 small { font-weight: 400; color: #8b8b96; margin-left: 6px; }
    section { padding: 12px 14px; border-bottom: 1px solid #2a2a31; }
    section:last-child { border-bottom: none; }
    h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8b8b96; margin: 0 0 8px; }
    button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #3b3b45; background: #24242b;
      color: #ececf0; padding: 6px 11px; }
    button:hover { background: #2e2e37; }
    button:disabled { opacity: .5; cursor: default; }
    button.primary { background: #3483fa; border-color: #3483fa; color: #fff; font-weight: 600; }
    button.primary:hover { background: #2968c8; }
    button.danger { background: #c0392b; border-color: #c0392b; color: #fff; }
    button.ghost { background: transparent; border-color: transparent; color: #8b8b96; padding: 2px 8px; font-size: 18px; }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin-bottom: 8px; }
    .meta b { color: #8b8b96; font-weight: 500; }
    .badge { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 99px; background: #2a2a31; color: #b9b9c3; margin-right: 4px; }
    .badge.ok { background: #14351f; color: #6fdc8c; }
    .badge.warn { background: #3d2f10; color: #f2c14e; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 4px 5px; border-bottom: 1px solid #25252c; vertical-align: top; word-break: break-word; }
    th { color: #8b8b96; font-weight: 500; }
    td.n { color: #8b8b96; width: 24px; }
    input.gid { width: 78px; background: #0f0f12; color: #ececf0; border: 1px solid #3b3b45; border-radius: 6px; padding: 3px 5px; font: inherit; }
    input.gid:focus { outline: 1px solid #3483fa; }
    .empty { color: #6d6d78; }
    .msg { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #1f1f25; border: 1px solid #2f2f37; }
    .msg.ok { border-color: #1f5a33; }
    .msg.bad { border-color: #7a2b24; }
    .prompt { padding: 12px 14px; background: #3d2f10; border-bottom: 1px solid #6b5316; color: #fbe3a6; }
    .prompt b { color: #fff; }
    .confirm { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #3a1a17; border: 1px solid #7a2b24; }
    input.search { width: 100%; box-sizing: border-box; margin-bottom: 6px; background: #0f0f12; color: #ececf0; border: 1px solid #3b3b45; border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 12px; }
    input.search:focus { outline: 1px solid #3483fa; }
    .list { max-height: 260px; overflow-y: auto; border: 1px solid #2a2a31; border-radius: 8px; background: #1c1c21; }
    .entry { border-bottom: 1px solid #25252c; }
    .entry:last-child { border-bottom: none; }
    .entry.current { box-shadow: inset 3px 0 0 #3483fa; }
    .entry-head { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 8px; font-size: 12px; }
    .entry-title { flex: 1; min-width: 0; text-align: left; background: transparent; border: none; padding: 4px 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #ececf0; }
    .entry-title:hover { background: transparent; color: #fff; }
    .entry-title small { color: #8b8b96; margin-left: 6px; }
    button.done { padding: 1px 8px; font-size: 13px; line-height: 1.3; color: #8b8b96; }
    button.done:hover { background: #c0392b; border-color: #c0392b; color: #fff; }
    .entry-body { padding: 0 8px 6px; }
    .confirm.mini { margin: 2px 6px 6px; padding: 5px 8px; font-size: 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .confirm.mini button { padding: 2px 9px; font-size: 12px; }
    .review { margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: #172433; border: 1px solid #28507a; }
    .review-t { font-weight: 600; }
    input.created { width: 120px; }
    button.chip-f { float: right; text-transform: none; letter-spacing: 0; font-size: 11px; padding: 1px 8px; border-radius: 999px; }
    button.chip-f.on { background: #1f6f3f; border-color: #2e9a58; color: #fff; }
    button.copy { margin: 0 0 0 6px; vertical-align: middle; }
    button.mini { padding: 2px 6px; margin-top: 3px; line-height: 0; }
    .glink { color: #6ab0ff; cursor: pointer; }
    .glink:hover { text-decoration: underline; }
    .gear-dot { color: #f2c14e; }
    details { padding: 0 10px 8px; }
    summary { cursor: pointer; color: #8b8b96; font-size: 12px; margin-bottom: 6px; }
    .none { color: #6d6d78; padding: 4px 0; }
    ul.issues { margin: 4px 0 0 16px; padding: 0; }
    .hint { color: #8b8b96; font-size: 12px; margin-top: 8px; }
  `;

  const state = {
    meta: { id: "", domain: "" },
    rows: [],
    gids: {}, // rowKey -> GID Creación escrito a mano
    crea: {}, // rowKey -> ID del producto creado (lo completa el colaborador)
    review: null, // { i } mientras se revisan las creaciones fila por fila
    open: false,
    prompt: false, // "¿querés retomar?"
    tracking: new Set(), // tareas con autoguardado activo en esta sesión
    msg: null, // { kind: "ok"|"bad", html }
    confirm: null, // { type: "del"|"save", key }
    busy: false,
    settings: false, // engranaje: respaldos
    expanded: new Set(), // tareas guardadas con el detalle abierto
    search: "", // filtro de la lista de guardadas
    onlyClosable: false, // filtro "Cerrables"
    copied: "", // id recién copiado (para mostrar ✓)
    watchKey: "",
    misses: 0,
  };

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  const fmtDate = (ts) => {
    try {
      return new Date(ts).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
    } catch (e) {
      return "";
    }
  };

  const dash = (v) => (v ? esc(v) : "<span class='empty'>—</span>");

  const gidUrl = (gid) => GID_URL + encodeURIComponent(gid);
  // No es un <a>: la página podría interceptar los links y navegar en la
  // misma pestaña. Se abre a mano con window.open (siempre pestaña nueva).
  const gidLink = (gid) => '<span class="glink" role="link" tabindex="0" data-act="open-gid" data-url="' + esc(gidUrl(gid)) + '" title="Abrir la creación de este GID en otra pestaña">' + esc(gid) + " ↗</span>";
  // Filas que se revisan: solo las que tienen GID Creación cargado.
  const reviewIdx = (rows) => rows.map((r, i) => (r.gid ? i : -1)).filter((i) => i >= 0);
  // Botón de copiar el identificador de la tarea (muestra ✓ un instante).
  const copyBtn = (id) =>
    '<button class="mini copy" data-act="copy-id" data-id="' + esc(id) + '" title="Copiar el identificador ' + esc(id) + '" aria-label="Copiar identificador">' +
    (state.copied === id ? "✓" : PASTE_ICON) + "</button>";
  const hasId = (r) => r.created && r.created !== NO_CREADO;

  function rowsTable(rows, editable) {
    if (!rows.length) return '<div class="none">Sin filas.</div>';
    return (
      "<table><thead><tr><th>#</th><th>Item ID</th><th>GID Creación</th><th>Resolución</th><th>Forzar</th><th>Comentario</th></tr></thead><tbody>" +
      rows
        .map((r, i) => {
          let gidCell = editable
            ? '<input class="gid" data-gid="' + esc(rowKey(r)) + '" value="' + esc(r.gid) + '" placeholder="GID" maxlength="40">' +
              (r.gid ? "<br>" + gidLink(r.gid) : "")
            : r.gid ? gidLink(r.gid) : dash("");
          if (r.created) gidCell += "<br><span class='empty'>" + (hasId(r) ? "ID " : "") + esc(r.created) + "</span>";
          const paste = (field) =>
            editable && hasId(r) ? '<br><button class="mini" data-act="paste-id" data-field="' + field + '" data-i="' + i + '" title="Pegar ' + esc(r.created) + ' acá" aria-label="Pegar ID">' + PASTE_ICON + "</button>" : "";
          return (
            "<tr><td class='n'>" + r.n + "</td><td>" + esc(r.itemId) +
            (r.variationId ? "<br><span class='empty'>var " + esc(r.variationId) + "</span>" : "") +
            "</td><td>" + gidCell + "</td><td>" + dash(r.resolution) + "</td><td>" + dash(r.force) + paste("force") + "</td><td>" + dash(r.comment) + paste("comment") + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>"
    );
  }

  const currentKey = () => (state.meta.id && state.meta.domain ? taskKey(state.meta.id, state.meta.domain) : "");
  const isTyping = () => !!(shadow.activeElement && shadow.activeElement.tagName === "INPUT" && shadow.activeElement.type !== "checkbox");

  function backupBadge(count) {
    if (!count) return "";
    const days = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86400000) : null;
    if (days === null) return '<span class="badge warn">Sin respaldo todavía</span>';
    if (days >= BACKUP_WARN_DAYS) return '<span class="badge warn">Último respaldo hace ' + days + " días</span>";
    return '<span class="badge ok">Último respaldo: ' + (days === 0 ? "hoy" : "hace " + days + " d") + "</span>";
  }

  function render() {
    const store = loadStore();
    const key = currentKey();
    const { id, domain } = state.meta;
    const saved = key ? store[key] : null;
    const entries = Object.entries(store).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    const tracking = key && state.tracking.has(key);

    // Chip minimizado
    if (!state.open) {
      const cls = tracking ? "chip on" : saved ? "chip has" : "chip";
      shadow.innerHTML =
        "<style>" + CSS + "</style>" +
        '<button class="' + cls + '" data-act="toggle" title="Abrir Cx4"><span class="dot"></span>Cx4' +
        (saved && !tracking ? " · tarea guardada" : tracking ? " · autoguardando" : "") +
        (entries.length ? " · " + entries.length : "") + "</button>";
      return;
    }

    let current = "";
    if (key) {
      const rowsNow = state.rows;
      const emptyRes = rowsNow.filter((r) => !r.resolution).length;
      current += '<div class="meta"><b>Tarea</b><span>' + esc(id) + copyBtn(id) + "</span><b>Dominio</b><span>" + esc(domain) + "</span></div>";
      current +=
        '<div style="margin-bottom:8px">' +
        (saved
          ? '<span class="badge ok">Guardada ' + esc(fmtDate(saved.savedAt)) + "</span>"
          : '<span class="badge">No guardada todavía</span>') +
        (tracking ? '<span class="badge ok">Autoguardado activo</span>' : "") +
        (rowsNow.length && emptyRes ? '<span class="badge warn">' + emptyRes + " fila(s) sin resolución</span>" : "") +
        (rowsNow.length && !emptyRes ? '<span class="badge ok">✔ Se puede cerrar</span>' : "") +
        "</div>";
      const revIdx = reviewIdx(rowsNow);
      if (state.review && revIdx.length) {
        const k = Math.min(state.review.i, revIdx.length - 1);
        const i = revIdx[k];
        const r = rowsNow[i];
        current +=
          '<div class="review"><div class="review-t">Creación ' + (k + 1) + " de " + revIdx.length + " · fila " + r.n + " · " + esc(r.itemId) + "</div>" +
          '<div style="margin:4px 0">GID Creación: ' + gidLink(r.gid) + "</div>" +
          '<div style="margin:6px 0">ID creado: <input class="gid created" data-created="' + esc(rowKey(r)) + '" value="' + esc(r.created) + '" placeholder="ID del producto" maxlength="40">' +
          ' <button data-act="no-created" data-key="' + esc(rowKey(r)) + '">No se creó</button></div>' +
          '<div style="margin:6px 0">Resolución: <select data-res="' + i + '">' +
          (r.resolution ? "" : "<option value=\"\">— elegir —</option>") +
          RESOLUTIONS.map((t) => "<option" + (normalize(t) === normalize(r.resolution) ? " selected" : "") + ">" + esc(t) + "</option>").join("") +
          "</select></div>" +
          '<div class="row-actions"><button data-act="review-prev"' + (k ? "" : " disabled") + ">‹ Anterior</button>" +
          '<button class="primary" data-act="review-next">' + (k < revIdx.length - 1 ? "Siguiente ›" : "Terminar") + "</button>" +
          '<button data-act="review-close">Cerrar</button></div></div>';
      }
      current += rowsTable(rowsNow, true);
      if (!rowsNow.length) current += '<div class="msg bad">No encontré filas en la grilla. ¿Está cargada la tarea?</div>';
      current += '<div class="row-actions">';
      current += '<button class="primary" data-act="save"' + (rowsNow.length ? "" : " disabled") + ">" + (saved ? "Actualizar" : "Guardar") + "</button>";
      if (saved) current += '<button data-act="restore"' + (state.busy ? " disabled" : "") + ' title="Escribe en la grilla lo que tenías guardado">Pegar</button>';
      current += '<button data-act="review"' + (rowsNow.length ? "" : " disabled") + ">Revisar creaciones</button>";
      current += "</div>";
      if (state.confirm && state.confirm.type === "save") {
        current +=
          '<div class="confirm">Ya hay una versión guardada de esta tarea con datos distintos. ¿Reemplazarla por lo que se ve ahora?' +
          '<div class="row-actions"><button class="danger" data-act="save-yes">Sí, reemplazar</button><button data-act="cancel">Cancelar</button></div></div>';
      }
      current += '<div class="hint">El GID no figura en la grilla: escribilo acá y se guarda con la tarea.</div>';
    } else {
      current +=
        '<div class="msg bad">No detecté el Identificador o el Dominio en esta página. Abrí la tarjeta de la tarea; Cx4 la detecta sola. Igual podés ver y borrar las guardadas abajo.</div>';
    }
    if (state.msg) current += '<div class="msg ' + state.msg.kind + '">' + state.msg.html + "</div>";

    let promptHtml = "";
    if (state.prompt && saved) {
      promptHtml =
        '<div class="prompt">Estás en la tarea <b>' + esc(id) + " · " + esc(domain) + "</b>, que tiene datos guardados (" +
        saved.rows.length + " fila/s, " + esc(fmtDate(saved.savedAt)) + "). <b>¿Querés retomarla?</b> Se cargan los valores guardados y desde ahí se autoguarda." +
        '<div class="row-actions"><button class="primary" data-act="resume"' + (state.busy ? " disabled" : "") + ">" + (state.busy ? "Cargando…" : "Retomar") + '</button><button data-act="dismiss-prompt">Ahora no</button></div></div>';
    }

    // Lista comprimida: una línea por tarea. Clic en el texto = ver filas;
    // botón ✓ = marcar como hecha (pide confirmación antes de borrar).
    let list = "";
    const q = state.search.trim().toLowerCase();
    const isClosable = (e) => e.rows.length > 0 && e.rows.every((r) => r.resolution);
    const closableCount = entries.filter(([, e]) => isClosable(e)).length;
    const matches = entries.filter(
      ([, e]) =>
        (!state.onlyClosable || isClosable(e)) &&
        (!q || (e.id + " " + e.domain + " " + e.rows.map((r) => r.itemId + " " + (r.gid || "")).join(" ")).toLowerCase().includes(q))
    );
    const shown = matches.slice(0, MAX_SHOWN);
    if (!entries.length) list = '<div class="none" style="padding:6px 8px">Todavía no guardaste ninguna tarea.</div>';
    else if (!matches.length) list = '<div class="none" style="padding:6px 8px">Sin resultados.</div>';
    for (const [k, e] of shown) {
      const isCur = k === key;
      const confirming = state.confirm && state.confirm.type === "del" && state.confirm.key === k;
      const open = state.expanded.has(k);
      const d = new Date(e.savedAt);
      const short = isNaN(d) ? "" : d.getDate() + "/" + (d.getMonth() + 1);
      list +=
        '<div class="entry' + (isCur ? " current" : "") + '">' +
        '<div class="entry-head"><button class="entry-title" data-act="expand" data-key="' + esc(k) + '" title="Ver filas">' +
        (open ? "▾ " : "▸ ") + "<b>" + esc(e.id) + "</b> · " + esc(e.domain) + "<small>" + e.rows.length + "f · " + esc(short) + (isClosable(e) ? " · ✔ cerrable" : "") + "</small></button>" +
        copyBtn(e.id) +
        '<button class="done" data-act="tick" data-key="' + esc(k) + '" title="Borrar esta tarea (pide confirmación)">✕</button></div>';
      if (confirming) {
        list +=
          '<div class="confirm mini">¿Borrar la ' + esc(e.id) + "? No se puede deshacer." +
          '<button class="danger" data-act="del-yes" data-key="' + esc(k) + '">Sí, borrar</button><button data-act="cancel">No</button></div>';
      }
      if (open) list += '<div class="entry-body">' + rowsTable(e.rows, false) + "</div>";
      list += "</div>";
    }
    if (matches.length > shown.length) {
      list += '<div class="none" style="padding:4px 8px">+' + (matches.length - shown.length) + " más: usá el buscador.</div>";
    }

    const overdue = entries.length && (!lastBackupAt || Date.now() - lastBackupAt >= BACKUP_WARN_DAYS * 86400000);
    const settingsHtml = state.settings
      ? "<section><h2>Respaldos</h2>" +
        '<div class="hint" style="margin:0 0 6px">Lo guardado vive solo en este navegador: si se borran sus datos, se pierde. Un respaldo es una copia para recuperarlo.</div>' +
        backupBadge(entries.length) +
        '<div class="row-actions">' +
        '<button data-act="download"' + (entries.length ? "" : " disabled") + ">Descargar respaldo (.json)</button>" +
        '<button data-act="import-file">Cargar respaldo (archivo)</button>' +
        '<input type="file" accept=".json,application/json" data-file style="display:none">' +
        "</div>" +
        '<div class="hint" style="margin-top:10px">Si no te deja descargar o abrir archivos, por portapapeles:</div>' +
        '<div class="row-actions" style="margin-top:4px"><button data-act="export"' + (entries.length ? "" : " disabled") + ">Copiar respaldo</button>" +
        '<button data-act="import">Pegar respaldo</button></div></section>'
      : "";

    shadow.innerHTML =
      "<style>" + CSS + "</style>" +
      '<div class="panel">' +
      '<header><h1>Cx4<small>tareas postergadas</small></h1>' +
      '<button class="ghost" data-act="settings" title="Configuración y respaldos' + (overdue ? " (hace falta un respaldo)" : "") + '">⚙' + (overdue ? '<span class="gear-dot">•</span>' : "") + "</button>" +
      '<button class="ghost" data-act="toggle" title="Minimizar">–</button><button class="ghost" data-act="close" title="Cerrar del todo (deja de vigilar)">×</button></header>' +
      promptHtml +
      settingsHtml +
      "<section><h2>Esta tarea</h2>" + current + "</section>" +
      "<section><h2>Guardadas (" + entries.length + ")" +
      (entries.length
        ? ' <button class="chip-f' + (state.onlyClosable ? " on" : "") + '" data-act="filter-closable" title="Mostrar solo las tareas con todas las filas resueltas">✔ Cerrables (' + closableCount + ")</button>"
        : "") +
      "</h2>" +
      (entries.length > MAX_SHOWN || q
        ? '<input class="search" data-search placeholder="Buscar por tarea, dominio, Item ID o GID" value="' + esc(state.search) + '">'
        : "") +
      '<div class="list">' + list + "</div></section></div>";
  }

  // ============================================================
  // Acciones
  // ============================================================

  async function persistEntry(msgOnOk) {
    const { id, domain } = state.meta;
    const store = loadStore();
    store[taskKey(id, domain)] = { id, domain, savedAt: Date.now(), rows: state.rows.map((r) => Object.assign({}, r)) };
    const ok = await saveStore();
    state.tracking.add(taskKey(id, domain));
    state.prompt = false;
    state.confirm = null;
    if (msgOnOk !== null) {
      state.msg = ok
        ? { kind: "ok", html: msgOnOk || "Guardada: tarea " + esc(id) + " · " + esc(domain) + " (" + state.rows.length + " fila/s). Desde ahora se autoguarda." }
        : { kind: "bad", html: "No pude guardar (almacenamiento bloqueado o lleno). Usá un respaldo para no perder los datos." };
    }
    return ok;
  }

  function importFromText(text) {
    try {
      const data = JSON.parse(text);
      const incoming = data && data.cx4 === 1 && data.tasks && typeof data.tasks === "object" ? data.tasks : null;
      if (!incoming) throw new Error("formato");
      const store = loadStore();
      let n = 0;
      for (const [k, v] of Object.entries(incoming)) {
        if (v && v.id && v.domain && Array.isArray(v.rows) && !store[k]) {
          store[k] = v; // no pisa las que ya están
          n++;
        }
      }
      return { n };
    } catch (e) {
      return { error: true };
    }
  }

  function backupJson() {
    return JSON.stringify({ cx4: 1, exportedAt: new Date().toISOString(), tasks: loadStore() }, null, 1);
  }

  function downloadBackup() {
    const blob = new Blob([backupJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cx4-respaldo-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function runRestore() {
    const entry = loadStore()[currentKey()];
    if (!entry) return;
    state.busy = true;
    render();
    const report = await restoreEntry(entry);
    state.busy = false;
    const bad = report.filter((r) => !r.ok);
    state.rows = readRows(state.gids);
    state.tracking.add(currentKey()); // desde acá se autoguarda lo que vaya haciendo
    state.prompt = false;
    state.msg = {
      kind: bad.length ? "bad" : "ok",
      html:
        (bad.length
          ? "Restauradas " + (report.length - bad.length) + " de " + report.length + " fila(s). Revisá:"
          : "Restauradas " + report.length + " fila(s). Revisá en pantalla antes de enviar.") +
        (bad.length
          ? '<ul class="issues">' +
            bad.map((r) => "<li>Fila " + r.n + " (" + esc(r.itemId) + "): " + r.issues.map(esc).join("; ") + "</li>").join("") +
            "</ul>"
          : ""),
    };
  }

  async function onAction(act, el) {
    state.msg = null;
    if (act === "close") {
      clearInterval(window.__mlfCx4Timer);
      host.remove();
      return;
    }
    if (act === "toggle") {
      state.open = !state.open;
    } else if (act === "settings") {
      state.settings = !state.settings;
    } else if (act === "expand") {
      const k = el.dataset.key;
      if (state.expanded.has(k)) state.expanded.delete(k);
      else state.expanded.add(k);
    } else if (act === "filter-closable") {
      state.onlyClosable = !state.onlyClosable;
    } else if (act === "copy-id") {
      const id = el.dataset.id;
      const ok = await copyText(id);
      if (ok) {
        state.copied = id;
        setTimeout(() => {
          state.copied = "";
          if (!isTyping()) render();
        }, 1200);
      } else state.msg = { kind: "bad", html: "No pude copiar al portapapeles." };
    } else if (act === "review") {
      state.rows = readRows(state.gids);
      if (reviewIdx(state.rows).length) state.review = { i: 0 };
      else state.msg = { kind: "bad", html: "Ninguna fila tiene GID Creación cargado. Cargalo en la tabla y volvé a tocar Revisar creaciones." };
    } else if (act === "review-next") {
      if (!state.review || state.review.i >= reviewIdx(state.rows).length - 1) state.review = null;
      else state.review.i++;
    } else if (act === "review-prev") {
      state.review.i = Math.max(0, state.review.i - 1);
    } else if (act === "review-close") {
      state.review = null;
    } else if (act === "no-created") {
      await setRowField(el.dataset.key, "created", NO_CREADO);
    } else if (act === "paste-id") {
      const r = state.rows[Number(el.dataset.i)];
      const pageRow = rowElements()[Number(el.dataset.i)];
      const input = pageRow && cellOf(pageRow.el, el.dataset.field === "force" ? "force_pdp" : "comment")?.querySelector("input, textarea");
      if (!r || !input) state.msg = { kind: "bad", html: "No encontré ese campo en la grilla." };
      else {
        const cur = input.value.trim();
        const v = el.dataset.field === "comment" && cur && !cur.includes(r.created) ? cur + " " + r.created : r.created;
        const wrote = writeField(input, v);
        await sleep(150);
        const stuck = input.isConnected && input.value === v;
        state.rows = readRows(state.gids);
        const tk = currentKey();
        if (state.tracking.has(tk)) await autosaveIfNeeded(tk); // que el valor pegado quede guardado
        if (!wrote || !stuck) await copyText(r.created);
        if (!wrote || !stuck) state.msg = { kind: "bad", html: "No se pudo pegar " + esc(r.created) + " en la fila " + r.n + ": la grilla no aceptó el valor. Pegalo a mano (queda copiado en el portapapeles)." };
        else state.msg = { kind: "ok", html: "Pegado " + esc(r.created) + " en " + (el.dataset.field === "force" ? "Producto a forzar" : "Comentario") + " (fila " + r.n + ")." };
      }
    } else if (act === "save") {
      state.rows = readRows(state.gids); // siempre lo que se ve AHORA
      const prev = loadStore()[currentKey()];
      if (prev && JSON.stringify(prev.rows) !== JSON.stringify(state.rows)) state.confirm = { type: "save" };
      else await persistEntry();
    } else if (act === "save-yes") {
      await persistEntry();
    } else if (act === "cancel") {
      state.confirm = null;
    } else if (act === "tick") {
      // El tick solo abre la confirmación; recién "Sí, borrar" borra.
      const same = state.confirm && state.confirm.type === "del" && state.confirm.key === el.dataset.key;
      state.confirm = same ? null : { type: "del", key: el.dataset.key };
    } else if (act === "del-yes") {
      delete loadStore()[el.dataset.key];
      state.tracking.delete(el.dataset.key);
      await saveStore();
      state.confirm = null;
      state.msg = { kind: "ok", html: "Tarea borrada." };
    } else if (act === "restore" || act === "resume") {
      await runRestore();
    } else if (act === "dismiss-prompt") {
      state.prompt = false;
    } else if (act === "download") {
      downloadBackup();
      markBackup();
      state.msg = { kind: "ok", html: "Respaldo descargado. Guardalo en un lugar fuera del navegador (OneDrive, mail a vos mismo, etc.)." };
    } else if (act === "export") {
      const ok = await copyText(backupJson());
      if (ok) markBackup();
      state.msg = ok
        ? { kind: "ok", html: "Respaldo copiado al portapapeles. Pegalo en un archivo de texto para guardarlo." }
        : { kind: "bad", html: "No pude copiar al portapapeles." };
    } else if (act === "import-file") {
      const input = shadow.querySelector("[data-file]");
      if (input) input.click();
      return; // sigue en el evento change del input
    } else if (act === "import") {
      const text = window.prompt("Pegá acá el respaldo de Cx4 (Ctrl+V):", "");
      if (text) {
        const r = importFromText(text);
        if (r.error) state.msg = { kind: "bad", html: "Ese texto no es un respaldo válido de Cx4." };
        else {
          await saveStore();
          state.msg = { kind: "ok", html: "Importadas " + r.n + " tarea(s) nuevas (las ya existentes no se tocan)." };
        }
      }
    }
    render();
  }

  shadow.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    if (el.dataset.act === "open-gid") {
      ev.preventDefault();
      const w = window.open(el.dataset.url, "_blank");
      if (w) {
        try { w.opener = null; } catch (e) {}
      } else {
        state.msg = { kind: "bad", html: "El navegador bloqueó la pestaña nueva. Permití ventanas emergentes para este sitio." };
        render();
      }
      return;
    }
    onAction(el.dataset.act, el);
  });

  // Que la página (modales, "click afuera", trampas de foco) no vea ni
  // se coma los eventos hechos dentro del panel.
  ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "focusin"].forEach((t) =>
    host.addEventListener(t, (ev) => ev.stopPropagation())
  );

  // field: "gid" | "created". quiet=true no re-dibuja (viene de tipear).
  async function setRowField(k, field, value, quiet) {
    (field === "gid" ? state.gids : state.crea)[k] = value;
    state.rows.forEach((r) => {
      if (rowKey(r) === k) r[field] = value;
    });
    const saved = loadStore()[currentKey()];
    if (saved) {
      withDup(saved.rows).forEach((r) => {
        if (rowKey(r) === k) r[field] = value;
      });
      await saveStore();
    }
    if (!quiet) render();
  }

  shadow.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t.matches && t.matches("[data-search]"))) return;
    state.search = t.value;
    const pos = t.selectionStart;
    render();
    const n = shadow.querySelector("[data-search]");
    if (n) {
      n.focus();
      try { n.setSelectionRange(pos, pos); } catch (e) {}
    }
  });

  shadow.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.matches && t.matches('[data-act="tick"]')) {
      onAction("tick", t);
    } else if (t.matches && t.matches("select[data-res]")) {
      // Cambiar la Resolución de la fila en la grilla real (desde la revisión).
      const i = Number(t.dataset.res);
      const pageRow = rowElements()[i];
      if (t.value && pageRow) {
        state.busy = true;
        const r = await setResolution(pageRow.el, t.value);
        state.busy = false;
        state.msg = r.ok ? null : { kind: "bad", html: "Resolución: " + esc(r.why) };
      }
      state.rows = readRows(state.gids);
      const key = currentKey();
      if (state.tracking.has(key)) await autosaveIfNeeded(key);
      render();
    } else if (t.matches && t.matches("input.gid")) {
      // Persistir sin re-renderizar (si se re-renderizara entre el
      // mousedown y el mouseup de otro botón, se perdería ese click).
      if (t.dataset.created) await setRowField(t.dataset.created, "created", t.value.trim(), true);
      else await setRowField(t.dataset.gid, "gid", t.value.trim(), true);
    } else if (t.matches && t.matches("[data-file]")) {
      const file = t.files && t.files[0];
      if (!file) return;
      const text = await file.text();
      const r = importFromText(text);
      if (r.error) state.msg = { kind: "bad", html: "Ese archivo no es un respaldo válido de Cx4." };
      else {
        await saveStore();
        state.msg = { kind: "ok", html: "Importadas " + r.n + " tarea(s) nuevas del archivo (las ya existentes no se tocan)." };
      }
      render();
    }
  });

  // ============================================================
  // Vigilancia de la tarea abierta
  // ============================================================

  function readMeta() {
    state.meta = readTaskMeta();
    return currentKey();
  }

  function hydrateGids(saved) {
    state.gids = {};
    state.crea = {};
    state.review = null;
    if (saved)
      withDup(saved.rows).forEach((r) => {
        if (r.gid) state.gids[rowKey(r)] = r.gid;
        if (r.created) state.crea[rowKey(r)] = r.created;
      });
  }

  async function autosaveIfNeeded(key) {
    const saved = loadStore()[key];
    if (!saved || !state.rows.length) return;
    // Solo si es la misma tarea completa (mismas filas): nunca autoguardar
    // una grilla a medio cargar.
    if (saved.rows.length !== state.rows.length) return;
    const ids = new Set(withDup(saved.rows).map(rowKey));
    if (!state.rows.every((r) => ids.has(rowKey(r)))) return;
    if (JSON.stringify(saved.rows) === JSON.stringify(state.rows)) return;
    // Si la grilla se recargó en blanco (todo vacío) pero lo guardado tenía
    // datos, no se pisa: se vuelve a ofrecer retomar.
    const hasData = (rows) => rows.some((r) => r.resolution || r.force || r.comment);
    if (!hasData(state.rows) && hasData(saved.rows)) {
      state.tracking.delete(key);
      state.prompt = true;
      state.open = true;
      return;
    }
    await persistEntry(null);
  }

  async function tick() {
    if (!host.isConnected) {
      clearInterval(window.__mlfCx4Timer);
      return;
    }
    if (state.busy) return;
    const prev = currentKey();
    const meta = readTaskMeta();
    const key = meta.id && meta.domain ? taskKey(meta.id, meta.domain) : "";

    // Cambio de tarea (con tolerancia: si el DOM se rearma, un instante sin
    // identificador no cuenta como "salí de la tarea").
    if (key !== state.watchKey) {
      if (!key && state.watchKey && ++state.misses < 3) return;
      state.misses = 0;
      state.watchKey = key;
      state.meta = meta;
      state.tracking.clear(); // el autoguardado vale solo mientras se está en esa tarea
      state.confirm = null;
      state.msg = null;
      const saved = key ? loadStore()[key] : null;
      hydrateGids(saved);
      state.rows = readRows(state.gids);
      state.prompt = !!saved && !state.tracking.has(key);
      if (state.prompt) state.open = true;
      render();
      return;
    }
    state.misses = 0;
    if (!key) return;

    const rows = readRows(state.gids);
    if (JSON.stringify(rows) !== JSON.stringify(state.rows)) {
      state.rows = rows;
      if (state.tracking.has(key)) await autosaveIfNeeded(key);
      if (state.open && !isTyping()) render();
      else if (!state.open) render();
    }
    void prev;
  }

  // ============================================================
  // Arranque
  // ============================================================

  (async function init() {
    const restored = await initPersistence();
    readMeta();
    state.watchKey = currentKey();
    const saved = state.watchKey ? loadStore()[state.watchKey] : null;
    hydrateGids(saved);
    state.rows = readRows(state.gids);
    state.open = true; // al tocar el bookmarklet se abre el panel
    state.prompt = !!saved;
    if (restored) {
      state.msg = { kind: "ok", html: "Se recuperaron " + restored + " tarea(s) desde la copia interna (el almacenamiento principal estaba vacío)." };
    }
    render();
    window.__mlfCx4Timer = setInterval(tick, POLL_MS);
  })();
})();
