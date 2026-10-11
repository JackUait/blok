import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowMenuItems } from '../../../../src/tools/database/database-table-menus';
import type { RowMenuContext } from '../../../../src/tools/database/database-table-menus';
import { buildTool, fakeRow, makeDoc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const rightClick = (target: Element): MouseEvent => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

const cellOf = (el: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const cell = el.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-cell][data-property-id="${propertyId}"]`);

  if (cell === null) throw new Error('no cell');

  return cell;
};

const menuContext = (onComment?: () => void): RowMenuContext => ({
  i18n: { t: (key: string) => key },
  properties: [],
  onEditIcon: vi.fn(),
  onEditProperty: vi.fn(),
  onOpenIn: vi.fn(),
  onCopyLink: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  ...(onComment !== undefined ? { onComment } : {}),
});

const titles = (items: ReturnType<typeof rowMenuItems>): unknown[] => items.map((item) => ('title' in item ? item.title : item.type));

describe('DatabaseTool — config.comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a right-click on a cell opens the host\'s comments for that cell, inside a declared context-menu owner', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const { el } = buildTool(doc, { comments: { open } });
    const cell = cellOf(el, 'a', 'notes');
    const event = rightClick(cell);

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a', propertyId: 'notes' }, cell);
    expect(event.defaultPrevented).toBe(true);
    // Core's block menu stands down inside the owner (ui.ts), so no stopPropagation is needed.
    expect(cell.closest('[data-blok-context-menu-owner]')).not.toBeNull();
  });

  it('declares no context-menu owner without the comments lever, so core keeps the block menu', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const { el } = buildTool(doc);

    expect(cellOf(el, 'a', 'notes').closest('[data-blok-context-menu-owner]')).toBeNull();
  });

  it('works in read-only, where commenters live', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const { el } = buildTool(doc, { comments: { open } }, undefined, true);

    rightClick(cellOf(el, 'a', 'title'));

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a', propertyId: 'title' }, expect.any(HTMLElement));
  });

  it('leaves the right-click alone without the lever, or when permissions deny comment', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const plain = buildTool(doc).el;
    const denied = buildTool(doc, { comments: { open }, permissions: { can: (action) => action !== 'comment' } }).el;

    expect(rightClick(cellOf(plain, 'a', 'notes')).defaultPrevented).toBe(false);
    expect(rightClick(cellOf(denied, 'a', 'notes')).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('the row menu offers Comment before Copy link only when the host gives comments', () => {
    const onComment = vi.fn();

    expect(titles(rowMenuItems(menuContext()))).not.toContain('tools.database.tableComment');
    const items = rowMenuItems(menuContext(onComment));
    const order = titles(items);

    expect(order.indexOf('tools.database.tableComment')).toBe(order.indexOf('tools.database.tableCopyLink') - 1);
    const comment = items.find((item) => 'title' in item && item.title === 'tools.database.tableComment');

    if (comment === undefined || !('onActivate' in comment) || comment.onActivate === undefined) throw new Error('no Comment item');
    comment.onActivate(comment, undefined);
    expect(onComment).toHaveBeenCalledTimes(1);
  });
});
