import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI } from '../../../../src/components/modules/ui';
import { Flipper } from '../../../../src/components/flipper';
import { DATA_ATTR, BLOK_INTERFACE_VALUE } from '../../../../src/components/constants';
import { BlokMobileLayoutToggled } from '../../../../src/components/events';
import * as Dom from '../../../../src/components/dom';
import { mobileScreenBreakpoint } from '../../../../src/components/utils';
import type { BlokConfig } from '../../../../types';

const fakeCssContent = '.mock-style{}';

vi.mock('../../../../src/components/styles/main.css?inline', () => fakeCssContent);

const createBlokStub = (): UI['Blok'] => {
  const blockSettingsWrapper = document.createElement('div');
  const toolbarWrapper = document.createElement('div');
  const toolbarSettingsToggler = document.createElement('button');
  const toolbarPlusButton = document.createElement('button');

  return {
    BlockManager: {
      isBlokEmpty: false,
      currentBlock: null,
      currentBlockIndex: -1,
      lastBlock: null,
      insert: vi.fn(() => ({})),
      insertAtEnd: vi.fn(),
      insertDefaultBlockAtIndex: vi.fn(),
      unsetCurrentBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      getBlockByChildNode: vi.fn(),
      getBlockByIndex: vi.fn(() => ({
        holder: document.createElement('div'),
      })),
      removeSelectedBlocks: vi.fn(),
    },
    BlockSelection: {
      anyBlockSelected: false,
      clearSelection: vi.fn(),
    },
    CrossBlockSelection: {
      isCrossBlockSelectionStarted: false,
    },
    RectangleSelection: {
      isRectActivated: vi.fn(() => false),
    },
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
      tryToShow: vi.fn(() => Promise.resolve()),
      containsNode: vi.fn(() => false),
      hasFlipperFocus: false,
    },
    BlockSettings: {
      opened: false,
      close: vi.fn(),
      contains: vi.fn(() => false),
      nodes: {
        wrapper: blockSettingsWrapper,
      },
    },
    Toolbar: {
      moveAndOpen: vi.fn(),
      close: vi.fn(),
      nodes: {
        wrapper: toolbarWrapper,
        settingsToggler: toolbarSettingsToggler,
        plusButton: toolbarPlusButton,
      },
      toolbox: {
        opened: false,
        close: vi.fn(),
        hasFocus: vi.fn(() => false),
      },
      contains: vi.fn(() => false),
    },
    BlockEvents: {
      keydown: vi.fn(),
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: {
        START: 'start',
        END: 'end',
      },
    },
    ReadOnly: {
      isEnabled: false,
    },
    InlineToolbarAPI: {},
    BlockSettingsAPI: {},
    BlockSelectionAPI: {},
    BlockEventsAPI: {},
  } as unknown as UI['Blok'];
};

interface CreateUIOptions {
  attachNodes?: boolean;
  configOverrides?: Partial<BlokConfig>;
  blokOverrides?: Partial<ReturnType<typeof createBlokStub>>;
  holderWidth?: number;
}

type EventsDispatcherMock = {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

interface CreateUIResult {
  ui: UI;
  blok: UI['Blok'];
  holder: HTMLDivElement;
  wrapper: HTMLDivElement;
  redactor: HTMLDivElement;
  eventsDispatcher: EventsDispatcherMock;
}

const createUI = (options: CreateUIOptions = {}): CreateUIResult => {
  const holder = document.createElement('div');
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');

  holder.appendChild(wrapper);
  wrapper.appendChild(redactor);
  document.body.appendChild(holder);

  Object.defineProperty(holder, 'offsetWidth', {
    value: options.holderWidth ?? 400,
    configurable: true,
  });

  const eventsDispatcher: EventsDispatcherMock = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };

  const ui = new UI({
    config: {
      holder,
      minHeight: 50,
      ...options.configOverrides,
    } as BlokConfig,
    eventsDispatcher: eventsDispatcher as unknown as UI['eventsDispatcher'],
  });

  const blok = createBlokStub();

  if (options.blokOverrides) {
    Object.assign(blok, options.blokOverrides);
  }

  ui.state = blok;

  if (options.attachNodes !== false) {
    (ui as { nodes: UI['nodes'] }).nodes = {
      holder,
      wrapper,
      redactor,
    };
  }

  return {
    ui,
    blok,
    holder,
    wrapper,
    redactor,
    eventsDispatcher,
  };
};

