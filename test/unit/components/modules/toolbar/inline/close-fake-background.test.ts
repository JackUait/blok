import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mock the PopoverInline so the InlineToolbar constructor doesn't blow up
 */
vi.mock('../../../../../../src/components/utils/popover/popover-inline', () => {
  class MockPopoverInline {
    show = vi.fn();
    hide = vi.fn();
    destroy = vi.fn();
    getElement = vi.fn(() => document.createElement('div'));
    getMountElement = vi.fn(() => document.createElement('div'));
    hasNode = vi.fn(() => false);
    activateItemByName = vi.fn();
    get size() {
      return { width: 200 };
    }
  }

  return { PopoverInline: MockPopoverInline };
});

/**
 * Mock the Dom utility
 */
vi.mock('../../../../../../src/components/dom', () => {
  return {
    Dom: {
      make: (tag: string, cls?: string) => {
        const el = document.createElement(tag);

        if (cls) {
          el.className = cls;
        }

        return el;
      },
      append: (parent: HTMLElement, child: HTMLElement) => {
        parent.appendChild(child);
      },
    },
  };
});

/**
 * Mock twMerge to just pass through
 */
vi.mock('../../../../../../src/components/utils/tw', () => ({
  twMerge: (...args: string[]) => args.join(' '),
}));

/**
 * Mock isMobileScreen
 */
vi.mock('../../../../../../src/components/utils', () => ({
  isMobileScreen: () => false,
  debounce: (fn: () => void) => fn,
}));

/**
 * Mock the Listeners utility
 */
vi.mock('../../../../../../src/components/utils/listeners', () => {
  class MockListeners {
    on = vi.fn(() => 'listener-id');
    off = vi.fn();
    offById = vi.fn();
    destroy = vi.fn();
  }

  return { Listeners: MockListeners };
});

/**
 * Mock sub-modules of InlineToolbar
 */
vi.mock('../../../../../../src/components/modules/toolbar/inline/keyboard-handler', () => {
  class MockInlineKeyboardHandler {
    hasNestedPopoverOpen = false;
    hasFlipperFocus = false;
    handle = vi.fn();
    isShiftArrow = vi.fn(() => false);
    closeNestedPopover = vi.fn(() => false);
  }

  return { InlineKeyboardHandler: MockInlineKeyboardHandler };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/lifecycle-manager', () => {
  class MockInlineLifecycleManager {
    isInitialized = true;
    schedule = vi.fn();
    markInitialized = vi.fn();
  }

  return { InlineLifecycleManager: MockInlineLifecycleManager };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/popover-builder', () => {
  class MockInlinePopoverBuilder {
    build = vi.fn(async () => []);
  }

  return { InlinePopoverBuilder: MockInlinePopoverBuilder };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/positioner', () => {
  class MockInlinePositioner {
    apply = vi.fn();
  }

  return { InlinePositioner: MockInlinePositioner };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/selection-validator', () => {
  class MockInlineSelectionValidator {
    canShow = vi.fn(() => ({ allowed: false }));
  }

  return { InlineSelectionValidator: MockInlineSelectionValidator };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/shortcuts-manager', () => {
  class MockInlineShortcutManager {
    tryRegisterShortcuts = vi.fn();
    destroy = vi.fn();
  }

  return { InlineShortcutManager: MockInlineShortcutManager };
});

vi.mock('../../../../../../src/components/modules/toolbar/inline/tools-manager', () => {
  class MockInlineToolsManager {
    getAvailableTools = vi.fn(() => []);
    createInstances = vi.fn(() => new Map());
  }

  return { InlineToolsManager: MockInlineToolsManager };
});

/**
 * Mock the constants module
 */
vi.mock('../../../../../../src/components/constants', () => ({
  DATA_ATTR: { interface: 'data-blok-interface' },
  INLINE_TOOLBAR_INTERFACE_VALUE: 'inline-toolbar',
}));

import { InlineToolbar } from '../../../../../../src/components/modules/toolbar/inline/index';

/**
 * Helper: insert fake background elements into the DOM
 */
function insertFakeBackgroundElements(count = 2): HTMLElement[] {
  const elements: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');

    span.setAttribute('data-blok-fake-background', 'true');
    span.textContent = `highlighted-text-${i}`;
    document.body.appendChild(span);
    elements.push(span);
  }

  return elements;
}

describe('InlineToolbar.close() — fake background cleanup', () => {
  let toolbar: InlineToolbar;

  beforeEach(() => {
    vi.clearAllMocks();

    // Remove any leftover fake background elements
    document.querySelectorAll('[data-blok-fake-background="true"]').forEach((el) => el.remove());

    const mockConfig = {
      tools: {},
      data: { blocks: [] },
    };
    const mockEventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    toolbar = new InlineToolbar({
      config: mockConfig,
      eventsDispatcher: mockEventsDispatcher,
    } as unknown as ConstructorParameters<typeof InlineToolbar>[0]);

    // Set up minimal Blok modules
    const mockBlokModules = {
      Toolbar: { hideBlockActions: vi.fn() },
      UI: {
        nodes: {
          wrapper: document.createElement('div'),
          redactor: document.createElement('div'),
        },
        contentRect: new DOMRect(0, 0, 800, 600),
      },
      I18n: {
        t: vi.fn((key: string) => key),
      },
      Tools: {
        inlineTools: new Map(),
      },
      API: {
        methods: {
          ui: { nodes: { redactor: document.createElement('div') } },
        },
      },
    } as unknown as BlokModules;

    toolbar.state = mockBlokModules;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('[data-blok-fake-background="true"]').forEach((el) => el.remove());
  });

  it('removes fake background elements from the DOM when close() is called', () => {
    // Arrange: create fake background elements in the DOM
    const fakeBackgrounds = insertFakeBackgroundElements(3);

    // Verify they exist
    expect(document.querySelectorAll('[data-blok-fake-background="true"]').length).toBe(3);

    // Mark toolbar as opened so close() doesn't early-return
    toolbar.opened = true;

    // Act: close the inline toolbar
    toolbar.close();

    // Assert: fake background elements should be removed from the DOM
    const remaining = document.querySelectorAll('[data-blok-fake-background="true"]');

    expect(remaining.length).toBe(0);

    // Verify the span text content was preserved (unwrapped into parent)
    for (const fakeBackground of fakeBackgrounds) {
      expect(fakeBackground.parentElement).toBeNull();
    }
  });

  it('does not throw when no fake background elements exist', () => {
    // Verify none exist
    expect(document.querySelectorAll('[data-blok-fake-background="true"]').length).toBe(0);

    toolbar.opened = true;

    // Act & Assert: should not throw
    expect(() => toolbar.close()).not.toThrow();
  });

  it('still early-returns when toolbar is not opened', () => {
    insertFakeBackgroundElements(2);

    // toolbar.opened is false by default
    expect(toolbar.opened).toBe(false);

    toolbar.close();

    // Fake backgrounds should still be there since close() early-returned
    expect(document.querySelectorAll('[data-blok-fake-background="true"]').length).toBe(2);
  });
});
