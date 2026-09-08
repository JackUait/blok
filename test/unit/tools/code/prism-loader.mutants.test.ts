/**
 * Mutation-hardening tests for the Prism loader.
 *
 * The Mermaid grammar is hand-written, so every regex in it gets a positive
 * case AND the near miss it exists to reject — a pattern that got wider is
 * invisible to positives alone. Mermaid cases assert the WHOLE emitted HTML:
 * a token that splits in two, shifts by one character, or swallows its
 * neighbour still contains the right class names, so `toContain` cannot see it.
 *
 * Prism state is process-global and `vi.resetModules()` does not reset it
 * (prismjs and its components live in node_modules and are never re-evaluated),
 * so the order of the blocks below is load-bearing — see the notes on each.
 */
import Prism from 'prismjs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../../src/tools/code/constants';
import { resetPrismState, tokenizePrism } from '../../../../src/tools/code/prism-loader';

const mermaid = (code: string): Promise<string | null> => tokenizePrism(code, 'mermaid');

const HIGHLIGHTABLE_IDS = LANGUAGES.map((lang) => lang.id).filter((id) => id !== DEFAULT_LANGUAGE);

/**
 * One snippet per shipped language. Order follows `LANGUAGES`, which the loop
 * below relies on: prism-cpp extends the `c` grammar and prism-scala extends
 * `java`, so those two must already be registered when their turn comes.
 */
const SNIPPETS: Record<string, string> = {
  javascript: 'const x = 1;',
  typescript: 'const x: number = 1;',
  python: 'def f():\n    return 1',
  java: 'class A { void m() {} }',
  c: '#include <stdio.h>',
  cpp: '#include <iostream>\nclass A {};',
  csharp: 'using System; class P {}',
  go: 'package main\nfunc main() {}',
  rust: 'fn main() { let x = 1; }',
  ruby: 'def f\n  puts "x"\nend',
  php: '<?php echo "hi";',
  swift: 'func f() -> Int { return 1 }',
  kotlin: 'fun main() { val x = 1 }',
  latex: '\\begin{document}\\end{document}',
  mermaid: 'graph TD\n  A --> B',
  sql: 'SELECT id FROM users',
  html: '<p class="x">hi</p>',
  css: 'body { margin: 0; }',
  json: '{"a": 1}',
  yaml: 'a: 1',
  markdown: '# Title\n\n**bold**',
  bash: 'echo "$HOME"',
  shell: 'echo "x" | wc -l',
  dockerfile: 'FROM node:18',
  xml: '<root><a id="1"/></root>',
  graphql: 'query Q { user { id } }',
  r: 'x <- c(1, 2)',
  scala: 'object M { val x = 1 }',
  dart: 'void main() { print(1); }',
  lua: 'local x = 1',
};

