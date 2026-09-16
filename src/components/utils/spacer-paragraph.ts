/**
 * A spacer is a paragraph that carries nothing a reader can see: whitespace or
 * nbsp text and no element children. A paragraph whose textContent is empty but
 * which holds an `<img>` (or any other element) is NOT a spacer; removing it
 * would destroy the media. `\s` matches U+00A0 (the &nbsp; a spacer decodes to).
 * @param p - the paragraph to judge
 * @param options - `lineBreaksAreContent: false` also counts a `<br>`-only
 * paragraph (`<p><br></p>`) as a spacer. Legacy CMS markup writes those as blank
 * lines between blocks, and a block-per-blank-line is exactly what the import is
 * stripping; the paste path keeps them, because inside a table cell a blank line
 * is a line.
 * @returns whether the paragraph can be dropped without losing content
 */
export function isSpacerParagraph(p: Element, options: { lineBreaksAreContent?: boolean } = {}): boolean {
  const { lineBreaksAreContent = true } = options;
  const children = Array.from(p.children);
  const hasContentElement = lineBreaksAreContent
    ? children.length > 0
    : children.some((child) => child.tagName !== 'BR');

  return !hasContentElement && (p.textContent ?? '').replace(/\s/g, '') === '';
}
