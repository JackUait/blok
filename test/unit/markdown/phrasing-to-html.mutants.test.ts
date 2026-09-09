/**
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - L98 `'inlineMath'` -> `""` and L99 `'footnoteReference'` -> `""`: the
 *   renamed cases stop matching and fall to `default`, which returns the
 *   same ''.
 * - L99 case-label swap between the two: both labels share one body, so any
 *   relabeling routes to the same '' (or the identical default).
 * - L100/L103 `return ''` -> `return ""`: the two literals are the same string.
 * - L102 `default:` -> `default:`: identity.
 */
import { describe, expect, it } from 'vitest';

import { phrasingToHtml, type DefinitionMap } from '../../../src/markdown/phrasing-to-html';

describe('phrasingToHtml — escape and media defaults', () => {
  it('escapes ampersands in raw inline html', () => {
    expect(phrasingToHtml([{ type: 'html', value: 'a & b' }], new Map())).toBe('a &amp; b');
  });

  it('renders an image without alt as an empty alt attribute', () => {
    const out = phrasingToHtml([{ type: 'image', url: 'https://example.com/x.png' }], new Map());

    expect(out).toBe('<img src="https://example.com/x.png" alt="">');
  });

  it('renders a resolved imageReference without alt as an empty alt attribute', () => {
    const definitions: DefinitionMap = new Map([
      ['r', { type: 'definition', identifier: 'r', url: 'https://example.com/r.png', title: 'T' }],
    ]);

    expect(phrasingToHtml([{ type: 'imageReference', identifier: 'r', referenceType: 'full' }], definitions))
      .toBe('<img src="https://example.com/r.png" alt="">');
  });
});
