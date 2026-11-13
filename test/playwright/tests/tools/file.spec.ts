// test/playwright/tests/tools/file.spec.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { createZip } from '../../../../scripts/lib/zip-writer.mjs';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { readZip } from '../../../../src/tools/file/zip/read-zip';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

// Playwright runs from the repo root, so resolve fixtures relative to cwd.
const OFFICE_FIXTURES = join(process.cwd(), 'test/playwright/fixtures/office');

const HOLDER_ID = 'blok';
const FILE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="file"]`;
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Reset DOM and destroy any running Blok instance.
 */
const resetBlok = async (page: Page): Promise<void> => {
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
};

/**
 * Create a Blok instance with the FileTool registered.
 * FileTool is not in the test.html defaults, so we dynamically import it
 * from the already-built /dist/tools.mjs and inject it via the tools config.
 */
const createBlokWithFile = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
      const { File: FileTool, Image: ImageTool } = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
      const blok = new window.Blok({
        holder,
        tools: {
          file: { class: FileTool },
          image: { class: ImageTool },
        },
        ...(initialData ? { data: initialData } : {}),
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

// ---------------------------------------------------------------------------
// 1. Upload via file input renders a download card
// ---------------------------------------------------------------------------
test('upload renders a download card with correct filename and download attribute', async ({ page }) => {
  await createBlokWithFile(page);

  // Insert a File block via the slash menu
  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );
  await defaultParagraph.click();
  await page.keyboard.type('/file', { delay: 50 });

  const fileMenuItem = page.locator('[data-blok-item-name="file"]');
  await expect(fileMenuItem).toBeVisible();
  await fileMenuItem.click();

  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();

  // The file input is hidden — setInputFiles works on hidden inputs
  const fileInput = fileBlock.getByTestId('file-input');
  await fileInput.setInputFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });

  // After upload (URL.createObjectURL fallback), card should appear
  const fileCard = page.locator('[data-role="file-card"]');
  await expect(fileCard).toBeVisible();

  // Filename shown in the card
  await expect(page.locator('[data-role="file-name"]')).toHaveText('report.pdf');

  // The separate download affordance carries the filename
  const downloadLink = fileBlock.getByLabel('Download');
  await expect(downloadLink).toBeVisible();
  await expect(downloadLink).toHaveAttribute('download', 'report.pdf');
});

// ---------------------------------------------------------------------------
// 2. Routing guard: PDF drop → File block; PNG drop → Image block
// ---------------------------------------------------------------------------
test('dropping a PDF file creates a File block, dropping a PNG creates an Image block', async ({ page }) => {
  // Use two separate Blok instances to keep the routing tests independent.

  // --- PDF drop → File block ---
  await createBlokWithFile(page);

  const pdfDropTarget = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`
  ).first();

  await pdfDropTarget.evaluate((element: HTMLElement) => {
    const file = new File([ new Uint8Array([ 0x25, 0x50, 0x44, 0x46 ]) ], 'document.pdf', { type: 'application/pdf' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const makeEvent = (type: string): DragEvent => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
      return ev;
    };

    element.dispatchEvent(makeEvent('dragenter'));
    element.dispatchEvent(makeEvent('dragover'));
    element.dispatchEvent(makeEvent('drop'));
  });

  const fileCard = page.locator('[data-role="file-card"]');
  await expect(fileCard).toBeVisible();

  // --- PNG drop → Image block ---
  await createBlokWithFile(page);

  const PNG_1x1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  const pngDropTarget = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`
  ).first();

  await pngDropTarget.evaluate((element: HTMLElement, base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const file = new File([ bytes ], 'photo.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const makeEvent = (type: string): DragEvent => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
      return ev;
    };

    element.dispatchEvent(makeEvent('dragenter'));
    element.dispatchEvent(makeEvent('dragover'));
    element.dispatchEvent(makeEvent('drop'));
  }, PNG_1x1_BASE64);

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  await expect(imageBlock).toBeVisible();
  await expect(imageBlock).toHaveAttribute('data-state', 'rendered');
});

// ---------------------------------------------------------------------------
// 3. Read-only: caption becomes non-editable
// ---------------------------------------------------------------------------
test('read-only mode sets file caption to contenteditable="false"', async ({ page }) => {
  await createBlokWithFile(page, {
    blocks: [
      {
        type: 'file',
        data: {
          url: 'https://example.com/report.pdf',
          fileName: 'report.pdf',
          caption: 'Annual report',
          captionVisible: true,
        },
      },
    ],
  });

  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();

  // Caption is editable before read-only
  const caption = fileBlock.locator('[data-role="file-caption"]');
  await expect(caption).toHaveAttribute('contenteditable', 'true');

  // Enable read-only
  await page.evaluate(async () => {
    const blok = window.blokInstance;
    if (!blok) throw new Error('Blok instance not found');
    await blok.readOnly.toggle(true);
  });
  await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

  // Caption must now be non-editable
  await expect(caption).toHaveAttribute('contenteditable', 'false');
});

// ---------------------------------------------------------------------------
// 4. Markdown preview: preview view by default, Source toggle shows source
// ---------------------------------------------------------------------------
test('Markdown file preview toggles between rendered and raw views', async ({ page }) => {
  await createBlokWithFile(page);

  const dropTarget = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`
  ).first();

  await dropTarget.evaluate((element: HTMLElement) => {
    const file = new File([ '# Hello\n\nSome **bold** text.' ], 'readme.md', { type: 'text/markdown' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const makeEvent = (type: string): DragEvent => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
      return ev;
    };

    element.dispatchEvent(makeEvent('dragenter'));
    element.dispatchEvent(makeEvent('dragover'));
    element.dispatchEvent(makeEvent('drop'));
  });

  // The previewable file card renders as a button showing the filename.
  const fileCard = page.getByRole('button', { name: /readme\.md/i });
  await expect(fileCard).toBeVisible();
  await fileCard.click();

  // The preview opens in a top-layer modal dialog.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Preview is shown by default with the formatted heading.
  const renderView = dialog.locator('[data-role="file-preview-md-render"]');
  await expect(renderView.getByRole('heading', { name: 'Hello' })).toBeVisible();

  // Switching to Source reveals the Markdown source.
  await dialog.getByRole('button', { name: 'Source' }).click();
  const rawView = dialog.locator('[data-role="file-preview-md-raw"]');
  await expect(rawView).toContainText('# Hello');
});

