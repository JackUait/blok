import { describe, expect, it } from 'vitest';

import { markdownHeadingText, markdownTextEscaper, splitBareUrls } from '../../../src/markdown/blocks-to-markdown-core';

/** Every string of `alphabet` items, up to `length` items long. */
const strings = (alphabet: string[], length: number): string[] => {
  const all = [''];
  const grow = (prefix: string, left: number): void => {
    if (left === 0) {
      return;
    }
    alphabet.forEach((item) => {
      all.push(prefix + item);
      grow(prefix + item, left - 1);
    });
  };

  grow('', length);

  return all;
};

/**
 * A faster rewrite must give the same answers as the regex split it replaced:
 * a pasted data URL runs to MiB, and the regex's greedy run cost QuickJS
 * over 256 MiB on a 12 MiB bookmark URL.
 */
describe('splitBareUrls', () => {
  const BARE_URL = /((?:https?:\/\/|www\.)[^\s<]*)/;

  it('splits like String.split with the bare-URL regex', () => {
    const texts = strings(['http://', 'https://', 'www.', 'h', 'w', 'a', ' ', '<', '\n', ' '], 4);

    texts.forEach((text) => {
      expect(splitBareUrls(text), JSON.stringify(text)).toEqual(text.split(BARE_URL));
    });
  });
});

describe('markdownHeadingText', () => {
  /** The line-start escapes as they were before the guard that skips plain lines. */
  const escapeLineStartsBefore = (markdown: string): string =>
    markdown.split('\n').map((line) => line
      .replace(/^( {0,3})(#{1,6})(?=[ \t]|$)/, '$1\\$2')
      .replace(/^( {0,3})>/, '$1\\>')
      .replace(/^( {0,3})([+-])(?=[ \t]|$)/, '$1\\$2')
      .replace(/^( {0,3})(-+|=+)([ \t]*)$/, '$1\\$2$3')
      .replace(/^( {0,3}\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')).join('\n');
  const escapeClosingHashes = (line: string): string => line.replace(/([ \t])(#+)([ \t]*)$/, '$1\\$2$3');

  it('escapes line starts as before', () => {
    const lines = strings([' ', '#', '>', '+', '-', '=', '1', '.', ')', '\t', 'a'], 5);

    lines.forEach((line) => {
      const before = escapeClosingHashes(escapeLineStartsBefore(markdownTextEscaper(line)(line)));

      expect(markdownHeadingText(line), JSON.stringify(line)).toBe(before);
    });
  });
});
