import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const server = spawn('node',[ROOT+'/serve.mjs','--port=8093'],{cwd:ROOT,stdio:'ignore'});
await new Promise(r=>setTimeout(r,900));
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page = await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto('http://localhost:8093',{waitUntil:'networkidle'});
await page.waitForTimeout(1800);
const r = await page.evaluate(async () => {
  const { ColorWheel } = await import('./js/ui/wheel.js');
  const w = new ColorWheel('Prueba', { h: 0, s: 0, l: 0 }, () => {});
  document.body.append(w.root);
  const g = w.canvas.getContext('2d');
  const R = w.canvas.width / 2;
  // Muestrear 12 puntos en un anillo: deben cubrir toda la rueda de matices.
  const hues = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = g.getImageData(Math.round(R + Math.cos(a) * R * 0.75), Math.round(R - Math.sin(a) * R * 0.75), 1, 1).data;
    // RGB → matiz
    const [rr, gg, bb] = [p[0] / 255, p[1] / 255, p[2] / 255];
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), d = mx - mn;
    let h = 0;
    if (d > 0.01) {
      if (mx === rr) h = ((gg - bb) / d) % 6;
      else if (mx === gg) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    hues.push({ esperado: Math.round((i / 12) * 360), medido: Math.round(h), croma: +d.toFixed(2) });
  }
  // El centro debe ser gris.
  const c = g.getImageData(R, R, 1, 1).data;
  w.root.remove();
  return { hues, centro: [c[0], c[1], c[2]] };
});
let bad = 0;
for (const h of r.hues) {
  const diff = Math.min(Math.abs(h.medido - h.esperado), 360 - Math.abs(h.medido - h.esperado));
  const ok = diff < 12 && h.croma > 0.15;
  if (!ok) bad++;
  console.log((ok?'  ✓ ':'  ✗ ') + 'matiz ' + String(h.esperado).padStart(3) + '° → medido ' + String(h.medido).padStart(3) + '°  croma ' + h.croma);
}
const centroGris = Math.max(...r.centro) - Math.min(...r.centro) < 12;
console.log((centroGris?'  ✓ ':'  ✗ ') + 'el centro es neutro  rgb(' + r.centro.join(',') + ')');
if (!centroGris) bad++;
console.log(bad ? '\n' + bad + ' fallo(s)' : '\ntodo correcto');
await browser.close(); server.kill();
process.exit(bad?1:0);
