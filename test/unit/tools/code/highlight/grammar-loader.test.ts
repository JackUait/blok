import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHighlighter, type Highlighter } from '../../../../../src/tools/code/highlight/engine';
import {
  BASE_GRAMMARS,
  createGrammarLoader,
  GRAMMARS,
  type GrammarTable,
} from '../../../../../src/tools/code/highlight/grammar-loader';

/** A table whose grammars record the order they were defined in. */
const recordingTable = (log: string[], shape: Record<string, { requires?: string[]; optional?: string[] }>): GrammarTable =>
  Object.fromEntries(Object.entries(shape).map(([id, deps]) => [id, {
    ...deps,
    load: () => Promise.resolve({
      define: (hl: Highlighter) => {
        log.push(id);
        Object.assign(hl.languages, { [id]: {} });
      },
    }),
  }]));

describe('grammar loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defines what a grammar requires before the grammar itself', async () => {
    const log: string[] = [];
    const table = recordingTable(log, { a: {}, b: { requires: ['a'] }, c: { requires: ['b'] } });
    const load = createGrammarLoader(createHighlighter(), { base: [], optional: false }, table);

    await load('c');

    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('defines optional grammars first only when asked to', async () => {
    const withOptional: string[] = [];
    const without: string[] = [];
    const shape = { yaml: {}, md: { optional: ['yaml'] } };

    await createGrammarLoader(createHighlighter(), { base: [], optional: true }, recordingTable(withOptional, shape))('md');
    await createGrammarLoader(createHighlighter(), { base: [], optional: false }, recordingTable(without, shape))('md');

    expect(withOptional).toEqual(['yaml', 'md']);
    expect(without).toEqual(['md']);
  });

  it('defines the base grammars first, in their order, whatever is asked for first', async () => {
    const log: string[] = [];
    const table = recordingTable(log, { m: {}, s: {}, x: {} });
    const load = createGrammarLoader(createHighlighter(), { base: ['m', 's'], optional: false }, table);

    await load('s');
    await load('x');

    expect(log).toEqual(['m', 's', 'x']);
  });

  it('waits for the whole base when a base grammar is asked for', async () => {
    const log: string[] = [];
    const table = recordingTable(log, { m: {}, s: {}, j: {} });
    const load = createGrammarLoader(createHighlighter(), { base: ['m', 's', 'j'], optional: false }, table);

    await load('m');

    expect(log).toEqual(['m', 's', 'j']);
  });

  it('defines each grammar once under concurrent loads', async () => {
    const log: string[] = [];
    const table = recordingTable(log, { a: {}, b: { requires: ['a'] }, c: { requires: ['a'] } });
    const load = createGrammarLoader(createHighlighter(), { base: [], optional: false }, table);

    await Promise.all([load('b'), load('c'), load('b'), load('a')]);

    expect(log.sort()).toEqual(['a', 'b', 'c']);
  });

  it('rejects an unknown grammar', async () => {
    const load = createGrammarLoader(createHighlighter(), { base: [], optional: false }, {});

    await expect(load('nope')).rejects.toThrow('Unknown grammar "nope"');
  });

  it('retries a grammar whose chunk failed to load', async () => {
    const hl = createHighlighter();
    const define = vi.fn((hl: Highlighter) => {
      Object.assign(hl.languages, { flaky: {} });
    });
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ define });
    const load = createGrammarLoader(hl, { base: [], optional: false }, { flaky: { load: importer } });

    await expect(load('flaky')).rejects.toThrow('network');
    await load('flaky');

    expect(importer).toHaveBeenCalledTimes(2);
    expect(define).toHaveBeenCalledTimes(1);
  });

  const table: GrammarTable = GRAMMARS;

  it('lists every grammar after everything it requires or loads optionally', () => {
    const order = Object.keys(table);

    for (const [id, entry] of Object.entries(table)) {
      for (const dep of [...(entry.requires ?? []), ...(entry.optional ?? [])]) {
        expect(order.indexOf(dep), `${id} needs ${dep}`).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(dep), `${id} needs ${dep}`).toBeLessThan(order.indexOf(id));
      }
    }

    expect(order.slice(0, BASE_GRAMMARS.length)).toEqual([...BASE_GRAMMARS]);
  });

  it('declares what Prism declares: cpp needs c, scala needs java, php needs markup-templating', () => {
    expect(table.cpp.requires).toContain('c');
    expect(table.scala.requires).toContain('java');
    expect(table.php.requires).toContain('markup-templating');
    expect(table.markdown.optional).toContain('yaml');
    expect(table.graphql.optional).toContain('markdown');
  });
});
