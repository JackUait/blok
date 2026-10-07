import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import {
  destroy,
  hide,
  HINT_DELAY,
  MIN_HINT_DELAY,
  onHover,
  show,
  showReadout,
} from '../../../../src/components/utils/tooltip';

const getWrapper = (): HTMLElement | null =>
  document.querySelector(`[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`);

const isShown = (): boolean => getWrapper()?.getAttribute('aria-hidden') === 'false';

const createTarget = (): HTMLElement => {
  const element = document.createElement('button');

  element.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 40 }));
  document.body.appendChild(element);

  return element;
};

const hoverIn = (element: HTMLElement): void => {
  element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
};

const hoverOut = (element: HTMLElement): void => {
  element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
};

describe('Tooltip hint delay law: hints show on hover only, after a delay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('waits for the default hint delay when no delay is given', () => {
    const target = createTarget();

    show(target, 'hint');

    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isShown()).toBe(true);
  });

  it('raises a shorter delay, including 0, to the minimum hint delay', () => {
    const target = createTarget();

    show(target, 'hint', { delay: 0 });

    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(MIN_HINT_DELAY - 1);
    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isShown()).toBe(true);
  });

  it('honors a delay longer than the minimum', () => {
    const target = createTarget();

    onHover(target, 'hint', { delay: 800 });
    hoverIn(target);

    vi.advanceTimersByTime(799);
    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isShown()).toBe(true);
  });

  it('does not open the next hint instantly right after the previous one closed', () => {
    const target = createTarget();

    show(target, 'first');
    vi.advanceTimersByTime(HINT_DELAY);
    expect(isShown()).toBe(true);

    hide();
    vi.advanceTimersByTime(50);

    show(target, 'second');

    expect(isShown()).toBe(false);

    vi.advanceTimersByTime(HINT_DELAY);
    expect(isShown()).toBe(true);
    expect(getWrapper()?.textContent).toBe('second');
  });

  it('does not swap the open bubble to a new trigger instantly while the grace hide is pending', () => {
    const triggerA = createTarget();
    const triggerB = createTarget();

    onHover(triggerA, 'hint A');
    onHover(triggerB, 'hint B');

    hoverIn(triggerA);
    vi.advanceTimersByTime(HINT_DELAY);
    expect(getWrapper()?.textContent).toBe('hint A');

    hoverOut(triggerA);
    hoverIn(triggerB);

    expect(isShown() && getWrapper()?.textContent === 'hint B').toBe(false);

    vi.advanceTimersByTime(HINT_DELAY);
    expect(isShown()).toBe(true);
    expect(getWrapper()?.textContent).toBe('hint B');
  });

  it('keeps the open bubble when the pointer briefly leaves and re-enters the same trigger', () => {
    const target = createTarget();

    onHover(target, 'hint');
    hoverIn(target);
    vi.advanceTimersByTime(HINT_DELAY);

    hoverOut(target);
    vi.advanceTimersByTime(50);
    hoverIn(target);

    expect(isShown()).toBe(true);

    vi.advanceTimersByTime(HINT_DELAY);
    expect(isShown()).toBe(true);
  });

  it('never opens a hint on focus, so a click on the trigger shows nothing at once', () => {
    const target = createTarget();

    onHover(target, 'hint');
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    vi.advanceTimersByTime(HINT_DELAY * 2);

    expect(isShown()).toBe(false);
  });

  it('shows a drag readout at once, since it is live feedback and not a hover hint', () => {
    const target = createTarget();

    showReadout(target, '3×4');

    expect(isShown()).toBe(true);
    expect(getWrapper()?.textContent).toBe('3×4');
  });

  it('updates a readout on every call without waiting', () => {
    const target = createTarget();

    showReadout(target, '3×4');
    showReadout(target, '3×5');

    expect(isShown()).toBe(true);
    expect(getWrapper()?.textContent).toBe('3×5');
  });
});