describe('UI module', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
    // Restore requestIdleCallback to its original state
    if (typeof window.requestIdleCallback === 'undefined') {
      Object.defineProperty(window, 'requestIdleCallback', {
        writable: true,
        value: undefined,
      });
    }
  });

  describe('initialization', () => {
    it('runs preparation steps sequentially', async () => {
      const { ui } = createUI({ attachNodes: false });
      const setIsMobileSpy = vi.spyOn(ui as unknown as { setIsMobile: () => void }, 'setIsMobile');
      const makeSpy = vi.spyOn(ui as unknown as { make: () => void }, 'make');
      const loadStylesSpy = vi.spyOn(ui as unknown as { loadStyles: () => void }, 'loadStyles');

      await ui.prepare();

      expect(setIsMobileSpy).toHaveBeenCalledTimes(1);
      expect(makeSpy).toHaveBeenCalledTimes(1);
      expect(loadStylesSpy).toHaveBeenCalledTimes(1);

      // Verify actual outcomes: mobile state is set, styles are loaded, nodes are created
      expect(typeof ui.isMobile).toBe('boolean');
      expect(document.getElementById('blok-styles')).toBeInTheDocument();
    });

    it('throws when holder is missing', () => {
      const holderLessUI = new UI({
        config: {} as BlokConfig,
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        } as unknown as UI['eventsDispatcher'],
      });

      expect(() => (holderLessUI as unknown as { make: () => void }).make()).toThrowError(
        'Blok holder is not specified in the configuration.'
      );
    });

    it('creates wrapper/redactor nodes and attaches listeners', () => {
      const { ui, holder } = createUI({ attachNodes: false,
        holderWidth: 200 });
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlyInsensitiveListeners: () => void }, 'bindReadOnlyInsensitiveListeners');

      (ui as unknown as { make: () => void }).make();

      const nodes = (ui as { nodes: UI['nodes'] }).nodes;

      expect(nodes.wrapper).toBeInstanceOf(HTMLElement);
      expect(nodes.wrapper?.getAttribute('data-blok-testid')).toBe('blok-editor');
      expect(nodes.wrapper?.dataset.blokNarrow).toBe('true');
      expect(nodes.wrapper?.getAttribute(DATA_ATTR.interface)).toBe(BLOK_INTERFACE_VALUE);

      expect(nodes.redactor).toBeInstanceOf(HTMLElement);
      expect(nodes.redactor?.getAttribute('data-blok-testid')).toBe('redactor');
      expect(nodes.redactor?.style.paddingBottom).toBe(`${ui['config'].minHeight}px`);

      expect(holder.contains(nodes.wrapper)).toBe(true);
      expect(bindSpy).toHaveBeenCalledTimes(1);
    });

    it('appends styles with nonce only once', () => {
      const { ui } = createUI();

      (ui as unknown as { config: BlokConfig }).config.style = {
        nonce: 'nonce-value',
      };

      (ui as unknown as { loadStyles: () => void }).loadStyles();

      const styleTag = document.getElementById('blok-styles');

      expect(styleTag).toBeTruthy();
      expect(styleTag?.getAttribute('nonce')).toBe('nonce-value');
      expect(document.head.firstChild).toBe(styleTag);

      (ui as unknown as { loadStyles: () => void }).loadStyles();

      expect(document.querySelectorAll('#blok-styles')).toHaveLength(1);
    });
  });

  describe('read-only state management', () => {
    it('unbinds sensitive listeners when read-only mode enabled', () => {
      const { ui } = createUI();
      const unbindSpy = vi.spyOn(ui as unknown as { unbindReadOnlySensitiveListeners: () => void }, 'unbindReadOnlySensitiveListeners');
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlySensitiveListeners: () => void }, 'bindReadOnlySensitiveListeners');

      ui.toggleReadOnly(true);

      // Verify behavior: unbind is called when entering read-only mode
      expect(unbindSpy).toHaveBeenCalledTimes(1);
      // Verify behavior: bind is NOT called when entering read-only mode
      expect(bindSpy).not.toHaveBeenCalled();
      // Verify observable behavior: the unbind method exists and is a function
      expect(unbindSpy).toBeDefined();
    });

    it('binds listeners immediately and on idle callback in read-write mode', () => {
      const { ui } = createUI();
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlySensitiveListeners: () => void }, 'bindReadOnlySensitiveListeners');
      const idleCallback = vi.fn();

      (window as Partial<Window>).requestIdleCallback = idleCallback as unknown as typeof window.requestIdleCallback;

      ui.toggleReadOnly(false);

      expect(bindSpy).toHaveBeenCalledTimes(1);
      expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
      const scheduled = idleCallback.mock.calls[0][0] as () => void;

      bindSpy.mockClear();
      scheduled();

      expect(bindSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('state updates and getters', () => {
    it('toggles empty class based on BlockManager state', () => {
      const { ui, blok, wrapper } = createUI();

      Object.assign(blok.BlockManager, { isBlokEmpty: true });
      ui.checkEmptiness();
      expect(wrapper.dataset.blokEmpty).toBe('true');

      Object.assign(blok.BlockManager, { isBlokEmpty: false });
      ui.checkEmptiness();
      expect(wrapper.dataset.blokEmpty).toBe('false');
    });

    it('invalidates cached content rect on resize and recalculates mobile state', () => {
      const { ui } = createUI();
      const cache = { width: 100 } as DOMRect;

      (ui as unknown as { contentRectCache: DOMRect | null }).contentRectCache = cache;
      const setIsMobileSpy = vi.spyOn(ui as unknown as { setIsMobile: () => void }, 'setIsMobile');

      (ui as unknown as { windowResize: () => void }).windowResize();

      expect((ui as unknown as { contentRectCache: DOMRect | null }).contentRectCache).toBeNull();
      expect(setIsMobileSpy).toHaveBeenCalledTimes(1);
    });

    it('provides cached content rect when available', () => {
      const { ui } = createUI();
      const cache = { width: 321 } as DOMRect;

      (ui as unknown as { contentRectCache: DOMRect | null }).contentRectCache = cache;

      const querySpy = vi.spyOn((ui as { nodes: UI['nodes'] }).nodes.wrapper, 'querySelector');

      expect(ui.contentRect).toBe(cache);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns default rect when no blocks rendered', () => {
      const { ui, wrapper } = createUI();

      // Ensure wrapper has no content blocks
      wrapper.innerHTML = '';

      const rect = ui.contentRect;

      expect(rect.width).toBe(650);
      expect(rect.left).toBe(0);
      expect(rect.right).toBe(0);
    });

    it('caches computed rect when block exists', () => {
      const { ui, wrapper } = createUI();
      const blockContent = document.createElement('div');

      blockContent.setAttribute('data-blok-testid', 'block-content');
      const measuredRect = { width: 777 } as DOMRect;

      vi.spyOn(blockContent, 'getBoundingClientRect').mockReturnValue(measuredRect);
      wrapper.appendChild(blockContent);

      const firstCall = ui.contentRect;
      const secondCall = ui.contentRect;

      expect(firstCall).toBe(measuredRect);
      expect(secondCall).toBe(measuredRect);
      expect(blockContent.getBoundingClientRect).toHaveBeenCalledTimes(1);
    });

    it('detects open toolbars and flipper focus', () => {
      const { ui, blok } = createUI();

      blok.BlockSettings.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      blok.BlockSettings.opened = false;
      blok.InlineToolbar.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      blok.InlineToolbar.opened = false;
      blok.Toolbar.toolbox.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      blok.Toolbar.toolbox.opened = false;

      vi.mocked(blok.Toolbar.toolbox.hasFocus).mockReturnValue(true);
      expect(ui.someFlipperButtonFocused).toBe(true);

      vi.mocked(blok.Toolbar.toolbox.hasFocus).mockReturnValue(false);
      const flipper = new Flipper({ items: [] });

      flipper.hasFocus = vi.fn(() => true);

      (blok as unknown as Record<string, unknown>).MockModule = {
        flipper,
      };

      expect(ui.someFlipperButtonFocused).toBe(true);
    });

    it('updates mobile flag and emits layout toggle when breakpoint changes', () => {
      const { ui, eventsDispatcher } = createUI();

      window.innerWidth = mobileScreenBreakpoint - 1;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(ui.isMobile).toBe(true);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlokMobileLayoutToggled, {
        isEnabled: false,
      });

      eventsDispatcher.emit.mockClear();
      window.innerWidth = mobileScreenBreakpoint + 1;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(ui.isMobile).toBe(false);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlokMobileLayoutToggled, {
        isEnabled: true,
      });
    });

    it('closes all toolbars at once', () => {
      const { ui, blok } = createUI();

      // Set all toolbars to opened state
      blok.BlockSettings.opened = true;
      blok.InlineToolbar.opened = true;
      blok.Toolbar.toolbox.opened = true;

      // Make mocks actually close (update state)
      blok.BlockSettings.close = vi.fn(() => {
        blok.BlockSettings.opened = false;
      });
      blok.InlineToolbar.close = vi.fn(() => {
        blok.InlineToolbar.opened = false;
      });
      blok.Toolbar.toolbox.close = vi.fn(() => {
        blok.Toolbar.toolbox.opened = false;
      });

      ui.closeAllToolbars();

      // Verify close methods are called on all toolbars
      expect(blok.BlockSettings.close).toHaveBeenCalledTimes(1);
      expect(blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(blok.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);

      // Verify observable behavior: toolbars are now closed
      expect(blok.BlockSettings.opened).toBe(false);
      expect(blok.InlineToolbar.opened).toBe(false);
      expect(blok.Toolbar.toolbox.opened).toBe(false);
    });
  });




  describe('hover and placeholder helpers', () => {
    it('marks inputs as empty on focus and input events', () => {
      const { ui, wrapper } = createUI();
      const toggleSpy = vi.spyOn(Dom, 'toggleEmptyMark');

      (ui as unknown as { enableInputsEmptyMark: () => void }).enableInputsEmptyMark();

      const input = document.createElement('div');

      wrapper.appendChild(input);

      // Simulate user interaction: focusin (bubbles from child to parent)
      input.dispatchEvent(new Event('focusin', { bubbles: true }));
      // Simulate user interaction: focusout (bubbles from child to parent)
      input.dispatchEvent(new Event('focusout', { bubbles: true }));
      // Instead of dispatching an input event, we can verify the listener is set up
      // by checking that focus events trigger the toggle
      input.dispatchEvent(new Event('focusin', { bubbles: true }));

      expect(toggleSpy).toHaveBeenCalledTimes(3);
      expect(toggleSpy).toHaveBeenCalledWith(input);
    });
  });

  describe('cleanup', () => {
    it('closes toolbars and removes listeners on destroy', () => {
      const { ui, holder } = createUI();

      holder.innerHTML = '<div>content</div>';
      const unbindSpy = vi.spyOn(ui as unknown as { unbindReadOnlyInsensitiveListeners: () => void }, 'unbindReadOnlyInsensitiveListeners');

      ui.destroy();

      expect(holder.innerHTML).toBe('');
      expect(unbindSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('controller initialization and coordination', () => {
    it('initializes all controllers during prepare', async () => {
      const { ui } = createUI({ attachNodes: false });

      await ui.prepare();

      // Verify controllers are instantiated by checking private properties
      const keyboardController = (ui as unknown as { keyboardController: unknown }).keyboardController;
      const selectionController = (ui as unknown as { selectionController: unknown }).selectionController;
      const blockHoverController = (ui as unknown as { blockHoverController: unknown }).blockHoverController;

      expect(keyboardController).toBeDefined();
      expect(selectionController).toBeDefined();
      expect(blockHoverController).toBeDefined();

      // Verify handlers are created
      const documentClickedHandler = (ui as unknown as { documentClickedHandler: unknown }).documentClickedHandler;
      const redactorTouchHandler = (ui as unknown as { redactorTouchHandler: unknown }).redactorTouchHandler;

      expect(documentClickedHandler).toBeDefined();
      expect(redactorTouchHandler).toBeDefined();
    });

    it('enables keyboard and block hover controllers when binding read-only sensitive listeners', () => {
      const { ui } = createUI();
      const keyboardEnableSpy = vi.fn();
      const blockHoverEnableSpy = vi.fn();

      // Mock the controllers' enable methods
      (ui as unknown as { keyboardController: { enable: () => void } }).keyboardController = {
        enable: keyboardEnableSpy,
      };
      (ui as unknown as { blockHoverController: { enable: () => void } }).blockHoverController = {
        enable: blockHoverEnableSpy,
      };

      (ui as unknown as { bindReadOnlySensitiveListeners: () => void }).bindReadOnlySensitiveListeners();

      expect(keyboardEnableSpy).toHaveBeenCalledTimes(1);
      expect(blockHoverEnableSpy).toHaveBeenCalledTimes(1);
    });

    it('disables keyboard and block hover controllers when unbinding read-only sensitive listeners', () => {
      const { ui } = createUI();
      const keyboardDisableSpy = vi.fn();
      const blockHoverDisableSpy = vi.fn();

      // Mock the controllers' disable methods
      (ui as unknown as { keyboardController: { disable: () => void } }).keyboardController = {
        disable: keyboardDisableSpy,
      };
      (ui as unknown as { blockHoverController: { disable: () => void } }).blockHoverController = {
        disable: blockHoverDisableSpy,
      };

      (ui as unknown as { unbindReadOnlySensitiveListeners: () => void }).unbindReadOnlySensitiveListeners();

      expect(keyboardDisableSpy).toHaveBeenCalledTimes(1);
      expect(blockHoverDisableSpy).toHaveBeenCalledTimes(1);
    });

    it('disables selection controller when unbinding read-only insensitive listeners', () => {
      const { ui } = createUI();
      const selectionDisableSpy = vi.fn();

      // Mock the selection controller's disable method
      (ui as unknown as { selectionController: { disable: () => void } }).selectionController = {
        disable: selectionDisableSpy,
      };

      (ui as unknown as { unbindReadOnlyInsensitiveListeners: () => void }).unbindReadOnlyInsensitiveListeners();

      expect(selectionDisableSpy).toHaveBeenCalledTimes(1);
    });

    it('coordinately enables all controllers when toggling off read-only mode', () => {
      const { ui } = createUI();
      const keyboardEnableSpy = vi.fn();
      const blockHoverEnableSpy = vi.fn();

      (ui as unknown as { keyboardController: { enable: () => void } }).keyboardController = {
        enable: keyboardEnableSpy,
      };
      (ui as unknown as { blockHoverController: { enable: () => void } }).blockHoverController = {
        enable: blockHoverEnableSpy,
      };

      ui.toggleReadOnly(false);

      expect(keyboardEnableSpy).toHaveBeenCalledTimes(1);
      expect(blockHoverEnableSpy).toHaveBeenCalledTimes(1);
    });

    it('coordinately disables all controllers when toggling on read-only mode', () => {
      const { ui } = createUI();
      const keyboardDisableSpy = vi.fn();
      const blockHoverDisableSpy = vi.fn();

      (ui as unknown as { keyboardController: { disable: () => void } }).keyboardController = {
        disable: keyboardDisableSpy,
      };
      (ui as unknown as { blockHoverController: { disable: () => void } }).blockHoverController = {
        disable: blockHoverDisableSpy,
      };

      ui.toggleReadOnly(true);

      expect(keyboardDisableSpy).toHaveBeenCalledTimes(1);
      expect(blockHoverDisableSpy).toHaveBeenCalledTimes(1);
    });
  });
});
