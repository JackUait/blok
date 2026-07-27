/**
 * The drop indicator must never preview a nesting depth the drop cannot apply.
 *
 * A non-list block realizes its visual depth ONLY by becoming a structural child
 * (DragController.applyStructuralDropDepth → setBlockParent). The legal-parent
 * rule there is: a list item may nest under ANY preceding block, but every OTHER
 * block may nest only under a preceding LIST item. So when a header is dragged
 * to the right in a gap whose predecessor is a plain paragraph/heading, there is
 * no parent to attach to and the drop lands at root — while the indicator used
 * to tuck itself one indent step in, promising a nesting that never happened.
 *
 * (A dragged LIST item is different: it carries its own indent via the list
 * tool's moved() hook, so its previewed depth is honest regardless.)
 */

import { describe, it, expect } from 'vitest';
import { DropTargetDetector } from '../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { BlockManagerAdapter } from '../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { Block } from '../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../src/components/constants';
import { INDENT_PER_LEVEL } from '../../../../../src/tools/list/constants';

const CONTENT_LEFT = 100;

/** A non-list block (paragraph/header) at root, or nested under `parentId`. */
const otherBlock = (id: string, name = 'paragraph', parentId: string | null = null): Block => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, 'block');

  return { id, holder, name, parentId, stretched: false } as Block;
};

/** A list item carrying its flat depth via data-list-depth. */
const listBlock = (id: string, depth: number, parentId: string | null = null): Block => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, 'block');

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-list-depth', String(depth));
  holder.appendChild(wrapper);

  return { id, holder, name: 'list', parentId, stretched: false } as Block;
};

/**
 * Builds a detector over `blocks` and asks for the depth previewed when dropping
 * `source` at the bottom edge of the block at `targetIndex`, with the cursor
 * dragged `indentSteps` levels to the right of the content edge.
 */
const previewedDepth = (
  blocks: Block[],
  targetIndex: number,
  source: Block,
  indentSteps: number
): number => {
  const blockManager: BlockManagerAdapter = {
    blocks,
    getBlockByIndex: (index: number) => blocks[index],
    getBlockIndex: (block: Block) => blocks.indexOf(block),
    getBlockById: (id: string) => blocks.find(b => b.id === id),
  };
  const detector = new DropTargetDetector({ contentRect: { left: CONTENT_LEFT } }, blockManager);

  detector.setSourceBlocks([source]);

  return detector.calculateTargetDepth(
    blocks[targetIndex],
    'bottom',
    source,
    CONTENT_LEFT + indentSteps * INDENT_PER_LEVEL
  );
};

describe('drop indicator depth is limited to depths the drop can actually apply', () => {
  it('keeps a header at root when the only predecessor is a plain heading', () => {
    const title = otherBlock('title', 'header');
    const paragraph = otherBlock('paragraph');
    const source = otherBlock('source', 'header');

    // Cursor dragged one indent step right, in the gap under the title.
    expect(previewedDepth([title, paragraph], 0, source, 1)).toBe(0);
  });

  it('still nests a header one level under a preceding list item', () => {
    const item = listBlock('item', 0);
    const paragraph = otherBlock('paragraph');
    const source = otherBlock('source', 'header');

    expect(previewedDepth([item, paragraph], 0, source, 1)).toBe(1);
  });

  it('clamps to the nearest legal list ancestor instead of a nested paragraph', () => {
    const item = listBlock('item', 0);
    const childParagraph = otherBlock('child', 'paragraph', 'item');
    const source = otherBlock('source', 'header');

    // The cursor asks for depth 2, but `childParagraph` is not a legal parent —
    // the deepest reachable parent is the list item at structural depth 0.
    expect(previewedDepth([item, childParagraph], 1, source, 2)).toBe(1);
  });

  it('leaves a dragged list item free to nest under any preceding block', () => {
    const paragraph = otherBlock('paragraph');
    const trailing = otherBlock('trailing');
    const source = listBlock('source', 0);

    expect(previewedDepth([paragraph, trailing], 0, source, 1)).toBe(1);
  });
});
