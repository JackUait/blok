/**
 * Every boxed text field shows Notion's focus ring: 2px of solid
 * --blok-focus-ring inside the box, however focus came, with no outer halo.
 * Fields on the shared look are covered by helpers/field.ts; these are the
 * boxes that keep a look of their own.
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

interface Ring {
  ring: string;
  danger: string;
  borderColor: string;
  borderWidth: number;
  shadow: string;
}

const measure = (box: Locator): Promise<Ring> =>
  box.evaluate(element => {
    const probe = document.createElement('span');

    probe.style.borderColor = 'var(--blok-focus-ring)';
    probe.style.color = 'var(--blok-color-red-text)';
    element.parentElement?.append(probe);
    const ring = getComputedStyle(probe).borderTopColor;
    const danger = getComputedStyle(probe).color;

    probe.remove();
    const style = getComputedStyle(element);

    return {
      ring,
      danger,
      borderColor: style.borderTopColor,
      borderWidth: parseFloat(style.borderTopWidth),
      shadow: style.boxShadow,
    };
  });

/** How many px of `color` the box paints at its edge: the border plus an inset shadow. */
const paintedRing = ({ borderColor, borderWidth, shadow }: Ring, color: string): number => {
  const inset = shadow.split(/,(?![^(]*\))/).map(part => part.trim())
    .find(part => part.startsWith(`${color} 0px 0px 0px `) && part.endsWith(' inset'));

  return (borderColor === color ? borderWidth : 0) + (inset === undefined ? 0 : parseFloat(inset.split(' 0px 0px 0px ')[1]));
};

/** Focuses the field with a click and reads the ring its box paints: blue px at the edge, and any visible outer layer. */
const ringOnClick = async (box: Locator, focus: Locator): Promise<{ blue: number; halo: string[] }> => {
  await focus.click();
  await expect(focus).toBeFocused();
  const ring = await measure(box);
  // Tailwind stacks empty transparent layers; only a visible outer layer is a halo.
  const halo = ring.shadow.split(/,(?![^(]*\))/).map(part => part.trim())
    .filter(part => part !== 'none' && !part.includes('inset') && !part.startsWith('rgba(0, 0, 0, 0)'));

  return { blue: paintedRing(ring, ring.ring), halo };
};

const NOTION_RING = { blue: 2, halo: [] };

const DATABASE: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

