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

describe('SpacerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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
        expect(grip.className).toContain('hover:after:bg-(--blok-color-accent)');
      }
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
