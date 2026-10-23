import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseFeedView } from '../../../../src/tools/database/database-feed-view';
import type { FeedViewOptions } from '../../../../src/tools/database/database-feed-view';
import type { DatabaseData, DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];
const view: DatabaseViewConfig = { id: 'v1', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const render = (rows: DatabaseRow[], handlers: Partial<FeedViewOptions['handlers']> = {}): HTMLElement => new DatabaseFeedView({
  view,
  schema,
  rows,
  total: rows.length,
  titlePropertyId: 'p-title',
  i18n: { t: (key: string) => key },
  locale: 'en-US',
  bodyOf: () => [],
  handlers: { openRow: vi.fn(), loadMore: vi.fn(), ...handlers },
}).createView();

const tile = (el: HTMLElement): HTMLButtonElement | null => el.querySelector('[data-blok-database-feed-new]');

describe('empty Feed "+ New page" tile (findings-creation N20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a "New page" tile in an empty feed that adds a post', () => {
    const addRow = vi.fn();
    const el = render([], { addRow });

    expect(tile(el)?.textContent?.trim()).toBe('tools.database.layoutNewPage');
    tile(el)?.click();
    expect(addRow).toHaveBeenCalledTimes(1);
  });

  it('shows no tile when the feed cannot add a post', () => {
    expect(tile(render([]))).toBeNull();
  });

  it('shows no tile once the feed has posts (Notion was measured empty only)', () => {
    expect(tile(render([{ id: 'r1', position: 'a0', properties: { 'p-title': 'Hi' } }], { addRow: vi.fn() }))).toBeNull();
  });

  it('adds a row from a fresh Feed database', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const data: DatabaseData = { title: '', schema, views: [view], activeViewId: 'v1' };
    const { el } = buildDatabase(doc, 'db', data);
    const rowCount = (): number => [...doc.blocks.values()].filter((block) => block.name === 'database-row').length;

    expect(rowCount()).toBe(0);
    tile(el)?.click();
    expect(rowCount()).toBe(1);
  });
});
