import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackgroundTextNodes } from '../../../../../src/components/selection/fake-background/text-nodes';

/**
 * Top reported for a range whose start is NOT the text node under test.
 * It is a single constant on purpose: a walk that never re-anchors its start
 * then sees one unchanging top and finds no line break at all.
 */
const OFF_NODE_TOP = 999;

/**
 * Test helper stubbing the layout query jsdom answers with all zeros.
 * The top is keyed on the range START offset, which is the only thing the
 * production code varies between measurements.
 */
const stubRangeTops = (textNode: Text, tops: readonly number[]): void => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range): DOMRect {
    if (this.startContainer !== textNode) {
      return new DOMRect(0, OFF_NODE_TOP, 0, 0);
    }

    return new DOMRect(0, tops[this.startOffset] ?? OFF_NODE_TOP, 0, 0);
  });
};

/**
 * Test helper attaching a text node to the document.
 */
const appendText = (parent: HTMLElement, data: string): Text => {
  const node = document.createTextNode(data);

  parent.appendChild(node);

  return node;
};

/**
 * Test helper creating an attached container.
 */
const makeContainer = (): HTMLElement => {
  const container = document.createElement('div');

  document.body.appendChild(container);

  return container;
};

/**
 * Test helper reading a paragraph's text node with a real type guard.
 */
const textChildOf = (element: Element): Text => {
  const child = element.firstChild;

  if (!(child instanceof Text)) {
    throw new Error(`Expected a text child in <${element.tagName}>`);
  }

  return child;
};

/**
 * Ten characters over three painted lines: offsets 0-2 sit at top 10,
 * 3-5 at top 30, 6-9 at top 50. So the real breaks are at 3 and 6.
 *
 * The first line's top is 10, not 0: with a first top of 0 the seed
 * `lastTop === -1` is only 1px away, which is under the 5px threshold, and a
 * mutant that drops the `lastTop !== -1` seed check would still agree with the
 * original on the very first character.
 */
const TEXT = 'abcdefghij';
const TOPS = [10, 10, 10, 30, 30, 30, 50, 50, 50, 50];

describe('FakeBackgroundTextNodes — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('collectTextNodes', () => {
    it('returns only the intersecting text nodes, in document order', () => {
      const container = makeContainer();

      container.innerHTML = '<p>AAA</p><p>BBB</p><p>CCC</p>';

      const paragraphs = container.querySelectorAll('p');
      const first = textChildOf(paragraphs[0]);
      const second = textChildOf(paragraphs[1]);
      const third = textChildOf(paragraphs[2]);

      const range = document.createRange();

      range.setStart(first, 1);
      range.setEnd(second, 2);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result.map((node) => node.textContent)).toEqual(['AAA', 'BBB']);
      expect(result[0]).toBe(first);
      expect(result[1]).toBe(second);
      expect(result.includes(third)).toBe(false);
    });

    it('drops empty text nodes that do intersect the range', () => {
      const container = makeContainer();
      const first = appendText(container, 'AAA');
      const empty = appendText(container, '');
      const last = appendText(container, 'BBB');

      const range = document.createRange();

      range.selectNodeContents(container);

      // The rejection has to come from the emptiness check, not from the
      // intersection check above it.
      expect(range.intersectsNode(empty)).toBe(true);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result.map((node) => node.textContent)).toEqual(['AAA', 'BBB']);
      expect(result[0]).toBe(first);
      expect(result[1]).toBe(last);
      expect(result.includes(empty)).toBe(false);
    });

    it('skips a node whose textContent reads null instead of dereferencing it', () => {
      const container = makeContainer();
      const first = appendText(container, 'AAA');
      const nulled = appendText(container, 'ZZZ');
      const last = appendText(container, 'BBB');

      // Node.textContent is typed `string | null`, so the `&&` guard is
      // type-required; swapping it for `||` dereferences the null.
      Object.defineProperty(nulled, 'textContent', {
        configurable: true,
        get: () => null,
      });

      const range = document.createRange();

      range.selectNodeContents(container);

      expect(range.intersectsNode(nulled)).toBe(true);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(first);
      expect(result[1]).toBe(last);
    });
  });

  describe('findLineBreakPositions', () => {
    it('returns exactly the offsets where the measured top jumps', () => {
      const container = makeContainer();
      const textNode = appendText(container, TEXT);

      stubRangeTops(textNode, TOPS);

      expect(FakeBackgroundTextNodes.findLineBreakPositions(textNode, 3)).toEqual([3, 6]);
    });

    it('stops collecting after expectedLines - 1 breaks', () => {
      const container = makeContainer();
      const textNode = appendText(container, TEXT);

      stubRangeTops(textNode, TOPS);

      // Two breaks exist (3 and 6); two expected lines may keep only the first.
      expect(FakeBackgroundTextNodes.findLineBreakPositions(textNode, 2)).toEqual([3]);
    });

    it('measures nothing when a single line is expected', () => {
      const container = makeContainer();
      const textNode = appendText(container, TEXT);

      stubRangeTops(textNode, TOPS);

      expect(FakeBackgroundTextNodes.findLineBreakPositions(textNode, 1)).toEqual([]);
    });

    it('treats a top difference of exactly 5 as the same line', () => {
      const container = makeContainer();
      const textNode = appendText(container, 'abcdef');

      // Offsets 2-3 sit exactly 5px below 0-1 — on the threshold, not past it.
      stubRangeTops(textNode, [10, 10, 15, 15, 40, 40]);

      expect(FakeBackgroundTextNodes.findLineBreakPositions(textNode, 3)).toEqual([4]);
    });

    it('measures nothing for an empty text node', () => {
      const container = makeContainer();
      const textNode = appendText(container, '');

      stubRangeTops(textNode, []);

      // A non-empty fallback for the missing text would walk offsets the node
      // does not have, and setEnd would throw IndexSizeError.
      expect(FakeBackgroundTextNodes.findLineBreakPositions(textNode, 3)).toEqual([]);
    });
  });

  describe('splitTextAtPositions', () => {
    it('returns every segment between the break points', () => {
      expect(FakeBackgroundTextNodes.splitTextAtPositions('abcdefghij', [3, 6])).toEqual([
        'abc',
        'def',
        'ghij',
      ]);
    });

    it('drops the empty segment a break point at 0 produces', () => {
      expect(FakeBackgroundTextNodes.splitTextAtPositions('abcdefghij', [0, 6])).toEqual([
        'abcdef',
        'ghij',
      ]);
    });
  });
});

/*
 * Mutants proven EQUIVALENT — no input can distinguish them, so no test is written.
 *
 * text-nodes.ts@26:37-26:64 ConditionalExpression: true
 * text-nodes.ts@26:37-26:64 EqualityOperator: node.textContent.length >= 0
 *   Both replace the RIGHT operand of `node.textContent && node.textContent.length > 0`.
 *   That operand is only evaluated when `node.textContent` is a non-empty string, and
 *   for every non-empty string `length > 0`, `true` and `length >= 0` are all `true`.
 *   The ternary therefore picks FILTER_ACCEPT in the original and in both mutants.
 *
 * text-nodes.ts@82:11-82:35 MethodExpression: breakPoints
 *   Drops `.slice(0, -1)` from `breakPoints.slice(0, -1).map(...)`. The extra iteration
 *   is always the LAST break point, which is always `text.length`, and it maps to
 *   `text.substring(text.length, undefined)` — verified to be `''` for every input,
 *   since `substring` treats an undefined end as the string length.
 *   `.filter((segment) => segment.length > 0)` then removes it, so the output is byte
 *   identical for every (text, positions) pair.
 */
