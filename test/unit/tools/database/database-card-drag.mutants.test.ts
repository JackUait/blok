import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { CardDragResult } from '../../../../src/tools/database/database-card-drag';

const DRAG_THRESHOLD = 10;
const COLUMN_LEFT = 100;
const COLUMN_WIDTH = 200;
const COLUMN_HEIGHT = 400;
const CARD_INSET = 10;
const CARD_WIDTH = 180;
const CARD_HEIGHT = 60;
const FIRST_CARD_TOP = 50;

/** Where the pointer goes down inside card `a1`, whose box starts at (110, 50). */
const START_X = 150;
const START_Y = 80;

interface Board {
  wrapper: HTMLElement;
  columns: HTMLElement[];
  containers: HTMLElement[];
  cards: Map<string, HTMLElement>;
  drag: DatabaseCardDrag;
  onDrop: ReturnType<typeof vi.fn<(result: CardDragResult) => void>>;
}

const boards: Board[] = [];

const stubRect = (el: HTMLElement, box: { left: number; top: number; width: number; height: number }): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: box.left,
    right: box.left + box.width,
    top: box.top,
    bottom: box.top + box.height,
    width: box.width,
    height: box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  });
};

/**
 * Columns run left to right from x = 100 in 200px steps; cards stack from
 * y = 50 in 60px steps. jsdom measures every element as a zero-sized box, so
 * without these stubs every midpoint comparison below compares 0 with 0.
 */
const buildBoard = (rowIds: string[][]): Board => {
  const wrapper = document.createElement('div');
  const columns: HTMLElement[] = [];
  const containers: HTMLElement[] = [];
  const cards = new Map<string, HTMLElement>();

  rowIds.forEach((ids, columnIndex) => {
    const column = document.createElement('div');
    const left = COLUMN_LEFT + columnIndex * COLUMN_WIDTH;

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-option-id', `opt-${columnIndex}`);
    stubRect(column, { left, top: 0, width: COLUMN_WIDTH, height: COLUMN_HEIGHT });

    const container = document.createElement('div');

    container.setAttribute('data-blok-database-cards', '');
    column.appendChild(container);

    ids.forEach((id, cardIndex) => {
      const card = document.createElement('div');

      card.setAttribute('data-blok-database-card', '');
      card.setAttribute('data-row-id', id);
      card.textContent = id;
      stubRect(card, {
        left: left + CARD_INSET,
        top: FIRST_CARD_TOP + cardIndex * CARD_HEIGHT,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      container.appendChild(card);
      cards.set(id, card);
    });

    wrapper.appendChild(column);
    columns.push(column);
    containers.push(container);
  });

  document.body.appendChild(wrapper);

  const onDrop = vi.fn<(result: CardDragResult) => void>();
  const board: Board = { wrapper, columns, containers, cards, drag: new DatabaseCardDrag({ wrapper, onDrop }), onDrop };

  boards.push(board);

  return board;
};

const cardOf = (board: Board, rowId: string): HTMLElement => {
  const card = board.cards.get(rowId);

  if (card === undefined) {
    throw new Error(`No card ${rowId} in the fixture`);
  }

  return card;
};

const pointer = (type: string, clientX: number, clientY: number): PointerEvent =>
  new PointerEvent(type, { clientX, clientY, bubbles: true });

const ghost = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-blok-database-ghost]');

const startDrag = (board: Board, clientX = START_X + 20, clientY = START_Y): void => {
  board.drag.beginTracking('a1', START_X, START_Y);
  document.dispatchEvent(pointer('pointermove', clientX, clientY));
};

/**
 * Records every write to one style property. Re-applying the same gap is
 * invisible in the final DOM — the write itself is the only evidence.
 */
const trackStyleWrites = (el: HTMLElement, property: 'marginTop' | 'paddingBottom'): string[] => {
  const writes: string[] = [];
  const real = el.style;

  Object.defineProperty(el, 'style', {
    configurable: true,
    get: () => new Proxy(real, {
      get: (target, key) => Reflect.get(target, key, target) as unknown,
      set: (target, key, value: string) => {
        if (key === property) {
          writes.push(String(value));
        }

        return Reflect.set(target, key, value, target);
      },
    }),
  });

  return writes;
};

/**
 * The ghost's position is written twice per move: once while the element is
 * built, then again by the follow-the-cursor pass. Only the state at insertion
 * time shows whether it was placed before it reached the page.
 */
const ghostPositionsAtInsert = (): Array<{ left: string; top: string }> => {
  const seen: Array<{ left: string; top: string }> = [];
  const append = Node.prototype.appendChild;

  vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLElement && node.hasAttribute('data-blok-database-ghost')) {
      seen.push({ left: node.style.left, top: node.style.top });
    }

    return append.call(document.body, node) as T;
  });

  return seen;
};

