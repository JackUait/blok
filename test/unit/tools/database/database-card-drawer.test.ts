import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseRow, SelectOption, PropertyDefinition } from '../../../../src/tools/database/types';
import type { I18n, OutputData } from '../../../../types';
import type { ToolsConfig } from '../../../../types/api/tools';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

const { stubBlokModule } = vi.hoisted(() => ({
  stubBlokModule: () => ({
    Blok: vi.fn(function stubBlok() {
      return {
        isReady: Promise.resolve(),
        save: vi.fn().mockResolvedValue({ blocks: [] }),
        destroy: vi.fn(),
      };
    }),
  }),
}));

vi.mock('../../../../src/blok', stubBlokModule);

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1',
  position: 'a0',
  properties: { 'prop-title': 'Test card' },
  ...overrides,
});

const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: 'opt-1',
  label: 'In progress',
  color: 'blue',
  position: 'a1',
  ...overrides,
});

const makePropertyDef = (overrides: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'prop-status',
  name: 'Status',
  type: 'select',
  position: 'a1',
  ...overrides,
});

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  titlePropertyId: 'prop-title',
  schema: [],
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DatabaseCardDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    // Tests that swap the editor module must put the stub back. Most drawers are
    // never destroyed, so a real editor would outlive jsdom and its debounced
    // selectionchange timer would throw "window is not defined".
    const { Blok } = await import('../../../../src/blok');

    expect(vi.isMockFunction(Blok)).toBe(true);
  });

  // drawer.open() boots the nested editor through a dynamic import no test awaits,
  // so a real one would construct inside whichever test runs next.
  it('never loads the real editor for the nested description', async () => {
    const { Blok } = await import('../../../../src/blok');

    expect(vi.isMockFunction(Blok)).toBe(true);
  });

  it('creates a drawer element ([data-blok-database-drawer]) when opened', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const row = makeRow();

    drawer.open(row);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]');

    expect(el).not.toBeNull();
    expect(drawer.isOpen).toBe(true);
  });

  it('removes drawer element when closed after transition completes', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const row = makeRow();

    drawer.open(row);

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

    drawer.close();

    expect(drawer.isOpen).toBe(false);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

    el.dispatchEvent(new Event('transitionend'));

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
  });

  it('calls onTitleChange(rowId, newTitle) when title input fires input event', () => {
    const onTitleChange = vi.fn();
    const options = createOptions({ onTitleChange });
    const drawer = new DatabaseCardDrawer(options);
    const row = makeRow({ id: 'row-42', properties: { 'prop-title': 'Original title' } });

    drawer.open(row);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();

    titleInput.value = 'Updated title';
     
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onTitleChange).toHaveBeenCalledWith('row-42', 'Updated title');
  });

  it('calls onClose when close button ([data-blok-database-drawer-close]) is clicked', () => {
    const onClose = vi.fn();
    const options = createOptions({ onClose });
    const drawer = new DatabaseCardDrawer(options);
    const row = makeRow();

    drawer.open(row);

    const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables title input (readOnly = true) in read-only mode', () => {
    const options = createOptions({ readOnly: true });
    const drawer = new DatabaseCardDrawer(options);
    const row = makeRow();

    drawer.open(row);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();
    expect(titleInput.readOnly).toBe(true);
  });

  describe('layout', () => {
    it('drawer has data attribute for CSS styling', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el).not.toBeNull();
      expect(el.hasAttribute('data-blok-database-drawer')).toBe(true);
    });

    it('drawer contains a toolbar, content area, and editor holder', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      expect(options.wrapper.querySelector('[data-blok-database-drawer-toolbar]')).not.toBeNull();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-content]')).not.toBeNull();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-editor]')).not.toBeNull();
    });

    it('slides the drawer in one frame after mount by marking it open, with no width animation', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.hasAttribute('data-open')).toBe(false);

      rafCallbacks.forEach((cb) => cb(0));

      expect(el.hasAttribute('data-open')).toBe(true);
      expect(el.style.width).toBe('');
    });
  });

  describe('side peek narrows the page beside it', () => {
    const openWithHost = (hostRect: { left: number; right: number }): { host: HTMLElement; drawer: DatabaseCardDrawer; options: CardDrawerOptions } => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);

      const host = document.createElement('div');

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(hostRect.left, 0, hostRect.right - hostRect.left, 800));
      document.body.appendChild(host);

      const options = createOptions({ peekHost: () => host });
      const drawer = new DatabaseCardDrawer(options);

      host.appendChild(options.wrapper);
      drawer.open(makeRow());

      return { host, drawer, options };
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('insets the page by the part the 756px drawer covers', () => {
      const { host, drawer } = openWithHost({ left: 100, right: 900 });

      // The drawer covers x 244..1000; the page reaches 900, so 656px is under it.
      expect(host.hasAttribute('data-blok-database-peek')).toBe(true);
      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('656px');

      drawer.destroy();
    });

    it('insets nothing when the page ends before the drawer starts', () => {
      const { host, drawer } = openWithHost({ left: 0, right: 200 });

      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('0px');

      drawer.destroy();
    });

    it('measures from the left edge in RTL, where the drawer sits on the left', () => {
      const { host, drawer, options } = { ...openWithHost({ left: 100, right: 900 }) };

      drawer.close();
      options.wrapper.setAttribute('dir', 'rtl');
      drawer.open(makeRow());

      // The drawer covers x 0..756; the page starts at 100, so 656px is under it.
      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('656px');

      drawer.destroy();
    });

    it('widens the page back as the drawer slides out, then drops its marks', () => {
      const { host, drawer, options } = openWithHost({ left: 100, right: 900 });

      drawer.close();

      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('0px');
      expect(host.hasAttribute('data-blok-database-peek')).toBe(true);

      options.wrapper.querySelector('[data-blok-database-drawer]')?.dispatchEvent(new Event('transitionend'));

      expect(host.hasAttribute('data-blok-database-peek')).toBe(false);
      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('');
    });

    it('drops its marks at once on destroy', () => {
      const { host, drawer } = openWithHost({ left: 100, right: 900 });

      drawer.destroy();

      expect(host.hasAttribute('data-blok-database-peek')).toBe(false);
      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('');
    });
  });

  // research/22 §10: 756px by default, resizable between 564 and 1008px from its inner edge.
  describe('side peek width', () => {
    const KEY = 'blok:database-peek-width';

    const openSide = (wrapper: HTMLElement = document.createElement('div')): { drawer: DatabaseCardDrawer; el: HTMLElement; handle: HTMLElement } => {
      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper }));

      drawer.open(makeRow());
      const el = wrapper.querySelector<HTMLElement>('[data-blok-database-drawer]');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (el === null || handle === null) throw new Error('no drawer or resize handle');

      return { drawer, el, handle };
    };
    const width = (el: HTMLElement): string => el.style.getPropertyValue('--_blok-peek-width');
    const key = (handle: HTMLElement, name: string): void => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    };

    beforeEach(() => {
      window.localStorage.removeItem(KEY);
    });

    afterEach(() => {
      window.localStorage.removeItem(KEY);
      document.body.innerHTML = '';
    });

    it('opens at 756px with a focusable vertical separator on its inner edge', () => {
      const { el, handle, drawer } = openSide();

      expect(width(el)).toBe('756px');
      expect(handle.getAttribute('role')).toBe('separator');
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      expect(handle.getAttribute('aria-valuenow')).toBe('756');
      expect(handle.getAttribute('aria-valuemin')).toBe('564');
      expect(handle.getAttribute('aria-valuemax')).toBe('1008');
      expect(handle.getAttribute('aria-label')).toBe('Side peek');
      expect(handle.tabIndex).toBe(0);
      drawer.destroy();
    });

    it('widens with ArrowLeft and narrows with ArrowRight, clamped by Home and End', () => {
      const { el, handle, drawer } = openSide();

      key(handle, 'ArrowLeft');
      expect(width(el)).toBe('772px');
      expect(handle.getAttribute('aria-valuenow')).toBe('772');
      key(handle, 'ArrowRight');
      key(handle, 'ArrowRight');
      expect(width(el)).toBe('740px');
      key(handle, 'Home');
      expect(width(el)).toBe('564px');
      key(handle, 'ArrowRight');
      expect(width(el)).toBe('564px');
      key(handle, 'End');
      expect(width(el)).toBe('1008px');
      key(handle, 'ArrowLeft');
      expect(width(el)).toBe('1008px');
      drawer.destroy();
    });

    it('flips the arrows in RTL, where the inner edge is on the right', () => {
      const wrapper = document.createElement('div');

      wrapper.setAttribute('dir', 'rtl');
      const { el, handle, drawer } = openSide(wrapper);

      key(handle, 'ArrowRight');
      expect(width(el)).toBe('772px');
      key(handle, 'ArrowLeft');
      key(handle, 'ArrowLeft');
      expect(width(el)).toBe('740px');
      drawer.destroy();
    });

    it('follows the pointer from the inner edge, LTR and RTL', () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
      const { el, handle, drawer } = openSide();

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(756, 0, 756, 800));
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 756, pointerId: 1, button: 0, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, pointerId: 1, bubbles: true }));
      expect(width(el)).toBe('912px');
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, pointerId: 1, bubbles: true }));
      expect(width(el)).toBe('1008px');
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, pointerId: 1, bubbles: true }));
      expect(window.localStorage.getItem(KEY)).toBe('1008');
      drawer.destroy();

      const wrapper = document.createElement('div');

      wrapper.setAttribute('dir', 'rtl');
      window.localStorage.removeItem(KEY);
      const rtl = openSide(wrapper);

      vi.spyOn(rtl.el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 756, 800));
      rtl.handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 756, pointerId: 1, button: 0, bubbles: true }));
      rtl.handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, pointerId: 1, bubbles: true }));
      expect(width(rtl.el)).toBe('600px');
      rtl.drawer.destroy();
    });

    // research/31 §2: a click on the handle closes the peek; a press alone or a drag does not.
    it('a click on the handle closes the peek', () => {
      const onClose = vi.fn();
      const wrapper = document.createElement('div');

      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper, onClose }));

      drawer.open(makeRow(), 'side');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (handle === null) throw new Error('no resize handle');
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 762, clientY: 400, pointerId: 1, button: 0, bubbles: true }));
      expect(wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 762, clientY: 400, pointerId: 1, bubbles: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(drawer.isOpen).toBe(false);
      drawer.destroy();
    });

    it('a drag on the handle resizes and keeps the peek open', () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
      const onClose = vi.fn();
      const wrapper = document.createElement('div');

      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper, onClose }));

      drawer.open(makeRow(), 'side');
      const el = wrapper.querySelector<HTMLElement>('[data-blok-database-drawer]');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (el === null || handle === null) throw new Error('no drawer or resize handle');
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(756, 0, 756, 800));
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 762, clientY: 400, pointerId: 1, button: 0, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 400, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 700, clientY: 400, pointerId: 1, bubbles: true }));

      expect(width(el)).toBe('812px');
      expect(onClose).not.toHaveBeenCalled();
      expect(drawer.isOpen).toBe(true);
      drawer.destroy();
    });

    // research/35 §12: any move between down and up resizes, even 0px; only a press with no move closes.
    it.each([[0, 0], [1, 1], [3, 3]])('a press with moves of %ipx resizes to the pointer and keeps the peek open', (first, second) => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
      const onClose = vi.fn();
      const wrapper = document.createElement('div');

      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper, onClose }));

      drawer.open(makeRow(), 'side');
      const el = wrapper.querySelector<HTMLElement>('[data-blok-database-drawer]');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (el === null || handle === null) throw new Error('no drawer or resize handle');
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(756, 0, 756, 800));
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 762, clientY: 400, pointerId: 1, button: 0, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 762 + first, clientY: 400, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 762 + second, clientY: 400, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 762 + second, clientY: 400, pointerId: 1, bubbles: true }));

      expect(onClose).not.toHaveBeenCalled();
      expect(drawer.isOpen).toBe(true);
      // The left edge jumps to the pointer, not to where the handle was grabbed.
      expect(width(el)).toBe(`${1512 - 762 - second}px`);
      drawer.destroy();
    });

    it('a cancelled press on the handle keeps the peek open', () => {
      const onClose = vi.fn();
      const wrapper = document.createElement('div');

      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper, onClose }));

      drawer.open(makeRow(), 'side');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (handle === null) throw new Error('no resize handle');
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 762, clientY: 400, pointerId: 1, button: 0, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 762, clientY: 400, pointerId: 1, bubbles: true }));

      expect(onClose).not.toHaveBeenCalled();
      drawer.destroy();
    });

    it('keeps the width per viewer and reopens at it', () => {
      const first = openSide();

      key(first.handle, 'ArrowLeft');
      expect(window.localStorage.getItem(KEY)).toBe('772');
      first.drawer.destroy();

      expect(width(openSide().el)).toBe('772px');
    });

    it('falls back to 756px for a broken value and clamps one out of range', () => {
      window.localStorage.setItem(KEY, 'wide');
      expect(width(openSide().el)).toBe('756px');
      document.body.innerHTML = '';
      window.localStorage.setItem(KEY, '2000');
      expect(width(openSide().el)).toBe('1008px');
    });

    it('still opens at 756px when storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { el, handle } = openSide();

      expect(width(el)).toBe('756px');
      key(handle, 'ArrowLeft');
      expect(width(el)).toBe('772px');
    });

    it('hides the handle in the center peek and on a full page', () => {
      const { drawer, handle } = openSide();

      drawer.open(makeRow(), 'center');
      expect(handle.hidden).toBe(true);
      drawer.open(makeRow(), 'full');
      expect(handle.hidden).toBe(true);
      drawer.open(makeRow(), 'side');
      expect(handle.hidden).toBe(false);
      drawer.destroy();
    });
  });

  // research/30 B24: hovering the handle shows "Resize · Drag" beside it, level with the pointer.
  describe('side peek handle hint', () => {
    const tooltip = (): HTMLElement | null => document.getElementById('blok-tooltip');
    const shown = (): boolean => tooltip()?.getAttribute('data-state') === 'open';
    const pointer = (target: HTMLElement, type: string, clientY: number, pointerType = 'mouse'): void => {
      const event = new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', clientY, clientX: 300 });

      Object.defineProperty(event, 'pointerType', { value: pointerType });
      target.dispatchEvent(event);
    };
    const openSide = (dir?: 'rtl'): { drawer: DatabaseCardDrawer; handle: HTMLElement } => {
      const wrapper = document.createElement('div');

      if (dir !== undefined) wrapper.dir = dir;
      document.body.appendChild(wrapper);
      const drawer = new DatabaseCardDrawer(createOptions({ wrapper }));

      drawer.open(makeRow(), 'side');
      const handle = wrapper.querySelector<HTMLElement>('[data-blok-database-peek-resize]');

      if (handle === null) throw new Error('no resize handle');
      const layout = HTMLElement.prototype.getBoundingClientRect;

      // jsdom has no layout: the handle spans the peek, and the hint's anchor sits at its style top.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
        if (this === handle) return new DOMRect(300, 0, 12, 700);
        if (this.hasAttribute('data-blok-database-peek-hint-anchor')) return new DOMRect(300, parseFloat(this.style.top), 12, 0);

        return layout.call(this);
      });

      return { drawer, handle };
    };

    // Earlier tests clear the body, which detaches the tooltip singleton: start a fresh one.
    beforeEach(async () => {
      const { destroy } = await import('../../../../src/components/utils/tooltip');

      destroy();
      vi.useFakeTimers();
    });

    afterEach(async () => {
      const { destroy } = await import('../../../../src/components/utils/tooltip');

      destroy();
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('shows "Close · Click" and "Resize · Drag" only after the hint delay, beside the handle', () => {
      const { drawer, handle } = openSide();

      pointer(handle, 'pointerenter', 360);
      vi.advanceTimersByTime(299);
      expect(shown()).toBe(false);
      vi.advanceTimersByTime(300);

      expect(shown()).toBe(true);
      expect([...(tooltip()?.querySelector('[data-blok-testid="tooltip-content"] > div')?.children ?? [])].map((line) => line.textContent)).toEqual(['Close Click', 'Resize Drag']);
      expect(tooltip()?.getAttribute('data-blok-placement')).toBe('left');
      drawer.destroy();
    });

    it('puts the hint on the right in a right-to-left editor', () => {
      const { drawer, handle } = openSide('rtl');

      pointer(handle, 'pointerenter', 360);
      vi.advanceTimersByTime(600);

      expect(tooltip()?.getAttribute('data-blok-placement')).toBe('right');
      drawer.destroy();
    });

    it('follows the pointer up and down the handle', () => {
      const { drawer, handle } = openSide();

      pointer(handle, 'pointerenter', 300);
      vi.advanceTimersByTime(600);
      const first = parseFloat(tooltip()?.style.top ?? '');

      pointer(handle, 'pointermove', 420);

      expect(parseFloat(tooltip()?.style.top ?? '') - first).toBe(120);
      drawer.destroy();
    });

    it('a move before the hint shows does not restart its delay', () => {
      const { drawer, handle } = openSide();

      pointer(handle, 'pointerenter', 300);
      vi.advanceTimersByTime(400);
      pointer(handle, 'pointermove', 320);
      vi.advanceTimersByTime(200);

      expect(shown()).toBe(true);
      drawer.destroy();
    });

    it('hides when the pointer leaves or starts a drag, and shows nothing for touch or focus', () => {
      const { drawer, handle } = openSide();

      pointer(handle, 'pointerenter', 300);
      vi.advanceTimersByTime(600);
      pointer(handle, 'pointerleave', 300);
      vi.advanceTimersByTime(200);
      expect(shown()).toBe(false);

      pointer(handle, 'pointerenter', 300);
      vi.advanceTimersByTime(600);
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 300 }));
      expect(shown()).toBe(false);
      handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      pointer(handle, 'pointerleave', 300);
      pointer(handle, 'pointerenter', 300, 'touch');
      handle.focus();
      vi.advanceTimersByTime(600);
      expect(shown()).toBe(false);
      drawer.destroy();
    });
  });

  describe('accessibility', () => {
    it('drawer has role="complementary" and aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.getAttribute('role')).toBe('complementary');
      expect(el.getAttribute('aria-label')).toBeTruthy();
    });

    it('localizes the close button accessible label', () => {
      const i18n: I18n = {
        t: vi.fn((key: string) => key === 'tools.database.close' ? 'Zavřít' : key),
        has: vi.fn(() => true),
        getEnglishTranslation: vi.fn(() => ''),
        getLocale: vi.fn(() => 'cs'),
      };
      const options = createOptions({ i18n });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Zavřít');
      expect(i18n.t).toHaveBeenCalledWith('tools.database.close');
    });

    it('title input has aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('styling', () => {
    it('close button holds one double-chevron glyph', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.querySelectorAll('svg')).toHaveLength(1);
      expect(closeBtn.querySelectorAll('svg path')).toHaveLength(2);
    });

    // feel/findings-rowpage R25: Notion's empty row page title reads "New page".
    it('title input has "New page" placeholder from i18n', () => {
      const mockI18n = {
        t: vi.fn((key: string) => {
          if (key === 'tools.database.layoutNewPage') return 'New page';

          return key;
        }),
        has: vi.fn(() => true),
        getEnglishTranslation: vi.fn(() => ''),
        getLocale: vi.fn(() => 'en'),
      };
      const options = createOptions({ i18n: mockI18n });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(titleInput.placeholder).toBe('New page');
    });
  });

  describe('multi-line title', () => {
    it('renders the title as a textarea element so long titles can wrap', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'A very long card title that should be able to wrap across multiple lines in the drawer' } });

      drawer.open(row);

      const titleEl = options.wrapper.querySelector('[data-blok-database-drawer-title]');

      expect(titleEl).not.toBeNull();
      expect(titleEl!.tagName).toBe('TEXTAREA');
    });

    it('has rows="1" so the textarea starts compact', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const titleEl = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(titleEl.rows).toBe(1);
    });

    it('auto-resizes height on input to fit content', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const titleEl = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      // Simulate scrollHeight being larger than default
      Object.defineProperty(titleEl, 'scrollHeight', { value: 96, configurable: true });

      titleEl.value = 'A very long title that wraps to multiple lines in the drawer panel';
       
      titleEl.dispatchEvent(new Event('input', { bubbles: true }));

      expect(titleEl.style.height).toBe('96px');
    });

    it('does not collapse to zero height on initial open', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();

      document.body.appendChild(options.wrapper);

      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Some title' } });

      drawer.open(row);

      // Trigger rAF to set width, then fire transitionend to trigger auto-resize
      rafCallbacks.forEach((cb) => cb(0));

      const drawerEl = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      drawerEl.dispatchEvent(new Event('transitionend'));

      const titleEl = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(titleEl.style.height).not.toBe('0px');

      drawer.destroy();
      document.body.removeChild(options.wrapper);
    });

    it('does not allow newlines — Enter key is suppressed', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const titleEl = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      const prevented = !titleEl.dispatchEvent(event);

      expect(prevented).toBe(true);
    });
  });

  describe('properties section', () => {
    // research/35 §4: a row page label hints its name, plus the description when there is one, left of it.
    it('a property label hints its name and description, or its name alone', () => {
      destroyTooltip();
      vi.useFakeTimers();
      try {
        const tag = makePropertyDef({ id: 'prop-tag', name: 'Tag', type: 'text', description: 'Line one\nline two' });
        const date = makePropertyDef({ id: 'prop-date', name: 'Date', type: 'text' });
        const options = createOptions({ schema: [tag, date] });
        const drawer = new DatabaseCardDrawer(options);

        document.body.appendChild(options.wrapper);
        drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-tag': 'a', 'prop-date': 'b' } }));
        const label = (id: string): HTMLElement | null =>
          options.wrapper.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-label][data-property-id="${id}"]`);

        hover(label('prop-tag'));
        vi.advanceTimersByTime(HINT_DELAY - 1);
        expect(shownHint()).toBeNull();
        vi.advanceTimersByTime(1);
        expect(shownHint()).toEqual({ text: 'TagLine one\nline two', placement: 'left' });

        label('prop-tag')?.dispatchEvent(new MouseEvent('mouseleave'));
        vi.advanceTimersByTime(1000);
        hover(label('prop-date'));
        vi.advanceTimersByTime(HINT_DELAY);
        expect(shownHint()).toEqual({ text: 'Date', placement: 'left' });
      } finally {
        vi.useRealTimers();
        document.body.innerHTML = '';
      }
    });

    it('shows status property with option label when schema has a select property', () => {
      const selectOption = makeOption({ id: 'opt-in-progress', label: 'In progress', color: 'blue' });
      const statusDef = makePropertyDef({
        id: 'prop-status',
        name: 'Status',
        type: 'select',
        config: { options: [selectOption] },
      });
      const options = createOptions({ schema: [statusDef] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Test card', 'prop-status': 'opt-in-progress' } });

      drawer.open(row);

      const propLabel = options.wrapper.querySelector('[data-blok-database-drawer-prop-label]');
      const statusPill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(propLabel).not.toBeNull();
      expect(propLabel!.textContent).toBe('Status');
      expect(statusPill).not.toBeNull();
      expect(statusPill!.textContent).toBe('In progress');
    });

    it('select pill paints its color through data-color, with no dot', () => {
      const selectOption = makeOption({ id: 'opt-1', label: 'Done', color: 'green' });
      const statusDef = makePropertyDef({
        id: 'prop-status',
        name: 'Status',
        type: 'select',
        config: { options: [selectOption] },
      });
      const options = createOptions({ schema: [statusDef] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Test card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      const pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill?.getAttribute('data-color')).toBe('green');
      expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-dot]')).toBeNull();
    });

    it('shows no property rows when schema has no renderable properties', () => {
      // title and richText are excluded from the properties section
      const titleDef = makePropertyDef({ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' });
      const richTextDef = makePropertyDef({ id: 'prop-desc', name: 'Description', type: 'richText', position: 'a1' });
      const options = createOptions({ schema: [titleDef, richTextDef] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const propRows = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-row]');

      expect(propRows).toHaveLength(0);
    });

    it('shows all schema properties (excluding title and richText) in the properties section when opened', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' }),
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
        makePropertyDef({ id: 'prop-notes', name: 'Notes', type: 'text', position: 'a2' }),
        makePropertyDef({ id: 'prop-desc', name: 'Description', type: 'richText', position: 'a3' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1', 'prop-notes': 'hello', 'prop-desc': null } });

      drawer.open(row);

      const propRows = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-row]');

      // title and richText excluded → only 'Status' and 'Notes'
      expect(propRows).toHaveLength(2);
    });

    it('renders property name from schema def.name (not hardcoded "Status")', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-priority', name: 'Priority', type: 'select', position: 'a1', config: { options: [makeOption({ id: 'opt-high', label: 'High' })] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-priority': 'opt-high' } });

      drawer.open(row);

      const propLabel = options.wrapper.querySelector('[data-blok-database-drawer-prop-label]');

      expect(propLabel).not.toBeNull();
      expect(propLabel!.textContent).toBe('Priority');
    });

    it('renders select property as a colored pill with the option label', () => {
      const selectOption = makeOption({ id: 'opt-done', label: 'Done', color: 'green' });
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [selectOption] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-done' } });

      drawer.open(row);

      const pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill).not.toBeNull();
      expect(pill!.textContent).toBe('Done');
      expect(pill!.getAttribute('data-color')).toBe('green');
    });

    it('renders text property value as plain text', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-notes', name: 'Notes', type: 'text', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-notes': 'some plain text' } });

      drawer.open(row);

      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(propValue).not.toBeNull();
      expect(propValue!.textContent).toBe('some plain text');
    });

    it('renders number property value as a string', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-count', name: 'Count', type: 'number', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-count': 42 } });

      drawer.open(row);

      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(propValue).not.toBeNull();
      expect(propValue!.textContent).toBe('42');
    });

    it('renders checkbox property value', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-done': true } });

      drawer.open(row);

      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(propValue).not.toBeNull();
      expect(propValue!.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('checked');
    });

    it('shows properties section even when no groupBy option exists (list view scenario)', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      // row has a status property value
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      // open WITHOUT any option argument (simulating list view — no groupBy)
      drawer.open(row);

      const propsSection = options.wrapper.querySelector('[data-blok-database-drawer-props]');

      expect(propsSection).not.toBeNull();
    });

    it('updates properties section when switching cards', () => {
      const selectOption1 = makeOption({ id: 'opt-todo', label: 'To Do', color: 'red' });
      const selectOption2 = makeOption({ id: 'opt-done', label: 'Done', color: 'green' });
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [selectOption1, selectOption2] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'Card 1', 'prop-status': 'opt-todo' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': 'Card 2', 'prop-status': 'opt-done' } });

      drawer.open(row1);

      let pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill!.textContent).toBe('To Do');

      drawer.open(row2);

      pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill!.textContent).toBe('Done');
    });

    it('renders a url value as its full address', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-url', name: 'Website', type: 'url', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-url': 'https://example.com' } });

      drawer.open(row);

      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(propValue).not.toBeNull();
      expect(propValue!.querySelector('[data-blok-database-cell]')?.textContent).toBe('https://example.com');
    });

    it('renders a date property value as a long date', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-date', name: 'Due Date', type: 'date', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-date': '2026-04-03' } });

      drawer.open(row);

      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(propValue).not.toBeNull();
      expect(propValue!.textContent).toBe(new Intl.DateTimeFormat(navigator.language, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(2026, 3, 3)));
    });

    it('renders multiSelect property as multiple colored pills', () => {
      const opt1 = makeOption({ id: 'opt-a', label: 'Alpha', color: 'red' });
      const opt2 = makeOption({ id: 'opt-b', label: 'Beta', color: 'blue' });
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: { options: [opt1, opt2] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-tags': ['opt-a', 'opt-b'] } });

      drawer.open(row);

      const pills = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-pill]');

      expect(pills).toHaveLength(2);
      expect(pills[0].textContent).toBe('Alpha');
      expect(pills[1].textContent).toBe('Beta');
    });

    it('shows Empty in the value area when multiSelect value is null', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: { options: [makeOption()] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-tags': null } });

      drawer.open(row);

      const pills = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-pill]');
      const propValue = options.wrapper.querySelector('[data-blok-database-drawer-prop-value]');

      expect(pills).toHaveLength(0);
      expect(propValue!.textContent).toBe('tools.database.cellEmpty');
    });

    it('renders properties in position order', () => {
      // 'b1' sorts after 'a1', so 'First' should appear before 'Second' in the DOM
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-second', name: 'Second', type: 'text', position: 'b1' }),
        makePropertyDef({ id: 'prop-first', name: 'First', type: 'text', position: 'a1' }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-first': 'val-a', 'prop-second': 'val-b' } });

      drawer.open(row);

      const labels = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-label]');

      expect(labels).toHaveLength(2);
      expect(labels[0].textContent).toBe('First');
      expect(labels[1].textContent).toBe('Second');
    });
  });

  describe('close notification consistency', () => {
    it('calls onClose callback when close() is called directly', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      onClose.mockClear();

      drawer.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does NOT call onClose when switching to a different card while open', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1' });
      const row2 = makeRow({ id: 'row-2' });

      drawer.open(row1);
      onClose.mockClear();

      drawer.open(row2);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('card switching (drawer already open)', () => {
    it('reuses the same drawer DOM element instead of recreating it', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'First' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': 'Second' } });

      drawer.open(row1);

      const drawerEl = options.wrapper.querySelector('[data-blok-database-drawer]');

      drawer.open(row2);

      const drawerElAfter = options.wrapper.querySelector('[data-blok-database-drawer]');

      expect(drawerElAfter).toBe(drawerEl);
    });

    it('updates the title input to the new card title', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'First card' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': 'Second card' } });

      drawer.open(row1);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.value).toBe('First card');

      drawer.open(row2);

      expect(titleInput.value).toBe('Second card');
    });

    it('updates the status pill to the new option', () => {
      const option1 = makeOption({ id: 'opt-1', label: 'To Do', color: 'red' });
      const option2 = makeOption({ id: 'opt-2', label: 'Done', color: 'green' });
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [option1, option2] } }),
      ];
      const options = createOptions({ schema });
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'Card 1', 'prop-status': 'opt-1' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': 'Card 2', 'prop-status': 'opt-2' } });

      drawer.open(row1);

      const pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill!.textContent).toBe('To Do');

      drawer.open(row2);

      const pillAfter = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pillAfter!.textContent).toBe('Done');
    });

    it('stays open throughout the switch', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1' });
      const row2 = makeRow({ id: 'row-2' });

      drawer.open(row1);

      expect(drawer.isOpen).toBe(true);

      drawer.open(row2);

      expect(drawer.isOpen).toBe(true);
    });

    it('fires onTitleChange with the new row id after switching', () => {
      const onTitleChange = vi.fn();
      const options = createOptions({ onTitleChange });
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'First' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': 'Second' } });

      drawer.open(row1);
      drawer.open(row2);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      titleInput.value = 'Edited';
       
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onTitleChange).toHaveBeenCalledWith('row-2', 'Edited');
    });

    it('ignores a late migration sync for a card the user switched away from', () => {
      const onTitleChange = vi.fn();
      const options = createOptions({ onTitleChange });
      const drawer = new DatabaseCardDrawer(options);
      const rowA = makeRow({ id: 'row-a', properties: { 'prop-title': 'Card A' } });
      const rowB = makeRow({ id: 'row-b', properties: { 'prop-title': 'Card B' } });

      drawer.open(rowA);
      drawer.open(rowB);
      drawer.syncOpenRow({ ...rowA, pageId: 'page-a' });

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;

      expect(titleInput.value).toBe('Card B');
      titleInput.value = 'Edited B';
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onTitleChange).toHaveBeenCalledWith('row-b', 'Edited B');
      expect(drawer.openRowId).toBe('row-b');
    });

    it('only has one drawer element in the DOM after switching', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1' });
      const row2 = makeRow({ id: 'row-2' });

      drawer.open(row1);
      drawer.open(row2);

      const drawers = options.wrapper.querySelectorAll('[data-blok-database-drawer]');

      expect(drawers).toHaveLength(1);
    });

    it('does nothing when the same card is clicked again', () => {
      const onTitleChange = vi.fn();
      const options = createOptions({ onTitleChange });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ id: 'row-1', properties: { 'prop-title': 'Original' } });

      drawer.open(row);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      titleInput.value = 'Edited locally';

      drawer.open(makeRow({ id: 'row-1', properties: { 'prop-title': 'Original' } }));

      // Title should still show the locally-edited value, not be reset
      expect(titleInput.value).toBe('Edited locally');
    });
  });

  describe('auto-focus on empty title', () => {
    it('calls focus() on title input after open animation when card title is empty', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ id: 'row-1', properties: { 'prop-title': '' } });

      drawer.open(row);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;
      const focusSpy = vi.spyOn(titleInput, 'focus');

      // Trigger rAF to set width, then fire transitionend to trigger focus
      rafCallbacks.forEach((cb) => cb(0));

      const drawerEl = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      drawerEl.dispatchEvent(new Event('transitionend'));

      expect(focusSpy).toHaveBeenCalled();

      // Verify the title input is present in the DOM and is an empty textarea (auto-focus target)
      expect(titleInput.tagName).toBe('TEXTAREA');
      expect(titleInput.value).toBe('');
    });

    it('focuses an empty title when no transitionend ever comes (reduced motion)', () => {
      vi.useFakeTimers();

      try {
        const rafCallbacks: FrameRequestCallback[] = [];

        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
          rafCallbacks.push(cb);

          return 0;
        });

        const options = createOptions();
        const drawer = new DatabaseCardDrawer(options);

        drawer.open(makeRow({ id: 'row-1', properties: { 'prop-title': '' } }));

        const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;
        const focusSpy = vi.spyOn(titleInput, 'focus');

        rafCallbacks.forEach((cb) => cb(0));
        vi.advanceTimersByTime(1000);

        expect(focusSpy).toHaveBeenCalledTimes(1);
        drawer.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not call focus() on title input when card has a title', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ id: 'row-1', properties: { 'prop-title': 'Has title' } });

      drawer.open(row);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;
      const focusSpy = vi.spyOn(titleInput, 'focus');

      rafCallbacks.forEach((cb) => cb(0));

      const drawerEl = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      drawerEl.dispatchEvent(new Event('transitionend'));

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it('calls focus() on title input when switching to a card with empty title', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1', properties: { 'prop-title': 'Has title' } });
      const row2 = makeRow({ id: 'row-2', properties: { 'prop-title': '' } });

      drawer.open(row1);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;
      const focusSpy = vi.spyOn(titleInput, 'focus');

      drawer.open(row2);

      expect(focusSpy).toHaveBeenCalled();
      expect(titleInput.value).toBe('');
    });
  });

  describe('active card state', () => {
    const createWrapperWithCards = (...rowIds: string[]): HTMLElement => {
      const wrapper = document.createElement('div');

      for (const id of rowIds) {
        const cardEl = document.createElement('div');

        cardEl.setAttribute('data-blok-database-card', '');
        cardEl.setAttribute('data-row-id', id);
        wrapper.appendChild(cardEl);
      }

      return wrapper;
    };

    it('sets data-blok-database-card-active on the opened card element', () => {
      const wrapper = createWrapperWithCards('row-1', 'row-2');
      const options = createOptions({ wrapper });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ id: 'row-1' });

      drawer.open(row);

      const cardEl = wrapper.querySelector('[data-row-id="row-1"]') as HTMLElement;

      expect(cardEl.hasAttribute('data-blok-database-card-active')).toBe(true);
    });

    it('does not set active on other cards', () => {
      const wrapper = createWrapperWithCards('row-1', 'row-2');
      const options = createOptions({ wrapper });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ id: 'row-1' });

      drawer.open(row);

      const otherCard = wrapper.querySelector('[data-row-id="row-2"]') as HTMLElement;

      expect(otherCard.hasAttribute('data-blok-database-card-active')).toBe(false);
    });

    it('moves active state to the new card when switching', () => {
      const wrapper = createWrapperWithCards('row-1', 'row-2');
      const options = createOptions({ wrapper });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(makeRow({ id: 'row-1' }));
      drawer.open(makeRow({ id: 'row-2' }));

      const card1 = wrapper.querySelector('[data-row-id="row-1"]') as HTMLElement;
      const card2 = wrapper.querySelector('[data-row-id="row-2"]') as HTMLElement;

      expect(card1.hasAttribute('data-blok-database-card-active')).toBe(false);
      expect(card2.hasAttribute('data-blok-database-card-active')).toBe(true);
    });

    it('removes active state when drawer is closed', () => {
      const wrapper = createWrapperWithCards('row-1');
      const options = createOptions({ wrapper });
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(makeRow({ id: 'row-1' }));

      const cardEl = wrapper.querySelector('[data-row-id="row-1"]') as HTMLElement;

      expect(cardEl.hasAttribute('data-blok-database-card-active')).toBe(true);

      drawer.close();

      expect(cardEl.hasAttribute('data-blok-database-card-active')).toBe(false);
    });
  });

  describe('click outside to close', () => {
    it('closes a center peek when mousedown fires outside it', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row, 'center');
      onClose.mockClear();

       
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does NOT close when mousedown fires inside the drawer', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      onClose.mockClear();

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLElement;

       
      titleInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does NOT close when mousedown fires inside a popover portaled to document.body', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      onClose.mockClear();

      // Simulate a popover that is portaled to document.body (outside the drawer DOM)
      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover-opened', 'true');

      const popoverItem = document.createElement('button');

      popover.appendChild(popoverItem);
      document.body.appendChild(popover);

      try {
         
        popoverItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(drawer.isOpen).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        drawer.destroy();
        document.body.removeChild(popover);
      }
    });

    it('does NOT close when mousedown fires inside a tab bar element', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      onClose.mockClear();

      // Simulate a tab bar that sits outside the drawer DOM
      const tabBar = document.createElement('div');

      tabBar.setAttribute('data-blok-database-tab-bar', '');

      const tab = document.createElement('button');

      tabBar.appendChild(tab);
      document.body.appendChild(tabBar);

      try {
         
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(drawer.isOpen).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        drawer.destroy();
        document.body.removeChild(tabBar);
      }
    });

    it('does NOT close when mousedown fires inside DatabasePropertyTypePopover (data-blok-popover-opened)', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      onClose.mockClear();

      // Simulate the property-type popover portaled to document.body with
      // data-blok-popover-opened set (the attribute the drawer exempts)
      const propertyTypePopover = document.createElement('div');

      propertyTypePopover.setAttribute('data-blok-database-property-type-popover', '');
      propertyTypePopover.setAttribute('data-blok-popover-opened', '');

      const typeOption = document.createElement('div');

      typeOption.setAttribute('data-blok-database-property-type-option', 'text');
      propertyTypePopover.appendChild(typeOption);
      document.body.appendChild(propertyTypePopover);

      try {
         
        typeOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(drawer.isOpen).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        drawer.destroy();
        document.body.removeChild(propertyTypePopover);
      }
    });

    it('removes mousedown listener after close', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      drawer.open(row);
      drawer.close();

      expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    });
  });

  describe('nested editor tools config', () => {
    beforeEach(async () => {
      // Ensure any pending dynamic imports from prior tests resolve before
      // we set up our own module mock, preventing stale calls from polluting
      // the mock call list.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('passes toolsConfig to the nested Blok instance', async () => {
      const mockBlokConstructor = vi.fn().mockReturnValue({
        isReady: Promise.resolve(),
        save: vi.fn().mockResolvedValue({ blocks: [] }),
        destroy: vi.fn(),
      });

      vi.resetModules();
      vi.doMock('../../../../src/blok', () => ({
        Blok: mockBlokConstructor,
      }));

      const { DatabaseCardDrawer: DrawerWithMock } = await import(
        '../../../../src/tools/database/database-card-drawer'
      );

      const toolsConfig: ToolsConfig = {
        tools: {
          paragraph: { class: class {} as never },
          header: { class: class {} as never },
        },
        inlineToolbar: ['bold', 'italic'],
      };
      const options = createOptions({ toolsConfig });
      const drawer = new DrawerWithMock(options);
      const row = makeRow();

      drawer.open(row);

      /*
       * Wait for a call that has the expected toolsConfig.tools reference.
       *
       * Explicit timeout: `vi.waitFor` defaults to 1s and, unlike a test's own
       * budget, is NOT raised by preflight's `--testTimeout`. The drawer builds
       * its nested editor across a dynamic import and an animation frame, which
       * costs ~300ms here but has measured >5s on a worker starved by a full
       * parallel suite — so the default made this describe go red whenever the
       * suite grew, with nothing wrong in the drawer. Does not slow a healthy run.
       */
      await vi.waitFor(() => {
        const callWithTools = mockBlokConstructor.mock.calls.find(
          ([cfg]) => cfg.tools === toolsConfig.tools,
        );

        expect(callWithTools).toBeDefined();
      }, { timeout: 20000 });

      const callWithTools = mockBlokConstructor.mock.calls.find(
        ([cfg]) => cfg.tools === toolsConfig.tools,
      );
      const blokConfig = callWithTools![0];

      expect(blokConfig.tools).toBe(toolsConfig.tools);
      expect(blokConfig.inlineToolbar).toEqual(['bold', 'italic']);

      drawer.destroy();
      vi.doMock('../../../../src/blok', stubBlokModule);
    });

    it('creates nested Blok without tools when toolsConfig is not provided', async () => {
      const mockBlokConstructor = vi.fn().mockReturnValue({
        isReady: Promise.resolve(),
        save: vi.fn().mockResolvedValue({ blocks: [] }),
        destroy: vi.fn(),
      });

      vi.resetModules();
      vi.doMock('../../../../src/blok', () => ({
        Blok: mockBlokConstructor,
      }));

      const { DatabaseCardDrawer: DrawerWithMock } = await import(
        '../../../../src/tools/database/database-card-drawer'
      );

      const options = createOptions();
      const drawer = new DrawerWithMock(options);
      const row = makeRow();

      drawer.open(row);

      // Wait for a call originating from this drawer's editor holder.
      // Explicit timeout for the same reason as its sibling above.
      await vi.waitFor(() => {
        const editorHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');
        const matchingCall = mockBlokConstructor.mock.calls.find(
          ([cfg]) => cfg.holder === editorHolder,
        );

        expect(matchingCall).toBeDefined();
      }, { timeout: 20000 });

      const editorHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');
      const matchingCall = mockBlokConstructor.mock.calls.find(
        ([cfg]) => cfg.holder === editorHolder,
      );
      const blokConfig = matchingCall![0];

      expect(blokConfig.tools).toBeUndefined();

      drawer.destroy();
      vi.doMock('../../../../src/blok', stubBlokModule);
    });
  });

  it('keeps the page body mounted when a prior card editor import finishes', async () => {
    await vi.dynamicImportSettled();

    const gate = { release: () => {} };
    const blockedImport = new Promise<void>((resolve) => { gate.release = resolve; });
    const mockBlokConstructor = vi.fn(function mockNestedEditor(config: { holder: HTMLElement }) {
      config.holder.replaceChildren(document.createTextNode('Legacy A'));

      return { isReady: Promise.resolve(), save: vi.fn().mockResolvedValue({ blocks: [] }), destroy: vi.fn() };
    });
    const importFactory = vi.fn(async () => {
      await blockedImport;

      return { Blok: mockBlokConstructor };
    });

    vi.resetModules();
    vi.doMock('../../../../src/blok', importFactory);

    const { DatabaseCardDrawer: DrawerWithMock } = await import('../../../../src/tools/database/database-card-drawer');
    const rowPages = {
      copyFromLegacy: vi.fn(async () => ({
        pageId: 'unused',
        transactionId: 'unused',
        acceptedBody: { blocks: [] },
      })),
      lookup: vi.fn(async () => null),
      reconcileLegacy: vi.fn(async () => { throw new Error('unexpected reconcile'); }),
      mount: vi.fn((_pageId: string, holder: HTMLElement) => {
        holder.replaceChildren(document.createTextNode('Page B'));

        return { destroy: vi.fn() };
      }),
    };
    const options = createOptions({ rowPages });
    const drawer = new DrawerWithMock(options);

    try {
      drawer.open(makeRow({ id: 'row-a', properties: { 'prop-title': 'Card A' } }));
      await vi.waitFor(() => { expect(importFactory).toHaveBeenCalled(); });
      drawer.open(makeRow({ id: 'row-b', pageId: 'page-b', properties: { 'prop-title': 'Card B' } }));

      gate.release();
      await vi.dynamicImportSettled();

      const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

      expect(holder?.textContent).toBe('Page B');
      expect(drawer.openRowId).toBe('row-b');
    } finally {
      gate.release();
      await vi.dynamicImportSettled();
      drawer.destroy();
      vi.doMock('../../../../src/blok', stubBlokModule);
    }
  }, 20000);

  it('destroys a legacy editor closed before it becomes ready', async () => {
    await vi.dynamicImportSettled();

    const mockBlokConstructor = vi.fn(function fakeNestedEditor(config: { holder: HTMLElement }) {
      const body = document.createElement('div');

      body.textContent = 'Legacy A';
      config.holder.appendChild(body);

      return {
        isReady: new Promise<void>(() => {}),
        destroy: () => { body.remove(); },
      };
    });

    vi.resetModules();
    vi.doMock('../../../../src/blok', () => ({ Blok: mockBlokConstructor }));

    const { DatabaseCardDrawer: DrawerWithMock } = await import('../../../../src/tools/database/database-card-drawer');
    const options = createOptions();
    const drawer = new DrawerWithMock(options);

    try {
      drawer.open(makeRow({ id: 'row-a' }));

      const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

      await vi.waitFor(() => { expect(holder?.textContent).toBe('Legacy A'); }, { timeout: 20000 });

      drawer.close();

      expect(holder?.textContent).toBe('');
    } finally {
      await vi.dynamicImportSettled();
      drawer.destroy();
      vi.doMock('../../../../src/blok', stubBlokModule);
    }
  }, 20000);

  it('keeps a page-backed card mounted while the prior legacy save finishes', async () => {
    await vi.dynamicImportSettled();

    const savedBody: OutputData = {
      blocks: [{ id: 'a-body', type: 'paragraph', data: { text: 'Changed A' } }],
    };
    const gate = { release: (_data: OutputData) => {} };
    const pendingSave = new Promise<OutputData>((resolve) => { gate.release = resolve; });
    const mockBlokConstructor = vi.fn(function fakeNestedEditor(config: { holder: HTMLElement }) {
      const holder = config.holder;

      holder.textContent = 'Legacy A';

      return {
        isReady: Promise.resolve(),
        save: () => pendingSave,
        destroy: () => { holder.replaceChildren(); },
      };
    });

    vi.resetModules();
    vi.doMock('../../../../src/blok', () => ({ Blok: mockBlokConstructor }));

    const { DatabaseCardDrawer: DrawerWithMock } = await import('../../../../src/tools/database/database-card-drawer');
    const rowPages = {
      copyFromLegacy: vi.fn(async () => ({
        pageId: 'unused',
        transactionId: 'unused',
        acceptedBody: { blocks: [] },
      })),
      lookup: vi.fn(async () => null),
      reconcileLegacy: vi.fn(async () => { throw new Error('unexpected reconcile'); }),
      mount: vi.fn((_pageId: string, holder: HTMLElement) => {
        const pageContent = document.createElement('div');

        pageContent.textContent = 'Page B';
        holder.replaceChildren(pageContent);

        return { destroy: () => { holder.replaceChildren(); } };
      }),
    };
    const options = createOptions({ descriptionPropertyId: 'prop-desc', rowPages });

    document.body.appendChild(options.wrapper);

    const drawer = new DrawerWithMock(options);

    try {
      drawer.open(makeRow({ id: 'row-a' }));

      const firstHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

      await vi.waitFor(() => { expect(firstHolder?.textContent).toBe('Legacy A'); }, { timeout: 20000 });

      drawer.open(makeRow({ id: 'row-b', pageId: 'page-b' }));

      const activeHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

      expect(activeHolder?.textContent).toBe('Page B');

      gate.release(savedBody);
      await pendingSave;

      expect(options.onDescriptionChange).toHaveBeenCalledWith('row-a', savedBody);
      expect(activeHolder?.textContent).toBe('Page B');

      const pageContent = activeHolder?.firstElementChild;

      if (pageContent === null || pageContent === undefined) {
        throw new Error('Page B was not mounted');
      }

      pageContent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(drawer.openRowId).toBe('row-b');
    } finally {
      gate.release(savedBody);
      await pendingSave;
      drawer.destroy();
      options.wrapper.remove();
      vi.doMock('../../../../src/blok', stubBlokModule);
    }
  }, 20000);

  describe('page body writes', () => {
    type NestedConfig = { holder: HTMLElement; onChange: () => Promise<void> };

    const body = (time: number, blocks: Array<Record<string, unknown>>): Record<string, unknown> => ({
      time,
      version: '1',
      blocks,
    });

    /** Opens a card over a fake nested editor whose save() returns `saves` in turn. */
    const openWithNestedEditor = async (
      row: DatabaseRow,
      saves: Array<Record<string, unknown> | Promise<Record<string, unknown>>>
    ): Promise<{ drawer: DatabaseCardDrawer; options: CardDrawerOptions; config: NestedConfig }> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const save = vi.fn();

      saves.forEach((value) => save.mockResolvedValueOnce(value));
      const nested = { isReady: Promise.resolve(), save, destroy: vi.fn() };
      const mockBlokConstructor = vi.fn(function construct(_cfg: NestedConfig) {
        return nested;
      });

      vi.resetModules();
      vi.doMock('../../../../src/blok', () => ({ Blok: mockBlokConstructor }));

      const { DatabaseCardDrawer: DrawerWithMock } = await import('../../../../src/tools/database/database-card-drawer');
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = new DrawerWithMock(options);

      drawer.open(row);

      const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

      await vi.waitFor(() => {
        expect(mockBlokConstructor.mock.calls.some(([cfg]) => cfg.holder === holder)).toBe(true);
      }, { timeout: 20000 });

      const config = mockBlokConstructor.mock.calls.find(([cfg]) => cfg.holder === holder)?.[0];

      if (config === undefined) {
        throw new Error('nested editor was not constructed');
      }

      vi.doMock('../../../../src/blok', stubBlokModule);

      return { drawer, options, config };
    };

    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    it('writes nothing when a card with no page body is closed unedited', async () => {
      const { drawer, options } = await openWithNestedEditor(makeRow(), [body(1, [])]);

      drawer.close();
      await flush();

      expect(options.onDescriptionChange).not.toHaveBeenCalled();
    });

    it('writes nothing on close when only the save time moved since the last write', async () => {
      const typed = { id: 'b1', type: 'paragraph', data: { text: 'body' } };
      const { drawer, options, config } = await openWithNestedEditor(makeRow(), [
        body(1, [{ ...typed, lastEditedAt: 100 }]),
        body(2, [{ ...typed, lastEditedAt: 200 }]),
      ]);

      await config.onChange();
      drawer.close();
      await flush();

      expect(options.onDescriptionChange).toHaveBeenCalledTimes(1);
    });

    it('still writes a page body that changed', async () => {
      const { drawer, options } = await openWithNestedEditor(makeRow(), [
        body(1, [{ id: 'b1', type: 'paragraph', data: { text: 'new' } }]),
      ]);

      drawer.close();
      await flush();

      expect(options.onDescriptionChange).toHaveBeenCalledTimes(1);
    });

    it('delivers an earlier successful body when the newer save fails', async () => {
      const firstBody = body(1, [{ id: 'b1', type: 'paragraph', data: { text: 'first edit' } }]);
      const gate = { release: () => {} };
      const pendingLatest = new Promise<void>((resolve) => { gate.release = resolve; })
        .then(() => { throw new Error('newer save failed'); });
      const { drawer, options, config } = await openWithNestedEditor(makeRow(), [
        firstBody,
        pendingLatest,
        firstBody,
      ]);

      const firstSave = config.onChange();
      const secondSave = config.onChange();

      await firstSave;
      const deliveredWhilePending = vi.mocked(options.onDescriptionChange).mock.calls.length;

      gate.release();
      await secondSave;
      drawer.destroy();
      await flush();

      expect(options.onDescriptionChange).toHaveBeenCalledWith('row-1', firstBody);
      expect(options.onDescriptionChange).toHaveBeenCalledTimes(1);
      expect(deliveredWhilePending).toBe(0);
    });

    it('drops the old page body instead of writing it back when undo or a peer changed it', async () => {
      const before: OutputData = { time: 1, version: '1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'before' } }] };
      const after: OutputData = { time: 2, version: '1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'after' } }] };
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-desc': before } });
      const { drawer, options } = await openWithNestedEditor(row, [{ ...before }]);

      drawer.syncOpenRow({ ...row, properties: { ...row.properties, 'prop-desc': after } });
      await flush();

      expect(options.onDescriptionChange).not.toHaveBeenCalled();

      drawer.destroy();
    });
  });

  describe('close animation', () => {
    it('slides the drawer out on close by dropping its open mark', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      drawer.close();

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el).not.toBeNull();
      expect(el.hasAttribute('data-open')).toBe(false);
      expect(el.style.width).toBe('');
    });

    it('keeps drawer in DOM until transitionend fires', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      drawer.close();

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    });

    it('removes drawer from DOM after transitionend fires', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      drawer.close();

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      el.dispatchEvent(new Event('transitionend'));

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    });

    it('removes the closed drawer when no transitionend ever comes (reduced motion)', () => {
      vi.useFakeTimers();

      try {
        const options = createOptions();
        const drawer = new DatabaseCardDrawer(options);

        drawer.open(makeRow());
        drawer.close();
        vi.advanceTimersByTime(1000);

        expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('isOpen returns false immediately before animation ends', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      drawer.close();

      expect(drawer.isOpen).toBe(false);
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    });

    it('destroy removes drawer immediately without exit animation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
      drawer.destroy();

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    });

    it('removes animating-out drawer when opening a new card', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1' });
      const row2 = makeRow({ id: 'row-2' });

      drawer.open(row1);
      drawer.close();

      // Old drawer is still animating out
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

      drawer.open(row2);

      // Only one drawer should exist (the new one)
      const drawers = options.wrapper.querySelectorAll('[data-blok-database-drawer]');

      expect(drawers).toHaveLength(1);

      // Its editor import resolves late, after the last test swaps in the real editor.
      drawer.destroy();
    });
  });

  describe('"Add a property" button', () => {
    it('renders [data-blok-database-drawer-add-prop] button when not read-only', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];
      const options = createOptions({ readOnly: false, schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]');

      expect(addPropBtn).not.toBeNull();
    });

    it('button label comes from tools.database.addProperty', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];
      const options = createOptions({ readOnly: false, schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]');

      // The plus is a glyph now (R13), so the text is the label alone.
      expect(addPropBtn!.textContent?.trim()).toBe('tools.database.addProperty');
    });

    it('does NOT render [data-blok-database-drawer-add-prop] button in read-only mode', () => {
      const schema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];
      const options = createOptions({ readOnly: true, schema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]');

      expect(addPropBtn).toBeNull();
    });

    it('renders button even when schema has no renderable properties (empty schema)', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]');

      expect(addPropBtn).not.toBeNull();
    });

    it('clicking the button opens a DatabasePropertyTypePopover in the peek', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      // The menu mounts in the peek, which is in the document.
      document.body.appendChild(options.wrapper);
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]') as HTMLButtonElement;

      addPropBtn.click();

      const popover = document.body.querySelector('[data-blok-database-property-type-popover]');

      expect(popover).not.toBeNull();

      drawer.destroy();
      popover?.remove();
    });

    it('selecting a type from the popover calls onAddProperty(type)', () => {
      const onAddProperty = vi.fn();
      const options = createOptions({ readOnly: false, schema: [], onAddProperty });
      // The menu mounts in the peek, which is in the document.
      document.body.appendChild(options.wrapper);
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]') as HTMLButtonElement;

      addPropBtn.click();

      const textOption = document.body.querySelector('[data-blok-database-property-type-option="text"]') as HTMLElement;

      expect(textOption).not.toBeNull();

      textOption.click();

      expect(onAddProperty).toHaveBeenCalledWith('text', '');

      drawer.destroy();
    });

    it('selecting a type from the popover closes the popover', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      // The menu mounts in the peek, which is in the document.
      document.body.appendChild(options.wrapper);
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]') as HTMLButtonElement;

      addPropBtn.click();

      const textOption = document.body.querySelector('[data-blok-database-property-type-option="text"]') as HTMLElement;

      textOption.click();

      const popoverAfter = document.body.querySelector('[data-blok-database-property-type-popover]');

      expect(popoverAfter).toBeNull();

      drawer.destroy();
    });

    it('does not throw when onAddProperty is not provided and user selects a type', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      // no onAddProperty callback
      // The menu mounts in the peek, which is in the document.
      document.body.appendChild(options.wrapper);
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]') as HTMLButtonElement;

      addPropBtn.click();

      const textOption = document.body.querySelector('[data-blok-database-property-type-option="text"]') as HTMLElement;

      expect(() => textOption.click()).not.toThrow();

      drawer.destroy();
    });
  });

  describe('refreshSchema()', () => {
    it('updates the displayed properties when drawer is open', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      // initially no prop rows
      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-row]')).toHaveLength(0);

      const newSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption({ id: 'opt-1', label: 'In progress' })] } }),
      ];

      drawer.refreshSchema(newSchema);

      const propRows = options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-row]');

      expect(propRows).toHaveLength(1);
    });

    it('displays new property value from current row after refreshSchema()', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } });

      drawer.open(row);

      const newSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption({ id: 'opt-1', label: 'In progress' })] } }),
      ];

      drawer.refreshSchema(newSchema);

      const pill = options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]');

      expect(pill).not.toBeNull();
      expect(pill!.textContent).toBe('In progress');
    });

    it('does nothing (no crash) when drawer is closed', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      const drawer = new DatabaseCardDrawer(options);
      // drawer is never opened
      const newSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];

      expect(() => drawer.refreshSchema(newSchema)).not.toThrow();
    });

    it('replaces the [data-blok-database-drawer-props] section in-place', () => {
      const initialSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-notes', name: 'Notes', type: 'text', position: 'a1' }),
      ];
      const options = createOptions({ readOnly: false, schema: initialSchema });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card', 'prop-notes': 'hello' } });

      drawer.open(row);

      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-props]')).toHaveLength(1);

      const newSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-notes', name: 'Notes', type: 'text', position: 'a1' }),
        makePropertyDef({ id: 'prop-count', name: 'Count', type: 'number', position: 'a2' }),
      ];

      drawer.refreshSchema(newSchema);

      // still only one props section
      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-props]')).toHaveLength(1);
      // now two prop rows
      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-row]')).toHaveLength(2);
    });

    it('shows "Add a property" button in the refreshed props section when not read-only', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const newSchema: PropertyDefinition[] = [
        makePropertyDef({ id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: { options: [makeOption()] } }),
      ];

      drawer.refreshSchema(newSchema);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]');

      expect(addPropBtn).not.toBeNull();
    });

    it('destroy() cleans up the propertyTypePopover if it was opened', () => {
      const options = createOptions({ readOnly: false, schema: [] });
      // The menu mounts in the peek, which is in the document.
      document.body.appendChild(options.wrapper);
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow({ properties: { 'prop-title': 'Card' } });

      drawer.open(row);

      const addPropBtn = options.wrapper.querySelector('[data-blok-database-drawer-add-prop]') as HTMLButtonElement;

      addPropBtn.click();

      expect(document.body.querySelector('[data-blok-database-property-type-popover]')).not.toBeNull();

      drawer.destroy();

      expect(document.body.querySelector('[data-blok-database-property-type-popover]')).toBeNull();
    });
  });

  it('mounts one legacy body after opening A, B, then A before imports settle', async () => {
    vi.resetModules();
    vi.doUnmock('../../../../src/blok');

    const { Paragraph } = await import('../../../../src/tools/paragraph');
    const { DatabaseCardDrawer: DrawerWithRealBlok } = await import('../../../../src/tools/database/database-card-drawer');
    const { readyState } = await import('../../../../src/components/utils/ready-registry');
    const options = createOptions({
      toolsConfig: { tools: { paragraph: { class: Paragraph } } },
    });

    document.body.appendChild(options.wrapper);

    const drawer = new DrawerWithRealBlok(options);
    const rowA = makeRow({ id: 'row-a' });
    const rowB = makeRow({ id: 'row-b' });

    drawer.open(rowA);
    drawer.open(rowB);
    drawer.open(rowA);

    const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

    if (holder === null) {
      throw new Error('Editor holder was not mounted');
    }

    try {
      expect(holder.querySelector('[data-blok-editor]')).toBeNull();
      await vi.dynamicImportSettled();
      await vi.waitFor(() => { expect(holder.querySelector('[data-blok-editor]')).not.toBeNull(); });

      expect(holder.querySelectorAll('[data-blok-editor]')).toHaveLength(1);
    } finally {
      await vi.dynamicImportSettled();
      drawer.destroy();
      options.wrapper.remove();
      // The drawer destroys the editor only after its last save settles. A live
      // editor's debounced selectionchange timer fires after jsdom is gone.
      await vi.waitFor(() => { expect(holder.querySelector('[data-blok-editor]')).toBeNull(); }, { timeout: 10000 });
      vi.doMock('../../../../src/blok', stubBlokModule);
    }

    // Catches a drawer from an earlier test whose late import booted a real editor here.
    expect(readyState().total).toBe(0);
  }, 20000);
});
