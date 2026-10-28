// test/playwright/tests/tools/file-docx-security.spec.ts

import JSZip from 'jszip';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const FILE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="file"]`;
const MARK = 'SAFE-MARKER';
const ATTACKER = 'http://docx-attacker.invalid';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = [
  `xmlns:w="${W}"`,
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
].join(' ');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    __pwned?: unknown;
  }
}

interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

interface Attack {
  /** Inner XML of w:body; replaced by `documentXml` when given. */
  body?: string;
  documentXml?: string;
  rels?: Rel[];
  files?: Record<string, string | Buffer>;
}

const p = (text: string, pPr = '', rPr = ''): string =>
  `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const runOf = (inner: string): string => `<w:p><w:r>${inner}</w:r></w:p>`;
const blip = (attrs: string): string =>
  '<w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="pic" descr="attack picture"/>'
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
  + `<pic:pic><pic:blipFill><a:blip ${attrs}/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

const relsXml = (rels: Rel[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map((rel) => `<Relationship Id="${rel.id}" Type="${REL}/${rel.type}" Target="${rel.target}"${rel.external === true ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

async function buildDocx(attack: Attack): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('_rels/.rels', relsXml([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }]));
  zip.file('word/_rels/document.xml.rels', relsXml(attack.rels ?? []));
  zip.file('word/document.xml', attack.documentXml ?? `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${attack.body ?? ''}</w:body></w:document>`);
  for (const [path, content] of Object.entries(attack.files ?? {})) {
    zip.file(path, content);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

const createBlokWithFile = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder }) => {
    // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
    const { File: FileTool } = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
    const blok = new window.Blok({ holder, tools: { file: { class: FileTool } } });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/** Uploads the attack .docx into a new File block and opens its preview dialog. */
async function openAttack(page: Page, attack: Attack, name = 'attack.docx'): Promise<Locator> {
  await createBlokWithFile(page);
  await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`).click();
  await page.keyboard.type('/file', { delay: 50 });
  await page.locator('[data-blok-item-name="file"]').click();
  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();
  await fileBlock.getByTestId('file-input').setInputFiles({
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await buildDocx(attack),
  });
  await page.getByRole('button', { name: new RegExp(name.replace('.', '\\.'), 'i') }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  return dialog;
}

/** Opens the attack and waits for the rendered marker paragraph (the positive control). */
async function openRendered(page: Page, attack: Attack): Promise<Locator> {
  const dialog = await openAttack(page, attack);
  const preview = dialog.locator('[data-role="file-preview-docx"]');
  await expect(preview).toContainText(MARK);

  return preview;
}

/** Counts every request to the attacker host. */
async function watchAttacker(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(`${ATTACKER}/**`, async (route) => {
    hits.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });
  page.on('request', (request) => {
    if (request.url().startsWith(ATTACKER) && !hits.includes(request.url())) {
      hits.push(request.url());
    }
  });

  return hits;
}

test('an altChunk or foreign-namespace script in a docx never runs', async ({ page }) => {
  const title = await page.title();
  const preview = await openRendered(page, {
    body: p(MARK) + '<w:altChunk r:id="rIdChunk"/>'
      + '<w:p><w:r><h:script xmlns:h="http://www.w3.org/1999/xhtml">window.__pwned=1</h:script><h:img xmlns:h="http://www.w3.org/1999/xhtml" src="x" onerror="window.__pwned=2"/><w:t>t</w:t></w:r></w:p>',
    rels: [{ id: 'rIdChunk', type: 'aFChunk', target: 'afchunk.htm' }],
    files: { 'word/afchunk.htm': '<html><head><title>pwned</title></head><body><script>window.__pwned=3;document.title="pwned"</script><img src=x onerror="window.__pwned=4"></body></html>' },
  });

  expect(await preview.evaluate((root) => root.querySelectorAll('iframe, script, object, embed').length)).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.title()).toBe(title);
});

test('clicking a javascript: or data: hyperlink runs nothing and does not navigate', async ({ page }) => {
  const before = page.url();
  const preview = await openRendered(page, {
    body: p(MARK)
      + '<w:p><w:hyperlink r:id="rJs"><w:r><w:t>js-link</w:t></w:r></w:hyperlink></w:p>'
      + '<w:p><w:hyperlink r:id="rData"><w:r><w:t>data-link</w:t></w:r></w:hyperlink></w:p>'
      + '<w:p><w:hyperlink r:id="rHttp"><w:r><w:t>http-link</w:t></w:r></w:hyperlink></w:p>',
    rels: [
      { id: 'rJs', type: 'hyperlink', target: 'java&#x09;script:window.__pwned=1', external: true },
      { id: 'rData', type: 'hyperlink', target: 'data:text/html,&lt;script&gt;opener.__pwned=1&lt;/script&gt;', external: true },
      { id: 'rHttp', type: 'hyperlink', target: `${ATTACKER}/phish`, external: true },
    ],
  });

  await preview.getByText('js-link').click();
  await preview.getByText('data-link').click();

  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(page.url()).toBe(before);
  await expect(preview.getByText('js-link').locator('xpath=ancestor::a[1]')).not.toHaveAttribute('href', /./);
  const http = preview.getByText('http-link').locator('xpath=ancestor::a[1]');
  await expect(http).toHaveAttribute('target', '_blank');
  await expect(http).toHaveAttribute('rel', 'noopener noreferrer');
});

test('an internal anchor link does not change location.hash', async ({ page }) => {
  const preview = await openRendered(page, {
    body: p(MARK) + '<w:p><w:hyperlink w:anchor="body"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>'
      + '<w:p><w:bookmarkStart w:id="0" w:name="body"/><w:r><w:t>target</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>',
  });
  const hash = await page.evaluate(() => window.location.hash);

  await preview.getByText('jump').click();

  expect(await page.evaluate(() => window.location.hash)).toBe(hash);
  expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).body)).toBe('undefined');
});

test('CSS payloads in fonts, colours, VML and lengths stay inside the preview', async ({ page }) => {
  const hostBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const breakout = '&quot;; } body { background: red !important } x { font-family: &quot;';
  const dialog = await openAttack(page, {
    body: p(MARK, '<w:ind w:left="-2000000" w:hanging="-2000000"/><w:spacing w:before="-2000000"/>', `<w:rFonts w:ascii="${breakout}"/><w:color w:val="red;position:fixed;inset:0"/><w:sz w:val="4000"/>`)
      + p('jc', '<w:jc w:val="constructor"/>', '<w:highlight w:val="constructor"/><w:u w:val="toString"/>')
      + runOf('<w:pict><v:shape style="position:fixed;left:0;top:0;width:3000px;height:3000px;z-index:2147483647"><v:imagedata r:id="rImg"/></v:shape></w:pict>')
      + '<w:tbl><w:tblPr><w:tblInd w:w="-2000000" w:type="dxa"/><w:tblBorders><w:top w:val="constructor"/></w:tblBorders></w:tblPr><w:tr><w:tc>'
      + `${p('cell')}</w:tc></w:tr></w:tbl>`,
    rels: [{ id: 'rImg', type: 'image', target: 'media/image1.png' }],
    files: { 'word/media/image1.png': PNG_1X1 },
  });
  const preview = dialog.locator('[data-role="file-preview-docx"]');
  await expect(preview).toContainText('cell');

  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(hostBg);
  const previewSheets = await preview.evaluate((root) => Array.from(document.styleSheets)
    .filter((sheet) => sheet.ownerNode !== null && root.contains(sheet.ownerNode)).length);
  expect(previewSheets).toBe(0);
  const close = dialog.getByRole('button', { name: /close/i });
  const box = await close.boundingBox();
  expect(box).not.toBeNull();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('data-action') ?? null, {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  });
  expect(hit).toBe('close-preview');
  const styles = await preview.evaluate((root) => Array.from(root.querySelectorAll('[style]')).map((el) => el.getAttribute('style') ?? ''));
  expect(styles.filter((s) => /position|native code|\[object|url\(|[{}]/.test(s))).toEqual([]);
});

test('a docx loads nothing from the network', async ({ page }) => {
  const hits = await watchAttacker(page);
  const documentXml = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<?xml-stylesheet type="text/css" href="${ATTACKER}/pi.css"?>`
    + `<w:document ${NS}><w:body>${p(MARK)}`
    + runOf(blip('r:embed="rImg"')) + runOf(blip('r:embed="rExt"')) + runOf(blip('r:link="rExt"'))
    + runOf(`<w:pict><v:shape style="width:10px;height:10px"><v:imagedata r:id="rExt" o:href="${ATTACKER}/vml.png"/></v:shape></w:pict>`)
    + `<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="${ATTACKER}/xinclude.xml"/>`
    + '</w:body></w:document>';
  const preview = await openRendered(page, {
    documentXml,
    rels: [{ id: 'rExt', type: 'image', target: `${ATTACKER}/pixel.png`, external: true }, { id: 'rImg', type: 'image', target: 'media/image1.png' }],
    files: { 'word/media/image1.png': PNG_1X1 },
  });
  // The embedded picture loading means the image phase is over.
  const img = preview.getByRole('img', { name: 'attack picture' });
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);

  expect(hits).toEqual([]);
});

test('an external entity docx shows the error state and fetches nothing', async ({ page }) => {
  const hits = await watchAttacker(page);
  const dialog = await openAttack(page, {
    documentXml: `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x SYSTEM "${ATTACKER}/xxe">]><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&x;${MARK}</w:t></w:r></w:p></w:body></w:document>`,
  });

  await expect(dialog.locator('[data-role="file-preview-error"]')).toBeVisible();
  expect(hits).toEqual([]);
});

test('a billion-laughs docx fails fast and leaves the page responsive', async ({ page }) => {
  const entities = ['<!ENTITY l0 "lollollollol">', ...Array.from({ length: 9 }, (_, i) => `<!ENTITY l${i + 1} "${`&l${i};`.repeat(10)}">`)].join('');
  const dialog = await openAttack(page, {
    documentXml: `<?xml version="1.0"?><!DOCTYPE w:document [${entities}]><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&l9;</w:t></w:r></w:p></w:body></w:document>`,
  });

  await expect(dialog.locator('[data-role="file-preview-error"]')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});

test('deeply nested wrappers do not hang the page', async ({ page }) => {
  const n = 8000;
  const dialog = await openAttack(page, { body: p(MARK) + '<w:ins>'.repeat(n) + p('deep') + '</w:ins>'.repeat(n) });
  await expect(dialog.locator('[data-role="file-preview-error"]')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});

test('a 10k-paragraph docx renders in a few seconds', async ({ page }) => {
  const paragraphs = Array.from({ length: 10_000 }, (_, i) => p(`para ${i}`)).join('');
  const started = Date.now();
  const preview = await openRendered(page, { body: p(MARK) + paragraphs + p('LAST-PARAGRAPH') });

  await expect(preview).toContainText('LAST-PARAGRAPH');
  expect(Date.now() - started).toBeLessThan(20_000);
});

test('closing the preview revokes the image blob URLs', async ({ page }) => {
  const preview = await openRendered(page, {
    body: p(MARK) + runOf(blip('r:embed="rImg"')),
    rels: [{ id: 'rImg', type: 'image', target: 'media/image1.png' }],
    files: { 'word/media/image1.png': PNG_1X1 },
  });
  const img = preview.getByRole('img', { name: 'attack picture' });
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^blob:/);

  const fetchable = (url: string | null): Promise<boolean> =>
    page.evaluate(async (u) => fetch(u ?? '').then(() => true, () => false), url);
  expect(await fetchable(src)).toBe(true);

  await page.getByRole('dialog').getByRole('button', { name: /close/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect.poll(() => fetchable(src)).toBe(false);
});
