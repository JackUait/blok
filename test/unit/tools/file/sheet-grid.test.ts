import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MAX_GRID_CELLS, columnName, mountSheetGrid, type GridSheet } from '../../../../src/tools/file/sheet-grid';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';

const text = (value: string): { text: string; value: null } => ({ text: value, value: null });
const num = (value: number, shown = String(value)): { text: string; value: number } => ({ text: shown, value });

const BUDGET: GridSheet = {
  name: 'Budget',
  rows: [
    [text('Department'), text('Q1'), text('Q2')],
    [text('Engineering'), num(40000, '40,000'), num(43200, '43,200')],
    [text('Platform'), num(46631, '46,631'), num(50211, '50,211')],
    [{ text: 'Total', value: null, bold: true }, num(86631, '86,631')],
  ],
};
const PEOPLE: GridSheet = { name: 'People', rows: [[text('Name')], [text('Amara')]] };

interface Harness {
  container: HTMLElement;
  bar: () => HTMLElement;
  facts: string[][];
  cell: (ref: string) => HTMLElement;
  status: () => string;
  down: (ref: string, init?: MouseEventInit) => void;
  dragTo: (ref: string) => void;
}

function harness(sheets: GridSheet[]): Harness {
  const body = document.createElement('div');
  const container = document.createElement('div');
  body.appendChild(container);
  document.body.appendChild(body);
  const slots: { bar: HTMLElement | null } = { bar: null };
  const facts: string[][] = [];
  const chrome: PreviewChrome = {
    ...detachedChrome(body),
    setFacts: (next) => facts.push(next),
    setBar: (bar) => { slots.bar = bar; },
  };
  mountSheetGrid(container, sheets, chrome);
  const bar = (): HTMLElement => {
    if (slots.bar === null) {
      throw new Error('no bar');
    }

    return slots.bar;
  };
  const cell = (ref: string): HTMLElement => {
    const found = container.querySelector<HTMLElement>(`td[data-ref="${ref}"]`);
    if (found === null) {
      throw new Error(`no cell ${ref}`);
    }

    return found;
  };

  return {
    container, bar, facts, cell,
    status: () => bar().querySelector('[data-role="file-preview-grid-status"]')?.textContent ?? '',
    down: (ref, init = {}) => cell(ref).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, buttons: 1, ...init })),
    dragTo: (ref) => cell(ref).dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 })),
  };
}

describe('columnName', () => {
  it.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [27, 'AB'], [701, 'ZZ'], [702, 'AAA']])('names column %d as %s', (index, name) => {
    expect(columnName(index)).toBe(name);
  });
});

