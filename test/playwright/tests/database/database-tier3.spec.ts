/**
 * Tier 3 (D6) database levers, end to end: the form view, the map view's
 * empty state and host map, the permissions gate and the comments lever.
 * Notion behaviour: https://www.notion.com/help/forms (questions map to
 * properties, answers land as pages) and https://www.notion.com/help/guides/using-maps-in-notion
 * (a map needs a Place property). Blok builds no service: each lever is the host's.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    tier3Log?: unknown[];
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-email', name: 'Email', type: 'email', position: 'a1' },
  { id: 'p-where', name: 'Where', type: 'place', position: 'a2' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'HQ', 'p-email': 'hq@example.com', 'p-where': { name: 'Head office', lat: 51.5, lon: -0.12 } } },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    // A valid fractional key: a new row's position is worked out after it.
    data: { position: `a${i}`, properties: row.properties },
  })),
];

type Lever = 'none' | 'forms' | 'map' | 'readOnlyGate' | 'comments';

/** Levers are functions, so they are built inside the page. */
const mount = async (page: Page, data: OutputBlockData[], lever: Lever): Promise<void> => {
  await page.evaluate(async ({ input, which }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    const log: unknown[] = [];

    window.tier3Log = log;
    const config: Record<string, unknown> = {};

    if (which === 'forms') {
      config.forms = {
        onSubmit: (submission: unknown) => log.push(submission),
        workspaceName: 'Personal',
        link: () => 'https://forms.example.test/f/1',
      };
    }
    if (which === 'map') {
      // A stub host map: pins as buttons, a "Click map" button standing in for a click on the canvas.
      config.map = {
        render: (container: HTMLElement, items: Array<{ rowId: string; title: string; color?: string }>, ctx: {
          open(rowId: string): void;
          height: number;
          addingPin(): boolean;
          onAddPin(lngLat: { lng: number; lat: number }): void;
        }) => {
          log.push({ height: ctx.height });
          items.forEach((item) => {
            const pin = document.createElement('button');

            pin.type = 'button';
            pin.textContent = `Pin ${item.title}`;
            pin.dataset.color = item.color ?? '';
            pin.addEventListener('click', () => ctx.open(item.rowId));
            container.appendChild(pin);
          });
          const point = document.createElement('button');

          point.type = 'button';
          point.textContent = 'Click map';
          point.addEventListener('click', () => ctx.onAddPin({ lng: 2.29, lat: 48.85 }));
          container.appendChild(point);
        },
        reverseGeocode: () => Promise.resolve({ name: '5 Avenue Anatole France', address: '5 Avenue Anatole France, 75007 Paris, France' }),
        renderPlace: (container: HTMLElement) => {
          container.append('Mini map');
        },
      };
    }
    if (which === 'readOnlyGate') {
      config.permissions = { can: (action: string) => action === 'comment' };
    }
    if (which === 'comments') {
      config.comments = { open: (target: unknown) => log.push(target) };
    }
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: { class: window.BlokDatabase, config },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: data, which: lever });
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

const savedRows = async (page: Page): Promise<Array<{ id: string; properties: Record<string, unknown> }>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .map((block) => ({ id: block.id ?? '', properties: (block.data as { properties: Record<string, unknown> }).properties }));
});

