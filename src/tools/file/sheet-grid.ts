import { barButton, barSpacer, buildBar, type PreviewChrome } from './preview-chrome';
import { counted } from './preview-labels';

export interface GridCell {
  /** What the cell shows. */
  text: string;
  /** Its number, when it holds one. Totals read this, not the text. */
  value: number | null;
  bold?: boolean;
}

export interface GridSheet {
  name: string;
  rows: GridCell[][];
}

type Point = [row: number, column: number];

/**
 * Most cells one sheet draws. Short rows are padded to the widest one, so the
 * drawn count is rows × width, not the number of cells the file holds.
 */
export const MAX_GRID_CELLS = 50_000;

const EDGE_COLOR = 'var(--blok-text-primary)';
const EDGE = '1.5px';

/** Spreadsheet letters for a 0-based column: A…Z, AA, AB… */
export function columnName(index: number): string {
  const rest = Math.floor(index / 26) - 1;

  return (rest >= 0 ? columnName(rest) : '') + String.fromCharCode(65 + (index % 26));
}

const ref = ([row, column]: Point): string => `${columnName(column)}${row + 1}`;

/**
 * A read-only spreadsheet in `container`: lettered columns, numbered rows, a
 * frozen first row, drag-to-select, and a status bar with the sheet tabs and
 * the Sum, Average and Count of the selected numbers. Only the open sheet is
 * in the DOM. `tabs: false` (a one-table file) leaves out the tabs and the
 * sheet count. Returns the status bar, or null when there is no sheet.
 */
