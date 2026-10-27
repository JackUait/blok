/**
 * Blok's own map (MapLibre, research/20 §1), end to end, offline: the host
 * style is a local style object, so the test fails if any request leaves the
 * test server.
 */

import type { Locator, Page, Request } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    mapChanges?: number;
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-where', name: 'Where', type: 'place', position: 'a1' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Pin Beta', 'p-where': { name: 'Eiffel Tower', address: '5 Avenue Anatole France, Paris', lat: 48.8584, lon: 2.2945 } } },
  { id: 'r2', properties: { 'p-title': 'Pin Gamma', 'p-where': { name: 'Statue of Liberty', lat: 40.6892, lon: -74.0445 } } },
];

/** A style with no tiles: a background and an attribution, all local. */
const STYLE = {
  version: 8,
  sources: { credits: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Test map data' } },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#e8eef2' } },
    { id: 'credits', type: 'circle', source: 'credits' },
  ],
};

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Trips',
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: { position: `a${i}`, properties: row.properties },
  })),
];

interface MapLevers {
  style?: boolean;
  geocode?: boolean;
}

/** Levers are functions, so they are built inside the page. */
const mount = async (page: Page, data: OutputBlockData[], levers: MapLevers = { style: true }): Promise<void> => {
  await page.evaluate(async ({ input, style, which }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.mapChanges = 0;
    const map: Record<string, unknown> = {
      reverseGeocode: () => Promise.resolve({ name: 'Clicked spot', address: '1 Test Street' }),
    };

    if (which.style === true) map.styleUrl = style;
    if (which.geocode === true) {
      map.geocode = (query: string) => Promise.resolve(query.startsWith('Louv')
        ? [{ name: 'Louvre Museum', address: 'Rue de Rivoli, 75001 Paris, France', lat: 48.8606, lon: 2.3376, id: 'x' }]
        : []);
    }
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      onChange: () => {
        window.mapChanges = (window.mapChanges ?? 0) + 1;
      },
      tools: {
        database: { class: window.BlokDatabase, config: { map } },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: data, style: STYLE, which: levers });
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

const savedPlace = async (page: Page, rowId: string): Promise<unknown> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();
  const row = output?.blocks.find((block) => block.id === id);

  return (row?.data as { properties: Record<string, unknown> } | undefined)?.properties['p-where'];
}, rowId);

const mapRegion = (page: Page): Locator => page.locator('[data-blok-database-map-canvas]').getByRole('region', { name: 'Map' });

const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

const outside: string[] = [];
const watchRequests = (request: Request): void => {
  const url = request.url();

  if (!/^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/|blob:|data:)/.test(url)) outside.push(url);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  outside.length = 0;
  page.on('request', watchRequests);
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(({ page }) => {
  page.off('request', watchRequests);
  expect(outside).toEqual([]);
});

