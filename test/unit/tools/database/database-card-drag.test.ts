import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { CardDragResult } from '../../../../src/tools/database/database-card-drag';

/**
 * Creates a wrapper with columns and cards for testing.
 * Each column has data-blok-database-column and data-column-id.
 * Each card has data-blok-database-card and data-card-id.
 */
const createWrapper = (columnCount: number, cardsPerColumn: number): HTMLDivElement => {
  const wrapper = document.createElement('div');

  for (let c = 0; c < columnCount; c++) {
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-column-id', `col-${c}`);

    const left = c * 200;
    const right = left + 200;

    Object.defineProperty(column, 'getBoundingClientRect', {
      value: () => ({
        left,
        right,
        top: 0,
        bottom: cardsPerColumn * 60,
        width: 200,
        height: cardsPerColumn * 60,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });

    for (let k = 0; k < cardsPerColumn; k++) {
      const card = document.createElement('div');

      card.setAttribute('data-blok-database-card', '');
      card.setAttribute('data-card-id', `card-${c}-${k}`);

      const top = k * 60;
      const bottom = top + 60;

      Object.defineProperty(card, 'getBoundingClientRect', {
        value: () => ({
          left,
          right,
          top,
          bottom,
          width: 200,
          height: 60,
          x: left,
          y: top,
          toJSON: () => ({}),
        }),
        configurable: true,
      });

      column.appendChild(card);
    }

    wrapper.appendChild(column);
  }

  document.body.appendChild(wrapper);

  return wrapper;
};

describe('DatabaseCardDrag', () => {
  let wrapper: HTMLDivElement;
  let onDrop: ReturnType<typeof vi.fn<(result: CardDragResult) => void>>;
  let drag: DatabaseCardDrag;

  beforeEach(() => {
    vi.clearAllMocks();
    onDrop = vi.fn<(result: CardDragResult) => void>();
    wrapper = createWrapper(2, 2);
    drag = new DatabaseCardDrag({ wrapper, onDrop });
  });

  afterEach(() => {
    drag.destroy();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('does not call onDrop when movement is below 10px threshold', () => {
    drag.beginTracking('card-0-0', 50, 30);

    // Move only 5px — below threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 30 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 30 }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('sets source card opacity to 0.4 after exceeding threshold', () => {
    drag.beginTracking('card-0-0', 50, 30);

    // Move 20px — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    const sourceCard = wrapper.querySelector('[data-card-id="card-0-0"]') as HTMLElement;

    expect(sourceCard.style.opacity).toBe('0.4');
  });

  it('removes ghost element from DOM after pointerup', () => {
    drag.beginTracking('card-0-0', 50, 30);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
  });

  it('filters dragged card from drop position calculation', () => {
    wrapper.remove();
    wrapper = createWrapper(1, 3);
    drag.destroy();
    drag = new DatabaseCardDrag({ wrapper, onDrop });

    // Cards: card-0-0 (top 0–60), card-0-1 (top 60–120), card-0-2 (top 120–180)
    // Begin tracking card-0-0 (we are dragging it)
    drag.beginTracking('card-0-0', 50, 30);

    // Move past threshold to start drag
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 100 }));

    // Pointer at clientY=90, which is the midpoint of card-0-1 (60 + 60/2 = 90).
    // Without the fix, card-0-0 is still in the list, so the query sees:
    //   card-0-0 mid=30, card-0-1 mid=90, card-0-2 mid=150
    //   clientY=90 is NOT < 90 for card-0-1, so it falls through to card-0-2 → beforeCardId = card-0-2
    // With the fix, card-0-0 is filtered out, so the query sees:
    //   card-0-1 mid=90, card-0-2 mid=150
    //   clientY=90 is NOT < 90 for card-0-1, so it falls through to card-0-2 → beforeCardId = card-0-2
    // Actually, the key difference is in afterCardId resolution.
    // Let's aim at clientY=80 which is clearly above card-0-1's midpoint (90).
    // Without fix: cards = [card-0-0, card-0-1, card-0-2], clientY=80 > card-0-0 mid(30), < card-0-1 mid(90) → beforeEl = card-0-1, beforeIndex=1, afterCardId = cards[0] = card-0-0
    // With fix: cards = [card-0-1, card-0-2], clientY=80 < card-0-1 mid(90) → beforeEl = card-0-1, beforeIndex=0, afterCardId = null (index 0, no previous)
    // So with the fix: beforeCardId=card-0-1, afterCardId=null
    // Without fix: beforeCardId=card-0-1, afterCardId=card-0-0 (wrong! dragged card shouldn't be referenced)

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 80 }));

    expect(onDrop).toHaveBeenCalledWith({
      cardId: 'card-0-0',
      toColumnId: 'col-0',
      beforeCardId: 'card-0-1',
      afterCardId: null,
    });
  });

  it('cleans up previous tracking session when beginTracking is called again', () => {
    // Start tracking card-0-0
    drag.beginTracking('card-0-0', 50, 30);

    // Move past threshold to activate drag (creates ghost, adds listeners)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    const firstSourceCard = wrapper.querySelector('[data-card-id="card-0-0"]') as HTMLElement;

    expect(firstSourceCard.style.opacity).toBe('0.4');

    // Start tracking card-0-1 without pointerup — simulates concurrent call
    drag.beginTracking('card-0-1', 50, 90);

    // Previous ghost should be removed and first card opacity restored
    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(firstSourceCard.style.opacity).toBe('');

    // Now simulate pointerup — only the second tracking session should be active
    // Since we haven't moved past threshold for card-0-1, onDrop should NOT be called
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 90 }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('calls onDrop with correct data for cross-column card move', () => {
    // Drag card-0-0 from col-0 to col-1
    // col-0 cards: card-0-0 (0–60), card-0-1 (60–120)
    // col-1 cards: card-1-0 (0–60), card-1-1 (60–120)
    drag.beginTracking('card-0-0', 50, 30);

    // Move past threshold into col-1 (col-1 starts at x=200)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, clientY: 30 }));

    // Drop at clientY=90, which is the midpoint of card-1-1 (60 + 60/2 = 90)
    // clientY=90 is NOT < 90, so it falls through card-1-1, beforeEl = null
    // Actually let's drop at clientY=70 which is above card-1-1's midpoint (90)
    // cards in col-1: [card-1-0, card-1-1]
    // clientY=70: > card-1-0 mid(30), < card-1-1 mid(90) → beforeEl = card-1-1
    // beforeIndex = 1, afterCardId = cards[0] = card-1-0
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 250, clientY: 70 }));

    expect(onDrop).toHaveBeenCalledWith({
      cardId: 'card-0-0',
      toColumnId: 'col-1',
      beforeCardId: 'card-1-1',
      afterCardId: 'card-1-0',
    });
  });

  it('calls onDrop with correct data for within-column reorder', () => {
    wrapper.remove();
    wrapper = createWrapper(1, 3);
    drag.destroy();
    drag = new DatabaseCardDrag({ wrapper, onDrop });

    // Cards: card-0-0 (0–60), card-0-1 (60–120), card-0-2 (120–180)
    // Drag card-0-0 to after card-0-1 (between card-0-1 and card-0-2)
    drag.beginTracking('card-0-0', 50, 30);

    // Move past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 130 }));

    // Drop at clientY=130, which is above card-0-2's midpoint (120 + 60/2 = 150)
    // With fix A, dragged card-0-0 is filtered out. Remaining: [card-0-1, card-0-2]
    // clientY=130: > card-0-1 mid(90), < card-0-2 mid(150) → beforeEl = card-0-2
    // beforeIndex = 1, afterCardId = cards[0] = card-0-1
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 130 }));

    expect(onDrop).toHaveBeenCalledWith({
      cardId: 'card-0-0',
      toColumnId: 'col-0',
      beforeCardId: 'card-0-2',
      afterCardId: 'card-0-1',
    });
  });

  it('removes ghost element and does not call onDrop on Escape key', () => {
    drag.beginTracking('card-0-0', 50, 30);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });
});
