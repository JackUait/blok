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

const data = (extra: Partial<DatabaseData> = {}): DatabaseData => ({
  title: 'Tasks',
  schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }],
  views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v1',
  ...extra,
});

const title = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-blok-database-title]');

describe('DatabaseTool — full-page database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hides its own title, since the page title is the title, and keeps the marker on save', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'db', data({ fullPage: true }));

    expect(title(el)?.hidden).toBe(true);
    expect(el.hasAttribute('data-blok-database-page')).toBe(true);
    expect(tool.save(document.createElement('div')).fullPage).toBe(true);
  });

  it('shows its title inline and saves no marker', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'db', data());

    expect(title(el)?.hidden).toBe(false);
    expect(el.hasAttribute('data-blok-database-page')).toBe(false);
    expect(tool.save(document.createElement('div'))).not.toHaveProperty('fullPage');
  });
});