export function mountSheetGrid(
  container: HTMLElement,
  sheets: GridSheet[],
  chrome: PreviewChrome,
  opts: { tabs?: boolean } = {},
): HTMLElement | null {
  const { labels } = chrome;
  const view = document.createElement('div');
  view.className = 'blok-file-preview-grid-view';
  view.setAttribute('data-role', 'file-preview-grid');
  const table = document.createElement('table');
  table.className = 'blok-file-preview-grid';
  view.appendChild(table);
  container.appendChild(view);
  if (sheets.length === 0) {
    return null;
  }

  const status = document.createElement('span');
  status.className = 'blok-file-preview-grid-status';
  status.setAttribute('data-role', 'file-preview-grid-status');

  const state: {
    sheet: GridSheet;
    cells: HTMLTableCellElement[][];
    columnHeads: HTMLElement[];
    rowHeads: HTMLElement[];
    anchor: Point;
    focus: Point;
    painted: HTMLElement[];
  } = { sheet: sheets[0], cells: [], columnHeads: [], rowHeads: [], anchor: [0, 0], focus: [0, 0], painted: [] };

  const statusItem = (label: string, value: string): HTMLElement => {
    const item = document.createElement('span');
    item.className = 'blok-file-preview-bar-text';
    const strong = document.createElement('b');
    strong.textContent = value;
    item.append(label === '' ? '' : `${label} `, strong);

    return item;
  };

  const paint = (): void => {
    const top = Math.min(state.anchor[0], state.focus[0]);
    const bottom = Math.max(state.anchor[0], state.focus[0]);
    const left = Math.min(state.anchor[1], state.focus[1]);
    const right = Math.max(state.anchor[1], state.focus[1]);
    const single = top === bottom && left === right;

    for (const cell of state.painted.splice(0)) {
      cell.removeAttribute('data-selected');
      cell.removeAttribute('data-active');
      cell.style.removeProperty('box-shadow');
    }
    const numbers: number[] = [];
    const paintCell = (cell: HTMLElement, row: number, column: number): void => {
      const value = state.sheet.rows[row]?.[column]?.value ?? null;
      if (value !== null) {
        numbers.push(value);
      }
      // Inset shadows draw the outline, so the cell box never changes size.
      const edges = [
        row === top ? `inset 0 ${EDGE} ${EDGE_COLOR}` : '',
        row === bottom ? `inset 0 -${EDGE} ${EDGE_COLOR}` : '',
        column === left ? `inset ${EDGE} 0 ${EDGE_COLOR}` : '',
        column === right ? `inset -${EDGE} 0 ${EDGE_COLOR}` : '',
      ].filter((edge) => edge !== '');
      if (edges.length > 0) {
        cell.style.setProperty('box-shadow', edges.join(', '));
      }
      if (!single) {
        cell.setAttribute('data-selected', '');
      }
      state.painted.push(cell);
    };
    state.cells.slice(top, bottom + 1).forEach((row, r) => {
      row.slice(left, right + 1).forEach((cell, c) => paintCell(cell, top + r, left + c));
    });
    for (const head of [...state.columnHeads.slice(left, right + 1), ...state.rowHeads.slice(top, bottom + 1)]) {
      head.setAttribute('data-active', '');
      state.painted.push(head);
    }

    const address = single ? ref([top, left]) : `${ref([top, left])}:${ref([bottom, right])}`;
    const items = [statusItem('', address)];
    if (!single && numbers.length > 0) {
      const sum = numbers.reduce((total, value) => total + value, 0);
      const show = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      items.push(
        statusItem(labels.sum, show(sum)),
        statusItem(labels.average, show(sum / numbers.length)),
        statusItem(labels.count, String(numbers.length)),
      );
    }
    status.replaceChildren(...items);
  };

  const pointOf = (target: EventTarget | null): Point | null => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('td[data-ref]') : null;
    if (cell === null || !table.contains(cell)) {
      return null;
    }

    return [Number(cell.dataset.row), Number(cell.dataset.column)];
  };

  table.addEventListener('pointerdown', (event) => {
    const point = pointOf(event.target);
    if (point === null) {
      return;
    }
    if (!event.shiftKey) {
      state.anchor = point;
    }
    state.focus = point;
    paint();
  });
  // A touch drag scrolls the sheet; only a pressed mouse or pen extends the range.
  table.addEventListener('pointermove', (event) => {
    if (event.buttons !== 1 || event.pointerType === 'touch') {
      return;
    }
    const point = pointOf(event.target);
    if (point !== null && (point[0] !== state.focus[0] || point[1] !== state.focus[1])) {
      state.focus = point;
      paint();
    }
  });

  const tabs = sheets.map((sheet, index) => barButton(sheet.name, 'preview-sheet', () => open(index), { pressed: index === 0 }));

  const open = (index: number): void => {
    const full = sheets[index];
    const width = full.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const sheet = { name: full.name, rows: full.rows.slice(0, Math.floor(MAX_GRID_CELLS / Math.max(1, width))) };
    const head = document.createElement('thead');
    const letters = document.createElement('tr');
    letters.appendChild(document.createElement('th'));
    state.columnHeads = Array.from({ length: width }, (_, column) => {
      const th = document.createElement('th');
      th.setAttribute('data-col', '');
      th.textContent = columnName(column);
      letters.appendChild(th);

      return th;
    });
    head.appendChild(letters);

    const body = document.createElement('tbody');
    state.rowHeads = [];
    state.cells = sheet.rows.map((row, r) => {
      const tr = document.createElement('tr');
      if (r === 0) {
        tr.setAttribute('data-grid-head', '');
      }
      const number = document.createElement('th');
      number.textContent = String(r + 1);
      state.rowHeads.push(number);
      tr.appendChild(number);
      const cells = Array.from({ length: width }, (_, column) => {
        const td = document.createElement('td');
        const cell = row[column];
        td.textContent = cell?.text ?? '';
        td.setAttribute('data-ref', ref([r, column]));
        td.setAttribute('data-row', String(r));
        td.setAttribute('data-column', String(column));
        if (cell !== undefined && cell.value !== null) {
          td.className = 'blok-file-preview-xlsx-num';
        }
        if (cell?.bold === true) {
          td.setAttribute('data-bold', '');
        }
        tr.appendChild(td);

        return td;
      });
      body.appendChild(tr);

      return cells;
    });

    table.replaceChildren(head, body);
    container.scrollTo?.(0, 0);
    Object.assign(state, { sheet, anchor: [0, 0], focus: [0, 0], painted: [] });
    tabs.forEach((tab, i) => tab.setAttribute('aria-pressed', String(i === index)));
    paint();
  };

  const tabList = document.createElement('div');
  tabList.className = 'blok-file-preview-grid-tabs';
  tabList.append(...tabs);

  const withTabs = opts.tabs !== false;
  if (withTabs) {
    chrome.setFacts([counted(sheets.length, labels.sheetsOne, labels.sheets)]);
  }
  const bar = buildBar(withTabs ? [tabList, barSpacer(), status] : [barSpacer(), status]);
  chrome.setBar(bar);
  open(0);

  return bar;
}
