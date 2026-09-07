/**
 * Geometry and guard tests for DropTargetDetector, written to pin the exact
 * arithmetic the drop indicator depends on.
 *
 * Every fixture here uses a real client position (no rect at the origin), block
 * heights that all differ, and asymmetric column widths. A symmetric or
 * zero-anchored fixture makes this file's arithmetic unobservable: subtracting
 * the container offset reads the same as adding it, and every nearest-edge
 * comparison collapses onto the same block.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { DropTargetDetector } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { BlockManagerAdapter, UIAdapter } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { Block } from '../../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../../src/components/constants';
import { INDENT_PER_LEVEL } from '../../../../../../src/tools/list/constants';

interface RectSpec {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface BlockSpec {
  id: string;
  name?: string;
  parentId?: string | null;
  /** Use an existing element as the block holder instead of a fresh one. */
  holder?: HTMLElement;
  rect?: RectSpec;
  /** Adds a [data-blok-element-content] child with its own rect. */
  contentRect?: RectSpec;
  attrs?: Record<string, string>;
}

const toDomRect = (spec: RectSpec): DOMRect => ({
  top: spec.top,
  bottom: spec.bottom,
  left: spec.left,
  right: spec.right,
  width: spec.right - spec.left,
  height: spec.bottom - spec.top,
  x: spec.left,
  y: spec.top,
  toJSON: () => ({}),
});

const stubRect = (element: HTMLElement, spec: RectSpec): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(toDomRect(spec));
};

const makeBlock = (spec: BlockSpec): Block => {
  const holder = spec.holder ?? document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, 'block');
  holder.setAttribute('data-blok-id', spec.id);

  for (const [name, value] of Object.entries(spec.attrs ?? {})) {
    holder.setAttribute(name, value);
  }

  if (spec.rect !== undefined) {
    stubRect(holder, spec.rect);
  }

  if (spec.contentRect !== undefined) {
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    holder.appendChild(content);
    stubRect(content, spec.contentRect);
  }

  return {
    id: spec.id,
    name: spec.name ?? 'paragraph',
    parentId: spec.parentId ?? null,
    contentIds: [],
    holder,
    selected: false,
    stretched: false,
  } as unknown as Block;
};

/**
 * Mirrors BlockManager's repository: index -1 resolves to the LAST block, not
 * undefined. A detector guard that lets a negative index through therefore
 * reaches a real block, which is what makes those guards observable at all.
 */
const makeBlockManager = (blocks: Block[]): BlockManagerAdapter => ({
  blocks,
  getBlockByIndex: (index: number) => blocks[index === -1 ? blocks.length - 1 : index],
  getBlockIndex: (block: Block) => blocks.indexOf(block),
  getBlockById: (id: string) => blocks.find(block => block.id === id),
});

const makeUI = (left: number): UIAdapter => ({ contentRect: { left } });

/** An element that belongs to no block holder — the cursor is over bare editor. */
const bareElement = (): HTMLElement => {
  const element = document.createElement('div');

  document.body.appendChild(element);

  return element;
};

