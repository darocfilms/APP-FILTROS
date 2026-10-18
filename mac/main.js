/**
 * main.js — Laboratorio para macOS.
 *
 * Una app de Mac de verdad, con su icono en el Dock, su barra de menús y sin
 * navegador de por medio, que lleva dentro la misma app web que se publica en
 * GitHub Pages (la carpeta dist/). Por eso funciona sin conexión y todo lo que
 * se mejora en la web llega a la app de Mac en la siguiente compilación.
 *
 * Electron usa el motor de Chrome, y es lo que hace que aquí funcione todo lo
 * que en el Mac sólo funciona en Chrome: guardar la biblioteca en una carpeta
 * de Imágenes, importar carpetas y discos enteros, WebGL2 con coma flotante y
 * los descodificadores de RAW y HEIF en WebAssembly.
 *
 * Lo que añade la app al hacerse de Mac:
 *  - Barra de título integrada (los semáforos sobre el negro de la app).
 *  - Menús: importar (⌘O), exportar (⌘E), secciones (⌘1 ⌘2 ⌘3), pantalla
 *    completa… (menu.js).
 *  - Permiso de cámara y micrófono del sistema, con su explicación.
 *  - Lo que se guarda va directo a Imágenes › Laboratorio › Exportadas, con un
 *    aviso al terminar, en lugar de un diálogo por foto.
 *  - «Abrir con» y soltar fotos sobre el icono del Dock las importa.
 */

const {
  app, BrowserWindow, Menu, Notification, ipcMain, nativeTheme, protocol, session, shell, systemPreferences,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { responder, nombreLibre } = require('./servidor.js');
const { construirMenu } = require('./menu.js');

const ESQUEMA = 'laboratorio';
const ORIGEN = `${ESQUEMA}://app`;
const INICIO = `${ORIGEN}/index.html`;
const MAC = process.platform === 'darwin';

// Dentro de la app empaquetada la web va en Resources/web; durante el
// desarrollo, en la dist/ del repositorio (node build.mjs la genera).
const RAIZ = process.env.LABORATORIO_WEB
  || (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist'));

// Para las pruebas: datos y carpeta de Imágenes aparte, sin tocar los de verdad.
if (process.env.LABORATORIO_DATOS) app.setPath('userData', process.env.LABORATORIO_DATOS);
if (process.env.LABORATORIO_IMAGENES) app.setPath('pictures', process.env.LABORATORIO_IMAGENES);
app.setName('Laboratorio');

// Un esquema «estándar y seguro» tiene origen propio: módulos, workers,
// IndexedDB, el sistema de archivos privado y getUserMedia, como en HTTPS.
protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
}]);

let ventana = null;
/** La página ya escucha los archivos que se abran con la app. */
let lista = false;
/** Archivos abiertos con la app antes de que la página esté lista. */
const pendientes = [];

const carpetaExportadas = () => path.join(app.getPath('pictures'), 'Laboratorio', 'Exportadas');

/**
 * La política de la página: todo sale de dentro de la app, nada de internet.
 * Va sólo en los documentos HTML. Los workers de los descodificadores (LibRaw
 * y libheif, compilados con Emscripten) construyen funciones a partir de texto
 * y con esta política no arrancarían; un worker toma la política de su propia
 * respuesta, así que ellos van sin ella y la página sigue protegida.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' blob: data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/* ───────────────────────────── La ventana ──────────────────────────── */

function crearVentana() {
  lista = false;
  ventana = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 620,
    title: 'Laboratorio',
    backgroundColor: '#000000',
    show: false,
    // Los semáforos sobre la app, sin barra gris: la página deja libre esa
    // franja (la clase app-mac--barra, que pone preload.js).
    titleBarStyle: MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  ventana.once('ready-to-show', () => ventana.show());
  ventana.on('closed', () => { ventana = null; lista = false; });

  // En pantalla completa no hay semáforos: la franja reservada sobra.
  const completa = (on) => ventana?.webContents
    .executeJavaScript(`document.documentElement.classList.toggle('app-mac--completa', ${on})`).catch(() => {});
  ventana.on('enter-full-screen', () => completa(true));
  ventana.on('leave-full-screen', () => completa(false));

  // La app no navega fuera de sí misma: un enlace externo se abre en el
  // navegador, y soltar un archivo en la ventana lo maneja la página.
  const externo = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  ventana.webContents.setWindowOpenHandler(({ url }) => { externo(url); return { action: 'deny' }; });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGEN + '/')) { e.preventDefault(); externo(url); }
  });

  ventana.loadURL(INICIO);
  return ventana;
}

/** Una orden del menú: se ejecuta en la página como si fuera un toque. */
function accion(nombre) {
  if (nombre === 'mostrar-exportadas') {
    fs.mkdirSync(carpetaExportadas(), { recursive: true });
    shell.openPath(carpetaExportadas());
    return;
  }
  if (!ventana) crearVentana();
  // `true`: cuenta como gesto del usuario, que es lo que pide el navegador
  // para abrir el selector de archivos o de carpetas.
  ventana.webContents.executeJavaScript(`window.__labMenu?.(${JSON.stringify(nombre)})`, true).catch(() => {});
}

