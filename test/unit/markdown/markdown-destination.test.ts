import { describe, expect, it } from 'vitest';

import { markdownDestination } from '../../../src/markdown/blocks-to-markdown-core';

/**
 * Pins the escaping rules, so a faster rewrite has to write the same bytes.
 */
describe('markdownDestination', () => {
  const cases: Array<[string, 'href' | 'src', string | null]> = [
    ["https://example.com/a b", 'href', "https://example.com/a%20b"],
    ["https://e.com/<x>", 'href', "https://e.com/%3Cx%3E"],
    ["https://e.com/p(1)", 'href', "https://e.com/p(1)"],
    ["https://e.com/p(1", 'href', "https://e.com/p\\(1"],
    ["https://e.com/p)1(", 'href', "https://e.com/p\\)1\\("],
    ["https://e.com/a\\b", 'href', "https://e.com/a\\b"],
    ["https://e.com/a\\", 'href', "https://e.com/a\\\\"],
    ["https://e.com/a\\%20", 'href', "https://e.com/a\\\\%20"],
    ["https://e.com/a\\ b", 'href', "https://e.com/a\\\\%20b"],
    ["https://e.com/a\\(b", 'href', "https://e.com/a\\\\\\(b"],
    ["https://e.com/a\\\\b", 'href', "https://e.com/a\\\\\\b"],
    ["https://e.com/a\\&amp;b", 'href', "https://e.com/a\\\\\\&amp;b"],
    ["https://e.com/?a=1&amp;b=2", 'href', "https://e.com/?a=1\\&amp;b=2"],
    ["https://e.com/?a=1&b=2", 'href', "https://e.com/?a=1&b=2"],
    ["https://e.com/?x=&#106;", 'href', "https://e.com/?x=\\&#106;"],
    ["https://e.com/?x=&#x6A;y", 'href', "https://e.com/?x=\\&#x6A;y"],
    ["https://e.com/?x=&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;", 'href', "https://e.com/?x=&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;"],
    ["https://e.com/?x=&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;", 'href', "https://e.com/?x=\\&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;"],
    ["https://e.com/😀(\\😀", 'href', "https://e.com/😀\\(\\😀"],
    ["https://e.com/\\😀", 'href', "https://e.com/\\😀"],
    ["https://e.com/\t\n", 'href', "https://e.com/%09%0A%7F"],
    ["javascript:alert(1)", 'href', null],
    ["data:image/png;base64,AAAA", 'src', "data:image/png;base64,AAAA"],
    ["data:image/png;base64,AAAA", 'href', null],
    ["", 'href', ""],
  ];

  it.each(cases)('writes %j as a %s destination', (url, kind, expected) => {
    expect(markdownDestination(url, kind)).toBe(expected);
  });

  it('writes a multi-megabyte URL unchanged', () => {
    const url = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;

    expect(markdownDestination(url, 'src')).toBe(url);
  });
});
