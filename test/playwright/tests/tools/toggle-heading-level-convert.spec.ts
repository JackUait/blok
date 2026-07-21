import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Regression: converting a TOGGLE HEADING to a TOGGLE HEADING of another level
 * via the "Turn into" menu must keep its children nested (and alive). The
 * toggle affordance survives on both sides of the conversion, so there is no
 * reason for the children to be released — and certainly not deleted.
 */

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

const openBlockTunes = async (page: Page, hasText: string): Promise<void> => {
  const block = page.getByTestId('block-wrapper').filter({ hasText }).first();

  await expect(block).toBeVisible();
  await block.click();
  await block.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible();
};

const save = async (page: Page): Promise<OutputData | undefined> =>
  page.evaluate(async () => window.blokInstance?.save());

test.describe('toggle heading level conversion keeps children', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('turning a toggle heading into a toggle heading of another level keeps its children nested', async ({ page }) => {
    // Surface the stranded-holder invariant gate: if any mutation strands a
    // block's holder in detached DOM, the gate throws (pageerror) or the error
    // is caught and warned (console). Either way this test must see it.
    const invariantErrors: string[] = [];

    page.on('pageerror', (err) => invariantErrors.push(err.message));
    page.on('console', (msg) => {
      if ((msg.type() === 'warning' || msg.type() === 'error') && /stranded|invariant violated/i.test(msg.text())) {
        invariantErrors.push(msg.text());
      }
    });
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    await openBlockTunes(page, 'Toggle parent');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    const toggleH3Entry = page
      .locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`)
      .filter({ hasText: 'Toggle heading 3' })
      .first();

    await expect(toggleH3Entry).toBeVisible();
    await toggleH3Entry.click();

    const saved = await save(page);
    const blocks = saved?.blocks ?? [];

    const parent = blocks.find(b => b.data.text === 'Toggle parent');

    expect(parent?.data.level).toBe(3);
    expect(parent?.data.isToggleable).toBe(true);

    // The child must survive the conversion…
    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(child).toBeDefined();
    // …and stay NESTED under the converted toggle heading.
    expect(child?.parent).toBe('toggle-h');

    // The child must remain VISIBLE in the editor after the conversion…
    await expect(page.getByText('Nested child')).toBeVisible();

    // …and inside the toggle heading's children container.
    const childInContainer = page.locator('[data-blok-toggle-children]').getByText('Nested child');

    await expect(childInContainer).toBeVisible();

    // Reload cycle: re-create the editor from the saved data — the child must come back.
    await createBlok(page, saved as OutputData);
    await expect(page.getByText('Nested child')).toBeVisible();

    const resaved = await save(page);
    const resavedChild = (resaved?.blocks ?? []).find(b => b.data.text === 'Nested child');

    expect(resavedChild).toBeDefined();
    expect(resavedChild?.parent).toBe('toggle-h');

    // No stranded-holder invariant violations may have fired along the way.
    expect(invariantErrors).toEqual([]);
  });

  test('undo after toggle-heading → toggle-heading conversion restores everything', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    await openBlockTunes(page, 'Toggle parent');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');
    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    const toggleH3Entry = page
      .locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`)
      .filter({ hasText: 'Toggle heading 3' })
      .first();

    await expect(toggleH3Entry).toBeVisible();
    await toggleH3Entry.click();

    await expect(page.getByText('Nested child')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');

    // After undo the heading is back to level 2 and the child is still alive and nested.
    const saved = await save(page);
    const blocks = saved?.blocks ?? [];
    const parent = blocks.find(b => b.data.text === 'Toggle parent');
    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(parent?.data.level).toBe(2);
    expect(child).toBeDefined();
    expect(child?.parent).toBe('toggle-h');
    await expect(page.getByText('Nested child')).toBeVisible();
  });

  test('turning a COLLAPSED toggle heading into a toggle heading of another level keeps its children', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: false }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    await openBlockTunes(page, 'Toggle parent');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');
    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    const toggleH3Entry = page
      .locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`)
      .filter({ hasText: 'Toggle heading 3' })
      .first();

    await expect(toggleH3Entry).toBeVisible();
    await toggleH3Entry.click();

    const saved = await save(page);
    const blocks = saved?.blocks ?? [];
    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(child).toBeDefined();
    expect(child?.parent).toBe('toggle-h');
  });

  test('changing the level via the direct "Heading N" tune entry keeps children', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    await openBlockTunes(page, 'Toggle parent');

    const headingSubmenu = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-item-name="header-levels"]`);

    await headingSubmenu.dispatchEvent('mouseover');

    const levelEntry = page.locator(`${NESTED_POPOVER} [data-blok-header-level="3"]`);

    await expect(levelEntry).toBeVisible();
    await levelEntry.click();

    const saved = await save(page);
    const blocks = saved?.blocks ?? [];
    const parent = blocks.find(b => b.data.text === 'Toggle parent');

    expect(parent?.data.level).toBe(3);
    expect(parent?.data.isToggleable).toBe(true);

    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(child).toBeDefined();
    expect(child?.parent).toBe('toggle-h');
  });

  test('slash-menu conversion of an emptied toggle heading keeps children', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    // Focus the empty toggle heading and open the slash menu.
    const heading = page.getByRole('heading', { level: 2 }).first();

    await heading.click();
    await page.keyboard.type('/');

    const toolboxItem = page
      .locator('[data-blok-testid="popover-item"]')
      .filter({ hasText: 'Toggle heading 3' })
      .first();

    await expect(toolboxItem).toBeVisible();
    await toolboxItem.click();

    const saved = await save(page);
    const blocks = saved?.blocks ?? [];
    const parent = blocks.find(b => b.data.isToggleable === true);

    expect(parent?.data.level).toBe(3);

    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(child).toBeDefined();
    expect(child?.parent).toBe(parent?.id);
  });
});
