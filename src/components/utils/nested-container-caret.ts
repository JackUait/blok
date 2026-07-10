import type { Block } from '../block';
import { DATA_ATTR } from '../constants/data-attributes';

interface CaretRestoreDeps {
  /** Resolve a Block from its holder element (BlockManager.getBlock). */
  getBlock: (holder: HTMLElement) => Block | undefined;
  /** Place the caret at the start of a block (Caret.setToBlock). */
  setCaretToBlockStart: (block: Block) => void;
}

/**
 * When every given block lives inside the SAME nested-blocks container
 * (e.g. several lines of one table cell), return that container.
 * Returns null for top-level blocks or blocks spanning several containers.
 * @param blocks - the blocks to inspect (typically the current selection)
 */
export function findCommonNestedContainer(blocks: Block[]): HTMLElement | null {
  if (blocks.length === 0) {
    return null;
  }

  const containers = blocks.map(
    (block) => block.holder.parentElement?.closest<HTMLElement>(`[${DATA_ATTR.nestedBlocks}]`) ?? null
  );

  const [first] = containers;

  return first !== null && containers.every((container) => container === first) ? first : null;
}

/**
 * Restore the caret into a nested-blocks container after its selected blocks
 * were deleted without a replacement. A partial multi-block delete inserts no
 * replacement block and sets no caret, so deleting all lines of one table cell
 * dropped focus onto <body>. The container's owner (e.g. the table's
 * empty-cell repair) re-inserts a block in a microtask, so the caret is placed
 * on the next frame, after that repair has landed.
 * @param container - the container the deleted blocks lived in (from
 *   {@link findCommonNestedContainer}), or null to do nothing
 * @param deps - block resolution and caret placement callbacks
 */
export function scheduleCaretIntoNestedContainer(container: HTMLElement | null, deps: CaretRestoreDeps): void {
  if (container === null) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (!container.isConnected) {
      return;
    }

    const holder = container.querySelector<HTMLElement>(`[${DATA_ATTR.element}]`);
    const block = holder !== null ? deps.getBlock(holder) : undefined;

    if (block) {
      deps.setCaretToBlockStart(block);
    }
  });
}
