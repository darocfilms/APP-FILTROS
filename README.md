# Laboratorio

Aplicación web de cámara y revelado fotográfico para iPhone. Emulsiones
reales aplicadas en directo sobre el visor, grabación de vídeo, un laboratorio
de edición completo y exportación a resolución original.

Todo se ejecuta en el dispositivo. No hay servidor, no hay cuenta, no se sube
nada a ninguna parte.

---

## Puesta en marcha

```bash
node serve.mjs            # http://localhost:8080
node serve.mjs --https    # https://localhost:8443 — necesario para probar en el iPhone
```

Sin dependencias: sólo hace falta Node para servir los archivos estáticos.
También vale cualquier otro servidor (`python3 -m http.server`, Netlify,
GitHub Pages…), siempre que sirva por HTTPS.

**La cámara exige un contexto seguro.** En el ordenador basta `localhost`, pero
para abrir la aplicación desde el iPhone hay que entrar por la IP de la red
local, y ahí Safari ya pide HTTPS. `--https` genera un certificado autofirmado
para todas las direcciones de la máquina; la primera vez Safari pedirá
aceptarlo (Ajustes → General → Información → Ajustes de confianza de
certificados).

### Publicarla en internet

La aplicación es estática: `node build.mjs` reúne en `dist/` sólo lo que se
sirve (462 KB) y deja fuera las pruebas y el servidor de desarrollo.

**GitHub Pages** — el flujo de trabajo ya está en el repositorio. Sólo hay que
activarlo una vez: Settings → Pages → Source: **GitHub Actions**. A partir de
ahí, cada empuje a `main` publica en `https://darocfilms.github.io/APP-FILTROS/`.

Ese paso no se puede automatizar: dar de alta el sitio de Pages requiere
permiso de administración del repositorio, que el `GITHUB_TOKEN` de un flujo de
trabajo no tiene ni puede recibir.

Funciona bajo subdirectorio: todas las rutas son relativas y el ámbito del
service worker se ajusta solo.

**Netlify** — `netlify.toml` ya trae el comando de construcción, el directorio
publicado y las cabeceras (el service worker sin caché, para que las
actualizaciones lleguen). Add new site → Import an existing project → GitHub →
`APP-FILTROS`. No hay que configurar nada más.

Cualquiera de las dos da HTTPS, que es lo que la cámara exige.

### Instalarla en el iPhone

Safari → Compartir → **Añadir a pantalla de inicio**. Merece la pena hacerlo:

- se abre a pantalla completa, sin la barra del navegador;
- funciona sin conexión (el armazón queda precacheado);
- iOS sólo concede almacenamiento **persistente** a las webs instaladas. Sin
  instalar, el sistema puede vaciar la carpeta local si necesita espacio.

---

## Las tres pestañas

### Cámara

El visor muestra la emulsión ya aplicada: lo que se ve es lo que se guarda.

- Tira de emulsiones bajo el visor, con cambio en directo.
- Compensación de exposición en diafragmas reales.
- Foto y vídeo, cuadrícula de tercios y cámara frontal/trasera.

La previsualización se procesa a 1440 px de lado mayor para que vaya fluida,
pero **la foto no se saca de esa previsualización**: al disparar se captura el
fotograma a resolución nativa y se revela en un pase aparte a tamaño completo.
El vídeo sí se graba desde el lienzo, que es la única forma de que el grabador
reciba los fotogramas ya revelados.

Las capturas se guardan **ya reveladas**, igual que un carrete: la emulsión
queda grabada en los píxeles. Se anota cuál se usó, pero al reabrir la foto en
el laboratorio se parte de ajustes limpios para no aplicarla dos veces.

### Laboratorio

Diez paneles de ajustes:

| Panel | Contenido |
|---|---|
| **Película** | 19 emulsiones con previsualización real de tu propia foto, e intensidad |
| **Luz** | Exposición, contraste, altas luces, sombras, blancos, negros, velado |
| **Color** | Temperatura en kelvin, matiz, intensidad, saturación, rotación de tono, blanco y negro con mezclador de canal |
| **HSL** | Tono, saturación y luminancia en ocho bandas de color |
| **Curvas** | Curva maestra y por canal, con histograma de fondo |
| **Etalonaje** | Ruedas de sombras, medios y altas luces con equilibrio |
| **Detalle** | Claridad, textura, nitidez, reducción de ruido |
| **Efectos** | Grano, halación, bloom, difusión, aberración cromática |
| **Viñeta** | Cantidad, punto medio, suavizado, redondez |
| **Encuadre** | Recorte con proporciones, giro, enderezado, espejo |

Además: deshacer y rehacer, comparación antes/después manteniendo pulsada la
imagen, histograma superpuesto y presets propios.

Los ajustes se guardan junto al archivo: al reabrirlo sigue donde lo dejaste.

### Biblioteca

La carpeta local por dentro. Miniaturas, espacio ocupado, y para cada archivo:
abrir en el laboratorio, guardar en el dispositivo o eliminar.

---

## Exportación

