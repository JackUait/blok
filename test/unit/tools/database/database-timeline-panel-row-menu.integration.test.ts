import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData } from '../../../../src/tools/database/types';
import { SCHEMA, buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';
import type { Doc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const TIMELINE_SCHEMA = [
  ...SCHEMA,
  { id: 'due', name: 'Due', type: 'date' as const, position: 'a3' },
];

const timelineDoc = (): Doc => makeDoc([
  fakeRow('a', 'db', { title: 'Alpha', due: '2026-10-09' }, 'a0'),
  fakeRow('b', 'db', { title: 'Beta', due: '2026-10-10' }, 'a1'),
]);

const timelineData = (): DatabaseData => tableData(TIMELINE_SCHEMA, { type: 'timeline', timelineBy: 'due', showTimelineTable: true });

const panelRow = (el: HTMLElement, rowId: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(`[data-blok-database-timeline-table-row][data-row-id="${rowId}"]`);

  if (found === null) throw new Error('no panel row');

  return found;
};

const titleCell = (el: HTMLElement, rowId: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-blok-database-timeline-table-row][data-row-id="${rowId}"] [data-blok-database-timeline-table-title]`);

const menuItem = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

const rightClick = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 380 }));
};

const pressEscape = (): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** notion-motion.md Round 114 §1 #6: after the panel row's right-click menu closes, focus is on that row's Name cell. */
describe('DatabaseTool — timeline panel row menu: focus after close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Back to keyboard modality, which is the default.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift' }));
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Escape puts focus on the row\'s Name cell', async () => {
    const { el } = buildTool(timelineDoc(), {}, timelineData());

    rightClick(panelRow(el, 'a'));
    expect(menuItem('database-row-duplicate')).not.toBeNull();
    pressEscape();
    await settle();

    expect(titleCell(el, 'a')).toHaveFocus();
  });

  it('Duplicate puts focus on the row\'s Name cell', async () => {
    const { el } = buildTool(timelineDoc(), {}, timelineData());

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    rightClick(panelRow(el, 'a'));
    menuItem('database-row-duplicate')?.click();
    await settle();

    expect(titleCell(el, 'a')).toHaveFocus();
  });

  it('a click away puts focus on the row\'s Name cell', async () => {
    const { el } = buildTool(timelineDoc(), {}, timelineData());
    const away = document.createElement('div');

    document.body.appendChild(away);
    rightClick(panelRow(el, 'a'));
    away.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    away.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    away.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle();

    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(titleCell(el, 'a')).toHaveFocus();
  });

  it('an item that opens something else leaves focus alone', async () => {
    const { el } = buildTool(timelineDoc(), {}, timelineData());

    rightClick(panelRow(el, 'a'));
    menuItem('database-row-copy-link')?.click();
    await settle();

    expect(titleCell(el, 'a')).not.toHaveFocus();
  });
});
