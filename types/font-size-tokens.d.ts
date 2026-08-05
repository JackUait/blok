/**
 * Public names of the per-block font-size custom properties.
 *
 * `style.fontSize` is one way to set these; a CSS rule is the other. A host
 * that scopes typography by region (a compact sidebar, a zoomed reading mode)
 * writes the tokens in its own stylesheet — or through
 * `editor.tokens.set()` at runtime — instead of through the constructor
 * config. That only works if the NAMES are part of the published contract:
 * hand-copied strings drift silently the moment Blok renames one.
 *
 * ```typescript
 * import { BLOK_FONT_SIZE_TOKENS } from '@bloklabs/core';
 *
 * editor.tokens.set({
 *   [BLOK_FONT_SIZE_TOKENS.paragraph]: '18px',
 *   [BLOK_FONT_SIZE_TOKENS.heading[1]]: '2.5rem',
 * });
 * ```
 *
 * The shape mirrors {@link BlokFontSizeConfig} exactly — same keys, same
 * nesting — so a config path and its token are reachable the same way.
 *
 * NOTE: hand-authored on purpose. `types/` is the published declaration
 * surface and may never re-export from `src/` (see
 * test/unit/architecture/published-types-no-src-refs.test.ts); the runtime
 * value is derived from the single mapping table in
 * `src/components/utils/font-size-tokens.ts`, and
 * test/unit/components/utils/font-size-tokens.test.ts cross-checks the two so
 * they cannot drift.
 */
export interface BlokFontSizeTokens {
  /** Paragraph text. */
  readonly paragraph: '--blok-paragraph-font-size';
  /** Heading text, per level. */
  readonly heading: {
    readonly 1: '--blok-heading-1-font-size';
    readonly 2: '--blok-heading-2-font-size';
    readonly 3: '--blok-heading-3-font-size';
    readonly 4: '--blok-heading-4-font-size';
    readonly 5: '--blok-heading-5-font-size';
    readonly 6: '--blok-heading-6-font-size';
  };
  /** List item text. */
  readonly list: {
    /** Bulleted and ordered item text. */
    readonly item: '--blok-list-font-size';
    /** Checklist item text. */
    readonly checklist: '--blok-checklist-font-size';
  };
  /** Quote text, per `data.size` variant. */
  readonly quote: {
    /** Default-size quotes. */
    readonly default: '--blok-quote-font-size';
    /** Quotes saved with `size: 'large'`. */
    readonly large: '--blok-quote-large-font-size';
  };
  /** Callout text. */
  readonly callout: '--blok-callout-font-size';
  /** Code block text. */
  readonly code: '--blok-code-font-size';
  /** Toggle title text. */
  readonly toggle: '--blok-toggle-font-size';
  /** Table cell text, per text-size setting. */
  readonly table: {
    /** Cells in the default `compact` density. */
    readonly compact: '--blok-table-font-size';
    /** Cells while the table's `textSize` is `comfortable`. */
    readonly comfortable: '--blok-table-comfortable-font-size';
  };
  /** Image block. */
  readonly image: {
    /** Caption under the image. */
    readonly caption: '--blok-image-caption-font-size';
  };
  /** Video block. */
  readonly video: {
    /** Caption under the player. */
    readonly caption: '--blok-video-caption-font-size';
  };
  /** Audio block. */
  readonly audio: {
    /** Caption under the player. */
    readonly caption: '--blok-audio-caption-font-size';
  };
  /** File block. */
  readonly file: {
    /** Caption under the file card. */
    readonly caption: '--blok-file-caption-font-size';
  };
  /** Embed block. */
  readonly embed: {
    /** Caption under the embed. */
    readonly caption: '--blok-embed-caption-font-size';
  };
  /** Bookmark card. */
  readonly bookmark: {
    /** Card title. */
    readonly title: '--blok-bookmark-title-font-size';
    /** Card description. */
    readonly description: '--blok-bookmark-description-font-size';
    /** Card link row. */
    readonly link: '--blok-bookmark-link-font-size';
  };
}

/**
 * The custom property each `style.fontSize` scenario writes.
 * See {@link BlokFontSizeTokens}.
 */
export const BLOK_FONT_SIZE_TOKENS: BlokFontSizeTokens;
