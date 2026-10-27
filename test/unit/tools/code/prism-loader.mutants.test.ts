/**
 * Mutation-hardening tests for the Prism loader.
 *
 * The Mermaid grammar is hand-written, so every regex in it gets a positive
 * case AND the near miss it exists to reject — a pattern that got wider is
 * invisible to positives alone. Mermaid cases assert the WHOLE emitted HTML:
 * a token that splits in two, shifts by one character, or swallows its
 * neighbour still contains the right class names, so `toContain` cannot see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Highlighter } from '../../../../src/tools/code/highlight/engine';
import type * as PrismLoader from '../../../../src/tools/code/prism-loader';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../../../src/tools/code/constants';
import { resetPrismState, tokenizePrism } from '../../../../src/tools/code/prism-loader';

const mermaid = (code: string): Promise<string | null> => tokenizePrism(code, 'mermaid');

const HIGHLIGHTABLE_IDS = LANGUAGES.map((lang) => lang.id).filter((id) => id !== DEFAULT_LANGUAGE);

/** One snippet per shipped language. */
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

  });

  describe('language map', () => {
    it.each(HIGHLIGHTABLE_IDS)('loads a grammar and emits tokens for %s', async (lang) => {
      const code = SNIPPETS[lang];

      expect(code, `no snippet for "${lang}"`).toBeTypeOf('string');

      const html = await tokenizePrism(code, lang);

      expect(html).not.toBeNull();
      expect(html).toContain('class="token');
    });
  });

  /** Every case here re-imports the loader behind a `vi.doMock` of one grammar module. */
  describe('grammar loading failures', () => {
    const GRAMMARS_DIR = '../../../../src/tools/code/highlight/grammars';

    const freshLoader = async (): Promise<typeof PrismLoader> => {
      vi.resetModules();

      return import('../../../../src/tools/code/prism-loader');
    };

    afterEach(() => {
      vi.doUnmock(`${GRAMMARS_DIR}/css`);
      vi.doUnmock(`${GRAMMARS_DIR}/javascript`);
      vi.doUnmock(`${GRAMMARS_DIR}/markup`);
      vi.doUnmock(`${GRAMMARS_DIR}/bash`);
      vi.doUnmock(`${GRAMMARS_DIR}/markup-templating`);
      vi.doUnmock(`${GRAMMARS_DIR}/mermaid`);
      vi.resetModules();
    });

    it('returns null and warns when a grammar import throws', async () => {
      vi.doMock(`${GRAMMARS_DIR}/css`, () => {
        throw new Error('nope');
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await freshLoader();
      const html = await loader.tokenizePrism('body { margin: 0; }', 'css');

      expect(html).toBeNull();
      expect(warn).toHaveBeenCalledWith('[blok] Failed to load Prism grammar for "css":', expect.anything());
    });

    it('loads its own grammar for javascript', async () => {
      vi.doMock(`${GRAMMARS_DIR}/javascript`, () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await freshLoader();

      expect(await loader.tokenizePrism('const x = 1;', 'javascript')).toBeNull();
    });

    it('loads the markup grammar for both html and xml', async () => {
      vi.doMock(`${GRAMMARS_DIR}/markup`, () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await freshLoader();

      expect(await loader.tokenizePrism('<p class="x">hi</p>', 'html')).toBeNull();
      expect(await loader.tokenizePrism('<root><a id="1"/></root>', 'xml')).toBeNull();
    });

    it('loads the bash grammar for shell', async () => {
      vi.doMock(`${GRAMMARS_DIR}/bash`, () => {
        throw new Error('nope');
      });

      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const loader = await freshLoader();

      expect(await loader.tokenizePrism('echo "x" | wc -l', 'shell')).toBeNull();
    });

    it('fails a language whose prerequisite fails, and retries it on the next call', async () => {
      type Templating = { define: (hl: Highlighter) => void };
      const fail = vi.fn()
        .mockImplementationOnce(() => {
          throw new Error('nope');
        })
        .mockImplementation(() => undefined);

      vi.doMock(`${GRAMMARS_DIR}/markup-templating`, async (importOriginal) => {
        const real = await importOriginal<Templating>();

        return {
          ...real,
          define: (hl: Highlighter): void => {
            fail();
            real.define(hl);
          },
        };
      });

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await freshLoader();

      expect(await loader.tokenizePrism('<?php echo "hi";', 'php')).toBeNull();
      expect(warn).toHaveBeenCalledWith('[blok] Failed to load Prism grammar for "php":', expect.anything());
      expect(await loader.tokenizePrism('<?php echo "hi";', 'php')).toContain('class="token');
    });

    it('returns null without warning when a loaded grammar registers nothing', async () => {
      vi.doMock(`${GRAMMARS_DIR}/mermaid`, () => ({ define: (): void => undefined }));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await freshLoader();

      expect(await loader.tokenizePrism('graph TD', 'mermaid')).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('defines a grammar once, and again after resetPrismState', async () => {
      const real = await vi.importActual<{ define: (hl: Highlighter) => void }>(`${GRAMMARS_DIR}/mermaid`);
      const define = vi.fn(real.define);

      vi.doMock(`${GRAMMARS_DIR}/mermaid`, () => ({ define }));

      const loader = await freshLoader();

      await loader.tokenizePrism('graph TD', 'mermaid');
      await loader.tokenizePrism('graph LR', 'mermaid');
      expect(define).toHaveBeenCalledTimes(1);

      loader.resetPrismState();

      expect(await loader.tokenizePrism('graph TD', 'mermaid'))
        .toBe('<span class="token diagram-name">graph</span> <span class="token keyword">TD</span>');
      expect(define).toHaveBeenCalledTimes(2);
    });

    it('returns null and warns when highlighting throws', async () => {
      vi.doMock(`${GRAMMARS_DIR}/mermaid`, () => ({
        define: (hl: Highlighter): void => {
          Object.assign(hl.languages, { mermaid: {} });
          hl.hooks.add('before-tokenize', () => {
            throw new Error('boom');
          });
        },
      }));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loader = await freshLoader();

      expect(await loader.tokenizePrism('graph TD', 'mermaid')).toBeNull();
      expect(warn).toHaveBeenCalledWith('[blok] Prism highlight error for "mermaid":', expect.anything());
    });
  });
});
