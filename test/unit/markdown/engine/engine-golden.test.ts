import { parseMarkdown } from '../../../../src/markdown/engine';
import { hasMathSignal } from '../../../../src/markdown/math-syntax';
import { loadCorpus, normalizeTree, readFixture, stripPhrasing } from './corpus';

/**
 * The engine against trees recorded from the parser Blok used before
 * (mdast-util-from-markdown + GFM + math), on the upstream test inputs, the
 * CommonMark spec and a seeded fuzz corpus. A difference is a behaviour
 * change for every caller of markdownToBlocks, the paste path and the preview.
 *
 * `MD_ENGINE_STRUCTURE=1` compares block structure only (inline children
 * dropped), for work on the block parser alone.
 */
const structureOnly = process.env.MD_ENGINE_STRUCTURE === '1';
const shape = (tree: unknown): unknown => (structureOnly ? stripPhrasing(tree) : tree);

const corpus = loadCorpus();
const golden = readFixture<unknown[]>('golden-mdast.json');
const goldenCommonmark = readFixture<unknown[]>('golden-mdast-commonmark.json');
const cases = corpus.map((entry, index) => ({ ...entry, index }));
const specCases = cases.filter((entry) => entry.commonmark === true);

const parse = (input: string, gfm: boolean): unknown =>
  normalizeTree(JSON.parse(JSON.stringify(parseMarkdown(input, { gfm, math: hasMathSignal(input) }))));

describe('markdown engine matches the recorded trees', () => {
  it('has one golden per corpus case', () => {
    expect(golden).toHaveLength(corpus.length);
    expect(goldenCommonmark).toHaveLength(specCases.length);
  });

  it.each(cases)('$source ($index)', ({ input, index }) => {
    expect(shape(parse(String(input), true))).toStrictEqual(shape(golden[index]));
  });

  it.each(specCases.map((entry, specIndex) => ({ ...entry, specIndex })))('gfm off: $source', ({ input, specIndex }) => {
    expect(shape(parse(String(input), false))).toStrictEqual(shape(goldenCommonmark[specIndex]));
  });
});
