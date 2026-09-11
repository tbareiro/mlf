// Genera las URIs "javascript:..." a partir de los .min.js (producidos por
// terser) y las deja en bookmarklets/copiar.url.txt y bookmarklets/pegar.url.txt.
//
// index.html está hecho a mano (con estilos propios) y este script NO lo
// toca. Después de correrlo, copiá el contenido de cada .url.txt a mano
// dentro de copiar.url.js / pegar.url.js (window.MLF_COPIAR_HREF /
// window.MLF_PEGAR_HREF) y redeployá.
//
// Uso:
//   npx terser bookmarklets/copiar.src.js --compress --mangle -o bookmarklets/copiar.min.js
//   npx terser bookmarklets/pegar.src.js  --compress --mangle -o bookmarklets/pegar.min.js
//   node bookmarklets/build.js

const fs = require("fs");
const path = require("path");

const dir = __dirname;

function buildBookmarklet(minFile) {
  const code = fs.readFileSync(path.join(dir, minFile), "utf8").trim();
  return "javascript:" + encodeURIComponent(code);
}

const copiarUri = buildBookmarklet("copiar.min.js");
const pegarUri = buildBookmarklet("pegar.min.js");

fs.writeFileSync(path.join(dir, "copiar.url.txt"), copiarUri);
fs.writeFileSync(path.join(dir, "pegar.url.txt"), pegarUri);

console.log("OK: copiar.url.txt, pegar.url.txt generados.");
console.log("Recordá: pegar el contenido a mano en copiar.url.js / pegar.url.js — index.html no se toca acá.");
