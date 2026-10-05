import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const FIXTURE_URL = 'http://localhost:4444/test/playwright/fixtures/image/shot.png';
const IMAGE = { url: FIXTURE_URL, naturalWidth: 800, naturalHeight: 600 };

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: initialData });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

// Room above the image: the toolbar must stay inside the picture even when they would fit above it.
const ROOM_ABOVE = [
  { type: 'paragraph', data: { text: 'One' } },
  { type: 'paragraph', data: { text: 'Two' } },
  { type: 'paragraph', data: { text: 'Three' } },
];

const imageBlock = (page: Page): Locator => page.locator('[data-blok-id="img"]');
const figure = (page: Page): Locator => imageBlock(page).locator('[data-role="image-figure"]');

// The alt tag and toolbar stay hidden while the image bytes load; hover only once it has painted.
const hoverLoadedFigure = async (page: Page): Promise<void> => {
  await expect(figure(page)).not.toHaveAttribute('data-loading');
  await figure(page).hover();
};

const box = async (locator: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  expect(b, `${label} bounding box missing`).not.toBeNull();

  return b as { x: number; y: number; width: number; height: number };
};

type Fill = { top: string; bottom: string };

// Draws an 800x600 PNG in the page: top half one colour, bottom half another.
const pngBytes = async (page: Page, fill: Fill): Promise<Buffer> => {
  const base64 = await page.evaluate(({ top, bottom }) => {
    const c = document.createElement('canvas');

    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d');

    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, 800, 300);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 300, 800, 300);

    return c.toDataURL('image/png').split(',')[1];
  }, fill);

  return Buffer.from(base64, 'base64');
};

const servePicture = async (page: Page, url: string, fill: Fill, cors: boolean): Promise<void> => {
  const body = await pngBytes(page, fill);

  await page.route(url, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body,
    headers: cors ? { 'Access-Control-Allow-Origin': '*' } : {},
  }));
};

// The test page is on localhost:4444, so 127.0.0.1:4444 is another origin.
const SAME = 'http://localhost:4444/tone-fixture/picture.png';
const CROSS = 'http://127.0.0.1:4444/tone-fixture/picture.png';
const NO_CORS = 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png';
const DARK: Fill = { top: '#111111', bottom: '#111111' };
const LIGHT: Fill = { top: '#fafafa', bottom: '#fafafa' };
const SKY: Fill = { top: '#fafafa', bottom: '#111111' };

const picture = (url: string, extra: Record<string, unknown> = {}): OutputData['blocks'][number] =>
  ({ id: 'img', type: 'image', data: { url, naturalWidth: 800, naturalHeight: 600, ...extra } });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('hover shows the toolbar inside the image even with room above; selecting adds the ring', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toBeVisible();
  const bar = await box(imageBlock(page).locator('[data-role="image-overlay"]'), 'toolbar');
  const fig = await box(figure(page), 'figure');

  expect(bar.y).toBeGreaterThanOrEqual(fig.y);
  await expect(imageBlock(page).locator('[data-role="image-selection-ring"]')).toHaveCSS('opacity', '0');

  await imageBlock(page).getByRole('textbox').click();
  await page.keyboard.press('Escape');

  await expect(imageBlock(page)).toHaveAttribute('data-blok-selected', 'true');
  await expect(imageBlock(page).locator('[data-role="image-selection-ring"]')).toHaveCSS('opacity', '1');
});

test('buttons hold still while the toolbar fades in', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await expect(figure(page)).not.toHaveAttribute('data-loading');
  // Measured against the figure: hovering may scroll the page.
  const offset = async (label: string): Promise<{ x: number; y: number }> => {
    const b = await box(imageBlock(page).locator('[data-action="crop"]'), label);
    const f = await box(figure(page), 'figure');

    return { x: b.x - f.x, y: b.y - f.y };
  };
  const before = await offset('crop at rest');

  await figure(page).hover();
  const early = await offset('crop early');

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('opacity', '1');
  const after = await offset('crop shown');

  expect(early.x).toBeCloseTo(before.x, 1);
  expect(early.y).toBeCloseTo(before.y, 1);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
});

test('an image in a table cell keeps its toolbar and handles inside the cell, where they can be clicked', async ({ page }) => {
  await createBlok(page, { blocks: [
    ...ROOM_ABOVE,
    { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['img'] }], [{ blocks: ['p1'] }]] }, content: ['img', 'p1'] },
    { id: 'img', type: 'image', parent: 'tbl', data: IMAGE },
    { id: 'p1', type: 'paragraph', parent: 'tbl', data: { text: 'Latte' } },
  ] });
  await hoverLoadedFigure(page);

  const more = await box(imageBlock(page).locator('[data-action="more"]'), 'more button');
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-action]')?.getAttribute('data-action'), { x: more.x + more.width / 2, y: more.y + more.height / 2 });

  expect(hit).toBe('more');

  const handle = await box(imageBlock(page).locator('[data-role="resize-handle"][data-edge="right"]'), 'right handle');
  const handleHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-role'), { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });

  expect(handleHit).toBe('resize-handle');
});

