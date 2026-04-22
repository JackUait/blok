import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderUploadingState } from '../../../../src/tools/image/uploading-state';

describe('renderUploadingState', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders with filename and initial 0% progress', () => {
    const el = renderUploadingState({ fileName: 'photo.png' });
    const name = el.querySelector('[data-role="filename"]');
    const pct = el.querySelector('[data-role="pct"]');
    const fill = el.querySelector<HTMLElement>('[data-role="fill"]');
    if (!name || !pct || !fill) throw new Error('missing nodes');
    expect(name.textContent).toBe('photo.png');
    expect(pct.textContent).toBe('0%');
    expect(fill.style.width).toBe('0%');
  });

  it('updates pct text, fill width, and size text on setProgress', () => {
    const el = renderUploadingState({ fileName: 'photo.png' });
    el.setProgress(42, '1.3 MB / 3.1 MB');
    const pct = el.querySelector('[data-role="pct"]');
    const size = el.querySelector('[data-role="size"]');
    const fill = el.querySelector<HTMLElement>('[data-role="fill"]');
    if (!pct || !size || !fill) throw new Error('missing nodes');
    expect(pct.textContent).toBe('42%');
    expect(fill.style.width).toBe('42%');
    expect(size.textContent).toBe('1.3 MB / 3.1 MB');
  });

  it('clamps negative progress to 0 and >100 to 100', () => {
    const el = renderUploadingState({ fileName: 'photo.png' });
    el.setProgress(-50);
    let pct = el.querySelector('[data-role="pct"]');
    let fill = el.querySelector<HTMLElement>('[data-role="fill"]');
    if (!pct || !fill) throw new Error('missing nodes');
    expect(pct.textContent).toBe('0%');
    expect(fill.style.width).toBe('0%');

    el.setProgress(250);
    pct = el.querySelector('[data-role="pct"]');
    fill = el.querySelector<HTMLElement>('[data-role="fill"]');
    if (!pct || !fill) throw new Error('missing nodes');
    expect(pct.textContent).toBe('100%');
    expect(fill.style.width).toBe('100%');
  });

  it('invokes onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    const el = renderUploadingState({ fileName: 'photo.png', onCancel });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    if (!btn) throw new Error('cancel button missing');
    btn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancel click is a no-op when onCancel is omitted', () => {
    const el = renderUploadingState({ fileName: 'photo.png' });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    if (!btn) throw new Error('cancel button missing');
    expect(() => btn.click()).not.toThrow();
  });

  it('falls back to English when i18n omitted', () => {
    const el = renderUploadingState({ fileName: 'photo.png' });
    const label = el.querySelector('.blok-image-uploading__label');
    const cancel = el.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    const bar = el.querySelector('[role="progressbar"]');
    if (!label || !cancel || !bar) throw new Error('missing nodes');
    expect(label.textContent).toBe('Uploading');
    expect(cancel.getAttribute('aria-label')).toBe('Cancel upload');
    expect(bar.getAttribute('aria-label')).toBe('Upload progress');
  });

  it('uses i18n.t value when key present', () => {
    const i18n = { has: () => true, t: (k: string) => 'X-' + k };
    const el = renderUploadingState({ fileName: 'photo.png', i18n });
    const label = el.querySelector('.blok-image-uploading__label');
    const cancel = el.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    const bar = el.querySelector('[role="progressbar"]');
    if (!label || !cancel || !bar) throw new Error('missing nodes');
    expect(label.textContent).toBe('X-tools.image.uploadingLabel');
    expect(cancel.getAttribute('aria-label')).toBe('X-tools.image.cancelUpload');
    expect(bar.getAttribute('aria-label')).toBe('X-tools.image.uploadProgress');
  });
});
