#!/usr/bin/env node
/**
 * serve.mjs — Servidor estático para desarrollo. Sin dependencias.
 *
 *   node serve.mjs              → http://localhost:8080
 *   node serve.mjs --https      → https://localhost:8443 con certificado propio
 *
 * El modo HTTPS existe por una razón concreta: `getUserMedia` sólo funciona en
 * contextos seguros. En el ordenador vale localhost, pero para probar en un
 * iPhone real hay que entrar por la IP de la red local, y ahí ya hace falta
 * TLS. El certificado es autofirmado, así que Safari pedirá aceptarlo una vez
 * (Ajustes → General → Información → Ajustes de confianza de certificados).
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const useHttps = process.argv.includes('--https');
const port = Number(process.argv.find((a) => /^--port=/.test(a))?.split('=')[1])
  || (useHttps ? 8443 : 8080);

const TYPES = {
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
  '.woff2': 'font/woff2',
};

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);
  // Nada fuera de la carpeta del proyecto.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // OPFS y los módulos no lo necesitan, pero deja la puerta abierta a
      // SharedArrayBuffer si algún día se mueve el revelado a un worker.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    }).end(data);
  });
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function ensureCert() {
  const dir = path.join(ROOT, '.certs');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };

  fs.mkdirSync(dir, { recursive: true });
  const hosts = ['localhost', ...localAddresses()];
  const san = hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? 'IP:' + h : 'DNS:' + h)).join(',');
  console.log('Generando certificado para: ' + hosts.join(', '));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '825',
    '-subj', '/CN=laboratorio.local',
    '-addext', 'subjectAltName=' + san,
  ], { stdio: 'inherit' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const server = useHttps ? https.createServer(ensureCert(), handler) : http.createServer(handler);

server.listen(port, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\n  Laboratorio en marcha\n`);
  console.log(`  Local:   ${scheme}://localhost:${port}`);
  for (const ip of localAddresses()) console.log(`  Red:     ${scheme}://${ip}:${port}`);
  if (!useHttps) {
    console.log('\n  La cámara sólo funciona en localhost o por HTTPS.');
    console.log('  Para probar en el iPhone: node serve.mjs --https\n');
  } else {
    console.log('\n  Certificado autofirmado: Safari pedirá aceptarlo la primera vez.\n');
  }
});
