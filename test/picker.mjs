import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const server = spawn('node', [ROOT + '/serve.mjs', '--port=8097'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto('http://localhost:8097', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const r = await page.evaluate(async () => {
  const { FilmPicker } = await import('./js/ui/filmpicker.js');
  // Fuente inequívoca: mitad de arriba roja, mitad de abajo azul.
  const src = document.createElement('canvas');
  src.width = 400; src.height = 400;
  const g = src.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 400, 200);
  g.fillStyle = '#0000ff'; g.fillRect(0, 200, 400, 200);
  const bitmap = await createImageBitmap(await new Promise((res) => src.toBlob(res, 'image/png')));

  const picker = new FilmPicker(() => {});
  document.body.append(picker.root);
  picker.setSource(bitmap);
  await picker._renderCard('portra400');
  await picker._renderCard('neutral');

  const read = (id) => {
    const c = picker.cards.get(id).canvas;
    const g2 = c.getContext('2d');
    const top = g2.getImageData(c.width / 2, 8, 1, 1).data;
    const bot = g2.getImageData(c.width / 2, c.height - 8, 1, 1).data;
    const name = (p) => (p[0] > 150 && p[2] < 100 ? 'rojo' : p[2] > 150 && p[0] < 100 ? 'azul' : 'otro(' + [...p].slice(0, 3) + ')');
    return { arriba: name(top), abajo: name(bot) };
  };
  const out = { neutral: read('neutral'), portra400: read('portra400') };
  picker.destroy();
  picker.root.remove();
  return out;
});

let bad = 0;
for (const [k, v] of Object.entries(r)) {
  const ok = v.arriba === 'rojo' && v.abajo === 'azul';
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + 'miniatura ' + k.padEnd(12) + 'arriba=' + v.arriba + ' abajo=' + v.abajo);
}
await browser.close(); server.kill();
process.exit(bad ? 1 : 0);
