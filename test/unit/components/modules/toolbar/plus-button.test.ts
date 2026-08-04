import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlusButtonHandler, TOOLBOX_POPOVER_ID } from '../../../../../src/components/modules/toolbar/plus-button';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PopoverAbstract } from '../../../../../src/components/utils/popover/popover-abstract';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolbarNodes } from '../../../../../src/components/modules/toolbar/types';

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
  IconPlus: '<svg></svg>',
}));

vi.mock('../../../../../src/components/selection/index', () => ({
  SelectionUtils: {
    get: vi.fn(() => null),
  },
}));

vi.mock('../../../../../src/components/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    getUserOS: vi.fn(() => ({ mac: true, win: false, other: false })),
  };
});

const emptyNodes = (): ToolbarNodes => (({
  wrapper: undefined,
  content: undefined,
  actions: undefined,
  plusButton: undefined,
  settingsToggler: undefined,
}));

describe('PlusButtonHandler', () => {
  let plusButtonHandler: PlusButtonHandler;
  let getBlok: () => BlokModules;

  beforeEach(() => {
    vi.clearAllMocks();

    const blokModules = {
      I18n: {
        t: vi.fn((key: string) => key),
      },
    } as unknown as BlokModules;

    getBlok = () => blokModules;

    plusButtonHandler = new PlusButtonHandler(getBlok, {
      getToolboxOpened: () => false,
      openToolbox: vi.fn(),
      openToolboxWithoutSlash: vi.fn(),
      closeToolbox: vi.fn(),
      moveAndOpenToolbar: vi.fn(),
    });
  });

  describe('make - accessibility', () => {
    it('exposes the plus button as an accessible menu button', () => {
      const plusButton = plusButtonHandler.make(emptyNodes());

      expect(plusButton.getAttribute('role')).toBe('button');
      expect(plusButton.getAttribute('tabindex')).toBe('-1');
      expect(plusButton.getAttribute('aria-haspopup')).toBe('listbox');
      expect(plusButton.getAttribute('aria-expanded')).toBe('false');
      expect(plusButton.getAttribute('aria-controls')).toBe(TOOLBOX_POPOVER_ID);
    });

    it('labels the plus button from the a11y.insertBlock i18n key', () => {
      const blok = getBlok();
      const plusButton = plusButtonHandler.make(emptyNodes());

      expect(blok.I18n.t).toHaveBeenCalledWith('a11y.insertBlock');
      expect(plusButton.getAttribute('aria-label')).toBe('a11y.insertBlock');
      expect(plusButton.getAttribute('aria-label')).not.toBe('');
    });
  });

  describe('make - keyboard activation', () => {
    it('activates on Enter', () => {
      const plusButton = plusButtonHandler.make(emptyNodes());
      const handleClickSpy = vi.spyOn(plusButtonHandler, 'handleClick').mockImplementation(() => {});

      plusButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(handleClickSpy).toHaveBeenCalledTimes(1);
    });

    it('activates on Space and prevents default scroll', () => {
      const plusButton = plusButtonHandler.make(emptyNodes());
      const handleClickSpy = vi.spyOn(plusButtonHandler, 'handleClick').mockImplementation(() => {});

      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

      plusButton.dispatchEvent(event);

      expect(handleClickSpy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores other keys', () => {
      const plusButton = plusButtonHandler.make(emptyNodes());
      const handleClickSpy = vi.spyOn(plusButtonHandler, 'handleClick').mockImplementation(() => {});

      plusButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(handleClickSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleClick — same-trigger no-op (clicking the item that opened the popover does nothing)', () => {
    let closeToolboxSpy: ReturnType<typeof vi.fn<() => void>>;
    let handler: PlusButtonHandler;

    beforeEach(() => {
      closeToolboxSpy = vi.fn();

      const blokModules = {
        I18n: {
          t: vi.fn((key: string) => key),
        },
        BlockSettings: {
          opened: false,
          close: vi.fn(),
        },
        BlockSelection: {
          anyBlockSelected: false,
          clearSelection: vi.fn(),
        },
      } as unknown as BlokModules;

      handler = new PlusButtonHandler(() => blokModules, {
        getToolboxOpened: () => true,
        openToolbox: vi.fn<() => void>(),
        openToolboxWithoutSlash: vi.fn<() => void>(),
        closeToolbox: closeToolboxSpy,
        moveAndOpenToolbar: vi.fn(),
      });
    });

    afterEach(() => {
      PopoverRegistry.resetForTests();
    });

    /**
     * Registers a mock popover in the registry with the given trigger,
     * simulating an open toolbox anchored to that element.
     */
    const registerOpenPopoverFor = (trigger: HTMLElement): void => {
      const popoverEl = document.createElement('div');
      const popover = {
        hide: vi.fn(),
        hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
        getElement: vi.fn(() => popoverEl),
        getFocusHost: vi.fn(() => null),
      } as unknown as PopoverAbstract;

      PopoverRegistry.instance.register(popover, trigger);
    };

    it('does nothing when the open toolbox is anchored to this plus button', () => {
      const plusButton = handler.make(emptyNodes());

      registerOpenPopoverFor(plusButton);

      handler.handleClick();

      expect(closeToolboxSpy).not.toHaveBeenCalled();
    });

    it('still closes the toolbox when it is not anchored to this plus button', () => {
      handler.make(emptyNodes());

      registerOpenPopoverFor(document.createElement('button'));

      handler.handleClick();

      expect(closeToolboxSpy).toHaveBeenCalledTimes(1);
    });
  });
});
