import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderUploadingState, type UploadingStateElement } from '../../../../src/tools/image/uploading-state';

/**
 * Mutation coverage for the image uploading card.
 *
 * Two recorded mutants are provably equivalent and cannot be killed:
 *
 * 1. `clamp`: `percent < 0` widened to `percent <= 0`. The two differ for a
 *    single input, negative zero: the original returns -0, the mutant returns
 *    0. `clamp` is module-private and its value reaches the DOM only through
 *    a template string and `String(Math.round(value))`, and both -0 and 0
 *    stringify to "0". At exactly 0 the original falls through and returns
 *    `percent` (0) while the mutant returns the literal 0 — same number. For
 *    every other input the branch outcome is identical.
 *
 * 2. `clamp`: `percent > 100` widened to `percent >= 100`. The two differ only
 *    at exactly 100, where the original falls through and returns `percent`
 *    (100) and the mutant returns the literal 100. Same number, same string.
 */

interface Parts {
  card: HTMLElement;
  header: HTMLElement;
  label: HTMLElement;
  cancel: HTMLElement;
  panel: HTMLElement;
  tile: HTMLElement;
  content: HTMLElement;
  sub: HTMLElement;
  pct: HTMLElement;
  sep: HTMLElement;
  size: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
}

/** Walks by position, so a blanked class name cannot hide the node it names. */
const childAt = (parent: Element, index: number): HTMLElement => {
  const child = parent.children.item(index);

  if (!(child instanceof HTMLElement)) {
    throw new Error(`no element child at index ${index} of <${parent.tagName.toLowerCase()}>`);
  }

  return child;
};

const partsOf = (root: UploadingStateElement): Parts => {
  const card = childAt(root, 0);
  const header = childAt(card, 0);
  const panel = childAt(card, 1);
  const content = childAt(panel, 1);
  const sub = childAt(content, 0);
  const bar = childAt(content, 1);

  return {
    card,
    header,
    label: childAt(header, 0),
    cancel: childAt(header, header.children.length - 1),
    panel,
    tile: childAt(panel, 0),
    content,
    sub,
    pct: childAt(sub, 0),
    sep: childAt(sub, 1),
    size: childAt(sub, 2),
    bar,
    fill: childAt(bar, 0),
  };
};

describe('renderUploadingState mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives every node its exact BEM class name', () => {
    const root = renderUploadingState({ fileName: 'photo.png' });
    const p = partsOf(root);
    const filename = childAt(p.header, 1);

    expect(root.className).toBe('blok-image-uploading');
    expect(p.card.className).toBe('blok-image-uploading__card');
    expect(p.header.className).toBe('blok-image-uploading__header');
    expect(p.label.className).toBe('blok-image-uploading__label');
    expect(filename.className).toBe('blok-image-uploading__filename');
    expect(p.cancel.className).toBe('blok-image-uploading__cancel');
    expect(p.panel.className).toBe('blok-image-uploading__panel');
    expect(p.tile.className).toBe('blok-image-uploading__tile');
    expect(p.content.className).toBe('blok-image-uploading__content');
    expect(p.sub.className).toBe('blok-image-uploading__sub');
    expect(p.pct.className).toBe('blok-image-uploading__pct');
    expect(p.sep.className).toBe('blok-image-uploading__sep');
    expect(p.size.className).toBe('blok-image-uploading__size');
    expect(p.bar.className).toBe('blok-image-uploading__bar');
    expect(p.fill.className).toBe('blok-image-uploading__bar-fill');
  });

  it('makes the cancel control a non-submitting button', () => {
    const { cancel } = partsOf(renderUploadingState({ fileName: 'photo.png' }));

    expect(cancel.tagName).toBe('BUTTON');
    expect(cancel.getAttribute('type')).toBe('button');
  });

  it('hides the decorative tile and separator from assistive tech', () => {
    const { tile, sep } = partsOf(renderUploadingState({ fileName: 'photo.png' }));

    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(sep.getAttribute('aria-hidden')).toBe('true');
    expect(sep.textContent).toBe('·');
  });

  it('declares the full 0 to 100 range on the progress bar', () => {
    const { bar } = partsOf(renderUploadingState({ fileName: 'photo.png' }));

    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('marks the header status-only exactly when there is no filename', () => {
    const withName = partsOf(renderUploadingState({ fileName: 'photo.png' }));
    const withoutName = partsOf(renderUploadingState({ fileName: null }));

    expect(withName.header.classList.contains('blok-image-uploading__header--status-only')).toBe(false);
    expect(withoutName.header.classList.contains('blok-image-uploading__header--status-only')).toBe(true);
  });

  it('leaves the size slot empty when no size label is given', () => {
    const { size } = partsOf(renderUploadingState({ fileName: 'photo.png' }));

    expect(size.textContent).toBe('');
  });

  it('seeds the size slot with the given size label', () => {
    const { size } = partsOf(renderUploadingState({ fileName: 'photo.png', sizeLabel: '0 B / 2 MB' }));

    expect(size.textContent).toBe('0 B / 2 MB');
  });

  it('keeps the existing size text when setProgress omits a size label', () => {
    const root = renderUploadingState({ fileName: 'photo.png', sizeLabel: '0 B / 2 MB' });
    const { size, pct } = partsOf(root);

    root.setProgress(10);

    expect(pct.textContent).toBe('10%');
    expect(size.textContent).toBe('0 B / 2 MB');
  });

  it('renders a non-finite percent as zero', () => {
    const root = renderUploadingState({ fileName: 'photo.png' });
    const { pct, bar } = partsOf(root);

    root.setProgress(Number.NaN);

    // jsdom drops an invalid CSS length silently, so the bar width proves nothing here.
    expect(pct.textContent).toBe('0%');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });
});