test('code file preview wraps long lines and keeps each line number beside its line', async ({ page }) => {
  const source = ['const a = 1;', `const long = '${'x'.repeat(600)}';`, 'const b = 2;'].join('\n');

  await uploadFixture(page, { name: 'main.ts', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: /main\.ts/i }).click();

  const dialog = page.getByRole('dialog');
  const pre = dialog.locator('[data-role="file-preview-code"]');
  // Highlighting swaps the plain text for token spans; measure after it lands.
  await expect.poll(() => pre.evaluate((el) => el.querySelector('code')?.childElementCount ?? 0)).toBeGreaterThan(0);
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

  const layout = await pre.evaluate((el) => {
    const code = el.querySelector('code');
    const numbers = Array.from(el.querySelectorAll('[data-role="file-preview-gutter"] > *'));
    const text = code?.textContent ?? '';
    // Top of the glyph box at a text offset; same half-leading on every line.
    const topAt = (target: number): number => {
      const range = document.createRange();
      const walker = document.createTreeWalker(code ?? el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (seen + length > target) {
          range.setStart(node, target - seen);
          range.setEnd(node, target - seen + 1);

          return range.getBoundingClientRect().top;
        }
        seen += length;
      }

      return NaN;
    };

    return {
      overflow: el.scrollWidth - el.clientWidth,
      firstOffset: numbers[0].getBoundingClientRect().top - topAt(0),
      lastOffset: numbers[2].getBoundingClientRect().top - topAt(text.lastIndexOf('const b')),
      longNumberHeight: numbers[1].getBoundingClientRect().height,
      firstNumberHeight: numbers[0].getBoundingClientRect().height,
    };
  });

  expect(layout.overflow).toBe(0);
  expect(layout.longNumberHeight).toBeGreaterThan(layout.firstNumberHeight * 2);
  expect(Math.abs(layout.lastOffset - layout.firstOffset)).toBeLessThan(1);
});

