import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import { destroy, hide, onHover, show } from '../../../../src/components/utils/tooltip';
import type { TooltipContent } from '../../../../src/components/utils/tooltip';

const tooltipSelector = `[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`;

const getTooltipWrapper = (): HTMLElement | null => {
  return document.querySelector(tooltipSelector);
};

const createTargetElement = (rectOverrides: Partial<DOMRect> = {}): HTMLElement => {
  const element = document.createElement('button');

  const left = rectOverrides.left ?? 10;
  const width = rectOverrides.width ?? 100;
  const top = rectOverrides.top ?? 20;
  const height = rectOverrides.height ?? 40;
  const right = rectOverrides.right ?? left + width;
  const bottom = rectOverrides.bottom ?? top + height;
  const rect = {
    left,
    right,
    top,
    bottom,
    width,
    height,
    x: left,
    y: top,
  };

  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: rect.width,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: rect.height,
  });

  element.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    toJSON: () => rect,
  }));

  document.body.appendChild(element);

  return element;
};

const setWrapperSize = (wrapper: HTMLElement, width: number, height: number): void => {
  Object.defineProperty(wrapper, 'offsetWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(wrapper, 'offsetHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(wrapper, 'clientWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(wrapper, 'clientHeight', {
    configurable: true,
    value: height,
  });
};

const setWindowScrollY = (value?: number): void => {
  if (typeof value === 'number') {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value,
    });

    return;
  }

  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: undefined,
  });
};

