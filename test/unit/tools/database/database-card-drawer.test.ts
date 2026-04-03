import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseRow, SelectOption } from '../../../../src/tools/database/types';
import type { ToolsConfig } from '../../../../types/api/tools';

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

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  titlePropertyId: 'prop-title',
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

    it('drawer opens to 45% width after animation frame', () => {
      const rafCallbacks: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);

        return 0;
      });

      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      rafCallbacks.forEach((cb) => cb(0));

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.width).toBe('45%');
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

    it('close button has aria-label="Close"', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
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
    it('close button contains chevron SVG icons', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.querySelectorAll('svg').length).toBe(2);
    });

    it('title input has "Empty page" placeholder from i18n', () => {
      const mockI18n = {
        t: vi.fn((key: string) => {
          if (key === 'tools.database.cardTitlePlaceholder') return 'Empty page';

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

      expect(titleInput.placeholder).toBe('Empty page');
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
    it('shows status property with option label when option is provided', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();
      const option = makeOption({ label: 'In progress', color: 'blue' });

      drawer.open(row, option);

      const propLabel = options.wrapper.querySelector('[data-blok-database-drawer-prop-label]');
      const statusPill = options.wrapper.querySelector('[data-blok-database-drawer-status-pill]');

      expect(propLabel).not.toBeNull();
      expect(propLabel!.textContent).toBe('Status');
      expect(statusPill).not.toBeNull();
      expect(statusPill!.textContent).toBe('In progress');
    });

    it('status pill has colored dot when option has color', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();
      const option = makeOption({ color: 'green' });

      drawer.open(row, option);

      const dot = options.wrapper.querySelector('[data-blok-database-drawer-status-dot]');

      expect(dot).not.toBeNull();
    });

    it('does not show properties section when no option is provided', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);

      const propsSection = options.wrapper.querySelector('[data-blok-database-drawer-props]');

      expect(propsSection).toBeNull();
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
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const row1 = makeRow({ id: 'row-1' });
      const row2 = makeRow({ id: 'row-2' });
      const option1 = makeOption({ id: 'opt-1', label: 'To Do', color: 'red' });
      const option2 = makeOption({ id: 'opt-2', label: 'Done', color: 'green' });

      drawer.open(row1, option1);

      const pill = options.wrapper.querySelector('[data-blok-database-drawer-status-pill]');

      expect(pill!.textContent).toBe('To Do');

      drawer.open(row2, option2);

      const pillAfter = options.wrapper.querySelector('[data-blok-database-drawer-status-pill]');

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
    it('closes drawer when mousedown fires outside the drawer', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const row = makeRow();

      drawer.open(row);
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
      const row = makeRow();

      drawer.open(row);

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
      const row = makeRow();

      drawer.open(row);
      drawer.close();

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el).not.toBeNull();
      expect(el.style.width).toBe('0px');
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
    });
  });
});
