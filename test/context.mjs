/** Pérdida y recuperación del contexto WebGL (lo que hace iOS al segundo plano). */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const server = spawn('node',[ROOT+'/serve.mjs','--port=8092'],{cwd:ROOT,stdio:'ignore'});
await new Promise(r=>setTimeout(r,900));
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page = await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto('http://localhost:8092',{waitUntil:'networkidle'});
await page.waitForTimeout(1800);

const r = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { defaultParams } = await import('./js/data/params.js');
  const src = document.createElement('canvas');
  src.width = 64; src.height = 64;
  const g = src.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#0000ff'; g.fillRect(0, 32, 64, 32);

  const canvas = document.createElement('canvas');
  let restored = false;
  const r = new Renderer(canvas, { onRestored: () => { restored = true; } });
  r.setSource(src, 64, 64);
  r.render(defaultParams(), { seed: 1 });
  const antes = [...r.ctx.readPixels(null, 32, canvas.height - 2, 1, 1)].slice(0, 3);

  // Forzar la pérdida y la restauración, igual que hace el sistema.
  const ext = r.ctx.gl.getExtension('WEBGL_lose_context');
  ext.loseContext();
  await new Promise((res) => setTimeout(res, 120));
  const perdido = r.ctx.lost;
  ext.restoreContext();
  await new Promise((res) => setTimeout(res, 400));

  // Repetir el trabajo del gancho onRestored.
  r.setSource(src, 64, 64);
  r.render(defaultParams(), { seed: 1 });
  const despues = [...r.ctx.readPixels(null, 32, canvas.height - 2, 1, 1)].slice(0, 3);
  // Se lee ANTES de dispose(): dispose libera el contexto a propósito.
  const sigueRoto = r.ctx.lost;
  r.dispose();
  return { antes, despues, perdido, restored, sigueRoto };
});

let bad = 0;
const ck = (n, ok, d='') => { console.log((ok?'  ✓ ':'  ✗ ')+n+(d?'  '+d:'')); if(!ok) bad++; };
ck('render correcto antes de perder el contexto', r.antes[0] > 180 && r.antes[2] < 80, 'rgb(' + r.antes + ')');
ck('el contexto se pierde de verdad', r.perdido);
ck('se dispara el aviso de restauración', r.restored);
ck('el contexto vuelve', !r.sigueRoto);
ck('vuelve a renderizar bien tras recuperarse', r.despues[0] > 180 && r.despues[2] < 80, 'rgb(' + r.despues + ')');
console.log(bad ? '\n'+bad+' fallo(s)' : '\ntodo correcto');
await browser.close(); server.kill();
process.exit(bad?1:0);
