# Laboratorio

**En marcha: https://darocfilms.github.io/APP-FILTROS/**

Aplicación web de cámara y revelado fotográfico para iPhone, que en el Mac se
convierte en un editor de escritorio con los ajustes al lado. Emulsiones
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

### App nativa para iPhone (Xcode)

**[Laboratorio-Xcode.zip](https://github.com/darocfilms/APP-FILTROS/releases/download/ios/Laboratorio-Xcode.zip)**
es el proyecto de Xcode completo, con la app web dentro y el plugin que guarda
en Fotos al lado: se descomprime en un Mac, se abre, se firma con un Apple ID
(vale la gratuita) y se instala en el iPhone sin instalar nada más. Un Mac de
GitHub lo compila desde el propio .zip antes de publicarlo
(`.github/workflows/ios.yml`; `sh ios/hacer-zip.sh` lo hace en local). Los
pasos, en **[XCODE.md](XCODE.md)** y en el LEEME que va dentro.

Lo que la app nativa hace y Safari no: **guardar directo en Fotos**, sin hoja de
compartir, con el plugin `@capacitor-community/media` y el permiso de *sólo
añadir* de iOS.

### App para Mac

Una app de Mac aparte, con su icono en el Dock y su barra de menús:
**[Laboratorio.dmg](https://github.com/darocfilms/APP-FILTROS/releases/download/mac/Laboratorio.dmg)**
(Apple Silicon e Intel en un solo archivo, macOS 12 o posterior).

1. Abre el .dmg y arrastra **Laboratorio** a **Aplicaciones**.
2. La primera vez macOS no la deja abrir porque no viene de la App Store ni
   está firmada con un certificado de Apple: ábrela, cierra el aviso y ve a
   **Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente»**. (En
   macOS 14 o anterior basta con clic derecho → Abrir.) Sólo se hace una vez.
3. Al usar la cámara pide permiso, como cualquier app.

Es la misma app web, dentro de una app de Electron (motor de Chrome), así que
en el Mac funciona todo lo que antes pedía Chrome: la biblioteca en una carpeta
de Imágenes, importar carpetas y discos, WebGL2 y los descodificadores de RAW y
HEIF. Lleva los archivos dentro: funciona sin conexión. Lo que añade:

- **Barra de menús**: Archivo › Importar fotos (⌘O), Importar una carpeta o un
  disco (⇧⌘O), Exportar (⌘E) y Mostrar las fotos exportadas en el Finder; Ver ›
  Cámara (⌘1), Laboratorio (⌘2), Biblioteca (⌘3), Cambiar de sección (⌘0) y
  pantalla completa. Deshacer, copiar y pegar son los del sistema: en el
  laboratorio deshacen un ajuste y copian y pegan ajustes.
- **Guardar va directo a Imágenes › Laboratorio › Exportadas**, sin un diálogo
  por foto y sin pisar nada («foto 2.jpg»), con un aviso al terminar que las
  enseña en el Finder.
- **Abrir con Laboratorio**: desde el Finder (clic derecho → Abrir con) o
  soltando fotos sobre el icono del Dock. Una sola va al laboratorio; varias,
  al menú de importación.
- Los semáforos van sobre la app, sin barra de título gris.

La biblioteca vive en `~/Library/Application Support/Laboratorio` (o en la
carpeta de Imágenes que elijas) y se conserva al actualizar: para una versión
nueva basta con descargar el .dmg otra vez y reemplazar la app. El .dmg lo
construye GitHub Actions en un Mac (`.github/workflows/mac.yml`) en cada cambio.

Para probarla o construirla en tu Mac:

```bash
cd mac && npm install
npm start          # la abre con la web de dist/
npm run dmg        # mac/salida/Laboratorio.dmg (sh hacer-dmg.sh)
```

Va firmada «ad hoc» (sin certificado), que es lo que permite abrirla tras el
paso 2. Con una cuenta de Apple Developer se puede firmar con un certificado
Developer ID y notarizar para que abra sin aviso.

### App nativa con Floot (iPhone y Android, sin Mac)

Floot compila y sube la app a las tiendas sin Xcode. Su proyecto
(«Laboratorio», en floot.com) es sólo una cáscara: una página que enlaza
`styles/app.css` e importa `js/app.js` **desde GitHub Pages**, y los monta en un
`#app` que React no toca. Por eso:

- Cada empuje a `main` llega a la app nativa al volver a abrirla, sin pasar por
  la tienda. En Floot sólo se toca la cáscara, el icono, los permisos y los
  datos de la tienda.
- Hace falta conexión para abrirla (si no la hay, lo dice y ofrece reintentar).
  Las fotos de la biblioteca se guardan en el teléfono igualmente.
- Floot no admite WebAssembly ni workers dentro del proyecto, y el navegador no
  deja crear un worker con la URL de otro origen. `js/utils/alojada.js` lo
  resuelve: si la app se importa desde otra página, envuelve los workers de
  LibRaw y libheif en un worker de blob que importa el script verdadero, y no
  registra el service worker. Lo comprueba la suite `alojada`.
- Guardar directo en Fotos lo hace el plugin `@capacitor-community/media`, que
  el proyecto de Floot lleva como dependencia e importa en
  `helpers/montarLaboratorio.tsx` (lo deja en `__laboratorioMedia`, donde lo
  busca `js/utils/galeria.js`). Llega con la siguiente publicación de la app;
  hasta entonces «Guardar» usa la hoja de compartir.

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

## El diseño: el de Fotos del iPhone

La app copia el aspecto de Fotos y Cámara de iOS en modo oscuro: negro puro, los
grises del sistema y **cristal** translúcido para todo lo que flota sobre la
foto (botones redondos, barras, la cápsula de secciones). Dos colores con
función fija, como en iOS: **azul** para lo que se toca en la biblioteca y
**amarillo** para lo que se está ajustando en el laboratorio y en la cámara.
Las maquetas están en el lienzo de Design «Laboratorio estilo Fotos».

### Cambiar de sección con el dedo

Abajo flota una **cápsula de cristal** con Cámara, Laboratorio y Biblioteca y
una lente que marca la abierta (en la cámara y el laboratorio se queda en
iconos). Además de tocar cada icono:

- **Deslizar de lado sobre la cápsula**: la lente sigue al dedo y la sección de
  al lado entra deslizándose. Se queda en la más cercana al soltar, o en la
  siguiente con un golpe rápido (nunca salta dos).
- **Deslizar hacia arriba desde la cápsula**: la pantalla encoge siguiendo al
  dedo hasta ser una tarjeta, con las otras dos a los lados, como el selector de
  apps del iPhone. Las tarjetas son las vistas de verdad (la cámara sigue en
  directo dentro de la suya). Al soltar el carrusel queda abierto: de lado se
  elige, un toque entra, un toque fuera o Esc vuelve.
- **Dos dedos hacia arriba en cualquier sitio** abre el mismo carrusel. No
  choca con nada: un dedo es de los deslizadores y el disparador, y el pellizco
  cambia la distancia entre los dedos.

Todo en `js/ui/conmutador.js`; los iconos, en `js/ui/iconos.js` (dibujos
propios con el lenguaje de los de Apple, que no se pueden usar fuera de sus
plataformas).

## Las tres pestañas

### Cámara

Abajo, como en la Cámara del iPhone: FOTO · VÍDEO con el modo activo en
amarillo, el disparador blanco, la **miniatura de la última foto** a la
izquierda (la abre en el visor sin salir de la cámara, que sigue encendida al
cerrarlo) y cambiar de cámara a la derecha.

**Arranca en la calidad máxima**: el sensor completo, sin recortar («Máx»), y
el JPEG al 100 %. La línea de arriba lo dice —«4032×3024 · 12,2 Mpx · sensor
completo · JPEG 100 %»—, y a su derecha está el botón **RAW**.

La imagen ocupa la pantalla. Abren **ventana flotante** los ajustes que son una
lista de opciones o un valor que se afina; los interruptores actúan de un toque.
Son **cuatro iconos sueltos**, sin caja que los agrupe y sin texto debajo,
dibujados en SVG (los glifos de Unicode cambian en cada sistema): tres círculos
superpuestos para el color, el círculo partido con «+» y «−» de la exposición,
cuatro esquinas de marco para el encuadre y el rayo del flash, tachado cuando
está apagado. Su nombre vive en `aria-label` para quien no ve el icono.

| Mando | Qué hace |
|---|---|
| **Filtros** | Ventana: las emulsiones en una fila de nombres, e intensidad |
| **Exposición** | Ventana: una regla de −3 a +3 diafragmas, con el valor en grande |
| **Dimensiones** | Ventana: encuadre, con los megapíxeles que cuesta cada uno |
| **Flash** | Un toque: encendido o apagado |
| **0,5 · 1× · 2 · 4** | Zoom: un toque salta; arrastrarlos de lado despliega la regla |
| **RAW** | Un toque: fotos sin pérdida, con la emulsión editable |
| **Junto al disparador** | La última foto, y cambiar de cámara |

**Zoom y exposición, que se entiendan solos.** Antes eran dos barras verticales
sin escala, una a cada lado: no decían qué eran ni cuánto se habían movido. Ahora
son lo de la Cámara del iPhone:

- **El zoom son botones** encima de FOTO · VÍDEO: 0,5 (sólo si hay gran
  angular), 1×, 2 y 4. El activo dice el aumento exacto («2,6×»). Arrastrarlos de
  lado, o mantenerlos pulsados, los convierte en una **regla** en el mismo sitio,
  con el valor encima, para afinar entre medias; al soltar se recoge sola. El
  pellizco sobre la imagen sigue funcionando y los botones lo siguen.
- **La exposición tiene su botón** y abre una regla rotulada: «EXPOSICIÓN», el
  valor en grande («+0,7 EV»), los números de −3 a +3 con una raya por tercio, y
  debajo «← Más oscura» y «Más clara →». Las marcas enteras atraen un poco al
  pasar (con un toque háptico), tocar un número salta a él y «Volver a 0» la
  deja como estaba. Mientras no sea 0, el propio botón va en amarillo con su
  valor debajo: se ve siempre que la foto va a salir más clara o más oscura.

La regla (`js/ui/dial.js`) es la misma en los dos. El zoom va en escala
**logarítmica**, que es como se percibe: de 1× a 2× ocupa lo mismo que de 2× a
4×. Por debajo de 1× no hay zoom sino otra cámara; sin gran angular ni hay
botón 0,5 ni la regla baja de 1×.

**RAW.** Safari no entrega los datos del sensor (ni ProRAW: eso es de la app
Cámara de Apple), así que el RAW de Laboratorio es lo que importa de un RAW
hecho con lo que la web sí da: el **fotograma completo sin pérdida**, en PNG,
sin recortar y **sin hornear nada**. La emulsión, la exposición, el encuadre y
el espejo van aparte, como ajustes del laboratorio: la biblioteca lo enseña
revelado (con la marca RAW), y al abrirlo en el laboratorio todo se puede
cambiar o quitar sin perder calidad. Ocupa más que el JPEG. Se recuerda, y es
el «Formato de la cámara» de Ajustes.

**Filtros: una fila de nombres.** Sin recuadros encima del nombre: las muestras
de color no decían nada (dos negativos Kodak salen iguales a 40 px) y las
miniaturas tapaban la foto justo mientras se elige. Como el selector de modos de
la Cámara, el nombre activo va en amarillo con un punto debajo, y la familia
—Negativo color, Cine, Blanco y negro, Instantánea— en pequeño delante de su
tramo. Tocar un nombre lo aplica al visor, que enseña la emulsión mejor que
cualquier muestra. Es el mismo selector que el del laboratorio.

**Arranca con la copia de cine 2383 puesta.** Es una decisión de look y no de
neutralidad: el visor enseña desde el primer momento aquello a lo que se va a
parecer la foto, con su cruce a cian en sombras y cálido en luces.

**El 0,5× no es zoom**: es **otra cámara**, con su propio objetivo, y no hay
restricción que lleve hasta ella — hay que pedirla por su identificador. Cruzar
el 1× en la regla cambia de objetivo, que obliga a reabrir el flujo, así que
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

- **Máx** (por defecto) no recorta nada: es la calidad máxima.
- **Pantalla** llena la pantalla y captura exactamente lo que ves.
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

Es la pantalla de edición de Fotos. Arriba, volver (botón redondo de cristal),
los mandos en una cápsula —deshacer, rehacer, ver el antes, histograma, tira de
fotos y presets— y **Exportar en amarillo**. Abajo, los paneles como pestañas de
texto («Película · Luz · Color · …»), con un punto amarillo en los que tienen
algo cambiado. En el teléfono, los paneles de varios deslizadores (Luz, Color,
Detalle, Efectos, Viñeta) son **círculos y regla**: un círculo por ajuste con
su valor dentro y un aro amarillo que dice cuánto se ha movido, y debajo la
regla del elegido. Por dentro sigue siendo el `<input type="range">` de siempre
(arrastre nativo, teclado y VoiceOver). Película es un carrusel de borde a borde,
con el nombre de cada familia encima de su tramo. En la columna del Mac caben
todos los deslizadores a la vez y los círculos no se usan.

Diez paneles de ajustes:

| Panel | Contenido |
|---|---|
| **Película** | Las emulsiones en una fila de nombres, sin recuadros encima, e intensidad: tocar un nombre revela TU foto con él, que dice más que cualquier miniatura y no tapa la imagen. En el Mac, por familias en la columna |
| **Luz** | Exposición, contraste, altas luces, sombras, blancos, negros, velado |
| **Color** | Temperatura en kelvin, matiz, intensidad, saturación, rotación de tono, blanco y negro con mezclador de canal |
| **HSL** | Tono, saturación y luminancia en ocho bandas de color |
| **Curvas** | Curva maestra y por canal, con histograma de fondo |
| **Etalonaje** | Ruedas de sombras, medios y altas luces con equilibrio |
| **Detalle** | Claridad, textura, nitidez, reducción de ruido |
| **Efectos** | Grano, difusión, aberración cromática |
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

**Lupa.** Doble clic sobre la foto (doble toque en el teléfono) la amplía al
**100 %** justo donde se pulsó: un píxel de la foto por píxel de pantalla, para
mirar el enfoque, el ruido o el grano mientras se edita. Arrastrando —o con dos
dedos en el trackpad— se mueve, y otro doble clic la vuelve a encajar. En el
ordenador se carga **la foto entera** (hasta 36 Mpx; un RAW, revelado a tamaño
de sensor) y los ajustes se siguen viendo en vivo sobre ella; mientras carga se
amplía la vista previa y luego se afina sola. En el teléfono amplía la vista
previa, que ya tiene la resolución de la pantalla: una foto entera de 24 Mpx es
la forma más rápida de que Safari cierre la pestaña. Una foto pequeña, que al
100 % apenas crecería, se amplía al doble, y la etiqueta dice cuánto es
respecto del original.

**Tira de fotos.** El botón de los tres fotogramas enseña u oculta una fila con
todas las fotos de la biblioteca en pequeño, para pasar de una a otra sin salir
del laboratorio; la que está abierta va marcada, y las editadas llevan un
punto. En el Mac va debajo de la foto y empieza abierta; en el teléfono, arriba
y cerrada. Se acuerda de cómo la dejaste.

Los ajustes se guardan junto al archivo: al reabrirlo sigue donde lo dejaste.
Y no se quedan en el laboratorio: la biblioteca enseña y guarda la foto tal
como quedó (ver [Biblioteca](#biblioteca)).

#### En el Mac

Con la ventana ancha (900 px o más, en horizontal) el laboratorio cambia de
forma: la foto a la izquierda, **los ajustes en una columna a la derecha** con
las pestañas en dos filas arriba, y nada flotando encima de la imagen. La
columna no se pliega —en el teléfono plegar sirve para ver la foto entera; aquí
ya se ve— y se adapta sola si la ventana se estrecha o se agranda.

En la barra aparecen **Copiar** y **Pegar** (en el teléfono no caben y están
dentro de *Presets*), y los atajos de siempre:

| | |
|---|---|
| ⌘Z · ⇧⌘Z | Deshacer · rehacer |
| ⌘C · ⌘V | Copiar los ajustes de color de la foto · pegarlos |
| Z · Esc | Lupa al 100 % · encajar |
| ← → | Foto anterior · siguiente |

Los de ⌘ siguen funcionando con un deslizador en foco, que es justo después de
moverlo; las flechas, no: ahí mueven el deslizador. En un campo de texto (el
nombre de un preset) todos son del campo.

La foto encajada deja aire alrededor, como en cualquier revelador de escritorio.

#### HEIF: HEIC del iPhone y HIF de Sony

Se importan y se editan los **HEIF**: los **.HEIC** del iPhone y los **.HIF**
de las Sony (y las Fujifilm), que son de 10 bits y 4:2:2. Safari abre los del
iPhone por su cuenta; Chrome y Firefox no abren ninguno, y para ellos va dentro
**libheif** compilado a WebAssembly (con libde265 para el HEVC), en su propio
worker para no congelar la interfaz. Primero se le pregunta al navegador; si no
sabe, libheif.

- Para las **miniaturas** —el menú de importación y la biblioteca— no se
  descodifica la foto entera: casi todos los HEIF llevan dentro una pequeña, y
  se usa ésa. libheif no la ofrece en esta compilación, así que se le enseña
  como si fuera la imagen principal (se reescribe ese número en una copia del
  archivo, sin mover ni un byte). Una tarjeta llena de HIF se ve al momento.
- En el laboratorio y al exportar se descodifica entera, en el worker, y se
  reduce allí mismo al tamaño que hace falta.
- Un HIF sale a **8 bits**, como una foto normal: el revelado de una foto
  trabaja en 8 bits. (Los RAW, en cambio, entran en coma flotante.)
- El selector de archivos acepta .heic, .heif y .hif. Con HEIC en la lista, el
  iPhone entrega sus fotos tal cual en vez de convertirlas a JPEG.

#### RAW de Sony

Los **ARW** (y los antiguos SR2/SRF) se importan como cualquier foto y se
revelan con **LibRaw** compilado a WebAssembly, en su propio worker para no
congelar la interfaz. Lleva la tabla de color de las Sony actuales —A7 IV,
A7R V, A1, A7C II, A6700, FX3, FX30, ZV-E1…—, que es lo que hace que el color
salga bien: sin la matriz de cada sensor, un RAW sale verdoso y apagado.

Un RAW no se convierte a JPEG al abrirlo, porque eso tiraría justo lo que lo
hace valer la pena. Entra al motor como **luz lineal en coma flotante** de media
precisión, sin recortar en 1 ni pasar por sRGB: el balance de la cámara ya
aplicado, la saturación del sensor en el blanco y nada más. Lo demás lo pone el
revelado, igual que con una foto, y con eso:

- **Subir la exposición no quema.** Sin emulsión, un hombro suave curva las
  luces hacia el blanco en lugar de cortarlas; con emulsión, el de su propia
  curva. Medido con la FX30 de las pruebas a +1,5 EV: el RAW no deja ningún
  píxel en 255; la misma imagen metida como JPEG de 8 bits, un 8,75 %.
- **Levantar las sombras no hace escalones.** A +3 EV, las sombras del RAW
  tienen más del doble de tonos distintos que las del mismo JPEG.
- **Girar o recortar no cuesta nada**: el pase de geometría escribe en flotante.

Para editar se revela a **media resolución sin interpolar** (LibRaw agrupa cada
cuadrado de cuatro fotositos: cuatro veces más rápido, la cuarta parte de
memoria) y se reduce al tamaño de pantalla. La resolución completa sólo se
revela al exportar a *Original*: una FX30 sale a 6240×4168. Por encima de
36 Mpx (A7R V, A1) también se exporta a media resolución, porque entera serían
más de 300 MB de luz en coma flotante y Safari cierra la pestaña.

El decodificador es la compilación **sin hilos** de LibRaw. La versión con
hilos necesita memoria compartida, que Safari sólo da a páginas con cabeceras
de aislamiento de origen cruzado, y ni GitHub Pages ni la app nativa las tienen.
Se comprobó en el binario (la versión con hilos importa su memoria como
compartida; ésta define la suya sin compartir) y revelando la FX30 en un worker
donde crear memoria compartida estaba prohibido, como en Safari.

**No hay exposición base.** Se probó a igualar el brillo con el JPEG que la
cámara guarda dentro del ARW, y no sirve de referencia: lleva el estilo de
imagen de la cámara. El de la FX30 salía 0,7 EV más oscuro que la propia luz
del sensor; igualarlo habría sido copiar un look, no medir nada.

En el iPhone, el ARW se elige desde **Archivos**: desde la fototeca, iOS suele
entregar un JPEG en su lugar.

### Biblioteca

Como Fotos: título grande con el recuento, botones de cristal (Seleccionar,
Importar y la rueda de **Ajustes**), Todo · Fotos · Vídeos en un control segmentado y la cuadrícula de
borde a borde, cuadrada y con junta de dos píxeles, **separada por meses**.
**Pellizcar** cambia entre tres y cinco columnas (se recuerda). **Mantener
pulsada** una foto abre sus opciones; con ratón, clic derecho o el ⋯ que
aparece al pasar por encima. Al seleccionar, cada foto lleva la marca azul de
Fotos y la cápsula de secciones se cambia por la barra de selección: guardar,
el recuento, pegar ajustes y eliminar. Al final de la cuadrícula, cuántas hay
y el espacio que ocupan.

**Guardar es un toque, sin menús.** En el visor, en la selección o al exportar
del laboratorio: en la app del iPhone va directa a **Fotos** («Guardada en
Fotos»), en la de Mac a Imágenes › Laboratorio › Exportadas, y en el navegador
del ordenador se descarga. Guardar desde el visor no lo cierra: se sigue
mirando. En Safari para iPhone una web no puede escribir en Fotos; lo más
directo que hay es abrir la hoja de iOS en el acto, donde *Guardar imagen* es
un toque, y eso es lo que hace mientras dure la activación del toque
(`navigator.userActivation`); si preparar el archivo la ha agotado, aparece la
hoja de siempre, que pide otro.

**Ajustes** (la rueda de la cabecera, o ⌘, en la app de Mac):

- **Guardar directamente en la galería** — activado de fábrica. Es el guardado
  en un toque de arriba y, en la app nativa, que **cada foto o vídeo de la
  cámara se copie solo a Fotos** al dispararlo (sin retener el disparador: si
  Fotos falla, la foto sigue en la biblioteca y se dice cómo dar el permiso).
  Apagado, «Guardar» vuelve a la hoja que deja elegir qué hacer con el archivo.
- **Formato de la cámara** — JPEG (calidad máxima, con la emulsión revelada) o
  RAW (sin pérdida, con la emulsión editable). Es el mismo botón RAW de la
  cámara.

Se guardan en el dispositivo (`js/store/ajustes.js`).

Tocar una miniatura abre un **visor a pantalla completa**: la foto sobre negro y
nada más, siempre entera. Arriba, como en Fotos, el día («Hoy», «Ayer») y la
hora, y abajo una barra de cristal con guardar, editar en el laboratorio y
borrar; deslizar hacia abajo lo cierra. (En una pantalla ancha una foto grande se ajustaba al
ancho y se salía por arriba y por abajo, como ampliada; en el teléfono no se
notaba porque manda el ancho.) Un toque saca los botones que hacen falta —cerrar, abrir en el
laboratorio, guardar en el dispositivo, borrar— y otro los quita. Borrar
pregunta antes, y al confirmar el visor sigue con la siguiente en vez de
devolverte a la cuadrícula: se estaba mirando, no ordenando. Se desliza en
horizontal para pasar de una a otra, y se carga un archivo cada vez: con doce
megapíxeles por imagen, mantener varias abiertas es la forma más rápida de que
Safari cierre la pestaña.

La carpeta local por dentro. Miniaturas, espacio ocupado, y para cada archivo:
abrir en el laboratorio, guardar en el dispositivo o eliminar.

#### Importar

El botón **Importar** abre el menú de importación:

- **Fotos y vídeos…** o **Carpeta o disco…**: una carpeta entera con sus
  subcarpetas, que sirve igual para una de Imágenes, para la **tarjeta de la
  cámara** o para un **disco externo** (en el Mac salen en el selector, bajo
  *Ubicaciones*). También se pueden **soltar** fotos o carpetas encima de la
  ventana.
- Todo sale en miniatura, agrupado por carpeta, y se marca qué entra: **una a
  una** con un clic, un tramo con **Mayúsculas**, **Seleccionar todas**,
  **Ninguna**, o una carpeta entera desde su título. Abajo, cuántas van y
  cuánto ocupan.
- Lo que no es foto ni vídeo se queda fuera solo: las copias ocultas «._» que
  deja el Mac en las tarjetas, los .XML de los vídeos de Sony, los .THM…
- Lo que ya se importó antes sale como **Ya importada** y desmarcado: volver a
  meter la misma tarjeta no duplica nada.
- De un **RAW** no se revela nada para verlo: se usa la vista previa en JPEG que
  la cámara guarda dentro del archivo, así que una tarjeta con cientos de ARW se
  ve al momento y se importa deprisa. Después, en segundo plano y de uno en uno,
  la miniatura se rehace con el revelado de la app —lo que se verá al abrirlo— y
  se apunta el tamaño real del sensor. Se para mientras estás en el laboratorio
  o en la cámara.

Una sola foto elegida desde el laboratorio, o soltada sola, se importa y se
abre directamente, como siempre.

#### En una carpeta de Imágenes (Mac, con Chrome o Edge)

Los originales pueden guardarse como archivos normales en una carpeta del
ordenador, visible en el Finder, en vez de dentro del navegador: en la
biblioteca, **Guardar en Imágenes…** (o desde el menú de importación). Se elige
**Imágenes** y dentro se crea **Laboratorio**, con una subcarpeta por cada
importación —«2026-10-11 Viaje», que se puede renombrar antes de importar— y
otras por fecha para lo capturado («Cámara») y lo revelado («Revelados»). Los
archivos conservan su nombre (DSC01234.ARW). Lo que ya hubiera en la biblioteca
se puede pasar también.

- Las miniaturas y los ajustes siguen en la app: son caché y metadatos.
- Borrar una foto de la biblioteca borra **su copia** de esa carpeta, la que
  hizo la app al importarla; nada más de la carpeta se toca, y el original de
  la tarjeta o del disco, tampoco.
- El navegador puede pedir que se le vuelva a dar acceso a la carpeta en otra
  sesión: la biblioteca lo avisa con un botón **Dar acceso**. Instalando la app
  desde Chrome (⋮ → *Instalar*) se puede dejar el permiso fijo.
- **Safari no lo permite**: no deja a una web escribir en una carpeta elegida.
  Ahí las fotos se guardan dentro del navegador, como hasta ahora, y se sacan
  con *Guardar*.

**Lo editado en el laboratorio es lo que se ve aquí.** El original no se toca
nunca —los ajustes se guardan aparte, junto a él—, pero fuera del laboratorio
la foto se enseña y se entrega revelada:

- **La miniatura** se rehace al salir del laboratorio, con la emulsión, la luz
  y el encuadre. Sale del propio lienzo del laboratorio, que ya tiene la foto
  revelada: no hay que volver a leer el original. Una marca ◑ dice con qué
  emulsión está editada.
- **El visor** la revela al tamaño de la pantalla.
- **Guardar** la revela a resolución completa en JPEG, con el nombre de su
  emulsión. Si hace falta el archivo tal como entró, en la ficha (⋯) está
  *Guardar el original*, y *Quitar los ajustes* la devuelve a como era.

**Copiar y pegar ajustes.** *Copiar ajustes* (en la ficha de una foto, en el
laboratorio, o ⌘C) se lleva el **color**: emulsión, luz, color, curvas, HSL,
etalonaje, detalle, efectos y viñeta. El **encuadre no viaja**: el recorte y el
giro son de cada foto, y pegar uno ajeno descuadraría las demás. Lo copiado
sobrevive a cerrar la app.

Para pegarlo **en todas las fotos**: *Seleccionar* → *Todo* → *Pegar ajustes*.
Pregunta antes, avisa de cuántas ya tenían ajustes de color (se sustituyen),
enseña el avance y se salta los vídeos, que se revelan en tiempo real y no
guardan ajustes. Las miniaturas cambian una a una según se van haciendo. Si
la foto que está abierta en el laboratorio recibe ajustes desde aquí, el
laboratorio los recoge al volver, y un ⌘Z los deshace.

**Selección múltiple** con el botón *Seleccionar*, o manteniendo pulsada una
miniatura. Desde ahí se comparten, se pegan ajustes o se eliminan varios de una
vez; compartir usa la hoja del sistema, que en iPhone admite lotes. En el Mac,
con la selección abierta: ⌘A todo, ⌘C copia los ajustes de la única elegida y
⌘V los pega en las elegidas.

---

## Exportación

Botón **Exportar** del laboratorio: tamaño (original, 4K, 2K, 1080, web),
formato (JPEG, PNG, WebP) y calidad. Dos destinos:

- **Guardar en el dispositivo** — en un toque, como en la biblioteca: a Fotos
  en la app del iPhone, a la carpeta de Exportadas en la de Mac, descargado en
  el navegador del ordenador y la hoja de iOS en Safari.
- **Guardar en la biblioteca** — deja el resultado en la carpeta local.

Guardar en iPhone tiene tres trampas, y las tres hacían que fallara en silencio:

1. `navigator.share` exige **activación del usuario**, y esa activación caduca.
   Si entre el toque y la llamada se revela una foto de doce megapíxeles, para
   cuando se llama ya no vale y Safari responde `NotAllowedError`. Por eso se
   mira `navigator.userActivation` al terminar de revelar: si el toque sigue
   valiendo se comparte en el acto, y si no, una hoja pide un toque nuevo y
   desde ahí la del sistema se abre con la activación viva.
2. El atributo `download` de un enlace existe en Safari pero **se ignora** con
   destinos blob. No es una reserva válida en iPhone, así que cuando no hay hoja
   del sistema se muestra la imagen para guardarla manteniéndola pulsada.
3. La marca de tiempo llega al segundo, así que preparar varios archivos de
   golpe los bautizaba a todos igual. Ahora se numeran.

El revelado de exportación es un pase nuevo a resolución completa con los
mismos shaders que la previsualización, no un reescalado de lo que había en
pantalla.

---

## LUT para Lightroom y vídeo

La carpeta [`luts/`](luts/) tiene las emulsiones Kodak de cine (Vision3 250D,
Vision3 500T, copia 2383) y de negativo (Portra 400 y 800, Gold 200, Ektar 100,
Tri-X 400) para usarlas fuera de la app:

- **Perfiles de Lightroom** (`.xmp`), que se importan directamente en
  Lightroom Classic, Lightroom o Camera Raw, sin pasar por Photoshop, con su
  deslizador de cantidad de 0 a 200.
- **`.cube` de 33 puntos** para Photoshop, Premiere, DaVinci o Final Cut.

Cómo instalarlos, en [`luts/LEEME.md`](luts/LEEME.md).

No son una imitación: `tools/luts.mjs` revela cada punto de la retícula con el
shader del laboratorio, en coma flotante, y antes de escribir nada comprueba
que el LUT aplicado a una carta de color da lo mismo que la app (0,3 niveles de
media, el propio tramado). Lo que un LUT no puede llevar se queda fuera: el
grano y la viñeta. Los perfiles guardan la tabla en el formato del DNG SDK de
Adobe y se leen de vuelta para comprobarlos.

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
| `engine` | Los seis programas GLSL compilan · **cada uno de los 30 deslizadores mueve píxeles de verdad**, medido a sus dos extremos y con el efecto padre encendido —es lo que destapó que la halación y el bloom no hacían nada— · todas las emulsiones renderizan con firma distinta y sin recortar · el perfil neutro es la identidad **al bit** · ocho casos de geometría (giros, espejos, recortes) con sus dimensiones · el histograma · la orientación con `canvas`, `ImageBitmap` e `<img>` |
| `flow` | Importar → carpeta local → laboratorio → los diez paneles → aplicar emulsión → deslizadores → deshacer/rehacer → exportar a resolución original y reabrir el JPEG → guardar en biblioteca → recorte 1:1 → persistencia tras recargar |
| `picker` | El catálogo sin Digital, Diapositiva ni Creativa (y una foto con una emulsión retirada se abre en neutro), y el selector: sólo nombres, sin un recuadro encima, la activa marcada, una sola fila baja, tocar elige una vez, y el mismo en el laboratorio |
| `wheel` | La rueda de etalonaje cubre los 360° de matiz con el centro neutro |
| `context` | El contexto WebGL se pierde y se recupera, y se sigue renderizando bien |
| `layout` | El reparto de pantalla: la cámara arranca en «Máx» sin recortar el sensor, con «Pantalla» cubre la pantalla y lo capturado coincide con lo que se ve, hay un mando por grupo de funciones (Filtros, Exposición, Dimensiones, Flash) y ninguno de más —el zoom en sus botones y sin barras laterales—, cada ventana abre sólo una a la vez, ocultar los mandos deja el encuadre limpio, la imagen del laboratorio es más grande que los ajustes, plegar la agranda, los ajustes son casi transparentes mientras la barra apenas se vela, y ningún panel desborda |
| `camera` | Que arranca en calidad máxima (sensor completo, JPEG 100 %) y en JPEG. Flujo a 4K, foto a resolución nativa, grabación en MP4 a 30 fps —contando los fotogramas que el reloj pide de verdad, con el visor detenido— y que reabrir una captura JPEG no vuelva a aplicar la emulsión. El RAW: que se enciende y se recuerda, que guarda un PNG con el fotograma entero sin recortar, la emulsión como ajuste editable y su miniatura revelada, y que el laboratorio lo abre con la emulsión puesta. Los filtros: una fila de nombres sin recuadros, sin las familias retiradas, con todo el catálogo; la copia de cine se elige antes de disparar y la banda de naranjas que propone no se hereda. El zoom: botones 1× · 2 · 4 encima de los modos, que «2» acerca a 2×, que arrastrarlos despliega la regla rotulada y acerca, que se recoge sola, que siguen al pellizco y que sin gran angular no hay 0,5. La exposición: su ventana con el valor en grande, la regla de −3 a +3 con «Más oscura / Más clara», que arrastrar la sube, que el valor sale también en el botón, «Volver a 0» y tocar un número. El flash como interruptor: que encienda, que dé luz sin LED y que apagado no dé ninguna. Además: que la cámara **siga pintando** al volver de Laboratorio o Biblioteca y tras pasar a segundo plano —leyendo píxeles reales del framebuffer, no suponiendo—, el zoom, y que la detección de navegador incrustado no confunda a Safari ni a Chrome — ni a la propia app nativa, que también es una vista web sin «Safari» en su user agent y sin la excepción bloquearía su cámara |
| `save` | Como Safari en un iPhone: selección múltiple, y que guardar sea **un toque** —la hoja de iOS en el acto, sin hoja propia, desde la selección, el visor (que sigue abierto) y la exportación— y siempre **con la activación del usuario viva**, la comprobación que distingue un guardado que funciona de uno que falla en silencio en iPhone. Los Ajustes: «Guardar directamente en la galería» activado de fábrica, que apagarlo se recuerda y devuelve la hoja de siempre. Con el puente de Capacitor y el plugin de Fotos simulados: que cada foto de la cámara se copia sola a Fotos como JPEG, que «Guardar» va a Fotos sin ninguna hoja, y que sin permiso dice dónde darlo. En el ordenador, que se descarga sin preguntar. También los nombres únicos por lote, la reserva de mantener pulsado, y borrar desde el visor: que pregunte, que cancelar no toque nada y que confirmar siga con la siguiente foto |
| `raw` | Con un ARW real de una Sony FX30: que se reconozca por nombre o por tipo, que la conversión a media precisión sea exacta en los 63 488 float16 finitos, que entre en la biblioteca como `.arw` y no como `.bin`, que el laboratorio lo revele como luz lineal en una textura flotante, que a +1,5 EV no queme lo que la misma imagen en 8 bits sí quema, que a +3 EV sus sombras tengan más del doble de tonos, que girarlo no cueste nada de eso, el antes/después, el selector de emulsión, el visor y la exportación a 6240×4168. El ARW (31 MB) se descarga la primera vez; sin red, la suite se omite avisando |
| `heif` | Con dos muestras pequeñas que van en el repositorio, hechas con libheif + x265 con la estructura de las de verdad —un HEIC de 8 bits 4:2:0 como el del iPhone y un HIF de 10 bits 4:2:2 como el de una Sony, cada uno con su miniatura dentro— y un patrón de cuatro colores conocidos: que Chromium no los abre por su cuenta (es lo que hay que probar), que la miniatura sale de la que lleva dentro, que la foto entera sale a su tamaño con los colores exactos y en su sitio (±3 de 255, también el 4:2:2 de 10 bits), que entran por el menú con su miniatura y su tamaño, que un .HIF sin tipo queda como image/heif, que el visor y el laboratorio los abren con los mismos colores, que exportar con un ajuste sale a 3000×2000 y que un solo .HIF va directo al laboratorio |
| `import` | Una «tarjeta de memoria» con dos carpetas, un ARW de verdad, las copias «._» del Mac y un XML de Sony: entran las siete fotos agrupadas por carpeta, se ignora lo demás y el RAW se ve por su vista previa incrustada. Marcar una a una, un tramo con Mayúsculas, todas y ninguna. Con la carpeta de Imágenes elegida (el selector se simula con una carpeta del sistema de archivos privado, que tiene la misma interfaz), los originales quedan en Laboratorio/<subcarpeta>/ con su nombre, y el visor los abre desde allí; la miniatura del RAW entra provisional y se rehace con el tamaño del sensor (6240×4168); volver a meter la tarjeta avisa de las ya importadas. Y el laboratorio: la tira abre fotos y ← → pasa de una a otra; doble clic amplía al 100 % con la foto entera (4800 px), arrastrar y el trackpad la mueven, editar ampliada sigue sobre la foto entera, doble clic, Z y Esc; una foto pequeña se dobla; mantener pulsado sigue enseñando el antes. Una sola foto va directa al laboratorio |
| `desktop` | El Mac: que en una ventana de 1440×900 los ajustes vayan en una columna a la derecha sin tapar la foto, que tocar la pestaña activa no los esconda, y que en el iPhone todo siga como estaba. Lo editado en el laboratorio —emulsión, exposición y un giro— tiene que aparecer en la miniatura, en el visor y **en el archivo que se guarda**, abierto y medido: a 1200×900 y más claro, mientras *Guardar el original* entrega los bytes de entrada. Copiar lleva el color y no el encuadre; pegar en las tres fotos pregunta, respeta el recorte y el espejo que tenía cada una y rehace sus miniaturas; la foto abierta en el laboratorio recoge lo pegado; ⌘Z, ⇧⌘Z, ⌘C y ⌘V, también con un deslizador en foco; *Quitar los ajustes* devuelve el original a la cuadrícula. Y que al volver del laboratorio no salgan casillas repetidas |
| `conmutador` | El diseño de Fotos y sus gestos, hechos de verdad con el puntero y con toques de dos dedos: que la cápsula flota centrada y es de cristal, que deslizar de lado mete la sección de al lado mientras se arrastra y se queda en ella (o en la siguiente con un golpe, y en la misma si fue poco y despacio), que deslizar hacia arriba encoge la pantalla a tarjeta con las otras al lado y sus títulos, que el carrusel queda abierto, se mueve de lado y un toque entra, que subir poco no lo abre, que dos dedos lo abren y un pellizco no, y que nunca quedan estilos del gesto pegados a las vistas. La biblioteca: título grande, tres columnas de borde a borde, meses, pellizco a cinco y vuelta a tres, y mantener pulsado abre las opciones sin que el click de después las cierre. El visor: guardar · editar · borrar en ese orden y deslizar hacia abajo cierra. El laboratorio: un círculo por ajuste y una sola regla, que tocar otro círculo trae la suya y que moverla cambia el ajuste, el número y el aro. La cámara: la última foto junto al disparador abre el visor y al cerrarlo la cámara sigue encendida |
| `mac` | La app de Mac con Electron de verdad (en Linux, bajo una pantalla virtual): que el protocolo laboratorio:// sirve el WebAssembly con su tipo y nunca sale de la carpeta de la web, que abre su ventana con la app dentro en un contexto seguro y sin service worker, los menús (Ajustes con ⌘,, Archivo, Edición, Ver con ⌘1 ⌘2 ⌘3, Ventana) y que Ver y Archivo hacen lo que dicen, que un HEIC y un ARW abiertos con la app entran en la biblioteca descodificados por libheif y LibRaw en sus workers y se abren en el laboratorio, que guardar va sin diálogo a Imágenes › Laboratorio › Exportadas sin pisar nada, y que la biblioteca sigue al volver a abrir la app. Sin `npm install` en mac/ se omite |
| `alojada` | La app importada desde la página de otro origen, como la carga Floot (dos servidores, uno con el CORS de GitHub Pages): que arranca con su hoja de estilos, que no registra service worker en la anfitriona, que un HIF de Sony y un ARW se descodifican en sus workers —sin `alojada.js` el navegador se niega a crearlos—, y que una foto importada queda en la biblioteca de la anfitriona, sigue tras recargar y se abre en el laboratorio |
| `ios` | Que la copia de la app web dentro del proyecto de Xcode sea **idéntica** a lo que se publica —si no, la app del iPhone se queda con la versión vieja sin avisar— y que el Info.plist lleve los textos de permiso de cámara, micrófono y Fotos, cuya falta no da un error de compilación sino un cierre de la app en el teléfono. Y que el plugin de Fotos esté registrado y enlazado en el paquete de Swift en una ruta que existe, que si no «Guardar» volvería a la hoja de compartir sin avisar |

Las propiedades matemáticas de las curvas (pivote exacto, blanco exacto,
continuidad C¹, monotonía, asíntota del pie) se verifican canal a canal para
todas las emulsiones.

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

Grano dependiente de la densidad —máximo en los medios, casi ausente en el
negro sólido y el blanco quemado—, difusión tipo Pro-Mist, viñeta con caída
circular o siguiendo el encuadre, aberración cromática y tramado final para
romper el bandeado al cuantizar a 8 bits.

**Sin halación ni bloom.** Los llevaba, y no funcionaban: los dos partían del
desenfoque largo y comparaban ESE resultado contra su umbral, cuando el orden
correcto es al revés —recortar primero las altas luces sobre la imagen nítida y
desenfocar después ese recorte—. Desenfocar antes aplasta la luz por debajo del
umbral justo antes de medirla, así que con el umbral por defecto no aparecía
nada. Medido sobre una escena oscura con una luz quemada: a la cantidad que
traían las emulsiones (0,07–0,20) la diferencia máxima era de 1 sobre 255, y al
máximo del deslizador, de 4. Se quitan en vez de dejar un mando que miente.

El contraste es **biyectivo en [0,1]**: una potencia por debajo del pivote y su
reflejo por encima, con la misma pendiente a ambos lados. Redistribuye la
escala sin amputarla, así que nunca recorta.

### Emulsiones

**Negativo color** — Portra 400, Portra 800, Gold 200, Ektar 100,
Superia X-TRA 400, Pro 400H, Vista Plus 200, Reala 100, Pro 160NS,
Fujicolor C200, Natura 1600
**Cine** — Vision3 250D, Vision3 500T, CineStill 800T, Copia de cine 2383,
Eterna 250D
**Blanco y negro** — Tri-X 400, HP5 Plus 400, Delta 3200
**Instantánea** — Polaroid 600
**Referencia** — Sin emulsión (identidad exacta, verificada al bit). No sale en
los selectores: es el punto de partida del laboratorio.

Las diapositivas (Velvia, Provia, Astia, Kodachrome), la LomoChrome Purple y el
«Neutro digital» como filtro se retiraron del catálogo. Una foto revelada con
una de ellas no cambia —la emulsión está en sus píxeles o en sus ajustes—, y si
se reabre en el laboratorio queda sin emulsión.

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
tools/luts.mjs               genera luts/: perfiles de Lightroom y .cube
luts/                        las emulsiones Kodak como LUT

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
    library.js               biblioteca: OPFS + IndexedDB, o una carpeta de Imágenes
    raw.js                   RAW de Sony: LibRaw en un worker, luz lineal
    develop.js               revelar con los ajustes fuera del laboratorio;
                             portapapeles de ajustes
    importar.js              meter archivos en la biblioteca; miniaturas de
                             RAW provisionales y su refinado
    preview.js               qué se puede importar, vista previa de un RAW,
                             carpetas soltadas
    heif.js                  HEIC y HIF: el navegador o libheif en un worker
  vendor/
    libraw/                  LibRaw en WebAssembly (RAW)
    libheif/                 libheif + libde265 en WebAssembly (HEIF)
  ui/
    controls.js curve.js wheel.js crop.js histogram.js filmpicker.js panels.js
    viewer.js                visor a pantalla completa
    filmstrip.js             tira de fotos del laboratorio
    importer.js              menú de importación
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
que alimenta la textura y el largo que alimenta la claridad y la difusión. La
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
- Los HIF de Sony grabados en **HLG** (el ajuste «Imágenes fijas HLG») se
  abren como si fueran SDR: se ven planos y lavados, porque no se convierte la
  curva HLG. Los normales, sí bien.
- Los RAW que se abren son los de **Sony**. LibRaw sabe leer los de otras
  marcas, pero sólo los ARW se han probado con un archivo real; abrir los demás
  es cambiar una línea en `js/store/raw.js`, y probarlos, otra cosa.
- Revelar un ARW tarda: unos 2 s a media resolución para editar y unos 7 s a
  resolución completa al exportar, en un ordenador. En un iPhone, más.
- Pegar ajustes en muchas fotos rehace sus miniaturas una a una, y la de un
  RAW pide revelarlo: con cien ARW, son minutos. Y fuera del laboratorio no hay
  deshacer: por eso pregunta antes.
- Guardar de una vez varias fotos editadas las revela todas a resolución
  completa antes de abrir la hoja de compartir (si no, iOS la rechaza), y
  todas ocupan memoria a la vez. Con decenas de fotos de 24 Mpx en un iPhone,
  mejor por tandas.
- El revelado de vídeo en el laboratorio va en tiempo real, porque el
  navegador no ofrece codificación más rápida que la reproducción. Un clip de
  un minuto tarda un minuto.
- Las emulsiones son interpretaciones fundamentadas en el comportamiento
  documentado de cada película, no medidas de densitómetro sobre muestras
  reales.
