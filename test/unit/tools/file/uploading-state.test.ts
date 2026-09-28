import { describe, it, expect, vi } from 'vitest';
import { renderUploadingState } from '../../../../src/tools/file/uploading-state';

const labels = { uploading: 'Uploading…', cancel: 'Cancel upload', progress: 'Upload progress' };

describe('renderUploadingState', () => {
  it('shows the filename and an initial 0% bar', () => {
    const el = renderUploadingState({ fileName: 'a.pdf', labels, onCancel: vi.fn() });
    expect(el.textContent).toContain('a.pdf');
    expect(el.querySelector<HTMLElement>('[data-role="fill"]')?.style.width).toBe('0%');
  });

  it('updates the fill width via setProgress', () => {
    const el = renderUploadingState({ fileName: 'a.pdf', labels, onCancel: vi.fn() });
    el.setProgress(60);
    expect(el.querySelector<HTMLElement>('[data-role="fill"]')?.style.width).toBe('60%');
  });

  it('clamps progress to the 0–100 range', () => {
    const el = renderUploadingState({ fileName: 'a.pdf', labels, onCancel: vi.fn() });
    el.setProgress(150);
    expect(el.querySelector<HTMLElement>('[data-role="fill"]')?.style.width).toBe('100%');
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    const el = renderUploadingState({ fileName: 'a.pdf', labels, onCancel });
    el.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('file renderUploadingState with a preview', () => {
  it('draws the file preview and fills it with the upload', () => {
    const el = renderUploadingState({ fileName: 'a.pdf', labels, onCancel: () => undefined, preview: 'file' });
    const preview = el.querySelector<HTMLElement>('[data-blok-media-preview="file"]');

    el.setProgress(150);

    expect(preview?.style.getPropertyValue('--blok-media-progress')).toBe('1');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  });
});
