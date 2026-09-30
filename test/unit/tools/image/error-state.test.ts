import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderErrorState } from '../../../../src/tools/image/error-state';
import { IconImage } from '../../../../src/components/icons';

describe('renderErrorState', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders default title and message', () => {
    const el = renderErrorState({});
    const title = el.querySelector('.blok-image-error__title');
    const msg = el.querySelector('.blok-image-error__msg');
    if (!title || !msg) throw new Error('missing nodes');
    expect(title.textContent).toBe('Couldn\u2019t load image');
    expect(msg.textContent).toBe('The image couldn’t be loaded from this URL. Try a different source or upload the file again.');
  });

  it('renders custom title and message when provided', () => {
    const el = renderErrorState({ title: 'Nope', message: 'Bad source' });
    const title = el.querySelector('.blok-image-error__title');
    const msg = el.querySelector('.blok-image-error__msg');
    if (!title || !msg) throw new Error('missing nodes');
    expect(title.textContent).toBe('Nope');
    expect(msg.textContent).toBe('Bad source');
  });

  it('shows retry and replace buttons only when handlers are provided', () => {
    const el = renderErrorState({ onTryAgain: vi.fn(), onSwap: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(el.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(el.querySelector('.blok-image-error__actions')).not.toBeNull();
  });

  it('omits retry button when onTryAgain missing', () => {
    const el = renderErrorState({ onSwap: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).toBeNull();
    expect(el.querySelector('[data-action="replace"]')).not.toBeNull();
  });

  it('omits replace button when onSwap missing', () => {
    const el = renderErrorState({ onTryAgain: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(el.querySelector('[data-action="replace"]')).toBeNull();
  });

  it('omits actions wrapper when both handlers missing', () => {
    const el = renderErrorState({});
    expect(el.querySelector('.blok-image-error__actions')).toBeNull();
  });

  it('invokes onTryAgain when retry clicked', () => {
    const onTryAgain = vi.fn();
    const el = renderErrorState({ onTryAgain });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="retry"]');
    if (!btn) throw new Error('retry button missing');
    // Observable render output: labelled retry button inside the actions wrapper.
    expect(btn.textContent).toBe('Retry');
    expect(el.querySelector('.blok-image-error__actions')?.contains(btn)).toBe(true);
    btn.click();
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('invokes onSwap when replace clicked', () => {
    const onSwap = vi.fn();
    const el = renderErrorState({ onSwap });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="replace"]');
    if (!btn) throw new Error('replace button missing');
    // Observable render output: labelled replace button inside the actions wrapper.
    expect(btn.textContent).toBe('Replace');
    expect(el.querySelector('.blok-image-error__actions')?.contains(btn)).toBe(true);
    btn.click();
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it('uses i18n.t when present', () => {
    const i18n = { has: () => true, t: (k: string) => 'X-' + k };
    const el = renderErrorState({ i18n, onTryAgain: vi.fn(), onSwap: vi.fn() });
    const title = el.querySelector('.blok-image-error__title');
    const msg = el.querySelector('.blok-image-error__msg');
    const retry = el.querySelector('[data-action="retry"]');
    const replace = el.querySelector('[data-action="replace"]');
    if (!title || !msg || !retry || !replace) throw new Error('missing nodes');
    expect(title.textContent).toBe('X-tools.image.errorDefaultTitle');
    expect(msg.textContent).toBe('X-tools.image.errorDefaultMessage');
    expect(retry.textContent).toBe('X-tools.image.errorRetry');
    expect(replace.textContent).toBe('X-tools.image.errorReplace');
  });

  it('a mending card is busy, inert, and not a Show target', () => {
    const onTryAgain = vi.fn();
    const el = renderErrorState({ mending: true, onTryAgain, onSwap: vi.fn() });
    const retry = el.querySelector<HTMLButtonElement>('[data-action="retry"]');

    expect(el.getAttribute('data-role')).toBe('mend-state');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.hasAttribute('data-blok-spotlight-target')).toBe(false);
    expect(retry?.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-action="replace"]')?.disabled).toBe(true);
  });

  it('a broken card carries the whole image under the broken one, to mend into and break from', () => {
    const tile = renderErrorState({ variant: 'broken' }).querySelector('.blok-image-error__icon');
    const whole = tile?.querySelector('[data-icon="whole"]');
    const intact = new DOMParser().parseFromString(IconImage, 'image/svg+xml').querySelector('rect');

    expect(tile?.querySelector('[data-icon="broken"]')).not.toBeNull();
    expect(whole?.querySelector('rect')?.getAttribute('width')).toBe(intact?.getAttribute('width'));
  });

  it('an upload card has no whole image to mend into', () => {
    const tile = renderErrorState({ variant: 'upload' }).querySelector('.blok-image-error__icon');

    expect(tile?.querySelector('[data-icon="whole"]')).toBeNull();
  });

  describe('a broken image keeps the picture\'s own shape', () => {
    it('takes the saved width and ratio', () => {
      const el = renderErrorState({ variant: 'broken', frame: { width: 40, naturalWidth: 1200, naturalHeight: 800 } });

      expect(el.style.width).toBe('40%');
      expect(el.style.aspectRatio).toBe('1200 / 800');
    });

    it('does not guess a ratio it was never told', () => {
      const el = renderErrorState({ variant: 'broken', frame: {} });

      expect(el.style.aspectRatio).toBe('');
      expect(el.style.width).toBe('');
    });
  });

  describe('a failed upload shows the file that did not upload', () => {
    const file = { name: 'beach.jpg', size: 2.4 * 1024 * 1024, preview: 'blob:preview' };

    it('names the file, its size and the reason', () => {
      const el = renderErrorState({ variant: 'upload', message: 'Upload failed', file, onTryAgain: vi.fn(), onSwap: vi.fn() });

      expect(el.querySelector('.blok-image-error__title')?.textContent).toBe('beach.jpg');
      expect(el.querySelector('.blok-image-error__size')?.textContent).toBe('2.4 MB');
      expect(el.querySelector('.blok-image-error__msg')?.textContent).toBe('Upload failed');
    });

    it('shows the picked picture in the tile', () => {
      const el = renderErrorState({ variant: 'upload', file });

      expect(el.querySelector('.blok-image-error__icon img')?.getAttribute('src')).toBe('blob:preview');
    });

    it('offers Retry and a cross that cancels the upload', () => {
      const onSwap = vi.fn();
      const el = renderErrorState({ variant: 'upload', file, onTryAgain: vi.fn(), onSwap });
      const cross = el.querySelector<HTMLButtonElement>('[data-action="replace"]');

      expect(el.querySelector('.blok-image-error__btn[data-action="retry"]')).not.toBeNull();
      expect(cross?.getAttribute('aria-label')).toBe('Cancel upload');
      expect(cross?.querySelector('svg')).not.toBeNull();
      cross?.click();
      expect(onSwap).toHaveBeenCalledTimes(1);
    });

    it('names a failed link by its file and draws no picture', () => {
      const el = renderErrorState({ variant: 'upload', file: { name: 'https://cdn.test/photos/beach.jpg?w=800' } });

      expect(el.querySelector('.blok-image-error__title')?.textContent).toBe('beach.jpg');
      expect(el.querySelector('.blok-image-error__icon img')).toBeNull();
      expect(el.querySelector('.blok-image-error__size')).toBeNull();
    });
  });
});

