// @vitest-environment node
/**
 * Mutation-directed tests for the DOM-free view sanitizer. Each one pins a
 * decision the existing suite reaches but never reads back, so a mutation of
 * that decision goes unnoticed.
 *
 * Twenty-four recorded mutants are provably equivalent — the code they change
 * cannot produce a different string:
 *
 * - `isTemplateNode`'s `node.nodeName === 'template'` half (parse5 gives no
 *   node type outside a template element a `content` property, so the second
 *   half alone already answers the same for every node).
 * - The `?? ''` fallbacks feeding `parseStyleText` (the replacement literal
 *   carries no colon, so it parses to the same empty declaration list).
 * - Splitting a class attribute on one whitespace character instead of a run
 *   (the `filter(Boolean)` after the split discards the empty pieces).
 * - Every `action: 'keep'` and `kind: 'map'` discriminant in `resolveRule`.
 *   `action` is only ever compared with `'unwrap'` and `kind` only with
 *   `'all'` and `'safe'`, so those two labels are the else-branch and are
 *   never read.
 * - `typeof attrRule === 'string'` in the attr-map filter. A map value is a
 *   boolean or a string, and a boolean can never strict-equal the string
 *   attribute value, so forcing the branch open changes no answer.
 * - The `!isElementNode(node)` guard in the child walk and both mutants inside
 *   it. Text and comment nodes are handled above it and parse5 puts nothing
 *   else in a fragment parsed in a div context — a doctype token is ignored in
 *   the "in body" insertion mode and a CDATA section becomes a text node.
 * - The `parentIsBlock` and `parentIsTop` arguments at the two call sites that
 *   pass a literal. Both feed one expression, `parentIsBlock && !parentIsTop`,
 *   and at each of those sites the other operand already settles it.
 * - The re-parent loop in the normalizer's `unwrapAt`. parse5 reads a text
 *   node's parent only to decide whether that parent is one of style, script,
 *   xmp, iframe, noembed, noframes or plaintext; none of those is a mergeable
 *   inline tag, so a stale parent there cannot change the serialization.
 * - The `return false` and `return true` that report whether a pass changed
 *   anything, in the three shapes that only ever make a pass report MORE work:
 *   the sweep loop is capped, a pass at a fixpoint mutates nothing, and extra
 *   passes therefore produce the same tree.
 * - The `return true` after an unwrap. It only shortens the loop, and an
 *   unwrap-only pass leaves nothing for a later pass: it does not change any
 *   wrapper signature, any descendant text, or any void-content descendant,
 *   which is everything the unwrap and merge rules read.
 * - The `html === ''` half of the no-markup fast path. The empty string holds
 *   none of the characters the second half tests for, so that half already
 *   returns it verbatim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type * as Parse5 from 'parse5';

const parse5 = vi.hoisted(() => ({ throwNext: null as Error | null }));

vi.mock('parse5', async (importOriginal) => {
  const actual = await importOriginal<typeof Parse5>();

  return {
    ...actual,
    parseFragment: (
      first: Parse5.DefaultTreeAdapterMap['parentNode'] | string,
      html?: string
    ): Parse5.DefaultTreeAdapterMap['documentFragment'] => {
      if (parse5.throwNext !== null) {
        const failure = parse5.throwNext;

        parse5.throwNext = null;
        throw failure;
      }

      return typeof first === 'string'
        ? actual.parseFragment(first)
        : actual.parseFragment(first, html ?? '', {});
    },
  };
});

import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import { MAX_NORMALIZATION_SWEEPS } from '../../../src/shared/inline-normalization-policy';
import type { SanitizerConfig } from '../../../types/configs/sanitizer-config';

/** Two more than the sweep cap, so the cap has to bite. */
const OVER_CAP = MAX_NORMALIZATION_SWEEPS + 2;

/** The facade carries `classList`, which is declared on HTMLElement. */
type FacadeElement = HTMLElement;

