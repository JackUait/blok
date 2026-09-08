import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseHTML,
  saveToggleItem,
  setToggleItemData,
} from '../../../../src/tools/toggle/block-operations';
import type { ToggleItemData } from '../../../../src/tools/toggle/types';

/**
 * Mutation-coverage tests for `src/tools/toggle/block-operations.ts`.
 *
 * No mutants are left alive in this file.
 *
 * `setToggleItemData` is the undo/redo entry point, so the payload it receives
 * is replayed persisted JSON rather than a freshly built object - which is why
 * the guard against a missing `text` is worth a test, and why the fixture below
 * builds that payload as a `Partial` and asserts it through.
 */

const contentElementWith = (html: string): HTMLElement => {
  const element = document.createElement('div');

  element.innerHTML = html;

  return element;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseHTML mutants', () => {
  it('drops the whitespace around the markup', () => {
    const fragment = parseHTML('  <b>x</b>\n');

    expect(fragment.childNodes).toHaveLength(1);
    expect((fragment.firstChild as HTMLElement | null)?.outerHTML).toBe('<b>x</b>');
  });

  it('keeps whitespace between two elements', () => {
    const fragment = parseHTML(' <b>a</b> <i>b</i> ');

    expect(fragment.childNodes).toHaveLength(3);
    expect(fragment.textContent).toBe('a b');
  });

  it('returns an empty fragment for whitespace-only markup', () => {
    expect(parseHTML('   ').childNodes).toHaveLength(0);
  });
});

describe('saveToggleItem mutants', () => {
  it('returns the stored data untouched when the block has no element', () => {
    const data: ToggleItemData = { text: 'stored', isOpen: false };
    const contentEl = contentElementWith('live text');

    const saved = saveToggleItem(data, null, () => contentEl, true);

    expect(saved).toBe(data);
    expect(saved).toEqual({ text: 'stored', isOpen: false });
  });

  it('reads the live content when the block has an element', () => {
    const data: ToggleItemData = { text: 'stored', isOpen: false };

    const saved = saveToggleItem(data, document.createElement('div'), () => contentElementWith('live text'), true);

    expect(saved).toEqual({ text: 'live text', isOpen: true });
  });

  it('keeps the stored text when there is no content element', () => {
    const data: ToggleItemData = { text: 'stored', isOpen: true };

    const saved = saveToggleItem(data, document.createElement('div'), () => null, false);

    expect(saved).toEqual({ text: 'stored', isOpen: false });
  });
});

describe('setToggleItemData mutants', () => {
  it('ignores a payload that carries no text', () => {
    const contentEl = contentElementWith('existing');
    const current: ToggleItemData = { text: 'existing', isOpen: false };
    const replayed: Partial<ToggleItemData> = { isOpen: true };

    const result = setToggleItemData(current, replayed as ToggleItemData, () => contentEl);

    expect(contentEl.innerHTML).toBe('existing');
    expect(result).toEqual({ newData: { text: 'existing', isOpen: true }, inPlace: true });
  });

  it('writes the new text into the content element', () => {
    const contentEl = contentElementWith('existing');
    const current: ToggleItemData = { text: 'existing', isOpen: false };

    const result = setToggleItemData(current, { text: '<b>next</b>', isOpen: true }, () => contentEl);

    expect(contentEl.innerHTML).toBe('<b>next</b>');
    expect(result.inPlace).toBe(true);
  });

  it('writes an empty text, which is still a string', () => {
    const contentEl = contentElementWith('existing');

    setToggleItemData({ text: 'existing', isOpen: true }, { text: '', isOpen: true }, () => contentEl);

    expect(contentEl.innerHTML).toBe('');
  });

  it('reports no in-place update when the content element is gone', () => {
    const current: ToggleItemData = { text: 'existing', isOpen: false };

    expect(setToggleItemData(current, { text: 'next' }, () => null)).toEqual({ newData: current, inPlace: false });
  });
});
