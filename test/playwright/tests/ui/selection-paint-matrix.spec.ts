import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { CONTAINER_FIXTURES, LEAF_FIXTURES } from '../../fixtures/selection-paint-fixtures';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

/**
 * A selected block must read as selected whatever it draws: exactly ONE
 * selection tint over everything it shows. Checked on pixels, so it holds for
 * any way of painting — a missing tint, a tint hidden under the tool's own
 * surface (a code card, a callout fill) and a tint applied twice (a child of a
 * selected container) all break `after = blend(before, selection)`.
 */

const HOLDER_ID = 'blok';
const EMBED_ROUTE = 'https://codepen.io/**';
const LASSO_VIEWPORT_HEIGHT = 5000;
const SAMPLE_COLUMNS = 14;
const SAMPLE_ROWS = 8;
/** Sampled pixel within this many levels per channel of the one-tint colour. */
const TOLERANCE = 5;
/**
 * Most sampled pixels must carry exactly one tint, and almost none may be left
 * bare or tinted twice. Pixels that changed some other way are controls a tool
 * shows on selection (the image toolbar), not a wrong tint.
 */
const MIN_TINTED_SHARE = 0.6;
const MAX_WRONG_SHARE = 0.05;

type Rgba = { r: number; g: number; b: number; a: number };

/** Every leaf at the top level and inside every container; containers at the top level. */
const documentBlocks = (): { blocks: OutputData['blocks']; containers: string[] } => {
  const blocks: OutputData['blocks'] = [];
  const containers: string[] = [];

  for (const leaf of LEAF_FIXTURES) {
    blocks.push(...leaf.blocks(null, `top-${leaf.tool}`));
  }

  for (const container of CONTAINER_FIXTURES) {
    const prefix = `in-${container.tool}`;
    const parentId = container.childParentId(prefix);
    // The tab block refuses a tabs child, so that pair is not a document a user can make.
    const leaves = LEAF_FIXTURES.filter((leaf) => !(container.tool === 'tab' && leaf.tool === 'tabs'));
    const children = leaves.map((leaf) => leaf.blocks(parentId, `${prefix}-${leaf.tool}`)).flat();
    const childIds = children.filter((block) => block.parent === parentId).map((block) => block.id ?? '');

    containers.push(prefix);
    blocks.push(...container.blocks(prefix, childIds), ...children);
  }

  return { blocks, containers };
};

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, data }) => {
    const host = document.createElement('div');

    host.id = holder;
    host.style.width = '760px';
    host.style.margin = '40px auto';
    document.body.appendChild(host);

    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: blocks });
  await openFixtureToggles(page, { blocks });
  // Offscreen images load lazily, and decode() on one that never starts never settles.
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => {
    img.setAttribute('loading', 'eager');

    return img.decode().catch(() => undefined);
  })));
  // Embed frames load lazily; one that paints between the two shots would read as a wrong tint.
  const frames = await page.evaluate(() => {
    const embeds = document.querySelectorAll('[data-blok-tool="embed"] iframe');

    embeds.forEach((frame) => frame.setAttribute('loading', 'eager'));

    return embeds.length;
  });
  const embedFrames = (): ReturnType<Page['frames']> => page.frames().filter((frame) => frame.url().startsWith('https://codepen.io/'));

  await expect.poll(() => embedFrames().length).toBe(frames);
  await Promise.all(embedFrames().map((frame) => frame.waitForLoadState('load')));
};

/** The selection colour as the editor resolves it. */
const selectionColor = async (page: Page): Promise<Rgba> => {
  const color = await page.evaluate(() => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = 'var(--blok-selection)';
    document.querySelector('[data-blok-interface]')?.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;

    probe.remove();

    return value;
  });
  const [ r, g, b, a = 1 ] = (color.match(/[\d.]+/g) ?? []).map(Number);

  return { r, g, b, a };
};

/** Ids of every block on the page, in document order. */
const blockIds = (page: Page): Promise<string[]> => page.evaluate(() => Array.from(
  document.querySelectorAll(`#blok [data-blok-testid="block-wrapper"]`),
  (holder) => holder.getAttribute('data-blok-id') ?? ''
));

