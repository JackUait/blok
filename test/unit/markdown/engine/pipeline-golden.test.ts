import { describe, expect, it } from 'vitest';
import { markdownToBlocksWithReport } from '../../../../src/markdown/index';
import { markdownToHtml } from '../../../../src/markdown/markdownToHtml';
import type { InternalMarkdownImportConfig } from '../../../../src/markdown/types';
import { loadCorpus, normalizeIds, readFixture, type CorpusCase } from './corpus';

/**
 * What callers see, recorded before Blok had its own parser: the blocks and
 * warnings `markdownToBlocksWithReport` returns, the paste path's HTML-text
 * blocks, and the preview HTML. Any difference here reaches a document.
 * Re-recorded on purpose: six preview goldens (217, 839, 1961, 1975, 1995,
 * 1996), since the preview now resolves definitions inside quotes and lists,
 * and real-world html 60, whose code block the new highlighter colours.
 */
const corpus = loadCorpus().map((entry, index) => ({ ...entry, index }));
const blocks = readFixture<unknown[]>('golden-blocks.json');
const paste = readFixture<unknown[]>('golden-blocks-paste.json');
const html = readFixture<unknown[]>('golden-html.json');
const realworld = readFixture<CorpusCase[]>('realworld-corpus.json').map((entry, index) => ({ ...entry, index }));
const realworldBlocks = readFixture<unknown[]>('golden-realworld-blocks.json');
const realworldHtml = readFixture<unknown[]>('golden-realworld-html.json');
const pasteConfig: InternalMarkdownImportConfig = { softBreaks: true, htmlText: true };

describe('markdown pipeline output matches the recorded output', () => {
  it('has one golden per case', () => {
    expect([blocks.length, paste.length, html.length]).toStrictEqual([corpus.length, corpus.length, corpus.length]);
    expect([realworldBlocks.length, realworldHtml.length]).toStrictEqual([realworld.length, realworld.length]);
  });

  it.each(corpus)('blocks: $source ($index)', async ({ input, index }) => {
    expect(normalizeIds(await markdownToBlocksWithReport(String(input)))).toStrictEqual(blocks[index]);
  });

  it.each(corpus)('paste: $source ($index)', async ({ input, index }) => {
    expect(normalizeIds(await markdownToBlocksWithReport(String(input), pasteConfig))).toStrictEqual(paste[index]);
  });

  it.each(corpus)('html: $source ($index)', async ({ input, index }) => {
    expect(await markdownToHtml(String(input))).toBe(html[index]);
  });

  it.each(realworld)('real-world blocks: $source', async ({ input, index }) => {
    expect(normalizeIds(await markdownToBlocksWithReport(String(input)))).toStrictEqual(realworldBlocks[index]);
  });

  it.each(realworld)('real-world html: $source', async ({ input, index }) => {
    expect(await markdownToHtml(String(input))).toBe(realworldHtml[index]);
  });
});