describe('DropTargetDetector — geometry and guards', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('seam between stacked holders', () => {
    // Holders span x 120..620 and never touch: A 200..260, B 268..308,
    // C 316..436. Seams are 260..268 (midpoint 264) and 308..316 (midpoint 312).
    const HOLDER_LEFT = 120;
    const HOLDER_RIGHT = 620;

    const stack = (): { a: Block; b: Block; c: Block } => ({
      a: makeBlock({ id: 'a', rect: { top: 200, bottom: 260, left: HOLDER_LEFT, right: HOLDER_RIGHT } }),
      b: makeBlock({ id: 'b', rect: { top: 268, bottom: 308, left: HOLDER_LEFT, right: HOLDER_RIGHT } }),
      c: makeBlock({ id: 'c', rect: { top: 316, bottom: 436, left: HOLDER_LEFT, right: HOLDER_RIGHT } }),
    });

    /** contentRect.left 0 keeps every x > 0 out of the left drop zone. */
    const detectorFor = (blocks: Block[]): DropTargetDetector =>
      new DropTargetDetector(makeUI(0), makeBlockManager(blocks));

    it('resolves the exact seam midpoint to the block above it', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 264);

      expect(result.block).toBe(a);
      expect(result.holder).toBe(a.holder);
    });

    it('resolves a seam point nearer the lower block to that block', () => {
      const { a, b, c } = stack();
      // A wrapper starting exactly where B starts: the below-candidate scan must
      // keep B (the first at that top), not the wrapper and not the far C.
      const tail = makeBlock({ id: 'tail', rect: { top: 268, bottom: 436, left: HOLDER_LEFT, right: HOLDER_RIGHT } });
      const detector = detectorFor([a, b, tail, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 266);

      expect(result.block).toBe(b);
    });

    it('treats a point on a holder bottom edge as belonging to that holder', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 260);

      expect(result.block).toBe(a);
    });

    it('treats a point on a holder top edge as belonging to that holder', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 268);

      expect(result.block).toBe(b);
    });

    it('picks the nearest of several holders above the seam', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 312);

      expect(result.block).toBe(b);
    });

    it('scans below-candidates by rect, not by their order in the block list', () => {
      const { a, b, c } = stack();
      // blocks is block-tree order, never a sort by position: the nearest-below
      // scan must compare rects, so a far block listed first cannot win.
      const detector = detectorFor([a, c, b]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 266);

      expect(result.block).toBe(b);
    });

    it('keeps the first candidate when two holders share a bottom edge', () => {
      const { a, b, c } = stack();
      // A container holder covering A and B ends where B ends. The scan must not
      // trade an equal-bottom candidate for a later one.
      const row = makeBlock({ id: 'row', rect: { top: 200, bottom: 308, left: HOLDER_LEFT, right: HOLDER_RIGHT } });
      const detector = detectorFor([row, a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 312);

      expect(result.block).toBe(row);
    });

    it('leaves the empty space above the first block a non-target', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 150);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });

    it('leaves the empty space below the last block a non-target', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 370, 500);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });

    it('leaves a seam point left of every holder a non-target', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 50, 264);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });

    it('leaves a seam point right of every holder a non-target', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), 700, 264);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });

    it('counts a seam point exactly on the left holder edge', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), HOLDER_LEFT, 264);

      expect(result.block).toBe(a);
    });

    it('counts a seam point exactly on the right holder edge', () => {
      const { a, b, c } = stack();
      const detector = detectorFor([a, b, c]);

      const result = detector.findDropTargetBlock(bareElement(), HOLDER_RIGHT, 264);

      expect(result.block).toBe(a);
    });
  });

  describe('left drop zone', () => {
    // Content edge at 120, DRAG_CONFIG.leftDropZone is 50 → the zone is x 70..120.
    const CONTENT_LEFT = 120;

    const stack = (): { a: Block; b: Block; c: Block } => ({
      a: makeBlock({ id: 'a', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 620 } }),
      b: makeBlock({ id: 'b', rect: { top: 268, bottom: 308, left: CONTENT_LEFT, right: 620 } }),
      c: makeBlock({ id: 'c', rect: { top: 316, bottom: 436, left: CONTENT_LEFT, right: 620 } }),
    });

    const detectorFor = (blocks: Block[]): DropTargetDetector =>
      new DropTargetDetector(makeUI(CONTENT_LEFT), makeBlockManager(blocks));

    it('accepts a cursor exactly on the content edge', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(120, 230)).toBe(a);
    });

    it('accepts a cursor exactly one drop-zone width out', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(70, 230)).toBe(a);
    });

    it('rejects a cursor one pixel beyond the drop zone', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(69, 230)).toBeNull();
    });

    it('rejects a cursor right of the content edge', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(130, 230)).toBeNull();
    });

    it('counts a cursor on the first block top edge', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(100, 200)).toBe(a);
    });

    it('counts a cursor on the last block bottom edge', () => {
      const { a, b, c } = stack();

      expect(detectorFor([a, b, c]).findBlockInLeftDropZone(100, 436)).toBe(c);
    });
  });

  describe('toggle body placeholder routing', () => {
    /**
     * toggleHolder > placeholder > innerHolder > cursor. The placeholder route
     * must win over the plain closest() route, which would stop at innerHolder.
     */
    const nestedPlaceholder = (): { toggleHolder: HTMLElement; innerHolder: HTMLElement; cursor: HTMLElement } => {
      const toggleHolder = document.createElement('div');

      toggleHolder.setAttribute(DATA_ATTR.element, 'block');

      const placeholder = document.createElement('div');

      placeholder.setAttribute('data-blok-toggle-body-placeholder', '');

      const innerHolder = document.createElement('div');

      innerHolder.setAttribute(DATA_ATTR.element, 'block');

      const cursor = document.createElement('span');

      innerHolder.appendChild(cursor);
      placeholder.appendChild(innerHolder);
      toggleHolder.appendChild(placeholder);
      document.body.appendChild(toggleHolder);

      return { toggleHolder, innerHolder, cursor };
    };

    it('routes a cursor inside the placeholder to the toggle, not to a holder nested in it', () => {
      const { toggleHolder, innerHolder, cursor } = nestedPlaceholder();
      const lead = makeBlock({ id: 'lead' });
      // The toggle is deliberately not blocks[0]: a lookup that ignores the
      // holder identity would otherwise return the right block by accident.
      const toggle = makeBlock({ id: 'toggle', holder: toggleHolder });
      const inner = makeBlock({ id: 'inner', holder: innerHolder });

      const detector = new DropTargetDetector(makeUI(120), makeBlockManager([lead, toggle, inner]));
      const result = detector.findDropTargetBlock(cursor, 370, 230);

      expect(result.block).toBe(toggle);
      expect(result.holder).toBe(toggleHolder);
    });

    it('returns nothing when the placeholder sits outside any block holder', () => {
      const placeholder = document.createElement('div');

      placeholder.setAttribute('data-blok-toggle-body-placeholder', '');
      document.body.appendChild(placeholder);

      const a = makeBlock({ id: 'a', rect: { top: 200, bottom: 260, left: 120, right: 620 } });
      const detector = new DropTargetDetector(makeUI(120), makeBlockManager([a]));

      // The cursor is in the left drop zone, so every fallback below the
      // placeholder branch WOULD resolve a block. The branch must stop first.
      const result = detector.findDropTargetBlock(placeholder, 100, 230);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });

    it('falls back to the nested holder when the placeholder holder owns no block', () => {
      const { innerHolder, cursor } = nestedPlaceholder();
      const lead = makeBlock({ id: 'lead' });
      const inner = makeBlock({ id: 'inner', holder: innerHolder });

      const detector = new DropTargetDetector(makeUI(120), makeBlockManager([lead, inner]));
      const result = detector.findDropTargetBlock(cursor, 370, 230);

      expect(result.block).toBe(inner);
      expect(result.holder).toBe(innerHolder);
    });
  });
});

