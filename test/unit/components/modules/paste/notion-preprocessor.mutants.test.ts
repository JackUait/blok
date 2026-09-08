import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preprocessNotionHtml } from '../../../../../src/components/modules/paste/notion-preprocessor';

/**
 * Mutation-coverage tests for `src/components/modules/paste/notion-preprocessor.ts`.
 *
 * No mutants are left alive in this file.
 *
 * The three that survived the full run all removed the "is this Notion?" gate in
 * one way or another - the guard forced false, its body emptied, or the
 * signature probe forced true. Each is only visible on markup that is NOT from
 * Notion and that the rewrite would change, so the tests below paste plain
 * `<del>` markup and assert the string comes back untouched.
 */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preprocessNotionHtml mutants - the Notion gate', () => {
  it('returns non-Notion markup untouched, strikethrough included', () => {
    const html = '<p><del>gone</del> kept</p>';

    expect(preprocessNotionHtml(html)).toBe(html);
  });

  it('does not reserialize non-Notion markup', () => {
    const html = '<p class=\'quoted\'>text<br></p>';

    expect(preprocessNotionHtml(html)).toBe(html);
  });

  it('leaves a document whose only list classes are not Notion classes alone', () => {
    const html = '<ul class="shopping"><li><strike>milk</strike></li></ul>';

    expect(preprocessNotionHtml(html)).toBe(html);
  });
});

describe('preprocessNotionHtml mutants - rewriting a Notion payload', () => {
  it.each([
    ['<ul class="to-do-list"><li><del>done</del></li></ul>', '<ul class="to-do-list"><li><s>done</s></li></ul>'],
    ['<figure class="callout"><strike>note</strike></figure>', '<figure class="callout"><s>note</s></figure>'],
  ])('rewrites legacy strikethrough in %j', (html, expected) => {
    expect(preprocessNotionHtml(html)).toBe(expected);
  });

  it('keeps the inner markup of a rewritten mark', () => {
    const html = '<ul class="bulleted-list"><li><del>a <b>bold</b></del></li></ul>';

    expect(preprocessNotionHtml(html)).toContain('<s>a <b>bold</b></s>');
  });

  it('returns Notion markup with nothing to rewrite unchanged in shape', () => {
    const html = '<ol class="numbered-list"><li>one</li></ol>';

    expect(preprocessNotionHtml(html)).toBe(html);
  });
});
