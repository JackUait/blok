// Rasterizes the extension icon SVG to the PNG sizes MV3 wants. Playwright is
// already a repo devDependency; run `node scripts/override/generate-extension-icons.mjs`
// after changing the artwork.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '../../override-extension/icons');

// Two blocks: the page's bundled build (dim outline) with the local build
// (phosphor green) swapped in over it — the extension's whole story.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="0" y="0" width="128" height="128" rx="30" fill="#0d1014"/>
  <rect x="1.5" y="1.5" width="125" height="125" rx="28.5" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="3"/>
  <rect x="30" y="26" width="52" height="52" rx="12" fill="none" stroke="#5a6272" stroke-width="8"/>
  <rect x="50" y="50" width="52" height="52" rx="12" fill="#45e08c"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${ICON_SVG}`
  );
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(join(iconsDir, `icon${size}.png`), png);
  console.log(`icons/icon${size}.png`);
}

await browser.close();
