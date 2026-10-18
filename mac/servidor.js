/**
 * servidor.js — Sirve la app web desde dentro de la app de Mac.
 *
 * La app de Mac lleva dentro la misma carpeta dist/ que se publica en GitHub
 * Pages y la sirve con un protocolo propio, laboratorio://app/. No vale abrir
 * los archivos con file://: ahí no hay origen, y sin origen no hay módulos ES,
 * ni workers (los descodificadores de RAW y HEIF), ni IndexedDB ni el sistema
 * de archivos privado donde vive la biblioteca. Un esquema propio registrado
 * como seguro sí lo tiene todo, y además funciona sin conexión.
 *
 * Esto es sólo la parte que decide qué archivo y con qué tipo se responde: no
 * depende de Electron, y así se puede probar suelto.
 */

const fs = require('node:fs');
const path = require('node:path');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  // Sin este tipo el motor no compila el WebAssembly mientras lo descarga.
  '.wasm': 'application/wasm',
};

/**
 * Traduce una URL laboratorio://app/… a un archivo dentro de `raiz`.
 * Devuelve null si se sale de la carpeta (../, rutas absolutas, %2e%2e…).
 */
function rutaDe(url, raiz) {
  let u;
  try { u = new URL(url); } catch { return null; }
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { return null; }
  if (rel.endsWith('/')) rel += 'index.html';
  const base = path.resolve(raiz);
  const archivo = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (archivo !== base && !archivo.startsWith(base + path.sep)) return null;
  return archivo;
}

/**
 * Responde a una petición: { estado, tipo, cuerpo }. El cuerpo es un Buffer o
 * null. Se lee entero: el archivo más grande (el descodificador de RAW) pesa
 * 1,4 MB, y leído de un disco local es instantáneo.
 */
function responder(url, raiz) {
  const archivo = rutaDe(url, raiz);
  if (!archivo) return { estado: 403, tipo: 'text/plain; charset=utf-8', cuerpo: Buffer.from('Prohibido') };
  let datos;
  try {
    if (!fs.statSync(archivo).isFile()) throw new Error('no es un archivo');
    datos = fs.readFileSync(archivo);
  } catch {
    return { estado: 404, tipo: 'text/plain; charset=utf-8', cuerpo: Buffer.from('No encontrado') };
  }
  return { estado: 200, tipo: TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream', cuerpo: datos };
}

/**
 * Un nombre que no pise nada en `carpeta`: «foto.jpg», «foto 2.jpg», «foto 3.jpg»…
 * Es lo que hace el Finder al copiar dos veces el mismo archivo.
 */
function nombreLibre(carpeta, nombre) {
  const limpio = path.basename(nombre || 'Laboratorio').replace(/[/\\:]/g, '-') || 'Laboratorio';
  const ext = path.extname(limpio);
  const base = limpio.slice(0, limpio.length - ext.length);
  let candidato = limpio;
  for (let n = 2; fs.existsSync(path.join(carpeta, candidato)); n++) candidato = `${base} ${n}${ext}`;
  return path.join(carpeta, candidato);
}

module.exports = { rutaDe, responder, nombreLibre, TIPOS };
