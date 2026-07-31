import type { BlokFontSizeConfig } from '../../../types/configs/blok-config';

/**
 * The `style.fontSize` contract: one entry per text scenario, mapping the
 * config path a host writes to the custom property the stylesheet reads.
 *
 * This array is the ONLY place the mapping exists — the CSS side consumes each
 * token with the block's historical size as the `var()` fallback, so an
 * unconfigured editor renders byte-identically to one built before this config
 * existed. Order here is the emitted order, which keeps the injected
 * stylesheet stable regardless of how the host ordered its config keys.
 *
 * Headings deliberately reuse the pre-existing `--blok-heading-N-font-size`
 * hooks (see `src/styles/heading.css`) rather than minting parallel tokens.
 */
const FONT_SIZE_SPEC: ReadonlyArray<readonly [path: readonly string[], token: string]> = [
  [['paragraph'], '--blok-paragraph-font-size'],
  [['heading', '1'], '--blok-heading-1-font-size'],
  [['heading', '2'], '--blok-heading-2-font-size'],
  [['heading', '3'], '--blok-heading-3-font-size'],
  [['heading', '4'], '--blok-heading-4-font-size'],
  [['heading', '5'], '--blok-heading-5-font-size'],
  [['heading', '6'], '--blok-heading-6-font-size'],
  [['list', 'item'], '--blok-list-font-size'],
  [['list', 'checklist'], '--blok-checklist-font-size'],
  [['quote', 'default'], '--blok-quote-font-size'],
  [['quote', 'large'], '--blok-quote-large-font-size'],
  [['callout'], '--blok-callout-font-size'],
  [['code'], '--blok-code-font-size'],
  [['toggle'], '--blok-toggle-font-size'],
  [['table', 'compact'], '--blok-table-font-size'],
  [['table', 'comfortable'], '--blok-table-comfortable-font-size'],
  [['image', 'caption'], '--blok-image-caption-font-size'],
  [['video', 'caption'], '--blok-video-caption-font-size'],
  [['audio', 'caption'], '--blok-audio-caption-font-size'],
  [['file', 'caption'], '--blok-file-caption-font-size'],
  [['embed', 'caption'], '--blok-embed-caption-font-size'],
  [['bookmark', 'title'], '--blok-bookmark-title-font-size'],
  [['bookmark', 'description'], '--blok-bookmark-description-font-size'],
  [['bookmark', 'link'], '--blok-bookmark-link-font-size'],
];

/**
 * Read a `style.fontSize` path, tolerating the missing intermediate objects a
 * partial config always has.
 * @param config - the host's `style.fontSize` object
 * @param path - spec path, e.g. `['image', 'caption']`
 * @returns the configured size, or null when unset or blank
 */
const readPath = (config: BlokFontSizeConfig, path: readonly string[]): string | null => {
  const value = path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined,
    config
  );

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  return value.trim();
};

/**
 * Turn `config.style.fontSize` into declaration lines for the injected
 * per-instance stylesheet.
 * @param fontSize - the host's `style.fontSize` config, if any
 * @returns `--token: value;` lines, in spec order; empty when nothing is set
 */
export const buildFontSizeVarLines = (fontSize: BlokFontSizeConfig | undefined): string[] => {
  if (fontSize === undefined) {
    return [];
  }

  const lines: string[] = [];

  for (const [path, token] of FONT_SIZE_SPEC) {
    const value = readPath(fontSize, path);

    if (value !== null) {
      lines.push(`${token}: ${value};`);
    }
  }

  return lines;
};
