import { describe, it, expect, beforeEach } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * A block's `text` is the tool's `innerHTML` — markup and content in one
 * string — and the concurrent-typing merge diffs it as plain code points. The
 * diff is minimal, so it reuses a CONTENT character as a MARKUP character
 * whenever that is cheaper. When the other peer then edits that content
 * character, the edit lands inside the first peer's tag.
 */
const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const textOf = (store: DocumentStore, id: string): string => {
  const text = store.toJSON().find((candidate) => candidate.id === id)?.data.text;

  return text as string;
};

/** What the reader actually sees, once the browser parses the merged markup. */
const renderedOf = (store: DocumentStore, id: string): HTMLDivElement => {
  const host = document.createElement('div');

  host.innerHTML = textOf(store, id);

  return host;
};

describe('concurrent inline markup — one peer\'s edit lands inside the other\'s tag', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
  });

  const seed = (text: string): void => {
    storeA.fromJSON([{ id: 'b1',
      type: 'paragraph',
      data: { text } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  };

  it('does not leave a broken tag visible when one peer bolds the word the other rewrites', () => {
    seed('The quick brown fox');

    storeA.updateBlockData('b1', 'text', 'The quick <b>brown</b> fox');
    storeB.updateBlockData('b1', 'text', 'The quick red fox');

    sync(storeA, storeB);

    // The reader must never see raw markup characters as words.
    expect(renderedOf(storeA, 'b1').textContent).not.toContain('<');
    expect(textOf(storeA, 'b1')).not.toContain('<>');
    expect(textOf(storeA, 'b1')).toBe(textOf(storeB, 'b1'));
  });

  it('keeps a link pointing at a URL one of the two people actually typed', () => {
    seed('visit example now');

    storeA.updateBlockData('b1', 'text', 'visit <a href="https://example.com">example</a> now');
    storeB.updateBlockData('b1', 'text', 'visit exampel now');

    sync(storeA, storeB);

    const href = renderedOf(storeA, 'b1').querySelector('a')?.getAttribute('href');

    // Nobody typed "exampe.com". A merged href is a link to a domain neither
    // person chose, which a stranger is free to register.
    expect(href).toBe('https://example.com');
    expect(textOf(storeA, 'b1')).toBe(textOf(storeB, 'b1'));
  });

  it('keeps the highlight when the other peer fixes a letter in the marked word', () => {
    seed('report alpha client gamma');

    storeA.updateBlockData('b1', 'text', '<mark>report</mark> alpha client gamma');
    storeB.updateBlockData('b1', 'text', 'xeport alpha client gamma');

    sync(storeA, storeB);

    // The diff spends the word's own "r" on the tag name, so the tag becomes
    // <mak> — an unknown element. The highlight is gone with no visible error.
    expect(renderedOf(storeA, 'b1').querySelector('mark')).not.toBeNull();
    expect(textOf(storeA, 'b1')).toBe(textOf(storeB, 'b1'));
  });
});

/**
 * The two cases above are not anecdotes. Marking a word while the other person
 * fixes a letter IN that word is an everyday collision, and a seeded sweep of
 * 400 such pairs measures how often the merge damages the markup.
 */
describe('concurrent inline markup — marking a word the other peer is fixing', () => {
  const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'report', 'summary', 'example',
    'project', 'status', 'review', 'budget', 'design', 'system', 'client', 'update'];
  const TAGS = ['b', 'i', 'u', 'mark', 'code'];

  /** Deterministic, so a failure names the same pairs every run. */
  const createRandom = (seed: number): ((bound: number) => number) => {
    let value = seed;

    return (bound: number): number => {
      value = (value * 1103515245 + 12345) & 0x7fffffff;

      return value % bound;
    };
  };

  /** Delete, replace or insert one letter — the three ways a typo gets fixed. */
  const fixLetter = (word: string, at: number, mode: number): string => {
    if (mode === 0) {
      return word.slice(0, at) + word.slice(at + 1);
    }

    if (mode === 1) {
      return `${word.slice(0, at)}x${word.slice(at + 1)}`;
    }

    return `${word.slice(0, at)}q${word.slice(at)}`;
  };

  it('never damages the markup across 400 mark-versus-letter-fix pairs', () => {
    const nextRandom = createRandom(12345);
    const damaged: string[] = [];

    for (let round = 0; round < 400; round += 1) {
      const words = [0, 1, 2, 3].map(() => WORDS[nextRandom(WORDS.length)]);
      const target = nextRandom(words.length);
      const tag = TAGS[nextRandom(TAGS.length)];
      const word = words[target];
      const at = nextRandom(word.length);
      const mode = nextRandom(3);
      const fixed = fixLetter(word, at, mode);

      const storeOne = createStore();
      const storeTwo = createStore();

      storeOne.fromJSON([{ id: 'b1',
        type: 'paragraph',
        data: { text: words.join(' ') } }]);
      storeTwo.applyRemoteUpdate(storeOne.encodeStateAsUpdate());

      storeOne.updateBlockData('b1', 'text',
        words.map((each, index) => (index === target ? `<${tag}>${each}</${tag}>` : each)).join(' '));
      storeTwo.updateBlockData('b1', 'text',
        words.map((each, index) => (index === target ? fixed : each)).join(' '));

      sync(storeOne, storeTwo);

      const merged = textOf(storeOne, 'b1');
      const host = document.createElement('div');

      host.innerHTML = merged;

      const showsMarkup = (host.textContent ?? '').includes('<');
      const lostTheTag = host.querySelector(tag) === null;

      if (showsMarkup || lostTheTag) {
        damaged.push(merged);
      }
    }

    expect(damaged).toEqual([]);
  });
});
