import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureInlineRemovalObserver,
  whitespaceFollowingRemovedEmptyInline,
} from '../../../../src/components/utils/caret/inline-removal';

/** Lets the observer's callback run. */
const flushObserver = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('inline removal tracking cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInlineRemovalObserver(document);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not read a removed element\'s text when no text follows it (moving 10k block holders)', async () => {
    const container = document.createElement('div');
    const moved = document.createElement('div');
    const textReads = { count: 0 };

    moved.innerHTML = '<span></span>';
    container.append(moved, document.createElement('div'));
    document.body.appendChild(container);
    await flushObserver();

    Object.defineProperty(moved, 'textContent', {
      configurable: true,
      get() {
        textReads.count++;

        return '';
      },
    });

    moved.remove();
    await flushObserver();

    expect(textReads.count).toBe(0);
  });

  it('still marks the space after a removed empty inline', async () => {
    const field = document.createElement('div');

    // jsdom has no isContentEditable.
    Object.defineProperty(field, 'isContentEditable', { configurable: true, value: true });
    field.innerHTML = 'a<b></b> b';
    document.body.appendChild(field);
    await flushObserver();

    const empty = field.querySelector('b');
    const following = empty?.nextSibling;

    empty?.remove();
    await flushObserver();

    expect(following instanceof Text && whitespaceFollowingRemovedEmptyInline.has(following)).toBe(true);
  });
});
