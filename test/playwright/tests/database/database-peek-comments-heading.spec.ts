/**
 * The side peek's Comments section under the properties, against
 * notion-spec-2 §14.2. Reads rects and computed styles only.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [ { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [ 'p-notes' ] } ],
      activeViewId: 'v1',
    },
    content: [ 'r1' ],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'A', 'p-notes': 'Note' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: BLOCKS });
};

const THEMES = [
  // Notion's heading ink rgb(125, 122, 117) is under 4.5:1 on white; the label token is its AA step.
  { name: 'light' as const, ink: 'rgb(114, 111, 106)', line: 'rgba(55, 53, 47, 0.09)' },
  { name: 'dark' as const, ink: 'rgb(173, 169, 163)', line: 'rgba(255, 255, 255, 0.094)' },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
  });
  await page.emulateMedia({ colorScheme: null });
});

for (const theme of THEMES) {
  test(`the Comments heading and composer sit where Notion draws them, ${theme.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme.name });
    await mount(page);
    const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

    await row.hover();
    await row.locator('[data-blok-database-table-open]').click();
    const drawer = page.locator('[data-blok-database-drawer]');

    await expect(drawer).toHaveCSS('transform', 'none');
    await expect(drawer.locator('[data-blok-database-comments-label]')).toBeVisible();

    const read = await drawer.evaluate((peek) => {
      const round = (n: number): number => Math.round(n * 10) / 10;
      const find = (selector: string): HTMLElement => {
        const el = peek.querySelector<HTMLElement>(selector);

        if (el === null) throw new Error(`no ${selector}`);

        return el;
      };
      const x = peek.getBoundingClientRect().left;
      const section = find('[data-blok-database-comments-section]');
      const label = find('[data-blok-database-comments-label]');
      const composer = find('[data-blok-database-comments-section] [data-blok-database-comment-composer]');
      const avatar = find('[data-blok-database-comments-section] [data-blok-database-comment-composer] > [data-blok-database-comment-avatar]');
      const input = find('[data-blok-database-comments-section] [data-blok-database-comment-input]');
      const add = find('[data-blok-database-drawer-add-prop]');
      const line = section.nextElementSibling;
      const editor = find('[data-blok-database-drawer-editor]');

      if (!(line instanceof HTMLHRElement)) throw new Error('no line under the section');
      const text = document.createRange();

      text.selectNodeContents(label);
      const labelBox = label.getBoundingClientRect();
      const labelStyle = getComputedStyle(label);
      const composerBox = composer.getBoundingClientRect();
      const avatarBox = avatar.getBoundingClientRect();
      const inputStyle = getComputedStyle(input);
      const lineBox = line.getBoundingClientRect();

      return {
        textX: round(text.getBoundingClientRect().left - x),
        label: {
          height: round(labelBox.height),
          padding: labelStyle.padding,
          font: `${labelStyle.fontSize}/${labelStyle.lineHeight} ${labelStyle.fontWeight}`,
          letterSpacing: labelStyle.letterSpacing,
          color: labelStyle.color,
        },
        fromAddRow: round(labelBox.top - add.getBoundingClientRect().bottom),
        composer: { padding: getComputedStyle(composer).padding, top: round(composerBox.top - labelBox.bottom) },
        avatar: { x: round(avatarBox.left - x), size: round(avatarBox.width), fromLabel: round(avatarBox.top - labelBox.bottom) },
        inputTextX: round(input.getBoundingClientRect().left + parseFloat(inputStyle.paddingLeft) - x),
        inputPadding: inputStyle.padding,
        line: { fromComposer: round(lineBox.top - composerBox.bottom), color: getComputedStyle(line).borderTopColor, width: getComputedStyle(line).borderTopWidth },
        bodyFromLine: round(editor.getBoundingClientRect().top - lineBox.bottom),
      };
    });

    expect(read.textX).toBe(84);
    expect(read.label).toEqual({ height: 24, padding: '3px 0px', font: '13px/18px 500', letterSpacing: 'normal', color: theme.ink });
    expect(read.fromAddRow).toBe(20);
    expect(read.composer).toEqual({ padding: '8px 4px 12px 0px', top: 0 });
    expect(read.avatar).toEqual({ x: 84, size: 24, fromLabel: 8 });
    expect(read.inputTextX).toBe(116);
    expect(read.inputPadding).toBe('3.5px 4px 3px');
    // The section's bottom line: right under the composer, then the body 8px below.
    expect(read.line).toEqual({ fromComposer: 0, color: theme.line, width: '1px' });
    expect(read.bodyFromLine).toBe(8);
  });
}
