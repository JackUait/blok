import { describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { TEST_ID } from '../../../../../src/components/constants/test-ids';
import { ClickDragHandler } from '../../../../../src/components/modules/toolbar/click-handler';
import { SettingsTogglerHandler } from '../../../../../src/components/modules/toolbar/settings-toggler';
import type { ToolbarNodes } from '../../../../../src/components/modules/toolbar/types';
import { hide, onHover } from '../../../../../src/components/utils/tooltip';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Mutants proven equivalent, with the argument for each:
 *
 * - OptionalChaining at line 236 (`this.settingsTogglerElement?.classList`):
 *   `refreshCursor` returns early while the field is null, and the field is
 *   written in exactly one place — `make()`, with a freshly created element.
 *   It is private with no setter, so neither the caller-supplied `getBlok` nor
 *   `classList.toggle` can put it back to null between the guard and the
 *   forEach body. The `?.` therefore never short-circuits and dropping it
 *   cannot change behaviour.
 */

const mocks = vi.hoisted(() => ({
  isOpenTrigger: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/popover/popover-registry', () => ({
  PopoverRegistry: {
    instance: {
      isOpenTrigger: mocks.isOpenTrigger,
    },
  },
}));

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  hide: vi.fn(),
  onHover: vi.fn(),
}));

/**
 * Every field the handler reads off the Blok modules reference.
 */
interface BlokStub {
  BlockSettings: {
    opened: boolean;
    open: Mock<(block: Block, trigger?: HTMLElement) => Promise<void>>;
    close: Mock<() => void>;
  };
  BlockManager: { currentBlock: Block | null };
  DragManager: { cancelTracking: Mock<() => void> };
  ReadOnly: { isEnabled: boolean };
  I18n: { t: Mock<(key: string) => string> };
}

const emptyNodes = (): ToolbarNodes => ({
  wrapper: undefined,
  content: undefined,
  actions: undefined,
  plusButton: undefined,
  settingsToggler: undefined,
});

const makeBlock = (id: string): Block => ({ id }) as unknown as Block;

const classTokens = (element: HTMLElement): string[] =>
  element.className.split(/\s+/).filter((token) => token !== '');

