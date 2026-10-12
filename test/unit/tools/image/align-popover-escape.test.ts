import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverlay, type OverlayOptions } from '../../../../src/tools/image/ui';

const overlayOptions = (): OverlayOptions => ({
  state: { alignment: 'center', captionVisible: false, size: 'md' },
  onAlign: vi.fn(),
  onSize: vi.fn(),
  onReplace: vi.fn(),
  onDelete: vi.fn(),
  onDownload: vi.fn(),
  onFullscreen: vi.fn(),
  onCopyUrl: vi.fn(),
  onToggleCaption: vi.fn(),
  onCrop: vi.fn(),
});

const mountOverlay = (): HTMLElement => {
  const toolRoot = document.createElement('div');

  toolRoot.setAttribute('data-blok-tool', 'image');
  const root = renderOverlay(overlayOptions());

  toolRoot.appendChild(root);
  document.body.appendChild(toolRoot);

  return root;
};

const trigger = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>('[data-action="align-trigger"]');

  if (!el) throw new Error('align trigger missing');

  return el;
};

const pressEscape = (): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

  document.dispatchEvent(event);

  return event;
};

describe('image align popover Escape', () => {
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
    pressEscape();
    window.removeEventListener('keydown', editor);

    expect(editor).toHaveBeenCalledTimes(1);
  });
});
