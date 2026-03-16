import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineToolbar } from '../../../../../../src/components/modules/toolbar/inline/index';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mock the helper classes that InlineToolbar instantiates in its constructor.
 * We need to prevent real initialization side-effects (DOM, shortcuts, timers).
 */
vi.mock('../../../../../../src/components/modules/toolbar/inline/shortcuts-manager', () => ({
  InlineShortcutManager: class MockShortcutManager {
    tryRegisterShortcuts = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/lifecycle-manager', () => ({
  InlineLifecycleManager: class MockLifecycleManager {
    isInitialized = true;
    markInitialized = vi.fn();
    schedule = vi.fn();
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/positioner', () => ({
  InlinePositioner: class MockPositioner {
    apply = vi.fn();
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/tools-manager', () => ({
  InlineToolsManager: class MockToolsManager {
    getAvailableTools = vi.fn(() => []);
    createInstances = vi.fn(() => new Map());
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/selection-validator', () => ({
  InlineSelectionValidator: class MockSelectionValidator {
    canShow = vi.fn(() => ({ allowed: true }));
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/popover-builder', () => ({
  InlinePopoverBuilder: class MockPopoverBuilder {
    build = vi.fn(() => []);
  },
}));

vi.mock('../../../../../../src/components/modules/toolbar/inline/keyboard-handler', () => ({
  InlineKeyboardHandler: class MockKeyboardHandler {
    handle = vi.fn();
    isShiftArrow = vi.fn(() => false);
    hasNestedPopoverOpen = false;
    closeNestedPopover = vi.fn(() => false);
    hasFlipperFocus = false;
  },
}));

vi.mock('../../../../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string) => document.createElement(tag)),
    append: vi.fn((parent: HTMLElement, child: HTMLElement) => {
      parent.appendChild(child);
    }),
  },
}));

vi.mock('../../../../../../src/components/utils', () => {
  let counter = 0;

  return {
    isMobileScreen: vi.fn(() => false),
    generateId: vi.fn(() => `mock-id-${++counter}`),
    keyCodes: {},
    log: vi.fn(),
  };
});

vi.mock('../../../../../../src/components/utils/tw', () => ({
  twMerge: vi.fn((...args: string[]) => args.join(' ')),
}));

vi.mock('../../../../../../src/components/selection/index', () => {
  class MockSelectionUtils {
    removeFakeBackground = vi.fn();
    setFakeBackground = vi.fn();
  }

  // Add static properties
  Object.assign(MockSelectionUtils, {
    text: 'selected text',
    rect: new DOMRect(0, 0, 100, 20),
    get: vi.fn(() => null),
  });

  return { SelectionUtils: MockSelectionUtils };
});

/**
 * Mock PopoverInline so that constructing it throws when we want it to.
 * We use vi.hoisted so the factory fn is accessible inside vi.mock.
 * The mock is a real class (satisfies `new` calls) whose constructor
 * delegates to `popoverFactory` — reassign that to control behavior.
 */
const popoverHolder = vi.hoisted(() => {
  return {
    factory: (): Record<string, unknown> => ({}),
  };
});

vi.mock('../../../../../../src/components/utils/popover/popover-inline', () => ({
  PopoverInline: class MockPopoverInline {
    hide;
    destroy;
    show;
    getElement;
    getMountElement;
    hasNode;
    size;
    activateItemByName;

    constructor() {
      const instance = popoverHolder.factory();

      this.hide = instance.hide;
      this.destroy = instance.destroy;
      this.show = instance.show;
      this.getElement = instance.getElement;
      this.getMountElement = instance.getMountElement;
      this.hasNode = instance.hasNode;
      this.size = instance.size;
      this.activateItemByName = instance.activateItemByName;
    }
  },
}));

describe('InlineToolbar.tryToShow error recovery', () => {
  let inlineToolbar: InlineToolbar;
  let mockBlok: BlokModules;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: PopoverInline constructor succeeds with a stub popover
    popoverHolder.factory = () => ({
      hide: vi.fn(),
      destroy: vi.fn(),
      show: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
      getMountElement: vi.fn(() => document.createElement('div')),
      hasNode: vi.fn(() => false),
      size: { width: 200 },
      activateItemByName: vi.fn(),
    });

    mockBlok = {
      UI: {
        nodes: {
          wrapper: document.createElement('div'),
          redactor: document.createElement('div'),
        },
        contentRect: new DOMRect(0, 0, 800, 600),
      },
      Toolbar: {
        hideBlockActions: vi.fn(),
      },
      Tools: {
        inlineTools: new Map(),
        internal: { inlineTools: new Map() },
      },
      I18n: {
        t: vi.fn((key: string) => key),
      },
      API: {
        methods: {
          ui: {
            nodes: {
              redactor: document.createElement('div'),
            },
          },
        },
      },
      BlockManager: {
        currentBlock: null,
      },
      ReadOnly: {
        isEnabled: false,
      },
    } as unknown as BlokModules;

    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
    };

    inlineToolbar = new InlineToolbar({
      config: {},
      eventsDispatcher: eventsDispatcher as unknown as InlineToolbar['eventsDispatcher'],
    });

    inlineToolbar.state = mockBlok;

    // Set up wrapper node (normally created by make() during initialize())
    const wrapper = document.createElement('div');

    (inlineToolbar as unknown as { nodes: { wrapper: HTMLElement } }).nodes.wrapper = wrapper;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets opened and openingPromise when open() throws', async () => {
    // Make PopoverInline constructor throw to simulate open() failing
    popoverHolder.factory = () => {
      throw new Error('DOM in flux during paste');
    };

    // Call tryToShow — it should not throw to the caller
    await inlineToolbar.tryToShow();

    // After error recovery: opened should be false and openingPromise should be null
    expect(inlineToolbar.opened).toBe(false);

    const openingPromise = (
      inlineToolbar as unknown as { openingPromise: Promise<void> | null }
    ).openingPromise;

    expect(openingPromise).toBeNull();
  });

  it('destroys partial popover if one was created before the error', async () => {
    // Make PopoverInline constructor throw
    popoverHolder.factory = () => {
      throw new Error('PopoverInline construction failed');
    };

    await inlineToolbar.tryToShow();

    // State should be cleaned up
    expect(inlineToolbar.opened).toBe(false);

    const popover = (
      inlineToolbar as unknown as { popover: null }
    ).popover;

    expect(popover).toBeNull();
  });

  it('does not corrupt state for subsequent tryToShow calls after an error', async () => {
    // First call: open() throws
    popoverHolder.factory = () => {
      throw new Error('Transient error');
    };

    await inlineToolbar.tryToShow();

    // Verify state is clean after error
    expect(inlineToolbar.opened).toBe(false);

    // Second call: open() succeeds
    popoverHolder.factory = () => ({
      hide: vi.fn(),
      destroy: vi.fn(),
      show: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
      getMountElement: vi.fn(() => document.createElement('div')),
      hasNode: vi.fn(() => false),
      size: { width: 200 },
      activateItemByName: vi.fn(),
    });

    await inlineToolbar.tryToShow();

    // Now toolbar should be properly opened
    expect(inlineToolbar.opened).toBe(true);

    const openingPromise = (
      inlineToolbar as unknown as { openingPromise: Promise<void> | null }
    ).openingPromise;

    expect(openingPromise).toBeNull();
  });
});
