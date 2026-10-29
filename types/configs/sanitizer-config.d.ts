/**
 * Rule for one HTML tag.
 * - `true` keeps the tag. `api.sanitizer.clean()` keeps all its attributes; saved block data keeps only safe ones.
 * - `false`, or a tag left out, unwraps the tag: its text and children stay. Script and style content is dropped.
 * - An object keeps the tag and lists its attributes. `true` keeps one, `false` or a missing key drops it,
 *   and a string keeps it only when the value is exactly that string.
 *
 * `on*` event handler attributes and `srcdoc` are always dropped, and so is a `javascript:` or
 * `data:` URL in any URL attribute (`href`, `src`, `xlink:href`, `action`…).
 *
 * A function rule must depend only on the element and what is inside it, not on its siblings or parent.
 */
export type TagConfig = boolean | { [attr: string]: boolean | string };

/**
 * Marks a block-data field as plaintext rather than HTML.
 *
 * Sanitization is an HTML parse: it entity-encodes bare `<`/`&` and drops text
 * shaped like a stray end tag. For a field holding literal source text (a code
 * block's `code`) that is irrecoverable corruption, so a PLAINTEXT field skips
 * both tag sanitization and the URL-scheme pass and round-trips byte-identical.
 *
 * Declared as a string literal (not a Symbol) so tool sanitize configs survive
 * JSON and structuredClone.
 *
 * @example
 * static get sanitize(): ToolSanitizerConfig {
 *   return { code: 'plaintext' };
 * }
 */
export type PlaintextRule = 'plaintext';

export type SanitizerRule = TagConfig | PlaintextRule | ((el: Element) => TagConfig);

export interface SanitizerConfig {
  /**
   * Tag name and the rule that keeps it. See {@link TagConfig}.
   *
   * @example Save P tags
   * p: true
   *
   * @example Save A tags and do not strip HREF attribute
   * a: {
   *   href: true
   * }
   *
   * @example Save A tags only when TARGET is "_blank"
   * a: function (aTag) {
   *   return aTag.target === '_blank';
   * }
   *
   * @example Save U tags that are not empty
   * u: function(el){
   *   return el.textContent !== '';
   * }
   *
   * @example For blockquote with class 'indent' save CLASS and STYLE attributes
   *          Otherwise strip all attributes
   * blockquote: function(el) {
   *   if (el.classList.contains('indent')) {
   *     return { 'class': true, 'style': true };
   *   } else {
   *     return {};
   *   }
   * }
   */
  [key: string]: SanitizerRule;
}

/**
 * Sanitizer config for Block Tools that supports field-specific tag rules.
 * Use this when your tool's data has multiple fields that each need different sanitization.
 *
 * @example Field-specific sanitization
 * ```typescript
 * static get sanitize(): ToolSanitizerConfig {
 *   return {
 *     text: {
 *       br: true,
 *       a: { href: true, target: '_blank', rel: 'nofollow' }
 *     },
 *     caption: {
 *       b: true,
 *       i: true
 *     }
 *   };
 * }
 * ```
 */
export interface ToolSanitizerConfig {
  [key: string]: SanitizerRule | SanitizerConfig;
}