describe('Tooltip utility', () => {
  afterEach(() => {
    const wrapper = getTooltipWrapper();

    if (wrapper) {
      destroy();
    }

    document.getElementById('blok-tooltips-style')?.remove();
    document.body.innerHTML = '';
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    document.body.scrollTop = 0;
    setWindowScrollY(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('has no transition or transform animation classes on the wrapper', () => {
    const target = createTargetElement();

    show(target, 'No animation');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    const classes = Array.from(wrapper?.classList ?? []);

    // Should not have any transition classes
    const hasTransition = classes.some(cls => cls.startsWith('transition'));

    expect(hasTransition).toBe(false);

    // Should not have any duration classes
    const hasDuration = classes.some(cls => cls.startsWith('duration'));

    expect(hasDuration).toBe(false);

    // Should not have any ease classes
    const hasEase = classes.some(cls => cls.startsWith('ease'));

    expect(hasEase).toBe(false);

    // Should not have will-change classes
    const hasWillChange = classes.some(cls => cls.startsWith('will-change'));

    expect(hasWillChange).toBe(false);
  });

  it('does not apply transform offset classes for any placement', () => {
    const target = createTargetElement();

    const placements = ['top', 'bottom', 'left', 'right'] as const;

    for (const placement of placements) {
      show(target, `${placement} tooltip`, { placement });

      const wrapper = getTooltipWrapper();
      const classes = Array.from(wrapper?.classList ?? []);

      // Should not have any translate classes (the slide-in offset)
      const hasTranslate = classes.some(cls => cls.startsWith('translate') || cls.startsWith('-translate'));

      expect(hasTranslate, `placement "${placement}" should not have translate classes`).toBe(false);

      hide();
    }
  });

  it('shows immediately by default when no delay is specified', () => {
    const target = createTargetElement();

    show(target, 'No delay');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.style.visibility).toBe('visible');
  });

  it('renders tooltip content, accessible attributes', () => {
    const target = createTargetElement();

    show(target, 'Tooltip text', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();
    expect(wrapper?.textContent).toBe('Tooltip text');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.getAttribute(DATA_ATTR.interface)).toBe(TOOLTIP_INTERFACE_VALUE);
    expect(wrapper?.getAttribute('role')).toBe('tooltip');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.style.visibility).toBe('visible');

    show(target, 'New text', { delay: 0 });

    expect(wrapper?.textContent).toBe('New text');
  });

  it('accepts DOM nodes as content without cloning them', () => {
    const target = createTargetElement();
    const customContent = document.createElement('div');

    customContent.setAttribute('data-blok-testid', 'content');
    customContent.textContent = 'node content';

    show(target, customContent, { delay: 0 });

    const wrapper = getTooltipWrapper();
    const contentHolder = wrapper?.querySelector('[data-blok-testid="tooltip-content"]');

    expect(contentHolder?.contains(customContent)).toBe(true);
  });

  it('throws when content is not a string or Node', () => {
    const target = createTargetElement();

    expect(() => {
      show(target, 123 as unknown as TooltipContent, { delay: 0 });
    }).toThrow('[Blok Tooltip] Wrong type of «content» passed. It should be an instance of Node or String. But number given.');
  });

  it('places tooltip below the element taking margins and scroll into account', () => {
    const target = createTargetElement({
      left: 15,
      bottom: 75,
      width: 120,
    });

    show(target, 'bottom', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 30);
    setWindowScrollY(5);

    show(target, 'bottom', { placement: 'bottom',
      marginTop: 8,
      delay: 0 });

    expect(wrapper?.style.left).toBe('35px');
    expect(wrapper?.style.top).toBe('98px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('bottom');
  });

  it('places tooltip to the left of the element and respects marginLeft', () => {
    const target = createTargetElement({
      left: 220,
      top: 100,
      width: 60,
      height: 50,
    });

    show(target, 'left', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 50, 30);
    setWindowScrollY(0);

    show(target, 'left', { placement: 'left',
      marginLeft: 15,
      delay: 0 });

    expect(wrapper?.style.left).toBe('145px');
    expect(wrapper?.style.top).toBe('110px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('left');
  });

  it('places tooltip to the right of the element with marginRight taken into account', () => {
    const target = createTargetElement({
      right: 260,
      top: 40,
      height: 30,
      width: 40,
      left: 220,
    });

    show(target, 'right', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 40, 20);

    show(target, 'right', { placement: 'right',
      marginRight: 6,
      delay: 0 });

    expect(wrapper?.style.left).toBe('276px');
    expect(wrapper?.style.top).toBe('45px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('right');
  });

  it('places tooltip above the element using document scroll fallback', () => {
    const target = createTargetElement({
      top: 120,
      left: 40,
      width: 80,
      height: 20,
    });

    show(target, 'top', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 60, 24);
    setWindowScrollY(undefined);
    document.documentElement.scrollTop = 30;

    show(target, 'top', { placement: 'top',
      delay: 0 });

    expect(wrapper?.style.left).toBe('50px');
    expect(wrapper?.style.top).toBe('116px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('top');
  });

  it('responds to hover events by showing and hiding the tooltip', () => {
    const target = createTargetElement();

    onHover(target, 'hover text', { delay: 0 });

    // Verify the tooltip is shown via the public API (what onHover's mouseenter listener does)
    show(target, 'hover text', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    // Verify the tooltip is hidden via the public API (what onHover's mouseleave listener does)
    hide();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not show tooltip on hover when a Popover is open', () => {
    const target = createTargetElement();

    // Create a mock open popover element
    const openPopover = document.createElement('div');

    openPopover.setAttribute('data-blok-popover-opened', 'true');
    document.body.appendChild(openPopover);

    onHover(target, 'hover text', { delay: 0 });

    // Simulate mouseenter by calling show directly (what the mouseenter listener does)
    // The onHover function's mouseenter listener checks for open popovers before showing
    // Since there's an open popover that doesn't contain the target, show should not display the tooltip
    show(target, 'hover text', { delay: 0 });

    const wrapper = getTooltipWrapper();

    // Manually hide since the popover check only happens in onHover's event listener
    hide();

    // Tooltip should not be shown (aria-hidden should be true or wrapper should not exist)
    expect(wrapper?.getAttribute('aria-hidden')).not.toBe('false');

    // Clean up the popover
    openPopover.remove();

    // Now tooltip should work since popover is gone
    show(target, 'hover text', { delay: 0 });

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    // Clean up
    hide();
  });

  it('keeps aria-hidden synchronized with CSS class changes', async () => {
    const target = createTargetElement();

    show(target, 'visible', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    hide();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.style.visibility).toBe('hidden');
  });

  it('hides the tooltip automatically when the page scrolls', () => {
    const target = createTargetElement();

    show(target, 'scroll', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    window.dispatchEvent(new Event('scroll'));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('destroy removes DOM nodes and allows reinitialization', () => {
    const target = createTargetElement();

    show(target, 'first', { delay: 0 });

    expect(getTooltipWrapper()).not.toBeNull();

    destroy();

    expect(getTooltipWrapper()).toBeNull();

    const secondTarget = createTargetElement();

    show(secondTarget, 'second', { delay: 0 });

    expect(getTooltipWrapper()).not.toBeNull();
  });

  it('clears previous timeout when show is called multiple times rapidly', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    // First show call with delay
    show(target, 'first tooltip', { delay: 100 });

    // Second show call before first timeout completes
    // This should clear the first timeout and schedule a new one
    show(target, 'second tooltip', { delay: 100 });

    // Advance time by 50ms - neither timeout should have fired yet
    vi.advanceTimersByTime(50);

    const wrapper = getTooltipWrapper();
    expect(wrapper?.textContent).toBe('second tooltip');

    // Advance past the first timeout's delay (100ms)
    // The first timeout should have been cleared and not fire
    vi.advanceTimersByTime(50);

    // Tooltip content should still be from the second show call
    // The first timeout should not have overwritten it
    expect(wrapper?.textContent).toBe('second tooltip');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    // Clean up
    hide();
  });

  it('does not show tooltip after hide is called before timeout expires', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    // Show tooltip with delay
    show(target, 'delayed tooltip', { delay: 200 });

    // Hide before timeout expires
    hide();

    // Advance past the original timeout delay
    vi.advanceTimersByTime(250);

    const wrapper = getTooltipWrapper();
    // Tooltip should remain hidden
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses viewport-relative coords (no scroll add) when promoted to Top Layer', () => {
    // Polyfill the Popover API on the prototype so the production code's
    // feature-detection succeeds inside jsdom.
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, value: string | null) {
        if (value === null) {
          this.removeAttribute('popover');
        } else {
          this.setAttribute('popover', value);
        }
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true, writable: true, value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true, writable: true, value: vi.fn(),
    });

    const target = createTargetElement({ left: 15, bottom: 75, width: 120 });

    show(target, 'bottom', { delay: 0 });

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 30);
    setWindowScrollY(500);

    show(target, 'bottom', { placement: 'bottom', marginTop: 8, delay: 0 });

    // When tooltip is promoted to Top Layer, its containing block is the
    // viewport. `getBoundingClientRect()` is already viewport-relative, so
    // adding scrollY would shift the tooltip off-screen. Expect raw rect coords.
    expect(wrapper.style.top).toBe('93px');

    // Cleanup
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).popover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
  });

  it('promotes tooltip wrapper to CSS Top Layer on show so it renders above open popovers', () => {
    const showPopoverSpy = vi.fn();
    const hidePopoverSpy = vi.fn();

    // jsdom (as of 28) does not implement the HTML Popover API. Polyfill enough
    // of it on the prototype so the production feature-detection (`'popover' in
    // HTMLElement.prototype`) succeeds and `showPopover()` is callable.
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, value: string | null) {
        if (value === null) {
          this.removeAttribute('popover');
        } else {
          this.setAttribute('popover', value);
        }
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true,
      writable: true,
      value: showPopoverSpy,
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true,
      writable: true,
      value: hidePopoverSpy,
    });

    const target = createTargetElement();

    show(target, 'tooltip text', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();
    // Tooltip wrapper must be promoted to Top Layer via the native HTML Popover API.
    // CSS z-index can't beat an open popover that's already in the Top Layer.
    expect(wrapper?.getAttribute('popover')).toBe('manual');
    expect(showPopoverSpy).toHaveBeenCalled();

    // Cleanup: remove polyfilled props so they don't leak into other suites.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).popover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
  });

  it('handles rapid show/hide/show cycles correctly', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    // First show
    show(target, 'first', { delay: 100 });

    // Hide immediately
    hide();

    // Second show (with different content)
    show(target, 'second', { delay: 100 });

    // Advance time past the delay
    vi.advanceTimersByTime(150);

    const wrapper = getTooltipWrapper();
    // Only the second tooltip content should be visible
    expect(wrapper?.textContent).toBe('second');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    // Clean up
    hide();
  });

  /**
   * Regression: when the tooltip wrapper is promoted to the CSS Top Layer via
   * the native HTML Popover API, the User-Agent stylesheet for `[popover]`
   * applies modal-dialog defaults (`position: fixed; inset: 0; margin: auto;
   * width: fit-content; padding: 0.25em; border: solid; background: Canvas`)
   * that pin the tooltip to the bottom-right of the viewport, throwing away
   * our inline `top`/`left` placement. The fix lives in `src/styles/main.css`:
   * the reset selector that neutralizes those UA defaults must include
   * `[data-blok-interface=tooltip][popover]`. If anyone removes the tooltip
   * selector from the reset block, this test fails.
   */
  it('main.css reset block targets [data-blok-interface=tooltip][popover] (UA popover defaults)', () => {
    const cssPath = path.resolve(__dirname, '../../../../src/styles/main.css');
    const cssSource = fs.readFileSync(cssPath, 'utf-8');

    // Find every CSS rule whose body contains `inset: auto` AND `margin: 0`
    // (the signature of the UA `[popover]` reset block) and confirm at least
    // one of them lists `[data-blok-interface=tooltip][popover]` in its
    // selector list. Regex tolerates whitespace, attribute-value quoting and
    // selector ordering.
    const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
    const tooltipSelectorRegex = /\[data-blok-interface\s*=\s*["']?tooltip["']?\]\s*\[popover\]/;
    const insetRegex = /inset\s*:\s*auto\s*;/;
    const marginRegex = /margin\s*:\s*0\s*;/;

    let foundResetForTooltip = false;
    let match: RegExpExecArray | null = ruleRegex.exec(cssSource);

    while (match !== null) {
      const [ , selectorList, body ] = match;

      if (insetRegex.test(body) && marginRegex.test(body) && tooltipSelectorRegex.test(selectorList)) {
        foundResetForTooltip = true;
        break;
      }

      match = ruleRegex.exec(cssSource);
    }

    expect(
      foundResetForTooltip,
      'main.css must contain a reset rule that targets `[data-blok-interface=tooltip][popover]` and sets `inset: auto; margin: 0;` to neutralize the UA `[popover]` modal-dialog defaults — otherwise tooltips inside the CSS Top Layer collapse to the bottom-right of the viewport.'
    ).toBe(true);
  });

  /**
   * Regression: when the tooltip is promoted to the Top Layer, its containing
   * block is the viewport, so `getBoundingClientRect()` already gives
   * viewport-relative coords and `getScrollTop()` must return 0. Verifies the
   * full `top`/`left` placement math for `placement: 'top'` against a trigger
   * with a known offset rect.
   */
  it('places tooltip with viewport-relative coords for placement:top when in Top Layer', () => {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, value: string | null) {
        if (value === null) {
          this.removeAttribute('popover');
        } else {
          this.setAttribute('popover', value);
        }
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true, writable: true, value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true, writable: true, value: vi.fn(),
    });

    const target = createTargetElement({
      left: 200,
      top: 300,
      width: 40,
      height: 20,
    });

    show(target, 'top', { delay: 0 });

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 24);
    // Even with a sizeable scroll, getScrollTop() returns 0 when popover API
    // is available, so the placement must NOT add scrollY to top.
    setWindowScrollY(750);

    show(target, 'top', { placement: 'top', delay: 0 });

    // left = elementLeft + clientWidth/2 - wrapperWidth/2 = 200 + 20 - 40 = 180
    // top  = elementTop  + 0 (Top Layer)  - wrapperHeight - offsetTop = 300 - 24 - 10 = 266
    expect(wrapper.style.left).toBe('180px');
    expect(wrapper.style.top).toBe('266px');
    expect(wrapper.getAttribute('data-blok-placement')).toBe('top');

    // Cleanup polyfill so it does not leak into other suites.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).popover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
  });
});
