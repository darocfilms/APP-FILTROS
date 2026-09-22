# Laboratorio

**En marcha: https://darocfilms.github.io/APP-FILTROS/**

Aplicación web de cámara y revelado fotográfico para iPhone. Emulsiones
reales aplicadas en directo sobre el visor, grabación de vídeo, un laboratorio
de edición completo y exportación a resolución original.

Todo se ejecuta en el dispositivo. No hay servidor, no hay cuenta, no se sube
nada a ninguna parte.

Ábrela en Safari desde el iPhone y **Compartir → Añadir a pantalla de inicio**.
No es cosmético: iOS sólo concede almacenamiento persistente a las webs
instaladas, así que sin ese paso el sistema puede vaciar la carpeta con tus
fotos cuando necesite espacio.

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

Ya está publicada en GitHub Pages: cada empuje a `main` reconstruye y despliega.

La aplicación es estática: `node build.mjs` reúne en `dist/` sólo lo que se
sirve (462 KB) y deja fuera las pruebas y el servidor de desarrollo. El flujo de
trabajo empuja ese resultado a la rama `gh-pages`, que es lo que Pages sirve.

Se publica desde una rama y no con `deploy-pages` por un motivo concreto: el
modo "GitHub Actions" de Pages hay que darlo de alta con permiso de
administración del repositorio, que el `GITHUB_TOKEN` de un flujo no tiene ni
puede recibir en el bloque `permissions`. Servir desde una rama sólo necesita
`contents: write`.

Después de publicar, el flujo comprueba la página real: que responde, que sirve
esta aplicación, que los módulos y el service worker resuelven bien bajo la
subruta del repositorio, y —abriéndola con un navegador de verdad— que el
armazón monta, los seis programas GLSL compilan y el render da los píxeles
esperados. Un 200 en todos los archivos no distingue una aplicación que arranca
de una pantalla en negro.

**Netlify**, como alternativa: `netlify.toml` ya trae el comando de
construcción, el directorio publicado y las cabeceras. Add new site → Import an
existing project → GitHub → `APP-FILTROS`.

### Instalarla en el iPhone

Safari → Compartir → **Añadir a pantalla de inicio**. Merece la pena hacerlo:

- se abre a pantalla completa, sin la barra del navegador;
- funciona sin conexión (el armazón queda precacheado);
- iOS sólo concede almacenamiento **persistente** a las webs instaladas. Sin
  instalar, el sistema puede vaciar la carpeta local si necesita espacio.

---

## Las tres pestañas

### Cámara

La imagen ocupa la pantalla entera. Nada de la interfaz la recorta. Sólo abren
**ventana flotante** los ajustes que son una LISTA de opciones; los que son un
valor continuo van en dos barras sobre la propia imagen, y los que son un
interruptor actúan de un toque.

| Mando | Qué hace |
|---|---|
| **Filtros** | Ventana: las 26 emulsiones por familias e intensidad, en directo sobre el visor |
| **Dimensiones** | Ventana: encuadre, con los megapíxeles que cuesta cada uno |
| **Flash** | Un toque: encendido o apagado |
| **Biblioteca** | Un toque: lleva a lo ya guardado |
| **Barra izquierda** | Exposición, en diafragmas reales |
| **Barra derecha** | Zoom, con el 0,5× incluido si hay gran angular |
| **Junto al disparador** | Ocultar los mandos, y cambiar de cámara |

**Las barras de los lados.** La exposición y el zoom se buscan MIRANDO el
encuadre, así que taparlo con una ventana para decidirlos esconde justo el dato
que hace falta. Van en dos líneas de 3 px pegadas a cada borde —una a cada lado,
donde el pulgar de esa mano llega sin recolocar el teléfono— con una marca en su
valor neutro y el número flotando sólo mientras se arrastra. Lo delgado es la
línea, no el objetivo: la caja que se toca mide 46 px.

El zoom va en escala **logarítmica**, que es como se percibe: de 1× a 2× se nota
lo mismo que de 5× a 10×, y en lineal el primer tramo —el que más se usa— queda
aplastado contra el extremo. Por debajo de 1× no hay zoom sino otra cámara; si
el dispositivo no tiene gran angular ese tramo se ve apagado en vez de prometer
un objetivo que no existe.

**Las 26, antes de disparar.** El catálogo entero está en el visor, no sólo en
el laboratorio: una fila de familias arriba —negativo color, diapositiva, cine,
blanco y negro…— y debajo la tira de esa familia. En una tira única, la copia de
cine quedaba a diez dedos de desplazamiento a la derecha; así está a dos toques,
y se ve la emulsión puesta antes de apretar el botón, que es cuando importa.

