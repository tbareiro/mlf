// Build step para Vercel (ver vercel.json: "buildCommand"). Corre terser
// sobre cada .src.js y escribe el .min.js / .url.txt / .url.js
// correspondiente — lo mismo que build.js hacía a mano para copiar/pegar,
// pero para los 6 bookmarklets que sí tienen fuente legible.
//
// pegar.comparator.url.js queda afuera: no existe pegar.comparator.src.js
// todavía (se armó a partir de un build que ya venía minificado), así que
// ese archivo se versiona directamente en git en vez de regenerarse acá.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;

const PAIRS = [
  ["copiar.src.js", "copiar.min.js", "copiar.url.txt", "copiar.url.js", "MLF_COPIAR_HREF"],
  ["pegar.src.js", "pegar.min.js", "pegar.url.txt", "pegar.url.js", "MLF_PEGAR_HREF"],
  ["copiar.beta.src.js", "copiar.beta.min.js", "copiar.beta.url.txt", "copiar.beta.url.js", "MLF_COPIAR_BETA_HREF"],
  ["copiar.variantes.src.js", "copiar.variantes.min.js", "copiar.variantes.url.txt", "copiar.variantes.url.js", "MLF_COPIAR_VARIANTES_HREF"],
  ["pegar.variante.src.js", "pegar.variante.min.js", "pegar.variante.url.txt", "pegar.variante.url.js", "MLF_PEGAR_VARIANTE_HREF"],
  ["copiar.comparator.src.js", "copiar.comparator.min.js", "copiar.comparator.url.txt", "copiar.comparator.url.js", "MLF_COPIAR_COMPARATOR_HREF"],
  ["copiar.fotos.src.js", "copiar.fotos.min.js", "copiar.fotos.url.txt", "copiar.fotos.url.js", "MLF_COPIAR_FOTOS_HREF"],
  ["pegar.fotos.src.js", "pegar.fotos.min.js", "pegar.fotos.url.txt", "pegar.fotos.url.js", "MLF_PEGAR_FOTOS_HREF"],
];

for (const [src, min, urlTxt, urlJs, varName] of PAIRS) {
  const srcPath = path.join(dir, src);
  const minPath = path.join(dir, min);
  execSync(`npx terser "${srcPath}" --compress --mangle -o "${minPath}"`, { stdio: "inherit" });
  const code = fs.readFileSync(minPath, "utf8").trim();
  const uri = "javascript:" + encodeURIComponent(code);
  fs.writeFileSync(path.join(dir, urlTxt), uri);
  fs.writeFileSync(path.join(dir, urlJs), `window.${varName} = ${JSON.stringify(uri)};\n`);
  console.log("built", urlJs);
}

console.log("OK: build-all listo (pegar.comparator.url.js se versiona a mano, no se regenera acá).");