Botón **Exportar** del laboratorio: tamaño (original, 4K, 2K, 1080, web),
formato (JPEG, PNG, WebP) y calidad. Dos destinos:

- **Guardar en el dispositivo** — abre la hoja de compartir de iOS, con
  "Guardar imagen" y "Guardar en Archivos". Es la vía que funciona en iPhone:
  Safari ignora el atributo `download` de los enlaces cuando apuntan a un blob.
  En escritorio cae a la descarga clásica.
- **Guardar en la biblioteca** — deja el resultado en la carpeta local.

El revelado de exportación es un pase nuevo a resolución completa con los
mismos shaders que la previsualización, no un reescalado de lo que había en
pantalla.

---

## El problema del tamaño, y cómo se resuelve

Una foto de iPhone son 12 Mpx. Descodificada en memoria ocupa unos 48 MB, y
Safari en iOS cierra la pestaña mucho antes de lo que uno esperaría. Si además
la imagen viaja como blob entre pestañas de la aplicación, se acumulan copias y
la sesión se cae justo cuando ya has hecho el trabajo.

La aplicación **nunca tiene el original en memoria**:

1. **Los bytes van al disco, no al montón de JavaScript.** Se escriben en el
   sistema de archivos privado del origen (OPFS): una carpeta real en el
   dispositivo, persistente entre sesiones. Los archivos importados se guardan
   ahí *antes* de abrirse. Si el navegador no admite OPFS, se usa IndexedDB
   como alternativa; la biblioteca indica cuál está en uso.

2. **Se edita sobre un proxy.** El laboratorio descodifica una copia de 1600 px
   con `createImageBitmap(..., {resizeWidth})`, que reescala dentro del
   descodificador nativo: la imagen completa no llega a existir nunca.

3. **El original sólo se abre para exportar,** y se descarta acto seguido. La
   exportación usa además su propio contexto WebGL, que se destruye al
   terminar, para que el pico de memoria de vídeo de una imagen de 12 Mpx no se
   quede ocupado el resto de la sesión.

4. **Se respeta el límite del dispositivo.** Si la imagen supera el
   `MAX_TEXTURE_SIZE` de la GPU, se reduce a ese límite y se avisa en lugar de
   fallar.

Un detalle que se cuida a propósito: el grano se calcula sobre una resolución
de referencia fija, así que su tamaño relativo es idéntico en la
previsualización y en el archivo final. Lo que se ve en pantalla es lo que sale.

---

## Pruebas

```bash
npm install          # sólo Playwright, y sólo para las pruebas
npm test             # todas las suites
node test/run.mjs engine   # una sola
```

No hay simulacros del motor: cada suite levanta el servidor, abre Chromium de
verdad, compila los shaders y lee los píxeles del framebuffer.

| Suite | Qué comprueba |
|---|---|
| `engine` | Los seis programas GLSL compilan · las 19 emulsiones renderizan con firma distinta y sin recortar · el perfil neutro es la identidad **al bit** · ocho casos de geometría (giros, espejos, recortes) con sus dimensiones · el histograma · la orientación con `canvas`, `ImageBitmap` e `<img>` |
| `flow` | Importar → carpeta local → laboratorio → los diez paneles → aplicar emulsión → deslizadores → deshacer/rehacer → exportar a resolución original y reabrir el JPEG → guardar en biblioteca → recorte 1:1 → persistencia tras recargar |
| `camera` | Flujo de cámara a 4K, previsualización reducida, foto a resolución nativa, miniatura, grabación de vídeo en MP4, y que reabrir una captura no vuelva a aplicar la emulsión |
| `picker` | Las miniaturas del selector salen derechas |
| `wheel` | La rueda de etalonaje cubre los 360° de matiz con el centro neutro |
| `context` | El contexto WebGL se pierde y se recupera, y se sigue renderizando bien |

Las propiedades matemáticas de las curvas (pivote exacto, blanco exacto,
continuidad C¹, monotonía, asíntota del pie) se verifican canal a canal para
las 19 emulsiones.

`CHROMIUM_PATH` permite apuntar a un Chromium ya instalado en lugar del que
descarga Playwright.

---

## La ciencia de color

El motor no aplica LUTs prefabricadas. Cada emulsión se describe por su
comportamiento físico y se evalúa en la GPU.

### Curva característica

Cada canal tiene su propia curva H&D (Hurter–Driffield): una sigmoide
asimétrica sobre la exposición logarítmica, que es la forma real de la
respuesta de una emulsión.

```
S(u) = u / (1 + u^n)^(1/n)

raw(x) = q -    q ·S( m·(-x)/q,   toe      )    x < 0   (pie)
raw(x) = q + (1-q)·S( m· x /(1-q), shoulder )    x ≥ 0   (hombro)
y(x)   = raw(x) · norm
```

con `x` en diafragmas respecto del gris medio. `q` y `norm` se resuelven en JS,
por bisección, de modo que se cumplan a la vez cuatro propiedades que se
comprueban numéricamente en las pruebas:

