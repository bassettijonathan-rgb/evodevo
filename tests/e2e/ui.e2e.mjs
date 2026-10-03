/**
 * End-to-end smoke test of the UI in headless Chromium (npm run e2e, after npm run build).
 * Drives the main flows and fails on any page error or missing UI element.
 * Uses the system Chromium if PLAYWRIGHT_CHROMIUM is set (e.g. /opt/pw-browsers/chromium).
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4174, strictPort: true } });
const base = 'http://localhost:4174/';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const externalFont = (url = '') => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url); // optional; blocked in some sandboxes
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !externalFont(m.location().url)) errors.push(`${m.text()} @ ${m.location().url}`); });
const idle = () => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 300_000 });
const step = async (name, fn) => { process.stdout.write(`• ${name} … `); await fn(); console.log('ok'); };

try {
  await page.goto(base);
  await step('breed: first brood grows', async () => {
    await page.click('button:text-is("Start")');
    await page.waitForSelector('.grid .card canvas', { timeout: 120_000 });
    await idle();
    if ((await page.locator('.grid .card').count()) !== 12) throw new Error('expected 12 organisms');
  });
  await step('breed: select a parent and breed', async () => {
    await page.locator('.grid .card').nth(0).click();
    await page.click('button.primary:has-text("Breed")');
    await page.waitForTimeout(200);
    await idle();
    await page.waitForSelector('text=Generation 1');
  });
  await step('lab: inspect an individual', async () => {
    await page.locator('.grid .card').nth(0).click();
    await page.click('button:text-is("Inspect in lab")');
    await page.waitForSelector('.lab canvas');
    await idle();
  });
  await step('lab: preset, overlays, knockout and regrow', async () => {
    await page.selectOption('.lab .controls select', 'flag-embryo');
    await page.waitForTimeout(200);
    await idle();
    await page.selectOption('label:has-text("Field") select', '0');
    await page.check('label:has-text("polarity") input');
    await page.locator('.grn .node').first().click();
    await page.click('button:text-is("Knock out")');
    await page.click('button:text-is("Regrow perturbed")');
    await page.waitForTimeout(200);
    await idle();
    await page.waitForSelector('text=Compared with the wild type');
  });
  await step('lab: pressure overlay and gene lock', async () => {
    await page.selectOption('label:has-text("Colour cells by") select', 'pressure');
    await page.check('label:has-text("locked during breeding") input');
    await page.click('nav button:text-is("Breed")');
    await page.waitForSelector('text=1 gene locked');
  });
  await step('phylogeny: tree and node detail', async () => {
    await page.click('nav button:text-is("Phylogeny")');
    await page.waitForSelector('.phylo svg .pnode');
    await page.locator('.phylo .pnode').last().click();
    await page.waitForSelector('text=Breed from here');
  });
  await step('fallback: breeding still works when Web Workers are unavailable', async () => {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.addInitScript(() => { delete window.Worker; });
    await p2.goto(base);
    await p2.click('button:text-is("Start")');
    await p2.waitForSelector('.grid .card canvas', { timeout: 300_000 });
    await p2.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 300_000 });
    if ((await p2.locator('.grid .card').count()) !== 12) throw new Error('expected 12 organisms');
    await p2.close();
  });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('E2E passed');
} catch (e) {
  await page.screenshot({ path: 'e2e-failure.png', fullPage: true });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.httpServer.close();
}
