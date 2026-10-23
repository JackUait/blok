import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantBar } from '../../../../../src/components/modules/assistant/assistant-bar';

const callbacks = {
  onSubmit: vi.fn(),
  onStop: vi.fn(),
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  onContinue: vi.fn(),
  onInsert: vi.fn(),
  onEscape: vi.fn(),
  onThinking: vi.fn(),
};

const BAR_HEIGHT = 46;
// SPACE_BEFORE + the bar + SPACE_AFTER in assistant-bar.ts.
const GAP = 6 + BAR_HEIGHT + 10;

/** The bar over a generated part: above its first block, no lower than just under its last. */
describe('assistant bar: over the part it generated', () => {
  let bar: AssistantBar;
  let first: HTMLElement;
  let last: HTMLElement;
  const rects = { first: 0, last: 0 };

  const place = (): void => bar.place(first, { left: 0, width: 600 }, false, { side: 'start', end: last });
  const top = (): number => parseFloat(bar.element.style.top);

  beforeEach(() => {
    vi.clearAllMocks();
    bar = new AssistantBar((key) => key, callbacks);
    first = document.createElement('div');
    last = document.createElement('div');
    document.body.append(first, last);

    const measure = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
      if (this === bar.element) {
        return new DOMRect(0, top() || 0, 600, BAR_HEIGHT);
      }
      if (this === first) {
        return new DOMRect(0, rects.first, 600, 24);
      }
      if (this === last) {
        return new DOMRect(0, rects.last, 600, 24);
      }

      return measure.call(this);
    });
    rects.first = 300;
    rects.last = 600;
    bar.open(first, { left: 0, width: 600 });
  });

  afterEach(() => {
    bar.close();
    bar.element.remove();
    first.remove();
    last.remove();
    vi.restoreAllMocks();
  });

  it('holds its gap above the first block, and sits in it', () => {
    place();

    expect(first.getAttribute('data-blok-ai-gap')).toBe('start');
    expect(first.style.getPropertyValue('--blok-ai-gap-start')).toBe(`${GAP}px`);
    expect(top()).toBe(300 - GAP + 6);
  });

  it('sticks to the window\'s top while the part runs past it', () => {
    rects.first = -500;
    rects.last = 400;
    place();

    expect(top()).toBe(16);
  });

  it('stops just under the last block, and scrolls away with it', () => {
    rects.first = -900;
    rects.last = -24;
    place();

    // The last block ends at 0; the bar sits SPACE_BEFORE under it.
    expect(top()).toBe(6);

    rects.first = -1200;
    rects.last = -324;
    place();

    expect(top()).toBe(-294);
  });

  it('stays at the window\'s bottom edge while the part is below the window', () => {
    rects.first = 1500;
    rects.last = 1800;
    place();

    expect(top()).toBe(800 - 16 - BAR_HEIGHT);
  });

  it('gives up the gap above the first block when it goes back under a block', () => {
    place();
    bar.place(last, { left: 0, width: 600 });

    expect(first.hasAttribute('data-blok-ai-gap')).toBe(false);
    expect(last.getAttribute('data-blok-ai-gap')).toBe('end');
  });
});
