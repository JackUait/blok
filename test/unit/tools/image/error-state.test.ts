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
    btn.click();
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('invokes onSwap when replace clicked', () => {
    const onSwap = vi.fn();
    const el = renderErrorState({ onSwap });
    const btn = el.querySelector<HTMLButtonElement>('[data-action="replace"]');
    if (!btn) throw new Error('replace button missing');
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
});
