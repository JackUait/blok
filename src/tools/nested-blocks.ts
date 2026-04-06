import { DATA_ATTR } from '../components/constants/data-attributes';

/**
 * Mount child block holders into a container, skipping children that are
 * already in place or claimed by another nested-blocks container.
 *
 * Used by toggle, header, and callout tools to reconcile child holders
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

    if (child.holder.closest(`[${DATA_ATTR.nestedBlocks}]`)) {
      continue;
    }

    container.appendChild(child.holder);
  }
};
