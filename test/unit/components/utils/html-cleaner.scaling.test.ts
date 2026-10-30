import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanHtml } from '../../../../src/components/utils/html-cleaner';

/**
 * A browser finds an element sibling by scanning over text nodes, so each call
 * costs up to the length of the run. Pasted spans unwrap into long runs of text
 * nodes; the cleaner must look those siblings up a bounded number of times.
 * Counting calls stays stable where timing does not (jsdom's own DOM edits are O(n)).
 * @param spans - how many blank spans the paragraph holds
 */
const siblingLookups = (spans: number): number => {
  const previous = vi.spyOn(CharacterData.prototype, 'previousElementSibling', 'get');
  const next = vi.spyOn(CharacterData.prototype, 'nextElementSibling', 'get');

  cleanHtml(`<p>${'<span> </span>a'.repeat(spans)}</p><p>end</p>`, { p: {} });

  const calls = previous.mock.calls.length + next.mock.calls.length;

  vi.restoreAllMocks();

  return calls;
};

describe('cleanHtml on long runs of text nodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('looks up element siblings a number of times that grows linearly', () => {
    const small = siblingLookups(100);
    const large = siblingLookups(800);

    expect(large).toBeLessThanOrEqual(small * 8 + 8);
  });

  // Each removed comment leaves the run's next element as it was, so one lookup serves the whole run.
  it('looks up the next element once per run while comments in it are removed', () => {
    const next = vi.spyOn(CharacterData.prototype, 'nextElementSibling', 'get');

    cleanHtml(`<p>${' <!---->'.repeat(500)}x</p><p>end</p>`, { p: {} });

    expect(next.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('cleanHtml on strings with no markup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Saved data is full of ids and plain words: a table save cleans three ids per cell.
  it('returns plain text without building a document to parse it in', () => {
    const createDocument = vi.spyOn(document.implementation, 'createHTMLDocument');
    const plain = ['', '   ', 'Y_W56LMXDg', 'two words', 'tab\tand\nnewline', 'café 中 ​'];

    expect(plain.map((value) => cleanHtml(value, { b: {} }))).toStrictEqual(plain);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('still parses text the parser or serializer would change', () => {
    expect(cleanHtml('a &amp; b', {})).toBe('a &amp; b');
    expect(cleanHtml('a & b', {})).toBe('a &amp; b');
    expect(cleanHtml('1 > 0', {})).toBe('1 &gt; 0');
    expect(cleanHtml('no break', {})).toBe('no&nbsp;break');
    expect(cleanHtml('line\r\nend', {})).toBe('line\nend');
    expect(cleanHtml('nul\u0000here', {})).toBe('nulhere');
    expect(cleanHtml('<b>x</b>', {})).toBe('x');
  });
});
