import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph, Table } from '../../../../src/tools';
import type { OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
}

const editors: TestEditor[] = [];

/** A table whose first `filled` columns of row 0 hold text; the rest are empty. */
const bootTable = async (rows: number, cols: number, filled = 0): Promise<TestEditor> => {
  const holder = document.createElement('div');
  const ids = Array.from({ length: rows * cols }, (_, i) => `c${i}`);

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: {
      blocks: [
        {
          id: 't',
          type: 'table',
          data: { withHeadings: false, content: Array.from({ length: rows }, (_, r) => ids.slice(r * cols, (r + 1) * cols).map(id => ({ blocks: [id] }))) },
          content: ids,
        },
        ...ids.map((id, i) => ({ id, type: 'paragraph', data: { text: i < filled ? id : '' }, parent: 't' })),
      ],
    },
    tools: { paragraph: { class: Paragraph }, table: { class: Table } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const get = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`no ${selector}`);
  }

  return element;
};

const MODE = '[data-blok-table-fullscreen-size-mode]';
const GRID = '[data-blok-table-fullscreen-size-grid]';
const cell = (col: number, row: number): HTMLElement =>
  get(`[data-blok-table-fullscreen-size-cell][data-col="${col}"][data-row="${row}"]`);

const openCard = (): void => {
  get('[data-blok-table-fullscreen-toggle]').click();
  get('[data-blok-table-fullscreen-size]').click();
};

const tableShape = async (editor: TestEditor): Promise<{ rows: number; cols: number }> => {
  const { blocks } = await editor.save();
  const table = blocks.find(block => block.type === 'table');
  const content = (table?.data as { content: unknown[][] }).content;

  return { rows: content.length, cols: content[0].length };
};

describe('table size card: pick on grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // jsdom has no Web Animations; full screen reads them when it opens and closes.
    if (!('getAnimations' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
    }
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('swaps the steppers for a grid and back with one text button', async () => {
    await bootTable(2, 3);
    openCard();

    const mode = get<HTMLButtonElement>(MODE);
    const stepper = get('[data-blok-table-fullscreen-stepper]');

    expect(mode.textContent?.trim()).toBe('Pick on grid');
    expect(get(GRID).hidden).toBe(true);

    mode.click();

    expect(get(GRID).hidden).toBe(false);
    expect(stepper.closest('[hidden]')).not.toBeNull();
    expect(mode.textContent?.trim()).toBe('Type numbers');
    expect(get(GRID)).toHaveFocus();
    expect(get('[data-blok-table-fullscreen-size-editor]').hidden).toBe(false);

    mode.click();

    expect(get(GRID).hidden).toBe(true);
    expect(stepper.closest('[hidden]')).toBeNull();
    expect(get<HTMLInputElement>('[data-blok-table-fullscreen-size-editor] input')).toHaveFocus();
  });

  it('marks the hovered size and names it, then resizes the table to the clicked cell', async () => {
    const editor = await bootTable(2, 3);

    openCard();
    get(MODE).click();
    cell(5, 4).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(get('[data-blok-table-fullscreen-size-readout]').textContent).toBe('5 × 4');
    expect(cell(5, 4).hasAttribute('data-on')).toBe(true);
    expect(cell(6, 4).hasAttribute('data-on')).toBe(false);

    cell(5, 4).click();

    expect(await tableShape(editor)).toEqual({ rows: 4, cols: 5 });
    expect(get('[data-blok-table-fullscreen-size-editor]').hidden).toBe(true);
    expect(get('[data-blok-table-fullscreen-size]').textContent).toBe('5 × 4');
  });

  it('never drops filled cells: a pick below them stops at them', async () => {
    const editor = await bootTable(2, 3, 3);

    openCard();
    get(MODE).click();
    cell(1, 1).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(get('[data-blok-table-fullscreen-size-readout]').textContent).toBe('3 × 1');
    expect(get('[data-blok-table-fullscreen-size-note]').hidden).toBe(false);

    cell(1, 1).click();

    expect(await tableShape(editor)).toEqual({ rows: 1, cols: 3 });
  });

  it('keeps the cell under the pointer while the window stays put, so its hover holds', async () => {
    await bootTable(2, 3);
    openCard();
    get(MODE).click();

    const target = cell(4, 3);

    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(cell(4, 3)).toBe(target);
  });

  it('offers a fixed 10 × 10 grid that never grows, even from its last cell', async () => {
    await bootTable(2, 3);
    openCard();
    get(MODE).click();

    const count = (): number => document.querySelectorAll('[data-blok-table-fullscreen-size-cell]').length;

    expect(count()).toBe(100);

    cell(10, 10).dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(count()).toBe(100);
    expect(get('[data-blok-table-fullscreen-size-readout]').textContent).toBe('10 × 10');
  });

  it('stops the arrow keys at the grid edge', async () => {
    const editor = await bootTable(9, 9);

    openCard();
    get(MODE).click();

    const grid = get(GRID);

    ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown'].forEach((key) => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

    expect(get('[data-blok-table-fullscreen-size-readout]').textContent).toBe('10 × 10');

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(await tableShape(editor)).toEqual({ rows: 10, cols: 10 });
  });

  it('steps the pick with the arrow keys and applies it with Enter', async () => {
    const editor = await bootTable(2, 3);

    openCard();
    get(MODE).click();

    const grid = get(GRID);

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(get('[data-blok-table-fullscreen-size-readout]').textContent).toBe('4 × 4');

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(await tableShape(editor)).toEqual({ rows: 4, cols: 4 });
  });

  it('opens on the grid next time once the grid was chosen', async () => {
    await bootTable(2, 3);
    openCard();
    get(MODE).click();
    cell(4, 2).click();
    get('[data-blok-table-fullscreen-size]').click();

    expect(get(GRID).hidden).toBe(false);
    expect(get(GRID)).toHaveFocus();
    expect(get(MODE).textContent?.trim()).toBe('Type numbers');
  });

  it('remembers the choice for a new editor too, and goes back to numbers once they are chosen', async () => {
    const first = await bootTable(2, 3);

    openCard();
    get(MODE).click();
    get('[data-blok-table-fullscreen-size-done]').click();
    first.destroy();
    editors.splice(0);
    document.body.innerHTML = '';

    await bootTable(2, 3);
    openCard();

    expect(get(GRID).hidden).toBe(false);

    get(MODE).click();
    get('[data-blok-table-fullscreen-size-done]').click();
    get('[data-blok-table-fullscreen-size]').click();

    expect(get(GRID).hidden).toBe(true);
    expect(get<HTMLInputElement>('[data-blok-table-fullscreen-size-editor] input')).toHaveFocus();
  });

  it('opens on numbers when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await bootTable(2, 3);
    openCard();
    get(MODE).click();
    get('[data-blok-table-fullscreen-size-done]').click();
    get('[data-blok-table-fullscreen-size]').click();

    expect(get(GRID).hidden).toBe(true);
  });
});
