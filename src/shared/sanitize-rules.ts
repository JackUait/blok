/**
 * Pure sanitizer-rule primitives shared between the DOM-bound editor
 * sanitizer (`src/components/utils/sanitizer.ts`) and the DOM-free view
 * sanitizer (`src/view/sanitize.ts`). No DOM access, no editor-bundle
 * imports — safe for Node / workers / RSC.
 */

/**
 * Sentinel marking a block-data field as plaintext rather than HTML.
 *
 * Sanitization is an HTML parse: it entity-encodes bare `<`/`&` and deletes
 * text that looks like a stray end tag. That is correct for rich-text fields
 * and destructive for fields storing literal source text (a code block's
 * `code`). Declaring the field PLAINTEXT skips both janitor and the URL-scheme
 * pass, so the value round-trips byte-identical.
 *
 * A plain string (not a Symbol) so it survives JSON and structuredClone —
 * tool sanitize configs are a public surface hosts may serialize.
 */
export const PLAINTEXT = 'plaintext';

const SAFE_ATTRIBUTES = new Set(['class', 'id', 'title', 'role', 'dir', 'lang']);

/**
 * Whether an attribute is kept on tags allowed with a bare `true` rule:
 * the fixed safe set plus any data-* / aria-* attribute.
 * @param attribute - attribute name to test
 */
export const isSafeAttribute = (attribute: string): boolean => {
  const lowerName = attribute.toLowerCase();

  return lowerName.startsWith('data-') || lowerName.startsWith('aria-') || SAFE_ATTRIBUTES.has(lowerName);
};
