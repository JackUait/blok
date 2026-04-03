import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import type { CardDragResult } from '../../../../src/tools/database/database-card-drag';

/**
 * Creates a wrapper with columns and cards for testing.
 * Each column has data-blok-database-column and data-option-id.
 * Each card has data-blok-database-card and data-row-id.
 */
const createWrapper = (columnCount: number, cardsPerColumn: number): HTMLDivElement => {
  const wrapper = document.createElement('div');

  for (let c = 0; c < columnCount; c++) {
    const column = document.createElement('div');

    column.setAttribute('data-blok-database-column', '');
    column.setAttribute('data-option-id', `opt-${c}`);

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

    const cardsContainer = document.createElement('div');

    cardsContainer.setAttribute('data-blok-database-cards', '');

    for (let k = 0; k < cardsPerColumn; k++) {
      const card = document.createElement('div');

      card.setAttribute('data-blok-database-card', '');
      card.setAttribute('data-row-id', `row-${c}-${k}`);

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

      cardsContainer.appendChild(card);
    }

    column.appendChild(cardsContainer);
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
    drag.beginTracking('row-0-0', 50, 30);

    // Move only 5px — below threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 30 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 30 }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('sets source card opacity to 0.4 after exceeding threshold', () => {
    drag.beginTracking('row-0-0', 50, 30);

    // Move 20px — past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    const sourceCard = wrapper.querySelector('[data-row-id="row-0-0"]') as HTMLElement;

    expect(sourceCard.style.opacity).toBe('0.4');
  });

  it('removes ghost element from DOM after pointerup', () => {
    drag.beginTracking('row-0-0', 50, 30);

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

    // Cards: row-0-0 (top 0–60), row-0-1 (top 60–120), row-0-2 (top 120–180)
    // Begin tracking row-0-0 (we are dragging it)
    drag.beginTracking('row-0-0', 50, 30);

    // Move past threshold to start drag
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 100 }));

    // Drop at clientY=80 which is clearly above row-0-1's midpoint (90)
    // With fix: cards = [row-0-1, row-0-2], clientY=80 < row-0-1 mid(90) → beforeEl = row-0-1, beforeIndex=0, afterRowId = null
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 80 }));

    expect(onDrop).toHaveBeenCalledWith({
      rowId: 'row-0-0',
      toOptionId: 'opt-0',
      beforeRowId: 'row-0-1',
      afterRowId: null,
    });
  });

  it('cleans up previous tracking session when beginTracking is called again', () => {
    // Start tracking row-0-0
    drag.beginTracking('row-0-0', 50, 30);

    // Move past threshold to activate drag (creates ghost, adds listeners)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    const firstSourceCard = wrapper.querySelector('[data-row-id="row-0-0"]') as HTMLElement;

    expect(firstSourceCard.style.opacity).toBe('0.4');

    // Start tracking row-0-1 without pointerup — simulates concurrent call
    drag.beginTracking('row-0-1', 50, 90);

    // Previous ghost should be removed and first card opacity restored
    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(firstSourceCard.style.opacity).toBe('');

    // Now simulate pointerup — only the second tracking session should be active
    // Since we haven't moved past threshold for row-0-1, onDrop should NOT be called
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 90 }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('calls onDrop with correct data for cross-column card move', () => {
    // Drag row-0-0 from opt-0 to opt-1
    // opt-0 cards: row-0-0 (0–60), row-0-1 (60–120)
    // opt-1 cards: row-1-0 (0–60), row-1-1 (60–120)
    drag.beginTracking('row-0-0', 50, 30);

    // Move past threshold into opt-1 (opt-1 starts at x=200)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 250, clientY: 30 }));

    // Drop at clientY=70 which is above row-1-1's midpoint (90)
    // cards in opt-1: [row-1-0, row-1-1]
    // clientY=70: > row-1-0 mid(30), < row-1-1 mid(90) → beforeEl = row-1-1
    // beforeIndex = 1, afterRowId = cards[0] = row-1-0
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 250, clientY: 70 }));

    expect(onDrop).toHaveBeenCalledWith({
      rowId: 'row-0-0',
      toOptionId: 'opt-1',
      beforeRowId: 'row-1-1',
      afterRowId: 'row-1-0',
    });
  });

  it('calls onDrop with correct data for within-column reorder', () => {
    wrapper.remove();
    wrapper = createWrapper(1, 3);
    drag.destroy();
    drag = new DatabaseCardDrag({ wrapper, onDrop });

    // Cards: row-0-0 (0–60), row-0-1 (60–120), row-0-2 (120–180)
    // Drag row-0-0 to after row-0-1 (between row-0-1 and row-0-2)
    drag.beginTracking('row-0-0', 50, 30);

    // Move past threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 130 }));

    // Drop at clientY=130, which is above row-0-2's midpoint (120 + 60/2 = 150)
    // With fix, dragged row-0-0 is filtered out. Remaining: [row-0-1, row-0-2]
    // clientY=130: > row-0-1 mid(90), < row-0-2 mid(150) → beforeEl = row-0-2
    // beforeIndex = 1, afterRowId = cards[0] = row-0-1
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 130 }));

    expect(onDrop).toHaveBeenCalledWith({
      rowId: 'row-0-0',
      toOptionId: 'opt-0',
      beforeRowId: 'row-0-2',
      afterRowId: 'row-0-1',
    });
  });

  it('displaces cards below insertion point to create a gap', () => {
    drag.beginTracking('row-0-0', 50, 30);

    // Move past threshold — cursor at clientY=80 is above row-0-1 midpoint (90)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 80 }));

    const displacedCard = wrapper.querySelector('[data-row-id="row-0-1"]') as HTMLElement;

    expect(parseFloat(displacedCard.style.marginTop)).toBeGreaterThan(0);
  });

  it('clears card displacement after pointer up', () => {
    drag.beginTracking('row-0-0', 50, 30);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 80 }));

    const displacedCard = wrapper.querySelector('[data-row-id="row-0-1"]') as HTMLElement;

    expect(parseFloat(displacedCard.style.marginTop)).toBeGreaterThan(0);

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 80 }));

    expect(displacedCard.style.marginTop).toBe('');
  });

  it('sets dragging attribute on wrapper during active drag', () => {
    drag.beginTracking('row-0-0', 50, 30);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(wrapper.hasAttribute('data-blok-database-dragging')).toBe(true);

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 70, clientY: 30 }));

    expect(wrapper.hasAttribute('data-blok-database-dragging')).toBe(false);
  });

  it('applies elevated shadow to ghost element', () => {
    drag.beginTracking('row-0-0', 50, 30);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    const ghost = document.querySelector('[data-blok-database-ghost]') as HTMLElement;

    expect(ghost.style.boxShadow).toBeTruthy();
  });

  it('removes ghost element and does not call onDrop on Escape key', () => {
    drag.beginTracking('row-0-0', 50, 30);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });
});