**Arranca con la copia de cine 2383 puesta.** Es una decisión de look y no de
neutralidad: el visor enseña desde el primer momento aquello a lo que se va a
parecer la foto, con su cruce a cian en sombras y cálido en luces.

**El 0,5× no es zoom**: es **otra cámara**, con su propio objetivo, y no hay
restricción que lleve hasta ella — hay que pedirla por su identificador. Cruzar
el 1× en la barra cambia de objetivo, que obliga a reabrir el flujo, así que
sólo se pide cuando el objetivo de destino es distinto del que ya está puesto.

A partir de 1×, cuando el dispositivo expone el zoom del sensor se usa primero,
porque es zoom real y no pierde detalle; más allá se recorta, y entonces sí se
pierde. La insignia dice cuál de las dos cosas está pasando, y los megapíxeles
anunciados descuentan el recorte en lugar de prometer un detalle que la foto no
va a tener.

**Flash: encendido o apagado, y ya está.** Elegir entre «linterna» y «pantalla»
era una pregunta sobre el hardware, no sobre la foto: quien dispara quiere luz.
Se usa el LED cuando el navegador lo deja —Safari en iPhone no lo hace, hasta
donde alcanza esta versión— y el destello de pantalla cuando no, y la insignia
dice cuál toca al encenderlo en vez de obligar a decidirlo. La linterna, si la
hay, permanece encendida mientras grabas.

**Cambiar de cámara va junto al disparador**, no en la fila de mandos: es lo
único que se decide con el teléfono ya levantado y el encuadre hecho, y ahí el
pulgar está a un centímetro. Al pasar a la frontal el zoom y el objetivo vuelven
al principio —el gran angular es de la trasera, y llevarse su aumento a la otra
cámara sería prometer algo que no da—, y el espejo lo decide la cámara puesta:
la frontal sí, la trasera no, como en la cámara del sistema. Grabando no se
toca: reabrir el flujo cortaría la toma.

Tocar la imagen esconde los mandos y deja el encuadre limpio; un asidero en la
esquina los devuelve.

**Al volver a la cámara sigue funcionando.** Salir a otra pestaña, o que el
sistema mande la aplicación al fondo al compartir un enlace, no la deja en
negro: el contexto de dibujo sobrevive, y si otra aplicación se queda con la
cámara se reintenta sola. Si el enlace se abre **dentro** de otra aplicación
(WhatsApp, Instagram, Mensajes), la web lo detecta y lo dice: esos navegadores
incrustados no dan acceso a la cámara en iPhone por mucho que el sitio sea
HTTPS, y hay que abrirlo en Safari.

**Sobre el encuadre.** Se pide 4:3 a la máxima resolución, que es la lectura
completa del sensor — pedir 16:9 parece "más grande" por el número, pero es un
recorte que el sistema aplica antes de entregarte el fotograma, y esa parte no
se recupera. A partir de ahí, cada encuadre recorta ese mismo fotograma:

- **Pantalla** (por defecto) llena la pantalla y captura exactamente lo que ves.
- **Máx** no recorta nada.
- 4:3, 1:1 y 16:9, los clásicos.

Llenar la pantalla cuesta megapíxeles, así que el panel los muestra **antes** de
elegir y el visor los recuerda arriba. Es una decisión informada, no un ajuste
escondido.

La previsualización se procesa a la resolución de la pantalla y baja sola si el
dispositivo no llega: se mide el coste real por fotograma en lugar de elegir un
número conservador para todos. Pero **la foto no sale de esa previsualización**:
al disparar se captura el fotograma a resolución nativa y se revela en un pase
aparte a tamaño completo.

### Laboratorio

Diez paneles de ajustes:

| Panel | Contenido |
|---|---|
| **Película** | 26 emulsiones con previsualización real de tu propia foto, e intensidad |
| **Luz** | Exposición, contraste, altas luces, sombras, blancos, negros, velado |
| **Color** | Temperatura en kelvin, matiz, intensidad, saturación, rotación de tono, blanco y negro con mezclador de canal |
| **HSL** | Tono, saturación y luminancia en ocho bandas de color |
| **Curvas** | Curva maestra y por canal, con histograma de fondo |
| **Etalonaje** | Ruedas de sombras, medios y altas luces con equilibrio |
| **Detalle** | Claridad, textura, nitidez, reducción de ruido |
| **Efectos** | Grano, halación, bloom, difusión, aberración cromática |
| **Viñeta** | Cantidad, punto medio, suavizado, redondez |
| **Encuadre** | Recorte con proporciones, giro, enderezado, espejo |

