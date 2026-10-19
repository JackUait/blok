import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/database-model';
import { buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

// The harness builds the tool as block 'db', so a relation to 'db' is a self-relation.
const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'rel', name: 'Blocked by', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db' } },
];

const built: Array<{ destroy: () => void }> = [];

const columns = (el: HTMLElement): Record<string, string> => Object.fromEntries(
  [...el.querySelectorAll<HTMLElement>('[data-blok-database-column]')].map((column) => [
    column.getAttribute('data-option-id') ?? '',
    column.querySelector('[data-blok-database-column-title], [data-blok-database-no-value-label]')?.textContent ?? '',
  ])
);

const cardsIn = (el: HTMLElement, key: string): string[] =>
  [...el.querySelectorAll(`[data-blok-database-column][data-option-id="${key}"] [data-blok-database-card]`)]
    .map((card) => card.getAttribute('data-row-id') ?? '');

// Ledger D29 (bbaabade, labels d2d5a169 · index.ts:4429): a board grouped by relation shows a column per related page.
describe('DatabaseTool — board grouped by a relation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('names each column after its related page, "Untitled" for a page with no title, and shows a card under every page it relates to', () => {
    const doc = makeDoc([
      fakeRow('a', 'db', { title: 'Alpha', rel: [{ id: 'b' }, { id: 'c' }] }, 'a0'),
      fakeRow('b', 'db', { title: 'Bravo' }, 'a1'),
      fakeRow('c', 'db', { title: '' }, 'a2'),
      fakeRow('d', 'db', { title: 'Delta' }, 'a3'),
    ]);
    const { tool, el } = buildTool(doc, {}, tableData(SCHEMA, { type: 'board', groupBy: 'rel', visibleProperties: ['title'] }));

    built.push(tool);

    expect(columns(el)).toEqual({
      a: 'Alpha',
      b: 'Bravo',
      c: 'tools.database.relationUntitled',
      [NO_VALUE_GROUP_KEY]: 'tools.database.noValueGroup',
    });
    expect(cardsIn(el, 'b')).toEqual(['a']);
    expect(cardsIn(el, 'c')).toEqual(['a']);
    // A one-way self-relation also shows who points back (computed-properties.ts:220), so b and c sit under Alpha.
    expect(cardsIn(el, 'a')).toEqual(['b', 'c']);
    expect(cardsIn(el, NO_VALUE_GROUP_KEY)).toEqual(['d']);
  });
});