/** Mounts a database so its lazy sheet loads, then adds bare fields that carry each box's attributes. */
const mountDatabaseFields = async (page: Page): Promise<void> => {
  await page.evaluate(async blocks => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks },
      tools: { database: { class: window.BlokDatabase }, 'database-row': { class: window.BlokDatabaseRow } },
    });
    await window.blokInstance.isReady;

    const fixture = document.createElement('div');

    fixture.setAttribute('data-blok-interface', '');
    fixture.setAttribute('data-blok-popover', '');
    fixture.innerHTML = [
      '<input data-blok-testid="panel-input" data-blok-database-panel-input>',
      '<input data-blok-testid="picker-search" data-blok-database-panel-input data-blok-database-picker-search>',
      '<input data-blok-testid="option-name" data-blok-database-option-name>',
      '<textarea data-blok-testid="autofill" data-blok-database-autofill-instructions></textarea>',
      '<div data-blok-testid="ai-prompt" data-blok-database-ai-prompt><textarea data-blok-testid="ai-prompt-input"></textarea></div>',
      '<input data-blok-testid="tpl-search" data-blok-database-tpl-gallery-search>',
      '<input data-blok-testid="tab-rename" data-blok-database-tab-rename-input>',
      '<div data-blok-database-template-cadence-row><input data-blok-testid="cadence" type="number"></div>',
      '<div data-blok-database-form-question><input data-blok-testid="form-answer" type="text"><textarea data-blok-testid="form-long"></textarea></div>',
      '<div data-blok-database-property-menu-name><input data-blok-testid="property-name" data-blok-database-property-menu-name-input data-blok-field="text"></div>',
      '<div data-blok-database-form-question data-invalid><input data-blok-testid="form-invalid" type="text"></div>',
    ].join('');
    document.body.appendChild(fixture);
  }, DATABASE);
  await expect(page.getByRole('grid')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await gotoTestPage(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
    });

    test('database boxes show the 2px blue ring on click', async ({ page }) => {
      await mountDatabaseFields(page);
      await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);

      for (const id of ['panel-input', 'picker-search', 'option-name', 'autofill', 'tpl-search', 'tab-rename', 'cadence', 'form-answer', 'form-long', 'property-name']) {
        const field = page.getByTestId(id);

        expect(await ringOnClick(field, field), id).toEqual(NOTION_RING);
      }
      expect(await ringOnClick(page.getByTestId('ai-prompt'), page.getByTestId('ai-prompt-input'))).toEqual(NOTION_RING);
    });

    test('an invalid form answer keeps a red ring while focused', async ({ page }) => {
      await mountDatabaseFields(page);
      await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
      const field = page.getByTestId('form-invalid');

      await field.click();
      const ring = await measure(field);

      expect(paintedRing(ring, ring.danger)).toBe(2);
    });

    test('the table size stepper shows the 2px blue ring', async ({ page }) => {
      await mountDatabaseFields(page);
      await page.evaluate(value => {
        document.documentElement.setAttribute('data-blok-theme', value);
        const stepper = document.createElement('span');

        stepper.setAttribute('data-blok-table-fullscreen-stepper', '');
        stepper.setAttribute('data-blok-testid', 'stepper');
        stepper.innerHTML = '<input role="spinbutton" data-blok-testid="stepper-input">';
        document.querySelector('[data-blok-interface]')?.append(stepper);
      }, theme);

      expect(await ringOnClick(page.getByTestId('stepper'), page.getByTestId('stepper-input'))).toEqual(NOTION_RING);
    });

    test('the equation field shows the 2px blue ring and keeps its fill', async ({ page }) => {
      await page.evaluate(async () => {
        const holder = document.createElement('div');
        // Runtime-only bundle: a non-literal specifier keeps it out of compile-time resolution.
        const toolsUrl = '/dist/tools.mjs';
        const tools = await import(toolsUrl) as { Paragraph: unknown; Equation: unknown };

        holder.id = 'blok';
        holder.style.cssText = 'max-width:650px;margin:200px auto 0';
        document.body.appendChild(holder);
        window.blokInstance = new window.Blok({
          holder,
          data: { blocks: [{ type: 'paragraph', data: { text: 'x^2' } }] },
          tools: { paragraph: { class: tools.Paragraph }, equation: { class: tools.Equation } },
        });
        await window.blokInstance.isReady;
      });
      await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
      await page.locator('[contenteditable="true"]').first().click();
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);
      const input = page.getByTestId('inline-equation-input');
      const box = page.locator('[data-blok-equation-tool]');

      await expect(input).toBeFocused();
      await input.blur();
      const rest = await box.evaluate(element => getComputedStyle(element).backgroundColor);

      expect(await ringOnClick(box, input)).toEqual(NOTION_RING);
      expect(await box.evaluate(element => getComputedStyle(element).backgroundColor), 'focus keeps the fill').toBe(rest);
    });

    test('the notifier prompt input shows the 2px blue ring', async ({ page }) => {
      await page.evaluate(async () => {
        const holder = document.createElement('div');

        holder.id = 'blok';
        document.body.appendChild(holder);
        window.blokInstance = new window.Blok({ holder });
        await window.blokInstance.isReady;
        window.blokInstance.notifier.show({ type: 'prompt', message: 'Name it', okHandler: () => undefined });
      });
      const input = page.locator('[data-blok-interface="notifier"] input');

      expect(await ringOnClick(input, input)).toEqual(NOTION_RING);
    });
  });
}