// ---------------------------------------------------------------------------
// 5. Office previews: docx / xlsx / pptx render inline in the modal
// ---------------------------------------------------------------------------

/** Inserts an empty File block and uploads the given fixture file by path. */
const uploadFixture = async (
  page: Page,
  fixture: string | { name: string; mimeType: string; buffer: Buffer }
): Promise<void> => {
  await createBlokWithFile(page);

  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );
  await defaultParagraph.click();
  await page.keyboard.type('/file', { delay: 50 });

  const fileMenuItem = page.locator('[data-blok-item-name="file"]');
  await expect(fileMenuItem).toBeVisible();
  await fileMenuItem.click();

  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();

  await fileBlock.getByTestId('file-input').setInputFiles(
    typeof fixture === 'string' ? join(OFFICE_FIXTURES, fixture) : fixture
  );
};

test('docx file renders an inline preview', async ({ page }) => {
  await uploadFixture(page, 'sample.docx');

  await page.getByRole('button', { name: /sample\.docx/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const preview = dialog.locator('[data-role="file-preview-docx"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Blok docx preview fixture');
});

test('xlsx file renders an inline table preview', async ({ page }) => {
  await uploadFixture(page, 'sample.xlsx');

  await page.getByRole('button', { name: /sample\.xlsx/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const preview = dialog.locator('[data-role="file-preview-xlsx"]');
  await expect(preview).toBeVisible();
  // The first sheet's A1/B1 cells render as table cells (role "cell").
  await expect(preview.getByRole('cell', { name: 'Hello' })).toBeVisible();
  await expect(preview.getByRole('cell', { name: 'World' })).toBeVisible();
});

test('pptx file renders an inline slide preview', async ({ page }) => {
  await uploadFixture(page, 'sample.pptx');

  await page.getByRole('button', { name: /sample\.pptx/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The pptx container mounts (proves fetch + renderer dispatch, not the error
  // fallback). The pptx viewer paints slides asynchronously into this container.
  const preview = dialog.locator('[data-role="file-preview-pptx"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Blok pptx preview fixture');
});

const EXTERNAL_MEDIA_HOST = 'http://pptx-external-media.test';

/** Every part of sample.pptx, in archive order. */
const sampleDeckParts = async (): Promise<Map<string, string | Uint8Array>> => {
  const archive = readZip(readFileSync(join(OFFICE_FIXTURES, 'sample.pptx')));

  const parts = archive.entries.filter((entry) => !entry.dir);

  return new Map(await Promise.all(parts.map(async (entry) => [entry.name, await archive.read(entry)] as const)));
};

const partText = (parts: Map<string, string | Uint8Array>, name: string): string => {
  const part = parts.get(name);

  return typeof part === 'string' ? part : new TextDecoder().decode(part);
};

const zipParts = (parts: Map<string, string | Uint8Array>): Promise<Buffer> =>
  Promise.resolve(createZip([...parts].map(([name, data]) => ({ name, data }))));

/** sample.pptx plus a picture whose image lives on another host. */
const deckWithExternalPicture = async (): Promise<Buffer> => {
  const zip = await sampleDeckParts();
  const slidePath = 'ppt/slides/slide1.xml';
  const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
  const slide = partText(zip, slidePath);
  const rels = partText(zip, relsPath);
  const picture = '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Remote"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
    + '<p:blipFill><a:blip r:link="rIdRemote"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  const relationship = '<Relationship Id="rIdRemote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
    + ` Target="${EXTERNAL_MEDIA_HOST}/pixel.png" TargetMode="External"/>`;

  zip.set(slidePath, slide.replace('</p:spTree>', `${picture}</p:spTree>`));
  zip.set(relsPath, rels.replace('</Relationships>', `${relationship}</Relationships>`));

  return zipParts(zip);
};

test('pptx preview never fetches a picture the deck links from another host', async ({ page }) => {
  const remoteRequests: string[] = [];

  await page.route(`${EXTERNAL_MEDIA_HOST}/**`, async (route) => {
    remoteRequests.push(route.request().url());
    await route.fulfill({ status: 404, body: '' });
  });

  await uploadFixture(page, {
    name: 'remote.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await deckWithExternalPicture(),
  });
  await page.getByRole('button', { name: /remote\.pptx/i }).click();

  const preview = page.getByRole('dialog').locator('[data-role="file-preview-pptx"]');

  await expect(preview).toContainText('Blok pptx preview fixture');
  const remoteRefs = await preview.evaluate((root, host) => Array.from(root.querySelectorAll('*'))
    .flatMap((el) => ['src', 'srcset', 'href', 'xlink:href', 'style'].map((name) => el.getAttribute(name) ?? ''))
    .filter((value) => value.includes(host)), EXTERNAL_MEDIA_HOST);

  expect(remoteRefs).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

const LONG_DECK_SLIDES = 14;

/** sample.pptx copied into a deck longer than one drawing batch, each slide with its own text. */
const longDeck = async (): Promise<Buffer> => {
  const zip = await sampleDeckParts();
  const slide = partText(zip, 'ppt/slides/slide1.xml');
  const slideRels = partText(zip, 'ppt/slides/_rels/slide1.xml.rels');
  const presentation = partText(zip, 'ppt/presentation.xml');
  const presentationRels = partText(zip, 'ppt/_rels/presentation.xml.rels');
  const contentTypes = partText(zip, '[Content_Types].xml');
  const numbers = Array.from({ length: LONG_DECK_SLIDES }, (_, i) => i + 1);
  const slideType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

  numbers.forEach((n) => {
    zip.set(`ppt/slides/slide${n}.xml`, slide.replace('Blok pptx preview fixture', `Long deck slide ${n}`));
    zip.set(`ppt/slides/_rels/slide${n}.xml.rels`, slideRels);
  });
  zip.set('ppt/presentation.xml', presentation.replace(
    /<p:sldIdLst>.*<\/p:sldIdLst>/,
    `<p:sldIdLst>${numbers.map((n) => `<p:sldId id="${255 + n}" r:id="rIdLong${n}"/>`).join('')}</p:sldIdLst>`
  ));
  zip.set('ppt/_rels/presentation.xml.rels', presentationRels
    .replace(/<Relationship Id="rId2"[^>]*\/>/, '')
    .replace('</Relationships>', `${numbers.map((n) => `<Relationship Id="rIdLong${n}" Type="${slideType}" Target="slides/slide${n}.xml"/>`).join('')}</Relationships>`));
  zip.set('[Content_Types].xml', contentTypes
    .replace(/<Override PartName="\/ppt\/slides\/slide1\.xml"[^>]*\/>/, '')
    .replace('</Types>', `${numbers.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`));

  return zipParts(zip);
};

test('pptx preview shows the last slide of a deck longer than one batch', async ({ page }) => {
  await uploadFixture(page, {
    name: 'long.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await longDeck(),
  });
  await page.getByRole('button', { name: /long\.pptx/i }).click();

  const preview = page.getByRole('dialog').locator('[data-role="file-preview-pptx"]');

  const stage = preview.locator('[data-role="file-preview-stage"]');
  const film = preview.locator('[data-role="file-preview-film"]');

  await expect(stage).toContainText('Long deck slide 1');
  // Slides after the first batch are drawn on later frames; each lands in the filmstrip.
  await expect(film.getByText(/^Long deck slide \d+$/)).toHaveCount(LONG_DECK_SLIDES);

  const lastThumb = preview.getByRole('button', { name: `Slide ${LONG_DECK_SLIDES}`, exact: true });

  await lastThumb.click();
  await expect(lastThumb).toBeInViewport();
  await expect(lastThumb).toHaveAttribute('aria-current', 'true');
  await expect(stage.getByText(`Long deck slide ${LONG_DECK_SLIDES}`, { exact: true })).toBeInViewport();
});

test('pptx preview turns slides with the arrow keys and a click on either half', async ({ page }) => {
  await uploadFixture(page, {
    name: 'long.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await longDeck(),
  });
  await page.getByRole('button', { name: /long\.pptx/i }).click();

  const dialog = page.getByRole('dialog');
  const stage = dialog.locator('[data-role="file-preview-stage"]');
  const slideBox = dialog.locator('[data-role="file-preview-stage-frame"]');
  const sheets = stage.locator('[data-role="file-preview-stage-sheet"]');
  // Two sheets overlap while one slides out; the newest is the last.
  const shown = sheets.last();

  await expect(shown).toHaveText('Long deck slide 1');
  await expect(dialog.locator('[data-role="file-preview-meta"]')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(shown).toHaveText('Long deck slide 2');
  // The sheet that slid out is taken away.
  await expect(sheets).toHaveCount(1);

  await page.keyboard.press('ArrowLeft');
  await expect(shown).toHaveText('Long deck slide 1');

  const box = await slideBox.boundingBox();

  if (box === null) {
    throw new Error('the slide frame has no box');
  }
  await slideBox.click({ position: { x: box.width * 0.9, y: box.height * 0.9 } });
  await expect(shown).toHaveText('Long deck slide 2');
  await slideBox.click({ position: { x: box.width * 0.1, y: box.height * 0.9 } });
  await expect(shown).toHaveText('Long deck slide 1');

  // The slide fits the stage: nothing of it is cut off.
  const fit = await slideBox.evaluate((el) => {
    const inner = el.getBoundingClientRect();
    const outer = el.parentElement?.getBoundingClientRect();

    return outer !== undefined && inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
  });

  expect(fit).toBe(true);
});

test('pptx preview draws text, tables and charts from a real deck', async ({ page }) => {
  await uploadFixture(page, 'dashboard.pptx');
  await page.getByRole('button', { name: /dashboard\.pptx/i }).click();

  const preview = page.getByRole('dialog').locator('[data-role="file-preview-pptx"]');

  // The filmstrip holds every real slide; the stage holds a copy of the current one.
  const film = preview.locator('[data-role="file-preview-film"]');

  await expect(film).toContainText('Dashboard: Monthly KPIs');
  await expect(film.getByText('Revenue', { exact: true }).first()).toBeVisible();
  await expect(film.locator('[data-pptx-chart="category-axis"]')).toContainText('Wed');
  // Five weekdays of visits, one bar each.
  await expect(film.locator('[data-pptx-chart="series"] rect')).toHaveCount(5);
});

/** sample.pptx plus one embedded picture. */
const deckWithPicture = async (): Promise<Buffer> => {
  const zip = await sampleDeckParts();
  const slidePath = 'ppt/slides/slide1.xml';
  const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
  const slide = partText(zip, slidePath);
  const rels = partText(zip, relsPath);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const picture = '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Pixel"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
    + '<p:blipFill><a:blip r:embed="rIdPixel"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';

  zip.set('ppt/media/pixel.png', pixel);
  zip.set(slidePath, slide.replace('</p:spTree>', `${picture}</p:spTree>`));
  zip.set(relsPath, rels.replace('</Relationships>', '<Relationship Id="rIdPixel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pixel.png"/></Relationships>'));

  return zipParts(zip);
};

test('closing a pptx preview frees the pictures it decoded', async ({ page }) => {
  await uploadFixture(page, {
    name: 'picture.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await deckWithPicture(),
  });
  await page.getByRole('button', { name: /picture\.pptx/i }).click();

  const dialog = page.getByRole('dialog');
  // The real slide's picture; the stage shows a copy of it with the same url.
  const picture = dialog.locator('[data-role="file-preview-film"] img');

  await expect(picture).toHaveCount(1);
  const pictureUrl = await picture.getAttribute('src') ?? '';

  expect(pictureUrl).toMatch(/^blob:/);
  await expect.poll(() => page.evaluate(async (url) => (await fetch(url)).ok, pictureUrl)).toBe(true);

  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(dialog).toBeHidden();
  // The dialog leaves the accessibility tree as its close starts; the pictures go once the fade has played.
  await expect(page.locator('[data-role="file-preview-pptx"]')).toHaveCount(0);

  const stillReadable = await page.evaluate(async (url) => fetch(url).then(() => true, () => false), pictureUrl);

  expect(stillReadable).toBe(false);
});


// ---------------------------------------------------------------------------
// 6. Preview controls: header facts, page and zoom, grid selection, code tools,
//    log filters, the Markdown outline
// ---------------------------------------------------------------------------

/** Uploads text as a file and opens its preview. */
const openTextPreview = async (page: Page, name: string, mimeType: string, text: string): Promise<Locator> => {
  await uploadFixture(page, { name, mimeType, buffer: Buffer.from(text) });
  await page.getByRole('button', { name: new RegExp(name.replace('.', '\\.'), 'i') }).click();
  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();

  return dialog;
};

test('preview header shows the badge and a download, with no type, count or size text', async ({ page }) => {
  await uploadFixture(page, 'sample.docx');
  await page.getByRole('button', { name: /sample\.docx/i }).click();

  const dialog = page.getByRole('dialog');

  await expect(dialog.locator('[data-role="file-preview-badge"]')).toHaveText('DOC');
  await expect(dialog.locator('[data-role="file-preview-meta"]')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'sample.docx');
});

test('docx preview shows the page in view and zooms the page', async ({ page }) => {
  await uploadFixture(page, 'sample.docx');
  await page.getByRole('button', { name: /sample\.docx/i }).click();

  const dialog = page.getByRole('dialog');
  const paper = dialog.locator('[data-role="file-preview-docx"]');
  /** Size of the first page on screen. */
  const pageBox = (): Promise<{ width: number; height: number }> => paper.evaluate((el) => {
    const box = el.querySelector('section')?.getBoundingClientRect();

    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  });

  await expect(dialog.locator('[data-role="file-preview-page"]')).toHaveText('Page 1 / 1');
  await expect(dialog.locator('[data-role="file-preview-zoom"]')).toHaveText('100%');
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

  const widthOf = async (): Promise<number> => (await pageBox()).width;
  const before = await widthOf();

  // The fixture page is at least as tall as its paper, not as short as its text.
  expect((await pageBox()).height / before).toBeGreaterThan(1.2);

  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog.locator('[data-role="file-preview-zoom"]')).toHaveText('125%');
  await expect.poll(widthOf).toBeCloseTo(before * 1.25, 0);

  await dialog.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(widthOf).toBeCloseTo(before, 0);
});

test('csv preview is a grid: dragging over numbers shows their sum, average and count', async ({ page }) => {
  const dialog = await openTextPreview(page, 'seats.csv', 'text/csv', 'Team,Seats\nDesign,4\nPlatform,12\nMobile,8\n');
  const status = dialog.locator('[data-role="file-preview-grid-status"]');

  await expect(dialog.locator('[data-role="file-preview-meta"]')).toHaveCount(0);
  await expect(dialog.locator('[data-col]')).toHaveText(['A', 'B']);
  await expect(status).toHaveText('A1');

  await dialog.locator('[data-ref="B2"]').hover();
  await page.mouse.down();
  await dialog.locator('[data-ref="B4"]').hover();
  await page.mouse.up();

  await expect(status).toContainText('B2:B4');
  await expect(status).toContainText('Sum 24');
  await expect(status).toContainText('Average 8');
  await expect(status).toContainText('Count 3');
  await expect(dialog.locator('[data-selected]')).toHaveCount(3);

  await dialog.getByRole('button', { name: 'Source' }).click();
  await expect(dialog.locator('[data-role="file-preview-csv-raw"]')).toContainText('Platform,12');
  await expect(dialog.locator('[data-role="file-preview-csv"]')).toBeHidden();
  // The status bar belongs to the table.
  await expect(dialog.locator('[data-role="file-preview-bar"]')).toBeHidden();
});

test('code preview: the hover band sits on the pointer line, Wrap lines off scrolls sideways, the minimap scrolls the code', async ({ page }) => {
  const source = [
    'function first() {',
    `  const long = '${'x'.repeat(600)}';`,
    ...Array.from({ length: 300 }, (_, i) => `  const value${i} = ${i};`),
    '}',
  ].join('\n');
  const dialog = await openTextPreview(page, 'long.ts', 'text/plain', source);
  const pre = dialog.locator('[data-role="file-preview-code"]');
  const gutter = dialog.locator('[data-role="file-preview-gutter"]');
  const lineThree = gutter.getByText('3', { exact: true });

  await expect.poll(() => pre.evaluate((el) => el.querySelector('code')?.childElementCount ?? 0)).toBeGreaterThan(0);
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await expect(dialog.locator('[data-role="file-preview-bar"]')).toContainText('303 lines');

  // Hover: the band covers the same rows as the number of the line under the pointer.
  const third = await lineThree.boundingBox();

  if (third === null) {
    throw new Error('line 3 has no box');
  }
  await page.mouse.move(third.x + 200, third.y + third.height / 2);
  await expect(lineThree).toHaveAttribute('data-hover', '');
  const band = await dialog.locator('[data-role="file-preview-line-hover"]').boundingBox();

  expect(Math.abs((band?.y ?? 0) - third.y)).toBeLessThan(1);
  expect(Math.abs((band?.height ?? 0) - third.height)).toBeLessThan(1);

  // An indented line has a guide strip as wide as its indent; an unindented one has none.
  const guideWidths = await dialog.locator('[data-role="file-preview-guides"]').evaluate(
    (el) => Array.from(el.children, (strip) => strip.getBoundingClientRect().width)
  );

  expect(guideWidths[0]).toBe(0);
  expect(guideWidths[2]).toBeGreaterThan(0);

  // Wrap lines off: the long line no longer wraps, so the code scrolls sideways.
  expect(await pre.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await dialog.getByRole('button', { name: 'Wrap lines' }).click();
  await expect.poll(() => pre.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(100);
  await dialog.getByRole('button', { name: 'Wrap lines' }).click();

  // Minimap: a press near its end scrolls the code down, and the window follows.
  const map = dialog.locator('[data-role="file-preview-minimap-bars"]');
  const mapBox = await map.boundingBox();

  if (mapBox === null) {
    throw new Error('the minimap has no box');
  }
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height * 0.9);
  await expect.poll(() => pre.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  const windowTop = await dialog.locator('[data-role="file-preview-minimap-window"]').evaluate((el) => parseFloat((el as HTMLElement).style.top));

  expect(windowTop).toBeGreaterThan(mapBox.height * 0.5);
});

test('log preview colours levels and filters to the errors', async ({ page }) => {
  const log = [
    '2026-11-13 09:14:02 INFO  server listening on :4444',
    '2026-11-13 09:14:31 WARN  slow write took=412ms',
    '2026-11-13 09:16:10 ERROR upload failed status=413',
  ].join('\n');
  const dialog = await openTextPreview(page, 'server.log', 'text/plain', log);
  const lines = dialog.locator('[data-line]');

  await expect(lines).toHaveCount(3);
  const colourOf = (index: number): Promise<string> =>
    lines.nth(index).locator('[data-part="level"]').evaluate((el) => getComputedStyle(el).color);

  expect(await colourOf(2)).not.toBe(await colourOf(0));
  expect(await colourOf(1)).not.toBe(await colourOf(0));

  await dialog.getByRole('button', { name: 'Errors 1' }).click();
  await expect(lines.nth(0)).toBeHidden();
  await expect(lines.nth(2)).toBeVisible();
  // The one line left keeps its number from the file.
  expect(await lines.nth(2).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"3"');

  await dialog.getByRole('button', { name: 'All 3' }).click();
  await expect(lines.nth(0)).toBeVisible();
});

test('Markdown preview outline opens on hover, follows the scroll and jumps to a heading', async ({ page }) => {
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`).join('\n\n');
  const dialog = await openTextPreview(page, 'guide.md', 'text/markdown', `# Guide\n\n${filler}\n\n## Install\n\n${filler}\n\n## License\n\n${filler}\n`);
  const rail = dialog.locator('[data-role="file-preview-outline"]');
  const view = dialog.locator('[data-role="file-preview-md-render"]');

  await expect(rail.getByRole('button')).toHaveCount(3);
  await expect(rail.locator('[aria-current="true"]')).toHaveText('Guide');
  // At rest the rail is dashes only.
  await expect(rail.getByText('Install')).toBeHidden();

  await rail.hover();
  await expect(rail.getByText('Install')).toBeVisible();
  await rail.getByRole('button', { name: 'Install' }).click();

  await expect(view.getByRole('heading', { name: 'Install' })).toBeInViewport();
  await expect(rail.locator('[aria-current="true"]')).toHaveText('Install');

  // The rail belongs to the rendered view only.
  await dialog.getByRole('button', { name: 'Source' }).click();
  await expect(rail).toBeHidden();
});
