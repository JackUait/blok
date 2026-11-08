// spec: highlight rules paint where their ranges land, and cost nothing elsewhere
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { countStyled, STYLE_MARK_END, STYLE_MARK_START } from '../helpers/style-trace';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
/** Highlights whose ranges stay inside editing hosts. */
const EDITOR_HIGHLIGHTS = [ 'blok-cross-block-selection', 'blok-assistant-selection', 'blok-page-mention-query' ];

const mount = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(container);

    const classes = (window as unknown as Record<string, Record<string, unknown>>).Blok;
    const blok = new window.Blok({ holder, data: blocks, tools: { table: { class: classes.Table } } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks: data });
};

/** Registers `name` over the text of `target` and says whether the pixels changed. */
const paints = async (target: Locator, name: string): Promise<boolean> => {
  const before = await target.screenshot();

  await target.evaluate((element, highlight) => {
    const range = document.createRange();

    range.selectNodeContents(element);
    CSS.highlights.set(highlight, new Highlight(range));
  }, name);
  const after = await target.screenshot();

  await target.evaluate((_, highlight) => CSS.highlights.delete(highlight), name);

  return !before.equals(after);
};

/**
 * Restyles every element in the table box, as a theme switch would. The marks
 * keep a restyle the page runs on its own, like a lazy sheet landing, out of the count.
 */
const restyleTable = (page: Page): Promise<void> =>
  page.locator(TABLE_SELECTOR).evaluate((table, [start, end]) => {
    const box = table.closest<HTMLElement>('[data-blok-element-content]');

    console.timeStamp(start);
    box?.style.setProperty('--blok-test-restyle', String(Math.random()));
    document.body.getBoundingClientRect();
    console.timeStamp(end);
  }, [STYLE_MARK_START, STYLE_MARK_END]);

/** Turns the editor highlight rules off or back on, in place. */
const toggleEditorHighlightRules = (page: Page, off: boolean): Promise<void> =>
  page.evaluate(({ names, disable }) => {
    const rules = (list: CSSRuleList): CSSStyleRule[] => [ ...list ].flatMap(rule => {
      if (rule instanceof CSSStyleRule) {
        return [ rule, ...rules(rule.cssRules) ];
      }

      return 'cssRules' in rule && rule.cssRules instanceof CSSRuleList ? rules(rule.cssRules) : [];
    });
    const saved = new Map<CSSStyleRule, string>();
    const store = window as unknown as { highlightRules?: Map<CSSStyleRule, string> };

    if (disable) {
      [ ...document.styleSheets ].flatMap(sheet => rules(sheet.cssRules))
        .filter(rule => names.some(name => rule.selectorText.includes(`::highlight(${name})`)))
        .forEach((rule) => {
          const target: CSSStyleRule = rule;

          saved.set(target, target.selectorText);
          target.selectorText = '[data-blok-testid="never-matches"]';
        });
      store.highlightRules = saved;
    } else {
      store.highlightRules?.forEach((text, rule) => {
        const target: CSSStyleRule = rule;

        target.selectorText = text;
      });
    }
    document.body.getBoundingClientRect();
  }, { names: EDITOR_HIGHLIGHTS, disable: off });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('Highlight rules', () => {
  for (const name of EDITOR_HIGHLIGHTS) {
    test(`${name} paints bold text in a table cell`, async ({ page }) => {
      await mount(page, {
        blocks: [{ id: 'tbl', type: 'table', data: { withHeadings: false, content: [[ 'plain <b>Bold run</b>', 'x' ]] } }],
      });

      expect(await paints(page.locator(TABLE_SELECTOR).getByText('Bold run'), name)).toBe(true);
    });
  }

  test('blok-database-search-match paints a database cell', async ({ page }) => {
    await mount(page, {
      blocks: [
        {
          id: 'db-1',
          type: 'database',
          data: {
            schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
            views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: 'v1',
          },
          content: [ 'r1' ],
        },
        { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha row' } } },
      ],
    });
    const cell = page.getByRole('grid').first().getByText('Alpha row');

    await expect(cell).toBeVisible();
    expect(await paints(cell, 'blok-database-search-match')).toBe(true);
  });

  test('editor highlight rules add fewer styles than the table holds when it restyles', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await mount(page, {
      blocks: [{ id: 'tbl', type: 'table', data: { withHeadings: true, content: Array.from({ length: 40 }, () => Array.from({ length: 30 }, () => '')) } }],
    });
    const elements = await page.locator(TABLE_SELECTOR).evaluate(table => table.closest('[data-blok-element-content]')?.querySelectorAll('*').length ?? 0);

    const withRules = await countStyled(page, () => restyleTable(page), { marked: true });

    await toggleEditorHighlightRules(page, true);
    const withoutRules = await countStyled(page, () => restyleTable(page), { marked: true });

    await toggleEditorHighlightRules(page, false);

    // Matching every element, the three rules add three styles per element.
    expect(withRules - withoutRules).toBeLessThan(elements);
  });
});