/* ──────────────────── Abrir con Laboratorio / soltar en el Dock ────── */

function abrirArchivos(rutas) {
  pendientes.push(...rutas);
  if (!app.isReady()) return;           // se mandan al estar lista la página
  if (!ventana) crearVentana();
  else if (lista) enviarPendientes();
}

function enviarPendientes() {
  if (!ventana || !pendientes.length) return;
  const archivos = pendientes.splice(0).map((ruta) => {
    try { return { nombre: path.basename(ruta), datos: fs.readFileSync(ruta) }; } catch { return null; }
  }).filter(Boolean);
  if (archivos.length) ventana.webContents.send('abrir-archivos', archivos);
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
}

ipcMain.on('lista', (e) => {
  if (!ventana || e.sender !== ventana.webContents) return;
  lista = true;
  enviarPendientes();
});

/* ─────────────────────────────── Permisos ──────────────────────────── */

function permisos(ses) {
  const PERMITIDOS = new Set(['media', 'fileSystem', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications']);
  const propio = (url) => typeof url === 'string' && url.startsWith(ORIGEN);
  ses.setPermissionCheckHandler((_wc, permiso, origen) => propio(origen) && PERMITIDOS.has(permiso));
  ses.setPermissionRequestHandler(async (_wc, permiso, decidir, detalles) => {
    if (!propio(detalles.requestingUrl) || !PERMITIDOS.has(permiso)) return decidir(false);
    if (permiso === 'media' && MAC) {
      // El permiso de verdad es del sistema (Ajustes del Sistema › Privacidad
      // y seguridad): se pide una vez, con el texto del Info.plist.
      let ok = true;
      for (const [tipo, clave] of [['video', 'camera'], ['audio', 'microphone']]) {
        if (!(detalles.mediaTypes || []).includes(tipo)) continue;
        if (systemPreferences.getMediaAccessStatus(clave) !== 'granted') {
          ok = (await systemPreferences.askForMediaAccess(clave)) && ok;
        }
      }
      return decidir(ok);
    }
    decidir(true);
  });
}

/* ──────────────────────────────── Guardar ──────────────────────────── */

/**
 * Lo que la página guarda (exportar, guardar la selección) llega como una
 * descarga. En vez de un diálogo por archivo, va directo a Imágenes ›
 * Laboratorio › Exportadas, sin pisar nada, y al terminar un aviso dice
 * cuántas y dónde; tocarlo las enseña en el Finder.
 */
function descargas(ses) {
  let hechas = [];
  let reloj = 0;
  ses.on('will-download', (_e, item) => {
    const carpeta = carpetaExportadas();
    fs.mkdirSync(carpeta, { recursive: true });
    const destino = nombreLibre(carpeta, item.getFilename());
    item.setSavePath(destino);
    item.once('done', (_d, estado) => {
      if (estado !== 'completed') return;
      if (MAC) app.dock?.downloadFinished?.(destino);
      hechas.push(destino);
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        const lote = hechas;
        hechas = [];
        if (!Notification.isSupported()) return;
        const aviso = new Notification({
          title: lote.length === 1 ? 'Foto guardada' : `${lote.length} archivos guardados`,
          body: 'En Imágenes › Laboratorio › Exportadas',
          silent: true,
        });
        aviso.on('click', () => shell.showItemInFolder(lote[lote.length - 1]));
        aviso.show();
      }, 700);
    });
  });
}

/* ───────────────────────────────── Arranque ────────────────────────── */

function arrancar() {
  nativeTheme.themeSource = 'dark';
  app.setAboutPanelOptions({
    applicationName: 'Laboratorio',
    applicationVersion: app.getVersion(),
    copyright: '© Daroc Films',
    credits: 'Cámara con emulsiones fotográficas reales y laboratorio de revelado con ciencia de color.',
  });
  protocol.handle(ESQUEMA, (req) => {
    const r = responder(req.url, RAIZ);
    const cabeceras = { 'Content-Type': r.tipo, 'Cache-Control': 'no-cache' };
    if (r.tipo.startsWith('text/html')) cabeceras['Content-Security-Policy'] = CSP;
    return new Response(r.cuerpo, { status: r.estado, headers: cabeceras });
  });
  permisos(session.defaultSession);
  descargas(session.defaultSession);
  Menu.setApplicationMenu(construirMenu({ accion, desarrollo: !app.isPackaged }));
  crearVentana();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) crearVentana(); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); }
    // En Windows y Linux los archivos llegan como argumentos.
    const rutas = argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile());
    if (rutas.length) abrirArchivos(rutas);
  });
  // Antes de `ready`: al abrir un archivo con la app cerrada, llega lo primero.
  app.on('open-file', (e, ruta) => { e.preventDefault(); abrirArchivos([ruta]); });
  app.whenReady().then(arrancar);
  // Como cualquier app de Mac, cerrar la ventana no la cierra: sigue en el Dock.
  app.on('window-all-closed', () => { if (!MAC) app.quit(); });
}
