import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { KanbanCardData, KanbanColumnData } from '../../../../src/tools/database/types';
import type { ToolsConfig } from '../../../../types/api/tools';

const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: 'card-1',
  columnId: 'col-1',
  position: 'a0',
  title: 'Test card',
  ...overrides,
});

const makeColumn = (overrides: Partial<KanbanColumnData> = {}): KanbanColumnData => ({
  id: 'col-1',
  title: 'In progress',
  color: 'blue',
  position: 'a1',
  ...overrides,
});

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DatabaseCardDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a drawer element ([data-blok-database-drawer]) when opened', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]');

    expect(el).not.toBeNull();
    expect(drawer.isOpen).toBe(true);
  });

  it('removes drawer element when closed after transition completes', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

    drawer.close();

    expect(drawer.isOpen).toBe(false);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

    el.dispatchEvent(new Event('transitionend'));

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
  });

  it('calls onTitleChange(cardId, newTitle) when title input fires input event', () => {
    const onTitleChange = vi.fn();
    const options = createOptions({ onTitleChange });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard({ id: 'card-42', title: 'Original title' });

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();

    titleInput.value = 'Updated title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onTitleChange).toHaveBeenCalledWith('card-42', 'Updated title');
  });

  it('calls onClose when close button ([data-blok-database-drawer-close]) is clicked', () => {
    const onClose = vi.fn();
    const options = createOptions({ onClose });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables title input (readOnly = true) in read-only mode', () => {
    const options = createOptions({ readOnly: true });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();
    expect(titleInput.readOnly).toBe(true);
  });

  describe('layout', () => {
    it('drawer has data attribute for CSS styling', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el).not.toBeNull();
      expect(el.hasAttribute('data-blok-database-drawer')).toBe(true);
    });

    it('drawer contains a toolbar, content area, and editor holder', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      expect(options.wrapper.querySelector('[data-blok-database-drawer-toolbar]')).not.toBeNull();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-content]')).not.toBeNull();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-editor]')).not.toBeNull();
    });

    it('drawer opens to 45% width after animation frame', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      rafCallbacks.forEach((cb) => cb(0));

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.width).toBe('45%');
    });
  });

  describe('accessibility', () => {
    it('drawer has role="complementary" and aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.getAttribute('role')).toBe('complementary');
      expect(el.getAttribute('aria-label')).toBeTruthy();
    });

    it('close button has aria-label="Close"', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });

    it('title input has aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('styling', () => {
    it('close button contains chevron SVG icons', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.querySelectorAll('svg').length).toBe(2);
    });

    it('title input has "Untitled" placeholder', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.placeholder).toBe('Untitled');
    });
  });

  describe('properties section', () => {
    it('shows status property with column title when column is provided', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();
      const column = makeColumn({ title: 'In progress', color: 'blue' });

      drawer.open(card, column);

      const propLabel = options.wrapper.querySelector('[data-blok-database-drawer-prop-label]');
      const statusPill = options.wrapper.querySelector('[data-blok-database-drawer-status-pill]');

      expect(propLabel).not.toBeNull();
      expect(propLabel!.textContent).toBe('Status');
      expect(statusPill).not.toBeNull();
      expect(statusPill!.textContent).toBe('In progress');
    });

    it('status pill has colored dot when column has color', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();
      const column = makeColumn({ color: 'green' });

      drawer.open(card, column);

      const dot = options.wrapper.querySelector('[data-blok-database-drawer-status-dot]');

      expect(dot).not.toBeNull();
    });

    it('does not show properties section when no column is provided', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const propsSection = options.wrapper.querySelector('[data-blok-database-drawer-props]');

      expect(propsSection).toBeNull();
    });
  });

  describe('close notification consistency', () => {
    it('calls onClose callback when close() is called directly', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      onClose.mockClear();

      drawer.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose callback when open() is called while already open', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card1 = makeCard({ id: 'card-1' });
      const card2 = makeCard({ id: 'card-2' });

      drawer.open(card1);
      onClose.mockClear();

      drawer.open(card2);

      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('click outside to close', () => {
    it('closes drawer when mousedown fires outside the drawer', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      onClose.mockClear();

      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does NOT close when mousedown fires inside the drawer', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      onClose.mockClear();

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLElement;

      titleInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('removes mousedown listener after close', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      drawer.open(card);
      drawer.close();

      expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    });
  });

  describe('nested editor tools config', () => {
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
      const card = makeCard();

      drawer.open(card);

      await vi.waitFor(() => {
        expect(mockBlokConstructor).toHaveBeenCalledOnce();
      });

      const blokConfig = mockBlokConstructor.mock.calls[0][0];

      expect(blokConfig.tools).toBe(toolsConfig.tools);
      expect(blokConfig.inlineToolbar).toEqual(['bold', 'italic']);

      drawer.destroy();
      vi.doUnmock('../../../../src/blok');
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
      const card = makeCard();

      drawer.open(card);

      await vi.waitFor(() => {
        expect(mockBlokConstructor).toHaveBeenCalledOnce();
      });

      const blokConfig = mockBlokConstructor.mock.calls[0][0];

      expect(blokConfig.tools).toBeUndefined();

      drawer.destroy();
      vi.doUnmock('../../../../src/blok');
    });
  });

  describe('close animation', () => {
    it('sets drawer width to 0 on close for exit animation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      drawer.close();

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el).not.toBeNull();
      expect(el.style.width).toBe('0px');
    });

    it('keeps drawer in DOM until transitionend fires', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      drawer.close();

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    });

    it('removes drawer from DOM after transitionend fires', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      drawer.close();

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      el.dispatchEvent(new Event('transitionend'));

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    });

    it('isOpen returns false immediately before animation ends', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      drawer.close();

      expect(drawer.isOpen).toBe(false);
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    });

    it('destroy removes drawer immediately without exit animation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      drawer.destroy();

      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    });

    it('removes animating-out drawer when opening a new card', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card1 = makeCard({ id: 'card-1' });
      const card2 = makeCard({ id: 'card-2' });

      drawer.open(card1);
      drawer.close();

      // Old drawer is still animating out
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

      drawer.open(card2);

      // Only one drawer should exist (the new one)
      const drawers = options.wrapper.querySelectorAll('[data-blok-database-drawer]');

      expect(drawers).toHaveLength(1);
    });
  });
});