describe('SettingsTogglerHandler — recorded mutants', () => {
  let handler: SettingsTogglerHandler;
  let clickDragHandler: ClickDragHandler;
  let setupSpy: MockInstance<ClickDragHandler['setup']>;
  let blok: BlokStub;
  let getBlokSpy: Mock<() => BlokModules>;
  let getToolboxOpened: Mock<() => boolean>;
  let closeToolbox: Mock<() => void>;
  let setHoveredBlock: Mock<(block: Block) => void>;
  let blockA: Block;
  let blockB: Block;

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.isOpenTrigger.mockReturnValue(false);

    blockA = makeBlock('block-a');
    blockB = makeBlock('block-b');

    blok = {
      BlockSettings: {
        opened: false,
        open: vi.fn(async () => undefined),
        close: vi.fn(),
      },
      BlockManager: { currentBlock: blockB },
      DragManager: { cancelTracking: vi.fn() },
      ReadOnly: { isEnabled: false },
      I18n: { t: vi.fn((key: string) => key) },
    };

    getBlokSpy = vi.fn(() => blok as unknown as BlokModules);
    getToolboxOpened = vi.fn(() => false);
    closeToolbox = vi.fn();
    setHoveredBlock = vi.fn();

    clickDragHandler = new ClickDragHandler();
    setupSpy = vi.spyOn(clickDragHandler, 'setup');

    handler = new SettingsTogglerHandler(getBlokSpy, clickDragHandler, {
      setHoveredBlock,
      getToolboxOpened,
      closeToolbox,
    });
  });

  afterEach(() => {
    clickDragHandler.destroy();
    vi.restoreAllMocks();
  });

  /**
   * Drives one full press-release gesture through the mousedown handler and the
   * document-level mouseup the real ClickDragHandler listens for.
   */
  const gesture = (): MouseEvent => {
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 4, clientY: 6 });

    handler.createMousedownHandler()(mousedown);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 4, clientY: 6 }));

    return mousedown;
  };

  describe('hovered block accessors', () => {
    it('starts empty and returns whatever was set', () => {
      expect(handler.hoveredBlock).toBeNull();

      handler.setHoveredBlock(blockA);

      expect(handler.hoveredBlock).toBe(blockA);
    });
  });

  describe('make', () => {
    it('carries every class group of the handle', () => {
      const element = handler.make(emptyNodes());
      const tokens = classTokens(element);

      expect(tokens).toContain('text-text-secondary');
      expect(tokens).toContain('[&_svg]:h-[22px]');
      expect(tokens).toContain('can-hover:hover:bg-bg-light');
      expect(tokens).toContain('group-data-[blok-toolbox-opened=true]:hidden');
      expect(tokens).toContain('group-data-[blok-block-settings-opened=true]:bg-bg-light');
      expect(tokens).toContain('mobile:shadow-overlay-pane');
      expect(tokens).toContain('mobile:w-toolbox-btn-mobile');
    });

    it('renders the menu icon into the handle', () => {
      const element = handler.make(emptyNodes());

      expect(element.querySelector('svg')).not.toBeNull();
    });

    it('stamps the marker attributes with empty values and the test id', () => {
      const element = handler.make(emptyNodes());

      expect(element.getAttribute(DATA_ATTR.settingsToggler)).toBe('');
      expect(element.getAttribute(DATA_ATTR.dragHandle)).toBe('');
      expect(element.getAttribute(DATA_ATTR.testid)).toBe(TEST_ID.settingsToggler);
    });

    it('exposes the handle as a non-tabbable button', () => {
      const element = handler.make(emptyNodes());

      expect(element.getAttribute('role')).toBe('button');
      expect(element.getAttribute('tabindex')).toBe('-1');
    });

    it('publishes the element on the nodes object', () => {
      const nodes = emptyNodes();
      const element = handler.make(nodes);

      expect(nodes.settingsToggler).toBe(element);
    });
  });

  describe('refreshAriaLabel', () => {
    it('drops the drag-only aria hints when read-only is switched on', () => {
      const element = handler.make(emptyNodes());

      expect(element.hasAttribute('aria-keyshortcuts')).toBe(true);
      expect(element.hasAttribute('aria-roledescription')).toBe(true);

      blok.ReadOnly.isEnabled = true;
      handler.refreshAriaLabel();

      expect(element.hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(element.hasAttribute('aria-roledescription')).toBe(false);
    });
  });

  describe('guards before the element exists', () => {
    it('refreshCursor never reaches the modules reference', () => {
      handler.refreshCursor();

      expect(getBlokSpy).not.toHaveBeenCalled();
    });

    it('refreshTooltip never reaches the modules reference', () => {
      handler.refreshTooltip();

      expect(getBlokSpy).not.toHaveBeenCalled();
      expect(vi.mocked(onHover)).not.toHaveBeenCalled();
    });
  });

  describe('createMousedownHandler', () => {
    it('returns a callable handler', () => {
      expect(typeof handler.createMousedownHandler()).toBe('function');
    });

    it('swallows the press and hides the tooltip before arming the click handler', () => {
      const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 4, clientY: 6 });

      handler.createMousedownHandler()(mousedown);

      expect(mousedown.defaultPrevented).toBe(true);
      expect(vi.mocked(hide)).toHaveBeenCalled();
      expect(setupSpy).toHaveBeenCalled();
    });

    it('opens the block settings on a click gesture', () => {
      handler.setHoveredBlock(blockA);

      gesture();

      expect(blok.DragManager.cancelTracking).toHaveBeenCalled();
      expect(blok.BlockSettings.open).toHaveBeenCalledTimes(1);
      expect(blok.BlockSettings.open).toHaveBeenCalledWith(blockA, undefined);
    });

    it('leaves the toolbox alone when it is already closed', () => {
      handler.setHoveredBlock(blockA);
      getToolboxOpened.mockReturnValue(false);

      gesture();

      expect(closeToolbox).not.toHaveBeenCalled();
    });

    it('closes the toolbox when it is open', () => {
      handler.setHoveredBlock(blockA);
      getToolboxOpened.mockReturnValue(true);

      gesture();

      expect(closeToolbox).toHaveBeenCalledTimes(1);
    });
  });

  describe('skipNextToggle', () => {
    it('swallows exactly one gesture and then re-arms', () => {
      handler.setHoveredBlock(blockA);
      handler.skipNextToggle();

      gesture();

      expect(blok.BlockSettings.open).not.toHaveBeenCalled();

      gesture();

      expect(blok.BlockSettings.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('target block resolution', () => {
    it('prefers the hovered block over the current block', () => {
      handler.setHoveredBlock(blockA);
      blok.BlockManager.currentBlock = blockB;

      gesture();

      expect(blok.BlockSettings.open).toHaveBeenCalledWith(blockA, undefined);
      expect(blok.BlockManager.currentBlock).toBe(blockA);
    });

    it('does nothing when neither a hovered nor a current block exists', () => {
      blok.BlockManager.currentBlock = null;

      gesture();

      expect(blok.DragManager.cancelTracking).toHaveBeenCalled();
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
      expect(blok.BlockSettings.close).not.toHaveBeenCalled();
    });
  });

  describe('same-trigger law', () => {
    it('skips the registry lookup and closes when there is no handle element', () => {
      handler.setHoveredBlock(blockA);
      blok.BlockSettings.opened = true;

      gesture();

      expect(mocks.isOpenTrigger).not.toHaveBeenCalled();
      expect(blok.BlockSettings.close).toHaveBeenCalledTimes(1);
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });

    it('keeps the menu open when the handle is the open trigger', () => {
      const element = handler.make(emptyNodes());

      handler.setHoveredBlock(blockA);
      blok.BlockSettings.opened = true;
      mocks.isOpenTrigger.mockReturnValue(true);

      gesture();

      expect(mocks.isOpenTrigger).toHaveBeenCalledWith(element);
      expect(blok.BlockSettings.close).not.toHaveBeenCalled();
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });
  });
});
