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

  it('removes ghost element and does not call onDrop on Escape key', () => {
    drag.beginTracking('card-0-0', 50, 30);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30 }));

    expect(document.querySelector('[data-blok-database-ghost]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });
});
