import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateMenuItems } from '../../../../src/tools/database/database-template-menu';
import type { TemplateMenuHost } from '../../../../src/tools/database/database-template-menu';

interface Item { name?: string; title?: string; isActive?: boolean; onActivate?: () => void; children?: { items?: Item[] } }

const host = (patch: Partial<TemplateMenuHost> = {}): TemplateMenuHost => ({
  i18n: { t: (key: string) => key },
  templates: () => [{ id: 't1', title: 'Bug' }, { id: 't2', title: '' }],
  defaultTemplateId: () => 't1',
  repeatOf: () => undefined,
  newEmpty: vi.fn(),
  newFromTemplate: vi.fn(),
  addTemplate: vi.fn(),
  editTemplate: vi.fn(),
  setDefault: vi.fn(),
  setRepeat: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
  ...patch,
});

const find = (items: Item[] | undefined, ...path: string[]): Item | undefined => {
  let level = items;
  let found: Item | undefined;

  for (const name of path) {
    found = level?.find((item) => item.name === name);
    level = found?.children?.items;
  }

  return found;
};

describe('template menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every template, then an empty page and "New template"', () => {
    const items = templateMenuItems(host()) as Item[];

    expect(items.map((item) => item.name)).toEqual(['template-t1', 'template-t2', 'template-empty', 'template-add']);
    expect(find(items, 'template-t2')?.title).toBe('tools.database.templateUntitled');
  });

  it('makes a row from the template it is picked from', () => {
    const h = host();

    find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-use')?.onActivate?.();

    expect(h.newFromTemplate).toHaveBeenCalledWith('t1');
  });

  it('marks the default with a check and can move it to an empty page', () => {
    const h = host();
    const items = templateMenuItems(h) as Item[];

    expect(find(items, 'template-t1', 'template-t1-default')?.isActive).toBe(true);
    expect(find(items, 'template-t2', 'template-t2-default')?.isActive).toBe(false);
    find(items, 'template-empty', 'template-empty-default')?.onActivate?.();

    expect(h.setDefault).toHaveBeenCalledWith(null);
  });

  it('stores a weekly repeat starting now and turns it off', () => {
    const h = host({ repeatOf: (id) => (id === 't1' ? { frequency: 'daily', start: '2026-10-01T09:00:00.000Z' } : undefined) });
    const items = templateMenuItems(h) as Item[];

    expect(find(items, 'template-t1', 'template-t1-repeat', 'template-t1-repeat-daily')?.isActive).toBe(true);
    find(items, 'template-t2', 'template-t2-repeat', 'template-t2-repeat-weekly')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-repeat', 'template-t1-repeat-off')?.onActivate?.();

    expect(h.setRepeat).toHaveBeenNthCalledWith(1, 't2', expect.objectContaining({ frequency: 'weekly', start: expect.any(String) }));
    expect(h.setRepeat).toHaveBeenNthCalledWith(2, 't1', null);
  });

  it('edits, duplicates and deletes a template', () => {
    const h = host();
    const items = templateMenuItems(h) as Item[];

    find(items, 'template-t1', 'template-t1-edit')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-duplicate')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-delete')?.onActivate?.();

    expect(h.editTemplate).toHaveBeenCalledWith('t1');
    expect(h.duplicate).toHaveBeenCalledWith('t1');
    expect(h.remove).toHaveBeenCalledWith('t1');
  });
});