- el gris medio imprime exactamente donde declara la emulsión;
- el blanco del soporte cae exactamente en el diafragma declarado;
- la derivada es continua en el pivote (sin codo);
- el pie tiende a cero de forma asintótica, nunca corta a un diafragma finito,
  de modo que las sombras conservan latitud.

Que R, G y B tengan parámetros distintos es lo que produce el **crossover**: el
viraje de color que aparece sólo en las sombras o sólo en las altas luces, y
que distingue una película de otra mucho más que la saturación global. La Gold
200 se calienta progresivamente hacia las luces; la Vision3 500T es fría en
toda la escala; las de blanco y negro son perfectamente neutras.

### Balance de blancos

Adaptación cromática de Bradford entre puntos blancos calculados sobre el locus
CIE de luz día (≥ 4000 K) y el Planckiano (< 4000 K). El matiz desplaza el
blanco perpendicularmente al locus en el plano *uv* de CIE 1960. A 6500 K y
matiz 0 la matriz es la identidad exacta: el control no introduce dominante
propia.

### Acoplamiento entre capas

Una matriz 3×3 por emulsión, con las filas sumando 1 para que los grises se
mantengan neutros. Valores negativos fuera de la diagonal ensanchan la gama
(Velvia, Ektar); positivos la comprimen y dan ese color contaminado de la
instantánea (Polaroid). La LomoChrome Purple usa un intercambio de canales que
convierte el verde en púrpura sin teñir los grises.

### Resto del pipeline

Halación con umbral y tinte (la CineStill 800T la lleva marcada porque no tiene
capa antihalo, y por eso los rojos sangran alrededor de cada luz), grano
dependiente de la densidad —máximo en los medios, casi ausente en el negro
sólido y el blanco quemado—, difusión tipo Pro-Mist, bloom, viñeta con caída
circular o siguiendo el encuadre, aberración cromática y tramado final para
romper el bandeado al cuantizar a 8 bits.

El contraste es **biyectivo en [0,1]**: una potencia por debajo del pivote y su
reflejo por encima, con la misma pendiente a ambos lados. Redistribuye la
escala sin amputarla, así que nunca recorta.

### Emulsiones

**Negativo color** — Portra 400, Portra 800, Gold 200, Ektar 100,
Superia X-TRA 400, Pro 400H, Vista Plus 200
**Diapositiva** — Velvia 50, Provia 100F, Kodachrome 64
**Cine** — Vision3 250D, Vision3 500T, CineStill 800T
**Blanco y negro** — Tri-X 400, HP5 Plus 400, Delta 3200
**Instantánea** — Polaroid 600
**Creativa** — LomoChrome Purple
**Referencia** — Neutro digital (identidad exacta, verificada al bit)

---

## Arquitectura

```
index.html
styles/app.css
sw.js · manifest.webmanifest · icons/
serve.mjs                    servidor de desarrollo, con HTTPS opcional

js/
  app.js                     armazón: pestañas, hojas modales, importación
  engine/
    colorscience.js          colorimetría: Bradford, locus, curvas H&D, splines
    shaders.js               GLSL: geometría, grade, pirámide, composición
    glcore.js                envoltorio de WebGL2 con pool de framebuffers
    renderer.js              orquestador del pipeline y exportación
  data/
    films.js                 catálogo de emulsiones
    params.js                modelo de ajustes; genera también la interfaz
  store/
    library.js               carpeta local: OPFS + IndexedDB
  ui/
    controls.js curve.js wheel.js crop.js histogram.js filmpicker.js panels.js
  views/
    camera.js lab.js library.js
  utils/
    dom.js share.js
```

El pipeline de render:

```
origen → [geometría] → BASE → pirámide de desenfoques → COMPOSICIÓN → salida
```

**BASE** resuelve todo lo que es punto a punto (balance, exposición, curva de
la emulsión, tono, curvas, HSL, etalonaje, saturación). La **pirámide**
produce, con reducciones sucesivas y desenfoque separable, el desenfoque corto
que alimenta la textura y el largo que alimenta halación, bloom y difusión. La
**composición** añade todo lo que necesita vecindad y escribe el resultado.

La misma clase `Renderer` sirve para la previsualización, la cámara en directo
y la exportación: sólo cambia el tamaño del lienzo.

---

## Requisitos

- **WebGL2** — obligatorio, todo el procesado va en la GPU. iPhone con iOS 15
  o posterior.
- **HTTPS o localhost** — para la cámara.
- **OPFS** — recomendado (Safari 16.4+). Sin él se usa IndexedDB.
- **MediaRecorder** — para grabar vídeo. Safari lo admite desde iOS 14.3 y
  produce MP4; en otros navegadores se elige WebM.

---

## Limitaciones conocidas

- `getUserMedia` no da acceso a la resolución completa del sensor ni al RAW:
  es un límite de iOS, no de la aplicación. Se pide la máxima disponible.
- El revelado de vídeo en el laboratorio va en tiempo real, porque el
  navegador no ofrece codificación más rápida que la reproducción. Un clip de
  un minuto tarda un minuto.
- Las emulsiones son interpretaciones fundamentadas en el comportamiento
  documentado de cada película, no medidas de densitómetro sobre muestras
  reales.
