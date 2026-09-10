/**
 * Mutation tests for `src/markdown/blocks-to-markdown.ts` — the DOM inline backend
 * of the block-to-Markdown serializer.
 *
 * Every assertion is an EXACT output string. The module's whole job is to emit
 * precise Markdown, so a swapped marker (`*` for `**`), a lost `~~`, or a literal
 * placeholder where a fallback belongs is the entire class of defect under test.
 * Fixtures give each inline construct its own block so a wrong `case` label shows
 * up as a different string rather than being absorbed by a neighbour.
 *
 * PROVEN EQUIVALENT — L102 `container.innerHTML = html ?? ''` with the `''`
 * replaced by `'Stryker was here!'`. `domInlineBackend` is module-private (it is
 * referenced only inside this file), so `inlineToMarkdown` is reachable only
 * through `serializeBlocksToMarkdown`, and all four of that module's call sites
 * wrap the argument in `asString(...)` — a `typeof value === 'string'` narrow
 * that can only ever yield a string. `html` is therefore never nullish, even
 * when empty, so the `??` right-hand side is unreachable in every state the
 * public API can produce. MEASURED: the mutant was applied and this suite
 * stayed green.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { blocksToMarkdown } from '../../../src/markdown/blocks-to-markdown';
import type { SerializableBlock } from '../../../src/markdown/blocks-to-markdown';

/** A paragraph block whose `data.text` is an inline HTML fragment. */
const paragraph = (html: string): SerializableBlock => ({ tool: 'paragraph',
  data: { text: html } });

describe('blocksToMarkdown — inline DOM serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes a plain text block', () => {
    expect(blocksToMarkdown([paragraph('Hello world')])).toBe('Hello world');
  });

  it('drops a comment node instead of emitting its content or a placeholder', () => {
    // A comment is neither a text node nor an element: it has no `getAttribute`
    // and no Markdown. It must contribute an empty string, not throw and not
    // leak a literal.
    expect(blocksToMarkdown([
      paragraph('before'),
      paragraph('<!-- a comment -->'),
      paragraph('after'),
    ])).toBe('before\n\nafter');
  });

  it('wraps <strong> in double asterisks', () => {
    expect(blocksToMarkdown([paragraph('<strong>bold</strong>')])).toBe('**bold**');
  });

  it('wraps <em> in single asterisks', () => {
    expect(blocksToMarkdown([paragraph('<em>italic</em>')])).toBe('*italic*');
  });

  it('leaves whitespace-only emphasis unwrapped rather than emitting empty markers', () => {
    expect(blocksToMarkdown([paragraph('a<em> </em>b')])).toBe('a b');
  });

  it('leaves an empty <code> unwrapped rather than emitting empty backticks', () => {
    expect(blocksToMarkdown([paragraph('a<code></code>b')])).toBe('ab');
  });

  it('leaves whitespace-only <code> unwrapped rather than emitting empty backticks', () => {
    expect(blocksToMarkdown([paragraph('a<code> </code>b')])).toBe('a b');
  });

  it('wraps <del> in double tildes', () => {
    expect(blocksToMarkdown([paragraph('<del>gone</del>')])).toBe('~~gone~~');
  });

  it('wraps <strike> in double tildes', () => {
    expect(blocksToMarkdown([paragraph('<strike>gone</strike>')])).toBe('~~gone~~');
  });

  it('serializes a text node whose textContent reads null as empty, not a literal', () => {
    /**
     * The `?? ''` on a text node is a defensive fallback: no live DOM returns
     * null for a Text node's `textContent`. Stubbing the getter is the only way
     * to reach that arm, and it is what proves the fallback is EMPTY rather than
     * any placeholder string.
     */
    vi.spyOn(Node.prototype, 'textContent', 'get').mockReturnValue(null);

    expect(blocksToMarkdown([paragraph('ignored')])).toBe('');
  });
});
