import { describe, it, expect, afterEach } from 'vitest';
import { openFilePreview } from '../../../../src/tools/file/preview-modal';

const labels = { close: 'Close preview' };

function getDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

afterEach(() => {
  document.body.querySelectorAll('[role="dialog"], .blok-file-preview-backdrop').forEach((el) => el.remove());
  document.body.innerHTML = '';
});

describe('openFilePreview', () => {
  it('appends a dialog and an iframe with the given http(s) src', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'a.pdf', labels });

    const dialog = getDialog();
    expect(dialog).not.toBeNull();

    const frame = document.body.querySelector<HTMLIFrameElement>('[data-role="file-preview-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('https://example.com/a.pdf');
  });

  it('accepts a blob: url as the iframe src', () => {
    openFilePreview({ url: 'blob:https://example.com/abc-123', labels });

    const frame = document.body.querySelector<HTMLIFrameElement>('[data-role="file-preview-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('blob:https://example.com/abc-123');
  });

  it('renders an error fallback and no iframe for a data: url', () => {
    openFilePreview({ url: 'data:text/html,<script>alert(1)</script>', labels });

    expect(document.body.querySelector('[data-role="file-preview-frame"]')).toBeNull();
    expect(document.body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
  });

  it('closes on Escape keydown', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });
    expect(getDialog()).not.toBeNull();

    // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(getDialog()).toBeNull();
  });

  it('closes when the backdrop is clicked but not when the dialog is clicked', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const dialog = getDialog();
    if (!dialog) throw new Error('dialog missing');
    dialog.click();
    expect(getDialog()).not.toBeNull();

    const backdrop = document.body.querySelector<HTMLElement>('[data-role="file-preview-backdrop"]');
    if (!backdrop) throw new Error('backdrop missing');
    backdrop.click();
    expect(getDialog()).toBeNull();
  });

  it('closes when the close button is clicked', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const close = document.body.querySelector<HTMLButtonElement>('[data-action="close-preview"]');
    if (!close) throw new Error('close button missing');
    close.click();

    expect(getDialog()).toBeNull();
  });

  it('focuses the close button on open', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const close = document.body.querySelector<HTMLButtonElement>('[data-action="close-preview"]');
    expect(close).toHaveFocus();
  });

  it('restores focus to the previously focused element after teardown', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    teardown();

    expect(trigger).toHaveFocus();
  });

  it('is idempotent when teardown is called twice', () => {
    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    teardown();
    expect(() => teardown()).not.toThrow();
    expect(getDialog()).toBeNull();
  });
});
