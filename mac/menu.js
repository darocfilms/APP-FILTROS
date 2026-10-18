/**
 * menu.js — La barra de menús de Laboratorio en el Mac.
 *
 * Lo propio del Mac: el menú de la app con Ocultar y Salir, Archivo para
 * importar y exportar, Edición (sin él ⌘C y ⌘V no funcionan ni en un campo de
 * texto), Ver con las tres secciones en ⌘1, ⌘2 y ⌘3, y Ventana.
 *
 * Deshacer, rehacer, copiar y pegar son los del sistema: la página recibe la
 * tecla primero, y el laboratorio y la biblioteca ya entienden ⌘Z, ⌘C y ⌘V
 * (deshacen un ajuste, copian y pegan ajustes). Si la página no la usa, la
 * recibe el campo de texto que tenga el foco, como en cualquier app.
 *
 * `accion(nombre)` la pone main.js: manda la orden a la página.
 */

const { Menu, shell } = require('electron');

const WEB = 'https://darocfilms.github.io/APP-FILTROS/';

function construirMenu({ accion, desarrollo = false }) {
  const plantilla = [
    {
      label: 'Laboratorio',
      submenu: [
        { role: 'about', label: 'Acerca de Laboratorio' },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Laboratorio' },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de Laboratorio' },
      ],
    },
    {
      label: 'Archivo',
      submenu: [
        { id: 'importar', label: 'Importar fotos…', accelerator: 'CmdOrCtrl+O', click: () => accion('importar') },
        { id: 'importar-carpeta', label: 'Importar una carpeta o un disco…', accelerator: 'Shift+CmdOrCtrl+O', click: () => accion('importar-carpeta') },
        { type: 'separator' },
        { id: 'exportar', label: 'Exportar la foto del laboratorio…', accelerator: 'CmdOrCtrl+E', click: () => accion('exportar') },
        { id: 'exportadas', label: 'Mostrar las fotos exportadas en el Finder', click: () => accion('mostrar-exportadas') },
        { type: 'separator' },
        { role: 'close', label: 'Cerrar la ventana' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { id: 'ver-camera', label: 'Cámara', accelerator: 'CmdOrCtrl+1', click: () => accion('camera') },
        { id: 'ver-lab', label: 'Laboratorio', accelerator: 'CmdOrCtrl+2', click: () => accion('lab') },
        { id: 'ver-library', label: 'Biblioteca', accelerator: 'CmdOrCtrl+3', click: () => accion('library') },
        { id: 'ver-carrusel', label: 'Cambiar de sección…', accelerator: 'CmdOrCtrl+0', click: () => accion('carrusel') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(desarrollo ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      role: 'windowMenu',
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' },
      ],
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        { label: 'Laboratorio en la web', click: () => shell.openExternal(WEB) },
      ],
    },
  ];
  return Menu.buildFromTemplate(plantilla);
}

module.exports = { construirMenu };
