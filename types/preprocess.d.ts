/**
 * Clean up legacy CMS markup (Summernote-era WYSIWYG output) before it is
 * turned into blocks: background `<div>`s become `<aside>` callouts, invisible
 * background colours are stripped, table-cell paragraphs become `<br>` lines,
 * spacer paragraphs are dropped, `<del>`/`<strike>` become `<s>`, and
 * `•`-prefixed paragraphs become real lists.
 *
 * Parsing goes through an inert document, so nothing in the input loads.
 *
 * NOTE: this signature is hand-authored to mirror the implementation in
 * `src/preprocess/index.ts`. It must stay self-contained — do NOT re-export from
 * `../src/...` (see `test/unit/architecture/published-types-no-src-refs.test.ts`).
 * @param html - legacy markup
 * @returns the cleaned markup
 */
export declare function preprocessLegacyCmsHtml(html: string): string;

/**
 * The same clean-up applied in place to markup a caller already parsed.
 *
 * Uses only standard DOM, so it works against a browser `document` and against a
 * jsdom one. Use it where there is no live `document` for the string form to
 * parse with.
 * @param wrapper - element holding the markup; mutated in place
 */
export declare function preprocessLegacyCmsHtmlIn(wrapper: HTMLElement): void;