type Box = { id: string; x: number; y: number; width: number; height: number };
type Shot = { image: string; boxes: Box[]; pageWidth: number };
type Counts = { ok: number; untinted: number; double: number; other: number; centre: string };

/**
 * ONE full-page screenshot plus each block's content box in page coordinates.
 * A shot per block (scroll, wait, capture) is too slow for a hundred blocks.
 */
const shootAll = async (page: Page, ids: string[]): Promise<Shot> => {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const image = (await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })).toString('base64');
  const layout = await page.evaluate((list) => ({
    pageWidth: document.documentElement.scrollWidth,
    boxes: list.flatMap((id) => {
      const rect = document.querySelector(`[data-blok-id="${id}"] > [data-blok-element-content]`)?.getBoundingClientRect();

      return rect === undefined || rect.width < 4 || rect.height < 4
        ? []
        : [ { id, x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height } ];
    }),
  }), ids);

  return { image, ...layout };
};

/**
 * Per block, how sampled pixels changed between the shots: carrying exactly one
 * tint (`ok`), unchanged, tinted twice, or changed some other way. Decoded on a
 * canvas in the page, so the test needs no image library.
 */
const compare = (page: Page, before: Shot, after: Shot, sel: Rgba): Promise<Record<string, Counts>> => page.evaluate(async ({ a, b, color, columns, rows, tolerance }) => {
  const decode = async (image: string): Promise<CanvasRenderingContext2D> => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${image}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

    context.drawImage(bitmap, 0, 0);

    return context;
  };
  const [ first, second ] = await Promise.all([ decode(a.image), decode(b.image) ]);
  const scale = first.canvas.width / a.pageWidth;
  const tint = (base: number[]): number[] => base.map((v, i) => v * (1 - color.a) + [ color.r, color.g, color.b ][i] * color.a);
  const near = (x: number[], y: number[]): boolean => x.every((v, i) => Math.abs(v - y[i]) <= tolerance);
  const classify = (base: number[], seen: number[]): 'ok' | 'untinted' | 'double' | 'other' => {
    const once = tint(base);

    if (near(seen, once)) {
      return 'ok';
    }
    if (near(seen, base)) {
      return 'untinted';
    }

    return near(seen, tint(once)) ? 'double' : 'other';
  };
  const result: Record<string, { ok: number; untinted: number; double: number; other: number; centre: string }> = {};
  const rgb = (context: CanvasRenderingContext2D, x: number, y: number): number[] => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));

  for (const box of a.boxes) {
    const counts = { ok: 0, untinted: 0, double: 0, other: 0 };

    for (let k = 0; k < columns * rows; k++) {
      const x = Math.floor((box.x + (((k % columns) + 0.5) / columns) * box.width) * scale);
      const y = Math.floor((box.y + ((Math.floor(k / columns) + 0.5) / rows) * box.height) * scale);
      const base = Array.from(first.getImageData(x, y, 1, 1).data.slice(0, 3));
      const seen = Array.from(second.getImageData(x, y, 1, 1).data.slice(0, 3));
      counts[classify(base, seen)]++;
    }
    const cx = Math.floor((box.x + box.width / 2) * scale);
    const cy = Math.floor((box.y + box.height / 2) * scale);

    // The centre pixel before → after, so a failure shows what the block really drew.
    result[box.id] = { ...counts, centre: `${rgb(first, cx, cy).join(',')} → ${rgb(second, cx, cy).join(',')}` };
  }

  return result;
}, { a: before, b: after, color: sel, columns: SAMPLE_COLUMNS, rows: SAMPLE_ROWS, tolerance: TOLERANCE });

/**
 * Ids of blocks that are selected or sit inside a selected block: the ones that
 * must show a tint. A layout container (column_list) is never selected itself,
 * and the gaps between its selected rows rightly stay bare.
 */
const underSelection = (page: Page, ids: string[]): Promise<string[]> => page.evaluate((list) => list.filter((id) => {
  return Boolean(document.querySelector(`[data-blok-id="${id}"]`)?.closest('[data-blok-selected="true"]'));
}), ids);

