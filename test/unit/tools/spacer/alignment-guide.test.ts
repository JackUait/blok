import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findSnapTarget,
  collectSiblingBlockEdges,
  AlignmentGuide,
  SNAP_THRESHOLD,
} from '../../../../src/tools/spacer/alignment-guide';

const stubRect = (el: HTMLElement, rect: Partial<DOMRect>): void => {
  const value = Object.assign(
    { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) },
    rect
  ) as DOMRect;

  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => value,
  });
};

/**
 * Append a block holder to a column. Defaults to a paragraph carrying text, so
 * callers only spell out what matters to their case.
 */
const addBlock = (
  column: HTMLElement,
  options: { bottom: number; top?: number; component?: string; text?: string; html?: string }
): void => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-component', options.component ?? 'paragraph');

  if (options.html !== undefined) {
    holder.innerHTML = options.html;
  } else {
    holder.textContent = options.text ?? 'Block text';
  }

  // Blocks stack flush, so a block's top is the previous block's bottom. Default
  // to a 40px-tall block when a caller only cares about the bottom.
  stubRect(holder, { top: options.top ?? options.bottom - 40, bottom: options.bottom });
  column.appendChild(holder);
};

/**
 * Build a column-list DOM:
 *   [data-blok-columns]
 *     [data-blok-column] (left)  with block holders at given bottoms
 *     [data-blok-column] (right) containing the spacer
 */
const buildColumns = (
  leftBlockBottoms: number[]
): { spacer: HTMLElement; columns: HTMLElement; siblingColumn: HTMLElement } => {
  const columns = document.createElement('div');

  columns.setAttribute('data-blok-columns', '');
  stubRect(columns, { left: 10, right: 610, width: 600 });

  const left = document.createElement('div');

  left.setAttribute('data-blok-column', '');
  leftBlockBottoms.forEach((bottom) => addBlock(left, { bottom }));

  const right = document.createElement('div');

  right.setAttribute('data-blok-column', '');
  const rightHolder = document.createElement('div');

  rightHolder.setAttribute('data-blok-element', '');
  const spacer = document.createElement('div');

  spacer.setAttribute('data-blok-spacer', '');
  rightHolder.appendChild(spacer);
  right.appendChild(rightHolder);

  columns.appendChild(left);
  columns.appendChild(right);
  document.body.appendChild(columns);

  return { spacer, columns, siblingColumn: left };
};

