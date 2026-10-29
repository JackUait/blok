/**
 * The tree builder must not depend on where character runs split: the own
 * tokenizer may cut or join runs where parse5's does not. This wraps the
 * tokenizer, re-splits character tokens at seeded random points or merges
 * adjacent ones of the same type, and checks the trees still match parse5's.
 */
import * as parse5 from 'parse5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterToken, TokenHandler } from '../../../src/html/token';
import type * as TokenizerModule from '../../../src/html/tokenizer';
import { parse, parseFragment, type Element, type TextNode } from '../../../src/html';
import { compareTrees, type ComparableNode } from './compare';
import { fuzzHtml, treeConstructionInputs } from './corpus';

const runs = vi.hoisted(() => ({
  mode: 'split',
  /** Chance to cut between two characters of a run, in split mode. */
  probability: 0.3,
  state: 1,
  cuts: 0,
  merges: 0,
}));

/** mulberry32: seeded, the same cuts on every run. */
const nextRandom = (): number => {
  runs.state = (runs.state + 0x6d2b79f5) >>> 0;
  const a = Math.imul(runs.state ^ (runs.state >>> 15), runs.state | 1);
  const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a;

  return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
};

const pieces = (chars: string): string[] => {
  const out: string[] = [];
  const start = { index: 0 };

  for (let index = 1; index < chars.length; index++) {
    if (nextRandom() < runs.probability) {
      out.push(chars.slice(start.index, index));
      start.index = index;
    }
  }
  out.push(chars.slice(start.index));
  runs.cuts += out.length - 1;

  return out;
};

type CharacterMethod = 'onCharacter' | 'onNullCharacter' | 'onWhitespaceCharacter';

const rewriting = (handler: TokenHandler): TokenHandler => {
  // Merge mode holds one run until a token of another type arrives; it never holds a run past a non-character token.
  const held: { method: CharacterMethod | null; token: CharacterToken | null } = { method: null, token: null };
  const flush = (): void => {
    if (held.method !== null && held.token !== null) {
      handler[held.method](held.token);
    }
    held.method = null;
    held.token = null;
  };
  const character = (method: CharacterMethod) => (token: CharacterToken): void => {
    if (runs.mode === 'split') {
      pieces(token.chars).forEach((chars) => handler[method]({ type: token.type, chars }));

      return;
    }
    if (held.token !== null && held.token.type === token.type) {
      held.token.chars += token.chars;
      runs.merges += 1;

      return;
    }
    flush();
    held.method = method;
    held.token = { type: token.type, chars: token.chars };
  };
  const other = <T>(emit: (token: T) => void) => (token: T): void => {
    flush();
    emit(token);
  };

  return {
    onCharacter: character('onCharacter'),
    onNullCharacter: character('onNullCharacter'),
    onWhitespaceCharacter: character('onWhitespaceCharacter'),
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
      return new real.Tokenizer(rewriting(handler));
    },
  };
});

const ourDiv = parseFragment('<div></div>').childNodes[0] as Element;
const theirDiv = parse5.parseFragment('<div></div>').childNodes[0] as parse5.DefaultTreeAdapterTypes.Element;

const parse5Tree = (run: () => unknown): unknown => {
  try {
    return run();
  } catch {
    // parse5 throws on two adjacent lone low surrogates; the differential test covers those.
    return null;
  }
};

const mismatchesFor = (inputs: readonly string[]): string[] => {
  const mismatches: string[] = [];

  inputs.forEach((html, seed) => {
    const pairs: Array<[() => unknown, () => unknown]> = [
      [() => parse(html), () => parse5.parse(html)],
      [() => parseFragment(html), () => parse5.parseFragment(html)],
      [() => parseFragment(ourDiv, html), () => parse5.parseFragment(theirDiv, html, {})],
    ];

    pairs.forEach(([ours, theirs]) => {
      const expected = parse5Tree(theirs);

      if (expected === null) {
        return;
      }
      runs.state = seed + 1;
      const difference = compareTrees(ours() as ComparableNode, expected as ComparableNode);

      if (difference !== null) {
        mismatches.push(`${JSON.stringify(html.slice(0, 120))}: ${difference}`);
      }
    });
  });

  return mismatches;
};

describe('character run boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runs.mode = 'split';
    runs.probability = 0.3;
    runs.cuts = 0;
    runs.merges = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a NUL run in foreign content stays one U+FFFD however it is split, as in parse5', () => {
    runs.probability = 1;
    const svg = parseFragment('<svg>a\0\0\0b<![CDATA[\0\0]]></svg>').childNodes[0] as Element;

    expect(runs.cuts).toBeGreaterThan(0);
    expect(svg.childNodes.map((node) => (node as TextNode).value)).toEqual(['a�b�']);
  });

  it('a newline right after <pre> and <textarea> is dropped once, however whitespace is split', () => {
    runs.probability = 1;
    const fragment = parseFragment('<pre>\n\n x</pre><textarea>\n\nx</textarea>');
    const texts = fragment.childNodes.map((node) => ((node as Element).childNodes[0] as TextNode).value);

    expect(texts).toEqual(['\n x', '\nx']);
  });

  it('does not change trees on the html5lib inputs', () => {
    expect(mismatchesFor(treeConstructionInputs())).toEqual([]);
    expect(runs.cuts).toBeGreaterThan(10_000);
  }, 60_000);

  it('does not change trees on fuzzed fragments, splitting every character', () => {
    runs.probability = 1;
    expect(mismatchesFor(Array.from({ length: 3000 }, (_, seed) => fuzzHtml(seed)))).toEqual([]);
  }, 60_000);

  it('does not change trees when adjacent runs of one type are merged', () => {
    runs.mode = 'merge';
    expect(mismatchesFor(treeConstructionInputs())).toEqual([]);
    expect(mismatchesFor(Array.from({ length: 3000 }, (_, seed) => fuzzHtml(seed)))).toEqual([]);
    // parse5's tokenizer already emits maximal runs, so with the stand-in there is nothing to merge.
    console.log(`merged ${runs.merges} adjacent runs`);
  }, 60_000);
});
