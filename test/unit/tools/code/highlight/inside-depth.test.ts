import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHighlighter, type TokenStream } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from '../../../../../src/tools/code/highlight/grammar-loader';
import { resetPrismState, tokenizePrism } from '../../../../../src/tools/code/prism-loader';

/**
 * Some grammars tokenize a match's content with a grammar that can match the
 * same thing again: a CSS at-rule holds another at-rule, a C macro holds
 * another macro. Each level recurses, so a long enough line used to overflow
 * the stack and the block lost its highlighting.
 */
const N = 8000;
const atRules = `@a ${'.@t'.repeat(N)};`;
const macros = '#a '.repeat(N);

/** Blok language id, grammar name, code. */
const CASES: Array<[string, string, string]> = [
  ['css', 'css', atRules],
  ['html', 'markup', `<style>${atRules}</style>`],
  ['html', 'markup', `<a style="${atRules}">`],
  ['markdown', 'markdown', `<style>${atRules}</style>`],
  ['markdown', 'markdown', `\`\`\`css\n${atRules}\n\`\`\``],
  ['php', 'php', `<?php ?><style>${atRules}</style>`],
  ['c', 'c', macros],
  ['cpp', 'cpp', macros],
];

const textOf = (stream: TokenStream): string => stream
  .map((item) => (typeof item === 'string' ? item : textOf(typeof item.content === 'string' ? [item.content] : item.content)))
  .join('');

const decode = (html: string): string => {
  const element = document.createElement('div');

  element.innerHTML = html;

  return element.textContent ?? '';
};

describe('deeply nested inside grammars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrismState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(CASES)('%s keeps its highlighting on a deeply nested line (%s, case %#)', async (id, _grammar, code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const html = await tokenizePrism(code, id);

    expect(warn).not.toHaveBeenCalled();
    expect(html).not.toBeNull();
    expect(decode(html ?? '')).toBe(code);
  });

  it.each(CASES)('tokenize keeps every char on a deeply nested line (%s, %s, case %#)', async (_id, grammar, code) => {
    const hl = createHighlighter();

    await createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: true })(grammar);

    expect(textOf(hl.tokenizeWithHooks(code, hl.languages[grammar], grammar))).toBe(code);
  });
});
