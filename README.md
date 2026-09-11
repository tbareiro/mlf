# MLF Bookmarklets

Prototipo interno para el equipo de catálogo de MercadoLibre. Dos
bookmarklets — bookmarks comunes con código JS en el `href`, no
extensiones — que aceleran crear "productos" de catálogo a partir de un
"item" de vendedor:

- **MLF Copiar**: parado en una publicación de ML, extrae atributos
  (título, descripción, tabla de specs, bullets, selector de variación) y
  los copia al portapapeles como JSON, con un picker para elegir cuáles.
- **MLF Pegar**: parado en la ficha de carga interna, lee ese JSON del
  portapapeles y completa los campos (texto, selects, dropdowns Andes
  simples/multi-selección, toggles Sí/No, editores enriquecidos, campos
  número+unidad), con un toast final resumiendo qué se completó, qué
  quedó aproximado y qué no matcheó.

Sitio en vivo: https://mlf-bookmarklets.vercel.app

## Por qué existe / restricciones de diseño

- **Cero instalación**: nada de extensiones de Chrome — el equipo no
  puede instalarlas en las máquinas de trabajo. Por eso son bookmarklets.
- La herramienta interna real (`catalog-domains.adminml.com`) está detrás
  de VPN; el desarrollo/testing se validó contra el flujo equivalente
  público de MercadoLibre (`vendedores.mercadolibre.com.ar/catalogo/...`)
  como stand-in de la UI (misma librería de componentes Andes).
- **Es un prototipo para proponer al equipo, no una herramienta en
  producción sin supervisión.** Nunca clickea Guardar/Finalizar/Enviar —
  eso queda siempre en manos de la persona. Ver la sección "Lo que esto
  no hace" en `index.html` para el resto de las guardas.

## Estructura

```
copiar.src.js         # fuente del bookmarklet "Copiar" (editar acá)
pegar.src.js           # fuente del bookmarklet "Pegar" (editar acá)
copiar.beta.src.js     # build separada de Copiar con detección de
                        # variantes de color — feature sin confirmar por
                        # el equipo todavía, linkeada aparte en el footer
                        # del sitio para no tocar el botón principal
build.js                # arma copiar.url.txt / pegar.url.txt a partir de
                        # los .min.js (no toca copiar.beta ni index.html)
index.html              # la página en sí (estático, sin build propio)
```

Generado por el build y **no versionado** (ver `.gitignore`):
`*.min.js`, `*.url.js`, `*.url.txt` — es el código compilado que
`index.html` carga vía `<script src="copiar.url.js">` etc.

## Build

```bash
npx terser copiar.src.js --compress --mangle -o copiar.min.js
npx terser pegar.src.js --compress --mangle -o pegar.min.js
npx terser copiar.beta.src.js --compress --mangle -o copiar.beta.min.js
node build.js   # genera copiar.url.txt y pegar.url.txt (URI-encoded)
```

El contenido de cada `.url.txt` se pega a mano en el `.url.js`
correspondiente como `window.MLF_COPIAR_HREF = "javascript:...";`
(`build.js` no toca `copiar.beta.url.js` ni `index.html` — son manuales).
Después `node --check archivo.url.js` para validar sintaxis antes de
deployar.

## Cómo probarlo local

Sin servidor: abrir `index.html` directo en el navegador (`file://`)
funciona, ya que todo es estático y sin build propio del lado del
cliente. Los tres `.url.js` tienen que existir (generados como arriba)
para que los botones tengan `href`.

## Qué mirar en la revisión

- `copiar.src.js` y `pegar.src.js` concentran toda la lógica real — vale
  la pena revisar particularmente: el matching de labels entre la
  publicación de ML y los campos del formulario interno (`findContainerForLabel`
  en `pegar.src.js`, con sus niveles de fuzzy matching), y el manejo de
  atributos multi-valor / duplicados en `copiar.src.js`
  (`splitMultiValue`, `dedupeByLabel`).
- No hay tests automatizados — todo el testing fue manual, en vivo,
  contra publicaciones reales de ML y el flujo público equivalente al
  interno. Si conviene sumar tests (aunque sea unitarios de las
  funciones de parsing/matching, que son puras) es una buena primera
  sugerencia a evaluar.
- `copiar.beta.src.js` es una feature sin terminar de validar por el
  equipo (avisa cuando una publicación tiene variantes de color pero no
  las recorre solo) — enlazada aparte, discreta, en el footer del sitio.
- Sin manejo de errores centralizado ni logging — los fallos de matching
  se reportan al usuario en el toast final, pero no hay forma de ver qué
  pasó salvo reproducir en vivo.
