import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_INTERFACE_ATTRIBUTE, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import { destroy, hide, onHover, show } from '../../../../src/components/utils/tooltip';
import type { TooltipContent } from '../../../../src/components/utils/tooltip';

const { fakeCssContent } = vi.hoisted(() => ({
  fakeCssContent: '.tooltip{ color: #000; }',
}));

vi.mock('../../../../src/styles/tooltip.css?inline', () => ({
  default: fakeCssContent,
}));

const tooltipSelector = `[${DATA_INTERFACE_ATTRIBUTE}="${TOOLTIP_INTERFACE_VALUE}"]`;

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

  delete (window as unknown as { scrollY?: number }).scrollY;
};

describe('Tooltip utility', () => {
  afterEach(() => {
    const wrapper = getTooltipWrapper();

    if (wrapper) {
      destroy();
    }

    document.getElementById('codex-tooltips-style')?.remove();
    document.body.innerHTML = '';
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    document.body.scrollTop = 0;
    setWindowScrollY(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders tooltip content, accessible attributes, and injects CSS only once', () => {
    const target = createTargetElement();

    show(target, 'Tooltip text', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper).not.toBeNull();
    expect(wrapper?.textContent).toBe('Tooltip text');
    expect(wrapper?.classList.contains('ct--shown')).toBe(true);
    expect(wrapper?.getAttribute(DATA_INTERFACE_ATTRIBUTE)).toBe(TOOLTIP_INTERFACE_VALUE);
    expect(wrapper?.getAttribute('role')).toBe('tooltip');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');
    expect(wrapper?.style.visibility).toBe('visible');

    show(target, 'New text', { delay: 0 });

    expect(wrapper?.textContent).toBe('New text');

    const styles = document.querySelectorAll('#codex-tooltips-style');

    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(fakeCssContent);
  });

  it('accepts DOM nodes as content without cloning them', () => {
    const target = createTargetElement();
    const customContent = document.createElement('div');

    customContent.dataset.testid = 'content';
    customContent.textContent = 'node content';

    show(target, customContent, { delay: 0 });

    const wrapper = getTooltipWrapper();
    const contentHolder = wrapper?.querySelector('.ct__content');

    expect(contentHolder?.contains(customContent)).toBe(true);
  });

  it('throws when content is not a string or Node', () => {
    const target = createTargetElement();

    expect(() => {
      show(target, 123 as unknown as TooltipContent, { delay: 0 });
    }).toThrow('[CodeX Tooltip] Wrong type of «content» passed. It should be an instance of Node or String. But number given.');
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

    setWrapperSize(wrapper!, 80, 30);
    setWindowScrollY(5);

    show(target, 'bottom', { placement: 'bottom',
      marginTop: 8,
      delay: 0 });

    expect(wrapper?.style.left).toBe('35px');
    expect(wrapper?.style.top).toBe('98px');
    expect(wrapper?.classList.contains('ct--bottom')).toBe(true);
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

    setWrapperSize(wrapper!, 50, 30);
    setWindowScrollY(0);

    show(target, 'left', { placement: 'left',
      marginLeft: 15,
      delay: 0 });

    expect(wrapper?.style.left).toBe('145px');
    expect(wrapper?.style.top).toBe('110px');
    expect(wrapper?.classList.contains('ct--left')).toBe(true);
    expect(wrapper?.classList.contains('ct--right')).toBe(false);
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

    setWrapperSize(wrapper!, 40, 20);

    show(target, 'right', { placement: 'right',
      marginRight: 6,
      delay: 0 });

    expect(wrapper?.style.left).toBe('276px');
    expect(wrapper?.style.top).toBe('45px');
    expect(wrapper?.classList.contains('ct--right')).toBe(true);
    expect(wrapper?.classList.contains('ct--left')).toBe(false);
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

    setWrapperSize(wrapper!, 60, 24);
    setWindowScrollY(undefined);
    document.documentElement!.scrollTop = 30;

    show(target, 'top', { placement: 'top',
      delay: 0 });

    expect(wrapper?.style.left).toBe('50px');
    expect(wrapper?.style.top).toBe('116px');
    expect(wrapper?.classList.contains('ct--top')).toBe(true);
  });

  it('delays hiding when hidingDelay is set but respects skip flag', () => {
    const target = createTargetElement();
    const wrapperText = 'delayed';

    vi.useFakeTimers();

    show(target, wrapperText, { delay: 0,
      hidingDelay: 50 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.classList.contains('ct--shown')).toBe(true);

    hide();

    expect(wrapper?.classList.contains('ct--shown')).toBe(true);

    vi.advanceTimersByTime(49);
    expect(wrapper?.classList.contains('ct--shown')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(wrapper?.classList.contains('ct--shown')).toBe(false);

    show(target, wrapperText, { delay: 0,
      hidingDelay: 50 });
    hide(true);
    expect(wrapper?.classList.contains('ct--shown')).toBe(false);
  });

  it('responds to hover events by showing and hiding the tooltip', () => {
    const target = createTargetElement();

    onHover(target, 'hover text', { delay: 0 });

    target.dispatchEvent(new Event('mouseenter'));

    const wrapper = getTooltipWrapper();

    expect(wrapper?.classList.contains('ct--shown')).toBe(true);

    target.dispatchEvent(new Event('mouseleave'));

    expect(wrapper?.classList.contains('ct--shown')).toBe(false);
  });

  it('keeps aria-hidden synchronized with CSS class changes', async () => {
    const target = createTargetElement();

    show(target, 'visible', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.getAttribute('aria-hidden')).toBe('false');

    wrapper?.classList.remove('ct--shown');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.style.visibility).toBe('hidden');
  });

  it('hides the tooltip automatically when the page scrolls', () => {
    const target = createTargetElement();

    show(target, 'scroll', { delay: 0 });

    const wrapper = getTooltipWrapper();

    expect(wrapper?.classList.contains('ct--shown')).toBe(true);

    window.dispatchEvent(new Event('scroll'));

    expect(wrapper?.classList.contains('ct--shown')).toBe(false);
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
