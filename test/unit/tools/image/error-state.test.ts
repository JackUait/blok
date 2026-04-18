import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderErrorState } from '../../../../src/tools/image/error-state';

describe('renderErrorState', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders default title and message', () => {
    const el = renderErrorState({});
    const title = el.querySelector('.blok-image-error__title');
    const msg = el.querySelector('.blok-image-error__msg');
    if (!title || !msg) throw new Error('missing nodes');
    expect(title.textContent).toBe('Couldn\u2019t load image');
    expect(msg.textContent).toBe('The URL returned an error. Try a different source or re-upload the file.');
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
    const el = renderErrorState({ onRetry: vi.fn(), onReplace: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(el.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(el.querySelector('.blok-image-error__actions')).not.toBeNull();
  });

  it('omits retry button when onRetry missing', () => {
    const el = renderErrorState({ onReplace: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).toBeNull();
    expect(el.querySelector('[data-action="replace"]')).not.toBeNull();
  });

  it('omits replace button when onReplace missing', () => {
    const el = renderErrorState({ onRetry: vi.fn() });
    expect(el.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(el.querySelector('[data-action="replace"]')).toBeNull();
  });

  it('omits actions wrapper when both handlers missing', () => {
    const el = renderErrorState({});
    expect(el.querySelector('.blok-image-error__actions')).toBeNull();
  });

  it('invokes onRetry when retry clicked', () => {
    const onRetry = vi.fn();
    const el = renderErrorState({ onRetry });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="retry"]');
    if (!btn) throw new Error('retry button missing');
    btn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('invokes onReplace when replace clicked', () => {
    const onReplace = vi.fn();
    const el = renderErrorState({ onReplace });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="replace"]');
    if (!btn) throw new Error('replace button missing');
    btn.click();
    expect(onReplace).toHaveBeenCalledTimes(1);
  });
});
