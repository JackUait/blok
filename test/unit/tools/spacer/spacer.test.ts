import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { SpacerData } from '../../../../src/tools/spacer/types';

const createMockAPI = (): API =>
  ({
    styles: {
      block: 'ce-block',
      inlineToolbar: '',
      inlineToolButton: '',
      inlineToolButtonActive: '',
      settingsButton: '',
      settingsButtonActive: '',
      selected: '',
    },
    i18n: { t: (k: string) => k },
  }) as unknown as API;

const createOptions = (
  data: Partial<SpacerData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<SpacerData> => ({
  data: { ...data } as SpacerData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'spacer-block-id' } as never,
});

const getGrip = (el: HTMLElement, edge: 'top' | 'bottom' = 'bottom'): HTMLElement | null =>
  el.querySelector(`[data-blok-spacer-grip="${edge}"]`);

const getGrips = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.querySelectorAll('[data-blok-spacer-grip]'));

/**
 * How far the fake page is scrolled. Rects below are authored in document
 * coordinates and read through this, so a scroll shifts the whole viewport frame
 * at once while the layout underneath stays put — exactly as in a browser.
 */
let manualScroll = 0;

/**
 * Scroll the fake page, as the user (or the browser) may do mid-gesture
 *
 * @param by - pixels to scroll down by
 */
const scrollPage = (by: number): void => {
  manualScroll += by;
};

/**
 * Extra scroll the browser applies on its own; see mountInColumns
 */
let anchorScroll = (): number => 0;

const pageScroll = (): number => manualScroll + anchorScroll();

/**
 * Stub a rect that is recomputed on every read, so it answers with the page's
 * current scroll instead of a value frozen at mount time.
 *
 * @param el - element to stub
 * @param box - the element's layout box, in document coordinates
 */
const stubLiveRect = (el: HTMLElement, box: () => Partial<DOMRect>): void => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const doc = box();

      return Object.assign(
        { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) },
        doc,
        { top: (doc.top ?? 0) - pageScroll(), bottom: (doc.bottom ?? 0) - pageScroll() }
      ) as DOMRect;
    },
  });
};

/**
 * Put the rendered spacer into the right column of a two-column list whose left
 * column holds blocks ending at the given document bottoms. The column list sits
 * at document y=0 and the spacer's own top is pinned at y=100 — a block's top is
 * fixed by flow, so resizing only ever pushes its bottom down.
 *
 * With `scrollAnchoredBelow`, the mount also models what the browser does when the
 * spacer has a block under it: that block becomes the scroll anchor, so growing the
 * gap scrolls the page by the growth to hold the block still on screen.
 *
 * @param spacerElement - the rendered spacer wrapper
 * @param siblingBlockBottoms - document bottoms of the left column's blocks
 * @param options - opt into the scroll-anchoring behaviour described above
 */
const mountInColumns = (
  spacerElement: HTMLElement,
  siblingBlockBottoms: number[],
  options: { scrollAnchoredBelow?: boolean } = {}
): void => {
  manualScroll = 0;

  const height = (): number => parseInt(spacerElement.style.height, 10);
  const startHeight = height();

  anchorScroll = options.scrollAnchoredBelow === true ? () => height() - startHeight : () => 0;

  const columns = document.createElement('div');

  columns.setAttribute('data-blok-columns', '');
  stubLiveRect(columns, () => ({ top: 0, left: 10, right: 610, width: 600 }));

  const left = document.createElement('div');

  left.setAttribute('data-blok-column', '');
  siblingBlockBottoms.forEach((bottom) => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    // Blocks stack flush; 40px tall, so both edges are real alignment targets.
    stubLiveRect(holder, () => ({ top: bottom - 40, bottom }));
    left.appendChild(holder);
  });

  const right = document.createElement('div');

  right.setAttribute('data-blok-column', '');
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  stubLiveRect(spacerElement, () => ({ top: 100, bottom: 100 + height() }));
  holder.appendChild(spacerElement);
  right.appendChild(holder);

  columns.appendChild(left);
  columns.appendChild(right);
  document.body.appendChild(columns);
};