describe('prism-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Undoes the grammar deletions further down, so each test starts from a
    // loader that will re-register whatever it needs.
    resetPrismState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mermaid grammar', () => {
    it('reads %%{...}%% as a directive, not as a comment', async () => {
      expect(await mermaid('%%{init: {theme: base}}%%')).toBe(
        '<span class="token directive">%%{init: {theme: base}}%%</span>',
      );
    });

    it('reads a bare %% line as a comment', async () => {
      expect(await mermaid('%% plain comment')).toBe(
        '<span class="token comment">%% plain comment</span>',
      );
    });

    it('lets a comment swallow a directive opened later on the same line', async () => {
      expect(await mermaid('%% see %%{init: {}}%% here')).toBe(
        '<span class="token comment">%% see %%{init: {}}%% here</span>',
      );
    });

    it('splits an edge label into pipes and content', async () => {
      expect(await mermaid('A -->|Yes| B')).toBe(
        '<span class="token variable">A</span> <span class="token operator">--></span>'
        + '<span class="token edge-label"><span class="token edge-delimiter">|</span>'
        + '<span class="token edge-label">Yes</span>'
        + '<span class="token edge-delimiter">|</span></span> <span class="token variable">B</span>',
      );
    });

    it('keeps %% inside an edge label out of the comment token', async () => {
      expect(await mermaid('A -->|Yes %% no| B')).toBe(
        '<span class="token variable">A</span> <span class="token operator">--></span>'
        + '<span class="token edge-label"><span class="token edge-delimiter">|</span>'
        + '<span class="token edge-label">Yes %% no</span>'
        + '<span class="token edge-delimiter">|</span></span> <span class="token variable">B</span>',
      );
    });

    it('splits a square node into brackets and label', async () => {
      expect(await mermaid('A[Start]')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">[</span><span class="token string">Start</span>'
        + '<span class="token node-bracket">]</span></span>',
      );
    });

    it('keeps both parentheses of a circle node in one bracket token', async () => {
      expect(await mermaid('A((Circle))')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">((</span><span class="token string">Circle</span>'
        + '<span class="token node-bracket">))</span></span>',
      );
    });

    it('takes the whole opening paren run of a double-circle node', async () => {
      expect(await mermaid('A(((Double)))')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">((</span><span class="token node-bracket">(</span>'
        + '<span class="token string">Double</span>)<span class="token node-bracket">))</span></span>',
      );
    });

    it('takes a single parenthesis pair for a round node', async () => {
      expect(await mermaid('A(Round)')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">(</span><span class="token string">Round</span>'
        + '<span class="token node-bracket">)</span></span>',
      );
    });

    it('marks only the closing bracket at the very end of a subroutine node', async () => {
      expect(await mermaid('A[[Sub]]')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">[</span><span class="token node-bracket">[</span>'
        + '<span class="token string">Sub</span>]<span class="token node-bracket">]</span></span>',
      );
    });

    it('leaves a > inside a label in the label, not in a bracket', async () => {
      expect(await mermaid('A[a>b]')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">[</span><span class="token string">a>b</span>'
        + '<span class="token node-bracket">]</span></span>',
      );
    });

    it('keeps %% inside a node label out of the comment token', async () => {
      expect(await mermaid('A[Label %% text]')).toBe(
        '<span class="token variable">A</span><span class="token node-definition">'
        + '<span class="token node-bracket">[</span><span class="token string">Label %% text</span>'
        + '<span class="token node-bracket">]</span></span>',
      );
    });

    it.each([
      ['flowchart TD', '<span class="token diagram-name">flowchart</span> <span class="token keyword">TD</span>'],
      ['  graph TD', '<span class="token diagram-name">  graph</span> <span class="token keyword">TD</span>'],
      ['stateDiagram', '<span class="token diagram-name">stateDiagram</span>'],
      ['stateDiagram-v2', '<span class="token diagram-name">stateDiagram-v2</span>'],
      ['pie', '<span class="token diagram-name">pie</span>'],
      ['pie title Pets', '<span class="token diagram-name">pie title</span> <span class="token variable">Pets</span>'],
      ['pie  title Pets', '<span class="token diagram-name">pie  title</span> <span class="token variable">Pets</span>'],
    ])('names the diagram type in %j', async (code, expected) => {
      expect(await mermaid(code)).toBe(expected);
    });

    it('refuses a diagram name that is not the first word on its line', async () => {
      expect(await mermaid('A --> graph')).toBe(
        '<span class="token variable">A</span> <span class="token operator">--></span>'
        + ' <span class="token variable">graph</span>',
      );
    });

    it.each([
      ['A --> B', '<span class="token variable">A</span> <span class="token operator">--></span> <span class="token variable">B</span>'],
      ['A-->B', '<span class="token variable">A</span><span class="token operator">--></span><span class="token variable">B</span>'],
      ['A --- B', '<span class="token variable">A</span> <span class="token operator">---</span> <span class="token variable">B</span>'],
      ['A ==> B', '<span class="token variable">A</span> <span class="token operator">==></span> <span class="token variable">B</span>'],
      ['A --x B', '<span class="token variable">A</span> <span class="token operator">--x</span> <span class="token variable">B</span>'],
      ['A --o B', '<span class="token variable">A</span> <span class="token operator">--o</span> <span class="token variable">B</span>'],
      ['A -...-> B', '<span class="token variable">A</span> <span class="token operator">-...</span>-> <span class="token variable">B</span>'],
      ['A ~~~ B', '<span class="token variable">A</span> <span class="token operator">~~~</span> <span class="token variable">B</span>'],
    ])('takes the whole connector of %j as one operator', async (code, expected) => {
      expect(await mermaid(code)).toBe(expected);
    });

    it('takes a multi-character node id as one variable', async () => {
      expect(await mermaid('myNode')).toBe('<span class="token variable">myNode</span>');
    });

    it('keeps structural words out of the node ids', async () => {
      expect(await mermaid('subgraph MyGroup\nend')).toBe(
        '<span class="token keyword">subgraph</span> <span class="token variable">MyGroup</span>\n'
        + '<span class="token keyword">end</span>',
      );
    });

    it('tokenizes a two-line flowchart', async () => {
      expect(await mermaid('graph TD\n  A --> B')).toBe(
        '<span class="token diagram-name">graph</span> <span class="token keyword">TD</span>\n'
        + '  <span class="token variable">A</span> <span class="token operator">--></span>'
        + ' <span class="token variable">B</span>',
      );
    });

    it('registers the grammar once and reuses that object', async () => {
      await mermaid('graph TD');
      const registered = Prism.languages.mermaid;

      resetPrismState();
      await mermaid('graph TD');

      expect(Prism.languages.mermaid).toBe(registered);
    });
  });

  /**
   * Runs before the failure cases below: it must be the first thing in the file
   * to pull in `markup-templating`, or php keeps highlighting from the global
   * Prism registry and nothing notices a broken prerequisite chain.
   */
  describe('language map', () => {
    it.each(HIGHLIGHTABLE_IDS)('loads a grammar and emits tokens for %s', async (lang) => {
      const code = SNIPPETS[lang];

      expect(code, `no snippet for "${lang}"`).toBeTypeOf('string');

      const html = await tokenizePrism(code, lang);

      expect(html).not.toBeNull();
      expect(html).toContain('class="token');
    });
  });

  /**
   * Every case here re-imports the loader behind a `vi.doMock`, so it gets a
   * module with an empty loaded-language cache. They run last because the mocks
   * replace components the block above needs for real.
   */
  describe('grammar loading failures', () => {
    afterEach(() => {
      vi.resetModules();
    });

    it('returns null and warns when a grammar import throws', async () => {
      vi.resetModules();
      vi.doMock('prismjs/components/prism-css', () => {
        throw new Error('nope');
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await import('../../../../src/tools/code/prism-loader');
      const html = await loader.tokenizePrism('body { margin: 0; }', 'css');

      // Prism ships `css` in its core bundle, so a mutant that ignores the
      // failed import would highlight this rather than bail out.
      expect(html).toBeNull();
      expect(warn).toHaveBeenCalledWith('[blok] Failed to load Prism grammar for "css":', expect.anything());

      vi.doUnmock('prismjs/components/prism-css');
    });

    it('loads its own component for javascript', async () => {
      vi.resetModules();
      vi.doMock('prismjs/components/prism-javascript', () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await import('../../../../src/tools/code/prism-loader');

      expect(await loader.tokenizePrism('const x = 1;', 'javascript')).toBeNull();

      vi.doUnmock('prismjs/components/prism-javascript');
    });

    it('loads the markup component for both html and xml', async () => {
      vi.resetModules();
      vi.doMock('prismjs/components/prism-markup', () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await import('../../../../src/tools/code/prism-loader');

      expect(await loader.tokenizePrism('<p class="x">hi</p>', 'html')).toBeNull();
      expect(await loader.tokenizePrism('<root><a id="1"/></root>', 'xml')).toBeNull();

      vi.doUnmock('prismjs/components/prism-markup');
    });

    it('loads the bash component for shell', async () => {
      vi.resetModules();
      vi.doMock('prismjs/components/prism-bash', () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await import('../../../../src/tools/code/prism-loader');

      expect(await loader.tokenizePrism('echo "x" | wc -l', 'shell')).toBeNull();

      vi.doUnmock('prismjs/components/prism-bash');
    });

    it('warns about a failed prerequisite and still loads the language', async () => {
      vi.resetModules();
      vi.doMock('prismjs/components/prism-markup', () => {
        throw new Error('nope');
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await import('../../../../src/tools/code/prism-loader');
      const html = await loader.tokenizePrism('<?php echo "hi";', 'php');

      expect(warn).toHaveBeenCalledWith(
        '[blok] Failed to load Prism prerequisite grammar "markup":',
        expect.anything(),
      );
      expect(html).toContain('class="token');

      vi.doUnmock('prismjs/components/prism-markup');
    });

    it('returns null without warning when a loaded language has no grammar', async () => {
      await mermaid('graph TD');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      // The cache says mermaid is loaded, so the importer that would put the
      // grammar back never runs.
      delete Prism.languages.mermaid;

      expect(await mermaid('graph TD')).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('reloads a grammar after resetPrismState', async () => {
      await mermaid('graph TD');
      delete Prism.languages.mermaid;
      resetPrismState();

      expect(await mermaid('graph TD')).toBe('<span class="token diagram-name">graph</span> <span class="token keyword">TD</span>');
    });

    // Last in the file: the deleted grammar cannot be put back, because the
    // component that registers it only ever evaluates once per process.
    it('returns null and warns when Prism throws while highlighting', async () => {
      await tokenizePrism('<?php echo "hi";', 'php');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      // php reaches for this grammar from a before-tokenize hook on every run.
      delete Prism.languages['markup-templating'];

      expect(await tokenizePrism('<?php echo "hi";', 'php')).toBeNull();
      expect(warn).toHaveBeenCalledWith('[blok] Prism highlight error for "php":', expect.anything());
    });
  });
});
