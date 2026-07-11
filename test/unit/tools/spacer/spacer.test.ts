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

const getGrip = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-blok-spacer-grip]');

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

    it('defaults to 24px when no height is stored', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.style.height).toBe('24px');
    });

    it('clamps stored height below the minimum up to 8px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 2 }));
      const el = tool.render();

      expect(el.style.height).toBe('8px');
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

    it('renders a focusable resize grip with separator semantics', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();
      const grip = getGrip(el);

      expect(grip).not.toBeNull();
      expect(grip?.getAttribute('role')).toBe('separator');
      expect(grip?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(grip?.getAttribute('tabindex')).toBe('0');
      expect(grip?.getAttribute('aria-label')).toBe('tools.spacer.resizeAriaLabel');
      expect(grip?.getAttribute('aria-valuemin')).toBe('8');
      expect(grip?.getAttribute('aria-valuemax')).toBe('600');
      expect(grip?.getAttribute('aria-valuenow')).toBe('40');
    });
  });

  describe('hover affordances', () => {
    it('marks the block boundary with a dashed outline on hover', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions());
      const el = tool.render();

      expect(el.className).toContain('hover:outline-dashed');
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
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.querySelector('[data-blok-spacer-readout]')?.textContent).toBe('32px');
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

      expect(tool.save()).toEqual({ height: 24 });
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
    it('ArrowDown on the grip grows the height by 8px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(el.style.height).toBe('32px');
      expect(grip.getAttribute('aria-valuenow')).toBe('32');
    });

    it('ArrowUp on the grip shrinks the height by 8px', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(el.style.height).toBe('16px');
    });

    it('never shrinks below the 8px minimum', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 8 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(el.style.height).toBe('8px');
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
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(tool.save()).toEqual({ height: 32 });
    });
  });

  describe('pointer resize', () => {
    it('dragging the grip down grows the height by the pointer delta', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 140, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 140, pointerId: 1 }));

      expect(el.style.height).toBe('64px');
      expect(tool.save()).toEqual({ height: 64 });
    });

    it('dragging up clamps at the minimum', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 0, pointerId: 1 }));

      expect(el.style.height).toBe('8px');
    });

    it('stops tracking pointer moves after pointerup', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 24 }));
      const el = tool.render();
      const grip = getGrip(el)!;

      grip.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 110, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: 110, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 300, pointerId: 1 }));

      expect(el.style.height).toBe('34px');
    });
  });

  describe('read-only mode', () => {
    it('renders no grip in read-only mode', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }, { readOnly: true }));
      const el = tool.render();

      expect(getGrip(el)).toBeNull();
      expect(el.style.height).toBe('40px');
    });

    it('setReadOnly(true) removes the grip, setReadOnly(false) restores it', async () => {
      const { SpacerTool } = await import('../../../../src/tools/spacer');
      const tool = new SpacerTool(createOptions({ height: 40 }));
      const el = tool.render();

      tool.setReadOnly(true);
      expect(getGrip(el)).toBeNull();

      tool.setReadOnly(false);
      expect(getGrip(el)).not.toBeNull();
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
