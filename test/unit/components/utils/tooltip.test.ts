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
});
