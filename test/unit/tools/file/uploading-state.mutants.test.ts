import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { renderUploadingState } from '../../../../src/tools/file/uploading-state';

const LABELS = { uploading: 'Uploading', cancel: 'Cancel upload', progress: 'Upload progress' };

interface Rendered {
  root: HTMLElement;
  label: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  cancel: HTMLElement;
  onCancel: Mock<() => void>;
  setProgress: (percent: number) => void;
}

/** Reached by position, not by class: the class names are what the mutants blank. */
const render = (fileName: string | null = 'notes.pdf'): Rendered => {
  const onCancel = vi.fn<() => void>();
  const root = renderUploadingState({ fileName, labels: LABELS, onCancel });
  const [label, bar, cancel] = Array.from(root.children);
  const fill = bar.children[0];

  if (!(label instanceof HTMLElement) || !(bar instanceof HTMLElement)
    || !(cancel instanceof HTMLElement) || !(fill instanceof HTMLElement)) {
    throw new Error('the uploading state is not shaped as expected');
  }

  return { root, label, bar, fill, cancel, onCancel, setProgress: root.setProgress };
};

describe('file uploading state mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names every part and declares the progress range', () => {
    const view = render();

    expect(view.root.className).toBe('blok-file-uploading');
    expect(view.label.className).toBe('blok-file-uploading-label');
    expect(view.bar.className).toBe('blok-file-bar');
    expect(view.fill.className).toBe('blok-file-bar-fill');
    expect(view.cancel.className).toBe('blok-file-cancel');

    expect(view.bar.getAttribute('role')).toBe('progressbar');
    expect(view.bar.getAttribute('aria-label')).toBe('Upload progress');
    expect(view.bar.getAttribute('aria-valuemin')).toBe('0');
    expect(view.bar.getAttribute('aria-valuemax')).toBe('100');
    expect(view.bar.getAttribute('aria-valuenow')).toBe('0');

    // A blanked type reflects back as submit, so the attribute is the observable.
    expect(view.cancel.getAttribute('type')).toBe('button');
    expect(view.cancel.getAttribute('data-action')).toBe('cancel');
    expect(view.cancel.getAttribute('aria-label')).toBe('Cancel upload');
    expect(view.cancel.textContent).toBe('Cancel upload');
  });

  it('names the file when there is one, and only the verb when there is not', () => {
    expect(render('notes.pdf').label.textContent).toBe('Uploading notes.pdf');
    expect(render(null).label.textContent).toBe('Uploading');
  });

  it('moves the fill and the reported value together, clamped to the range', () => {
    const view = render();

    view.setProgress(50);

    expect([view.fill.style.width, view.bar.getAttribute('aria-valuenow')]).toStrictEqual(['50%', '50']);

    view.setProgress(-5);

    expect([view.fill.style.width, view.bar.getAttribute('aria-valuenow')]).toStrictEqual(['0%', '0']);

    view.setProgress(120);

    expect([view.fill.style.width, view.bar.getAttribute('aria-valuenow')]).toStrictEqual(['100%', '100']);
  });

  it('reports a click on the cancel button', () => {
    const view = render();

    view.cancel.dispatchEvent(new MouseEvent('click'));

    expect(view.onCancel).toHaveBeenCalledTimes(1);
  });
});
