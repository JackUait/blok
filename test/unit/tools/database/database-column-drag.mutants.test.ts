import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';

const DRAG_THRESHOLD = 10;
const COLUMN_WIDTH = 100;

interface Board {
  wrapper: HTMLElement;
  board: HTMLElement;
  columns: HTMLElement[];
  drag: DatabaseColumnDrag;
  onDrop: ReturnType<typeof vi.fn>;
}

/** Columns laid out left to right at 100px each, starting at x = 0. */
const buildBoard = (ids: string[]): Board => {
  const wrapper = document.createElement('div');
  const board = document.createElement('div');

  board.setAttribute('data-blok-database-board', '');
  wrapper.appendChild(board);
  document.body.appendChild(wrapper);

  const columns = ids.map((id, index) => {
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-option-id', id);
    column.textContent = id;
    board.appendChild(column);

    const left = index * COLUMN_WIDTH;

    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      left,
      right: left + COLUMN_WIDTH,
      top: 0,
      bottom: 200,
      width: COLUMN_WIDTH,
      height: 200,
      x: left,
      y: 0,
      toJSON: () => ({}),
    });

    return column;
  });

  const onDrop = vi.fn();

  return { wrapper, board, columns, drag: new DatabaseColumnDrag({ wrapper, onDrop }), onDrop };
};

const pointer = (type: string, clientX: number, clientY = 100): PointerEvent =>
  new PointerEvent(type, { clientX, clientY, bubbles: true });

const ghost = (): HTMLElement | null => document.body.querySelector('[data-blok-database-column-ghost]');

describe('database column drag mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('the drag threshold', () => {
    it('does not start on a move within the threshold', () => {
      const { drag, wrapper } = buildBoard(['a', 'b', 'c']);

      drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 50 + DRAG_THRESHOLD));

      expect(ghost()).toBeNull();
      expect(wrapper.hasAttribute('data-blok-database-column-reordering')).toBe(false);

      drag.cleanup();
    });

    it('starts once the move passes the threshold', () => {
      const { drag, wrapper } = buildBoard(['a', 'b', 'c']);

      drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 50 + DRAG_THRESHOLD + 1));

      expect(ghost()).not.toBeNull();
      expect(wrapper.hasAttribute('data-blok-database-column-reordering')).toBe(true);

      drag.cleanup();
    });

    it('measures the move in either direction', () => {
      const { drag } = buildBoard(['a', 'b', 'c']);

      drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 50 - DRAG_THRESHOLD - 1));

      expect(ghost()).not.toBeNull();

      drag.cleanup();
    });

    it('ignores vertical movement entirely', () => {
      const { drag } = buildBoard(['a', 'b', 'c']);

      drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 50, 900));

      expect(ghost()).toBeNull();

      drag.cleanup();
    });
  });

  describe('the ghost', () => {
    const startDrag = (board: Board, from = 50): void => {
      board.drag.beginTracking('a', from, 100);
      document.dispatchEvent(pointer('pointermove', from + DRAG_THRESHOLD + 1));
    };

    it('carries a copy of the column and fades the original', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);

      expect(ghost()?.textContent).toBe('a');
      expect(board.columns[0].style.opacity).toBe('0.4');

      board.drag.cleanup();
    });

    it('keeps the grab offset, so the column does not jump under the cursor', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board, 30);

      expect(ghost()?.style.left).toBe(`${30 + DRAG_THRESHOLD + 1 - 30}px`);

      document.dispatchEvent(pointer('pointermove', 200));

      expect(ghost()?.style.left).toBe('170px');

      board.drag.cleanup();
    });

    it('is inert and unselectable while it follows the cursor', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);

      expect(ghost()?.style.pointerEvents).toBe('none');
      expect(ghost()?.getAttribute('contenteditable')).toBe('false');

      board.drag.cleanup();
    });
  });

  describe('the drop gap', () => {
    const startDrag = (board: Board): void => {
      board.drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 61));
    };

    it('opens a gap before the column the cursor is left of', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 120));

      expect(board.columns[1].style.marginLeft).toBe(`${COLUMN_WIDTH}px`);

      board.drag.cleanup();
    });

    it('moves the gap rather than opening a second one', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 120));
      document.dispatchEvent(pointer('pointermove', 220));

      expect(board.columns[1].style.marginLeft).toBe('');
      expect(board.columns[2].style.marginLeft).toBe(`${COLUMN_WIDTH}px`);

      board.drag.cleanup();
    });

    it('pads the board instead when the cursor is past the last column', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 400));

      expect(board.board.style.paddingRight).toBe(`${COLUMN_WIDTH}px`);
      expect(board.columns[1].style.marginLeft).toBe('');

      board.drag.cleanup();
    });

    it('never opens a gap against the column being dragged', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(pointer('pointermove', 10));

      expect(board.columns[0].style.marginLeft).toBe('');

      board.drag.cleanup();
    });
  });

  describe('dropping', () => {
    const dragTo = (board: Board, x: number): void => {
      board.drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 61));
      document.dispatchEvent(pointer('pointermove', x));
      document.dispatchEvent(pointer('pointerup', x));
    };

    it('reports the neighbours either side of the drop', () => {
      const board = buildBoard(['a', 'b', 'c']);

      dragTo(board, 220);

      expect(board.onDrop).toHaveBeenCalledWith({ optionId: 'a', beforeOptionId: 'c', afterOptionId: 'b' });
    });

    it('reports a drop before the first remaining column with no column after it', () => {
      const board = buildBoard(['a', 'b', 'c']);

      dragTo(board, 120);

      expect(board.onDrop).toHaveBeenCalledWith({ optionId: 'a', beforeOptionId: 'b', afterOptionId: null });
    });

    it('reports a drop past the end with no column before it', () => {
      const board = buildBoard(['a', 'b', 'c']);

      dragTo(board, 400);

      expect(board.onDrop).toHaveBeenCalledWith({ optionId: 'a', beforeOptionId: null, afterOptionId: 'c' });
    });

    it('reports nothing when the drag never started', () => {
      const board = buildBoard(['a', 'b', 'c']);

      board.drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointerup', 55));

      expect(board.onDrop).not.toHaveBeenCalled();
    });
  });

  describe('abandoning', () => {
    const startDrag = (board: Board): void => {
      board.drag.beginTracking('a', 50, 100);
      document.dispatchEvent(pointer('pointermove', 61));
      document.dispatchEvent(pointer('pointermove', 120));
    };

    const assertClean = (board: Board): void => {
      expect(ghost()).toBeNull();
      expect(board.columns[0].style.opacity).toBe('');
      expect(board.columns[1].style.marginLeft).toBe('');
      expect(board.board.style.paddingRight).toBe('');
      expect(board.wrapper.hasAttribute('data-blok-database-column-reordering')).toBe(false);
    };

    it('undoes everything on Escape, without reporting a drop', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      assertClean(board);
      expect(board.onDrop).not.toHaveBeenCalled();
    });

    it('ignores every other key', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(ghost()).not.toBeNull();

      board.drag.cleanup();
    });

    it('undoes everything on a cancelled pointer, without reporting a drop', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      document.dispatchEvent(pointer('pointercancel', 120));

      assertClean(board);
      expect(board.onDrop).not.toHaveBeenCalled();
    });

    it('stops listening once torn down', () => {
      const board = buildBoard(['a', 'b', 'c']);

      startDrag(board);
      board.drag.destroy();
      document.dispatchEvent(pointer('pointermove', 400));
      document.dispatchEvent(pointer('pointerup', 400));

      expect(ghost()).toBeNull();
      expect(board.onDrop).not.toHaveBeenCalled();
    });
  });
});
