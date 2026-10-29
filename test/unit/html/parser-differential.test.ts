/**
 * Differential test: src/html's tree builder against parse5 (the oracle) over
 * real pages, the html5lib inputs, the repo's stored fields and a seeded fuzz,
 * through all three entry points Blok uses.
 */
import * as parse5 from 'parse5';
import { describe, expect, it } from 'vitest';
import { parse, parseFragment, type Element } from '../../../src/html';
import { compareTrees, type ComparableNode } from './compare';
import { fuzzHtml, realDocuments, storedFields, treeConstructionInputs } from './corpus';

const FUZZ_CASES = 20_000;
const SLOW = 60_000;

const ourDiv = parseFragment('<div></div>').childNodes[0] as Element;
const theirDiv = parse5.parseFragment('<div></div>').childNodes[0] as parse5.DefaultTreeAdapterTypes.Element;

const ENTRY_POINTS = [
  { name: 'parse', ours: (html: string) => parse(html), theirs: (html: string) => parse5.parse(html) },
  { name: 'parseFragment', ours: (html: string) => parseFragment(html), theirs: (html: string) => parse5.parseFragment(html) },
  {
    name: 'parseFragment(div)',
    ours: (html: string) => parseFragment(ourDiv, html),
    theirs: (html: string) => parse5.parseFragment(theirDiv, html, {}),
  },
] as const;

interface Outcome {
  compared: number;
  bothThrew: number;
  onlyParse5Threw: number;
  onlyOursThrew: number;
  thrown: string[];
  mismatches: string[];
}

const attempt = (run: () => unknown): { value: unknown; threw: boolean } => {
  try {
    return { value: run(), threw: false };
  } catch {
    return { value: undefined, threw: true };
  }
};

type Kind = 'compared' | 'bothThrew' | 'onlyParse5Threw' | 'onlyOursThrew';

const throwKey = (theirsThrew: boolean, oursThrew: boolean): Kind => {
  if (theirsThrew && oursThrew) {
    return 'bothThrew';
  }

  return theirsThrew ? 'onlyParse5Threw' : 'onlyOursThrew';
};

const compareOne = (html: string, entry: (typeof ENTRY_POINTS)[number]): { kind: Kind; mismatch: string | null } => {
  const theirs = attempt(() => entry.theirs(html));
  const ours = attempt(() => entry.ours(html));

  if (theirs.threw || ours.threw) {
    return { kind: throwKey(theirs.threw, ours.threw), mismatch: null };
  }

  const difference = compareTrees(ours.value as ComparableNode, theirs.value as ComparableNode);

  return { kind: 'compared', mismatch: difference === null ? null : `${entry.name} ${JSON.stringify(html.slice(0, 200))}: ${difference}` };
};

const differ = (inputs: readonly string[]): Outcome => {
  const outcome: Outcome = { compared: 0, bothThrew: 0, onlyParse5Threw: 0, onlyOursThrew: 0, thrown: [], mismatches: [] };

  inputs.forEach((html) => ENTRY_POINTS.forEach((entry) => {
    const { kind, mismatch } = compareOne(html, entry);

    outcome[kind] += 1;
    if (kind !== 'compared') {
      outcome.thrown.push(html);
    }
    if (mismatch !== null) {
      outcome.mismatches.push(mismatch);
    }
  }));

  return outcome;
};

/**
 * parse5 throws a RangeError on two adjacent lone low surrogates, and ours
 * throws on exactly the same inputs: Blok's callers repair and retry on it.
 */
const expectClean = (outcome: Outcome, inputs: readonly string[]): void => {
  expect(outcome.mismatches).toEqual([]);
  expect(outcome.onlyOursThrew).toBe(0);
  expect(outcome.onlyParse5Threw).toBe(0);

  expect(outcome.thrown.filter((html) => !/[\udc00-\udfff][\udc00-\udfff]/.test(html))).toEqual([]);
  expect(outcome.compared + outcome.bothThrew + outcome.onlyParse5Threw).toBe(inputs.length * ENTRY_POINTS.length);
};

describe('tree builder matches parse5', () => {
  it('on real documents', () => {
    const inputs = realDocuments().map((document) => document.html);
    const outcome = differ(inputs);

    expectClean(outcome, inputs);
    expect(outcome.compared).toBeGreaterThan(0);
  }, SLOW);

  it('on every html5lib tree-construction input', () => {
    const inputs = treeConstructionInputs();
    const outcome = differ(inputs);

    expectClean(outcome, inputs);
  }, SLOW);

  it('on the stored fields of the repo documents', () => {
    const inputs = storedFields();
    const outcome = differ(inputs);

    expectClean(outcome, inputs);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it(`on ${FUZZ_CASES} fuzzed fragments`, () => {
    const inputs = Array.from({ length: FUZZ_CASES }, (_, seed) => fuzzHtml(seed));
    const outcome = differ(inputs);

    expectClean(outcome, inputs);

    // The inputs parse5 throws on, with U+DC00 swapped out, so they still get compared.
    const repaired = [...new Set(outcome.thrown)].map((html) => html.replaceAll('\udc00', 'x'));
    const repairedOutcome = differ(repaired);

    expectClean(repairedOutcome, repaired);
    expect(repairedOutcome.bothThrew).toBe(0);
    console.log(`fuzz: compared ${outcome.compared} + ${repairedOutcome.compared} repaired, both threw ${outcome.bothThrew}, only parse5 threw ${outcome.onlyParse5Threw}`);
  }, SLOW);
});
