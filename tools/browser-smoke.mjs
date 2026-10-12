// Optional browser verification. npm test/build/serve do not need Playwright.
// Set PLAYWRIGHT_MODULE to an installed Playwright module's index.js if needed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const base = process.env.VIEWER_URL ?? 'http://127.0.0.1:8080/';
const output = path.join(root, 'test-artifacts');
await mkdir(output, { recursive: true });
const results = [], errors = [];
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error(m.text()); } });
const state = () => page.evaluate(() => window.starViewer.state);
async function ready(id) {
  await page.waitForFunction(id => window.starViewer?.state.model === id && !window.starViewer.state.loading, id, { timeout: 120000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await state()).shaderFailed, false);
}
async function input(id, value) {
  await page.locator('#' + id).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}
try {
  const ids = ['Fix','SmallStellatedDodecahedron','GreatDodecahedron','GreatStellatedDodecahedron','GreatIcosahedron','Sishi','Gohi','Gishi','Gahi','Gashi','Gaghi','Gofix','Gogishi','Gax'];
  await page.goto(base + '?model=Fix&resolution=0.5&inertia=0');
  for (const id of ids) {
    if (id !== 'Fix') await page.selectOption('#model', id);
    await ready(id);
    for (const fov of [0, 60, -60]) {
      await input('fov', fov);
      assert.equal((await state()).fov, fov);
      assert((await state()).triangles > 0);
      await page.screenshot({ path: path.join(output, `${id}-${fov}.png`) });
    }
    const s = await state();
    assert(s.gpuGeometries <= 2 && s.gpuTextures <= 8, 'Disposed model resources must not accumulate');
    results.push({ id, ...s });
    console.log(`${id}: full shader, signed FoV and resource disposal OK`);
  }
  for (const id of ['Fix','GreatDodecahedron']) {
    await page.selectOption('#model', id); await ready(id);
    if (await page.locator('.app.closed').count()) await page.click('#togglePanel');
    for (const mode of ['single','radial','vertex','explosion','full']) {
      await page.click(`[data-mode="${mode}"]`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal((await state()).mode, mode);
      assert.equal((await state()).shaderFailed, false);
      if (mode === 'explosion') {
        await input('explosion', 1); assert((await state()).explosion > 0);
        await page.screenshot({ path: path.join(output, `${id}-explosion.png`) });
      }
    }
    for (const stereo of ['parallel','cross','off']) { await page.selectOption('#stereo', stereo); await page.screenshot({ path: path.join(output, `${id}-${stereo}.png`) }); }
  }
  await page.click('#togglePanel');
  const before = (await state()).pose;
  await page.mouse.move(180, 190); await page.mouse.down();
  await page.mouse.move(230, 235, { steps: 8 }); await page.mouse.up();
  const after = (await state()).pose;
  assert(after.some((v, i) => Math.abs(v - before[i]) > .01));
  assert.deepEqual(after.slice(8, 12), [0,0,1,0], '3D controls must preserve the unused Z axis');
  await page.click('#togglePanel'); await input('fov', 42);
  await page.click('#share');
  const url = page.url(), shared = await state();
  await page.goto(url); await ready('GreatDodecahedron');
  const restored = await state(); assert.equal(restored.fov, 42);
  assert(restored.pose.every((v, i) => Math.abs(v - shared.pose[i]) < .000001));
  console.log('Modes, stereo, 3D drag/Z lock and view URL round trip OK');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(base + '?model=Fix&resolution=0.5'); await ready('Fix');
  assert(await page.locator('.app.closed').count());
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  await page.click('#togglePanel'); assert.equal(await page.locator('.app.closed').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(path.join(output, 'browser-smoke.json'), JSON.stringify({ base, passed: true, models: results, errors }, null, 2));
  console.log('Mobile layout and panel controls OK; all browser checks passed.');
} finally { await browser.close(); }
