import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import { destroy, hide, HINT_DELAY, MIN_HINT_DELAY, onHover, show, showReadout } from '../../../../src/components/utils/tooltip';
import type { TooltipContent } from '../../../../src/components/utils/tooltip';
import { resyncPortalDirections } from '../../../../src/components/utils/portal-direction';

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

interface PopoverPolyfill {
  showPopover: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn>;
  /** Restores `HTMLElement.prototype` to its pre-polyfill shape. */
  restore: () => void;
}

const POPOVER_PROPS = ['popover', 'showPopover', 'hidePopover'] as const;

/**
 * jsdom does not implement the HTML Popover API. This installs a minimal
 * polyfill on `HTMLElement.prototype` so the production feature-detection
 * (`'popover' in HTMLElement.prototype`) succeeds and `showPopover()` is
 * callable. The returned `restore()` reinstates the original prototype
 * descriptors (or removes the props via `Reflect.deleteProperty` when none
 * existed) so the polyfill cannot leak into other suites.
 */
const installPopoverPolyfill = (): PopoverPolyfill => {
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

  for (const prop of POPOVER_PROPS) {
    originalDescriptors.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
  }

  const showPopover = vi.fn();
  const hidePopover = vi.fn();

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
    configurable: true, writable: true, value: showPopover,
  });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
    configurable: true, writable: true, value: hidePopover,
  });

  const restore = (): void => {
    for (const prop of POPOVER_PROPS) {
      const original = originalDescriptors.get(prop);

      if (original === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, prop);
      } else {
        Object.defineProperty(HTMLElement.prototype, prop, original);
      }
    }
  };

  return { showPopover, hidePopover, restore };
};

/**
 * Scans raw `main.css` source for a CSS rule whose selector targets
 * `[data-blok-top-layer][popover]` and whose body resets the UA popover
 * modal-dialog defaults (`inset: auto; margin: 0;`). Returns true when such a
 * reset rule exists. Kept outside the test body so the matching loop holds no
 * in-test branching.
 */
const hasTopLayerPopoverReset = (cssSource: string): boolean => {
  const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
  const markerSelectorRegex = /\[data-blok-top-layer\]\s*\[popover\]/;
  const insetRegex = /inset\s*:\s*auto\s*;/;
  const marginRegex = /margin\s*:\s*0\s*;/;

  const rules = [...cssSource.matchAll(ruleRegex)];

  return rules.some(([ , selectorList, body ]) =>
    insetRegex.test(body) && marginRegex.test(body) && markerSelectorRegex.test(selectorList)
  );
};

