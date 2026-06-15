import { describe, it, expect, vi } from 'vitest';
import { renderEmbedOverlay, type EmbedOverlayOptions } from '../../../../src/tools/link/embed/overlay';

const baseOptions = (overrides: Partial<EmbedOverlayOptions> = {}): EmbedOverlayOptions => ({
  alignment: 'center',
  captionVisible: false,
  source: 'https://youtu.be/dQw4w9WgXcQ',
  i18n: { t: (key: string): string => key },
  onAlign: vi.fn(),
  onToggleCaption: vi.fn(),
  onCopyLink: vi.fn(),
  onReplace: vi.fn(),
  onDelete: vi.fn(),
  ...overrides,
});

const q = (root: HTMLElement, action: string): HTMLElement | null =>
  root.querySelector(`[data-action="${action}"]`);

describe('renderEmbedOverlay', () => {
  it('renders the overlay toolbar with the four controls', () => {
    const overlay = renderEmbedOverlay(baseOptions());

    expect(overlay.getAttribute('data-role')).toBe('embed-overlay');
    expect(q(overlay, 'align-trigger')).not.toBeNull();
    expect(q(overlay, 'caption-toggle')).not.toBeNull();
    expect(q(overlay, 'open-original')).not.toBeNull();
    expect(q(overlay, 'more')).not.toBeNull();
  });

  it('points "open original" at the source in a new tab', () => {
    const overlay = renderEmbedOverlay(baseOptions({ source: 'https://vimeo.com/123' }));
    const anchor = q(overlay, 'open-original');

    expect(anchor?.tagName).toBe('A');
    expect(anchor?.getAttribute('href')).toBe('https://vimeo.com/123');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
  });

  it('reflects caption visibility on the toggle', () => {
    const off = renderEmbedOverlay(baseOptions({ captionVisible: false }));
    const on = renderEmbedOverlay(baseOptions({ captionVisible: true }));

    expect(q(off, 'caption-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(q(on, 'caption-toggle')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the current alignment on the trigger', () => {
    const overlay = renderEmbedOverlay(baseOptions({ alignment: 'right' }));

    expect(q(overlay, 'align-trigger')?.getAttribute('data-current')).toBe('right');
  });

  it('opens the alignment popover and reports a chosen alignment', () => {
    const onAlign = vi.fn();
    const overlay = renderEmbedOverlay(baseOptions({ onAlign }));
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');

    expect(popover?.hidden).toBe(true);

    q(overlay, 'align-trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover?.hidden).toBe(false);

    q(overlay, 'align-left')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onAlign).toHaveBeenCalledWith('left');
  });

  it('toggles caption when the caption button is clicked', () => {
    const onToggleCaption = vi.fn();
    const overlay = renderEmbedOverlay(baseOptions({ onToggleCaption }));

    q(overlay, 'caption-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleCaption).toHaveBeenCalledTimes(1);
  });

  it('opens the more menu and reports copy-link and delete', () => {
    const onCopyLink = vi.fn();
    const onDelete = vi.fn();
    const overlay = renderEmbedOverlay(baseOptions({ onCopyLink, onDelete }));
    const popover = overlay.querySelector<HTMLElement>('[data-role="more-popover"]');

    expect(popover?.hidden).toBe(true);
    q(overlay, 'more')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover?.hidden).toBe(false);

    q(overlay, 'copy-link')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCopyLink).toHaveBeenCalledTimes(1);

    q(overlay, 'more')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    q(overlay, 'delete')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('renderEmbedOverlay — replace', () => {
  it('renders a replace menu item', () => {
    const overlay = renderEmbedOverlay(baseOptions());

    expect(overlay.querySelector('[data-action="replace"]')).not.toBeNull();
  });

  it('invokes onReplace when the replace item is clicked', () => {
    const onReplace = vi.fn();
    const overlay = renderEmbedOverlay(baseOptions({ onReplace }));

    overlay.querySelector<HTMLElement>('[data-action="replace"]')?.click();

    expect(onReplace).toHaveBeenCalledTimes(1);
  });
});