describe('SpacerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('render()', () => {
    it('returns a wrapper div marked with data-blok-spacer', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLDivElement);
      expect(el.hasAttribute('data-blok-spacer')).toBe(true);
    });

    it('applies the stored height as an inline style', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }));
      const el = tool.render();

      expect(el.style.height).toBe('64px');
    });

    it('defaults to 38px (one Text block) when no height is stored', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.style.height).toBe('38px');
    });

    it('clamps stored height below the minimum up to the Text block height (38px)', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 2 }));
      const el = tool.render();

      expect(el.style.height).toBe('38px');
    });

    it('clamps stored height above the maximum down to 600px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 9999 }));
      const el = tool.render();

      expect(el.style.height).toBe('600px');
    });

    it('has no contentEditable elements', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.querySelectorAll('[contenteditable="true"]')).toHaveLength(0);
    });

    it('renders grips on both the top and bottom edges', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();

      expect(getGrip(el, 'top')).not.toBeNull();
      expect(getGrip(el, 'bottom')).not.toBeNull();
    });

    it('renders focusable resize grips with separator semantics', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();

      for (const grip of getGrips(el)) {
        expect(grip.getAttribute('role')).toBe('separator');
        expect(grip.getAttribute('aria-orientation')).toBe('horizontal');
        expect(grip.getAttribute('tabindex')).toBe('0');
        expect(grip.getAttribute('aria-label')).toBe('tools.spacer.resizeAriaLabel');
        expect(grip.getAttribute('aria-valuemin')).toBe('38');
        expect(grip.getAttribute('aria-valuemax')).toBe('600');
        expect(grip.getAttribute('aria-valuenow')).toBe('40');
      }
    });
  });

  describe('hover affordances', () => {
    it('marks the block boundary with a dashed accent-blue outline on hover', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.className).toContain('hover:outline-dashed');
      expect(el.className).toContain('hover:outline-(--blok-color-accent)');
    });

    it('grip zones advertise dragging: resize cursor + accent pill on direct hover', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      for (const grip of getGrips(el)) {
        expect(grip.className).toContain('cursor-ns-resize');
        expect(grip.className).toContain('after:bg-(--blok-color-accent)');
        expect(grip.className).toContain('hover:after:w-14');
      }
    });

    it('the pill is a capsule straddling its edge with a surface ring and shadow', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      for (const grip of getGrips(el)) {
        expect(grip.className).toContain('after:h-2.5');
        expect(grip.className).toContain('after:border-2');
        expect(grip.className).toContain('after:border-popover-bg');
        expect(grip.className).toContain('after:shadow-sm');
      }
      // Centered ON the dashed line: each pill shifts half out of its edge.
      expect(getGrip(el, 'bottom')?.className).toContain('after:translate-y-1/2');
      expect(getGrip(el, 'top')?.className).toContain('after:-translate-y-1/2');
    });

    it('renders a px readout that reflects the stored height', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }));
      const el = tool.render();
      const readout = el.querySelector('[data-blok-spacer-readout]');

      expect(readout).not.toBeNull();
      expect(readout?.textContent).toBe('64px');
      // Decorative — the grip's aria-valuenow is the accessible value.
      expect(readout?.getAttribute('aria-hidden')).toBe('true');
    });

    it('updates the readout when the height changes', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.querySelector('[data-blok-spacer-readout]')?.textContent).toBe('56px');
    });

    it('renders no readout in read-only mode', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }, { readOnly: true }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-spacer-readout]')).toBeNull();
    });

    it('setReadOnly toggles the readout together with the grip', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }));
      const el = tool.render();

      tool.setReadOnly(true);
      expect(el.querySelector('[data-blok-spacer-readout]')).toBeNull();

      tool.setReadOnly(false);
      expect(el.querySelector('[data-blok-spacer-readout]')?.textContent).toBe('64px');
    });
  });

  describe('fresh-insert reveal', () => {
    it('a spacer constructed without a stored height reveals its affordances', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(true);
      // Outline is shown outright, not hover-gated.
      expect(el.className).toContain('outline-dashed');
      for (const grip of getGrips(el)) {
        expect(grip.className).toContain('opacity-100');
      }
      expect(el.querySelector('[data-blok-spacer-readout]')?.className).toContain('opacity-100');
    });

    it('a spacer constructed with a stored height is not revealed', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }));
      const el = tool.render();

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(false);
      for (const grip of getGrips(el)) {
        expect(grip.className).not.toContain(' opacity-100');
      }
    });

    it('clicking elsewhere dismisses the reveal back to hover-gated chrome', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(true);
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(false);
      for (const grip of getGrips(el)) {
        expect(grip.className).not.toContain(' opacity-100');
      }
      // Hover affordances stay intact after dismissal.
      expect(el.className).toContain('hover:outline-dashed');
      expect(el.querySelector('[data-blok-spacer-readout]')).not.toBeNull();
    });

    it('typing dismisses the reveal', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(false);
    });

    it('read-only spacers are never revealed', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({}, { readOnly: true }));
      const el = tool.render();

      expect(el.hasAttribute('data-blok-spacer-fresh')).toBe(false);
    });
  });

  describe('save()', () => {
    it('returns the current height', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 96 }));

      tool.render();

      expect(tool.save()).toEqual({ height: 96 });
    });

    it('returns the default height when constructed without data', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());

      tool.render();

      expect(tool.save()).toEqual({ height: 38 });
    });
  });

  describe('validate()', () => {
    it('always returns true', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());

      expect(tool.validate({} as SpacerData)).toBe(true);
    });
  });

  describe('keyboard resize', () => {
    it('ArrowDown on the bottom grip grows the height by 8px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.style.height).toBe('56px');
      expect(grip.getAttribute('aria-valuenow')).toBe('56');
    });

    it('ArrowUp on the bottom grip shrinks the height by 8px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 56 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(el.style.height).toBe('48px');
    });

    it('ArrowUp on the top grip grows the height by 8px (edge moves up)', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el, 'top')!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(el.style.height).toBe('56px');
    });

    it('ArrowDown on the top grip shrinks the height by 8px (edge moves down)', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 56 }));
      const el = tool.render();
      const grip = getGrip(el, 'top')!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.style.height).toBe('48px');
    });

    it('never shrinks below the 38px minimum', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 38 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(el.style.height).toBe('38px');
    });

    it('never grows above the 600px maximum', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 600 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.style.height).toBe('600px');
    });

    it('saved data reflects a keyboard resize', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(tool.save()).toEqual({ height: 56 });
    });
  });

  describe('pointer resize', () => {
    it('dragging the bottom grip down grows the height by the pointer delta', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 140, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 140, pointerId: 1 }));

      expect(el.style.height).toBe('88px');
      expect(tool.save()).toEqual({ height: 88 });
    });

    it('dragging the top grip up grows the height by the pointer delta', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el, 'top')!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 60, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 60, pointerId: 1 }));

      expect(el.style.height).toBe('88px');
      expect(tool.save()).toEqual({ height: 88 });
    });

    it('dragging the top grip down shrinks the height', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 64 }));
      const el = tool.render();
      const grip = getGrip(el, 'top')!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 120, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 120, pointerId: 1 }));

      expect(el.style.height).toBe('44px');
    });

    it('dragging up clamps at the 38px minimum', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 0, pointerId: 1 }));

      expect(el.style.height).toBe('38px');
    });

    it('pins the chrome visible while dragging, even when the pointer leaves the block', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      // Pointer far outside the spacer mid-drag — hover is gone, chrome must stay.
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 400, pointerId: 1 }));

      expect(el.hasAttribute('data-blok-spacer-dragging')).toBe(true);
      expect(el.className).toContain('outline-dashed');
      for (const g of getGrips(el)) {
        expect(g.className).toContain('opacity-100');
      }
      expect(el.querySelector('[data-blok-spacer-readout]')?.className).toContain('opacity-100');
    });

    it('unpins the chrome when the drag ends', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      expect(el.hasAttribute('data-blok-spacer-dragging')).toBe(true);
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 200, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 200, pointerId: 1 }));

      expect(el.hasAttribute('data-blok-spacer-dragging')).toBe(false);
      for (const g of getGrips(el)) {
        expect(g.className).not.toContain(' opacity-100');
      }
      // Back to hover-gated discoverability.
      expect(el.className).toContain('hover:outline-dashed');
    });

    it('unpins the chrome when the drag is cancelled', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      expect(el.hasAttribute('data-blok-spacer-dragging')).toBe(true);
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));

      expect(el.hasAttribute('data-blok-spacer-dragging')).toBe(false);
    });

    it('snaps to a sibling column block bottom and shows the guideline', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      mountInColumns(el, [220]);
      const grip = getGrip(el)!;

      // Spacer top is at 100 → dragging the bottom edge to ~218 lands within
      // the snap threshold of the sibling block's bottom (220).
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 148, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 218, pointerId: 1 }));

      // Snapped: height is exactly the distance from the spacer top to 220.
      expect(el.style.height).toBe('120px');
      expect(document.querySelector('[data-blok-spacer-guide]')).not.toBeNull();

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 218, pointerId: 1 }));
    });

    it('does not snap when the edge is far from any sibling block bottom', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      mountInColumns(el, [220]);
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 148, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 190, pointerId: 1 }));

      // Free drag: 48 + (190 - 148) = 90.
      expect(el.style.height).toBe('90px');
      expect(document.querySelector('[data-blok-spacer-guide]')).toBeNull();

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 190, pointerId: 1 }));
    });

    it('removes the guideline when the drag ends', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      mountInColumns(el, [220]);
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 148, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 218, pointerId: 1 }));
      expect(document.querySelector('[data-blok-spacer-guide]')).not.toBeNull();

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 218, pointerId: 1 }));

      expect(document.querySelector('[data-blok-spacer-guide]')).toBeNull();
    });

    it('keeps snapping when the page scrolls mid-drag', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      mountInColumns(el, [220]);
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 148, pointerId: 1, bubbles: true }));

      // The page scrolls 60px between pointerdown and the move. Every viewport y
      // shifts up by the same amount; the layout itself is untouched. Geometry read
      // at pointerdown now describes a coordinate frame that no longer exists.
      scrollPage(60);

      // The pointer asks for the same height as before (48 + 70 = 118), and the
      // sibling block's bottom is still 120px below the spacer's top — so the snap
      // must still land, on the block's edge where it NOW is.
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 218, pointerId: 1 }));

      expect(el.style.height).toBe('120px');

      const guide = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

      // Drawn on the block's post-scroll position (220 - 60), centred on it.
      expect(guide?.style.top).toBe('159px');

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 218, pointerId: 1 }));
    });

    it('draws the guideline where the block sits AFTER the snapped height lands', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      // Applying a height is itself what moves the page: the block under the spacer
      // is the browser's scroll anchor, so growing the gap scrolls by the growth to
      // hold that block still. Measure before the height lands and the guideline is
      // painted onto a stale frame — a few px off the block it is meant to mark.
      mountInColumns(el, [220], { scrollAnchoredBelow: true });
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 148, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 218, pointerId: 1 }));

      expect(el.style.height).toBe('120px');

      const guide = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');
      const siblingBottom = document.querySelector<HTMLElement>('[data-blok-column] [data-blok-element]')!;

      // The line lands on the sibling block's edge as it stands once the gap has
      // grown — not where it stood a layout ago.
      expect(guide?.style.top).toBe(`${siblingBottom.getBoundingClientRect().bottom - 1}px`);

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 218, pointerId: 1 }));
    });

    it('a spacer outside any column drags freely with no guideline', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();

      document.body.appendChild(el);
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 140, pointerId: 1 }));

      expect(el.style.height).toBe('88px');
      expect(document.querySelector('[data-blok-spacer-guide]')).toBeNull();

      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 140, pointerId: 1 }));
    });

    it('stops tracking pointer moves after pointerup', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 48 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 110, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 110, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 300, pointerId: 1 }));

      expect(el.style.height).toBe('58px');
    });
  });

  describe('read-only mode', () => {
    it('is fully invisible: no hover outline classes in read-only mode', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }, { readOnly: true }));
      const el = tool.render();

      expect(el.className).not.toContain('hover:outline-dashed');
      expect(el.className).not.toContain('hover:outline-(--blok-color-accent)');
    });

    it('setReadOnly toggles the hover outline together with the grips', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();

      expect(el.className).toContain('hover:outline-dashed');

      tool.setReadOnly(true);
      expect(el.className).not.toContain('hover:outline-dashed');
      expect(el.className).not.toContain('hover:outline-(--blok-color-accent)');

      tool.setReadOnly(false);
      expect(el.className).toContain('hover:outline-dashed');
      expect(el.className).toContain('hover:outline-(--blok-color-accent)');
    });

    it('renders no grips in read-only mode', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }, { readOnly: true }));
      const el = tool.render();

      expect(getGrips(el)).toHaveLength(0);
      expect(el.style.height).toBe('40px');
    });

    it('setReadOnly(true) removes both grips, setReadOnly(false) restores them', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();

      tool.setReadOnly(true);
      expect(getGrips(el)).toHaveLength(0);

      tool.setReadOnly(false);
      expect(getGrip(el, 'top')).not.toBeNull();
      expect(getGrip(el, 'bottom')).not.toBeNull();
    });
  });

  describe('static toolbox', () => {
    it('has icon and titleKey', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const toolbox = SpacerTool.toolbox;

      expect(toolbox).toBeDefined();
      expect(!Array.isArray(toolbox) && toolbox.icon).toBeTruthy();
      expect(!Array.isArray(toolbox) && toolbox.titleKey).toBe('spacer');
    });

    it('has search terms and translated alias keys', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const toolbox = SpacerTool.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.searchTerms).toContain('gap');
      expect(!Array.isArray(toolbox) && toolbox.searchTermKeys).toEqual(['spacer', 'space', 'gap']);
    });
  });

  describe('static isReadOnlySupported', () => {
    it('returns true', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');

      expect(SpacerTool.isReadOnlySupported).toBe(true);
    });
  });

  describe('static sanitize', () => {
    it('returns empty object', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');

      expect(SpacerTool.sanitize).toEqual({});
    });
  });
});