test.describe('Blok\'s own map', () => {
  test('no style: a plain message, and MapLibre never loads', async ({ page }) => {
    const scripts: string[] = [];

    page.on('request', (request) => scripts.push(request.url()));
    await mount(page, blocks({ type: 'map' }), {});

    await expect(page.locator('[data-blok-database-map-empty="no-style"]')).toHaveText('A map style is needed to show this map.');
    expect(scripts.filter((url) => url.includes('maplibre'))).toEqual([]);
  });

  test('draws every pin inside the map, fitted, with no zoom buttons and the attribution behind its button', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }));
    const region = mapRegion(page);
    const beta = page.getByRole('link', { name: 'Pin Beta' });
    const gamma = page.getByRole('link', { name: 'Pin Gamma' });

    await expect(region).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(gamma).toBeVisible();
    const box = await page.locator('[data-blok-database-map-canvas]').boundingBox();

    for (const pin of [beta, gamma]) {
      const pinBox = await pin.boundingBox();

      expect(pinBox).not.toBeNull();
      expect(box).not.toBeNull();
      if (pinBox === null || box === null) return;
      expect(pinBox.x).toBeGreaterThanOrEqual(box.x);
      expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(box.x + box.width);
      expect(pinBox.y).toBeGreaterThanOrEqual(box.y);
      expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(box.y + box.height);
    }
    expect(box?.height).toBe(400);
    await expect(page.getByRole('button', { name: /zoom/i })).toHaveCount(0);
    await expect(beta).toHaveAttribute('href', '#r1');
    expect(await beta.evaluate((el) => getComputedStyle(el, '::after').backgroundColor)).toBe('rgb(35, 131, 226)');

    // MapLibre's "ⓘ" is a <summary>: it has no button role, only its label.
    const toggle = page.getByLabel('Toggle attribution');

    await expect(toggle).toBeVisible();
    await expect(page.getByText('Test map data')).toBeHidden();
    await toggle.click();
    await expect(page.getByText('Test map data')).toBeVisible();
  });

  test('the map paints with WebGL', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }));
    await expect(page.getByRole('link', { name: 'Pin Beta' })).toBeVisible();

    // A WebGL canvas reads back blank without preserveDrawingBuffer: read the screen instead.
    const centre = async (): Promise<string> => {
      const shot = (await mapRegion(page).screenshot()).toString('base64');

      return page.evaluate(async (png) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const copy = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = copy.getContext('2d');

        context?.drawImage(bitmap, 0, 0);
        const [r, g, b] = context?.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data ?? [];

        return `${r},${g},${b}`;
      }, shot);
    };

    await expect.poll(centre).toBe('232,238,242');
  });

  test('a pin hovers into a page preview and opens its row in a center peek', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }));
    const beta = page.getByRole('link', { name: 'Pin Beta' });

    await beta.hover();
    await expect(page.getByTestId('tooltip-content')).toContainText('Trips');
    await expect(page.getByTestId('tooltip-content')).toContainText('Pin Beta');
    await beta.click();

    await expect(page.locator('[data-blok-database-drawer]')).toHaveAttribute('data-peek-mode', 'center');
    expect(new URL(page.url()).hash).toBe('');
  });

  test('the wheel zooms the map, not the page, and panning writes nothing', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }));
    const beta = page.getByRole('link', { name: 'Pin Beta' });
    const gamma = page.getByRole('link', { name: 'Pin Gamma' });

    await expect(gamma).toBeVisible();
    const gap = async (): Promise<number> => {
      const [a, b] = await Promise.all([beta.boundingBox(), gamma.boundingBox()]);

      return a === null || b === null ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
    };
    const before = await gap();
    const changes = await page.evaluate(() => window.mapChanges ?? 0);
    const scroll = await page.evaluate(() => window.scrollY);
    const box = await page.locator('[data-blok-database-map-canvas]').boundingBox();

    if (box === null) throw new Error('no map');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(gap).toBeGreaterThan(before * 1.2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);

    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 120, { steps: 8 });
    await page.mouse.up();
    // onChange is debounced: give it time to fire if the map's DOM churn leaked.
    await page.evaluate(() => new Promise((resolve) => {
      setTimeout(resolve, 600);
    }));
    expect(await page.evaluate(() => window.mapChanges ?? 0)).toBe(changes);
  });

  test('Add pin mode: crosshair, one click adds a row at that point named by the host, then ends', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }));
    await expect(page.getByRole('link', { name: 'Pin Beta' })).toBeVisible();
    await page.getByRole('button', { name: 'Enable add pin mode' }).click();
    const box = await page.locator('[data-blok-database-map-canvas]').boundingBox();

    if (box === null) throw new Error('no map');
    await page.mouse.move(box.x + 40, box.y + box.height - 60);
    await page.mouse.move(box.x + 42, box.y + box.height - 58);
    expect(await mapRegion(page).evaluate((canvas) => getComputedStyle(canvas.parentElement ?? canvas).cursor)).toBe('crosshair');
    await page.mouse.click(box.x + 42, box.y + box.height - 58);

    await expect(page.locator('[data-blok-database-drawer]')).toHaveAttribute('data-peek-mode', 'center');
    await expect(page.getByRole('button', { name: 'Enable add pin mode' })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => (await window.blokInstance?.save())?.blocks.filter((b) => b.type === 'database-row').length)).toBe(3);
    const added = await page.evaluate(async () => {
      const rows = (await window.blokInstance?.save())?.blocks.filter((b) => b.type === 'database-row') ?? [];

      return (rows[2]?.data as { properties: Record<string, { name?: string; lat?: number; lon?: number }> }).properties['p-where'];
    });

    expect(added.name).toBe('Clicked spot');
    expect(typeof added.lat).toBe('number');
    expect(typeof added.lon).toBe('number');
  });

  test('Height sizes the map', async ({ page }) => {
    await mount(page, blocks({ type: 'map', mapHeight: 'large' }));
    await expect(mapRegion(page)).toBeVisible();

    expect((await page.locator('[data-blok-database-map-canvas]').boundingBox())?.height).toBe(600);
  });

  test('without WebGL it says so and never throws', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await mount(page, blocks({ type: 'map' }));

    await expect(page.locator('[data-blok-database-map-empty="no-webgl"]')).toHaveText('This browser can\'t show maps.');
    expect(errors).toEqual([]);
  });
});

