import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachPillGestures } from '../../../../src/tools/tabs/pill-gestures';

const PILL_WIDTH = 50;
const GAP = 4;

const setup = (): {
  strip: HTMLElement;
  pills: HTMLElement[];
  onReorder: ReturnType<typeof vi.fn>;
  onDwell: ReturnType<typeof vi.fn>;
  detach: () => void;
} => {
  const wrapper = document.createElement('div');
  const strip = document.createElement('div');
  const scroller = document.createElement('div');
  const pills = ['a', 'b', 'c'].map((id, index) => {
    const pill = document.createElement('button');

    pill.setAttribute('data-blok-tabs-pill', '');
    pill.setAttribute('data-tab-id', id);
    pill.setAttribute('aria-selected', String(index === 0));
    pill.getBoundingClientRect = (): DOMRect => {
      const left = index * (PILL_WIDTH + GAP);

      return { left, right: left + PILL_WIDTH, width: PILL_WIDTH, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) };
    };
    scroller.appendChild(pill);

    return pill;
  });

  scroller.getBoundingClientRect = (): DOMRect =>
    ({ left: 0, right: 300, width: 300, top: 0, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) });
  strip.appendChild(scroller);
  wrapper.appendChild(strip);
  document.body.appendChild(wrapper);

  const onReorder = vi.fn();
  const onDwell = vi.fn();
  const detach = attachPillGestures({
    strip,
    scroller,
    pills: () => pills,
    isReadOnly: () => false,
    onReorder,
    onDwell,
  });

  return { strip, pills, onReorder, onDwell, detach };
};

const pointer = (target: EventTarget, type: string, clientX: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX }));
};

describe('tab pill gestures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('moves the first tab between the second and third when dropped there', () => {
    const { pills, onReorder } = setup();

    pointer(pills[0], 'pointerdown', 10);
    pointer(document, 'pointermove', 70);
    pointer(document, 'pointerup', 70);

    expect(onReorder).toHaveBeenCalledWith('a', 'c');
  });

  it('moves the last tab to the front', () => {
    const { pills, onReorder } = setup();

    pointer(pills[2], 'pointerdown', 120);
    pointer(document, 'pointermove', 0);
    pointer(document, 'pointerup', 0);

    expect(onReorder).toHaveBeenCalledWith('c', 'a');
  });

  it('moves a tab to the end', () => {
    const { pills, onReorder } = setup();

    pointer(pills[0], 'pointerdown', 10);
    pointer(document, 'pointermove', 200);
    pointer(document, 'pointerup', 200);

    expect(onReorder).toHaveBeenCalledWith('a', undefined);
  });

  it('treats a tiny wobble as a click, not a drag', () => {
    const { pills, onReorder } = setup();
    const click = vi.fn();

    pills[1].addEventListener('click', click);
    pointer(pills[1], 'pointerdown', 60);
    pointer(document, 'pointermove', 62);
    pointer(document, 'pointerup', 62);
    pills[1].click();

    expect(onReorder).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('swallows the click that ends a drag', () => {
    const { pills } = setup();
    const click = vi.fn();

    pills[0].addEventListener('click', click);
    pointer(pills[0], 'pointerdown', 10);
    pointer(document, 'pointermove', 70);
    pointer(document, 'pointerup', 70);
    pills[0].click();

    expect(click).not.toHaveBeenCalled();
  });

  it('still lets the next click through when a drag ended without a click', async () => {
    const { pills } = setup();
    const click = vi.fn();

    pills[1].addEventListener('click', click);
    pointer(pills[0], 'pointerdown', 10);
    pointer(document, 'pointermove', 70);
    pointer(document, 'pointerup', 70);
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    pointer(pills[1], 'pointerdown', 60);
    pointer(document, 'pointerup', 60);
    pills[1].click();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('opens a tab after a dragged block rests on its pill', () => {
    vi.useFakeTimers();
    const { strip, pills, onDwell } = setup();

    strip.parentElement?.setAttribute('data-blok-dragging', 'true');
    pointer(pills[1], 'pointermove', 60);
    vi.advanceTimersByTime(500);

    expect(onDwell).toHaveBeenCalledWith('b');
  });

  it('opens a tab at once when a dragged block is released on its pill', () => {
    const { strip, pills, onDwell } = setup();

    strip.parentElement?.setAttribute('data-blok-dragging', 'true');
    pointer(pills[2], 'pointermove', 120);
    pointer(pills[2], 'pointerup', 120);

    expect(onDwell).toHaveBeenCalledWith('c');
  });

  it('does not open a tab when the pointer only passes over it without a block drag', () => {
    vi.useFakeTimers();
    const { pills, onDwell } = setup();

    pointer(pills[1], 'pointermove', 60);
    vi.advanceTimersByTime(500);

    expect(onDwell).not.toHaveBeenCalled();
  });
});
