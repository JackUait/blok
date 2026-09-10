// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToMarkdown, blocksToMarkdownWithReport } from '../../../src/view/blocks-to-markdown';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

/**
 * Serialize one paragraph's inline HTML.
 * @param text - the paragraph's `data.text`
 */
const inline = (text: string): string => blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]));

describe('blocks-to-markdown (view) — inline HTML through parse5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes every inline mark to its Markdown form', () => {
    expect(inline('a <b>bold</b> <i>italic</i> <code>c</code> <s>gone</s> <a href="https://x.com">link</a>'))
      .toBe('a **bold** *italic* `c` ~~gone~~ [link](https://x.com)');
  });

  it('treats strong, em, del and strike as the same marks as b, i, s', () => {
    expect(inline('a <strong>bold</strong> b')).toBe('a **bold** b');
    expect(inline('a <em>italic</em> b')).toBe('a *italic* b');
    expect(inline('a <del>gone</del> b')).toBe('a ~~gone~~ b');
    expect(inline('a <strike>gone</strike> b')).toBe('a ~~gone~~ b');
  });

  it('turns a br into a newline and decodes entities', () => {
    expect(inline('one<br>two')).toBe('one\ntwo');
    expect(inline('a &lt; b &amp; c')).toBe('a < b & c');
  });

  /**
   * A mark wrapping nothing but whitespace keeps the whitespace verbatim: the
   * empty case returns `inner`, so the delimiters are the only thing dropped.
   */
  it('leaves a whitespace-only mark wrapper unwrapped', () => {
    expect(inline('x<em> </em>y')).toBe('x y');
    expect(inline('x<code> </code>y')).toBe('x y');
  });

  /**
   * A comment node has no child nodes, so it serializes to nothing. Falling
   * through to the attribute read instead would reach `node.childNodes` on a
   * node that has none and throw on `.map`.
   */
  it('drops a comment node instead of reaching for its absent child nodes', () => {
    expect(inline('a<!-- hidden -->b')).toBe('ab');
  });

  it('serializes an inline image and an equation source', () => {
    expect(inline('before <img src="https://i/x.png" alt="A shot"> after')).toBe('before ![A shot](https://i/x.png) after');
    expect(inline('<span data-latex="x^2"><span>x^2</span></span>')).toBe('x^2');
  });
});

describe('blocks-to-markdown (view) — document walk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the document through the shared serializer', () => {
    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }]))).toBe('Hello **world**');
  });

  /**
   * `flattenDocument` keeps a `seen` set so a block id that appears twice in
   * the flat wire array is emitted once, and so a parent-reference cycle cannot
   * recurse forever.
   */
  it('emits a block whose id repeats only once', () => {
    const md = blocksToMarkdown(doc([
      { id: 'dup', type: 'paragraph', data: { text: 'First' } },
      { id: 'dup', type: 'paragraph', data: { text: 'Second' } },
    ]));

    expect(md).toBe('First');
  });

  it('returns the Markdown alongside its degradation report', () => {
    expect(blocksToMarkdownWithReport(doc([{ type: 'paragraph', data: { text: 'A' } }])))
      .toStrictEqual({ markdown: 'A', warnings: [] });
  });

  it('returns an empty string for a nullish or empty document', () => {
    expect(blocksToMarkdown(undefined)).toBe('');
    expect(blocksToMarkdown(null)).toBe('');
    expect(blocksToMarkdown(doc([]))).toBe('');
  });
});