test.describe('Place with Blok\'s map', () => {
  test('the hover card draws a small still map of the place', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    await cell(page, 'r1', 'p-where').hover();

    const card = page.getByTestId('tooltip-content');

    await expect(card).toContainText('5 Avenue Anatole France, Paris');
    await expect(card.getByRole('region', { name: 'Map' })).toBeVisible();
    await expect.poll(() => card.evaluate((root) => root.querySelectorAll('canvas').length)).toBe(1);

    // MapLibre's own `position: relative` is scoped to its descendants; without the box's, the canvas sits over the name.
    const box = await card.evaluate((root) => {
      const canvas = root.querySelector('canvas')?.getBoundingClientRect();
      const frame = root.querySelector('[data-blok-database-place-card-map]')?.getBoundingClientRect();

      return {
        offset: [(canvas?.x ?? 0) - (frame?.x ?? -1), (canvas?.y ?? 0) - (frame?.y ?? -1)],
        size: [canvas?.width ?? 0, canvas?.height ?? 0, frame?.width ?? -1, frame?.height ?? -1],
      };
    });

    expect(box.offset).toEqual([0, 0]);
    expect(box.size.slice(0, 2)).toEqual(box.size.slice(2));
  });

  test('"Search for a location..." uses the host geocoder; a pick stores name, address and point', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), { style: true, geocode: true });
    await cell(page, 'r2', 'p-where').click();
    // A cell that holds a place opens on it (research/35 §9); × goes back to the search.
    await page.locator('[data-blok-database-cell-editor]').getByRole('button', { name: 'Clear' }).click();
    const field = page.getByPlaceholder('Search for a location...');

    await field.fill('Louvre');
    const result = page.locator('[data-blok-database-place-result]');

    await expect(result).toHaveText(/Louvre Museum\s*Rue de Rivoli, 75001 Paris, France/);
    await result.click();

    await expect.poll(() => savedPlace(page, 'r2')).toEqual({ name: 'Louvre Museum', address: 'Rue de Rivoli, 75001 Paris, France', lat: 48.8606, lon: 2.3376 });
    await expect(cell(page, 'r2', 'p-where')).toHaveText('Louvre Museum');
  });

  test('in a side peek a pick keeps the editor open on the place, with a map as wide as the editor (research/35 §9)', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), { style: true, geocode: true });
    const row = page.locator('[data-blok-database-table-row][data-row-id="r2"]');

    await row.hover();
    await row.locator('[data-blok-database-table-open]').click();
    const peek = page.locator('[data-blok-database-drawer]');

    await expect(peek).toBeVisible();
    await peek.locator('[data-blok-database-drawer-prop-value][data-property-id="p-where"]').click();
    await page.locator('[data-blok-database-cell-editor]').getByRole('button', { name: 'Clear' }).click();
    await page.getByPlaceholder('Search for a location...').fill('Louvre');
    await page.locator('[data-blok-database-place-result]').click();

    const editor = page.locator('[data-blok-database-cell-editor]');

    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-blok-database-place-name]')).toHaveText('Louvre Museum');
    const map = editor.getByRole('region', { name: 'Map' });

    await expect(map).toBeVisible();
    await expect(editor.getByRole('link', { name: 'Open in Google Maps' })).toBeVisible();
    await expect.poll(() => savedPlace(page, 'r2')).toEqual({ name: 'Louvre Museum', address: 'Rue de Rivoli, 75001 Paris, France', lat: 48.8606, lon: 2.3376 });

    const box = await editor.evaluate((root) => {
      const canvas = root.querySelector('canvas')?.getBoundingClientRect();
      const frame = root.querySelector('[data-blok-database-place-view-map]')?.getBoundingClientRect();

      return {
        editor: root.getBoundingClientRect().width,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        offset: [(canvas?.x ?? 0) - (frame?.x ?? -1), (canvas?.y ?? 0) - (frame?.y ?? -1)],
      };
    });

    expect(box.offset).toEqual([0, 0]);
    expect(box.height).toBe(168);
    expect(box.width).toBe(box.editor - 8);

    // Notion clears the saved place on the first key here (research/35 §9); Blok does not copy that loss.
    await page.keyboard.press('L');
    await expect(editor.locator('[data-blok-database-place-name]')).toHaveText('Louvre Museum');
    expect(await savedPlace(page, 'r2')).toEqual({ name: 'Louvre Museum', address: 'Rue de Rivoli, 75001 Paris, France', lat: 48.8606, lon: 2.3376 });

    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(peek).toBeVisible();
    expect(await savedPlace(page, 'r2')).toEqual({ name: 'Louvre Museum', address: 'Rue de Rivoli, 75001 Paris, France', lat: 48.8606, lon: 2.3376 });
  });
});