/**
 * How many times `needle` occurs in `haystack`.
 * @param haystack - string to search
 * @param needle - substring to count
 */
const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * Nested spans with distinct class names, innermost content first. Distinct so
 * no level repeats an ancestor, which would unwrap instead of merge.
 * @param inner - text at the centre
 */
const nestOverCap = (inner: string): string => {
  let markup = inner;

  for (let level = OVER_CAP; level >= 1; level -= 1) {
    markup = `<span class="c${level}">${markup}</span>`;
  }

  return markup;
};

describe('view sanitizer mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parse5.throwNext = null;
  });

  afterEach(() => {
    parse5.throwNext = null;
    vi.restoreAllMocks();
  });

  // The whitespace rule asks for the nearest element on each side. The scan
  // starts one step outside the whitespace node, so a fragment that begins or
  // ends with whitespace asks for an index that is not there.
  describe('scanning for a neighbouring element', () => {
    it('drops leading whitespace before a block with nothing on its left', () => {
      expect(sanitizeHtmlFragment(' <p>a</p>', { p: true })).toBe('<p>a</p>');
    });

    it('keeps trailing whitespace after an inline element with nothing on its right', () => {
      expect(sanitizeHtmlFragment('<span>a</span> ', { span: true })).toBe('<span>a</span> ');
    });

    // Unwrapping the <b> leaves its space directly beside the sibling text, so
    // the scan meets a second text node and has to keep going the way it was
    // sent rather than turn around.
    it('steps over an intervening text node in the direction it was given', () => {
      expect(sanitizeHtmlFragment('<b> </b>x<p>b</p>', { p: true })).toBe('x<p>b</p>');
    });
  });

  // A template is recognised by its tag name AND its content fragment. An
  // SVG-namespaced <template> is an ordinary foreign element: parse5 gives it
  // the tag name and no content, and treating it as a template reads a
  // fragment that is not there.
  it('leaves a foreign-namespace template to the ordinary child walk', () => {
    expect(sanitizeHtmlFragment('<svg><template>x</template></svg>', { svg: true, template: true }))
      .toBe('<svg><template>x</template></svg>');
  });

  it('hands a function rule an iterable class list', () => {
    const seen: string[][] = [];
    const config = {
      p: (element: FacadeElement) => {
        seen.push([...element.classList]);

        return true;
      },
    } as unknown as SanitizerConfig;

    sanitizeHtmlFragment('<p class="one two">t</p>', config);

    expect(seen).toEqual([['one', 'two']]);
  });

  // `typeof null` is 'object', so the object branch has to exclude null or a
  // null rule reads as an empty allowlist entry and keeps the tag.
  it('unwraps a tag whose rule is null', () => {
    const config = { b: null } as unknown as SanitizerConfig;

    expect(sanitizeHtmlFragment('<b>x</b>', config)).toBe('x');
  });

  // parse5 records a foreign-content attribute as a name plus a namespace and
  // serializes the pair back as `xlink:href`. The URL pass must hand back the
  // attribute it was given when nothing changed, not a fresh name/value pair,
  // or the prefix is dropped and the attribute means something else.
  it('keeps a namespaced url attribute with its prefix', () => {
    expect(sanitizeHtmlFragment('<svg><image xlink:href="/a.png"></image></svg>', {
      svg: true,
      image: { href: true },
    })).toBe('<svg><image xlink:href="/a.png"></image></svg>');
  });

  // One block child is enough to make the markup invalid; the other children
  // do not have to be blocks too.
  it('unwraps an inline element holding a block among other children', () => {
    expect(sanitizeHtmlFragment('<b>t<p>x</p></b>', { b: {}, p: {} })).toBe('t<p>x</p>');
  });

  // parse5 escapes a text node according to its parent, and the parent of an
  // iframe's text is a raw-text element. Hoisting the text without re-parenting
  // it leaves the ampersand unescaped in the output.
  it('re-parents hoisted text so its new parent decides the escaping', () => {
    expect(sanitizeHtmlFragment('<iframe>a & b</iframe>', { p: true })).toBe('a &amp; b');
  });

  // A decorative wrapper holding no text is dropped unless it wraps something
  // that is content in its own right.
  describe('wrappers around content that holds no text', () => {
    const config = { b: true, br: true, img: { src: true } };

    it('keeps a wrapper whose child is an image', () => {
      expect(sanitizeHtmlFragment('<b><img src="/x"></b>', config)).toBe('<b><img src="/x"></b>');
    });

    it('drops a wrapper whose child is not content of its own', () => {
      expect(sanitizeHtmlFragment('<b><br></b>', config)).toBe('<br>');
    });

    // The text node comes first, so the search cannot stop at the first child
    // and cannot demand that every child qualify.
    it('keeps a wrapper holding whitespace beside an image', () => {
      expect(sanitizeHtmlFragment('<b> <img src="/x"></b>', config)).toBe('<b> <img src="/x"></b>');
    });
  });

  // Two wrappers merge when they express the same formatting, and inline style
  // is part of that. Reading the style off the wrong attribute makes every
  // styled wrapper look identical.
  it('does not merge adjacent wrappers whose inline styles differ', () => {
    expect(sanitizeHtmlFragment(
      '<span style="color:red">a</span><span style="color:blue">b</span>',
      { span: { style: true } }
    )).toBe('<span style="color:red">a</span><span style="color:blue">b</span>');
  });

  // The sweep loop is capped, so a level that finishes only one wrapper per
  // pass cannot clear a run longer than the cap. Both of these are one pass of
  // work when the pass rescans from where it changed something.
  describe('finishing a level in one pass', () => {
    it('unwraps every empty wrapper on a level', () => {
      const empties = Array.from({ length: OVER_CAP }, (_, index) => `<i class="c${index}"></i>`).join('');

      expect(sanitizeHtmlFragment(empties, { i: true })).toBe('');
    });

    it('merges every interchangeable sibling on a level', () => {
      expect(sanitizeHtmlFragment('<b>a</b>'.repeat(OVER_CAP), { b: true }))
        .toBe(`<b>${'a'.repeat(OVER_CAP)}</b>`);
    });
  });

  // Merging the two <b> leaves a pair of <i> inside them that only the next
  // pass can merge, so the pass has to report the change. The <em> changes
  // nothing, which is what makes "every child changed" the wrong question.
  it('reports a change made in one child even when a sibling changed nothing', () => {
    expect(sanitizeHtmlFragment(
      '<span><b><i>a</i></b><b><i>b</i></b></span><em>z</em>',
      { span: true, b: true, i: true, em: true }
    )).toBe('<span><b><i>ab</i></b></span><em>z</em>');
  });

  // Each pass merges one nesting level, so two levels more than the cap need
  // two passes more than the loop will run. The innermost two levels are still
  // pairs — that is the cap being observed rather than described.
  it('stops sweeping at the capped number of passes', () => {
    const out = sanitizeHtmlFragment(`${nestOverCap('a')}${nestOverCap('b')}`, { span: true });

    expect(countOf(out, `class="c${MAX_NORMALIZATION_SWEEPS}"`)).toBe(1);
    expect(countOf(out, `class="c${MAX_NORMALIZATION_SWEEPS + 1}"`)).toBe(2);
    expect(countOf(out, `class="c${OVER_CAP}"`)).toBe(2);
  });

  // Only the surrogate RangeError is retried on repaired input. Any other
  // parser fault has to propagate, or a real defect is silently papered over by
  // a second parse of the same text.
  it('propagates a parse failure that is not a RangeError', () => {
    parse5.throwNext = new TypeError('synthetic parse failure');

    expect(() => sanitizeHtmlFragment('<p>x</p>', { p: true })).toThrow(TypeError);
  });
});
