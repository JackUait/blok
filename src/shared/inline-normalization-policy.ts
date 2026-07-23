/**
 * Shared policy for inline markup normalization.
 *
 * Two implementations collapse redundant inline markup — the DOM one used by
 * the editor's sanitizer, and the parse5 one used by the DOM-free view
 * renderer. They must reach identical conclusions or the same document
 * serializes differently depending on which renderer touched it last, so
 * every decision lives here and only the tree mechanics differ.
 *
 * The one invariant every rule below serves: normalization is
 * reader-invisible. It changes how many elements express the formatting,
 * never the formatting itself.
 */

/**
 * A tree-shape-agnostic view of an inline element, built by each
 * implementation from its own node type.
 */
export interface InlineElementView {
  /** Upper-case tag name */
  tagName: string;
  /** Every attribute except `style`, which is compared via declarations */
  attributes: Array<{ name: string; value: string }>;
  /** Inline style declarations, in source order */
  styleDeclarations: Array<{ property: string; value: string }>;
  /**
   * Concatenated descendant text. A function, not a value: reading it walks
   * the subtree, and only {@link decoratesNothing} ever needs it — the merge
   * and nesting rules compare attributes alone. Building it eagerly made
   * normalizing a wide table quadratic.
   */
  text: () => string;
  /**
   * Whether any descendant is content in its own right (an image, say).
   * Lazy for the same reason as {@link InlineElementView.text}.
   */
  hasVoidContentDescendant: () => boolean;
}

/**
 * Inline elements whose only job is to decorate the text they wrap. Two
 * adjacent ones carrying identical attributes are interchangeable with a
 * single wrapper around the concatenated content.
 *
 * `<a>` is included: adjacent anchors with an identical href are equivalent
 * to one anchor. It is deliberately absent from {@link DECORATIVE_TAGS},
 * where an anchor's identity as a link target outweighs its decoration.
 */
export const MERGEABLE_TAGS = new Set([
  'A',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'DEL',
  'INS',
  'MARK',
  'CODE',
  'SUB',
  'SUP',
  'SMALL',
  'SPAN',
  'FONT',
]);

/**
 * Wrappers carrying no meaning of their own — safe to drop when they end up
 * around content they cannot possibly affect.
 */
export const DECORATIVE_TAGS = new Set([...MERGEABLE_TAGS].filter((tag) => tag !== 'A'));

/**
 * Elements that are content in their own right even though they hold no text.
 * A wrapper around one of these is not empty.
 */
export const VOID_CONTENT_TAGS = new Set([
  'IMG',
  'IFRAME',
  'VIDEO',
  'AUDIO',
  'INPUT',
  'SVG',
  'CANVAS',
  'OBJECT',
  'EMBED',
]);

/**
 * Tags whose decoration paints over whitespace, so a whitespace-only wrapper
 * is still visible and must be kept.
 */
const WHITESPACE_VISIBLE_TAGS = new Set(['U', 'S', 'DEL', 'INS']);

/**
 * Inline style properties that paint over whitespace.
 */
const WHITESPACE_VISIBLE_PROPS = new Set([
  'background-color',
  'background',
  'text-decoration',
  'text-decoration-line',
  'border',
  'border-bottom',
  'box-shadow',
  'outline',
]);

const BLANK_STYLE_VALUES = new Set(['', 'none', 'transparent', 'initial', 'unset']);

/**
 * Identity of a wrapper for merge purposes: tag plus every attribute, with
 * `style` compared as an order-insensitive declaration set so two equivalent
 * wrappers written differently still match.
 * @param view - element view to fingerprint
 */
export const wrapperSignature = (view: InlineElementView): string => {
  const attributes = view.attributes
    .filter((attribute) => attribute.name.toLowerCase() !== 'style')
    .map((attribute) => `${attribute.name.toLowerCase()}=${attribute.value}`)
    .sort();

  const declarations = view.styleDeclarations
    .map((declaration) => `${declaration.property.toLowerCase()}:${declaration.value.trim()}`)
    .sort();

  return `${view.tagName}|${attributes.join('|')}|${declarations.join(';')}`;
};

/**
 * An `id` must stay unique, so merging two elements that both carry one would
 * have to discard an identifier something else may reference.
 * @param view - element view to check
 */
export const carriesIdentity = (view: InlineElementView): boolean =>
  view.attributes.some((attribute) => attribute.name.toLowerCase() === 'id');

/**
 * Whether the element's decoration would be visible over pure whitespace.
 * @param view - element view to check
 */
const paintsOverWhitespace = (view: InlineElementView): boolean => {
  if (WHITESPACE_VISIBLE_TAGS.has(view.tagName)) {
    return true;
  }

  return view.styleDeclarations.some(
    (declaration) =>
      WHITESPACE_VISIBLE_PROPS.has(declaration.property.toLowerCase()) &&
      !BLANK_STYLE_VALUES.has(declaration.value.trim().toLowerCase())
  );
};

/**
 * Whether a decorative wrapper has nothing left to decorate: no visible text,
 * no element that is content in its own right, and no styling that would show
 * over the whitespace it does hold.
 * @param view - element view to check
 */
export const decoratesNothing = (view: InlineElementView): boolean => {
  if (!DECORATIVE_TAGS.has(view.tagName)) {
    return false;
  }

  const text = view.text();

  if (text.trim().length > 0 || view.hasVoidContentDescendant()) {
    return false;
  }

  return text.length === 0 || !paintsOverWhitespace(view);
};

/**
 * Whether two directly adjacent siblings express the same formatting and can
 * therefore be expressed as one wrapper.
 * @param left - first sibling's view
 * @param right - second sibling's view
 */
export const areInterchangeable = (left: InlineElementView, right: InlineElementView): boolean => {
  if (!MERGEABLE_TAGS.has(left.tagName) || carriesIdentity(left) || carriesIdentity(right)) {
    return false;
  }

  return wrapperSignature(left) === wrapperSignature(right);
};

/**
 * Whether a wrapper repeats formatting an ancestor already applies.
 * @param view - element view to check
 * @param ancestorViews - views of its ancestors, innermost first
 */
export const duplicatesAncestor = (view: InlineElementView, ancestorViews: InlineElementView[]): boolean => {
  if (!MERGEABLE_TAGS.has(view.tagName) || carriesIdentity(view)) {
    return false;
  }

  const signature = wrapperSignature(view);

  return ancestorViews.some((ancestor) => wrapperSignature(ancestor) === signature);
};

/**
 * Safety valve for the sweep loop. Each sweep strictly removes elements, so it
 * terminates on its own; the cap only bounds pathological input.
 */
export const MAX_NORMALIZATION_SWEEPS = 10;