/** Blocks whose pixels do not show exactly one tint, with the counts that say why. */
const failures = (counts: Record<string, Counts>, painted: string[]): string[] => Object.entries(counts).filter(([ id ]) => painted.includes(id)).flatMap(([ id, c ]) => {
  const total = c.ok + c.untinted + c.double + c.other;
  const sound = c.ok / total >= MIN_TINTED_SHARE && (c.untinted + c.double) / total <= MAX_WRONG_SHARE;

  return sound ? [] : [ `${id} ${JSON.stringify(c)}` ];
});

const selectAll = async (page: Page, total: number): Promise<void> => {
  await page.locator('[data-blok-id="top-paragraph"] [data-blok-element-content]').click();

  for (let press = 0; press < 4; press++) {
    await page.keyboard.press('ControlOrMeta+a');

    if (await page.locator('[data-blok-selected="true"]').count() === total) {
      return;
    }
  }

  expect(await page.locator('[data-blok-selected="true"]').count()).toBe(total);
};

/** Lasso from the page margin across one whole container, with a viewport tall enough to hold it. */
const lassoOver = async (page: Page, id: string): Promise<void> => {
  const holder = page.locator(`[data-blok-id="${id}"]`);

  await holder.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = await holder.boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }

  await page.mouse.move(12, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(0, 0);
  // A layout container (column_list) is never selected itself; its rows are.
  await expect(page.locator(`[data-blok-id="${id}"][data-blok-selected="true"], [data-blok-id="${id}"] [data-blok-selected="true"]`).first()).toBeAttached();
};

test.describe('a selected block shows exactly one selection tint', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    // The embed frame's content would come from the network; a fixed page keeps its pixels still between shots.
    await page.route(EMBED_ROUTE, (route) => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#8a8a8a"></body>' }));
  });

  test.afterEach(async ({ page }) => {
    await page.unroute(EMBED_ROUTE);
  });

  for (const scheme of [ 'light', 'dark' ] as const) {
    test(`every tool, everywhere, after select-all (${scheme})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1100, height: 900 });

      const { blocks } = documentBlocks();

      await mount(page, blocks);
      await page.mouse.move(0, 0);

      const ids = await blockIds(page);
      const before = await shootAll(page, ids);

      await selectAll(page, ids.length);
      await page.mouse.move(0, 0);

      const after = await shootAll(page, ids);

      const painted = await underSelection(page, ids);

      expect(painted).toEqual(ids);
      expect(failures(await compare(page, before, after, await selectionColor(page)), painted)).toEqual([]);
    });

    test(`a lassoed container tints itself and its children once (${scheme})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

      const { blocks, containers } = documentBlocks();

      // Tall enough to hold any one container, set BEFORE mounting: resizing later
      // leaves embed frames blank until they repaint, which reads as a wrong tint.
      await page.setViewportSize({ width: 1100, height: LASSO_VIEWPORT_HEIGHT });
      await mount(page, blocks);

      const height = await page.evaluate((ids) => Math.max(...ids.map((id) => document.querySelector(`[data-blok-id="${id}"]`)?.getBoundingClientRect().height ?? 0)), containers);

      expect(height + 100).toBeLessThan(LASSO_VIEWPORT_HEIGHT);

      const problems: string[] = [];

      for (const container of containers) {
        await page.mouse.click(0, 0);
        await page.keyboard.press('Escape');

        const ids = await page.evaluate((id) => [ id, ...Array.from(
          document.querySelectorAll(`[data-blok-id="${id}"] [data-blok-testid="block-wrapper"]`),
          (holder) => holder.getAttribute('data-blok-id') ?? ''
        ) ], container);
        const before = await shootAll(page, ids);

        await lassoOver(page, container);

        const after = await shootAll(page, ids);

        const painted = await underSelection(page, ids);
        const leaves = LEAF_FIXTURES.map((leaf) => `${container}-${leaf.tool}`).filter((id) => ids.includes(id));

        // The band crossed every row, so every leaf in the container must be under a selection.
        expect(leaves.filter((id) => !painted.includes(id))).toEqual([]);
        problems.push(...failures(await compare(page, before, after, await selectionColor(page)), painted));
      }

      expect(problems).toEqual([]);
    });
  }
});
