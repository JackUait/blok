import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableAddControls } from '../../../../src/tools/table/table-add-controls';
import type { I18n } from '../../../../types/api';

/**
 * Regression for M9: the drag add/remove loop decremented addedCount on every
 * remove step even when the remove callback was a guarded no-op (e.g. the last
 * column is non-empty). Dragging back past the origin drove addedCount
 * negative, so a subsequent rightward drag re-added phantom columns. The drag
 * may only manage the columns IT added, so targetCount must never go below 0.
 */
describe('TableAddControls drag counter never goes negative', () => {
  let controls: TableAddControls | undefined;

  const fakeI18n = { t: (key: string) => key } as unknown as I18n;

  const pointer = (type: string, clientX: number): Event =>
    Object.assign(new Event(type, { bubbles: true }), { clientX, clientY: 0, pointerId: 1 });

  afterEach(() => {
    controls?.destroy?.();
    controls = undefined;
    document.body.innerHTML = '';
  });

  it('does not re-add phantom columns after dragging back past the origin', () => {
    const wrapper = document.createElement('div');
    const grid = document.createElement('div');

    document.body.appendChild(wrapper);

    const onDragAddCol = vi.fn(() => true);
    // Guarded no-op: simulates "can't remove the non-empty last column".
    const onDragRemoveCol = vi.fn(() => false);

    controls = new TableAddControls({
      wrapper,
      grid,
      i18n: fakeI18n,
      onAddRow: vi.fn(),
      onAddColumn: vi.fn(),
      onDragStart: vi.fn(),
      onDragAddRow: vi.fn(() => true),
      onDragRemoveRow: vi.fn(() => false),
      onDragAddCol,
      onDragRemoveCol,
      onDragEnd: vi.fn(),
      getTableSize: () => ({ rows: 1, cols: 1 }),
      getNewColumnWidth: () => 100,
    });

    const btn = wrapper.querySelector<HTMLElement>('[data-blok-table-add-col]');

    if (!btn) {
      throw new Error('add-col button not rendered');
    }

    btn.setPointerCapture = (): void => {};
    btn.releasePointerCapture = (): void => {};

    // Drag right: +250px / 100 => add 2 columns.
    btn.dispatchEvent(pointer('pointerdown', 0));
    btn.dispatchEvent(pointer('pointermove', 250));

    expect(onDragAddCol).toHaveBeenCalledTimes(2);

    // Drag far back left past the origin. The remove is guarded (returns false),
    // so the loop must STOP without decrementing the counter — not run away
    // driving addedCount negative.
    btn.dispatchEvent(pointer('pointermove', -300));

    // Drag right again. Because the counter stayed at 2 (the guarded removes did
    // not change it), no PHANTOM columns are re-added.
    btn.dispatchEvent(pointer('pointermove', 150));

    expect(onDragAddCol).toHaveBeenCalledTimes(2);
  });
});
