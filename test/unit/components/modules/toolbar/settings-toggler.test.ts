import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  createTooltipContent: vi.fn(() => 'tooltip content'),
  hide: vi.fn(),
  onHover: vi.fn(),
}));

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string) => document.createElement(tag)),
  },
}));

vi.mock('../../../../../src/components/icons', () => ({
  IconMenu: '<svg></svg>',
}));

describe('SettingsTogglerHandler', () => {
  let settingsTogglerHandler: SettingsTogglerHandler;
  let clickDragHandler: ClickDragHandler;
  let mockBlock: Block;
  let getBlok: () => BlokModules;
  let setHoveredBlockSpy: ReturnType<typeof vi.fn>;
  let cancelTrackingSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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

    it('should open BlockSettings and set hovered block when settings toggler is clicked', () => {
      settingsTogglerHandler.setHoveredBlock(mockBlock);
      const blok = getBlok();
      const blockSettingsOpenSpy = vi.fn();
      (blok.BlockSettings as MockBlockSettings).open = blockSettingsOpenSpy;

      exposeHandleClick(settingsTogglerHandler).handleClick();

      // Verify BlockSettings.open was called with the target block and settings toggler element
      expect(blockSettingsOpenSpy).toHaveBeenCalledWith(mockBlock, expect.any(HTMLSpanElement));
      // Verify the callback to set hovered block was invoked
      expect(setHoveredBlockSpy).toHaveBeenCalledWith(mockBlock);
      // Verify the current block was updated on BlockManager
      expect(blok.BlockManager.currentBlock).toBe(mockBlock);
    });
  });
});
