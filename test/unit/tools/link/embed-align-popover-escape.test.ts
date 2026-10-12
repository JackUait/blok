import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEmbedOverlay, type EmbedOverlayOptions } from '../../../../src/tools/link/embed/overlay';

const options = (): EmbedOverlayOptions => ({
  alignment: 'center',
  captionVisible: false,
  source: 'https://youtu.be/dQw4w9WgXcQ',
  i18n: { t: (key: string): string => key },
  onAlign: vi.fn(),
  onToggleCaption: vi.fn(),
});

const mountOverlay = (): HTMLElement => {
  const root = renderEmbedOverlay(options());

  document.body.appendChild(root);

  return root;
};

const trigger = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>('[data-action="align-trigger"]');

  if (!el) throw new Error('align trigger missing');

  return el;
};

describe('embed align popover Escape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('takes Escape in the capture phase so a block handler below it never sees the press', () => {
    const root = mountOverlay();
    const blockHandler = vi.fn();

    trigger(root).click();
    root.addEventListener('keydown', blockHandler);
    trigger(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    root.removeEventListener('keydown', blockHandler);

    expect(blockHandler).not.toHaveBeenCalled();
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the next Escape to the editor when the overlay is removed while the popover is open', () => {
    const root = mountOverlay();
    const editor = vi.fn();

    trigger(root).click();
    root.remove();

    window.addEventListener('keydown', editor);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', editor);

    expect(editor).toHaveBeenCalledTimes(1);
  });
});
