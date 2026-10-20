import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
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

type MenuItem = { name?: string; title?: string; onActivate?: () => void };

const popovers = vi.hoisted(() => ({ items: [] as unknown[][] }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: unknown[] } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const data = (extra: Partial<DatabaseData> = {}): DatabaseData => ({
  title: 'Tasks',
  schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }],
  views: [
    { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
    { id: 'v2', name: 'Board', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
  ],
  activeViewId: 'v1',
  ...extra,
});

const isMenuItem = (item: unknown): item is MenuItem => typeof item === 'object' && item !== null;

/** Opens the active tab's menu and returns its "Hide / Show data source titles" item. */
const titlesItem = (el: HTMLElement): MenuItem | undefined => {
  popovers.items.length = 0;
  el.querySelector('[data-blok-database-tab][data-view-id="v1"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

  return popovers.items.flat().filter(isMenuItem).find((item) => item.name === 'database-view-data-source-titles');
};

const title = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-blok-database-title]');

describe('DatabaseTool — "Hide data source titles" (research/23 §10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hides the title line for every view and saves it on the database', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'db', data());

    expect(title(el)?.hidden).toBe(false);
    const item = titlesItem(el);

    expect(item?.title).toBe('tools.database.hideDataSourceTitles');
    item?.onActivate?.();

    expect(title(el)?.hidden).toBe(true);
    expect(tool.save(document.createElement('div')).hideDataSourceTitles).toBe(true);
    el.querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="v2"]')?.click();
    expect(title(el)?.hidden).toBe(true);
  });

  it('"Show data source titles" brings the line back and drops the key', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'db', data({ hideDataSourceTitles: true }));

    expect(title(el)?.hidden).toBe(true);
    const item = titlesItem(el);

    expect(item?.title).toBe('tools.database.showDataSourceTitles');
    item?.onActivate?.();

    expect(title(el)?.hidden).toBe(false);
    expect('hideDataSourceTitles' in tool.save(document.createElement('div'))).toBe(false);
  });

  it('follows the saved flag when data is set again, as undo and peers do', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'db', data());

    tool.setData(data({ hideDataSourceTitles: true }));
    expect(title(el)?.hidden).toBe(true);
    tool.setData(data());
    expect(title(el)?.hidden).toBe(false);
  });
});
