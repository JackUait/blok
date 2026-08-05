/**
 * `style.fontSize` config → `--blok-*-font-size` custom properties.
 *
 * Every text-bearing block exposes its own font-size scenario, so a host can
 * retype one block (or one scenario inside a block — a caption, a comfortable
 * table, a large quote) from the constructor config instead of hand-writing a
 * stylesheet that has to know Blok's internal class names.
 */
import { describe, expect, it } from 'vitest';

import { BLOK_FONT_SIZE_TOKENS, buildFontSizeVarLines } from '../../../../src/components/utils/font-size-tokens';

/** A node of the exported token map: a token name, or a nested group of them. */
type TokenTree = string | { [key: string]: TokenTree };

/**
 * Flatten the exported token map into `[configPath, tokenName]` pairs, in
 * declaration order.
 * @param node - the token map (or a nested group inside it)
 * @param path - config path accumulated so far
 * @returns every leaf as its config path plus the custom property it writes
 */
const flattenTokens = (node: TokenTree, path: string[] = []): Array<[string[], string]> => {
  if (typeof node === 'string') {
    return [ [ path, node ] ];
  }

  return Object.entries(node).flatMap(([ key, child ]) => flattenTokens(child, [ ...path, key ]));
};

/**
 * Build a `style.fontSize` config that sets EVERY scenario the token map knows
 * about, so the map and the emitter can be cross-checked against each other.
 * @param paths - config paths to populate
 * @param value - size to write at every leaf
 * @returns a fully populated `style.fontSize` object
 */
const configForPaths = (paths: string[][], value: string): Record<string, unknown> => {
  const config: Record<string, unknown> = {};

  for (const path of paths) {
    let node = config;

    for (const key of path.slice(0, -1)) {
      node[key] ??= {};
      node = node[key] as Record<string, unknown>;
    }

    node[path[path.length - 1]] = value;
  }

  return config;
};

describe('buildFontSizeVarLines', () => {
  it('returns no lines when nothing is configured', () => {
    expect(buildFontSizeVarLines(undefined)).toEqual([]);
    expect(buildFontSizeVarLines({})).toEqual([]);
  });

  it('maps single-scenario blocks to their token', () => {
    expect(buildFontSizeVarLines({ paragraph: '17px' })).toEqual([
      '--blok-paragraph-font-size: 17px;',
    ]);
    expect(buildFontSizeVarLines({ callout: '15px' })).toEqual([
      '--blok-callout-font-size: 15px;',
    ]);
    expect(buildFontSizeVarLines({ code: '13px' })).toEqual([
      '--blok-code-font-size: 13px;',
    ]);
    expect(buildFontSizeVarLines({ toggle: '17px' })).toEqual([
      '--blok-toggle-font-size: 17px;',
    ]);
  });

  it('maps headings onto the pre-existing per-level tokens', () => {
    expect(buildFontSizeVarLines({ heading: { 1: '32px', 6: '13px' } })).toEqual([
      '--blok-heading-1-font-size: 32px;',
      '--blok-heading-6-font-size: 13px;',
    ]);
  });

  it('maps every per-block scenario', () => {
    expect(
      buildFontSizeVarLines({
        list: { item: '17px', checklist: '16px' },
        quote: { default: '17px', large: '1.4em' },
        table: { compact: '13px', comfortable: '17px' },
        image: { caption: '12px' },
        video: { caption: '13px' },
        audio: { caption: '13px' },
        file: { caption: '13px' },
        embed: { caption: '0.9em' },
        bookmark: { title: '15px', description: '13px', link: '13px' },
      })
    ).toEqual([
      '--blok-list-font-size: 17px;',
      '--blok-checklist-font-size: 16px;',
      '--blok-quote-font-size: 17px;',
      '--blok-quote-large-font-size: 1.4em;',
      '--blok-table-font-size: 13px;',
      '--blok-table-comfortable-font-size: 17px;',
      '--blok-image-caption-font-size: 12px;',
      '--blok-video-caption-font-size: 13px;',
      '--blok-audio-caption-font-size: 13px;',
      '--blok-file-caption-font-size: 13px;',
      '--blok-embed-caption-font-size: 0.9em;',
      '--blok-bookmark-title-font-size: 15px;',
      '--blok-bookmark-description-font-size: 13px;',
      '--blok-bookmark-link-font-size: 13px;',
    ]);
  });

  it('skips empty values so a blank string cannot emit an invalid declaration', () => {
    expect(buildFontSizeVarLines({ paragraph: '', quote: { large: '  ' } })).toEqual([]);
  });

  it('emits lines in a stable, spec-declared order regardless of key order', () => {
    const a = buildFontSizeVarLines({ code: '13px', paragraph: '17px' });
    const b = buildFontSizeVarLines({ paragraph: '17px', code: '13px' });

    expect(a).toEqual(b);
  });
});

/**
 * The token NAMES are the contract a host needs when it scopes typography from
 * CSS instead of from `style.fontSize` (a per-region rule, a runtime
 * `tokens.set()`). They used to exist only inside this module, so a host had to
 * hand-copy the strings with no compile error when Blok renamed one.
 */
describe('BLOK_FONT_SIZE_TOKENS', () => {
  it('mirrors the style.fontSize config shape', () => {
    expect(BLOK_FONT_SIZE_TOKENS.paragraph).toBe('--blok-paragraph-font-size');
    expect(BLOK_FONT_SIZE_TOKENS.heading[1]).toBe('--blok-heading-1-font-size');
    expect(BLOK_FONT_SIZE_TOKENS.list.checklist).toBe('--blok-checklist-font-size');
    expect(BLOK_FONT_SIZE_TOKENS.quote.large).toBe('--blok-quote-large-font-size');
    expect(BLOK_FONT_SIZE_TOKENS.table.comfortable).toBe('--blok-table-comfortable-font-size');
    expect(BLOK_FONT_SIZE_TOKENS.bookmark.link).toBe('--blok-bookmark-link-font-size');
  });

  it('covers exactly the scenarios the emitter writes, with the same names and order', () => {
    const entries = flattenTokens(BLOK_FONT_SIZE_TOKENS as unknown as TokenTree);
    const config = configForPaths(entries.map(([ path ]) => path), '1px');

    expect(buildFontSizeVarLines(config)).toEqual(entries.map(([ , token ]) => `${token}: 1px;`));
  });
});