describe('Tooltip utility', () => {
  let popoverPolyfill: PopoverPolyfill | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    popoverPolyfill?.restore();
    popoverPolyfill = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('syncs the singleton direction from every trigger so RTL and LTR editors cannot leak into each other', () => {
    const rtlTarget = createTargetElement();
    const ltrTarget = createTargetElement();

    rtlTarget.style.direction = 'rtl';
    ltrTarget.style.direction = 'ltr';

    showReadout(rtlTarget, 'راهنما');

    const wrapper = getTooltipWrapper();

    expect(wrapper).toHaveAttribute('dir', 'rtl');
    expect(wrapper?.style.getPropertyValue('direction')).toBe('rtl');
    expect(wrapper?.style.getPropertyPriority('direction')).toBe('important');

    showReadout(ltrTarget, 'Help');

    expect(wrapper).toHaveAttribute('dir', 'ltr');
    expect(wrapper?.style.getPropertyValue('direction')).toBe('ltr');
    expect(wrapper?.style.getPropertyPriority('direction')).toBe('important');

    showReadout(rtlTarget, 'راهنما');

    expect(wrapper).toHaveAttribute('dir', 'rtl');
    expect(wrapper?.style.getPropertyValue('direction')).toBe('rtl');
    expect(wrapper?.style.getPropertyPriority('direction')).toBe('important');
  });

  it('hides an open tooltip when its editor flips direction, since the anchor moved', () => {
    const editor = document.createElement('div');
    const target = createTargetElement();

    editor.setAttribute('data-blok-editor', '');
    editor.style.direction = 'ltr';
    editor.appendChild(target);
    document.body.appendChild(editor);
    showReadout(target, 'Help');
    expect(getTooltipWrapper()).toHaveAttribute('data-blok-shown', 'true');

    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(getTooltipWrapper()).toHaveAttribute('data-blok-shown', 'false');
  });

  it('uses position: fixed so Top-Layer placement is viewport-relative', () => {
    /**
     * Regression: when promoted to the CSS Top Layer (popover="manual" +
     * showPopover), the wrapper's containing block becomes the viewport ONLY
     * when it is positioned via `fixed` (or a top-layer-specific containing
     * block). With `position: absolute`, Chrome still resolves the wrapper's
     * containing block to the initial containing block (document) — so inline
     * `style.top = "<viewport-Y>px"` renders <scrollY> px too high whenever
     * the user has scrolled the page. That made the "Alignment" tooltip on
     * the image block jump up to overlap earlier icons once the page was
     * scrolled, because placement math (correctly) produces viewport-Y but
     * the CSS rendered it as document-Y.
     *
     * Pinning `fixed` here prevents any future refactor from re-introducing
     * the scroll-offset ghost.
     */
    const target = createTargetElement();

    showReadout(target, 'fixed-check');

    const wrapper = getTooltipWrapper();
    const classes = Array.from(wrapper?.classList ?? []);

    expect(classes).toContain('fixed');
    expect(classes).not.toContain('absolute');
  });

  it('never intercepts pointer events (click-transparency contract)', () => {
    /**
     * Regression: the bubble used to receive pointer events so the pointer
     * could travel onto it without dismissing (hoverable-bubble design). But
     * all blok tooltips carry static text, and a hoverable bubble placed over
     * dense control grids (color picker swatch rows) swallowed single clicks
     * on the controls it covered — users could not change an existing
     * highlight color because the active swatch's tooltip covered the
     * Default swatch above it. Text-only tooltips must be click-transparent.
     *
     * The rule must be an INLINE `!important` style — a `pointer-events-none`
     * utility class is wiped by the Top-Layer reset
     * (`[data-blok-top-layer][popover] { all: initial !important }`), just
     * like the visibility handling in updateTooltipVisibility().
     */
    const target = createTargetElement();

    showReadout(target, 'pointer-check');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.style.getPropertyValue('pointer-events')).toBe('none');
    expect(wrapper?.style.getPropertyPriority('pointer-events')).toBe('important');
  });

  it('stays click-transparent across the full show/hide lifecycle', () => {
    /**
     * Companion to the click-transparency contract: prepare() sets the inline
     * rule once, but hide()/reveal() rewrite other inline properties on the
     * same style declaration (visibility via updateTooltipVisibility, left/top
     * via applyPlacement). If any future refactor rewrites the declaration
     * wholesale (e.g. `style.cssText = ...`) or re-creates the wrapper without
     * the rule, the bubble silently becomes a click shield again — for EVERY
     * tooltip trigger, not just the color picker. Pin the invariant at every
     * lifecycle stage.
     */
    const expectTransparent = (stage: string): void => {
      const wrapper = getTooltipWrapper();

      expect(wrapper?.style.getPropertyValue('pointer-events'), stage).toBe('none');
      expect(wrapper?.style.getPropertyPriority('pointer-events'), stage).toBe('important');
    };

    const target = createTargetElement();

    showReadout(target, 'lifecycle-check');
    expectTransparent('after show');

    hide();
    expectTransparent('after hide');

    showReadout(target, 'lifecycle-check-again');
    expectTransparent('after re-show');
  });

  it('hides after the trigger is left even when the pointer lands on the bubble', () => {
    /**
     * Companion to the pointer-events contract: the old bubble-hover pinning
     * (mouseenter on the wrapper cancelling the grace hide) kept the tooltip
     * open indefinitely under the pointer, turning it into a persistent click
     * shield. With a click-transparent bubble the wrapper receives no mouse
     * events, so a mouseenter dispatched at it must NOT cancel the pending
     * grace hide.
     */
    vi.useFakeTimers();

    const target = createTargetElement();

    onHover(target, 'grace-check');
    target.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('data-state')).toBe('open');

    // Pointer leaves the trigger and "lands on" the bubble.
    target.dispatchEvent(new Event('mouseleave'));
    wrapper?.dispatchEvent(new Event('mouseenter'));

    // After the grace period the tooltip must hide regardless.
    vi.advanceTimersByTime(1000);

    expect(wrapper?.getAttribute('data-state')).toBe('closed');
  });

  it('has no transition or transform animation classes on the wrapper', () => {
    const target = createTargetElement();

    showReadout(target, 'No animation');

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
      showReadout(target, `${placement} tooltip`, { placement });

      const wrapper = getTooltipWrapper();
      const classes = Array.from(wrapper?.classList ?? []);

      // Should not have any translate classes (the slide-in offset)
      const hasTranslate = classes.some(cls => cls.startsWith('translate') || cls.startsWith('-translate'));

      expect(hasTranslate, `placement "${placement}" should not have translate classes`).toBe(false);

      hide();
    }
  });

  it('renders tooltip content, accessible attributes', () => {
    const target = createTargetElement();

    showReadout(target, 'Tooltip text');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();
    expect(wrapper?.textContent).toBe('Tooltip text');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.getAttribute(DATA_ATTR.interface)).toBe(TOOLTIP_INTERFACE_VALUE);
    expect(wrapper?.getAttribute('role')).toBe('tooltip');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.style.visibility).toBe('visible');

    showReadout(target, 'New text');

    expect(wrapper?.textContent).toBe('New text');
  });

  it('accepts DOM nodes as content without cloning them', () => {
    const target = createTargetElement();
    const customContent = document.createElement('div');

    customContent.setAttribute('data-blok-testid', 'content');
    customContent.textContent = 'node content';

    showReadout(target, customContent);

    const wrapper = getTooltipWrapper();
    const contentHolder = wrapper?.querySelector('[data-blok-testid="tooltip-content"]');

    expect(contentHolder?.contains(customContent)).toBe(true);
  });

  it('throws when content is not a string or Node', () => {
    const target = createTargetElement();

    expect(() => {
      show(target, 123 as unknown as TooltipContent);
    }).toThrow('[Blok Tooltip] Wrong type of «content» passed. It should be an instance of Node or String. But number given.');
  });

  it('places tooltip below the element independent of page scroll', () => {
    const target = createTargetElement({
      left: 15,
      bottom: 75,
      width: 120,
    });

    showReadout(target, 'bottom');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 30);
    setWindowScrollY(5);

    showReadout(target, 'bottom', { placement: 'bottom',
      marginTop: 8 });

    /**
     * Wrapper is `position: fixed` and `getBoundingClientRect()` is already
     * viewport-relative, so `scrollY` must NOT be added here. Before the
     * switch to `fixed`, this test expected `98px` (= 75 + 5 + 10 + 8); the
     * `5` was the scroll offset that now lives implicitly in the fixed
     * layout. Expected value today = 75 + 10 + 8 = 93.
     */
    expect(wrapper?.style.left).toBe('35px');
    expect(wrapper?.style.top).toBe('93px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('bottom');
  });

  it('places tooltip to the left of the element and respects marginLeft', () => {
    const target = createTargetElement({
      left: 220,
      top: 100,
      width: 60,
      height: 50,
    });

    showReadout(target, 'left');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 50, 30);
    setWindowScrollY(0);

    showReadout(target, 'left', { placement: 'left',
      marginLeft: 15 });

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

    showReadout(target, 'right');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 40, 20);

    showReadout(target, 'right', { placement: 'right',
      marginRight: 6 });

    expect(wrapper?.style.left).toBe('276px');
    expect(wrapper?.style.top).toBe('45px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('right');
  });

  it('places tooltip above the element independent of document scroll', () => {
    const target = createTargetElement({
      top: 120,
      left: 40,
      width: 80,
      height: 20,
    });

    showReadout(target, 'top');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 60, 24);
    setWindowScrollY(undefined);
    document.documentElement.scrollTop = 30;

    showReadout(target, 'top', { placement: 'top' });

    /**
     * Fixed positioning means the `scrollTop` fallback branch is a no-op:
     * `getBoundingClientRect()` already gives viewport-Y, and a fixed
     * wrapper anchors to the viewport. Expected top = 120 − 24 − 10 = 86.
     */
    expect(wrapper?.style.left).toBe('50px');
    expect(wrapper?.style.top).toBe('86px');
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('top');
  });

  it('responds to hover events by showing and hiding the tooltip', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    onHover(target, 'hover text');
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.textContent).toBe('hover text');

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not show tooltip on hover when a Popover is open', () => {
    vi.useFakeTimers();

    const target = createTargetElement();
    const openPopover = document.createElement('div');

    openPopover.setAttribute('data-blok-popover-opened', 'true');
    document.body.appendChild(openPopover);

    onHover(target, 'hover text');
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).not.toBe('false');

    openPopover.remove();

    // With the popover gone the same hover shows the hint.
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    hide();
  });

  // A quick hover-then-click opens the trigger's menu before the hover delay runs out.
  it('does not reveal a delayed tooltip once a Popover has opened during the delay', () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);

    const target = createTargetElement();
    const openPopover = document.createElement('div');

    onHover(target, 'hover text', { delay: 400 });
    target.dispatchEvent(new Event('mouseenter'));
    openPopover.setAttribute('data-blok-popover-opened', 'true');
    document.body.appendChild(openPopover);
    vi.advanceTimersByTime(500);

    expect(getTooltipWrapper()?.getAttribute('data-blok-shown')).not.toBe('true');

    openPopover.remove();
    hide();
  });

  it('keeps aria-hidden synchronized with CSS class changes', async () => {
    const target = createTargetElement();

    showReadout(target, 'visible');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    hide();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.style.visibility).toBe('hidden');
  });

  it('hides the tooltip automatically when the page scrolls', () => {
    const target = createTargetElement();

    showReadout(target, 'scroll');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    window.dispatchEvent(new Event('scroll'));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides the tooltip when a nested scroll container scrolls', () => {
    const scrollContainer = document.createElement('div');
    const target = createTargetElement();

    scrollContainer.appendChild(target);
    document.body.appendChild(scrollContainer);
    showReadout(target, 'nested scroll');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    // Native scroll events do not bubble. The global listener must observe
    // them during capture or a fixed tooltip remains detached from its anchor.
    scrollContainer.dispatchEvent(new Event('scroll'));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('destroy removes DOM nodes and allows reinitialization', () => {
    const target = createTargetElement();

    show(target, 'first');

    expect(getTooltipWrapper()).not.toBeNull();

    destroy();

    expect(getTooltipWrapper()).toBeNull();

    const secondTarget = createTargetElement();

    show(secondTarget, 'second');

    expect(getTooltipWrapper()).not.toBeNull();
  });

  it('clears previous timeout when show is called multiple times rapidly', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    show(target, 'first tooltip', { delay: MIN_HINT_DELAY });
    vi.advanceTimersByTime(100);

    // Replaces the first timer; this one fires 100ms after the first would have.
    show(target, 'second tooltip', { delay: MIN_HINT_DELAY });
    vi.advanceTimersByTime(MIN_HINT_DELAY - 100);

    const wrapper = getTooltipWrapper();

    // The first timer's deadline has passed: it must not have fired.
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(100);

    expect(wrapper?.textContent).toBe('second tooltip');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    hide();
  });

  it('does not show tooltip after hide is called before timeout expires', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    show(target, 'delayed tooltip');
    hide();

    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();
    // Tooltip should remain hidden
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses viewport-relative coords (no scroll add) when promoted to Top Layer', () => {
    // Polyfill the Popover API on the prototype so the production code's
    // feature-detection succeeds inside jsdom.
    popoverPolyfill = installPopoverPolyfill();

    const target = createTargetElement({ left: 15, bottom: 75, width: 120 });

    showReadout(target, 'bottom');

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 30);
    setWindowScrollY(500);

    showReadout(target, 'bottom', { placement: 'bottom', marginTop: 8 });

    // When tooltip is promoted to Top Layer, its containing block is the
    // viewport. `getBoundingClientRect()` is already viewport-relative, so
    // adding scrollY would shift the tooltip off-screen. Expect raw rect coords.
    expect(wrapper.style.top).toBe('93px');
  });

  it('promotes tooltip wrapper to CSS Top Layer on show so it renders above open popovers', () => {
    // jsdom (as of 28) does not implement the HTML Popover API. Polyfill enough
    // of it on the prototype so the production feature-detection (`'popover' in
    // HTMLElement.prototype`) succeeds and `showPopover()` is callable.
    popoverPolyfill = installPopoverPolyfill();

    const { showPopover: showPopoverSpy } = popoverPolyfill;

    const target = createTargetElement();

    showReadout(target, 'tooltip text');

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();
    // Tooltip wrapper must be promoted to Top Layer via the native HTML Popover API.
    // CSS z-index can't beat an open popover that's already in the Top Layer.
    expect(wrapper?.getAttribute('popover')).toBe('manual');
    expect(showPopoverSpy).toHaveBeenCalled();
  });

  it('handles rapid show/hide/show cycles correctly', () => {
    vi.useFakeTimers();
    const target = createTargetElement();

    show(target, 'first');
    hide();
    show(target, 'second');

    vi.advanceTimersByTime(HINT_DELAY);

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
   * the reset selector keys off the `data-blok-top-layer` marker that the
   * centralized helper (`src/components/utils/top-layer.ts`) sets on every
   * promoted element. The deeper structural assertions live in
   * `test/unit/styles/top-layer-css.test.ts`; this test verifies the tooltip
   * happens to inherit the marker-driven safety net.
   */
  it('main.css reset block targets [data-blok-top-layer][popover] (UA popover defaults)', () => {
    const cssPath = path.resolve(__dirname, '../../../../src/styles/main.css');
    const cssSource = fs.readFileSync(cssPath, 'utf-8');

    const foundReset = hasTopLayerPopoverReset(cssSource);

    expect(
      foundReset,
      'main.css must contain a reset rule that targets `[data-blok-top-layer][popover]` and sets `inset: auto; margin: 0;` so every Top-Layer-promoted blok element (including the tooltip) escapes the UA `[popover]` modal-dialog defaults.'
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
    popoverPolyfill = installPopoverPolyfill();

    const target = createTargetElement({
      left: 200,
      top: 300,
      width: 40,
      height: 20,
    });

    showReadout(target, 'top');

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 80, 24);
    // Even with a sizeable scroll, getScrollTop() returns 0 when popover API
    // is available, so the placement must NOT add scrollY to top.
    setWindowScrollY(750);

    showReadout(target, 'top', { placement: 'top' });

    // left = elementLeft + clientWidth/2 - wrapperWidth/2 = 200 + 20 - 40 = 180
    // top  = elementTop  + 0 (Top Layer)  - wrapperHeight - offsetTop = 300 - 24 - 10 = 266
    expect(wrapper.style.left).toBe('180px');
    expect(wrapper.style.top).toBe('266px');
    expect(wrapper.getAttribute('data-blok-placement')).toBe('top');
  });

  it('links the target to the tooltip via aria-describedby on show and clears it on hide', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    show(target, 'described');
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.id).toBe('blok-tooltip');
    expect(target.getAttribute('aria-describedby')).toBe('blok-tooltip');

    hide();

    expect(target.hasAttribute('aria-describedby')).toBe(false);
  });

  it('hides the tooltip on a capture-phase Escape keydown without preventing default', () => {
    const target = createTargetElement();

    showReadout(target, 'escape me');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('data-blok-shown')).toBe('true');

    const event = new KeyboardEvent('keydown', { key: 'Escape',
      bubbles: true,
      cancelable: true });

    document.dispatchEvent(event);

    expect(wrapper?.getAttribute('data-blok-shown')).toBe('false');
    // Escape must NOT be swallowed — menus/popovers still need to receive it.
    expect(event.defaultPrevented).toBe(false);
  });

  it('flips a bottom-placed tooltip to top when it would overflow the viewport bottom (collision flip)', () => {
    const target = createTargetElement({
      top: 730,
      bottom: 760,
      height: 30,
      left: 100,
      width: 80,
    });

    showReadout(target, 'flip');

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    // A tall tooltip cannot fit in the ~8px below the near-bottom trigger,
    // but fits comfortably above → it must flip to `top`.
    setWrapperSize(wrapper, 80, 100);

    showReadout(target, 'flip', { placement: 'bottom' });

    expect(wrapper.getAttribute('data-blok-placement')).toBe('top');
    expect(wrapper.getAttribute('data-side')).toBe('top');
    // top = triggerTop(730) − offset(10) − wrapperHeight(100) = 620
    expect(wrapper.style.top).toBe('620px');
  });

  it('clamps a bottom-placed tooltip horizontally so it stays within the viewport', () => {
    const target = createTargetElement({
      left: 1000,
      right: 1100,
      width: 100,
      top: 20,
      bottom: 60,
      height: 40,
    });

    showReadout(target, 'clamp');

    const wrapper = getTooltipWrapper();

    if (wrapper === null) {
      throw new Error('Tooltip wrapper should exist');
    }

    setWrapperSize(wrapper, 200, 30);

    showReadout(target, 'clamp', { placement: 'bottom' });

    // Raw left = triggerLeft(1000) + clientWidth/2(50) − wrapperWidth/2(100) = 950;
    // right edge 950 + 200 = 1150 > viewport width 1024 → clamp to 1024 − 200 = 824.
    expect(wrapper.style.left).toBe('824px');
    // Placement is unchanged (fits vertically) so data-side mirrors the request.
    expect(wrapper.getAttribute('data-side')).toBe('bottom');
  });

  it('stamps data-side reflecting the resolved placement', () => {
    const target = createTargetElement();

    showReadout(target, 'side', { placement: 'right' });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('data-side')).toBe('right');
  });

  it('toggles data-state between open (shown) and closed (hidden)', () => {
    const target = createTargetElement();

    showReadout(target, 'state');

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('data-state')).toBe('open');

    hide();

    expect(wrapper?.getAttribute('data-state')).toBe('closed');
  });

  it('does not reveal on hover when the pointer type is touch (touch guard)', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    onHover(target, 'touchy');

    target.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch',
      bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).not.toBe('false');
  });

  it('reveals on hover when the pointer type is mouse', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    onHover(target, 'mousey');

    target.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse',
      bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    hide();
  });

  it('hides the tooltip after the grace window when the pointer leaves the target without entering the bubble', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    onHover(target, 'grace-out');

    target.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse',
      bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // Still shown immediately after leaving — the hide is deferred by the grace timer.
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    vi.advanceTimersByTime(150);

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('cancels a pending grace hide when a new delayed show starts (stale grace timer must not kill the delayed show)', () => {
    vi.useFakeTimers();

    const triggerA = createTargetElement();
    const triggerB = createTargetElement();

    onHover(triggerA, 'tooltip A');

    // Sweep over A: leave before its hint opens. This arms A's grace hide
    // while nothing is shown, so show(B) takes no hide() path of its own.
    triggerA.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse',
      bubbles: true }));
    triggerA.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    triggerA.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // If A's grace hide survived, it would fire mid-delay and clear B's timer.
    show(triggerB, 'tooltip B', { delay: MIN_HINT_DELAY });

    vi.advanceTimersByTime(MIN_HINT_DELAY);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.textContent).toBe('tooltip B');

    hide();
  });

  it('destroy() disables trigger handlers so they cannot re-open the tooltip or re-register the document keydown listener', () => {
    const target = createTargetElement();

    onHover(target, 'destroyed');

    destroy();

    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    target.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse',
      bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(getTooltipWrapper()).toBeNull();

    const keydownRegistered = addEventListenerSpy.mock.calls.some(([ type ]) => type === 'keydown');

    expect(keydownRegistered).toBe(false);
  });

  it('promotes the wrapper to the Top Layer even on the delayed show path', () => {
    vi.useFakeTimers();
    popoverPolyfill = installPopoverPolyfill();

    const { showPopover: showPopoverSpy } = popoverPolyfill;

    const target = createTargetElement();

    show(target, 'delayed promote');

    // Nothing promoted yet — the reveal is still pending behind the delay.
    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(showPopoverSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('popover')).toBe('manual');
    expect(showPopoverSpy).toHaveBeenCalled();

    hide();
  });

  /**
   * Regression: picking an emoji in the callout picker parked the tooltip in
   * the viewport's top-left corner. `EmojiPicker.close()` hides its root
   * (`hidden = true`), so every emoji button inside it loses its layout box.
   * A reveal that lands at/after that moment measured an all-zero rect, and
   * `applyPlacement`'s viewport clamp turned the resulting negative `left`
   * into `left: 0; top: 10` — a bubble stuck in the corner instead of no
   * bubble at all. An anchor with no layout box can't be pointed at, so the
   * tooltip must decline rather than guess coordinates.
   */
  it('declines to anchor to a trigger that has no layout box', () => {
    const target = createTargetElement();

    showReadout(target, 'visible anchor');

    const wrapper = getTooltipWrapper();

    expect(wrapper).toHaveAttribute('data-blok-shown', 'true');

    // The picker that owns this trigger just hid itself.
    const hiddenTarget = createTargetElement();

    hiddenTarget.checkVisibility = vi.fn(() => false);

    show(hiddenTarget, 'hidden anchor');

    expect(wrapper).toHaveAttribute('data-blok-shown', 'false');
    expect(wrapper?.style.left).not.toBe('0px');
  });

  it('declines to anchor to a trigger detached from the document', () => {
    const target = createTargetElement();

    showReadout(target, 'visible anchor');

    const wrapper = getTooltipWrapper();

    expect(wrapper).toHaveAttribute('data-blok-shown', 'true');

    const detached = createTargetElement();

    detached.remove();

    show(detached, 'detached anchor');

    expect(wrapper).toHaveAttribute('data-blok-shown', 'false');
  });

  it('drops a delayed reveal whose trigger lost its layout box while the delay ran', () => {
    vi.useFakeTimers();

    const target = createTargetElement();

    show(target, 'delayed');

    // The owning surface closes before the delay elapses.
    target.checkVisibility = vi.fn(() => false);

    vi.advanceTimersByTime(HINT_DELAY);

    expect(getTooltipWrapper()).toHaveAttribute('data-blok-shown', 'false');
  });
});
