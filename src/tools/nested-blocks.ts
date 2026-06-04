import { DATA_ATTR } from '../components/constants/data-attributes';

/**
 * Mount child block holders into a container, skipping children that are
 * already in place or claimed by another nested-blocks container.
 *
 * Used by toggle, header, column, and callout tools to reconcile child holders
 * during the `rendered()` lifecycle hook.
 */
export const mountChildBlocks = (
  container: HTMLElement,
  children: { holder: HTMLElement }[],
): void => {
  for (const child of children) {
    if (child.holder.parentElement === container) {
      continue;
    }

    const nested = child.holder.closest(`[${DATA_ATTR.nestedBlocks}]`);

    // Claim a holder stranded in the column_list ROW. A drag reparent into a
    // column drops the moved holder directly into the [data-blok-columns] row
    // (itself a nested-blocks container that wraps each column's own container).
    // Left there it renders as a rogue new column, so pull it down into THIS
    // column container where it belongs. Scoped to the column_list row
    // specifically — claiming from arbitrary ancestor containers would let one
    // table cell steal a paragraph transiently parked in an outer container.
    if (
      nested !== null &&
      nested !== container &&
      nested.hasAttribute('data-blok-columns') &&
      nested.contains(container)
    ) {
      container.appendChild(child.holder);
      continue;
    }

    // Otherwise leave holders that already live inside another nested container
    // (a sibling, or a deeper nesting within this one) where they are.
    if (nested !== null) {
      continue;
    }

    container.appendChild(child.holder);
  }
};
