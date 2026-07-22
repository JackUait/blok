import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SettingsTogglerHandler } from '../../../../../src/components/modules/toolbar/settings-toggler';
import { ClickDragHandler } from '../../../../../src/components/modules/toolbar/click-handler';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';

/**
 * Test helper type to expose private handleClick method for testing
 * Double cast is needed because the private property is not part of the public type
 */
const exposeHandleClick = (handler: SettingsTogglerHandler): { handleClick: () => void } => {
  return handler as unknown as { handleClick: () => void };
};

/**
 * Test helper type to mock BlockSettings open method
 */
type MockBlockSettings = Partial<Pick<BlockSettings, 'open' | 'close'>> & {
  opened: boolean;
};

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  hide: vi.fn(),
  onHover: vi.fn(),
}));

vi.mock('../../../../../src/components/modules/toolbar/tooltip', () => ({
  createTooltipContent: vi.fn(() => 'tooltip content'),
}));

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string) => document.createElement(tag)),
  },
}));

vi.mock('../../../../../src/components/icons', () => ({
  IconMenu: '<svg></svg>',
}));

vi.mock('../../../../../src/components/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserOS: vi.fn(() => ({ mac: true, win: false, other: false })),
  };
});

describe('SettingsTogglerHandler', () => {
  let settingsTogglerHandler: SettingsTogglerHandler;
  let clickDragHandler: ClickDragHandler;
  let mockBlock: Block;
  let getBlok: () => BlokModules;
  let setHoveredBlockSpy: ReturnType<typeof vi.fn>;
  let cancelTrackingSpy: ReturnType<typeof vi.fn>;
  let readOnlyEnabled: boolean;

  beforeEach(() => {
    vi.clearAllMocks();

    readOnlyEnabled = false;

    clickDragHandler = new ClickDragHandler();

    mockBlock = {
      id: 'test-block-id',
      name: 'paragraph',
      holder: document.createElement('div'),
      isEmpty: true,
    } as unknown as Block;

    setHoveredBlockSpy = vi.fn();
    cancelTrackingSpy = vi.fn();

    /**
     * This simulates the actual Blok modules reference from the Toolbar's perspective.
     * Note that Toolbar is NOT included because getModulesDiff() excludes the current module.
     */
    const blokModules = {
      BlockSettings: {
        opened: false,
        close: vi.fn(),
        open: vi.fn(),
      } satisfies MockBlockSettings,
      BlockManager: {
        currentBlock: mockBlock,
        blocks: [mockBlock],
      },
      DragManager: {
        cancelTracking: cancelTrackingSpy,
      },
      ReadOnly: {
        get isEnabled(): boolean {
          return readOnlyEnabled;
        },
      },
      I18n: {
        t: vi.fn((key: string) => key),
      },
      // Toolbar is NOT here - this is the root cause of the bug
    } as unknown as BlokModules;

    getBlok = () => blokModules;

    settingsTogglerHandler = new SettingsTogglerHandler(
      getBlok,
      clickDragHandler,
      {
        setHoveredBlock: setHoveredBlockSpy as (block: Block) => void,
        getToolboxOpened: () => false,
        closeToolbox: vi.fn(),
      }
    );
  });

  describe('make', () => {
    it('builds tooltip with segment-based second line showing Click and shortcut highlighted on Mac', async () => {
      const { createTooltipContent } = await import('../../../../../src/components/modules/toolbar/tooltip');
      const { getUserOS } = await import('../../../../../src/components/utils');

      (getUserOS as Mock).mockReturnValue({ mac: true, win: false, other: false });

      settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      expect(createTooltipContent).toHaveBeenCalledWith([
        'blockSettings.dragToMove',
        [
          { text: 'blockSettings.clickAction', highlight: true },
          { text: 'blockSettings.orConjunction', highlight: false },
          { text: 'blockSettings.menuShortcutMac', highlight: true },
          { text: 'blockSettings.openMenuAction', highlight: false },
        ],
      ]);
    });

    it('uses Windows shortcut in tooltip second line on Windows', async () => {
      const { createTooltipContent } = await import('../../../../../src/components/modules/toolbar/tooltip');
      const { getUserOS } = await import('../../../../../src/components/utils');

      (getUserOS as Mock).mockReturnValue({ mac: false, win: true, other: false });

      settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      expect(createTooltipContent).toHaveBeenCalledWith([
        'blockSettings.dragToMove',
        [
          { text: 'blockSettings.clickAction', highlight: true },
          { text: 'blockSettings.orConjunction', highlight: false },
          { text: 'blockSettings.menuShortcutWin', highlight: true },
          { text: 'blockSettings.openMenuAction', highlight: false },
        ],
      ]);
    });
  });

  describe('read-only tooltip', () => {
    const emptyNodes = (): Parameters<SettingsTogglerHandler['make']>[0] => ({
      wrapper: undefined,
      content: undefined,
      actions: undefined,
      plusButton: undefined,
      settingsToggler: undefined,
    });

    it('drops the drag line and the shortcut when read-only is enabled', async () => {
      const { createTooltipContent } = await import('../../../../../src/components/modules/toolbar/tooltip');

      readOnlyEnabled = true;

      settingsTogglerHandler.make(emptyNodes());

      expect(createTooltipContent).toHaveBeenCalledWith([
        'blockSettings.clickToOpenMenu',
      ]);
    });

    it('re-binds the tooltip when read-only is toggled after creation', async () => {
      const { createTooltipContent } = await import('../../../../../src/components/modules/toolbar/tooltip');
      const { onHover } = await import('../../../../../src/components/utils/tooltip');

      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      (createTooltipContent as Mock).mockClear();
      (onHover as Mock).mockClear();

      readOnlyEnabled = true;
      settingsTogglerHandler.refreshTooltip();

      expect(createTooltipContent).toHaveBeenCalledWith([
        'blockSettings.clickToOpenMenu',
      ]);
      expect(onHover).toHaveBeenCalledWith(settingsToggler, 'tooltip content', { delay: 500 });
    });
  });

  describe('read-only cursor', () => {
    const emptyNodes = (): Parameters<SettingsTogglerHandler['make']>[0] => ({
      wrapper: undefined,
      content: undefined,
      actions: undefined,
      plusButton: undefined,
      settingsToggler: undefined,
    });

    const grabClasses = [
      'active:cursor-grabbing',
      'can-hover:hover:cursor-grab',
      'group-data-[blok-dragging=true]:cursor-grabbing',
    ];

    it('keeps the grab cursors while editing', () => {
      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      grabClasses.forEach((className) => {
        expect(settingsToggler.classList.contains(className)).toBe(true);
      });
    });

    it('drops the grab cursors when read-only is enabled', () => {
      readOnlyEnabled = true;

      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      grabClasses.forEach((className) => {
        expect(settingsToggler.classList.contains(className)).toBe(false);
      });
    });

    it('re-applies the cursors when read-only is toggled after creation', () => {
      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      readOnlyEnabled = true;
      settingsTogglerHandler.refreshCursor();

      grabClasses.forEach((className) => {
        expect(settingsToggler.classList.contains(className)).toBe(false);
      });

      readOnlyEnabled = false;
      settingsTogglerHandler.refreshCursor();

      grabClasses.forEach((className) => {
        expect(settingsToggler.classList.contains(className)).toBe(true);
      });
    });
  });

  describe('read-only aria-label', () => {
    const emptyNodes = (): Parameters<SettingsTogglerHandler['make']>[0] => ({
      wrapper: undefined,
      content: undefined,
      actions: undefined,
      plusButton: undefined,
      settingsToggler: undefined,
    });

    it('announces the drag affordance while editing', () => {
      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      expect(settingsToggler.getAttribute('aria-label')).toBe('a11y.dragHandle');
      expect(settingsToggler.getAttribute('aria-roledescription')).toBe('a11y.dragHandleRole');
    });

    it('announces only the menu when read-only is enabled', () => {
      readOnlyEnabled = true;

      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      expect(settingsToggler.getAttribute('aria-label')).toBe('blockSettings.clickToOpenMenu');
      expect(settingsToggler.hasAttribute('aria-roledescription')).toBe(false);
      expect(settingsToggler.hasAttribute('aria-keyshortcuts')).toBe(false);
    });

    it('re-applies the labels when read-only is toggled after creation', async () => {
      const { getUserOS } = await import('../../../../../src/components/utils');

      (getUserOS as Mock).mockReturnValue({ mac: true, win: false, other: false });

      const settingsToggler = settingsTogglerHandler.make(emptyNodes());

      readOnlyEnabled = true;
      settingsTogglerHandler.refreshAriaLabel();

      expect(settingsToggler.getAttribute('aria-label')).toBe('blockSettings.clickToOpenMenu');
      expect(settingsToggler.hasAttribute('aria-roledescription')).toBe(false);

      readOnlyEnabled = false;
      settingsTogglerHandler.refreshAriaLabel();

      expect(settingsToggler.getAttribute('aria-label')).toBe('a11y.dragHandle');
      expect(settingsToggler.getAttribute('aria-roledescription')).toBe('a11y.dragHandleRole');
      expect(settingsToggler.getAttribute('aria-keyshortcuts')).toBe(
        'Meta+Shift+ArrowUp Meta+Shift+ArrowDown'
      );
    });
  });

  describe('make - keyboard activation', () => {
    it('activates handleClick on Enter', () => {
      const settingsToggler = settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      settingsTogglerHandler.setHoveredBlock(mockBlock);
      const handleClickSpy = vi.spyOn(exposeHandleClick(settingsTogglerHandler), 'handleClick');

      settingsToggler.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(handleClickSpy).toHaveBeenCalledTimes(1);
    });

    it('activates handleClick on Space and prevents default scroll', () => {
      const settingsToggler = settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      settingsTogglerHandler.setHoveredBlock(mockBlock);
      const handleClickSpy = vi.spyOn(exposeHandleClick(settingsTogglerHandler), 'handleClick');

      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

      settingsToggler.dispatchEvent(event);

      expect(handleClickSpy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores other keys', () => {
      const settingsToggler = settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      const handleClickSpy = vi.spyOn(exposeHandleClick(settingsTogglerHandler), 'handleClick');

      settingsToggler.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(handleClickSpy).not.toHaveBeenCalled();
    });
  });

  describe('make - aria-keyshortcuts', () => {
    it('surfaces the Meta-based move shortcut on Mac', async () => {
      const { getUserOS } = await import('../../../../../src/components/utils');

      (getUserOS as Mock).mockReturnValue({ mac: true, win: false, other: false });

      const settingsToggler = settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      expect(settingsToggler.getAttribute('aria-keyshortcuts')).toBe(
        'Meta+Shift+ArrowUp Meta+Shift+ArrowDown'
      );
    });

    it('surfaces the Control-based move shortcut on Windows', async () => {
      const { getUserOS } = await import('../../../../../src/components/utils');

      (getUserOS as Mock).mockReturnValue({ mac: false, win: true, other: false });

      const settingsToggler = settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });

      expect(settingsToggler.getAttribute('aria-keyshortcuts')).toBe(
        'Control+Shift+ArrowUp Control+Shift+ArrowDown'
      );
    });
  });

  describe('handleClick', () => {
    beforeEach(() => {
      // Call make() to set the settingsTogglerElement
      settingsTogglerHandler.make({
        wrapper: undefined,
        content: undefined,
        actions: undefined,
        plusButton: undefined,
        settingsToggler: undefined,
      });
    });

    it('should not throw when Toolbar is not in Blok modules (Toolbar module excludes itself)', () => {
      // Set the hovered block
      settingsTogglerHandler.setHoveredBlock(mockBlock);

      // This should NOT throw even though blok.Toolbar is undefined
      // This is the core fix - the handler now uses stored element reference
      expect(() => {
        exposeHandleClick(settingsTogglerHandler).handleClick();
      }).not.toThrow();
    });

    it('should open BlockSettings without changing hovered block when settings toggler is clicked', () => {
      settingsTogglerHandler.setHoveredBlock(mockBlock);
      const blok = getBlok();
      const blockSettingsOpenSpy = vi.fn();
      (blok.BlockSettings as MockBlockSettings).open = blockSettingsOpenSpy;

      exposeHandleClick(settingsTogglerHandler).handleClick();

      // Verify BlockSettings.open was called with the target block and settings toggler element
      expect(blockSettingsOpenSpy).toHaveBeenCalledWith(mockBlock, expect.any(HTMLSpanElement));
      // Verify the callback to set hovered block was NOT invoked (to prevent toolbar repositioning)
      expect(setHoveredBlockSpy).not.toHaveBeenCalled();
      // Verify the current block was updated on BlockManager
      expect(blok.BlockManager.currentBlock).toBe(mockBlock);
    });
  });
});
