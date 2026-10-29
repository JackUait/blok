/**
 * The tree builder must not depend on where character runs split: the own
 * tokenizer may cut runs where parse5's does not. This wraps the tokenizer,
 * re-splits every character token at seeded random points and checks the
 * trees still match parse5's.
 */
import * as parse5 from 'parse5';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterToken, TokenHandler, TokenType } from '../../../src/html/token';
import type * as TokenizerModule from '../../../src/html/tokenizer';
import { parse, parseFragment, type Element, type TextNode } from '../../../src/html';
import { compareTrees, type ComparableNode } from './compare';
import { fuzzHtml, treeConstructionInputs } from './corpus';

const split = vi.hoisted(() => ({
  /** Chance to cut between two characters of a run. */
  probability: 0.3,
  state: 1,
  /** Character tokens of one type that came right after one of the same type. */
  adjacentSameType: 0,
  cuts: 0,
}));

/** mulberry32: seeded, the same cuts on every run. */
const nextRandom = (): number => {
  split.state = (split.state + 0x6d2b79f5) >>> 0;
  const a = Math.imul(split.state ^ (split.state >>> 15), split.state | 1);
  const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a;

  return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
};

const pieces = (chars: string): string[] => {
  const out: string[] = [];
  const start = { index: 0 };

  for (let index = 1; index < chars.length; index++) {
    if (nextRandom() < split.probability) {
      out.push(chars.slice(start.index, index));
      start.index = index;
    }
  }
  out.push(chars.slice(start.index));
  split.cuts += out.length - 1;

  return out;
};

const splitting = (handler: TokenHandler): TokenHandler => {
  const last: { type: TokenType | null } = { type: null };
  const forward = (token: CharacterToken, emit: (piece: CharacterToken) => void): void => {
    if (last.type === token.type) {
      split.adjacentSameType += 1;
    }
    last.type = token.type;
    pieces(token.chars).forEach((chars) => emit({ type: token.type, chars }));
  };
  const other = <T>(emit: (token: T) => void) => (token: T): void => {
    last.type = null;
    emit(token);
  };

  return {
    onCharacter: (token) => forward(token, (piece) => handler.onCharacter(piece)),
    onNullCharacter: (token) => forward(token, (piece) => handler.onNullCharacter(piece)),
    onWhitespaceCharacter: (token) => forward(token, (piece) => handler.onWhitespaceCharacter(piece)),
    onStartTag: other((token) => handler.onStartTag(token)),
    onEndTag: other((token) => handler.onEndTag(token)),
    onComment: other((token) => handler.onComment(token)),
    onDoctype: other((token) => handler.onDoctype(token)),
    onEof: other((token) => handler.onEof(token)),
  };
};

vi.mock('../../../src/html/tokenizer', async (importOriginal) => {
  const real = await importOriginal<typeof TokenizerModule>();

  return {
    // A constructor that returns an object: `new Tokenizer(handler)` yields the real tokenizer.
    Tokenizer: function Tokenizer(handler: TokenHandler) {
      return new real.Tokenizer(splitting(handler));
    },
  };
});

const ourDiv = parseFragment('<div></div>').childNodes[0] as Element;
const theirDiv = parse5.parseFragment('<div></div>').childNodes[0] as parse5.DefaultTreeAdapterTypes.Element;

const mismatchesFor = (inputs: readonly string[]): string[] => {
  const mismatches: string[] = [];

  inputs.forEach((html, seed) => {
    const pairs: Array<[() => unknown, () => unknown]> = [
      [() => parse(html), () => parse5.parse(html)],
      [() => parseFragment(html), () => parse5.parseFragment(html)],
      [() => parseFragment(ourDiv, html), () => parse5.parseFragment(theirDiv, html, {})],
    ];

    pairs.forEach(([ours, theirs]) => {
      split.state = seed + 1;
      try {
        const difference = compareTrees(ours() as ComparableNode, theirs() as ComparableNode);

        if (difference !== null) {
          mismatches.push(`${JSON.stringify(html.slice(0, 120))}: ${difference}`);
        }
      } catch {
        // parse5 throws on two adjacent lone low surrogates; the differential test covers those.
      }
    });
  });

  return mismatches;
};

describe('character run boundaries', () => {
  beforeEach(() => {
    split.probability = 0.3;
    split.adjacentSameType = 0;
    split.cuts = 0;
  });

  it('a NUL run in foreign content stays one U+FFFD however it is split, as in parse5', () => {
    split.probability = 1;
    const svg = parseFragment('<svg>a\0\0\0b<![CDATA[\0\0]]></svg>').childNodes[0] as Element;

    expect(split.cuts).toBeGreaterThan(0);
    expect(svg.childNodes.map((node) => (node as TextNode).value)).toEqual(['a�b�']);
  });

  it('a newline right after <pre> and <textarea> is dropped once, however whitespace is split', () => {
    split.probability = 1;
    const fragment = parseFragment('<pre>\n\n x</pre><textarea>\n\nx</textarea>');
    const texts = fragment.childNodes.map((node) => ((node as Element).childNodes[0] as TextNode).value);

    expect(texts).toEqual(['\n x', '\nx']);
  });

  it('does not change trees on the html5lib inputs', () => {
    expect(mismatchesFor(treeConstructionInputs())).toEqual([]);
    expect(split.cuts).toBeGreaterThan(10_000);
  }, 60_000);

  it('does not change trees on fuzzed fragments, splitting every character', () => {
    split.probability = 1;
    expect(mismatchesFor(Array.from({ length: 3000 }, (_, seed) => fuzzHtml(seed)))).toEqual([]);
  }, 60_000);

  it('gets maximal runs from the stand-in, so merging adjacent runs has nothing to undo', () => {
    split.probability = 0;
    mismatchesFor(treeConstructionInputs());

    expect(split.adjacentSameType).toBe(0);
  }, 60_000);
});
