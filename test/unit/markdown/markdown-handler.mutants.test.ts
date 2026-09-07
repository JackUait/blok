import { describe, it, expect } from 'vitest';

import { hasMarkdownSignals } from '../../../src/markdown/markdown-handler';

describe('hasMarkdownSignals mutants', () => {
  describe('nothing to detect', () => {
    it('is false for an empty string', () => {
      expect(hasMarkdownSignals('')).toBe(false);
    });

    it('is false for ordinary prose', () => {
      expect(hasMarkdownSignals('Just a sentence about 2 things, priced at $5 and $9.')).toBe(false);
    });
  });

  describe('headings', () => {
    it.each(['# One', '## Two', '###### Six'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('detects a heading on a later line', () => {
      expect(hasMarkdownSignals('intro\n## Later')).toBe(true);
    });

    it('needs whitespace after the hashes', () => {
      expect(hasMarkdownSignals('#NoSpace')).toBe(false);
    });

    it('stops at six hashes', () => {
      expect(hasMarkdownSignals('####### Seven')).toBe(false);
    });

    it('needs the hashes at the start of a line', () => {
      expect(hasMarkdownSignals('a # not a heading')).toBe(false);
    });
  });

  describe('fenced code', () => {
    it('detects a fence at the start of a line', () => {
      expect(hasMarkdownSignals('```\ncode\n```')).toBe(true);
    });

    it('ignores a fence mid-line', () => {
      expect(hasMarkdownSignals('a ``` b')).toBe(false);
    });
  });

  describe('tables', () => {
    it('detects a GFM separator row', () => {
      expect(hasMarkdownSignals('| a | b |\n| --- | --- |')).toBe(true);
    });

    it('ignores a pipe with no rule after it', () => {
      expect(hasMarkdownSignals('a | b')).toBe(false);
    });
  });

  describe('task lists', () => {
    it.each(['- [ ] todo', '- [x] done'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('ignores another letter in the box', () => {
      expect(hasMarkdownSignals('a\n- [y] neither')).toBe(true);
    });
  });

  describe('unordered lists', () => {
    it.each(['- item', '* item', '+ item', '  - indented'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('needs whitespace after the marker', () => {
      expect(hasMarkdownSignals('-item')).toBe(false);
    });

    it('needs content after the whitespace', () => {
      expect(hasMarkdownSignals('- ')).toBe(false);
    });
  });

  describe('ordered lists', () => {
    it.each(['1. item', '1) item', '42. item'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('needs whitespace after the marker', () => {
      expect(hasMarkdownSignals('1.item')).toBe(false);
    });

    it('stops at nine digits', () => {
      expect(hasMarkdownSignals('1234567890. item')).toBe(false);
    });
  });

  describe('blockquotes', () => {
    it('detects a quote with content after the space', () => {
      expect(hasMarkdownSignals('> quoted')).toBe(true);
    });

    it.each(['-> arrow', '=> arrow', '>>> chevrons', '>no space'])('ignores %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(false);
    });

    it('allows up to three leading spaces and no more', () => {
      expect(hasMarkdownSignals('   > quoted')).toBe(true);
      expect(hasMarkdownSignals('    > quoted')).toBe(false);
    });
  });

  describe('links and images', () => {
    it('detects a link', () => {
      expect(hasMarkdownSignals('see [the docs](https://example.test) for more')).toBe(true);
    });

    it('needs text inside the brackets', () => {
      expect(hasMarkdownSignals('[](https://example.test)')).toBe(false);
    });

    it('needs a url inside the parentheses', () => {
      expect(hasMarkdownSignals('[text]()')).toBe(false);
    });

    it('refuses a bracket inside the link text, so the scan cannot run past it', () => {
      expect(hasMarkdownSignals('[a[b]c](d)')).toBe(false);
    });

    it('detects an image marker on its own', () => {
      expect(hasMarkdownSignals('![')).toBe(true);
    });
  });

  describe('emphasis', () => {
    it('detects bold', () => {
      expect(hasMarkdownSignals('some **bold** text')).toBe(true);
    });

    it('ignores an unpaired marker', () => {
      expect(hasMarkdownSignals('2 ** 3')).toBe(false);
    });
  });

  describe('math', () => {
    it('detects block math', () => {
      expect(hasMarkdownSignals('$$\\frac{a}{b}$$')).toBe(true);
    });

    it('detects inline math', () => {
      expect(hasMarkdownSignals('the value $x + 1$ is used')).toBe(true);
    });

    it('ignores a currency pair with spaces inside', () => {
      expect(hasMarkdownSignals('costs $ 5 to $ 9')).toBe(false);
    });

    it('ignores a lone dollar sign', () => {
      expect(hasMarkdownSignals('costs $5')).toBe(false);
    });
  });
});
