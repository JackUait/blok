import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAltPopover } from '../../../src/tools/image/alt-popover';

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

interface OpenOverrides {
  anchor?: HTMLElement;
  value?: string;
  onSave?: (next: string) => void;
  onCancel?: () => void;
}

const open = (overrides: OpenOverrides = {}): (() => void) => {
  const anchor = overrides.anchor ?? (() => {
    const b = document.createElement('button');
    b.textContent = 'Alt';
    document.body.appendChild(b);
    return b;
  })();
  return openAltPopover({
    anchor,
    value: overrides.value ?? '',
    onSave: overrides.onSave ?? vi.fn(),
    onCancel: overrides.onCancel ?? vi.fn(),
  });
};

describe('openAltPopover', () => {
  it('mounts popover with dialog role + accessible label', () => {
    const detach = open();
    const popover = document.body.querySelector<HTMLElement>(
      '[data-role="image-alt-popover"]'
    );
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute('role')).toBe('dialog');
    expect(popover!.getAttribute('aria-label')).toBe('Edit alt text');
    detach();
  });

  it('renders description text about accessibility', () => {
    const detach = open();
    const popover = document.body.querySelector<HTMLElement>(
      '[data-role="image-alt-popover"]'
    )!;
    expect(popover.textContent).toMatch(/accessible/i);
    expect(popover.textContent).toMatch(/vision-impaired|screen.reader/i);
    detach();
  });

  it('textarea prefilled with current value and focused', () => {
    const detach = open({ value: 'pretty flower' });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    expect(textarea.value).toBe('pretty flower');
    expect(textarea).toHaveFocus();
    detach();
  });

  it('close button commits current text via onSave then detaches', () => {
    const onSave = vi.fn();
    const detach = open({ value: 'old', onSave });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'new alt';
    const close = document.body.querySelector<HTMLButtonElement>(
      '[data-role="image-alt-popover"] [data-action="close"]'
    )!;
    close.click();
    expect(onSave).toHaveBeenCalledWith('new alt');
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    detach();
  });

  it('Enter key commits onSave and detaches', () => {
    const onSave = vi.fn();
    const detach = open({ onSave });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'typed';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(onSave).toHaveBeenCalledWith('typed');
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    detach();
  });

  it('Shift+Enter inserts newline, does not commit', () => {
    const onSave = vi.fn();
    const detach = open({ onSave });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'line one';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    detach();
  });

  it('Escape calls onCancel and detaches', () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const detach = open({ onCancel, onSave });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'changed';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    detach();
  });

  it('clicking outside commits onSave and detaches', () => {
    const onSave = vi.fn();
    const detach = open({ onSave });
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[data-role="image-alt-popover"] textarea'
    )!;
    textarea.value = 'committed';
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onSave).toHaveBeenCalledWith('committed');
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    detach();
  });

  it('detach removes popover and is idempotent', () => {
    const detach = open();
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    detach();
    expect(document.body.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    expect(() => detach()).not.toThrow();
  });
});
