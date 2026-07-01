import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCropModal } from '../../../src/tools/image/crop-modal';

/**
 * Dispatch a capture-phase pointerdown whose target is the given element.
 * The shared dismissal layer keys outside-dismiss off pointerdown (which, in a
 * real browser, precedes click), so tests must exercise the same event.
 */
const pressPointerDown = (target: HTMLElement): void => {
  const event = new PointerEvent('pointerdown', { bubbles: true });

  Object.defineProperty(event, 'target', { value: target });
  document.dispatchEvent(event);
};

// jsdom lacks HTML Popover API implementations; stub minimal shape for promoteToTopLayer.
beforeEach(() => {
  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
    });
  }
  if (typeof (HTMLElement.prototype as unknown as { showPopover?: () => void }).showPopover !== 'function') {
    (HTMLElement.prototype as unknown as { showPopover: () => void }).showPopover = function showPopover() {};
    (HTMLElement.prototype as unknown as { hidePopover: () => void }).hidePopover = function hidePopover() {};
  }
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const open = (overrides: Partial<Parameters<typeof openCropModal>[0]> = {}): (() => void) =>
  openCropModal({
    url: 'x.png',
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  });

describe('openCropModal', () => {
  it('mounts dialog + backdrop in document.body with correct aria', () => {
    const detach = open();
    const dialog = document.body.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Crop image"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    const backdrop = document.body.querySelector<HTMLElement>(
      '.blok-image-crop-modal-backdrop'
    );
    expect(backdrop).not.toBeNull();
    expect(backdrop!.contains(dialog)).toBe(true);
    detach();
  });

  it('hosts crop editor inside dialog body', () => {
    const detach = open();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('.blok-image-crop-editor')).not.toBeNull();
    detach();
  });

  it('detach removes backdrop + dialog from DOM', () => {
    const detach = open();
    expect(document.body.querySelector('.blok-image-crop-modal-backdrop')).not.toBeNull();
    detach();
    expect(document.body.querySelector('.blok-image-crop-modal-backdrop')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('backdrop press triggers onCancel and detaches', () => {
    const onCancel = vi.fn();
    const detach = open({ onCancel });
    const backdrop = document.body.querySelector<HTMLElement>(
      '.blok-image-crop-modal-backdrop'
    )!;
    pressPointerDown(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.blok-image-crop-modal-backdrop')).toBeNull();
    detach();
  });

  it('press inside dialog does not cancel', () => {
    const onCancel = vi.fn();
    const detach = open({ onCancel });
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    pressPointerDown(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    detach();
  });

  it('drag starting on a handle (inside the surface) does not cancel', () => {
    const onCancel = vi.fn();
    const detach = open({ onCancel });
    const handle = document.body.querySelector<HTMLElement>('[data-handle="se"]')!;
    // A press that starts inside the dialog surface never dismisses, even if the
    // pointer later releases over the backdrop.
    pressPointerDown(handle);
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.querySelector('.blok-image-crop-modal-backdrop')).not.toBeNull();
    detach();
  });

  it('Done button calls onApply then detaches', () => {
    const onApply = vi.fn();
    const detach = open({ onApply });
    const done = document.body.querySelector<HTMLButtonElement>('[data-action="done"]')!;
    done.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    detach();
  });

  it('Cancel button calls onCancel then detaches', () => {
    const onCancel = vi.fn();
    const detach = open({ onCancel });
    const cancel = document.body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    detach();
  });

  it('detach is idempotent', () => {
    const detach = open();
    detach();
    expect(() => detach()).not.toThrow();
  });
});