const question = (page: Page, propertyId: string): Locator => page.locator(`[data-blok-database-form-question="${propertyId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('form view', () => {
  test('a submit adds the answers as a page and hands them to the host', async ({ page }) => {
    await mount(page, blocks({ type: 'form' }), 'forms');

    await question(page, 'p-title').getByRole('textbox').fill('Ada');
    await question(page, 'p-email').getByRole('textbox').fill('ada@example.com');
    await question(page, 'p-where').getByRole('textbox').fill('1 Main St');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.locator('[data-blok-database-form-confirmation]')).toBeVisible();
    const rows = await savedRows(page);
    const added = rows.find((row) => row.properties['p-title'] === 'Ada');

    expect(added?.properties).toMatchObject({ 'p-email': 'ada@example.com', 'p-where': { address: '1 Main St' } });
    expect(await page.evaluate(() => window.tier3Log)).toEqual([
      {
        databaseId: 'db-1', viewId: 'v1', values: { 'p-title': 'Ada', 'p-email': 'ada@example.com', 'p-where': { address: '1 Main St' } }, rowId: added?.id,
        sharing: { public: false, anonymous: false, submissionAccess: 'none' },
      },
    ]);
  });

  test('a required question left empty blocks the submit', async ({ page }) => {
    await mount(page, blocks({ type: 'form', properties: [{ id: 'p-email', visible: true, required: true }] }), 'forms');

    await question(page, 'p-title').getByRole('textbox').fill('Ada');
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(question(page, 'p-email')).toHaveAttribute('data-invalid', '');
    await expect(question(page, 'p-email').getByRole('textbox')).toBeFocused();
    expect(await savedRows(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.tier3Log)).toEqual([]);
  });
});

test.describe('form view, research/19 §3', () => {
  test('a new form view asks to auto-create questions; "Start from scratch" keeps only Name', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'forms');

    await page.getByRole('button', { name: 'Add view' }).click();
    await page.getByText('Form', { exact: true }).click();
    const prompt = page.getByRole('dialog', { name: 'Auto-create form questions based on existing properties?' });

    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Create 2 questions' })).toBeVisible();
    await prompt.getByRole('button', { name: 'Start from scratch' }).click();

    await expect(prompt).toBeHidden();
    await expect(page.locator('[data-blok-database-form-question]')).toHaveCount(1);
    await expect(question(page, 'p-title')).toBeVisible();
  });

  test('"Share form" closes the form for everyone with "No access", and "Change" opens it again', async ({ page }) => {
    await mount(page, blocks({ type: 'form' }), 'forms');

    await expect(page.getByText('Only members at Personal can fill out this form.')).toBeVisible();
    await page.getByRole('button', { name: 'Share form' }).click();
    await expect(page.getByTestId('database-form-share-link')).toHaveValue('https://forms.example.test/f/1');
    await page.getByTestId('database-form-share-who').click();
    await page.getByTestId('database-form-share-who-closed').click();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('database-form-share')).toBeHidden();
    await expect(page.getByText('No one can fill out this form.')).toBeVisible();
    await page.getByTestId('database-form-access-change').click();
    await page.getByTestId('database-form-share-who').click();
    await page.getByTestId('database-form-share-who-workspace').click();
    await page.keyboard.press('Escape');

    await expect(page.getByText('Only members at Personal can fill out this form.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  });
});

test.describe('map view', () => {
  test('without a map style or host map it says a style is needed instead of drawing a fake map', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'none');

    await expect(page.locator('[data-blok-database-map-empty="no-style"]')).toHaveText('A map style is needed to show this map.');
  });

  // research/23 §5b: a green rule paints the pin rgb(70, 161, 113); an uncoloured pin stays #2383E2.
  test('paints a green rule\'s pin the measured green, in light and dark', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'map');
    const fills = (): Promise<string[]> => page.locator('[data-blok-database-map]').evaluate((map) => ['green', null].map((color) => {
      const pin = document.createElement('span');

      pin.setAttribute('data-blok-database-map-pin', '');
      if (color !== null) pin.setAttribute('data-color', color);
      map.appendChild(pin);
      const fill = getComputedStyle(pin, '::after').backgroundColor;

      pin.remove();

      return fill;
    }));

    await page.emulateMedia({ colorScheme: 'light' });
    expect(await fills()).toEqual(['rgb(70, 161, 113)', 'rgb(35, 131, 226)']);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await fills())[0]).toBe('rgb(70, 161, 113)');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('the host draws the pins, and a pin opens its page in a center peek', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'map');

    await page.getByRole('button', { name: 'Pin HQ' }).click();

    await expect(page.locator('[data-blok-database-drawer]')).toHaveAttribute('data-peek-mode', 'center');
  });

  test('conditional color reaches the pins, and Height sizes the map', async ({ page }) => {
    await mount(page, blocks({
      type: 'map',
      mapHeight: 'large',
      colorRules: [{ id: 'c1', propertyId: 'p-title', operator: 'contains', value: 'HQ', color: 'red' }],
    }), 'map');

    await expect(page.getByRole('button', { name: 'Pin HQ' })).toHaveAttribute('data-color', 'red');
    expect((await page.locator('[data-blok-database-map-canvas]').boundingBox())?.height).toBe(600);
    expect(await page.evaluate(() => window.tier3Log)).toEqual([{ height: 600 }]);
  });

  test('Add pin mode adds a row named by the host geocoder, opens it and switches itself off', async ({ page }) => {
    await mount(page, blocks({ type: 'map' }), 'map');
    const addPin = page.getByRole('button', { name: 'Enable add pin mode' });

    await addPin.hover();
    await expect(page.getByTestId('tooltip')).toHaveText('Add pin');
    await addPin.click();
    await expect(page.getByRole('button', { name: 'Cancel add pin mode' })).toBeVisible();
    await page.getByRole('button', { name: 'Click map' }).click();

    await expect(page.locator('[data-blok-database-drawer]')).toHaveAttribute('data-peek-mode', 'center');
    await expect(page.getByRole('button', { name: 'Enable add pin mode' })).toBeVisible();
    await expect.poll(async () => (await savedRows(page)).map((row) => row.properties['p-title'])).toEqual(['HQ', '5 Avenue Anatole France']);
    expect((await savedRows(page))[1].properties['p-where']).toEqual({
      name: '5 Avenue Anatole France', address: '5 Avenue Anatole France, 75007 Paris, France', lat: 48.85, lon: 2.29,
    });
  });

  test('"No place (1)" lists the row without a place and opens it', async ({ page }) => {
    const data = blocks({ type: 'map' });

    data[0].content = ['r1', 'r2'];
    data.push({ id: 'r2', type: 'database-row', data: { position: 'a1', properties: { 'p-title': 'Nowhere' } } });
    await mount(page, data, 'map');

    await page.getByRole('button', { name: 'No place (1)' }).click();
    await expect(page.getByPlaceholder('Search for a page…')).toBeFocused();
    await page.getByRole('button', { name: 'Nowhere' }).click();

    await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();

    // research/23 §5c: the list stays open under the page. One Escape = one layer.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-drawer]')).toBeHidden();
    await expect(page.getByPlaceholder('Search for a page…')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Search for a page…')).toBeHidden();
  });

  test('a Place cell shows the name and hovers into a card with the address and the host mini-map', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'map');
    const place = cell(page, 'r1', 'p-where');

    await expect(place).toHaveText('Head office');
    await place.hover();

    await expect(page.getByTestId('tooltip-content')).toContainText('Head office');
    await expect(page.getByTestId('tooltip-content')).toContainText('Mini map');
  });

  test('the Place editor links to a Google Maps search in a new tab', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'map');
    await cell(page, 'r1', 'p-where').click();
    const link = page.getByRole('link', { name: 'Open in Google Maps' });

    await expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Head%20office');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);

    await page.context().route('https://www.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>maps</p>' }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);

    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://www.google.com/maps/search/?api=1&query=Head%20office');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  });
});

test.describe('permissions', () => {
  test('without editContent nothing in the table writes: no add row, typing and Delete change nothing', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'readOnlyGate');

    await expect(page.locator('[data-blok-database-table-add-row]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-add-view]')).toHaveCount(0);
    await cell(page, 'r1', 'p-email').click();
    await page.keyboard.type('changed');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Delete');

    expect((await savedRows(page))[0].properties['p-email']).toBe('hq@example.com');
  });
});

test.describe('comments', () => {
  test('a right-click on a cell opens the host\'s comments for it', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }), 'comments');

    await cell(page, 'r1', 'p-email').click({ button: 'right' });

    expect(await page.evaluate(() => window.tier3Log)).toEqual([{ databaseId: 'db-1', rowId: 'r1', propertyId: 'p-email' }]);
  });
});
