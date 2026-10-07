import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PREVIEW_CARD_WIDTH, PREVIEW_OPEN_DELAY, ToolboxPreview } from '../../../../src/components/ui/toolbox-preview';
import type { ToolboxPreviewConfig } from '../../../../types';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const makeAnchors = (surfaceLeft = 100): { surface: HTMLElement; item: HTMLElement } => {
  const surface = document.createElement('div');
  const item = document.createElement('div');

  surface.appendChild(item);
  document.body.appendChild(surface);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(rect(surfaceLeft, 50, 300, 400));
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(surfaceLeft + 4, 120, 292, 32));

  return { surface, item };
};

const config = (text = 'drawing'): ToolboxPreviewConfig => ({
  render: () => {
    const el = document.createElement('div');

    el.textContent = text;
    el.setAttribute('data-testid', 'drawing');

    return el;
  },
  descriptionKey: 'toolbox.preview.columns',
  descriptionParams: { count: 3 },
});

const translate = (key: string, params?: Record<string, string | number>): string =>
  `${key}:${params?.count ?? ''}`;

const cardRoot = (): HTMLElement | null => document.querySelector('[data-blok-interface="block-preview"]');

const drawingText = (): string | null | undefined => cardRoot()?.querySelector('[data-testid="drawing"]')?.textContent;

describe('ToolboxPreview', () => {
  let preview: ToolboxPreview;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    preview = new ToolboxPreview({ translate });
  });

  afterEach(() => {
    preview.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for the pointer to rest before the first card opens', () => {
    const { surface, item } = makeAnchors();

    preview.show({ item, surface, config: config() });

    expect(cardRoot()?.hidden ?? true).toBe(true);

    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY);

    expect(cardRoot()?.hidden).toBe(false);
  });

  const openNow = (params: Parameters<ToolboxPreview['show']>[0]): void => {
    preview.show(params);
    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY);
  };

  it('shows the drawing and the translated caption', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config('hello') });

    const root = cardRoot();

    expect(root?.querySelector('[data-blok-preview-paper] [data-testid="drawing"]')?.textContent).toBe('hello');
    expect(root?.querySelector('[data-blok-preview-caption]')?.textContent).toBe('toolbox.preview.columns:3');
  });

  it('uses the plain description when there is no key', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: { render: config().render, description: 'Plain words' } });

    expect(cardRoot()?.querySelector('[data-blok-preview-caption]')?.textContent).toBe('Plain words');
  });

  it('is hidden from assistive tech and never takes the pointer', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });

    const root = cardRoot();

    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.inert).toBe(true);
    expect(root?.style.pointerEvents).toBe('none');
  });

  it('sits to the right of the menu, level with the row', () => {
    const { surface, item } = makeAnchors(100);

    openNow({ item, surface, config: config() });

    const root = cardRoot();

    expect(parseFloat(root?.style.left ?? '')).toBeGreaterThanOrEqual(400);
    expect(parseFloat(root?.style.top ?? '')).toBe(120);
  });

  it('flips to the left of the menu when the right side has no room', () => {
    const { surface, item } = makeAnchors(1200 - 300 - 20);

    openNow({ item, surface, config: config() });

    const left = parseFloat(cardRoot()?.style.left ?? '');

    expect(left + PREVIEW_CARD_WIDTH).toBeLessThanOrEqual(1200 - 300 - 20);
  });

  it('in RTL, takes the menu direction and sits to the left of the menu', () => {
    const { surface, item } = makeAnchors(600);

    surface.style.direction = 'rtl';
    openNow({ item, surface, config: config() });

    const root = cardRoot();

    expect(root?.getAttribute('dir')).toBe('rtl');
    expect(parseFloat(root?.style.left ?? '') + PREVIEW_CARD_WIDTH).toBeLessThanOrEqual(600);
    expect(root?.getAttribute('data-blok-preview-side')).toBe('left');
  });

  it('in RTL, flips to the right of the menu when the left side has no room', () => {
    const { surface, item } = makeAnchors(20);

    surface.style.direction = 'rtl';
    openNow({ item, surface, config: config() });

    expect(parseFloat(cardRoot()?.style.left ?? '')).toBeGreaterThanOrEqual(320);
  });

  it('stays closed when neither side has room', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    const { surface, item } = makeAnchors(10);

    openNow({ item, surface, config: config() });

    expect(cardRoot()?.hidden ?? true).toBe(true);
  });

  it('keeps the card open when its own row is reported again', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config('first') });
    preview.show({ item, surface, config: config('second') });

    expect(cardRoot()?.hidden).toBe(false);
    expect(drawingText()).toBe('second');
  });

  it('moves the open card to a new row and swaps its content at once', () => {
    const { surface, item } = makeAnchors();
    const next = document.createElement('div');

    surface.appendChild(next);
    vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(rect(104, 200, 292, 32));
    openNow({ item, surface, config: config('first') });
    preview.show({ item: next, surface, config: config('second') });

    expect(cardRoot()?.hidden).toBe(false);
    expect(drawingText()).toBe('second');
    expect(parseFloat(cardRoot()?.style.top ?? '')).toBe(200);
  });

  it('cancels a pending open when hidden first', () => {
    const { surface, item } = makeAnchors();

    preview.show({ item, surface, config: config() });
    preview.hide();
    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY * 2);

    expect(cardRoot()?.hidden ?? true).toBe(true);
  });

  it('waits the full delay again right after it closed', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    preview.hide();
    preview.show({ item, surface, config: config() });

    expect(cardRoot()?.hidden).toBe(true);

    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY);
    expect(cardRoot()?.hidden).toBe(false);
  });

  it('closes when the page scrolls', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    document.dispatchEvent(new Event('scroll'));

    expect(cardRoot()?.hidden).toBe(true);
  });

  it('keeps one open delay while the pointer moves across rows', () => {
    const { surface, item } = makeAnchors();
    const next = document.createElement('div');

    surface.appendChild(next);
    preview.show({ item, surface, config: config('first') });
    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY - 100);
    preview.show({ item: next, surface, config: config('second') });
    vi.advanceTimersByTime(100);

    expect(cardRoot()?.hidden).toBe(false);
    expect(cardRoot()?.querySelector('[data-testid="drawing"]')?.textContent).toBe('second');
  });

  it('reopens after the delay on the next pointer move over the row a page scroll closed it on', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    document.dispatchEvent(new Event('scroll'));
    item.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(cardRoot()?.hidden).toBe(true);

    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY);
    expect(cardRoot()?.hidden).toBe(false);
  });

  it('stays closed after a page scroll when the pointer moves off the row', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    document.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    vi.advanceTimersByTime(PREVIEW_OPEN_DELAY);

    expect(cardRoot()?.hidden).toBe(true);
  });

  it('stays open and follows the row when the menu list itself scrolls', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(104, 90, 292, 32));
    surface.dispatchEvent(new Event('scroll'));

    expect(cardRoot()?.hidden).toBe(false);
    expect(parseFloat(cardRoot()?.style.top ?? '')).toBe(90);
  });

  it('removes its root on destroy', () => {
    const { surface, item } = makeAnchors();

    openNow({ item, surface, config: config() });
    preview.destroy();

    expect(cardRoot()).toBeNull();
  });
});
