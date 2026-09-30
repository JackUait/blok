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

// Room above the image: the islands must stay inside the picture even when they would fit above it.
const ROOM_ABOVE = [
  { type: 'paragraph', data: { text: 'One' } },
  { type: 'paragraph', data: { text: 'Two' } },
  { type: 'paragraph', data: { text: 'Three' } },
];

const imageBlock = (page: Page): Locator => page.locator('[data-blok-id="img"]');
const figure = (page: Page): Locator => imageBlock(page).locator('[data-role="image-figure"]');

// The pill and islands stay hidden while the image bytes load; hover only once it has painted.
const hoverLoadedFigure = async (page: Page): Promise<void> => {
  await expect(figure(page)).not.toHaveAttribute('data-loading');
  await figure(page).hover();
};

const box = async (locator: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  expect(b, `${label} bounding box missing`).not.toBeNull();

  return b as { x: number; y: number; width: number; height: number };
};

test('hover shows the islands inside the image even with room above; selecting adds the ring', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-island="edit"]')).toBeVisible();
  const islands = await box(imageBlock(page).locator('[data-island="edit"]'), 'edit island');
  const fig = await box(figure(page), 'figure');

  expect(islands.y).toBeGreaterThanOrEqual(fig.y);
  await expect(imageBlock(page).locator('[data-role="image-selection-ring"]')).toHaveCSS('opacity', '0');

  await imageBlock(page).getByRole('textbox').click();
  await page.keyboard.press('Escape');

  await expect(imageBlock(page)).toHaveAttribute('data-blok-selected', 'true');
  await expect(imageBlock(page).locator('[data-role="image-selection-ring"]')).toHaveCSS('opacity', '1');
});

test('the islands split without sliding a button sideways, and every neck ends pinched off', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await expect(figure(page)).not.toHaveAttribute('data-loading');
  await figure(page).hover();

  const sample = async (time: number): Promise<{ crop: number; more: number; neck: string; bar: string }> =>
    page.evaluate((t) => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = t;
      }
      const at = (action: string): number => document.querySelector(`[data-blok-id="img"] [data-action="${action}"]`)?.getBoundingClientRect().x ?? Number.NaN;
      const edit = document.querySelector('[data-blok-id="img"] [data-island="edit"]');
      const bar = document.querySelector('[data-blok-id="img"] [data-role="image-overlay"]');

      return {
        crop: at('crop'),
        more: at('more'),
        neck: edit ? getComputedStyle(edit, '::after').transform : '',
        bar: bar ? getComputedStyle(bar, '::after').opacity : '',
      };
    }, time);

  const first = await sample(0);
  const frames = [first, await sample(200), await sample(420), await sample(560), await sample(5000)];
  const last = frames[frames.length - 1];

  frames.forEach((frame) => {
    expect(frame.crop).toBeCloseTo(first.crop, 1);
    expect(frame.more).toBeCloseTo(first.more, 1);
  });
  expect(last.bar).toBe('0');
  expect(last.neck).toMatch(/^matrix\(1, 0, 0, 0,/);
});

test('an image in a table cell keeps its islands inside the cell, where they can be clicked', async ({ page }) => {
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
});

test('an image as the first block puts its islands inside', async ({ page }) => {
  await createBlok(page, { blocks: [{ id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  const islands = await box(imageBlock(page).locator('[data-island="edit"]'), 'edit island');
  const fig = await box(figure(page), 'figure');

  expect(islands.y).toBeGreaterThanOrEqual(fig.y);
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

test('the alt pill stays when the caption is hidden', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { ...IMAGE, captionVisible: false } }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-action="alt-edit"]')).toBeVisible();
});

test('reduced motion shows the islands without animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await hoverLoadedFigure(page);

  await expect(imageBlock(page).locator('[data-island="edit"]')).toHaveCSS('animation-name', 'none');
  await expect(imageBlock(page).locator('[data-island="edit"]')).toHaveCSS('opacity', '1');
});