describe('spacer alignment guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('findSnapTarget()', () => {
    it('returns the nearest target within the threshold', () => {
      expect(findSnapTarget(100, [50, 102, 200])).toBe(102);
    });

    it('returns null when no target is within the threshold', () => {
      expect(findSnapTarget(100, [50, 100 + SNAP_THRESHOLD + 1, 200])).toBeNull();
    });

    it('prefers the closest of several in-range targets', () => {
      expect(findSnapTarget(100, [103, 99])).toBe(99);
    });

    it('returns null for an empty target list', () => {
      expect(findSnapTarget(100, [])).toBeNull();
    });
  });

  describe('collectSiblingBlockEdges()', () => {
    it('offers both edges of block holders in the OTHER columns only', () => {
      const { spacer } = buildColumns([120, 260]);

      // Blocks stubbed 40px tall: 80–120 and 220–260.
      expect(collectSiblingBlockEdges(spacer)).toEqual([80, 120, 220, 260]);
    });

    it('returns empty when the spacer is not inside a column', () => {
      const spacer = document.createElement('div');

      spacer.setAttribute('data-blok-spacer', '');
      document.body.appendChild(spacer);

      expect(collectSiblingBlockEdges(spacer)).toEqual([]);
    });

    it('offers the top of a visible block buried under empty paragraphs', () => {
      const { spacer, siblingColumn } = buildColumns([]);

      // The shape of a column a user padded out by pressing Enter: two empty
      // paragraphs, then the real content. The content's top edge (260) is only
      // reachable through the empty block above it, so dropping empty blocks
      // outright would leave the visible paragraph with no top to align to.
      addBlock(siblingColumn, { top: 182, bottom: 220, text: '' });
      addBlock(siblingColumn, { top: 221, bottom: 259, text: '' });
      addBlock(siblingColumn, { top: 260, bottom: 346, text: 'Every column can hold any block.' });

      expect(collectSiblingBlockEdges(spacer)).toEqual([260, 346]);
    });

    it('skips a trailing empty text block — it has no visible edge to align with', () => {
      const { spacer, siblingColumn } = buildColumns([]);

      addBlock(siblingColumn, { top: 80, bottom: 120, text: 'Real text.' });
      // A trailing empty paragraph, as left behind by pressing Enter. Its top is
      // the real block's bottom (already offered); its own bottom is nothing.
      addBlock(siblingColumn, { top: 120, bottom: 158, text: '' });

      expect(collectSiblingBlockEdges(spacer)).toEqual([80, 120]);
    });

    it('skips empty text blocks holding only whitespace or a <br>', () => {
      const { spacer, siblingColumn } = buildColumns([]);

      addBlock(siblingColumn, { top: 160, bottom: 200, component: 'paragraph', html: '<br>' });
      addBlock(siblingColumn, { top: 260, bottom: 300, component: 'header', text: '   ' });
      addBlock(siblingColumn, { top: 360, bottom: 400, component: 'quote', text: '' });

      expect(collectSiblingBlockEdges(spacer)).toEqual([]);
    });

    it('keeps text blocks that actually have text', () => {
      const { spacer, siblingColumn } = buildColumns([]);

      addBlock(siblingColumn, { top: 160, bottom: 200, component: 'paragraph', text: 'Real text.' });
      addBlock(siblingColumn, { top: 260, bottom: 300, component: 'header', text: 'Title' });

      expect(collectSiblingBlockEdges(spacer)).toEqual([160, 200, 260, 300]);
    });

    it('keeps non-text blocks that legitimately render no text', () => {
      const { spacer, siblingColumn } = buildColumns([]);

      // A divider, an image and a spacer are textless but visible — their edges
      // are real alignment targets.
      addBlock(siblingColumn, { top: 160, bottom: 200, component: 'divider', text: '' });
      addBlock(siblingColumn, { top: 260, bottom: 300, component: 'image', text: '' });
      addBlock(siblingColumn, { top: 360, bottom: 400, component: 'spacer', text: '' });

      expect(collectSiblingBlockEdges(spacer)).toEqual([160, 200, 260, 300, 360, 400]);
    });
  });

  describe('AlignmentGuide', () => {
    it('show() renders a fixed guideline spanning the columns at the given y', () => {
      const { spacer, columns } = buildColumns([120]);
      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);

      const line = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

      expect(line).not.toBeNull();
      expect(line?.style.position).toBe('fixed');
      expect(line?.style.top).toBe('119px');
      expect(line?.style.left).toBe('10px');
      expect(line?.style.width).toBe('600px');
      // Decorative — must not steal pointer events mid-drag.
      expect(line?.getAttribute('aria-hidden')).toBe('true');
      expect(spacer.isConnected).toBe(true);

      guide.hide();
    });

    it('resolves the accent color against the editor scope, not body', () => {
      // The guide lives on document.body, where the editor's scoped
      // --blok-* custom properties do NOT cascade — a raw var() reference
      // would resolve to nothing and render an invisible line.
      const { columns } = buildColumns([120]);

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: (prop: string) => (prop === '--blok-color-accent' ? ' #2383e2 ' : ''),
      } as unknown as CSSStyleDeclaration);

      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);

      const line = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

      expect(line?.style.backgroundColor).toBe('rgb(35, 131, 226)');
      expect(line?.style.background).not.toContain('var(');

      guide.hide();
    });

    it('falls back to a literal accent when the scope resolves nothing', () => {
      const { columns } = buildColumns([120]);

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        getPropertyValue: () => '',
      } as unknown as CSSStyleDeclaration);

      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);

      const line = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

      expect(line?.style.backgroundColor).not.toBe('');
      expect(line?.style.background).not.toContain('var(');

      guide.hide();
    });

    it('uses a numeric z-index (scoped z tokens do not cascade to body)', () => {
      const { columns } = buildColumns([120]);
      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);

      const line = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

      expect(line?.style.zIndex).toMatch(/^\d+$/);

      guide.hide();
    });

    it('show() twice reuses a single guideline element', () => {
      const { columns } = buildColumns([120]);
      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);
      guide.show(260, columns.getBoundingClientRect(), columns);

      expect(document.querySelectorAll('[data-blok-spacer-guide]')).toHaveLength(1);
      expect(document.querySelector<HTMLElement>('[data-blok-spacer-guide]')?.style.top).toBe('259px');

      guide.hide();
    });

    it('hide() removes the guideline from the document', () => {
      const { columns } = buildColumns([120]);
      const guide = new AlignmentGuide();

      guide.show(120, columns.getBoundingClientRect(), columns);
      guide.hide();

      expect(document.querySelector('[data-blok-spacer-guide]')).toBeNull();
    });
  });
});
