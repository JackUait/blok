/**
 * Mutation-killing tests for src/components/modules/ui.ts.
 *
 * Harness builds the real nodes through UI.make() (or wires them by hand when a
 * test needs to control listener binding itself) and stubs only the Blok module
 * registry. Every fixture uses distinct text/coords so a mutant that retargets
 * one node cannot hide behind another identical one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI } from '../../../../src/components/modules/ui';
import { Flipper } from '../../../../src/components/flipper';
import { SelectionUtils } from '../../../../src/components/selection/index';
import { destroyAnnouncer } from '../../../../src/components/utils/announcer';
import * as Logger from '../../../../src/components/utils/logger';
import { KeyboardController } from '../../../../src/components/modules/uiControllers/controllers/keyboard';
import { SelectionController } from '../../../../src/components/modules/uiControllers/controllers/selection';
import { BlockHoverController } from '../../../../src/components/modules/uiControllers/controllers/blockHover';
import { ToggleShortcuts } from '../../../../src/tools/toggle/toggle-shortcuts';
import type { BlokConfig } from '../../../../types';

const fakeCssContent = '.mock-style{}';

vi.mock(
  '../../../../src/components/styles/main.css?inline',
  () => fakeCssContent,
);

const mockRegister = vi.fn();
const mockUnregister = vi.fn();

vi.mock('../../../../src/tools/toggle/toggle-shortcuts', () => {
  const MockToggleShortcuts = vi.fn(function (this: {
    register: typeof mockRegister;
    unregister: typeof mockUnregister;
  }) {
    this.register = mockRegister;
    this.unregister = mockUnregister;
  });

  return { ToggleShortcuts: MockToggleShortcuts };
});

/**
 * Placeholder-hide utility classes the wrapper must carry (exported contract).
 */
const PLACEHOLDER_CLASS_A =
  '[&[data-blok-toolbox-opened=true]_[contentEditable=true][data-blok-placeholder-active]:focus]:before:opacity-0!';
const PLACEHOLDER_CLASS_B =
  '[&[data-blok-toolbox-opened=true]_[contentEditable=true][data-placeholder]:focus]:before:opacity-0!';

const I18N_LABELS: Record<string, string> = {
  'tools.link.copyUrl': 'STUB_COPY_LABEL',
  'tools.link.edit': 'STUB_EDIT_LABEL',
  'tools.link.urlCopied': 'STUB_COPIED_MSG',
  'tools.link.copyFailed': 'STUB_FAILED_MSG',
};

const createBlokStub = () => {
  return {
    BlockManager: {
      blocks: [],
      isBlokEmpty: false,
      currentBlock: null,
      currentBlockIndex: -1,
      lastBlock: undefined,
      insert: vi.fn(),
      insertAtEnd: vi.fn(),
      unsetCurrentBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn((): unknown => undefined),
      getBlockByChildNode: vi.fn(() => undefined),
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
      contains: vi.fn(() => false),
      hasFlipperFocus: false,
      hasNestedPopoverOpen: false,
      hasDirectMenuOpen: false,
      editLink: vi.fn(() => Promise.resolve()),
    },
    BlockSettings: {
      opened: false,
      close: vi.fn(),
      open: vi.fn(() => Promise.resolve()),
      contains: vi.fn(() => false),
      nodes: { wrapper: document.createElement('div') },
    },
    Toolbar: {
      moveAndOpen: vi.fn(),
      close: vi.fn(),
      contains: vi.fn(() => false),
      nodes: {
        wrapper: document.createElement('div'),
        settingsToggler: document.createElement('button'),
        plusButton: document.createElement('button'),
      },
      toolbox: {
        opened: false,
        close: vi.fn(),
        hasFocus: vi.fn(() => false),
      },
    },
    Caret: {
      setToBlock: vi.fn(),
      setToTheLastBlock: vi.fn(),
      resetGoalColumn: vi.fn(),
      positions: { START: 'start', END: 'end' },
    },
    ReadOnly: {
      isEnabled: false,
      isControlsHidden: false,
    },
    API: { methods: {} },
    BlocksAPI: { scrollToBlock: vi.fn() },
    I18n: {
      t: vi.fn((key: string) => I18N_LABELS[key] ?? key),
    },
    NotifierAPI: {
      methods: { show: vi.fn() },
    },
    YjsManager: {
      markCaretBeforeChange: vi.fn(),
    },
  };
};

type BlokStub = ReturnType<typeof createBlokStub>;

interface HarnessOptions {
  configOverrides?: Partial<BlokConfig>;
  blokOverrides?: Partial<BlokStub>;
}

interface Harness {
  ui: UI;
  blok: BlokStub;
  holder: HTMLDivElement;
  wrapper: HTMLDivElement;
  redactor: HTMLDivElement;
  bottomZone: HTMLDivElement;
  config: BlokConfig;
  eventsDispatcher: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  /** Assigns the hand-built nodes onto the module without calling make(). */
  attachNodes: () => void;
}

/**
 * Builds a UI module with hand-attached nodes. Listeners are NOT bound —
 * tests call bind* themselves after swapping handler fields for spies.
 */
const createBareUI = (options: HarnessOptions = {}): Harness => {
  const holder = document.createElement('div');
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');
  const bottomZone = document.createElement('div');

  document.body.appendChild(holder);

  const config = {
    holder,
    minHeight: 50,
    ...options.configOverrides,
  } as BlokConfig;

  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };

  const ui = new UI({
    config,
    eventsDispatcher: eventsDispatcher as unknown as UI['eventsDispatcher'],
  });

  const blok = createBlokStub();

  if (options.blokOverrides) {
    Object.assign(blok, options.blokOverrides);
  }

  ui.state = blok as unknown as UI['Blok'];

  return {
    ui,
    blok,
    holder,
    wrapper,
    redactor,
    bottomZone,
    config,
    eventsDispatcher,
    attachNodes: (): void => {
      wrapper.appendChild(redactor);
      wrapper.appendChild(bottomZone);
      holder.appendChild(wrapper);
      (ui as { nodes: UI['nodes'] }).nodes = { holder, wrapper, redactor, bottomZone };
    },
  };
};

/** Bare UI whose nodes were built by the real make() (insensitive listeners bound). */
const createMadeUI = (options: HarnessOptions = {}): Harness => {
  const harness = createBareUI(options);

  (harness.ui as unknown as { make: () => void }).make();

  const nodes = (harness.ui as unknown as { nodes: UI['nodes'] }).nodes;

  return {
    ...harness,
    wrapper: nodes.wrapper as HTMLDivElement,
    redactor: nodes.redactor as HTMLDivElement,
    bottomZone: nodes.bottomZone as HTMLDivElement,
  };
};

const priv = (ui: UI): Record<string, unknown> =>
  ui as unknown as Record<string, unknown>;

/** Sentinel DOMRect stand-in for cache assertions. */
const rectSentinel = (): DOMRect => ({ width: 4321 }) as unknown as DOMRect;

/** jsdom has no layout — rect must be stubbed explicitly. */
const stubRect = (
  element: Element,
  rect: { left: number; right: number; top: number; bottom: number },
): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  });
};

/** MouseEvent with isTrusted flipped — the click handler ignores untrusted events. */
const trustedMouseDown = (target: HTMLElement): MouseEvent => ({
  isTrusted: true,
  target,
  shiftKey: false,
} as unknown as MouseEvent);