La imagen se queda **quieta** al fondo y los ajustes flotan encima **casi
transparentes**: el velo no lo pone una capa opaca sino un filtro sobre lo que
hay detrás, así que la foto se sigue viendo entera a través de los mandos y el
texto se lee igual sobre un cielo blanco que sobre una sombra. Las barras —la de
pestañas y los raíles de los deslizadores— van al revés, apenas veladas: son
donde se pulsa a ciegas, y un objetivo que se confunde con la foto se falla. Antes su tamaño dependía del panel abierto, así que la foto
saltaba al cambiar de pestaña — justo cuando estás mirando un color. Ahora no se
mueve ni un píxel: plegar los ajustes revela lo que tapaban, sin recolocar nada.

Para comparar hay dos gestos, porque sirven para cosas distintas: **mantener
pulsada** la imagen da un vistazo al original mientras mueves un deslizador, y
el botón **◐** lo deja fijo para mirarlo con calma. Una etiqueta dice cuál de las
dos versiones estás viendo.

El proxy de edición se dimensiona según la pantalla: en un panel de densidad 3×
un proxy fijo de 1600 px se ve blando cuando la imagen ocupa toda la altura.

Además: deshacer y rehacer, comparación antes/después manteniendo pulsada la
imagen, histograma superpuesto y presets propios.

Los ajustes se guardan junto al archivo: al reabrirlo sigue donde lo dejaste.

### Biblioteca

Tocar una miniatura abre un **visor a pantalla completa**: la foto sobre negro y
nada más. Un toque saca los botones que hacen falta —cerrar, abrir en el
laboratorio, guardar en el dispositivo, borrar— y otro los quita. Borrar
pregunta antes, y al confirmar el visor sigue con la siguiente en vez de
devolverte a la cuadrícula: se estaba mirando, no ordenando. Se desliza en
horizontal para pasar de una a otra, y se carga un archivo cada vez: con doce
megapíxeles por imagen, mantener varias abiertas es la forma más rápida de que
Safari cierre la pestaña.

La carpeta local por dentro. Miniaturas, espacio ocupado, y para cada archivo:
abrir en el laboratorio, guardar en el dispositivo o eliminar.

**Selección múltiple** con el botón *Seleccionar*, o manteniendo pulsada una
miniatura. Desde ahí se comparten o eliminan varios de una vez; compartir usa la
hoja del sistema, que en iPhone admite lotes.

---

## Exportación

Botón **Exportar** del laboratorio: tamaño (original, 4K, 2K, 1080, web),
formato (JPEG, PNG, WebP) y calidad. Dos destinos:

- **Guardar en el dispositivo** — abre la hoja de compartir de iOS, con
  "Guardar imagen" y "Guardar en Archivos".
- **Guardar en la biblioteca** — deja el resultado en la carpeta local.

Guardar en iPhone tiene tres trampas, y las tres hacían que fallara en silencio:

1. `navigator.share` exige **activación del usuario**, y esa activación caduca.
   Si entre el toque y la llamada se revela una foto de doce megapíxeles, para
   cuando se llama ya no vale y Safari responde `NotAllowedError`. Por eso el
   revelado termina en una hoja que pide un toque nuevo: desde ahí la hoja del
   sistema se abre con la activación viva.
2. El atributo `download` de un enlace existe en Safari pero **se ignora** con
   destinos blob. No es una reserva válida en iPhone, así que cuando no hay hoja
   del sistema se muestra la imagen para guardarla manteniéndola pulsada.
