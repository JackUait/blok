/**
 * Regression: the drop indicator blinks while the cursor holds one position.
 *
 * The blue drop line is painted ON the seam between two blocks (the CSS pins it
 * to a holder edge and pulls it half its thickness across with translateY(±50%)),
 * but block holders do not touch — a vertical margin separates them. Hit testing
 * only ever resolved a point that landed strictly INSIDE a holder rect, so the
 * seam the line is drawn on was a dead band: `determineDropTarget` returned null
 * there and the controller cleared the indicator.
 *
 * A user aiming at the line therefore parks the cursor in the dead band, and a
 * pixel of hand jitter alternates target/no-target every few frames — the line
 * blinks. Both hit-test entry points are covered here: the in-content path
 * (elementFromPoint lands on the editor, not a holder) and the left-gutter path.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { DropTargetDetector } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { BlockManagerAdapter } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { Block } from '../../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../../src/components/constants';

/** Content column geometry shared by the fixture blocks. */
const CONTENT_LEFT = 100;
const CONTENT_RIGHT = 500;

/**
 * Two stacked blocks with a 2px margin between them — the real editor gap.
 * Block A: 200..248, block B: 250..288. The seam band is 248..250.
 */
const BLOCK_A_TOP = 200;
const BLOCK_A_BOTTOM = 248;
const BLOCK_B_TOP = 250;
const BLOCK_B_BOTTOM = 288;

const createMockBlock = (id: string, top: number, bottom: number): Block => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, 'block');
  holder.setAttribute('data-blok-id', id);

  const rect = {
    top,
    bottom,
    left: CONTENT_LEFT,
    right: CONTENT_RIGHT,
    width: CONTENT_RIGHT - CONTENT_LEFT,
    height: bottom - top,
    x: CONTENT_LEFT,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;

  vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue(rect);

  return {
    id,
    holder,
    name: 'paragraph',
    stretched: false,
    parentId: null,
  } as Block;
};

describe('DropTargetDetector — the seam between two blocks', () => {
  let detector: DropTargetDetector;
  let blockManager: BlockManagerAdapter;
  let blockA: Block;
  let blockB: Block;
  let source: Block;
  /** Stands in for the editor body under the cursor when it is over the gap. */
  let editorBody: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    blockA = createMockBlock('a', BLOCK_A_TOP, BLOCK_A_BOTTOM);
    blockB = createMockBlock('b', BLOCK_B_TOP, BLOCK_B_BOTTOM);
    source = createMockBlock('source', 600, 640);

    editorBody = document.createElement('div');
    editorBody.append(blockA.holder, blockB.holder, source.holder);
    document.body.appendChild(editorBody);

    const blocks = [blockA, blockB, source];

    blockManager = {
      blocks,
      getBlockByIndex: (index: number) => blocks[index],
      getBlockIndex: (block: Block) => blocks.indexOf(block),
      getBlockById: (id: string) => blocks.find(block => block.id === id),
    };

    detector = new DropTargetDetector(
      { contentRect: { left: CONTENT_LEFT } },
      blockManager,
      { isColumnsEnabled: () => false }
    );
    detector.setSourceBlocks([source]);
  });

  it('resolves a drop target for a cursor in the gap over the content column', () => {
    // Cursor sits on the seam, horizontally in the middle of the content.
    const target = detector.determineDropTarget(editorBody, 300, 249, source);

    expect(target).not.toBeNull();
    expect(target?.block).toBe(blockA);
    expect(target?.edge).toBe('bottom');
  });

  it('resolves a drop target for a cursor in the gap in the left gutter', () => {
    // Cursor sits on the seam, in the left drop zone beside the content.
    const gutterBlock = detector.findBlockInLeftDropZone(CONTENT_LEFT - 10, 249);

    expect(gutterBlock).toBe(blockA);
  });

  it('still ignores a cursor far below the last block', () => {
    // The gap tolerance must not turn the whole page into a drop target.
    expect(detector.findBlockInLeftDropZone(CONTENT_LEFT - 10, 5000)).toBeNull();
    expect(detector.determineDropTarget(editorBody, 300, 5000, source)).toBeNull();
  });
});
