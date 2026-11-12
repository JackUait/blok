import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardAutoScrollSpeed, listAutoScrollSpeed, rowAutoScrollSpeed } from '../../../../src/tools/database/database-auto-scroll';
import { DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import { DatabaseListRowDrag } from '../../../../src/tools/database/database-list-row-drag';
import { DatabaseTableRowDrag } from '../../../../src/tools/database/database-table-row-drag';
import { createTableState } from '../../../../src/tools/database/database-table-grid';

let frames: Array<(now: number) => void> = [];

const runFrames = (from: number, to: number): void => {
  for (let now = from; now <= to; now += 8) {
    const queued = frames;

    frames = [];
    queued.forEach((callback) => callback(now));
  }
};

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

const stubRect = (el: Element, value: () => DOMRect): void => {
  Object.defineProperty(el, 'getBoundingClientRect', { value, configurable: true });
};

/** A scroller jsdom can scroll: plain storage, clamped to its range. */
const makeScroller = (el: HTMLElement, axis: 'x' | 'y', range: number): void => {
  let pos = 0;
  const key = axis === 'y' ? 'scrollTop' : 'scrollLeft';

  el.style.setProperty(axis === 'y' ? 'overflow-y' : 'overflow-x', 'auto');
  Object.defineProperty(el, key, { get: () => pos, set: (v: number) => { pos = Math.min(range, Math.max(0, v)); }, configurable: true });
  Object.defineProperty(el, axis === 'y' ? 'scrollHeight' : 'scrollWidth', { value: 1000 + range, configurable: true });
  Object.defineProperty(el, axis === 'y' ? 'clientHeight' : 'clientWidth', { value: 1000, configurable: true });
};

const pointer = (type: string, x: number, y: number, target: EventTarget = document): void => {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });

  target.dispatchEvent(event);
};

// notion-motion.md Round 17 §1: the bottom edge's measured speeds, in px/ms.
const VERTICAL: Array<[number, number]> = [[35, 0.034], [34, 0.033], [32, 0.081], [20, 0.33], [10, 0.74], [5, 1.11], [1, 1.39]];

describe('database drag auto-scroll speeds (notion-motion.md Round 17 §1)', () => {
  it.each(VERTICAL)('list rows: %ipx from the edge scrolls at about %f px/ms', (distance, speed) => {
    expect(listAutoScrollSpeed(distance)).toBeCloseTo(speed, 2);
  });

  it.each(VERTICAL)('table rows: %ipx from the edge scrolls at about %f px/ms', (distance, speed) => {
    expect(rowAutoScrollSpeed(distance)).toBeCloseTo(speed, 2);
  });

  it('rows: nothing at 36px', () => {
    expect(listAutoScrollSpeed(36)).toBe(0);
    expect(rowAutoScrollSpeed(36)).toBe(0);
  });

  it('board cards: about 1.2 px/ms at 10px, still scrolling at 49px, nothing at 53px', () => {
    expect(cardAutoScrollSpeed(10)).toBeCloseTo(1.2, 2);
    expect(cardAutoScrollSpeed(49)).toBeGreaterThan(0);
    expect(cardAutoScrollSpeed(53)).toBe(0);
  });
});

/** notion-motion.md Round 17 §1: the move that enters the zone does not start the scroll; the next one inside it does. */
const enter = (x: number, y: number, axis: 'x' | 'y' = 'y'): void => {
  pointer('pointermove', x, y);
  pointer('pointermove', axis === 'y' ? x + 1 : x, axis === 'y' ? y : y + 1);
};