describe('DropTargetDetector — drop target resolution', () => {
  const CONTENT_LEFT = 120;
  const CONTENT_RIGHT = 620;
  let originalInnerWidth: number;

  /**
   * A three-block page: head 200..260, mid 268..308, tail 316..436, all spanning
   * x 120..620. Heights differ so each block's central side-drop band differs
   * too; x 370 sits in every one of them, so no side-drop can steal a case here.
   */
  const page = (): { head: Block; mid: Block; tail: Block; src: Block } => ({
    head: makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: CONTENT_RIGHT } }),
    mid: makeBlock({ id: 'mid', rect: { top: 268, bottom: 308, left: CONTENT_LEFT, right: CONTENT_RIGHT } }),
    tail: makeBlock({ id: 'tail', rect: { top: 316, bottom: 436, left: CONTENT_LEFT, right: CONTENT_RIGHT } }),
    src: makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: CONTENT_RIGHT } }),
  });

  const detectorFor = (blocks: Block[]): DropTargetDetector =>
    new DropTargetDetector(makeUI(CONTENT_LEFT), makeBlockManager(blocks));

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('refuses the block being dragged as its own target', () => {
    const { head, mid, tail, src } = page();
    const detector = detectorFor([head, mid, tail, src]);

    detector.setSourceBlocks([mid]);

    expect(detector.determineDropTarget(mid.holder, 370, 290, mid)).toBeNull();
  });

  it('refuses a block that belongs to a multi-block selection', () => {
    const { head, mid, tail, src } = page();
    const detector = detectorFor([head, mid, tail, src]);

    detector.setSourceBlocks([src, mid]);

    expect(detector.determineDropTarget(mid.holder, 370, 290, src)).toBeNull();
  });

  it('still resolves a target when the selection holds a single block', () => {
    const { head, mid, tail, src } = page();
    const detector = detectorFor([head, mid, tail, src]);

    // The guard exists for selections of MORE than one block; a one-block
    // selection is already handled by the identity check above it.
    detector.setSourceBlocks([mid]);

    const result = detector.determineDropTarget(mid.holder, 370, 290, src);

    expect(result?.block).toBe(mid);
    expect(result?.edge).toBe('bottom');
  });

  it('converts a top-half drop into a bottom-edge drop on the previous block', () => {
    const { head, mid, tail, src } = page();
    const detector = detectorFor([head, mid, tail, src]);

    detector.setSourceBlocks([src]);

    const result = detector.determineDropTarget(mid.holder, 370, 275, src);

    expect(result?.block).toBe(head);
    expect(result?.edge).toBe('bottom');
  });

  it('does not reroute to a table when only the dragged block sits in a cell', () => {
    const { head, mid, tail, src } = page();
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell-blocks', '');
    cell.appendChild(src.holder);
    document.body.appendChild(cell);

    const detector = detectorFor([head, mid, tail, src]);

    detector.setSourceBlocks([src]);

    const result = detector.determineDropTarget(mid.holder, 370, 290, src);

    expect(result?.block).toBe(mid);
    expect(result?.edge).toBe('bottom');
  });

  describe('table cell redirect', () => {
    /** Table holder 300..500, so its half-way line is exactly y 400. */
    const tableFixture = (): { head: Block; table: Block; inner: Block; src: Block; cell: HTMLElement } => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const table = makeBlock({ id: 'table', name: 'table', rect: { top: 300, bottom: 500, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const inner = makeBlock({ id: 'inner' });
      const src = makeBlock({ id: 'src', rect: { top: 600, bottom: 660, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell-blocks', '');
      cell.appendChild(inner.holder);
      table.holder.appendChild(cell);
      document.body.appendChild(table.holder);

      return { head, table, inner, src, cell };
    };

    it('redirects to the table top edge above the table mid-line', () => {
      const { head, table, inner, src } = tableFixture();
      const detector = detectorFor([head, table, inner, src]);

      detector.setSourceBlocks([src]);

      const result = detector.determineDropTarget(inner.holder, 370, 350, src);

      expect(result?.block).toBe(table);
      expect(result?.edge).toBe('top');
      expect(result?.parentId).toBeNull();
    });

    it('redirects to the table bottom edge below the table mid-line', () => {
      const { head, table, inner, src } = tableFixture();
      const detector = detectorFor([head, table, inner, src]);

      detector.setSourceBlocks([src]);

      const result = detector.determineDropTarget(inner.holder, 370, 450, src);

      expect(result?.block).toBe(table);
      expect(result?.edge).toBe('bottom');
    });

    it('treats the exact table mid-line as the bottom edge', () => {
      const { head, table, inner, src } = tableFixture();
      const detector = detectorFor([head, table, inner, src]);

      detector.setSourceBlocks([src]);

      expect(detector.determineDropTarget(inner.holder, 370, 400, src)?.edge).toBe('bottom');
    });

    it('returns no target when the cell container has no owning table holder', () => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const inner = makeBlock({ id: 'inner' });
      const src = makeBlock({ id: 'src', rect: { top: 600, bottom: 660, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const orphanCell = document.createElement('div');

      orphanCell.setAttribute('data-blok-table-cell-blocks', '');
      orphanCell.appendChild(inner.holder);
      document.body.appendChild(orphanCell);

      const detector = detectorFor([head, inner, src]);

      detector.setSourceBlocks([src]);

      expect(detector.determineDropTarget(inner.holder, 370, 350, src)).toBeNull();
    });
  });

  describe('toggle nesting', () => {
    const openToggle = (id: string): Block => {
      const toggle = makeBlock({ id, rect: { top: 300, bottom: 400, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const marker = document.createElement('div');

      marker.setAttribute('data-blok-toggle-open', 'true');
      toggle.holder.appendChild(marker);

      return toggle;
    };

    it('nests into an open toggle when no source blocks were registered', () => {
      const lead = makeBlock({ id: 'lead', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const toggle = openToggle('toggle');
      const detector = detectorFor([lead, toggle]);

      const result = detector.determineDropTarget(toggle.holder, 370, 380, lead);

      expect(result?.parentId).toBe('toggle');
      expect(result?.edge).toBe('bottom');
    });

    it('nests when only some of the dragged blocks are already toggle children', () => {
      const lead = makeBlock({ id: 'lead', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: CONTENT_RIGHT } });
      const toggle = openToggle('toggle');
      const childOfToggle = makeBlock({ id: 'child', parentId: 'toggle' });
      const outsider = makeBlock({ id: 'outsider' });
      const detector = detectorFor([lead, toggle, childOfToggle, outsider]);

      detector.setSourceBlocks([childOfToggle, outsider]);

      const result = detector.determineDropTarget(toggle.holder, 370, 380, childOfToggle);

      expect(result?.parentId).toBe('toggle');
    });
  });

  describe('target depth', () => {
    const pointerX = (depth: number): number => CONTENT_LEFT + depth * INDENT_PER_LEVEL;

    it('reads neighbours list-only when the dragged block is a list item', () => {
      // The indented paragraph is a nesting context for a generic reader but not
      // for the list-only reader, which is the one the list tool's drop uses.
      const indented = makeBlock({ id: 'indented', attrs: { 'data-blok-depth': '1' } });
      const target = makeBlock({ id: 'target' });
      const source = makeBlock({ id: 'source', name: 'list', attrs: { 'data-list-depth': '0' } });
      const detector = detectorFor([indented, target]);

      expect(detector.calculateTargetDepth(target, 'top', source, pointerX(2))).toBe(1);
    });

    it('keeps the first slot at root instead of wrapping to the last block', () => {
      const first = makeBlock({ id: 'first' });
      const last = makeBlock({ id: 'last', name: 'list', attrs: { 'data-list-depth': '0' } });
      const source = makeBlock({ id: 'source', name: 'list', attrs: { 'data-list-depth': '0' } });
      const detector = detectorFor([first, last]);

      expect(detector.calculateTargetDepth(first, 'top', source, pointerX(2))).toBe(0);
    });

    it('refuses an indent a plain paragraph predecessor cannot parent', () => {
      const plain = makeBlock({ id: 'plain' });
      const target = makeBlock({ id: 'target' });
      const source = makeBlock({ id: 'source', name: 'header' });
      const detector = detectorFor([plain, target]);

      expect(detector.calculateTargetDepth(target, 'top', source, pointerX(2))).toBe(0);
    });

    it('measures the full parent chain of the preceding blocks', () => {
      const outerList = makeBlock({ id: 'l1', name: 'list', attrs: { 'data-list-depth': '0' } });
      const innerList = makeBlock({ id: 'l2', name: 'list', parentId: 'l1', attrs: { 'data-list-depth': '1' } });
      const nestedPara = makeBlock({ id: 'p', parentId: 'l2', attrs: { 'data-blok-depth': '2' } });
      const target = makeBlock({ id: 'target' });
      const source = makeBlock({ id: 'source', name: 'header' });
      const detector = detectorFor([outerList, innerList, nestedPara, target]);

      // Depth 3 has no legal parent (the paragraph at depth 2 cannot adopt a
      // header), so the preview clamps onto the list item at depth 1.
      expect(detector.calculateTargetDepth(target, 'top', source, pointerX(3))).toBe(2);
    });

    it('survives a preceding block whose parent is not among the preceding blocks', () => {
      const container = makeBlock({ id: 'container', name: 'toggle' });
      const child = makeBlock({ id: 'child', parentId: 'container', attrs: { 'data-blok-depth': '1' } });
      const target = makeBlock({ id: 'target' });
      const detector = detectorFor([container, child, target]);

      // Dragging the container excludes it from the candidate set, so the child's
      // parent link dangles while its depth is measured.
      detector.setSourceBlocks([container]);

      expect(detector.calculateTargetDepth(target, 'top', container, pointerX(2))).toBe(0);
    });

    it('survives a parent cycle that runs through the measured block', () => {
      const one = makeBlock({ id: 'one', name: 'list', parentId: 'two', attrs: { 'data-list-depth': '1' } });
      const two = makeBlock({ id: 'two', name: 'list', parentId: 'one', attrs: { 'data-list-depth': '1' } });
      const target = makeBlock({ id: 'target' });
      const source = makeBlock({ id: 'source', name: 'header' });
      const detector = detectorFor([one, two, target]);

      expect(detector.calculateTargetDepth(target, 'top', source, pointerX(2))).toBe(2);
    });

    it('survives a parent cycle that excludes the measured block', () => {
      const far = makeBlock({ id: 'far', name: 'list', parentId: 'near', attrs: { 'data-list-depth': '1' } });
      const near = makeBlock({ id: 'near', name: 'list', parentId: 'far', attrs: { 'data-list-depth': '1' } });
      const leaf = makeBlock({ id: 'leaf', name: 'list', parentId: 'near', attrs: { 'data-list-depth': '2' } });
      const target = makeBlock({ id: 'target' });
      const source = makeBlock({ id: 'source', name: 'header' });
      const detector = detectorFor([far, near, leaf, target]);

      expect(detector.calculateTargetDepth(target, 'top', source, pointerX(3))).toBe(3);
    });
  });
});

describe('DropTargetDetector — side drops', () => {
  const CONTENT_LEFT = 120;
  let originalInnerWidth: number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const detectorFor = (blocks: Block[]): DropTargetDetector =>
    new DropTargetDetector(makeUI(CONTENT_LEFT), makeBlockManager(blocks));

  describe('standalone block', () => {
    /**
     * Holder spans the editor row (120..620) while the content box is the
     * narrow 400..520 — the two must not be interchangeable. Content height 100
     * gives a central band of 320..380; content width 120 puts the side-zone
     * floor (48) above the ratio (30), so the zones are x <= 448 and x >= 472.
     */
    const solo = (parentId: string | null = null): { head: Block; block: Block; src: Block } => ({
      head: makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 620 } }),
      block: makeBlock({
        id: 'solo',
        parentId,
        rect: { top: 300, bottom: 400, left: CONTENT_LEFT, right: 620 },
        contentRect: { top: 300, bottom: 400, left: 400, right: 520 },
      }),
      src: makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 620 } }),
    });

    it('still side-drops at exactly the 651px column breakpoint', () => {
      const { head, block, src } = solo();

      Object.defineProperty(window, 'innerWidth', { value: 651, writable: true, configurable: true });

      const result = detectorFor([head, block, src]).determineDropTarget(block.holder, 430, 350, src);

      expect(result?.edge).toBe('left');
    });

    it('side-drops on the exact top edge of the central band', () => {
      const { head, block, src } = solo();

      expect(detectorFor([head, block, src]).determineDropTarget(block.holder, 430, 320, src)?.edge).toBe('left');
    });

    it('side-drops on the exact bottom edge of the central band', () => {
      const { head, block, src } = solo();

      expect(detectorFor([head, block, src]).determineDropTarget(block.holder, 430, 380, src)?.edge).toBe('left');
    });

    it('reorders instead of side-dropping below the central band', () => {
      const { head, block, src } = solo();
      const result = detectorFor([head, block, src]).determineDropTarget(block.holder, 430, 400, src);

      expect(result?.block).toBe(block);
      expect(result?.edge).toBe('bottom');
    });

    it('side-drops on the exact inner boundary of the left zone', () => {
      const { head, block, src } = solo();

      expect(detectorFor([head, block, src]).determineDropTarget(block.holder, 448, 350, src)?.edge).toBe('left');
    });

    it('side-drops on the exact inner boundary of the right zone', () => {
      const { head, block, src } = solo();

      expect(detectorFor([head, block, src]).determineDropTarget(block.holder, 472, 350, src)?.edge).toBe('right');
    });

    it('reports no enclosing column when the ancestor chain holds none', () => {
      const { head, block, src } = solo('wrap');
      const wrap = makeBlock({ id: 'wrap', name: 'toggle' });
      const result = detectorFor([head, wrap, block, src]).determineDropTarget(block.holder, 430, 350, src);

      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBeNull();
    });

    it('reports no enclosing column when the parent id resolves to nothing', () => {
      const { head, block, src } = solo('missing');
      const result = detectorFor([head, block, src]).determineDropTarget(block.holder, 430, 350, src);

      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBeNull();
    });
  });

  describe('block inside a column', () => {
    interface ColumnsFixture {
      head: Block;
      list: Block;
      colA: Block;
      first: Block;
      colB: Block;
      last: Block;
      src: Block;
      row: HTMLElement;
    }

    /**
     * head, then a column_list of two columns: first child at content x 400..520,
     * last child at 600..720 — both 100 tall (band 320..380) with a side-zone
     * floor of 48 (zones x <= left+48 and x >= right-48).
     *
     * The row also carries a decorative element before the first column holder
     * and after the last one. Only [data-blok-element] siblings are columns, so
     * neither may make the first column look preceded or the last look followed.
     */
    const columns = (): ColumnsFixture => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 760 } });
      const list = makeBlock({ id: 'list', name: 'column_list', rect: { top: 290, bottom: 460, left: CONTENT_LEFT, right: 760 } });
      const colA = makeBlock({ id: 'colA', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 380, right: 540 } });
      const first = makeBlock({
        id: 'first',
        parentId: 'colA',
        rect: { top: 300, bottom: 400, left: 400, right: 520 },
        contentRect: { top: 300, bottom: 400, left: 400, right: 520 },
      });
      const colB = makeBlock({ id: 'colB', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 580, right: 740 } });
      const last = makeBlock({
        id: 'last',
        parentId: 'colB',
        rect: { top: 300, bottom: 400, left: 600, right: 720 },
        contentRect: { top: 300, bottom: 400, left: 600, right: 720 },
      });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });

      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');

      const wrapA = document.createElement('div');

      wrapA.setAttribute('data-blok-column', '');
      wrapA.appendChild(first.holder);
      colA.holder.appendChild(wrapA);

      const wrapB = document.createElement('div');

      wrapB.setAttribute('data-blok-column', '');
      wrapB.appendChild(last.holder);
      colB.holder.appendChild(wrapB);

      const leadOrnament = document.createElement('div');
      const trailOrnament = document.createElement('div');
      const resizer = document.createElement('div');

      resizer.setAttribute('data-blok-column-resizer', '');
      row.append(leadOrnament, colA.holder, resizer, colB.holder, trailOrnament);
      list.holder.appendChild(row);
      document.body.appendChild(list.holder);

      return { head, list, colA, first, colB, last, src, row };
    };

    const blocksOf = (fixture: ColumnsFixture): Block[] =>
      [fixture.head, fixture.list, fixture.colA, fixture.first, fixture.colB, fixture.last, fixture.src];

    it('side-drops on the row outer left edge at the top of the central band', () => {
      const fixture = columns();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 430, 320, fixture.src);

      expect(result?.block).toBe(fixture.first);
      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBe('colA');
    });

    it('side-drops on the row outer left edge at the bottom of the central band', () => {
      const fixture = columns();

      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 430, 380, fixture.src)?.edge
      ).toBe('left');
    });

    it('reorders instead of side-dropping above the central band', () => {
      const fixture = columns();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 430, 300, fixture.src);

      expect(result?.block).toBe(fixture.first);
      expect(result?.edge).toBe('top');
    });

    it('reorders instead of side-dropping below the central band', () => {
      const fixture = columns();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 430, 400, fixture.src);

      expect(result?.block).toBe(fixture.first);
      expect(result?.edge).toBe('bottom');
    });

    it('keeps the side zone at its pixel floor on a narrow column', () => {
      const fixture = columns();

      // 440 is inside the 48px floor but outside the 25%-of-120 ratio zone.
      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 440, 350, fixture.src)?.edge
      ).toBe('left');
    });

    it('side-drops on the exact inner boundary of the column left zone', () => {
      const fixture = columns();

      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.first.holder, 448, 350, fixture.src)?.edge
      ).toBe('left');
    });

    it('side-drops on the exact inner boundary of the last column right zone', () => {
      const fixture = columns();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.last.holder, 672, 350, fixture.src);

      expect(result?.block).toBe(fixture.last);
      expect(result?.edge).toBe('right');
      expect(result?.parentId).toBe('colB');
    });

    it('reorders a block that sits in the columns row without a column wrapper', () => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 760 } });
      const stray = makeBlock({
        id: 'stray',
        rect: { top: 300, bottom: 400, left: 400, right: 520 },
        contentRect: { top: 300, bottom: 400, left: 400, right: 520 },
      });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });
      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');
      row.appendChild(stray.holder);
      document.body.appendChild(row);

      const detector = detectorFor([head, stray, src]);

      expect(detector.determineDropTarget(stray.holder, 430, 350, src)?.edge).toBe('bottom');
      expect(detector.determineDropTarget(stray.holder, 500, 350, src)?.edge).toBe('bottom');
    });
  });
});