/**
 * jsdom reports an exception raised inside a document listener as a window
 * `error` event and lets the dispatch return normally, so a guard that turns
 * that exception into nothing is only observable here.
 */
const recordWindowErrors = (): { errors: string[]; stop: () => void } => {
  const errors: string[] = [];
  const listener = (event: Event): void => {
    errors.push(String((event as ErrorEvent).message));
  };

  window.addEventListener('error', listener);

  return { errors, stop: () => window.removeEventListener('error', listener) };
};

const assertClean = (board: Board): void => {
  expect(ghost()).toBeNull();
  expect(cardOf(board, 'a1').style.opacity).toBe('');
  expect(cardOf(board, 'a2').style.marginTop).toBe('');
  expect(board.containers[0].style.paddingBottom).toBe('');
  expect(board.wrapper.hasAttribute('data-blok-database-dragging')).toBe(false);
};

const TWO_COLUMNS = [['a1', 'a2', 'a3'], ['b1', 'b2']];

describe('database card drag mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    boards.splice(0).forEach((board) => board.drag.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('the drag threshold', () => {
    it('ignores a horizontal move that only reaches the threshold', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, START_X + DRAG_THRESHOLD);

      expect(ghost()).toBeNull();
      expect(board.wrapper.hasAttribute('data-blok-database-dragging')).toBe(false);
      expect(cardOf(board, 'a2').style.marginTop).toBe('');
    });

    it('ignores a vertical move that only reaches the threshold', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, START_X, START_Y + DRAG_THRESHOLD);

      expect(ghost()).toBeNull();
      expect(cardOf(board, 'a2').style.marginTop).toBe('');
    });

    it('starts on a horizontal move past the threshold in the negative direction', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, START_X - DRAG_THRESHOLD - 1);

      expect(ghost()).not.toBeNull();
    });

    it('starts on a vertical move past the threshold', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, START_X, START_Y + DRAG_THRESHOLD + 1);

      expect(ghost()).not.toBeNull();
    });

    it('reports no drop when the pointer never passed the threshold', () => {
      const board = buildBoard(TWO_COLUMNS);

      board.drag.beginTracking('a1', START_X, START_Y);
      document.dispatchEvent(pointer('pointerup', START_X + DRAG_THRESHOLD, START_Y));

      expect(board.onDrop).not.toHaveBeenCalled();
    });
  });

  describe('the ghost', () => {
    it('carries a copy of the card and fades the original', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);

      const clone = ghost()?.firstElementChild;

      if (!(clone instanceof HTMLElement)) {
        throw new Error('The ghost carries no cloned card');
      }

      expect(clone.textContent).toBe('a1');
      expect(clone.style.opacity).toBe('');
      expect(cardOf(board, 'a1').style.opacity).toBe('0.4');
    });

    it('keeps the grab offset, so the card does not jump under the cursor', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);

      expect(ghost()?.style.left).toBe(`${START_X + 20 - (START_X - (COLUMN_LEFT + CARD_INSET))}px`);
      expect(ghost()?.style.top).toBe(`${START_Y - (START_Y - FIRST_CARD_TOP)}px`);
      expect(ghost()?.style.width).toBe(`${CARD_WIDTH}px`);
    });

    it('follows the cursor', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 250, 200));

      expect(ghost()?.style.left).toBe('210px');
      expect(ghost()?.style.top).toBe('170px');
    });

    it('is inert, lifted and tilted', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);

      const el = ghost();

      expect(el?.getAttribute('data-blok-database-ghost')).toBe('');
      expect(el?.getAttribute('contenteditable')).toBe('false');
      expect(el?.style.position).toBe('fixed');
      expect(el?.style.pointerEvents).toBe('none');
      expect(el?.style.opacity).toBe('0.85');
      expect(el?.style.zIndex).toBe('50');
      expect(el?.style.borderRadius).toBe('8px');
      expect(el?.style.overflow).toBe('hidden');
      expect(el?.style.transform).toBe('rotate(2deg) scale(1.02)');
      expect(el?.style.transformOrigin).toBe('center center');
    });

    it('marks the wrapper with an empty dragging attribute', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);

      expect(board.wrapper.getAttribute('data-blok-database-dragging')).toBe('');
    });

    it('is placed under the cursor before it reaches the page', () => {
      const board = buildBoard(TWO_COLUMNS);
      const inserted = ghostPositionsAtInsert();

      startDrag(board);

      expect(inserted).toEqual([{ left: '130px', top: '50px' }]);
    });

    it('is placed on the cursor before it reaches the page when the card is missing', () => {
      const board = buildBoard(TWO_COLUMNS);
      const inserted = ghostPositionsAtInsert();

      board.drag.beginTracking('gone', START_X, START_Y);
      document.dispatchEvent(pointer('pointermove', 170, 80));

      expect(inserted).toEqual([{ left: '170px', top: '80px' }]);
    });

    it('sits on the cursor itself when the dragged card is missing', () => {
      const board = buildBoard(TWO_COLUMNS);

      board.drag.beginTracking('gone', START_X, START_Y);
      document.dispatchEvent(pointer('pointermove', 170, 80));

      expect(ghost()).not.toBeNull();
      expect(ghost()?.style.left).toBe('170px');
      expect(ghost()?.style.top).toBe('80px');
      expect(ghost()?.firstElementChild).toBeNull();
      expect(board.wrapper.getAttribute('data-blok-database-dragging')).toBe('');
    });

    it('absorbs a move that lands with no ghost to move', () => {
      const board = buildBoard(TWO_COLUMNS);
      const { errors, stop } = recordWindowErrors();

      // The build is the only step between arming the drag and having a ghost,
      // so a throw there leaves the drag armed with nothing to follow the cursor.
      vi.spyOn(cardOf(board, 'a1'), 'cloneNode').mockImplementationOnce(() => {
        throw new Error('clone failed');
      });

      startDrag(board);
      errors.length = 0;

      document.dispatchEvent(pointer('pointermove', 250, 200));

      expect(errors).toEqual([]);
      expect(ghost()).toBeNull();

      stop();
    });
  });

  describe('the drop gap', () => {
    it('opens a gap above the card the cursor is over', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);

      expect(cardOf(board, 'a2').style.marginTop).toBe(`${CARD_HEIGHT}px`);
    });

    it('moves the gap rather than opening a second one', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 170, 160));

      expect(cardOf(board, 'a2').style.marginTop).toBe('');
      expect(cardOf(board, 'a3').style.marginTop).toBe(`${CARD_HEIGHT}px`);
    });

    it('pads the card list when the cursor is past the last card', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 170, 300));

      expect(board.containers[0].style.paddingBottom).toBe(`${CARD_HEIGHT}px`);
      expect(cardOf(board, 'a2').style.marginTop).toBe('');
    });

    it('closes the padding when the cursor comes back over a card', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 170, 300));
      document.dispatchEvent(pointer('pointermove', 170, 80));

      expect(board.containers[0].style.paddingBottom).toBe('');
      expect(cardOf(board, 'a2').style.marginTop).toBe(`${CARD_HEIGHT}px`);
    });

    it('closes the gap when the cursor leaves every column', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 800, 80));

      expect(cardOf(board, 'a2').style.marginTop).toBe('');
    });

    it('closes the gap when the target column has no card list', () => {
      const board = buildBoard(TWO_COLUMNS);
      const container = board.containers[1];

      while (container.firstChild !== null) {
        board.columns[1].appendChild(container.firstChild);
      }
      container.remove();

      startDrag(board);

      expect(cardOf(board, 'a2').style.marginTop).toBe(`${CARD_HEIGHT}px`);

      document.dispatchEvent(pointer('pointermove', 350, 300));

      expect(cardOf(board, 'a2').style.marginTop).toBe('');
    });

    it('does not rewrite an unchanged card gap', () => {
      const board = buildBoard(TWO_COLUMNS);
      const writes = trackStyleWrites(cardOf(board, 'a2'), 'marginTop');

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 172, 82));
      document.dispatchEvent(pointer('pointermove', 174, 84));

      expect(writes).toEqual([`${CARD_HEIGHT}px`]);
    });

    it('does not rewrite an unchanged list padding', () => {
      const board = buildBoard(TWO_COLUMNS);
      const writes = trackStyleWrites(board.containers[0], 'paddingBottom');

      startDrag(board, 170, 300);
      document.dispatchEvent(pointer('pointermove', 172, 302));

      expect(writes).toEqual([`${CARD_HEIGHT}px`]);
    });
  });

  describe('the drop', () => {
    it('reports the cards either side of the drop', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, 350, 100);
      document.dispatchEvent(pointer('pointerup', 350, 100));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-1',
        beforeRowId: 'b2',
        afterRowId: 'b1',
      });
    });

    it('reports the last card when the drop lands past the end of a column', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, 350, 400);
      document.dispatchEvent(pointer('pointerup', 350, 400));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-1',
        beforeRowId: null,
        afterRowId: 'b2',
      });
    });

    it('reports no neighbours when the target column is empty', () => {
      const board = buildBoard([['a1', 'a2', 'a3'], []]);

      startDrag(board, 350, 200);
      document.dispatchEvent(pointer('pointerup', 350, 200));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-1',
        beforeRowId: null,
        afterRowId: null,
      });
    });

    it('keeps the dragged card out of the drop maths', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, 170, 60);
      document.dispatchEvent(pointer('pointerup', 170, 60));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-0',
        beforeRowId: 'a2',
        afterRowId: null,
      });
    });

    it('treats a card midpoint as belonging to the card above it', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, 170, 140);
      document.dispatchEvent(pointer('pointerup', 170, 140));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-0',
        beforeRowId: 'a3',
        afterRowId: 'a2',
      });
    });

    it('gives a column its own left edge', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, COLUMN_LEFT, 200);
      document.dispatchEvent(pointer('pointerup', COLUMN_LEFT, 200));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-0',
        beforeRowId: null,
        afterRowId: 'a3',
      });
    });

    it('gives a column its own right edge', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, COLUMN_LEFT + COLUMN_WIDTH, 200);
      document.dispatchEvent(pointer('pointerup', COLUMN_LEFT + COLUMN_WIDTH, 200));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: 'opt-0',
        beforeRowId: null,
        afterRowId: 'a3',
      });
    });

    it('reports an empty option id when the column carries none', () => {
      const board = buildBoard(TWO_COLUMNS);

      board.columns[1].removeAttribute('data-option-id');

      startDrag(board, 350, 400);
      document.dispatchEvent(pointer('pointerup', 350, 400));

      expect(board.onDrop).toHaveBeenCalledWith({
        rowId: 'a1',
        toOptionId: '',
        beforeRowId: null,
        afterRowId: 'b2',
      });
    });

    it('reports nothing when the drop lands left of the first column', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, COLUMN_LEFT - 50, 200);
      document.dispatchEvent(pointer('pointerup', COLUMN_LEFT - 50, 200));

      expect(board.onDrop).not.toHaveBeenCalled();
      assertClean(board);
    });

    it('reports nothing and cleans up when the drop lands outside every column', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board, 800, 80);
      document.dispatchEvent(pointer('pointerup', 800, 80));

      expect(board.onDrop).not.toHaveBeenCalled();
      assertClean(board);
    });
  });

  describe('abandoning a drag', () => {
    it('undoes everything on Escape, without reporting a drop', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      assertClean(board);
      expect(board.onDrop).not.toHaveBeenCalled();
    });

    it('ignores every other key', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(ghost()).not.toBeNull();
    });

    it('undoes everything on a cancelled pointer, without reporting a drop', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      document.dispatchEvent(pointer('pointercancel', 170, 80));

      assertClean(board);
      expect(board.onDrop).not.toHaveBeenCalled();
    });

    it('undoes everything on teardown and abandons the drag', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      board.drag.destroy();

      assertClean(board);

      document.dispatchEvent(pointer('pointermove', 350, 100));
      document.dispatchEvent(pointer('pointerup', 350, 100));

      expect(board.onDrop).not.toHaveBeenCalled();
      expect(ghost()).toBeNull();
    });

    it('stops listening on the document once torn down', () => {
      const board = buildBoard(TWO_COLUMNS);

      startDrag(board);
      board.drag.destroy();

      document.dispatchEvent(pointer('pointermove', START_X + 100, START_Y));

      expect(ghost()).toBeNull();

      // Teardown is idempotent, so a stale pointerup/pointercancel/keydown
      // listener shows up only in the work it redoes: stripping the attribute.
      const stale: Event[] = [
        pointer('pointerup', 400, 80),
        pointer('pointercancel', 400, 80),
        new KeyboardEvent('keydown', { key: 'Escape' }),
      ];

      for (const event of stale) {
        board.wrapper.setAttribute('data-blok-database-dragging', '');
        document.dispatchEvent(event);

        expect(board.wrapper.hasAttribute('data-blok-database-dragging')).toBe(true);
      }
    });
  });
});
