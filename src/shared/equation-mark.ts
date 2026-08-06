/**
 * The inline-equation mark's persistence law, in one place because three
 * pipelines depend on it (the editor's sanitizer, the DOM-free view sanitizer,
 * the DOM-free text extractor) and a drift between them is invisible until a
 * document is read back somewhere new.
 *
 * LAW: `data-latex` is the equation's content. Everything inside the span is a
 * rendering cache — KaTeX markup regenerated from the source — and therefore
 * MUST NOT be persisted, and MUST NOT be read as text.
 *
 * The law exists because breaking it is silent. KaTeX renders a MathML layer, a
 * `<annotation>` holding the raw source, and a visually-hidden HTML layer; a
 * sanitizer that keeps the span but unwraps the markup inside leaves the
 * concatenated TEXT of all three behind (`E=mc^2` renders as
 * `E=mc2E=mc^2E=mc2`). The editor hid that for as long as it re-rendered the
 * span on load, and every other consumer — the view renderer, plain-text
 * previews, search indexing — showed the concatenation verbatim.
 */

/** Attribute holding an inline equation's authoritative LaTeX source. */
export const EQUATION_SOURCE_ATTR = 'data-latex';