describe('UI module — mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    destroyAnnouncer();
    destroyAnnouncer();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    if (typeof window.requestIdleCallback === 'undefined') {
      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
    vi.restoreAllMocks();
    mockRegister.mockReset();
    mockRegister.mockImplementation(() => undefined);
    mockUnregister.mockReset();
  });

  describe('make() — wrapper/redactor/bottomZone markup', () => {
    it('carries every wrapper utility class, including both placeholder-hide rules', () => {
      const { wrapper } = createMadeUI();

      for (const className of [
        'group',
        'relative',
        'box-border',
        'z-1',
        'data-[blok-dragging=true]:cursor-grabbing',
        '[&_svg]:max-h-full',
        '[&_::selection]:bg-selection-inline',
        PLACEHOLDER_CLASS_A,
        PLACEHOLDER_CLASS_B,
      ]) {
        expect(wrapper.classList.contains(className)).toBe(true);
      }

      expect(wrapper.classList.contains('Stryker was here')).toBe(false);
    });

    it('stamps the wrapper identity attributes with exact values', () => {
      const { ui, wrapper } = createMadeUI();

      expect(wrapper.getAttribute('data-blok-interface')).toBe('blok');
      expect(wrapper.getAttribute('data-blok-editor')).toBe('');
      expect(wrapper.getAttribute('data-blok-instance')).toMatch(/^\d+$/);
      expect(wrapper.getAttribute('data-blok-version')).not.toBe('');
      expect(wrapper.getAttribute('data-blok-testid')).toBe('blok-editor');
      expect(wrapper.getAttribute('data-blok-content-align')).toBe('left');
      expect(wrapper.getAttribute('data-blok-toolbar-position')).toBe('left');
      expect(wrapper.hasAttribute('data-blok-toolbar-hidden')).toBe(false);
      expect(wrapper.hasAttribute('data-blok-native-selection')).toBe(false);
      expect(wrapper.hasAttribute('data-blok-rtl')).toBe(false);
      expect(ui.getWidthMode()).toBe('narrow');
    });

    it('stamps explicit contentAlign and toolbarPosition values', () => {
      const { wrapper } = createMadeUI({
        configOverrides: {
          style: { contentAlign: 'center' },
          toolbarPosition: 'right',
        },
      });

      expect(wrapper.getAttribute('data-blok-content-align')).toBe('center');
      expect(wrapper.getAttribute('data-blok-toolbar-position')).toBe('right');
    });

    it('marks the wrapper hidden-toolbar and native-selection when configured', () => {
      const { wrapper } = createMadeUI({
        configOverrides: {
          hideToolbar: true,
          style: { nativeSelection: true },
        },
      });

      expect(wrapper.getAttribute('data-blok-toolbar-hidden')).toBe('');
      expect(wrapper.getAttribute('data-blok-native-selection')).toBe('');
      // nativeSelection opt-out removes the ::selection utility from the class list
      expect(wrapper.classList.contains('[&_::selection]:bg-selection-inline')).toBe(false);
      expect(wrapper.className).not.toContain('Stryker was here');
    });

    it('marks the wrapper RTL with both the class and the attribute', () => {
      const { wrapper } = createMadeUI({
        configOverrides: { i18n: { direction: 'rtl' } },
      });

      expect(wrapper.classList.contains('[direction:rtl]')).toBe(true);
      expect(wrapper.getAttribute('data-blok-rtl')).toBe('true');
    });

    it('builds redactor and bottom zone with their markers', () => {
      const { ui, config } = createMadeUI();

      const nodes = priv(ui).nodes as UI['nodes'];

      expect(nodes.redactor.getAttribute('data-blok-redactor')).toBe('');
      expect(nodes.redactor.getAttribute('data-blok-testid')).toBe('redactor');
      expect(nodes.redactor.classList.contains(
        '[&_[contenteditable]:empty]:after:content-["\\feff_"]',
      )).toBe(true);

      expect(nodes.bottomZone.getAttribute('data-blok-bottom-zone')).toBe('');
      expect(nodes.bottomZone.getAttribute('data-blok-testid')).toBe('bottom-zone');
      expect(nodes.bottomZone.classList.contains('cursor-text')).toBe(true);
      expect(nodes.bottomZone.style.minHeight).toBe(`${config.minHeight as number}px`);

      const children = Array.from(nodes.wrapper.children);

      expect(children.indexOf(nodes.bottomZone)).toBeGreaterThan(children.indexOf(nodes.redactor));
    });

    it('gives each instance a distinct, non-negative instance id', () => {
      const first = createMadeUI();
      const second = createMadeUI();

      const firstId = first.wrapper.getAttribute('data-blok-instance');
      const secondId = second.wrapper.getAttribute('data-blok-instance');

      expect(firstId).toMatch(/^\d+$/);
      expect(secondId).toMatch(/^\d+$/);
      expect(firstId).not.toBe(secondId);
    });
  });

  describe('theme-token and font tag counters', () => {
    it('renders each re-rendered token tag with an INCREASING counter suffix', () => {
      const { ui } = createMadeUI();

      ui.setThemeTokens({ '--blok-a': '1' });

      const tags = (): string[] => Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-theme-tokens-'))
        .map((tag) => tag.id);

      const suffixOf = (id: string): string => {
        // id = 'blok-theme-tokens-<holderId>-<n>'; the counter number is what
        // follows the holderId — a NEGATIVE counter would show up as '--'.
        const rest = id.slice('blok-theme-tokens-'.length);

        return rest.slice(rest.indexOf('-') + 1);
      };

      const firstId = tags()[0];
      const firstSuffix = suffixOf(firstId);

      ui.setThemeTokens({ '--blok-a': '2' });

      const secondId = tags()[0];
      const secondSuffix = suffixOf(secondId);

      expect(firstId).not.toBe(secondId);
      expect(secondSuffix).toBe(firstSuffix.replace(/\d+$/, (digits) => String(Number(digits) + 1)));
      expect(tags()).toHaveLength(1);
    });

    it('suffixes each instance theme-token tag with a non-negative counter value', () => {
      const first = createMadeUI();
      const second = createMadeUI();

      first.ui.setThemeTokens({ '--blok-selection': 'red' });
      second.ui.setThemeTokens({ '--blok-selection': 'blue' });

      const tags = Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-theme-tokens-'));

      expect(tags).toHaveLength(2);

      for (const tag of tags) {
        // A decremented counter would leave a signed ('--') suffix behind.
        const rest = tag.id.slice('blok-theme-tokens-'.length);
        const numPart = rest.slice(rest.indexOf('-') + 1);

        expect(numPart).toMatch(/^\d+$/);
      }

      const contents = tags.map((tag) => tag.textContent ?? '');

      expect(contents.some((css) => css.includes('--blok-selection: red;'))).toBe(true);
      expect(contents.some((css) => css.includes('--blok-selection: blue;'))).toBe(true);
    });
  });

  describe('resetBlockHoverState / disableHoverForCooldown', () => {
    it('delegates reset to the block hover controller', () => {
      const { ui } = createBareUI();
      const resetHoverState = vi.fn();

      priv(ui).blockHoverController = { resetHoverState };

      ui.resetBlockHoverState();

      expect(resetHoverState).toHaveBeenCalledTimes(1);
    });

    it('survives a missing block hover controller on reset', () => {
      const { ui } = createBareUI();

      priv(ui).blockHoverController = null;

      expect(() => ui.resetBlockHoverState()).not.toThrow();
    });

    it('delegates cooldown to the block hover controller', () => {
      const { ui } = createBareUI();
      const disableHoverForCooldown = vi.fn();

      priv(ui).blockHoverController = { disableHoverForCooldown };

      ui.disableHoverForCooldown();

      expect(disableHoverForCooldown).toHaveBeenCalledTimes(1);
    });

    it('survives a missing block hover controller on cooldown', () => {
      const { ui } = createBareUI();

      priv(ui).blockHoverController = null;

      expect(() => ui.disableHoverForCooldown()).not.toThrow();
    });
  });

  describe('prepare()', () => {
    it('wires controllers with the module config, dispatcher and state', async () => {
      const harness = createBareUI();
      const { ui, blok, config, eventsDispatcher } = harness;

      await ui.prepare();

      const keyboard = priv(ui).keyboardController as Record<string, unknown>;
      const selection = priv(ui).selectionController as Record<string, unknown>;
      const hover = priv(ui).blockHoverController as Record<string, unknown>;

      expect(keyboard).toBeDefined();
      expect(selection).toBeDefined();
      expect(hover).toBeDefined();

      expect(keyboard.config).toBe(config);
      expect(selection.config).toBe(config);
      expect(hover.config).toBe(config);

      expect(keyboard.eventsDispatcher).toBe(eventsDispatcher);
      expect(selection.eventsDispatcher).toBe(eventsDispatcher);
      expect(hover.eventsDispatcher).toBe(eventsDispatcher);

      expect(keyboard.Blok).toBe(blok);
      expect(selection.Blok).toBe(blok);
      expect(hover.Blok).toBe(blok);

      const someToolbarOpened = keyboard.someToolbarOpened as () => boolean;

      expect(someToolbarOpened()).toBe(false);
      blok.BlockSettings.opened = true;
      expect(someToolbarOpened()).toBe(true);
    });

    it('hands the controller its redactor and wrapper elements', async () => {
      const { ui } = createBareUI();

      const kbRedactor = vi.spyOn(KeyboardController.prototype, 'setRedactorElement');
      const kbWrapper = vi.spyOn(KeyboardController.prototype, 'setWrapperElement');
      const selWrapper = vi.spyOn(SelectionController.prototype, 'setWrapperElement');
      const hoverWrapper = vi.spyOn(BlockHoverController.prototype, 'setWrapperElement');

      await ui.prepare();

      const nodes = (ui as unknown as { nodes: UI['nodes'] }).nodes;

      expect(kbRedactor).toHaveBeenCalledWith(nodes.redactor);
      expect(kbWrapper).toHaveBeenCalledWith(nodes.wrapper);
      expect(selWrapper).toHaveBeenCalledWith(nodes.wrapper);
      expect(hoverWrapper).toHaveBeenCalledWith(nodes.wrapper);
    });

    it('creates the redactor-touch and document-click handlers from real deps', async () => {
      const harness = createBareUI();
      const { ui, blok } = harness;

      blok.BlockManager.setCurrentBlockByChildNode = vi.fn(() => undefined);

      await ui.prepare();

      const touchHandler = priv(ui).redactorTouchHandler as (event: Event) => void;
      const clickHandler = priv(ui).documentClickedHandler as (event: MouseEvent) => void;

      expect(typeof touchHandler).toBe('function');
      expect(typeof clickHandler).toBe('function');

      // Touch handler: a press outside any block falls back to the last block.
      expect(() => touchHandler(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
      expect(blok.Caret.setToTheLastBlock).toHaveBeenCalledTimes(1);

      // Click handler: trusted mousedown outside the editor clears the current block.
      const stranger = document.createElement('div');

      stranger.textContent = 'outside-click-target';
      document.body.appendChild(stranger);
      expect(() => clickHandler(trustedMouseDown(stranger))).not.toThrow();
      expect(blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('injects the shared stylesheet and registers the announcer', async () => {
      const { ui } = createBareUI();

      await ui.prepare();

      expect(document.getElementById('blok-styles')).not.toBeNull();
      expect(document.getElementById('blok-announcer')).not.toBeNull();
    });

    it('injects the per-instance font sheet during prepare when fonts are configured', async () => {
      const { ui } = createBareUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      await ui.prepare();

      const fontTag = Array.from(document.head.querySelectorAll('style'))
        .find((tag) => tag.id.startsWith('blok-font-'));

      expect(fontTag).not.toBeUndefined();
    });

    it('warns (and keeps preparing) when toggle shortcuts fail to register', async () => {
      mockRegister.mockImplementation(() => {
        throw new Error('Shortcut CMD+ALT+T is already registered for document');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { ui } = createBareUI();

      await expect(ui.prepare()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        'Blok: Failed to register toggle shortcuts:',
        expect.any(Error),
      );
    });

    it('registers toggle shortcuts with the API methods and wrapper', async () => {
      const { ui, blok } = createBareUI();

      await ui.prepare();

      const nodes = (ui as unknown as { nodes: UI['nodes'] }).nodes;

      expect(ToggleShortcuts).toHaveBeenCalledWith(blok.API.methods, nodes.wrapper);
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it('debounces window resize into cache invalidation and mobile re-check', async () => {
      vi.useFakeTimers();

      const { ui, eventsDispatcher } = createMadeUI();
      const cache = rectSentinel();

      priv(ui).contentRectCache = cache;

      window.innerWidth = 400;
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(250);

      expect(priv(ui).contentRectCache).toBeNull();
      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(1);
      expect(ui.isMobile).toBe(true);
    });
  });

  describe('toggleReadOnly()', () => {
    it('does not throw when the interface was never built', () => {
      const { ui } = createBareUI();

      expect(() => ui.toggleReadOnly(true)).not.toThrow();
    });

    it('collapses the bottom zone read-only and restores it read-write', () => {
      const { ui, bottomZone, config } = createMadeUI({ configOverrides: { minHeight: 120 } });

      ui.toggleReadOnly(false);
      expect(bottomZone.style.minHeight).toBe(`${config.minHeight as number}px`);

      ui.toggleReadOnly(true);
      expect(bottomZone.style.minHeight).toBe('0px');
    });

    it('flips block content contenteditable with the mode', () => {
      const { ui, blok } = createMadeUI();
      const holder = document.createElement('div');
      const marker = document.createElement('span');

      marker.setAttribute('data-blok-mutation-free', 'true');
      marker.setAttribute('contenteditable', 'false');

      const content = document.createElement('div');

      content.setAttribute('contenteditable', 'false');
      content.textContent = 'Editable surface A';

      holder.append(marker, content);
      (blok.BlockManager as unknown as { blocks: Array<{ holder: HTMLElement }> }).blocks = [{ holder }];

      // jsdom has no contentEditable IDL: the module's write lands as an own
      // property on the element, so assert that property (undefined = untouched).
      ui.toggleReadOnly(false);
      expect((content as unknown as { contentEditable: string }).contentEditable).toBe('true');
      expect((marker as unknown as { contentEditable: string | undefined }).contentEditable).toBeUndefined();

      ui.toggleReadOnly(true);
      expect((content as unknown as { contentEditable: string }).contentEditable).toBe('false');
    });

    it('tolerates a missing requestIdleCallback when enabling editing', () => {
      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      const { ui } = createMadeUI();

      expect(() => ui.toggleReadOnly(false)).not.toThrow();
    });

    it('schedules an idle re-bind with the historical timeout', () => {
      const { ui } = createMadeUI();
      const idleCallback = vi.fn();

      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: idleCallback,
      });

      ui.toggleReadOnly(false);

      expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    });

    it('stamps readonly and controls-hidden attributes on the wrapper', () => {
      const { ui, blok, wrapper } = createMadeUI();

      (blok.ReadOnly as { isControlsHidden: boolean }).isControlsHidden = true;

      ui.toggleReadOnly(true);
      expect(wrapper.hasAttribute('data-blok-readonly')).toBe(true);
      expect(wrapper.hasAttribute('data-blok-controls-hidden')).toBe(true);

      ui.toggleReadOnly(false);
      expect(wrapper.hasAttribute('data-blok-readonly')).toBe(false);
      expect(wrapper.hasAttribute('data-blok-controls-hidden')).toBe(false);
    });
  });

  describe('toolbar/flipper getters', () => {
    it('reports no toolbar open when every toolbar is closed', () => {
      const { ui } = createBareUI();

      expect(ui.someToolbarOpened).toBe(false);
    });

    it('reports a toolbar open when BlockSettings, InlineToolbar or toolbox opens', () => {
      const { ui, blok } = createBareUI();

      blok.BlockSettings.opened = true;
      expect(ui.someToolbarOpened).toBe(true);
      blok.BlockSettings.opened = false;

      blok.InlineToolbar.opened = true;
      expect(ui.someToolbarOpened).toBe(true);
      blok.InlineToolbar.opened = false;

      blok.Toolbar.toolbox.opened = true;
      expect(ui.someToolbarOpened).toBe(true);
    });

    it('reports no flipper focus when nothing is focused, even with odd module shapes', () => {
      const { ui, blok } = createBareUI();

      // A flipper-less module and a null module must not crash the scan.
      (blok as unknown as Record<string, unknown>).PlainModule = { noFlipper: true };
      (blok as unknown as Record<string, unknown>).NullModule = null;
      // A hasFocus-duck that is NOT a Flipper instance must be rejected.
      (blok as unknown as Record<string, unknown>).DuckModule = {
        flipper: { hasFocus: () => true },
      };
      // A primitive module value must be skipped, not dereferenced.
      (blok as unknown as Record<string, unknown>).StringModule = 'primitive-module';

      expect(ui.someFlipperButtonFocused).toBe(false);
    });

    it('detects focus on a module flipper', () => {
      const { ui, blok } = createBareUI();

      const flipper = new Flipper({ items: [] });

      flipper.hasFocus = vi.fn(() => true);
      (blok as unknown as Record<string, unknown>).MockModule = { flipper };

      expect(ui.someFlipperButtonFocused).toBe(true);

      flipper.hasFocus = vi.fn(() => false);
      expect(ui.someFlipperButtonFocused).toBe(false);
    });

    it('detects toolbox focus before scanning module flippers', () => {
      const { ui, blok } = createBareUI();

      (blok.Toolbar.toolbox.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(true);

      expect(ui.someFlipperButtonFocused).toBe(true);
    });
  });

  describe('destroy()', () => {
    it('unregisters shortcuts, clears the holder and removes injected tags', async () => {
      const { ui, holder } = createMadeUI({
        configOverrides: {
          style: { tokens: { '--blok-selection': 'blue' } },
        },
      });

      await ui.prepare();

      expect(document.getElementById('blok-announcer')).not.toBeNull();

      ui.setThemeTokens({ '--blok-selection': 'green' });

      priv(ui).toggleShortcuts = { unregister: mockUnregister };

      const themeTagsBefore = document.head.querySelectorAll('style[id^="blok-theme-tokens-"]');

      expect(themeTagsBefore.length).toBeGreaterThan(0);

      ui.destroy();

      expect(mockUnregister).toHaveBeenCalledTimes(1);
      expect(holder.innerHTML).toBe('');
      expect(document.head.querySelectorAll('style[id^="blok-theme-tokens-"]')).toHaveLength(0);
      expect(document.getElementById('blok-announcer')).toBeNull();
    });

    it('destroys cleanly when no font sheet was ever injected', () => {
      const { ui } = createMadeUI();

      // A host element that happens to own the id "null" must not be touched.
      const stray = document.createElement('div');

      stray.id = 'null';
      stray.textContent = 'stray-null-id-host';
      document.body.appendChild(stray);

      expect(() => ui.destroy()).not.toThrow();
      expect(stray.isConnected).toBe(true);
    });

    it('destroys cleanly after its font sheet was removed externally', () => {
      const { ui } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();
      document.head.innerHTML = '';

      expect(() => ui.destroy()).not.toThrow();
    });

    it('unbinds read-only-sensitive listeners so the bottom zone dies', () => {
      const { ui, blok, bottomZone } = createMadeUI();

      Object.assign(blok.BlockManager, {
        lastBlock: { tool: { isDefault: true }, isEmpty: false, holder: document.createElement('div') },
      });
      (ui as unknown as { bindReadOnlySensitiveListeners: () => void }).bindReadOnlySensitiveListeners();

      ui.destroy();

      bottomZone.click();

      expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
    });
  });

  describe('setIsMobile()', () => {
    it('treats the breakpoint width itself as desktop', () => {
      const { ui } = createBareUI();

      window.innerWidth = 650;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(ui.isMobile).toBe(false);
    });

    it('emits the layout toggle only when the mode actually changes', () => {
      const { ui, eventsDispatcher } = createBareUI();

      window.innerWidth = 400;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(1);
      expect(ui.isMobile).toBe(true);

      window.innerWidth = 1200;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(2);
      expect(ui.isMobile).toBe(false);
    });
  });

  describe('loadStyles()', () => {
    it('omits the nonce attribute when the config carries no nonce', () => {
      const { ui } = createMadeUI({ configOverrides: { style: {} } });

      (ui as unknown as { loadStyles: () => void }).loadStyles();

      const tag = document.getElementById('blok-styles');

      expect(tag).not.toBeNull();
      expect(tag?.hasAttribute('nonce')).toBe(false);
    });

    it('prepends the stylesheet once and carries the configured nonce', () => {
      const { ui } = createMadeUI({ configOverrides: { style: { nonce: 'n-1' } } });

      const load = (): void => (ui as unknown as { loadStyles: () => void }).loadStyles();

      load();
      load();

      const tag = document.getElementById('blok-styles');

      expect(tag?.getAttribute('nonce')).toBe('n-1');
      expect(document.getElementById('blok-styles')).toBe(tag);
      expect(document.head.firstChild).toBe(tag);
      expect(document.querySelectorAll('#blok-styles')).toHaveLength(1);
    });
  });

  describe('loadFontStyles()', () => {
    const fontTags = (): HTMLStyleElement[] =>
      Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-font-'));

    it('derives the tag id from the wrapper interface value for an id-less holder', () => {
      const { ui, wrapper } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      const instance = wrapper.getAttribute('data-blok-instance');
      const tag = fontTags()[0];

      expect(tag?.id).toBe(`blok-font-blok-${instance ?? 'none'}`);
    });

    it('derives the tag id from the holder id when one exists', () => {
      const { ui, holder } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      holder.id = 'my-editor';

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      expect(fontTags()[0]?.id.startsWith('blok-font-my-editor-')).toBe(true);
    });

    it('scopes the sheet to this instance and joins every declaration with newlines', () => {
      const { ui, wrapper } = createMadeUI({
        configOverrides: {
          style: {
            fontFamily: 'Georgia',
            fontFamilySans: 'Roboto',
            fontSize: { paragraph: '17px' },
          },
        },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      const instance = wrapper.getAttribute('data-blok-instance');
      const css = fontTags()[0]?.textContent ?? '';
      const lines = css.split('\n');

      expect(css).toContain(`[data-blok-instance="${instance ?? 'none'}"]`);
      expect(css).toContain('[data-blok-popover]:not([data-blok-popover-inline])');
      expect(lines.filter((line) => line === '}')).toHaveLength(2);
      expect(css).toContain('--blok-font-family: Georgia;\n');
      expect(css).toContain('--blok-font-sans: Roboto;\n');
      expect(css).toContain('  --blok-paragraph-font-size: 17px;');
    });

    it('pushes only the font fields that are actually set', () => {
      const { ui } = createMadeUI({
        configOverrides: { style: { fontSize: { paragraph: '17px' } } },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      const css = fontTags()[0]?.textContent ?? '';

      expect(css).not.toContain('--blok-font-family:');
      expect(css).not.toContain('--blok-font-sans:');
      expect(css).not.toContain('--blok-font-serif:');
      expect(css).not.toContain('--blok-font-mono:');
      expect(css).not.toContain('--blok-font-handwriting:');
      expect(css).toContain('--blok-paragraph-font-size: 17px;');
      expect(css).not.toContain('Stryker was here');
    });

    it('leaves the nonce attribute off when the style config has none', () => {
      const { ui } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      expect(fontTags()[0]?.hasAttribute('nonce')).toBe(false);
    });

    it('falls back to the default tag-id segment when no holder id or interface exists', () => {
      const harness = createBareUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      harness.attachNodes();

      const wrapper = priv(harness.ui).nodes as UI['nodes'];

      (wrapper.wrapper).removeAttribute('data-blok-interface');
      (harness.ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      const tag = Array.from(document.head.querySelectorAll('style'))
        .find((candidate) => candidate.id.startsWith('blok-font-'));

      expect(tag?.id.startsWith('blok-font-default-')).toBe(true);
    });

    it('injects nothing when no font field is configured', () => {
      const { ui } = createMadeUI({ configOverrides: { style: { nonce: 'x' } } });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      expect(fontTags()).toHaveLength(0);
    });
  });

  describe('theme tokens — validation and injection', () => {
    const themeTags = (): HTMLStyleElement[] =>
      Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-theme-tokens-'));

    it('rejects malformed keys and gutter tokens, warns, and keeps the valid ones', () => {
      const logSpy = vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
      const { ui } = createMadeUI({
        configOverrides: {
          style: {
            tokens: {
              'x--blok-bad': 'red',
              '--blok-bad{': 'y',
              '--blok-editor-gutter-start': '40px',
              '--blok-good': 'blue',
            },
          },
        },
      });

      (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

      expect(ui.getThemeTokens()).toEqual({ '--blok-good': 'blue' });

      const css = themeTags()[0]?.textContent ?? '';

      expect(css).toContain('--blok-good: blue;');
      expect(css).not.toContain('x--blok-bad');
      expect(css).not.toContain('--blok-bad{');
      expect(css).not.toContain('--blok-editor-gutter-start');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('gutter'), 'warn');
    });

    it('rejects values that could break out of the declaration block', () => {
      const { ui } = createMadeUI({
        configOverrides: {
          style: {
            tokens: {
              '--blok-bg': 'red; } body { background: lime',
              '--blok-ok': 'green',
            },
          },
        },
      });

      (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

      expect(ui.getThemeTokens()).toEqual({ '--blok-ok': 'green' });
    });

    it('derives the tag id from the holder id, else the wrapper interface value', () => {
      const withHolderId = createMadeUI({
        configOverrides: { style: { tokens: { '--blok-a': '1' } } },
      });

      withHolderId.holder.id = 'tok-holder';
      (withHolderId.ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();
      expect(themeTags().some((tag) => tag.id.startsWith('blok-theme-tokens-tok-holder-'))).toBe(true);

      const idless = createMadeUI({
        configOverrides: { style: { tokens: { '--blok-b': '2' } } },
      });

      (idless.ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();
      expect(themeTags().some((tag) => tag.id.startsWith('blok-theme-tokens-blok-'))).toBe(true);
    });

    it('joins the token declarations with newlines inside one braced rule', () => {
      const { ui } = createMadeUI({
        configOverrides: {
          style: { tokens: { '--blok-one': '1', '--blok-two': '2' } },
        },
      });

      (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

      const css = themeTags()[0]?.textContent ?? '';
      const lines = css.split('\n');

      expect(css).toContain('[data-blok-interface], [data-blok-popover], [data-blok-top-layer]');
      expect(lines).toContain('}');
      expect(css).toContain('--blok-one: 1;\n');
    });

    it('injects the token sheet after the font sheet when both exist', () => {
      const { ui } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia', tokens: { '--blok-a': '1' } } },
      });

      (ui as unknown as { make: () => void }).make();
      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();
      (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

      const tags = Array.from(document.head.querySelectorAll('style'));
      const fontIndex = tags.findIndex((tag) => tag.id.startsWith('blok-font-'));
      const tokenIndex = tags.findIndex((tag) => tag.id.startsWith('blok-theme-tokens-'));

      expect(fontIndex).toBeGreaterThanOrEqual(0);
      expect(tokenIndex).toBeGreaterThan(fontIndex);
    });

    it('prepends the token sheet when no font sheet exists', () => {
      const { ui } = createMadeUI();

      // An element that happens to own the id "null" must not be mistaken for
      // this instance's font sheet.
      const stray = document.createElement('div');

      stray.id = 'null';
      document.head.appendChild(stray);

      expect(() => ui.setThemeTokens({ '--blok-x': '1' })).not.toThrow();

      const tags = Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-theme-tokens-'));

      expect(tags).toHaveLength(1);
      expect(document.head.firstChild).toBe(tags[0]);
    });

    it('re-checks that the font sheet still lives in <head> before sitting after it', () => {
      const { ui } = createMadeUI({
        configOverrides: { style: { fontFamily: 'Georgia' } },
      });

      (ui as unknown as { loadFontStyles: () => void }).loadFontStyles();

      const fontTag = Array.from(document.head.querySelectorAll('style'))
        .find((tag) => tag.id.startsWith('blok-font-'));

      expect(fontTag).not.toBeUndefined();

      // Host code moves the font sheet out of <head>: the token sheet must
      // fall back to prepending, not chase the font sheet into the body.
      document.head.removeChild(fontTag as HTMLElement);
      document.body.appendChild(fontTag as HTMLElement);

      ui.setThemeTokens({ '--blok-x': '1' });

      const tokenTag = Array.from(document.head.querySelectorAll('style'))
        .find((tag) => tag.id.startsWith('blok-theme-tokens-'));

      expect(tokenTag).not.toBeUndefined();
      expect(document.head.firstChild).toBe(tokenTag);
    });

    it('survives re-rendering after its previous tag was removed externally', () => {
      const { ui } = createMadeUI();

      ui.setThemeTokens({ '--blok-x': '1' });
      document.head.innerHTML = '';

      expect(() => ui.setThemeTokens({ '--blok-x': '2' })).not.toThrow();

      const tags = Array.from(document.head.querySelectorAll('style'))
        .filter((tag) => tag.id.startsWith('blok-theme-tokens-'));

      expect(tags).toHaveLength(1);
      expect(tags[0]?.textContent).toContain('--blok-x: 2;');
    });

    it('injects nothing for empty tokens at construction time', () => {
      const { ui } = createMadeUI({ configOverrides: { style: { tokens: {} } } });

      (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

      expect(themeTags()).toHaveLength(0);
    });
  });

  describe('read-only-insensitive listeners', () => {
    /** Replaces the module's arrow-function handler fields with spies before binding. */
    const spyHandlers = (harness: Harness): Record<string, ReturnType<typeof vi.fn>> => {
      const spies = {
        touch: vi.fn(),
        mouseMove: vi.fn(),
        mouseOut: vi.fn(),
        click: vi.fn(),
        contextMenu: vi.fn(),
      };

      priv(harness.ui).documentTouchedListener = spies.touch;
      priv(harness.ui).anchorMouseMoveListener = spies.mouseMove;
      priv(harness.ui).anchorMouseOutListener = spies.mouseOut;
      priv(harness.ui).redactorClickListener = spies.click;
      priv(harness.ui).redactorContextMenu = spies.contextMenu;

      return spies;
    };

    const bareWithSpies = (): { harness: Harness; spies: Record<string, ReturnType<typeof vi.fn>> } => {
      const harness = createBareUI();

      harness.attachNodes();

      return { harness, spies: spyHandlers(harness) };
    };

    it('binds every delegated handler and unbinds it again', () => {
      const { harness, spies } = bareWithSpies();

      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      harness.redactor.dispatchEvent(new Event('mousedown'));
      harness.redactor.dispatchEvent(new Event('touchstart'));
      harness.redactor.dispatchEvent(new MouseEvent('mousemove'));
      harness.redactor.dispatchEvent(new MouseEvent('mouseout'));
      harness.redactor.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // mousedown and touchstart share the touch handler: two calls.
      expect(spies.touch).toHaveBeenCalledTimes(2);
      expect(spies.mouseMove).toHaveBeenCalledTimes(1);
      expect(spies.mouseOut).toHaveBeenCalledTimes(1);
      expect(spies.click).toHaveBeenCalledTimes(1);

      (harness.ui as unknown as { unbindReadOnlyInsensitiveListeners: () => void })
        .unbindReadOnlyInsensitiveListeners();

      spies.touch.mockClear();
      spies.mouseMove.mockClear();
      spies.mouseOut.mockClear();
      spies.click.mockClear();

      harness.redactor.dispatchEvent(new Event('mousedown'));
      harness.redactor.dispatchEvent(new Event('touchstart'));
      harness.redactor.dispatchEvent(new MouseEvent('mousemove'));
      harness.redactor.dispatchEvent(new MouseEvent('mouseout'));
      harness.redactor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      harness.redactor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(spies.touch).not.toHaveBeenCalled();
      expect(spies.mouseMove).not.toHaveBeenCalled();
      expect(spies.mouseOut).not.toHaveBeenCalled();
      expect(spies.click).not.toHaveBeenCalled();
      expect(spies.contextMenu).not.toHaveBeenCalled();
    });

    it('receives contextmenu during binding', () => {
      const { harness, spies } = bareWithSpies();

      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      harness.redactor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(spies.contextMenu).toHaveBeenCalledTimes(1);
    });

    it('keeps the resize debouncer working while bound and dead after unbind', async () => {
      vi.useFakeTimers();

      const { ui } = createMadeUI();
      const unbind = (): void =>
        (ui as unknown as { unbindReadOnlyInsensitiveListeners: () => void })
          .unbindReadOnlyInsensitiveListeners();

      // Still bound: resize invalidates the cache.
      priv(ui).contentRectCache = rectSentinel();
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(250);
      expect(priv(ui).contentRectCache).toBeNull();

      // Unbound: the sentinel survives.
      unbind();
      priv(ui).contentRectCache = rectSentinel();
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(250);
      expect(priv(ui).contentRectCache).not.toBeNull();
    });

    it('catches redactor presses during capture even when the target stops propagation', () => {
      for (const eventType of ['mousedown', 'touchstart']) {
        const { harness, spies } = bareWithSpies();

        (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
          .bindReadOnlyInsensitiveListeners();

        const child = document.createElement('div');

        child.textContent = `capture-child-${eventType}`;
        child.addEventListener(eventType, (event) => event.stopPropagation());
        harness.redactor.appendChild(child);

        child.dispatchEvent(new Event(eventType));

        expect(spies.touch).toHaveBeenCalledTimes(1);
      }
    });

    it('unbinding also disables the selection controller', () => {
      const { ui } = createMadeUI();
      const disable = vi.fn();

      priv(ui).selectionController = { disable };

      (ui as unknown as { unbindReadOnlyInsensitiveListeners: () => void })
        .unbindReadOnlyInsensitiveListeners();

      expect(disable).toHaveBeenCalledTimes(1);
    });
  });

  describe('delegated listener bodies route to their handlers', () => {
    /** Bare UI bound WITHOUT swapping the arrow fields, so their bodies execute. */
    const bareBound = (): Harness => {
      const harness = createBareUI();

      harness.attachNodes();
      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      return harness;
    };

    it('mousedown and touchstart reach the redactor touch handler', () => {
      const harness = bareBound();
      const touch = vi.fn();

      priv(harness.ui).redactorTouchHandler = touch;

      harness.redactor.dispatchEvent(new Event('mousedown'));
      harness.redactor.dispatchEvent(new Event('touchstart'));

      expect(touch).toHaveBeenCalledTimes(2);
    });

    it('survives a touch handler that was never created (direct call)', () => {
      const harness = bareBound();

      priv(harness.ui).redactorTouchHandler = null;

      expect(() =>
        (priv(harness.ui).documentTouchedListener as (e: Event) => void)(new Event('mousedown')),
      ).not.toThrow();
    });

    it('mousemove reaches the anchor hover handler only for mouse events', () => {
      const harness = bareBound();
      const hover = vi.fn();

      priv(harness.ui).handleAnchorMouseMove = hover;

      harness.redactor.dispatchEvent(new MouseEvent('mousemove'));
      expect(hover).toHaveBeenCalledTimes(1);

      harness.redactor.dispatchEvent(new Event('mousemove'));
      expect(hover).toHaveBeenCalledTimes(1);
    });

    it('mouseout reaches the anchor leave handler only for mouse events', () => {
      const harness = bareBound();
      const leave = vi.fn();

      priv(harness.ui).handleAnchorMouseOut = leave;

      harness.redactor.dispatchEvent(new MouseEvent('mouseout'));
      expect(leave).toHaveBeenCalledTimes(1);

      harness.redactor.dispatchEvent(new Event('mouseout'));
      expect(leave).toHaveBeenCalledTimes(1);
    });

    it('ignores a right click on a non-HTMLElement element such as SVG content', () => {
      const harness = createBareUI();
      const { ui, blok, redactor } = harness;

      harness.attachNodes();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

      svg.appendChild(rect);
      redactor.appendChild(svg);

      (ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

      rect.dispatchEvent(event);

      expect(blok.BlockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });

    it('ignores a below-editor click whose target is not an Element (direct)', () => {
      const harness = createBareUI();

      harness.attachNodes();

      const bare = new MouseEvent('click', { clientX: 300, clientY: 450 });

      Object.defineProperty(bare, 'target', { value: null });

      expect(() =>
        (priv(harness.ui).documentClickedBelowEditor as (e: MouseEvent) => void)(bare),
      ).not.toThrow();
    });

    it('ignores a click on an anchor without an href (direct)', () => {
      const harness = createMadeUI();

      vi.spyOn(window, 'open').mockImplementation(() => null);
      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      const anchor = document.createElement('a');

      anchor.textContent = 'no-href-direct';
      harness.redactor.appendChild(anchor);

      const bare = new MouseEvent('click', { button: 0 });

      Object.defineProperty(bare, 'target', { value: anchor });

      expect(() =>
        (priv(harness.ui).redactorClickListener as (e: MouseEvent) => void)(bare),
      ).not.toThrow();
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('read-only-sensitive listeners', () => {
    const makeLastBlock = (blok: BlokStub, isEmpty = false): void => {
      Object.assign(blok.BlockManager, {
        lastBlock: { tool: { isDefault: true }, isEmpty, holder: document.createElement('div') },
      });
    };

    const bindSensitive = (harness: Harness): void => {
      (harness.ui as unknown as { bindReadOnlySensitiveListeners: () => void })
        .bindReadOnlySensitiveListeners();
    };

    it('bottom zone click appends a block, and swallows the click from every listener', () => {
      const harness = createMadeUI();
      const { ui, blok, bottomZone } = harness;

      makeLastBlock(blok);
      bindSensitive(harness);

      const documentClickSpy = vi.fn();

      document.addEventListener('click', documentClickSpy);
      const lateSiblingSpy = vi.fn();

      bottomZone.addEventListener('click', lateSiblingSpy);

      try {
        // Phase 1: the tail is a non-empty default block -> insert + swallow.
        bottomZone.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
        expect(blok.Caret.setToTheLastBlock).toHaveBeenCalledTimes(1);
        expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
        expect(lateSiblingSpy).not.toHaveBeenCalled();
        expect(documentClickSpy).not.toHaveBeenCalled();

        // Phase 2: the tail is now an empty default block -> no insert, still swallowed.
        makeLastBlock(blok, true);
        bottomZone.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
        expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledTimes(2);
        expect(lateSiblingSpy).not.toHaveBeenCalled();

        // Phase 3: the guards reject -> the click propagates untouched.
        (blok.BlockSelection as { anyBlockSelected: boolean }).anyBlockSelected = true;
        bottomZone.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(lateSiblingSpy).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener('click', documentClickSpy);
      }

      expect(priv(ui).keyboardController).toBeDefined();
    });

    it('lets content inside the bottom zone stop the click before the handler', () => {
      const harness = createMadeUI();
      const { blok, bottomZone } = harness;

      makeLastBlock(blok);
      bindSensitive(harness);

      // The bottom-zone listener is bubble-phase by design: content that stops
      // propagation keeps the handler out.
      const inner = document.createElement('span');

      inner.textContent = 'bottom-zone-inner-content';
      inner.addEventListener('click', (event) => event.stopPropagation());
      bottomZone.appendChild(inner);

      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      expect(blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
    });

    it('ignores non-mouse events on the bottom zone', () => {
      const harness = createMadeUI();
      const { blok, bottomZone } = harness;

      makeLastBlock(blok);
      bindSensitive(harness);

      bottomZone.dispatchEvent(new Event('click'));

      expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      expect(blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
    });

    it('does not append while a block selection is active or the caret has a range', () => {
      const selectedHarness = createMadeUI();

      (selectedHarness.blok.BlockSelection as { anyBlockSelected: boolean }).anyBlockSelected = true;
      makeLastBlock(selectedHarness.blok);
      bindSensitive(selectedHarness);
      selectedHarness.bottomZone.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(selectedHarness.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();

      const collapsedHarness = createMadeUI();

      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);
      makeLastBlock(collapsedHarness.blok);
      bindSensitive(collapsedHarness);

      const collapsedSibling = vi.fn();

      collapsedHarness.bottomZone.addEventListener('click', collapsedSibling);
      collapsedHarness.bottomZone.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // A rejected append must leave the click intact for other listeners.
      expect(collapsedHarness.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      expect(collapsedHarness.blok.Caret.setToTheLastBlock).not.toHaveBeenCalled();
      expect(collapsedSibling).toHaveBeenCalledTimes(1);
    });

    it('toggles data-blok-empty on input and focus events from content', () => {
      const harness = createMadeUI();

      bindSensitive(harness);

      const input = document.createElement('div');

      input.textContent = '';
      harness.wrapper.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.getAttribute('data-blok-empty')).toBe('true');

      input.dispatchEvent(new Event('focusin', { bubbles: true }));

      expect(input.getAttribute('data-blok-empty')).toBe('true');
    });

    describe('captureClicksBelowEditor', () => {
      const createCaptureUI = (): Harness => {
        const harness = createMadeUI({
          configOverrides: { captureClicksBelowEditor: true },
        });

        harness.wrapper.setAttribute('data-blok-editor', '');
        stubRect(harness.wrapper, { left: 100, right: 500, top: 0, bottom: 400 });
        makeLastBlock(harness.blok);
        bindSensitive(harness);

        return harness;
      };

      const clickAt = (target: Element, x: number, y: number): MouseEvent => {
        const event = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y });

        target.dispatchEvent(event);

        return event;
      };

      it('appends when clicking the host background below the editor', () => {
        const { blok } = createCaptureUI();

        clickAt(document.body, 300, 450);

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
        expect(blok.Caret.setToTheLastBlock).toHaveBeenCalledTimes(1);
      });

      it('appends on the exact bottom, left and right edges of the editor', () => {
        for (const coords of [[100, 450], [500, 450], [300, 400]]) {
          // Drop previous iterations' editors so click arbitration sees only one.
          document.body.innerHTML = '';

          const { blok } = createCaptureUI();

          clickAt(document.body, coords[0] ?? 0, coords[1] ?? 0);

          expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
        }
      });

      it('ignores clicks above the bottom edge or outside the horizontal band', () => {
        for (const coords of [[300, 200], [50, 450], [600, 450]]) {
          document.body.innerHTML = '';

          const { blok } = createCaptureUI();

          clickAt(document.body, coords[0] ?? 0, coords[1] ?? 0);

          expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
        }
      });

      it('never appends when the click target is not an Element', () => {
        const { blok } = createCaptureUI();

        expect(() =>
          document.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 450 })),
        ).not.toThrow();
        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      });

      it('ignores clicks on host content that does not contain the editor', () => {
        const { blok } = createCaptureUI();
        const hostContent = document.createElement('div');

        hostContent.textContent = 'host-aside-content';
        document.body.appendChild(hostContent);

        clickAt(hostContent, 300, 450);

        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      });

      it('stands down when a deeper stacked editor owns the click', () => {
        const { blok } = createCaptureUI();
        const lowerEditor = document.createElement('div');

        lowerEditor.setAttribute('data-blok-editor', '');
        document.body.appendChild(lowerEditor);
        stubRect(lowerEditor, { left: 100, right: 500, top: 500, bottom: 800 });

        clickAt(document.body, 300, 900);

        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      });

      it('ignores non-mouse document clicks even when they carry coordinates', () => {
        const { blok } = createCaptureUI();

        const plain = new Event('click', { bubbles: true });

        Object.defineProperty(plain, 'clientX', { value: 300 });
        Object.defineProperty(plain, 'clientY', { value: 450 });
        document.body.dispatchEvent(plain);

        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
        expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
      });

      it('lets a host that stops propagation win over the below-editor append', () => {
        const harness = createCaptureUI();
        const { blok, holder } = harness;

        // Bubble-phase document listener: a host stopping propagation on the
        // way up must prevent the append entirely.
        holder.addEventListener('click', (event) => event.stopPropagation());

        holder.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          clientX: 300,
          clientY: 450,
        }));

        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
        expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
      });

      it('filters deeper editors whose band excludes the click x (left edge)', () => {
        const harness = createCaptureUI();
        const { blok } = harness;

        const deeper = document.createElement('div');

        deeper.setAttribute('data-blok-editor', '');
        document.body.appendChild(deeper);
        stubRect(deeper, { left: 300, right: 500, top: 500, bottom: 800 });

        clickAt(document.body, 150, 900);

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      });

      it('filters deeper editors whose band excludes the click x (right edge)', () => {
        const harness = createCaptureUI();
        const { blok } = harness;

        const deeper = document.createElement('div');

        deeper.setAttribute('data-blok-editor', '');
        document.body.appendChild(deeper);
        stubRect(deeper, { left: 100, right: 300, top: 500, bottom: 800 });

        clickAt(document.body, 400, 900);

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      });

      it('still lets the closest editor above the click win when a deeper one exists', () => {
        const harness = createCaptureUI();
        const { blok } = harness;

        // A deeper stacked editor BELOW the click must be filtered out.
        const deeper = document.createElement('div');

        deeper.setAttribute('data-blok-editor', '');
        document.body.appendChild(deeper);
        stubRect(deeper, { left: 100, right: 500, top: 500, bottom: 900 });

        clickAt(document.body, 300, 450);

        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      });

      it('appends through a direct below-editor click without throwing', () => {
        const harness = createCaptureUI();
        const { ui, blok } = harness;

        const direct = new MouseEvent('click', { clientX: 300, clientY: 450 });

        Object.defineProperty(direct, 'target', { value: document.body });

        expect(() =>
          (priv(ui).documentClickedBelowEditor as (e: MouseEvent) => void)(direct),
        ).not.toThrow();
        expect(blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      });

      it('ignores clicks landing inside an outer editor surface', () => {
        const outerEditor = document.createElement('div');

        outerEditor.setAttribute('data-blok-editor', '');
        document.body.appendChild(outerEditor);

        const { blok, holder } = createCaptureUI();

        outerEditor.appendChild(holder);

        clickAt(outerEditor, 300, 450);

        expect(blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
      });
    });

    describe('document mousedown handler wiring', () => {
      it('runs the click handler for trusted presses and skips non-mouse events', () => {
        const harness = createMadeUI();
        const { ui } = harness;
        const handler = vi.fn();

        priv(ui).documentClickedHandler = handler;

        (ui as unknown as { bindReadOnlySensitiveListeners: () => void })
          .bindReadOnlySensitiveListeners();

        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(handler).toHaveBeenCalledTimes(1);

        document.body.dispatchEvent(new Event('mousedown'));

        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('still reaches the handler when an intermediate node stops propagation', () => {
        const harness = createMadeUI();
        const { ui } = harness;
        const handler = vi.fn();

        priv(ui).documentClickedHandler = handler;

        (ui as unknown as { bindReadOnlySensitiveListeners: () => void })
          .bindReadOnlySensitiveListeners();

        const mid = document.createElement('div');

        mid.textContent = 'mid-stop-node';
        mid.addEventListener('mousedown', (event) => event.stopPropagation());
        document.body.appendChild(mid);

        mid.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('does not bind the document handler when the flag is off', () => {
        const harness = createMadeUI();
        const { ui, blok } = harness;

        priv(ui).documentClickedHandler = null;

        (ui as unknown as { bindReadOnlySensitiveListeners: () => void })
          .bindReadOnlySensitiveListeners();

        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
      });
    });

    it('enables keyboard and hover controllers while binding, and disables on unbind', () => {
      const harness = createMadeUI();
      const { ui } = harness;
      const keyboardEnable = vi.fn();
      const hoverEnable = vi.fn();
      const keyboardDisable = vi.fn();
      const hoverDisable = vi.fn();

      priv(ui).keyboardController = { enable: keyboardEnable, disable: keyboardDisable };
      priv(ui).blockHoverController = { enable: hoverEnable, disable: hoverDisable };

      (ui as unknown as { bindReadOnlySensitiveListeners: () => void })
        .bindReadOnlySensitiveListeners();

      expect(keyboardEnable).toHaveBeenCalledTimes(1);
      expect(hoverEnable).toHaveBeenCalledTimes(1);

      (ui as unknown as { unbindReadOnlySensitiveListeners: () => void })
        .unbindReadOnlySensitiveListeners();

      expect(keyboardDisable).toHaveBeenCalledTimes(1);
      expect(hoverDisable).toHaveBeenCalledTimes(1);
    });

    it('keeps the hover controller alive when unbinding for read-only', () => {
      const harness = createMadeUI();
      const { ui } = harness;
      const hoverDisable = vi.fn();
      const hoverEnable = vi.fn();

      priv(ui).keyboardController = { enable: vi.fn(), disable: vi.fn() };
      priv(ui).blockHoverController = { enable: hoverEnable, disable: hoverDisable };

      ui.toggleReadOnly(true);

      expect(hoverDisable).not.toHaveBeenCalled();
      expect(hoverEnable).toHaveBeenCalledTimes(1);
    });

    it('hides a visible hover card when the mode changes', () => {
      const harness = createMadeUI();
      const { ui } = harness;
      const hide = vi.fn();

      priv(ui).linkHoverCard = { hide };
      priv(ui).keyboardController = { enable: vi.fn(), disable: vi.fn() };

      ui.toggleReadOnly(true);

      expect(hide).toHaveBeenCalledTimes(1);
    });
  });

  describe('redactor context menu', () => {
    const setupContextMenu = (found = true): Harness => {
      const harness = createMadeUI();

      harness.blok.BlockManager.setCurrentBlockByChildNode = found
        ? vi.fn(() => ({ id: 'ctx-block', holder: document.createElement('div') }))
        : vi.fn(() => undefined);

      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      return harness;
    };

    it('opens block settings at the cursor for a plain-content right click', () => {
      const { blok, redactor } = setupContextMenu();

      const content = document.createElement('div');

      content.textContent = 'ctx-target-content';
      redactor.appendChild(content);

      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 240,
      });

      content.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
      expect(blok.BlockSettings.open).toHaveBeenCalledTimes(1);
    });

    it('ignores right clicks carried by non-mouse events', () => {
      const { blok, redactor } = setupContextMenu();

      const content = document.createElement('div');

      content.textContent = 'ctx-plain-target';
      redactor.appendChild(content);

      const event = new Event('contextmenu', { bubbles: true, cancelable: true });

      content.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });

    it('ignores right clicks whose target is not an HTMLElement', () => {
      const { blok, redactor } = setupContextMenu();

      const textNode = document.createTextNode('ctx-text-target');

      redactor.appendChild(textNode);

      expect(() =>
        textNode.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      ).not.toThrow();
      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });

    it('leaves the native menu alone when no block owns the target', () => {
      const { blok, redactor } = setupContextMenu(false);

      const content = document.createElement('div');

      content.textContent = 'ctx-unowned-content';
      redactor.appendChild(content);

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

      content.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(blok.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    });

    it('leaves interactive elements to the browser menu', () => {
      const { blok, redactor } = setupContextMenu();

      const link = document.createElement('a');

      link.href = 'https://example.com/ctx';
      link.textContent = 'ctx-link';
      redactor.appendChild(link);

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(blok.BlockSettings.open).not.toHaveBeenCalled();
    });
  });

  describe('redactor click — link navigation', () => {
    const createLinkUI = (): Harness => {
      const harness = createMadeUI();

      vi.spyOn(window, 'open').mockImplementation(() => null);
      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      return harness;
    };

    const addAnchor = (redactor: HTMLElement, href: string): HTMLAnchorElement => {
      const anchor = document.createElement('a');

      anchor.setAttribute('href', href);
      anchor.textContent = 'link-text-unique';
      redactor.appendChild(anchor);

      return anchor;
    };

    const clickAnchor = (anchor: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });

      anchor.dispatchEvent(event);

      return event;
    };

    it('opens external links in a new tab', () => {
      const { blok, redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'https://example.com/page');

      clickAnchor(anchor);

      expect(window.open).toHaveBeenCalledWith('https://example.com/page', '_blank');
      expect(blok.BlocksAPI.scrollToBlock).not.toHaveBeenCalled();
    });

    it('opens external links that carry a fragment, too', () => {
      const { redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'https://example.com/page#section');

      clickAnchor(anchor);

      expect(window.open).toHaveBeenCalled();
    });

    it('scrolls to a same-page fragment target', () => {
      const { blok, redactor } = createLinkUI();

      const target = document.createElement('div');

      target.setAttribute('data-blok-id', 'target-1');
      target.textContent = 'scroll-target-1';
      redactor.appendChild(target);

      const anchor = addAnchor(redactor, '#target-1');

      clickAnchor(anchor);

      expect(blok.BlocksAPI.scrollToBlock).toHaveBeenCalledWith('target-1');
      expect(window.open).not.toHaveBeenCalled();
    });

    it('lets the browser follow a fragment nothing answers to', () => {
      const { blok, redactor } = createLinkUI();

      const anchor = addAnchor(redactor, '#missing-target-x');

      const event = clickAnchor(anchor);

      expect(event.defaultPrevented).toBe(false);
      expect(blok.BlocksAPI.scrollToBlock).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });

    it('still swallows unsafe schemes', () => {
      const { redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'javascript:alert(1)');

      const event = clickAnchor(anchor);

      expect(event.defaultPrevented).toBe(true);
      expect(window.open).not.toHaveBeenCalled();
    });

    it('ignores plain (non-mouse) click events on anchors', () => {
      const { redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'https://example.com/plain');

      anchor.dispatchEvent(new Event('click', { bubbles: true }));

      expect(window.open).not.toHaveBeenCalled();

      // Even a plain event dressed with button 0 must not navigate.
      const dressed = new Event('click', { bubbles: true });

      Object.defineProperty(dressed, 'button', { value: 0 });
      anchor.dispatchEvent(dressed);

      expect(window.open).not.toHaveBeenCalled();
    });

    it('does not navigate for middle clicks', () => {
      const { redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'https://example.com/middle');

      clickAnchor(anchor, { button: 1 });

      expect(window.open).not.toHaveBeenCalled();
    });

    it('does not navigate on a plain click while text is selected, but a modifier click still opens', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

      const { redactor } = createLinkUI();

      const plain = addAnchor(redactor, 'https://example.com/sel-plain');

      clickAnchor(plain);
      expect(window.open).not.toHaveBeenCalled();

      const modified = addAnchor(redactor, 'https://example.com/sel-ctrl');

      clickAnchor(modified, { ctrlKey: true });
      expect(window.open).toHaveBeenCalledWith('https://example.com/sel-ctrl', '_blank');
    });

    it('ignores anchors without an href', () => {
      const { redactor } = createLinkUI();

      const anchor = document.createElement('a');

      anchor.textContent = 'anchor-no-href';
      redactor.appendChild(anchor);

      expect(() => clickAnchor(anchor)).not.toThrow();
      expect(window.open).not.toHaveBeenCalled();
    });

    it('tolerates a null event target', () => {
      const { ui } = createLinkUI();

      const bare = new MouseEvent('click', { button: 0 });

      Object.defineProperty(bare, 'target', { value: null });

      expect(() => (priv(ui).redactorClickListener as (e: MouseEvent) => void)(bare)).not.toThrow();
      expect(window.open).not.toHaveBeenCalled();
    });

    it('does not treat anchors outside the redactor as its own', () => {
      const { ui } = createLinkUI();

      const foreignHost = document.createElement('div');

      foreignHost.textContent = 'foreign-host';
      document.body.appendChild(foreignHost);

      const foreign = document.createElement('a');

      foreign.setAttribute('href', 'https://example.com/foreign');
      foreign.textContent = 'foreign-anchor';
      foreignHost.appendChild(foreign);

      const bare = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });

      Object.defineProperty(bare, 'target', { value: foreign });

      (priv(ui).redactorClickListener as (e: MouseEvent) => void)(bare);

      expect(window.open).not.toHaveBeenCalled();
    });

    it('does not run listeners registered on the redactor after the navigation click', () => {
      const { redactor } = createLinkUI();

      const anchor = addAnchor(redactor, 'https://example.com/swallow');

      const lateListener = vi.fn();

      redactor.addEventListener('click', lateListener);

      const event = clickAnchor(anchor);

      expect(event.defaultPrevented).toBe(true);
      expect(lateListener).not.toHaveBeenCalled();
    });
  });

  describe('link hover card', () => {
    const createHoverUI = (): Harness => {
      const harness = createMadeUI();

      vi.spyOn(window, 'open').mockImplementation(() => null);
      (harness.ui as unknown as { bindReadOnlyInsensitiveListeners: () => void })
        .bindReadOnlyInsensitiveListeners();

      return harness;
    };

    const addAnchor = (redactor: HTMLElement, href: string): HTMLAnchorElement => {
      const anchor = document.createElement('a');

      anchor.setAttribute('href', href);
      anchor.textContent = 'hover-anchor-text';
      redactor.appendChild(anchor);

      return anchor;
    };

    const mouseMove = (target: Element, x: number, y: number): void => {
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    };

    const cardWrappers = (): HTMLElement[] =>
      Array.from(document.body.querySelectorAll<HTMLElement>('[data-blok-testid="link-hover-card"]'));

    const cardOf = (ui: UI): { anchor: unknown; scheduleHide: () => void } | null =>
      (priv(ui).linkHoverCard as { anchor: unknown; scheduleHide: () => void } | null);

    it('shows the card over an href-bearing anchor after the hover delay, exactly once', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/hover');

      mouseMove(anchor, 300, 200);
      vi.advanceTimersByTime(400);

      const card = cardOf(ui);

      expect(card).not.toBeNull();
      expect(card?.anchor).toBe(anchor);

      mouseMove(anchor, 300, 200);
      vi.advanceTimersByTime(400);

      expect(cardWrappers()).toHaveLength(1);
    });

    it('labels the card actions from i18n and keeps the edit affordance in edit mode', () => {
      vi.useFakeTimers();

      const { redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/labels');

      mouseMove(anchor, 10, 10);
      vi.advanceTimersByTime(400);

      const copy = document.body.querySelector('[data-blok-testid="link-hover-card-copy"]');
      const edit = document.body.querySelector('[data-blok-testid="link-hover-card-edit"]');

      expect(copy?.getAttribute('aria-label')).toBe('STUB_COPY_LABEL');
      expect(edit?.textContent).toBe('STUB_EDIT_LABEL');
      expect((edit as HTMLButtonElement | null)?.hidden).toBe(false);
    });

    it('positions the card beside the cursor', () => {
      vi.useFakeTimers();

      const { redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/pos');

      mouseMove(anchor, 300, 200);
      vi.advanceTimersByTime(400);

      const wrapper = cardWrappers()[0];

      expect(wrapper?.style.left).toBe('300px');
      expect(wrapper?.style.top).toBe('10px');
    });

    it('hides on grace even when the pointer re-entered the same anchor', () => {
      vi.useFakeTimers();

      const { redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/grace');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      const wrapper = cardWrappers()[0];

      expect(wrapper).toBeDefined();

      // Leave, then re-enter the SAME anchor before the grace timer fires.
      // The re-entry must NOT restart the show and must NOT cancel the armed
      // hide: the card still leaves.
      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(600);

      expect(document.body.contains(wrapper)).toBe(false);
    });

    it('switches to another anchor on the next hover', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();
      const first = addAnchor(redactor, 'https://example.com/first');
      const second = addAnchor(redactor, 'https://example.com/second');

      mouseMove(first, 10, 10);
      vi.advanceTimersByTime(400);
      mouseMove(second, 20, 20);
      vi.advanceTimersByTime(400);

      expect(cardOf(ui)?.anchor).toBe(second);
    });

    it('does not show a card for content without an anchor', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();

      const plain = document.createElement('div');

      plain.textContent = 'plain-hover-content';
      redactor.appendChild(plain);

      expect(() => mouseMove(plain, 5, 5)).not.toThrow();
      vi.advanceTimersByTime(400);

      expect(priv(ui).linkHoverCard).toBeNull();
      expect(cardWrappers()).toHaveLength(0);
    });

    it('does not show a card for anchors without href', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();

      const anchor = document.createElement('a');

      anchor.textContent = 'hover-no-href';
      redactor.appendChild(anchor);

      mouseMove(anchor, 5, 5);
      vi.advanceTimersByTime(400);

      expect(priv(ui).linkHoverCard).toBeNull();
    });

    it('never builds a card for anchors outside the redactor', () => {
      vi.useFakeTimers();

      const { ui } = createHoverUI();

      const foreignHost = document.createElement('div');

      foreignHost.textContent = 'foreign-hover-host';
      document.body.appendChild(foreignHost);

      const foreign = document.createElement('a');

      foreign.setAttribute('href', 'https://example.com/foreign-hover');
      foreign.textContent = 'foreign-hover-anchor';
      foreignHost.appendChild(foreign);

      const bare = new MouseEvent('mousemove', { clientX: 1, clientY: 1 });

      Object.defineProperty(bare, 'target', { value: foreign });

      (priv(ui).handleAnchorMouseMove as (e: MouseEvent) => void)(bare);
      vi.advanceTimersByTime(400);

      expect(priv(ui).linkHoverCard).toBeNull();
    });

    it('tolerates a null target on mousemove', () => {
      const { ui } = createHoverUI();

      const bare = new MouseEvent('mousemove');

      Object.defineProperty(bare, 'target', { value: null });

      expect(() => (priv(ui).handleAnchorMouseMove as (e: MouseEvent) => void)(bare)).not.toThrow();
    });

    it('tolerates targets that have no closest method at all', () => {
      const { ui } = createHoverUI();

      const closestLess = Object.create(null) as Record<string, unknown>;

      const moveBare = new MouseEvent('mousemove');

      Object.defineProperty(moveBare, 'target', { value: closestLess });

      expect(() =>
        (priv(ui).handleAnchorMouseMove as (e: MouseEvent) => void)(moveBare),
      ).not.toThrow();

      const outBare = new MouseEvent('mouseout');

      Object.defineProperty(outBare, 'target', { value: closestLess });

      expect(() =>
        (priv(ui).handleAnchorMouseOut as (e: MouseEvent) => void)(outBare),
      ).not.toThrow();

      // The click navigation path must tolerate it too.
      const harness = createHoverUI();

      const clickBare = new MouseEvent('click', { button: 0 });

      Object.defineProperty(clickBare, 'target', { value: closestLess });

      expect(() =>
        (priv(harness.ui).redactorClickListener as (e: MouseEvent) => void)(clickBare),
      ).not.toThrow();
      expect(window.open).not.toHaveBeenCalled();
    });

    it('schedules a hide when the pointer leaves the anchor and cancels it inside', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/out');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      const card = cardOf(ui);
      const scheduleHide = vi.spyOn(card as { scheduleHide: () => void }, 'scheduleHide');

      // Moving to a child of the same anchor is not a leave.
      const child = document.createElement('span');

      child.textContent = 'anchor-child-span';
      anchor.appendChild(child);

      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: child }));

      expect(scheduleHide).not.toHaveBeenCalled();

      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

      expect(scheduleHide).toHaveBeenCalledTimes(1);

      // Leaving towards an element OUTSIDE the anchor is a real leave too.
      const outside = document.createElement('div');

      outside.textContent = 'outside-anchor-target';
      redactor.appendChild(outside);

      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: outside }));

      expect(scheduleHide).toHaveBeenCalledTimes(2);
    });

    it('does not schedule a hide when the pointer leaves non-anchor content', () => {
      vi.useFakeTimers();

      const { ui, redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/plain-out');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      const card = cardOf(ui);
      const scheduleHide = vi.spyOn(card as { scheduleHide: () => void }, 'scheduleHide');

      const plain = document.createElement('div');

      plain.textContent = 'mouseout-plain-target';
      redactor.appendChild(plain);

      plain.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

      expect(scheduleHide).not.toHaveBeenCalled();
    });

    it('survives mouseout events without a card or a usable target', () => {
      const { ui, redactor } = createHoverUI();

      const plain = document.createElement('div');

      plain.textContent = 'mouseout-plain-target';
      redactor.appendChild(plain);

      expect(() => plain.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))).not.toThrow();

      // No card: the leave path must not dereference the card.
      const anchorNoCard = addAnchor(redactor, 'https://example.com/orphan-out');

      const orphanBare = new MouseEvent('mouseout');

      Object.defineProperty(orphanBare, 'target', { value: anchorNoCard });

      expect(() =>
        (priv(ui).handleAnchorMouseOut as (e: MouseEvent) => void)(orphanBare),
      ).not.toThrow();

      const anchor = addAnchor(redactor, 'https://example.com/orphan-out');

      expect(() =>
        anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })),
      ).not.toThrow();

      const bare = new MouseEvent('mouseout');

      Object.defineProperty(bare, 'target', { value: null });

      expect(() => (priv(ui).handleAnchorMouseOut as (e: MouseEvent) => void)(bare)).not.toThrow();
    });

    it('opens the destination when the card URL is activated', () => {
      vi.useFakeTimers();

      const { redactor } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/card-open');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      const urlButton = document.body.querySelector('[data-blok-testid="link-hover-card-url"]');

      urlButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(200);

      expect(window.open).toHaveBeenCalledWith('https://example.com/card-open', '_blank');
    });

    it('copies the href and notifies on success', async () => {
      vi.useFakeTimers();

      const writeText = vi.fn(() => Promise.resolve());

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      const { redactor, blok } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/card-copy');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      document.body.querySelector('[data-blok-testid="link-hover-card-copy"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await vi.advanceTimersByTimeAsync(200);

      expect(writeText).toHaveBeenCalledWith('https://example.com/card-copy');
      expect(blok.NotifierAPI.methods.show).toHaveBeenCalledWith({
        message: 'STUB_COPIED_MSG',
        style: 'success',
        time: 2000,
      });
    });

    it('notifies an error when the clipboard rejects', async () => {
      vi.useFakeTimers();

      const writeText = vi.fn(() => Promise.reject(new Error('no clipboard')));

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      const { redactor, blok } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/card-fail');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      document.body.querySelector('[data-blok-testid="link-hover-card-copy"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await vi.advanceTimersByTimeAsync(200);

      expect(blok.NotifierAPI.methods.show).toHaveBeenCalledWith({
        message: 'STUB_FAILED_MSG',
        style: 'error',
        time: 3000,
      });
    });

    it('hands the anchor to the inline toolbar edit flow', async () => {
      vi.useFakeTimers();

      const { redactor, blok } = createHoverUI();
      const anchor = addAnchor(redactor, 'https://example.com/card-edit');

      mouseMove(anchor, 1, 1);
      vi.advanceTimersByTime(400);

      document.body.querySelector('[data-blok-testid="link-hover-card-edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await vi.advanceTimersByTimeAsync(200);

      expect(blok.InlineToolbar.editLink).toHaveBeenCalledWith(anchor);
    });
  });

  describe('contentRect', () => {
    it('returns the default rect before blocks render', () => {
      const { ui, wrapper } = createMadeUI();

      wrapper.innerHTML = '';

      const rect = ui.contentRect;

      expect(rect.width).toBe(650);
      expect(rect.left).toBe(0);
      expect(rect.right).toBe(0);
    });

    it('caches the measured rect until resize', () => {
      const { ui, wrapper } = createMadeUI();

      const blockContent = document.createElement('div');

      blockContent.setAttribute('data-blok-testid', 'block-content');

      const measured = { width: 777 } as DOMRect;

      vi.spyOn(blockContent, 'getBoundingClientRect').mockReturnValue(measured);
      wrapper.appendChild(blockContent);

      expect(ui.contentRect).toBe(measured);
      expect(ui.contentRect).toBe(measured);
      expect(blockContent.getBoundingClientRect).toHaveBeenCalledTimes(1);

      (priv(ui).windowResize as () => void)();

      expect(ui.contentRect).toBe(measured);
      expect(blockContent.getBoundingClientRect).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkEmptiness, width mode and direction', () => {
    it('stamps the empty attribute from the block manager state', () => {
      const { ui, blok, wrapper } = createMadeUI();

      (blok.BlockManager as { isBlokEmpty: boolean }).isBlokEmpty = true;
      ui.checkEmptiness();
      expect(wrapper.getAttribute('data-blok-empty')).toBe('true');

      (blok.BlockManager as { isBlokEmpty: boolean }).isBlokEmpty = false;
      ui.checkEmptiness();
      expect(wrapper.getAttribute('data-blok-empty')).toBe('false');
    });

    it('round-trips the width mode attribute', () => {
      const { ui, wrapper } = createMadeUI();

      ui.setWidthMode('full');
      expect(wrapper.getAttribute('data-blok-width')).toBe('full');
      expect(ui.getWidthMode()).toBe('full');

      ui.setWidthMode('narrow');
      expect(wrapper.hasAttribute('data-blok-width')).toBe(false);
      expect(ui.getWidthMode()).toBe('narrow');
    });

    it('re-stamps the direction attribute at runtime', () => {
      const { ui, wrapper } = createMadeUI();

      ui.setDirection('rtl');
      expect(wrapper.getAttribute('data-blok-rtl')).toBe('true');
      expect(wrapper.classList.contains('[direction:rtl]')).toBe(true);

      ui.setDirection('ltr');
      expect(wrapper.hasAttribute('data-blok-rtl')).toBe(false);
      expect(wrapper.classList.contains('[direction:rtl]')).toBe(false);
    });

    it('closes every toolbar at once', () => {
      const { ui, blok } = createMadeUI();

      ui.closeAllToolbars();

      expect(blok.BlockSettings.close).toHaveBeenCalledTimes(1);
      expect(blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(blok.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
    });
  });
});
