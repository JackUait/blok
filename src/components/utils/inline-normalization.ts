import {
  areInterchangeable,
  decoratesNothing,
  duplicatesAncestor,
  MAX_NORMALIZATION_SWEEPS,
  MERGEABLE_TAGS,
  VOID_CONTENT_TAGS,
  type InlineElementView,
} from '../../shared/inline-normalization-policy';

/**
 * Inline markup normalization — DOM implementation.
 *
 * Clipboard converters emit one wrapper per source text run (Google Docs
 * writes a styled `<span>` for every run, including runs holding just a
 * `<br>` or a space), and the mark engine splits wrappers at range
 * boundaries. Both are correct locally and both leave redundant markup
 * behind: runs of identical adjacent wrappers, wrappers around nothing, and
 * wrappers nested inside an identical parent.
 *
 * Left alone this compounds — a colour applied to one Google Docs paragraph
 * can cost 15x its text in stored bytes, and every render/save round trip
 * carries it forward.
 *
 * Every decision lives in the shared policy module so this and the parse5
 * implementation in `src/view/inline-normalization.ts` cannot drift.
 */

/**
 * Build the shared policy's element view from a DOM element.
 * @param element - element to describe
 */
const viewOf = (element: Element): InlineElementView => {
  const style = (element as HTMLElement).style;
  const styleDeclarations = Array.from({ length: style.length }, (_, index) => {
    const property = style.item(index);

    return { property, value: style.getPropertyValue(property) };
  });

  return {
    tagName: element.tagName.toUpperCase(),
    attributes: Array.from(element.attributes).map((attribute) => ({
      name: attribute.name,
      value: attribute.value,
    })),
    styleDeclarations,
    text: () => element.textContent ?? '',
    hasVoidContentDescendant: () =>
      Array.from(element.querySelectorAll('*')).some((descendant) =>
        VOID_CONTENT_TAGS.has(descendant.tagName.toUpperCase())
      ),
  };
};

/**
 * Views of the element's ancestors up to (but excluding) the root, innermost
 * first.
 * @param element - element whose ancestors are wanted
 * @param root - boundary to stop at
 */
const ancestorViews = (element: Element, root: ParentNode): InlineElementView[] => {
  const ancestor = element.parentElement;

  if (ancestor === null || (ancestor as Node) === (root as Node)) {
    return [];
  }

  return [viewOf(ancestor), ...ancestorViews(ancestor, root)];
};

/**
 * Replace an element with its own children.
 * @param element - element to unwrap
 */
const unwrap = (element: Element): void => {
  const parent = element.parentNode;

  if (parent === null) {
    return;
  }

  while (element.firstChild !== null) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
};

/**
 * One normalization sweep. Returns whether anything changed, so the caller can
 * run to a fixpoint — unwrapping a wrapper can expose a merge, and merging can
 * expose a nested duplicate.
 * @param root - subtree to normalize in place
 */
const sweep = (root: ParentNode): boolean => {
  /**
   * The subtree is usually detached (a parsing holder), where `isConnected`
   * is always false — containment in the root is what "still present" means
   * after an earlier unwrap in the same sweep removed a node.
   */
  const stillPresent = (element: Element): boolean => (root as Node).contains(element);

  /**
   * Every rule below only ever fires on a mergeable tag (the decorative set is
   * a subset), so skipping the rest here keeps the pass proportional to the
   * inline markup rather than to the whole document — a wide table's cells
   * never get walked.
   */
  const isCandidate = (element: Element): boolean =>
    stillPresent(element) && MERGEABLE_TAGS.has(element.tagName.toUpperCase());

  const redundant = Array.from(root.querySelectorAll('*')).filter((element) => {
    if (!isCandidate(element)) {
      return false;
    }

    const view = viewOf(element);

    return decoratesNothing(view) || duplicatesAncestor(view, ancestorViews(element, root));
  });

  redundant.forEach(unwrap);

  /**
   * Absorb every following sibling that expresses the same formatting.
   * @param element - wrapper doing the absorbing
   * @param view - its precomputed view
   * @returns whether at least one sibling was absorbed
   */
  const absorbFollowing = (element: Element, view: InlineElementView): boolean => {
    const next = element.nextSibling;

    if (next === null || next.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (!areInterchangeable(view, viewOf(next as Element))) {
      return false;
    }

    const sibling = next as Element;

    while (sibling.firstChild !== null) {
      element.appendChild(sibling.firstChild);
    }

    sibling.remove();
    absorbFollowing(element, view);

    return true;
  };

  const merged = Array.from(root.querySelectorAll('*'))
    .filter(isCandidate)
    /* An absorbed sibling is still in this snapshot — skip what has since left the tree. */
    .map((element) => stillPresent(element) && absorbFollowing(element, viewOf(element)))
    .some(Boolean);

  return redundant.length > 0 || merged;
};

/**
 * Collapse redundant inline markup inside a live DOM subtree, in place.
 * @param root - subtree to normalize
 * @returns whether anything was collapsed
 */
export const normalizeInlineMarkupIn = (root: ParentNode): boolean => {
  /**
   * @param remaining - sweeps left before the safety valve trips
   * @returns whether any sweep collapsed something
   */
  const runSweeps = (remaining: number): boolean => {
    if (remaining === 0 || !sweep(root)) {
      return false;
    }

    runSweeps(remaining - 1);

    return true;
  };

  const changed = runSweeps(MAX_NORMALIZATION_SWEEPS);

  if (changed) {
    (root as Element).normalize?.();
  }

  return changed;
};

/**
 * Collapse redundant inline markup in an HTML string.
 *
 * The caller's string is returned verbatim unless something was actually
 * collapsed. That is not an optimization — it is what makes this safe to put
 * on the sanitize path at all. Parsing a string as HTML and re-serializing it
 * is lossy for anything that is not markup: a code snippet reading
 * `if (a<b) { }` comes back truncated, and `5 < 6 && 7 > 8` comes back
 * entity-escaped. Re-serializing only when the tree genuinely changed means a
 * string with nothing to collapse can never be damaged by passing through here.
 * @param html - HTML fragment
 */
export const normalizeInlineMarkupHtml = (html: string): string => {
  if (html === '' || !html.includes('<')) {
    return html;
  }

  const holder = document.createElement('div');

  holder.innerHTML = html;

  return normalizeInlineMarkupIn(holder) ? holder.innerHTML : html;
};