describe('mountSheetGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('letters the columns and numbers the rows', () => {
    const h = harness([BUDGET]);

    const letters = Array.from(h.container.querySelectorAll('thead th[data-col]')).map((th) => th.textContent);
    const numbers = Array.from(h.container.querySelectorAll('tbody th')).map((th) => th.textContent);
    expect(letters).toEqual(['A', 'B', 'C']);
    expect(numbers).toEqual(['1', '2', '3', '4']);
  });

  it('pads a short row to the width of the sheet', () => {
    const h = harness([BUDGET]);

    expect(h.cell('C4').textContent).toBe('');
  });

  it('shows the formatted text and right-aligns numbers', () => {
    const h = harness([BUDGET]);

    expect(h.cell('B2').textContent).toBe('40,000');
    expect(h.cell('B2').classList.contains('blok-file-preview-xlsx-num')).toBe(true);
    expect(h.cell('A2').classList.contains('blok-file-preview-xlsx-num')).toBe(false);
  });

  it('marks the first row as the frozen header and a bold cell as bold', () => {
    const h = harness([BUDGET]);

    expect(h.cell('A1').parentElement?.hasAttribute('data-grid-head')).toBe(true);
    expect(h.cell('A2').parentElement?.hasAttribute('data-grid-head')).toBe(false);
    expect(h.cell('A4').hasAttribute('data-bold')).toBe(true);
    expect(h.cell('A3').hasAttribute('data-bold')).toBe(false);
  });

  it('starts with A1 selected and no totals', () => {
    const h = harness([BUDGET]);

    expect(h.status()).toBe('A1');
  });

  it('selects the cell that is pressed', () => {
    const h = harness([BUDGET]);
    h.down('B2');

    expect(h.status()).toBe('B2');
    expect(h.cell('B2').style.boxShadow).not.toBe('');
    expect(h.cell('A1').style.boxShadow).toBe('');
  });

  it('sums, averages and counts the numbers in a dragged range', () => {
    const h = harness([BUDGET]);
    h.down('B2');
    h.dragTo('C3');

    // 40000 + 43200 + 46631 + 50211
    expect(h.status()).toBe(`B2:C3Sum ${(180042).toLocaleString()}Average ${(45010.5).toLocaleString()}Count 4`);
  });

  it('leaves text cells out of the totals', () => {
    const h = harness([BUDGET]);
    h.down('A2');
    h.dragTo('B3');

    expect(h.status()).toBe(`A2:B3Sum ${(86631).toLocaleString()}Average ${(43315.5).toLocaleString()}Count 2`);
  });

  it('shows no totals for a range without numbers', () => {
    const h = harness([BUDGET]);
    h.down('A1');
    h.dragTo('A3');

    expect(h.status()).toBe('A1:A3');
  });

  it('normalises a range dragged up and to the left', () => {
    const h = harness([BUDGET]);
    h.down('C3');
    h.dragTo('B2');

    expect(h.status().startsWith('B2:C3')).toBe(true);
  });

  it('extends the selection from its anchor on a shift press', () => {
    const h = harness([BUDGET]);
    h.down('B2');
    h.down('C3', { shiftKey: true });

    expect(h.status().startsWith('B2:C3')).toBe(true);
  });

  it('ignores a pointer that moves without a pressed button', () => {
    const h = harness([BUDGET]);
    h.down('B2');
    h.cell('C3').dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));

    expect(h.status()).toBe('B2');
  });

  it('tints the cells of a range and outlines only its outer edge', () => {
    const h = harness([BUDGET]);
    h.down('A1');
    h.dragTo('C3');

    expect(h.cell('B2').hasAttribute('data-selected')).toBe(true);
    expect(h.cell('B2').style.boxShadow).toBe('');
    expect(h.cell('A1').style.boxShadow.split('inset').length - 1).toBe(2);
    expect(h.cell('B1').style.boxShadow.split('inset').length - 1).toBe(1);
    expect(h.cell('A4').hasAttribute('data-selected')).toBe(false);
  });

  it('clears the old range when a new cell is pressed', () => {
    const h = harness([BUDGET]);
    h.down('A1');
    h.dragTo('C3');
    h.down('B4');

    expect(h.cell('B2').hasAttribute('data-selected')).toBe(false);
    expect(h.cell('A1').style.boxShadow).toBe('');
    // A single cell is outlined, not tinted.
    expect(h.cell('B4').hasAttribute('data-selected')).toBe(false);
  });

  it('lights the letters and numbers of the selected range', () => {
    const h = harness([BUDGET]);
    h.down('B2');
    h.dragTo('C3');

    const lit = Array.from(h.container.querySelectorAll('th[data-active]')).map((th) => th.textContent);
    expect(lit).toEqual(['B', 'C', '2', '3']);
  });

  it('gives every sheet a tab and shows the first one', () => {
    const h = harness([BUDGET, PEOPLE]);

    const tabs = Array.from(h.bar().querySelectorAll<HTMLElement>('[data-action="preview-sheet"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Budget', 'People']);
    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(h.cell('A1').textContent).toBe('Department');
  });

  it('switches sheet on a tab click and starts again at A1', () => {
    const h = harness([BUDGET, PEOPLE]);
    h.down('B2');
    h.bar().querySelectorAll<HTMLElement>('[data-action="preview-sheet"]')[1].click();

    expect(h.cell('A2').textContent).toBe('Amara');
    expect(h.container.querySelector('td[data-ref="B2"]')).toBeNull();
    expect(h.status()).toBe('A1');
    const tabs = Array.from(h.bar().querySelectorAll('[data-action="preview-sheet"]'));
    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('reports the sheet count as a header fact', () => {
    expect(harness([BUDGET, PEOPLE]).facts).toEqual([['2 sheets']]);
    expect(harness([BUDGET]).facts).toEqual([['1 sheet']]);
  });

  it('writes cell text as text, never as markup', () => {
    const h = harness([{ name: 'x', rows: [[text('<b>x</b>')]] }]);

    expect(h.cell('A1').textContent).toBe('<b>x</b>');
    expect(h.cell('A1').querySelector('b')).toBeNull();
  });

  it('never draws more cells than the cap, however far one wide row pads the others', () => {
    // 400 one-cell rows under a 1000-cell row: padded, that is 401,000 cells.
    const wide = Array.from({ length: 1000 }, () => text('w'));
    const h = harness([{ name: 'x', rows: [wide, ...Array.from({ length: 400 }, () => [text('n')])] }]);

    expect(h.container.querySelectorAll('td').length).toBeLessThanOrEqual(MAX_GRID_CELLS);
    // Whole rows are kept: 50 rows of 1000 cells.
    expect(h.container.querySelectorAll('tbody tr')).toHaveLength(50);
  });

  it('shows an empty grid for a workbook with no sheets', () => {
    const h = harness([]);

    expect(h.container.querySelector('td')).toBeNull();
    expect(h.facts).toEqual([]);
  });
});
