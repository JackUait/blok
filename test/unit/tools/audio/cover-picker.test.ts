import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateCoverFile, openCoverPicker } from '../../../../src/tools/audio/cover-picker';
import { getTabbables } from '../../../../src/components/utils/modal-dialog';
import { COVER_MAX_SIZE } from '../../../../src/tools/audio/constants';

const makeFile = (type: string, size: number): File => {
  const f = new File(['x'], 'cover', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('validateCoverFile', () => {
  it('accepts an image within the size cap', () => {
    expect(validateCoverFile(makeFile('image/png', 1024))).toBeNull();
  });

  it('rejects a non-image file', () => {
    expect(validateCoverFile(makeFile('audio/mpeg', 1024))).not.toBeNull();
  });

  it('rejects an oversized image', () => {
    expect(validateCoverFile(makeFile('image/png', COVER_MAX_SIZE + 1))).not.toBeNull();
  });

  it('does not type-reject a file with an empty MIME type (falls through to size check)', () => {
    expect(validateCoverFile(makeFile('', 1024))).toBeNull();
  });
});

describe('openCoverPicker', () => {
  it('mounts a dialog and forwards a submitted URL, then closes on demand', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onUrl = vi.fn();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl });

    const dialog = document.querySelector('[data-role="audio-cover-picker"]');
    expect(dialog).not.toBeNull();

    // Drive the Link tab: click the embed tab, type a URL, submit.
    const linkTab = dialog!.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    linkTab?.click();
    const input = dialog!.querySelector<HTMLInputElement>('input[type="url"]');
    if (input) { input.value = 'https://cdn/cover.png'; }
    // The submit button uses type="button" and data-action="submit-url"
    const submit = dialog!.querySelector<HTMLButtonElement>('[data-action="submit-url"]');
    submit?.click();

    expect(onUrl).toHaveBeenCalledWith('https://cdn/cover.png');

    handle.close();
    expect(document.querySelector('[data-role="audio-cover-picker"]')).toBeNull();
  });

  it('slides the new panel in on tab switch without tweening the popover height', () => {
    // Make the WAAPI path reachable: real animate + reduced-motion off. A
    // floating popover has nothing reflowing beneath it, so the inline height
    // tween only read as lag — the picker uses the directional content slide
    // instead: the new panel slides + fades in while the popover resizes
    // instantly (no bottom-edge crawl).
    const animateSpy = vi.fn((..._args: unknown[]) => ({ finished: Promise.resolve(undefined) }));
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const original = proto.animate;
    proto.animate = animateSpy;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    try {
      const anchor = document.createElement('div');
      document.body.appendChild(anchor);
      const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
      const dialog = document.querySelector('[data-role="audio-cover-picker"]')!;

      animateSpy.mockClear();
      dialog.querySelector<HTMLButtonElement>('[data-tab="embed"]')!.click();

      // The incoming panel content slides/fades in...
      expect(animateSpy).toHaveBeenCalled();
      // ...but the popover height itself never tweens (that crawl read as lag).
      const tweensHeight = animateSpy.mock.calls.some(([frames]: unknown[]) =>
        Array.isArray(frames)
        && frames.some((f: unknown) => f !== null && typeof f === 'object' && 'height' in f));
      expect(tweensHeight).toBe(false);

      handle.close();
    } finally {
      if (original) proto.animate = original;
      else delete proto.animate;
      vi.unstubAllGlobals();
    }
  });

  it('stamps aria-haspopup/aria-expanded on the trigger button, not the positioning anchor', () => {
    // Mirrors production wiring: the anchor is the role-less cover <div>, the
    // trigger is the "Change cover" <button> living inside it.
    const anchor = document.createElement('div');
    const trigger = document.createElement('button');
    anchor.appendChild(trigger);
    document.body.appendChild(anchor);

    const handle = openCoverPicker({ anchor, trigger, onFile: vi.fn(), onUrl: vi.fn() });

    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // The div carries no role, so aria-expanded there is meaningless to AT.
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);

    handle.close();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('restores focus to the trigger button on close', () => {
    const anchor = document.createElement('div');
    const trigger = document.createElement('button');
    anchor.appendChild(trigger);
    document.body.appendChild(anchor);
    trigger.focus();

    const handle = openCoverPicker({ anchor, trigger, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);

    handle.close();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves focus into the dialog on open', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.focus();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    handle.close();
  });

  it('restores focus to the previously focused element on close', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.focus();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    handle.close();
    expect(document.activeElement).toBe(anchor);
  });

  it('does not throw when the previously focused element was detached before close', () => {
    const anchor = document.createElement('button');
    const transient = document.createElement('button');
    document.body.append(anchor, transient);
    transient.focus();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    transient.remove(); // no longer connected
    expect(() => handle.close()).not.toThrow();
  });

  it('wraps Tab from the last tabbable back to the first', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;
    const focusables = getTabbables(dialog);
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);

    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    // jsdom does not move focus for Tab, so landing on `first` proves the trap
    // itself performed the wrap.
    expect(document.activeElement).toBe(first);
    handle.close();
  });

  it('wraps Shift+Tab from the first tabbable back to the last', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;
    const focusables = getTabbables(dialog);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
    handle.close();
  });

  it('invokes onClose when the user presses Escape', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn(), onClose });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector('[data-role="audio-cover-picker"]')).toBeNull();
  });

  it('closes on pointerdown outside the dialog (dismissable layer)', () => {
    const anchor = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(anchor, outside);
    const onClose = vi.fn();
    openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn(), onClose });

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-role="audio-cover-picker"]')).toBeNull();
  });

  it('does not close on pointerdown inside the dialog or on the anchor', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn(), onClose });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;

    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    handle.close();
  });

  it('unregisters its dismissable layer on close (no double dismissal)', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn(), onClose });
    handle.close();
    onClose.mockClear();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stamps the resolved data-side from the anchored-positioning engine', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;

    // Plenty of room below the (zero-sized jsdom) anchor: stays on bottom.
    expect(dialog.dataset.side).toBe('bottom');
    handle.close();
  });

  it('flips above the anchor when there is not enough room below the viewport edge', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    // Anchor hugging the bottom of the (768px-tall jsdom) viewport.
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 700, 40, 40));

    const handle = openCoverPicker({ anchor, onFile: vi.fn(), onUrl: vi.fn() });
    const dialog = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]')!;
    // Give the picker a real footprint (jsdom measures 0 otherwise)...
    Object.defineProperty(dialog, 'offsetWidth', { value: 300, configurable: true });
    Object.defineProperty(dialog, 'offsetHeight', { value: 300, configurable: true });
    // ...and let the position tracker re-run on scroll.
    window.dispatchEvent(new Event('scroll'));

    expect(dialog.dataset.side).toBe('top');
    handle.close();
  });
});
