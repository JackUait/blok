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
    const data: ToggleItemData = { text: 'stored', textColor: 'red' };
    const contentEl = contentElementWith('live text');

    const saved = saveToggleItem(data, null, () => contentEl);

    expect(saved).toBe(data);
    expect(saved).toEqual({ text: 'stored', textColor: 'red' });
  });

  it('reads the live content when the block has an element, and never saves isOpen', () => {
    const data: ToggleItemData = { text: 'stored' };

    const saved = saveToggleItem(data, document.createElement('div'), () => contentElementWith('live text'));

    expect(saved).toEqual({ text: 'live text' });
  });

  it('keeps the stored text when there is no content element', () => {
    const data: ToggleItemData = { text: 'stored' };

    const saved = saveToggleItem(data, document.createElement('div'), () => null);

    expect(saved).toEqual({ text: 'stored' });
  });
});

describe('setToggleItemData mutants', () => {
  it('leaves the content element alone for a payload that carries no text', () => {
    const contentEl = contentElementWith('existing');
    const current: ToggleItemData = { text: 'existing' };
    const replayed: Partial<ToggleItemData> = { textColor: 'red' };

    const result = setToggleItemData(current, replayed as ToggleItemData, () => contentEl);

    expect(contentEl.innerHTML).toBe('existing');
    expect(result).toEqual({ newData: { textColor: 'red' }, inPlace: true });
  });

  it('writes the new text into the content element', () => {
    const contentEl = contentElementWith('existing');
    const current: ToggleItemData = { text: 'existing' };

    const result = setToggleItemData(current, { text: '<b>next</b>' }, () => contentEl);

    expect(contentEl.innerHTML).toBe('<b>next</b>');
    expect(result.inPlace).toBe(true);
  });

  it('writes an empty text, which is still a string', () => {
    const contentEl = contentElementWith('existing');

    setToggleItemData({ text: 'existing' }, { text: '' }, () => contentEl);

    expect(contentEl.innerHTML).toBe('');
  });

  it('reports no in-place update when the content element is gone', () => {
    const current: ToggleItemData = { text: 'existing' };

    expect(setToggleItemData(current, { text: 'next' }, () => null)).toEqual({ newData: current, inPlace: false });
  });
});
