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
    clearFakeBackground = vi.fn();
  }

  Object.assign(MockSelectionUtils, {
    text: 'selected text',
    rect: new DOMRect(0, 0, 100, 20),
    get: vi.fn(() => null),
  });

  return { SelectionUtils: MockSelectionUtils };
});

vi.mock('../../../../../../src/components/utils/popover/popover-inline', () => ({
  PopoverInline: class MockPopoverInline {
    hide = vi.fn();
    destroy = vi.fn();
    show = vi.fn();
    getElement = vi.fn(() => document.createElement('div'));
    getMountElement = vi.fn(() => document.createElement('div'));
    hasNode = vi.fn(() => false);
    size = { width: 200 };
    activateItemByName = vi.fn();
  },
}));

interface ToolbarInternals {
  toolsManager: {
    getAvailableTools: ReturnType<typeof vi.fn>;
    createInstances: ReturnType<typeof vi.fn>;
  };
  popoverBuilder: { build: ReturnType<typeof vi.fn> };
  nodes: { wrapper: HTMLElement };
  activateToolByShortcut: (name: string) => Promise<void>;
  invokeToolActionDirectly: (name: string) => void;
  toolOpensPopover: (name: string) => boolean;
  tryApplyToolShortcut: (name: string) => boolean;
}

describe('InlineToolbar inline tool instance destroy lifecycle', () => {
  let inlineToolbar: InlineToolbar;
  let mockBlok: BlokModules;

  const internals = (): ToolbarInternals => inlineToolbar as unknown as ToolbarInternals;

  beforeEach(() => {
    vi.clearAllMocks();

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

    internals().nodes.wrapper = document.createElement('div');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Configures the mocked tools manager so open() populates this.tools
   * with the given instances.
   */
  const stubOpenInstances = (instances: Array<Record<string, unknown>>): void => {
    const map = new Map(instances.map((instance, index) => [{ name: `tool-${index}` }, instance]));

    internals().toolsManager.getAvailableTools.mockReturnValue(Array.from(map.keys()));
    internals().toolsManager.createInstances.mockReturnValue(map);
  };

  it('close() destroys every visible tool instance', async () => {
    const destroyA = vi.fn();
    const destroyB = vi.fn();

    stubOpenInstances([
      { render: vi.fn(() => ({ name: 'a' })), destroy: destroyA },
      { render: vi.fn(() => ({ name: 'b' })), destroy: destroyB },
    ]);

    await inlineToolbar.tryToShow();
    expect(inlineToolbar.opened).toBe(true);

    inlineToolbar.close();

    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
  });

  it('close() tolerates instances without destroy and a destroy that throws', async () => {
    const throwingDestroy = vi.fn(() => {
      throw new Error('tool teardown blew up');
    });
    const healthyDestroy = vi.fn();

    stubOpenInstances([
      { render: vi.fn(() => ({ name: 'no-destroy' })) },
      { render: vi.fn(() => ({ name: 'thrower' })), destroy: throwingDestroy },
      { render: vi.fn(() => ({ name: 'healthy' })), destroy: healthyDestroy },
    ]);

    await inlineToolbar.tryToShow();

    expect(() => inlineToolbar.close()).not.toThrow();
    expect(throwingDestroy).toHaveBeenCalledTimes(1);
    expect(healthyDestroy).toHaveBeenCalledTimes(1);
    expect(inlineToolbar.opened).toBe(false);
  });

  it('module destroy() while the toolbar is open destroys instances exactly once', async () => {
    const destroyFn = vi.fn();

    stubOpenInstances([
      { render: vi.fn(() => ({ name: 'a' })), destroy: destroyFn },
    ]);

    await inlineToolbar.tryToShow();
    expect(inlineToolbar.opened).toBe(true);

    inlineToolbar.destroy();

    expect(destroyFn).toHaveBeenCalledTimes(1);

    // A close() after destroy must not double-destroy
    inlineToolbar.close();
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('a popover-build failure during open destroys the already-created instances', async () => {
    const destroyA = vi.fn();
    const destroyB = vi.fn();

    stubOpenInstances([
      { render: vi.fn(() => ({ name: 'a' })), destroy: destroyA },
      { render: vi.fn(() => ({ name: 'b' })), destroy: destroyB },
    ]);

    // A sibling tool's render() throwing surfaces as a popoverBuilder.build failure.
    internals().popoverBuilder.build.mockImplementation(() => {
      throw new Error('sibling render blew up');
    });

    await inlineToolbar.tryToShow();

    expect(inlineToolbar.opened).toBe(false);
    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);

    // The failed open left no live instances behind: a later close() must not
    // double-destroy them.
    inlineToolbar.close();
    expect(destroyA).toHaveBeenCalledTimes(1);
  });

  it('tryApplyToolShortcut destroys the throwaway instance it creates (applyShortcut path)', () => {
    const destroyFn = vi.fn();
    const applyShortcut = vi.fn();
    const tool = {
      create: vi.fn(() => ({ applyShortcut, destroy: destroyFn })),
    };

    (mockBlok.Tools as unknown as { inlineTools: Map<string, unknown> }).inlineTools = new Map([['marker', tool]]);

    const handled = internals().tryApplyToolShortcut('marker');

    expect(handled).toBe(true);
    expect(applyShortcut).toHaveBeenCalledTimes(1);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('tryApplyToolShortcut destroys the probe instance even when the tool has no applyShortcut', () => {
    const destroyFn = vi.fn();
    const tool = {
      create: vi.fn(() => ({ render: vi.fn(() => ({ name: 'x' })), destroy: destroyFn })),
    };

    (mockBlok.Tools as unknown as { inlineTools: Map<string, unknown> }).inlineTools = new Map([['bold', tool]]);

    const handled = internals().tryApplyToolShortcut('bold');

    expect(handled).toBe(false);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('toolOpensPopover destroys the probe instance it renders', () => {
    const destroyFn = vi.fn();
    const tool = {
      create: vi.fn(() => ({
        render: vi.fn(() => ({ name: 'link', children: { items: [] } })),
        destroy: destroyFn,
      })),
    };

    (mockBlok.Tools as unknown as { inlineTools: Map<string, unknown> }).inlineTools = new Map([['link', tool]]);

    const opens = internals().toolOpensPopover('link');

    expect(opens).toBe(true);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('invokeToolActionDirectly destroys the throwaway instance after invoking onActivate', () => {
    const destroyFn = vi.fn();
    const onActivate = vi.fn();
    const tool = {
      create: vi.fn(() => ({
        render: vi.fn(() => ({ name: 'bold', onActivate })),
        destroy: destroyFn,
      })),
    };

    (mockBlok.Tools as unknown as { inlineTools: Map<string, unknown> }).inlineTools = new Map([['bold', tool]]);

    internals().invokeToolActionDirectly('bold');

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });
});
