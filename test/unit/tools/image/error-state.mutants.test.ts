import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IconImageBroken, IconUploadFailed } from '../../../../src/components/icons';
import type { ErrorStateOptions } from '../../../../src/tools/image/error-state';
import { renderErrorState } from '../../../../src/tools/image/error-state';

/**
 * Mutation coverage for src/tools/image/error-state.ts.
 *
 * Every mutant recorded live on this file is killed here; no equivalent
 * mutants remain, so there are no equivalence proofs to record.
 *
 * Three constraints shape the tests:
 * - A class name that a mutant blanks cannot also be the selector used to find
 *   the node, so the icon and body are reached by position in `root.children`
 *   (the source appends icon then body).
 * - `button.type = ''` reflects back as 'submit' through the IDL getter, so the
 *   attribute is the honest observable for that literal.
 * - jsdom routes a throw inside a click listener to window's error event rather
 *   than to the caller, so `expect(...).not.toThrow()` would pass vacuously.
 *   The optional-call cases capture that event instead.
 */
const childAt = (parent: Element, index: number): Element => {
  const child = parent.children.item(index);

  if (child === null) {
    throw new Error(`expected a child at index ${index}`);
  }

  return child;
};

const buttonBy = (root: Element, action: string): HTMLButtonElement => {
  const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

  if (button === null) {
    throw new Error(`expected a ${action} button`);
  }

  return button;
};

const serialized = (svg: string): string => {
  const host = document.createElement('div');

  host.innerHTML = svg;

  return host.innerHTML;
};

const clickCapturingWindowErrors = (button: HTMLButtonElement): string[] => {
  const seen: string[] = [];
  const onError = (event: ErrorEvent): void => {
    seen.push(event.message);
    event.preventDefault();
  };

  window.addEventListener('error', onError);
  button.click();
  window.removeEventListener('error', onError);

  return seen;
};

describe('renderErrorState mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('structure', () => {
    it('names the root, icon and body nodes', () => {
      const root = renderErrorState({});

      expect(root.className).toBe('blok-image-error');
      expect(root.getAttribute('data-role')).toBe('error-state');
      // The default variant reaches the DOM only through this attribute: both
      // 'broken' and an empty default pick the same icon.
      expect(root.getAttribute('data-variant')).toBe('broken');

      const icon = childAt(root, 0);
      const body = childAt(root, 1);

      expect(icon.className).toBe('blok-image-error__icon');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(body.className).toBe('blok-image-error__body');
    });
  });

  describe('variant icon', () => {
    it('draws the broken-image icon for the broken variant', () => {
      const root = renderErrorState({ variant: 'broken' });

      expect(root.getAttribute('data-variant')).toBe('broken');
      expect(childAt(root, 0).innerHTML).toBe(serialized(IconImageBroken));
    });

    it('draws the upload-failed icon for the upload variant', () => {
      const root = renderErrorState({ variant: 'upload' });

      expect(root.getAttribute('data-variant')).toBe('upload');
      expect(childAt(root, 0).innerHTML).toBe(serialized(IconUploadFailed));
    });
  });

  describe('action buttons', () => {
    it('names the retry button as a non-submitting styled button', () => {
      const root = renderErrorState({ onTryAgain: vi.fn() });
      const retry = buttonBy(root, 'retry');

      expect(retry.getAttribute('type')).toBe('button');
      expect(retry.className).toBe('blok-image-error__btn');
    });

    it('names the replace button as a non-submitting styled button', () => {
      const root = renderErrorState({ onSwap: vi.fn() });
      const replace = buttonBy(root, 'replace');

      expect(replace.getAttribute('type')).toBe('button');
      expect(replace.className).toBe('blok-image-error__btn');
    });
  });

  describe('handlers dropped after render', () => {
    it('survives a retry click once onTryAgain is gone', () => {
      const onTryAgain = vi.fn();
      const opts: ErrorStateOptions = { onTryAgain };
      const root = renderErrorState(opts);
      const retry = buttonBy(root, 'retry');

      opts.onTryAgain = undefined;

      expect(clickCapturingWindowErrors(retry)).toEqual([]);
      expect(onTryAgain).not.toHaveBeenCalled();
    });

    it('survives a replace click once onSwap is gone', () => {
      const onSwap = vi.fn();
      const opts: ErrorStateOptions = { onSwap };
      const root = renderErrorState(opts);
      const replace = buttonBy(root, 'replace');

      opts.onSwap = undefined;

      expect(clickCapturingWindowErrors(replace)).toEqual([]);
      expect(onSwap).not.toHaveBeenCalled();
    });
  });
});