describe('database drags scroll near an edge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      frames.push(callback);

      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
    vi.stubGlobal('innerHeight', 450);
    vi.stubGlobal('innerWidth', 900);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tableFixture = (): { scroller: HTMLElement; grid: HTMLElement; handle: HTMLElement; drag: DatabaseTableRowDrag; onDrop: ReturnType<typeof vi.fn> } => {
    const scroller = document.createElement('div');
    const grid = document.createElement('div');

    makeScroller(scroller, 'y', 223);
    stubRect(scroller, () => rect(0, 44, 900, 406));
    grid.setAttribute('data-blok-database-table-grid', '');
    for (let i = 0; i < 12; i++) {
      const row = document.createElement('div');
      const handle = document.createElement('span');

      row.setAttribute('data-blok-database-table-row', '');
      row.setAttribute('data-row-id', `r${i}`);
      row.setAttribute('data-group-key', '');
      handle.setAttribute('data-blok-database-table-row-handle', '');
      row.appendChild(handle);
      stubRect(row, () => rect(40, 100 + i * 36 - scroller.scrollTop, 800, 36));
      grid.appendChild(row);
    }
    stubRect(grid, () => rect(40, 100 - scroller.scrollTop, 800, 432));
    scroller.appendChild(grid);
    document.body.appendChild(scroller);
    const onDrop = vi.fn();
    const drag = new DatabaseTableRowDrag({ grid, state: createTableState(), onDrop });
    const handle = grid.querySelector<HTMLElement>('[data-blok-database-table-row-handle]') as HTMLElement;

    return { scroller, grid, handle, drag, onDrop };
  };

  it('a table row held 10px above the window bottom scrolls the page down at about 0.74 px/ms', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    enter(50, 440);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBeGreaterThan(0.74 * 192);
    expect(scroller.scrollTop).toBeLessThan(0.74 * 264);
  });

  it('a table row held 20px above the window bottom scrolls slower, at about 0.33 px/ms', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    enter(50, 430);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBeGreaterThan(0.33 * 192);
    expect(scroller.scrollTop).toBeLessThan(0.33 * 264);
  });

  it('a table row held in the middle does not scroll', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    pointer('pointermove', 50, 250);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBe(0);
  });

  it('the table drop target follows the scroll with the pointer held still', () => {
    const { scroller, handle, onDrop } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    enter(50, 440);
    runFrames(0, 72);
    pointer('pointerup', 50, 440);
    // Rows are 36 tall from y 100: the drop goes before the first row whose middle is below the pointer.
    const before = Array.from({ length: 12 }, (_, i) => i).find((i) => i > 0 && 100 + i * 36 + 18 - scroller.scrollTop > 440);

    expect(scroller.scrollTop).toBeGreaterThan(36);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r0', beforeRowId: `r${before}` }));
  });

  it('dropping the table row stops the scroll', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    enter(50, 440);
    runFrames(0, 48);
    pointer('pointerup', 50, 440);
    const at = scroller.scrollTop;

    runFrames(56, 240);
    expect(scroller.scrollTop).toBe(at);
  });

  it('Escape stops the table row scroll', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    enter(50, 440);
    runFrames(0, 48);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const at = scroller.scrollTop;

    runFrames(56, 240);
    expect(scroller.scrollTop).toBe(at);
  });

  const boardFixture = (): { board: HTMLElement; card: HTMLElement; drag: DatabaseCardDrag } => {
    const board = document.createElement('div');

    board.setAttribute('data-blok-database-board', '');
    makeScroller(board, 'x', 146);
    stubRect(board, () => rect(270, 100, 630, 400));
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-option-id', 'a');
    stubRect(column, () => rect(280 - board.scrollLeft, 120, 760, 300));
    const card = document.createElement('div');

    card.setAttribute('data-blok-database-card', '');
    card.setAttribute('data-row-id', 'c1');
    stubRect(card, () => rect(288 - board.scrollLeft, 160, 260, 40));
    column.appendChild(card);
    board.appendChild(column);
    document.body.appendChild(board);
    const drag = new DatabaseCardDrag({ wrapper: board, onDrop: vi.fn() });

    return { board, card, drag };
  };

  it('a board card held 10px from the board\'s right edge scrolls the board sideways at about 1.2 px/ms', () => {
    const { board, card, drag } = boardFixture();

    drag.beginTracking('c1', 300, 170, card);
    enter(890, 170, 'x');
    runFrames(0, 72);

    expect(board.scrollLeft).toBeGreaterThan(1.2 * 48);
    expect(board.scrollLeft).toBeLessThan(1.2 * 96);
  });

  it('the board drop line follows the scroll with the pointer held still', () => {
    const { board, card, drag } = boardFixture();

    drag.beginTracking('c1', 300, 170, card);
    pointer('pointermove', 300, 190);
    const line = document.querySelector<HTMLElement>('[data-blok-database-drop-line]');
    const before = line?.style.left;

    // Still over the column after the board moves: the column starts at 280 - scrollLeft.
    enter(890, 190, 'x');
    const held = document.querySelector<HTMLElement>('[data-blok-database-drop-line]')?.style.left;

    runFrames(0, 72);

    expect(before).toBe('288px');
    expect(held).toBe('288px');
    expect(document.querySelector<HTMLElement>('[data-blok-database-drop-line]')?.style.left).toBe(`${288 - board.scrollLeft}px`);
    expect(board.scrollLeft).toBeGreaterThan(0);
  });

  it('a board card held 53px from the right edge does not scroll', () => {
    const { board, card, drag } = boardFixture();

    drag.beginTracking('c1', 300, 170, card);
    enter(847, 170, 'x');
    runFrames(0, 240);

    expect(board.scrollLeft).toBe(0);
  });

  it('Escape stops the board scroll', () => {
    const { board, card, drag } = boardFixture();

    drag.beginTracking('c1', 300, 170, card);
    enter(890, 170, 'x');
    runFrames(0, 24);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const at = board.scrollLeft;

    runFrames(32, 240);
    expect(board.scrollLeft).toBe(at);
  });

  const listFixture = (): { scroller: HTMLElement; drag: DatabaseListRowDrag; onDrop: ReturnType<typeof vi.fn> } => {
    const scroller = document.createElement('div');
    const list = document.createElement('div');

    makeScroller(scroller, 'y', 304);
    stubRect(scroller, () => rect(0, 44, 900, 406));
    for (let i = 0; i < 12; i++) {
      const row = document.createElement('div');

      row.setAttribute('data-blok-database-list-row', '');
      row.setAttribute('data-row-id', `r${i}`);
      stubRect(row, () => rect(40, 100 + i * 36 - scroller.scrollTop, 800, 36));
      list.appendChild(row);
    }
    scroller.appendChild(list);
    document.body.appendChild(scroller);
    const onDrop = vi.fn();
    const drag = new DatabaseListRowDrag({ wrapper: list, onDrop });

    return { scroller, drag, onDrop };
  };

  it('a list row held 10px above the window bottom scrolls the page down at about 0.74 px/ms', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 440);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBeGreaterThan(0.74 * 192);
    expect(scroller.scrollTop).toBeLessThan(0.74 * 264);
  });

  it('a list row held 36px above the window bottom does not scroll', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 414);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBe(0);
  });

  it('the list drop target follows the scroll with the pointer held still', () => {
    const { scroller, drag, onDrop } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 440);
    runFrames(0, 72);
    const line = document.querySelector<HTMLElement>('[data-blok-database-drop-line]');
    const before = Array.from({ length: 12 }, (_, i) => i).find((i) => i > 0 && 100 + i * 36 + 18 - scroller.scrollTop > 440);
    const top = 100 + (before ?? 0) * 36 - scroller.scrollTop;
    const lineTop = line === null ? NaN : parseFloat(line.style.top) + parseFloat(line.style.height || '0') / 2;

    pointer('pointerup', 50, 440);

    expect(scroller.scrollTop).toBeGreaterThan(36);
    expect(Math.abs(lineTop - top)).toBeLessThan(3);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r0', beforeRowId: `r${before}` }));
  });

  it('dropping the list row stops the scroll', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 440);
    runFrames(0, 48);
    pointer('pointerup', 50, 440);
    const at = scroller.scrollTop;

    runFrames(56, 240);
    expect(scroller.scrollTop).toBe(at);
  });

  it('Escape stops the list row scroll', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 440);
    runFrames(0, 48);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const at = scroller.scrollTop;

    runFrames(56, 240);
    expect(scroller.scrollTop).toBe(at);
  });

  it('a list row that jumps into the zone and holds still does not scroll', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    pointer('pointermove', 50, 430);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBe(0);
  });

  it('a second move inside the zone starts the scroll, and it keeps going with the pointer held still', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    pointer('pointermove', 50, 430);
    runFrames(0, 240);
    pointer('pointermove', 51, 430);
    runFrames(248, 488);

    expect(scroller.scrollTop).toBeGreaterThan(0.33 * 192);
  });

  it('a move out of the zone needs two moves back in to scroll again', () => {
    const { scroller, drag } = listFixture();

    drag.beginTracking('r0', 50, 110);
    enter(50, 430);
    pointer('pointermove', 50, 250);
    runFrames(0, 48);
    const at = scroller.scrollTop;

    pointer('pointermove', 50, 430);
    runFrames(56, 240);

    expect(scroller.scrollTop).toBe(at);
  });

  it('a table row that jumps into the zone and holds still does not scroll', () => {
    const { scroller, handle } = tableFixture();

    pointer('pointerdown', 50, 110, handle);
    pointer('pointermove', 50, 440);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBe(0);
  });

  it('a board card that jumps into the zone and holds still does not scroll', () => {
    const { board, card, drag } = boardFixture();

    drag.beginTracking('c1', 300, 170, card);
    pointer('pointermove', 890, 170);
    runFrames(0, 240);

    expect(board.scrollLeft).toBe(0);
  });

  // Round 17 §1: at the top, 10px inside the scroller scrolls up; inside the top bar above it does not.
  it('a list row 10px below the scroller top scrolls up', () => {
    const { scroller, drag } = listFixture();

    scroller.scrollTop = 150;
    drag.beginTracking('r0', 50, 110);
    enter(50, 54);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBeLessThan(150 - 0.74 * 192);
  });

  it('a list row over the bar above the scroller does not scroll', () => {
    const { scroller, drag } = listFixture();

    scroller.scrollTop = 150;
    drag.beginTracking('r0', 50, 110);
    enter(50, 30);
    runFrames(0, 240);

    expect(scroller.scrollTop).toBe(150);
  });
});