3. La marca de tiempo llega al segundo, así que preparar varios archivos de
   golpe los bautizaba a todos igual. Ahora se numeran.

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
| `engine` | Los seis programas GLSL compilan · las 26 emulsiones renderizan con firma distinta y sin recortar · el perfil neutro es la identidad **al bit** · ocho casos de geometría (giros, espejos, recortes) con sus dimensiones · el histograma · la orientación con `canvas`, `ImageBitmap` e `<img>` |
| `flow` | Importar → carpeta local → laboratorio → los diez paneles → aplicar emulsión → deslizadores → deshacer/rehacer → exportar a resolución original y reabrir el JPEG → guardar en biblioteca → recorte 1:1 → persistencia tras recargar |
| `picker` | Las miniaturas del selector salen derechas |
| `wheel` | La rueda de etalonaje cubre los 360° de matiz con el centro neutro |
| `context` | El contexto WebGL se pierde y se recupera, y se sigue renderizando bien |
| `layout` | El reparto de pantalla: el visor cubre la pantalla y lo capturado coincide con lo que se ve, hay un mando por grupo de funciones y ninguno de más —con la exposición y el zoom fuera de la fila, en sus barras—, cada ventana abre sólo una a la vez, ocultar los mandos deja el encuadre limpio, la imagen del laboratorio es más grande que los ajustes, plegar la agranda, los ajustes son casi transparentes mientras la barra apenas se vela, y ningún panel desborda |
| `camera` | Flujo a 4K, foto a resolución nativa, grabación en MP4 a 30 fps —contando los fotogramas que el reloj pide de verdad, con el visor detenido— y que reabrir una captura no vuelva a aplicar la emulsión. Que cada familia de emulsiones enseñe las suyas, que la copia de cine se pueda elegir antes de disparar y que la banda de naranjas que propone no se herede a la siguiente. Las dos barras verticales: que la línea sea fina pero su área táctil llegue a 46 px, que arrastrar hacia arriba suba de verdad la exposición, que la barra siga al pellizco y que sin gran angular no baje de 1×. El flash como interruptor: que encienda, que dé luz sin LED y que apagado no dé ninguna. Además: que la cámara **siga pintando** al volver de Laboratorio o Biblioteca y tras pasar a segundo plano —leyendo píxeles reales del framebuffer, no suponiendo—, el zoom, y que la detección de navegador incrustado no confunda a Safari ni a Chrome |
| `save` | Selección múltiple, y que compartir ocurra **con la activación del usuario viva** — la comprobación que distingue un guardado que funciona de uno que falla en silencio en iPhone. También los nombres únicos por lote, la reserva de mantener pulsado, y borrar desde el visor: que pregunte, que cancelar no toque nada y que confirmar siga con la siguiente foto |

Las propiedades matemáticas de las curvas (pivote exacto, blanco exacto,
continuidad C¹, monotonía, asíntota del pie) se verifican canal a canal para
las 26 emulsiones.

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
Superia X-TRA 400, Pro 400H, Vista Plus 200, Reala 100, Pro 160NS,
Fujicolor C200, Natura 1600
**Diapositiva** — Velvia 50, Provia 100F, Astia 100F, Kodachrome 64
**Cine** — Vision3 250D, Vision3 500T, CineStill 800T, Copia de cine 2383,
Eterna 250D
**Blanco y negro** — Tri-X 400, HP5 Plus 400, Delta 3200
**Instantánea** — Polaroid 600
**Creativa** — LomoChrome Purple
**Referencia** — Neutro digital (identidad exacta, verificada al bit)

Dos añadidos merecen una nota, porque son casos límite del modelo:

**Copia de cine 2383** es película de *copia*, no de cámara: lo que se proyecta
en una sala. Su firma es el cruce que da nombre al «teal and orange», y aquí
sale de la propia curva, no de un tinte pegado encima — el pie del rojo es el
más duro, así que las sombras pierden rojo antes y viran a cian, y es el primero
en llegar al blanco, de ahí las luces cálidas. Medido: R−B vale −0,026 en
sombras y +0,025 en altas luces.

Unifica la 2383 y la 2393, que eran dos entradas del mismo idioma: conserva el
cruce entero y se queda con la gamma de la 2393, más suave que la de sala. Y
lleva **los naranjas bajados por banda**, no con la saturación general: el cruce
ya calienta las luces por la curva, así que saturarlos encima dejaba las pieles
y los ladrillos en anaranjado de postal, mientras el resto de la imagen sí
necesitaba su color. Medido sobre una carta de parches, con la copia puesta la
saturación del naranja baja de 0,81 a 0,68 y la de la piel de 0,41 a 0,32.

**Reala 100** es la contraria: la emulsión de la cuarta capa sensible al cian,
hecha para acertar el color bajo luz mezclada. Fidelidad significa aquí que los
tres canales van casi juntos, y se ve en el número — su crossover es de 0,003 a
0,005 en toda la escala, ocho veces menor que el de la 2383.

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
  produce MP4; en otros navegadores se elige WebM. La cadencia es de 30 fps
  fijos: el lienzo no se captura solo, cada fotograma lo pide un reloj que
  descarta los vencimientos perdidos en vez de recuperarlos de golpe, así que el
  archivo no sale a cadencia variable aunque el revelado se retrase.

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