describe('DropTargetDetector — column layouts', () => {
  const CONTENT_LEFT = 120;
  let originalInnerWidth: number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const detectorFor = (blocks: Block[]): DropTargetDetector =>
    new DropTargetDetector(makeUI(CONTENT_LEFT), makeBlockManager(blocks));

  const columnWrapper = (holder: HTMLElement, ...children: HTMLElement[]): HTMLElement => {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-column', '');
    wrapper.append(...children);
    holder.appendChild(wrapper);

    return wrapper;
  };

  describe('outer margin beside a whole column_list', () => {
    interface OuterFixture {
      head: Block;
      list: Block;
      colA: Block;
      colB: Block;
      firstChild: Block | null;
      lastChild: Block;
      src: Block;
    }

    /**
     * The column_list carries its OWN content box (300..400, x 400..520): band
     * 320..380, side zones x <= 448 and x >= 472. Its column children carry no
     * content box, so the list's box is unambiguous.
     */
    const outer = (options: { emptyFirstColumn?: boolean } = {}): OuterFixture => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 760 } });
      const list = makeBlock({
        id: 'list',
        name: 'column_list',
        rect: { top: 290, bottom: 460, left: CONTENT_LEFT, right: 760 },
        contentRect: { top: 300, bottom: 400, left: 400, right: 520 },
      });
      const colA = makeBlock({ id: 'colA', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 380, right: 540 } });
      const colB = makeBlock({ id: 'colB', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 580, right: 740 } });
      const firstChild = options.emptyFirstColumn === true
        ? null
        : makeBlock({ id: 'firstChild', parentId: 'colA', rect: { top: 300, bottom: 400, left: 400, right: 520 } });
      const lastChild = makeBlock({ id: 'lastChild', parentId: 'colB', rect: { top: 300, bottom: 400, left: 600, right: 720 } });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });

      if (firstChild !== null) {
        columnWrapper(colA.holder, firstChild.holder);
      }
      columnWrapper(colB.holder, lastChild.holder);

      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');
      row.append(colA.holder, colB.holder);
      list.holder.appendChild(row);
      document.body.appendChild(list.holder);

      return { head, list, colA, colB, firstChild, lastChild, src };
    };

    const blocksOf = (fixture: OuterFixture): Block[] => [
      fixture.head,
      fixture.list,
      fixture.colA,
      ...(fixture.firstChild === null ? [] : [fixture.firstChild]),
      fixture.colB,
      fixture.lastChild,
      fixture.src,
    ];

    it('prepends a column from the left margin at the top of the central band', () => {
      const fixture = outer();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 430, 320, fixture.src);

      expect(result?.block).toBe(fixture.firstChild);
      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBe('colA');
    });

    it('prepends a column from the left margin at the bottom of the central band', () => {
      const fixture = outer();

      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 430, 380, fixture.src)?.edge
      ).toBe('left');
    });

    it('reorders the whole list below the central band', () => {
      const fixture = outer();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 430, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
    });

    it('keeps the list side zone at its pixel floor', () => {
      const fixture = outer();

      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 440, 350, fixture.src)?.edge
      ).toBe('left');
    });

    it('prepends on the exact inner boundary of the left margin zone', () => {
      const fixture = outer();

      expect(
        detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 448, 350, fixture.src)?.edge
      ).toBe('left');
    });

    it('appends a column from the right margin on its exact inner boundary', () => {
      const fixture = outer();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 472, 350, fixture.src);

      expect(result?.block).toBe(fixture.lastChild);
      expect(result?.edge).toBe('right');
      expect(result?.parentId).toBe('colB');
    });

    it('reorders from the central band between the two margin zones', () => {
      const fixture = outer();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 460, 350, fixture.src);

      expect(result?.block).toBe(fixture.head);
      expect(result?.edge).toBe('bottom');
    });

    it('reorders instead of prepending when the first column has no child block', () => {
      const fixture = outer({ emptyFirstColumn: true });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.list.holder, 430, 350, fixture.src);

      expect(result?.block).toBe(fixture.head);
      expect(result?.edge).toBe('bottom');
    });
  });

  describe('empty space below a column', () => {
    interface BelowFixture {
      head: Block;
      list: Block;
      column: Block;
      child: Block;
      src: Block;
      emptyZone: HTMLElement;
    }

    /** Column holder 290..460 but its only child's content ends at 340. */
    const below = (columnParentId: string | null = 'list'): BelowFixture => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 760 } });
      const list = makeBlock({ id: 'list', name: 'column_list', rect: { top: 290, bottom: 460, left: CONTENT_LEFT, right: 760 } });
      const column = makeBlock({ id: 'column', name: 'column', parentId: columnParentId, rect: { top: 290, bottom: 460, left: 380, right: 540 } });
      const child = makeBlock({
        id: 'child',
        parentId: 'column',
        rect: { top: 300, bottom: 340, left: 400, right: 520 },
        contentRect: { top: 300, bottom: 340, left: 400, right: 520 },
      });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });
      const emptyZone = document.createElement('div');
      const wrapper = columnWrapper(column.holder, child.holder);

      wrapper.appendChild(emptyZone);

      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');
      row.appendChild(column.holder);
      list.holder.appendChild(row);
      document.body.appendChild(list.holder);

      return { head, list, column, child, src, emptyZone };
    };

    const blocksOf = (fixture: BelowFixture): Block[] =>
      [fixture.head, fixture.list, fixture.column, fixture.child, fixture.src];

    it('stacks into the column when the cursor is still over its content', () => {
      const fixture = below();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.emptyZone, 460, 330, fixture.src);

      expect(result?.block).toBe(fixture.child);
      expect(result?.edge).toBe('bottom');
    });

    it('stacks into the column on the exact bottom of its content', () => {
      const fixture = below();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.emptyZone, 460, 340, fixture.src);

      expect(result?.block).toBe(fixture.child);
      expect(result?.edge).toBe('bottom');
    });

    it('drops below the whole column_list from the dead space under the column', () => {
      const fixture = below();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.emptyZone, 460, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
      expect(result?.parentId).toBeNull();
    });

    it('stacks into the column when its column_list parent cannot be resolved', () => {
      const fixture = below('gone');
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.emptyZone, 460, 400, fixture.src);

      expect(result?.block).toBe(fixture.child);
      expect(result?.edge).toBe('bottom');
    });

    it('never targets the column_list that is itself being dragged', () => {
      const fixture = below();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.emptyZone, 460, 400, fixture.list);

      expect(result?.block).toBe(fixture.child);
    });

    it('drops below the column_list from an empty column that starts above the viewport', () => {
      const head = makeBlock({ id: 'head', rect: { top: -200, bottom: -140, left: CONTENT_LEFT, right: 760 } });
      const list = makeBlock({ id: 'list', name: 'column_list', rect: { top: -40, bottom: 60, left: CONTENT_LEFT, right: 760 } });
      const column = makeBlock({ id: 'column', name: 'column', parentId: 'list', rect: { top: -40, bottom: 60, left: 380, right: 540 } });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });
      const emptyZone = document.createElement('div');

      columnWrapper(column.holder, emptyZone);

      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');
      row.appendChild(column.holder);
      list.holder.appendChild(row);
      document.body.appendChild(list.holder);

      const result = detectorFor([head, list, column, src]).determineDropTarget(emptyZone, 460, 0, src);

      expect(result?.block).toBe(list);
      expect(result?.edge).toBe('bottom');
    });
  });

  describe('inter-column gutter', () => {
    interface GutterOptions {
      leftChildParentId?: string | null;
      rightChildParentId?: string | null;
      rightSibling?: 'column' | 'ghost' | 'none' | 'empty-column';
    }

    interface GutterFixture {
      head: Block;
      list: Block;
      colA: Block;
      leftChild: Block;
      colB: Block;
      rightChild: Block;
      src: Block;
      resizer: HTMLElement;
    }

    /**
     * Left column content ends at 340, right at 380 — different on purpose, so
     * "below the shorter column" has one unambiguous answer. Neither child owns
     * a content box, which keeps the column_list's own rect the one measured on
     * the fall-through path.
     */
    const gutter = (options: GutterOptions = {}): GutterFixture => {
      const head = makeBlock({ id: 'head', rect: { top: 200, bottom: 260, left: CONTENT_LEFT, right: 760 } });
      const list = makeBlock({ id: 'list', name: 'column_list', rect: { top: 290, bottom: 460, left: CONTENT_LEFT, right: 760 } });
      const colA = makeBlock({ id: 'colA', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 380, right: 540 } });
      const leftChild = makeBlock({
        id: 'leftChild',
        parentId: options.leftChildParentId === undefined ? 'colA' : options.leftChildParentId,
        rect: { top: 300, bottom: 340, left: 400, right: 520 },
      });
      const colB = makeBlock({ id: 'colB', name: 'column', parentId: 'list', rect: { top: 290, bottom: 460, left: 580, right: 740 } });
      const rightChild = makeBlock({
        id: 'rightChild',
        parentId: options.rightChildParentId === undefined ? 'colB' : options.rightChildParentId,
        rect: { top: 300, bottom: 380, left: 600, right: 720 },
      });
      const src = makeBlock({ id: 'src', rect: { top: 500, bottom: 560, left: CONTENT_LEFT, right: 760 } });

      columnWrapper(colA.holder, leftChild.holder);

      const resizer = document.createElement('div');

      resizer.setAttribute('data-blok-column-resizer', '');

      const row = document.createElement('div');

      row.setAttribute('data-blok-columns', '');
      row.append(colA.holder, resizer);

      const sibling = options.rightSibling ?? 'column';

      if (sibling === 'column') {
        columnWrapper(colB.holder, rightChild.holder);
        row.appendChild(colB.holder);
      } else if (sibling === 'empty-column') {
        row.appendChild(colB.holder);
      } else if (sibling === 'ghost') {
        const ghost = document.createElement('div');

        ghost.setAttribute(DATA_ATTR.element, 'block');
        row.appendChild(ghost);
      }

      list.holder.appendChild(row);
      document.body.appendChild(list.holder);

      return { head, list, colA, leftChild, colB, rightChild, src, resizer };
    };

    const blocksOf = (fixture: GutterFixture): Block[] =>
      [fixture.head, fixture.list, fixture.colA, fixture.leftChild, fixture.colB, fixture.rightChild, fixture.src];

    it('inserts a column between the two the separator divides', () => {
      const fixture = gutter();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 320, fixture.src);

      expect(result?.block).toBe(fixture.rightChild);
      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBe('colB');
    });

    it('still routes a gutter drop at exactly the 651px breakpoint', () => {
      const fixture = gutter();

      Object.defineProperty(window, 'innerWidth', { value: 651, writable: true, configurable: true });

      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 320, fixture.src);

      expect(result?.block).toBe(fixture.rightChild);
      expect(result?.edge).toBe('left');
    });

    it('is still a between-columns insert on the exact bottom of the shorter column', () => {
      const fixture = gutter();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 340, fixture.src);

      expect(result?.block).toBe(fixture.rightChild);
      expect(result?.edge).toBe('left');
    });

    it('drops below the column_list from the dead strip under the shorter column', () => {
      const fixture = gutter();
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
      expect(result?.parentId).toBeNull();
    });

    it('inserts between columns when the left column has no registered child', () => {
      const fixture = gutter({ leftChildParentId: null });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 400, fixture.src);

      expect(result?.block).toBe(fixture.rightChild);
      expect(result?.edge).toBe('left');
    });

    it('inserts between columns when the right column has no registered child', () => {
      const fixture = gutter({ rightChildParentId: null });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 560, 400, fixture.src);

      expect(result?.block).toBe(fixture.rightChild);
      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBeNull();
    });

    it('falls through when the element after the separator owns no block', () => {
      const fixture = gutter({ rightSibling: 'ghost' });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 440, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
    });

    it('falls through when no column follows the separator at all', () => {
      const fixture = gutter({ rightSibling: 'none' });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 440, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
    });

    it('falls through when the right column holds no block holder', () => {
      const fixture = gutter({ rightSibling: 'empty-column', rightChildParentId: null });
      const result = detectorFor(blocksOf(fixture)).determineDropTarget(fixture.resizer, 440, 400, fixture.src);

      expect(result?.block).toBe(fixture.list);
      expect(result?.edge).toBe('bottom');
    });

    it('falls through when the between-columns target is the block being dragged', () => {
      const fixture = gutter();
      const detector = detectorFor(blocksOf(fixture));

      detector.setSourceBlocks([fixture.rightChild]);

      const result = detector.determineDropTarget(fixture.resizer, 560, 320, fixture.rightChild);

      expect(result?.block).toBe(fixture.head);
      expect(result?.edge).toBe('bottom');
    });
  });
});