test('an image as the first block puts its toolbar inside', async ({ page }) => {
  await createBlok(page, { blocks: [{ id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  const bar = await box(imageBlock(page).locator('[data-role="image-overlay"]'), 'toolbar');
  const fig = await box(figure(page), 'figure');

  expect(bar.y).toBeGreaterThanOrEqual(fig.y);
});

test('dragging a handle shows the readout, snaps to 50% and saves it', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { ...IMAGE, width: 60, alignment: 'left' } }] });
  await hoverLoadedFigure(page);
  const handle = imageBlock(page).locator('[data-role="resize-handle"][data-edge="right"]');
  const h = await box(handle, 'right handle');
  const container = await box(imageBlock(page).locator('[data-blok-tool="image"]'), 'image root');
  const y = h.y + h.height / 2;

  await page.mouse.move(h.x + h.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(container.x + container.width * 0.51, y, { steps: 8 });

  await expect(imageBlock(page).locator('[data-role="image-resize-readout"]')).toHaveText(/^50% · \d+ px$/);
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('opacity', '0');

  await page.mouse.up();
  const saved = await page.evaluate(async () => {
    const out = await window.blokInstance?.save();

    return out?.blocks.find((b) => b.id === 'img')?.data?.width;
  });

  expect(saved).toBe(50);
});

test('alt: hint on hover, no hint while editing, Enter saves', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);
  const pill = imageBlock(page).locator('[data-action="alt-edit"]');

  await pill.hover();
  await expect(page.getByText('What is alt text?')).toBeVisible();

  await pill.click();
  const field = page.getByRole('textbox', { name: 'Alt text' });

  await expect(field).toBeFocused();
  await expect(page.getByText('What is alt text?')).toBeHidden();
  await pill.dispatchEvent('mouseenter');
  // Outlast the hint's 350ms hover delay inside the page before checking it never appeared.
  await page.evaluate(() => new Promise((resolve) => { setTimeout(resolve, 500); }));
  await expect(page.getByText('What is alt text?')).toBeHidden();

  await field.fill('Pink yarn mascot');
  await page.keyboard.press('Enter');

  const updated = imageBlock(page).locator('[data-action="alt-edit"]');

  await expect(updated).toHaveAttribute('data-state', 'set');
  await expect(updated).toContainText('Pink yarn mascot');
});

test('the ALT label and the alt text are drawn apart, not run together', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { ...IMAGE, alt: 'Blok logotype' } }] });
  await hoverLoadedFigure(page);
  const tag = imageBlock(page).locator('[data-action="alt-edit"]');
  // A flex row drops a whitespace-only text run, so the space in the text alone draws no gap.
  const gap = await tag.evaluate((el) => {
    const label = el.firstElementChild?.getBoundingClientRect();
    const text = el.lastElementChild?.getBoundingClientRect();

    return label && text ? text.left - label.right : Number.NaN;
  });

  expect(gap).toBeGreaterThanOrEqual(4);
  await expect(tag).toHaveAccessibleName('Alt Blok logotype');
});

test('the alt tag stays when the caption is hidden', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { ...IMAGE, captionVisible: false } }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-action="alt-edit"]')).toBeVisible();
});

test('reduced motion shows the toolbar with no fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('transition-duration', '0s');
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('opacity', '1');
});

test('a dark picture gets graphite chrome and light handles, before any hover', async ({ page }) => {
  await servePicture(page, SAME, DARK, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, picture(SAME, { alt: 'Night' })] });

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(imageBlock(page).locator('[data-action="alt-edit"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(imageBlock(page).locator('[data-role="resize-handle"][data-edge="left"]')).toHaveAttribute('data-tone', 'graphite');
  await hoverLoadedFigure(page);
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
  await expect(imageBlock(page).locator('[data-role="resize-handle"][data-edge="right"]')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.85)');
});

test('a bright picture gets paper chrome', async ({ page }) => {
  await servePicture(page, SAME, LIGHT, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, picture(SAME)] });

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'paper');
  await hoverLoadedFigure(page);
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('sky over ground: the toolbar is paper and the alt tag graphite', async ({ page }) => {
  await servePicture(page, SAME, SKY, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, picture(SAME, { alt: 'Dusk' })] });

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'paper');
  await expect(imageBlock(page).locator('[data-action="alt-edit"]')).toHaveAttribute('data-tone', 'graphite');
});

test('a cross-origin picture whose host sends CORS is still read', async ({ page }) => {
  await servePicture(page, CROSS, DARK, true);
  await createBlok(page, { blocks: [...ROOM_ABOVE, picture(CROSS)] });

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(imageBlock(page).locator('[data-blok-block-context-menu]')).not.toHaveAttribute('crossorigin');
});

test('a cross-origin picture without CORS still shows, and its chrome follows the editor theme', async ({ page }) => {
  // Served by the real test server, which sends no CORS header. A routed response can't stand in:
  // Playwright's route.fulfill adds access-control-allow-origin to cross-origin requests itself.
  await createBlok(page, { blocks: [...ROOM_ABOVE, picture(NO_CORS)] });
  await hoverLoadedFigure(page);

  // The visible img still loads: only the hidden CORS copy is refused.
  await expect.poll(() => imageBlock(page).locator('[data-blok-block-context-menu]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(800);
  // Give the failed CORS copy time to settle, then check nothing was stamped.
  await page.evaluate(() => new Promise((resolve) => { setTimeout(resolve, 300); }));
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).not.toHaveAttribute('data-tone');
  const themeSurface = await page.evaluate(() => getComputedStyle(document.querySelector('[data-blok-interface]') ?? document.body).getPropertyValue('--blok-overlay-surface').trim());
  const surface = await imageBlock(page).locator('[data-role="image-overlay"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-overlay-surface').trim());

  expect(surface).toBe(themeSurface);
});
