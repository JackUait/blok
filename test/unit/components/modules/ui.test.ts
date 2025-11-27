import { afterEach, describe, expect, it, vi } from 'vitest';
import UI from '../../../../src/components/modules/ui';
import SelectionUtils from '../../../../src/components/selection';
import Flipper from '../../../../src/components/flipper';
import { DATA_INTERFACE_ATTRIBUTE, EDITOR_INTERFACE_VALUE } from '../../../../src/components/constants';
import { BlockHovered } from '../../../../src/components/events/BlockHovered';
import { EditorMobileLayoutToggled } from '../../../../src/components/events';
import * as Dom from '../../../../src/components/dom';
import { mobileScreenBreakpoint } from '../../../../src/components/utils';
import type { EditorConfig } from '../../../../types';

const fakeCssContent = '.mock-style{}';

vi.mock('../../../../src/components/styles/main.css?inline', () => fakeCssContent);

const createEditorStub = (): UI['Editor'] => {
  const blockSettingsWrapper = document.createElement('div');
  const toolbarWrapper = document.createElement('div');
  const toolbarSettingsToggler = document.createElement('button');

  return {
    BlockManager: {
      isEditorEmpty: false,
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
  } as unknown as UI['Editor'];
};

interface CreateUIOptions {
  attachNodes?: boolean;
  configOverrides?: Partial<EditorConfig>;
  editorOverrides?: Partial<ReturnType<typeof createEditorStub>>;
  holderWidth?: number;
}

type EventsDispatcherMock = {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

interface CreateUIResult {
  ui: UI;
  editor: UI['Editor'];
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
    } as EditorConfig,
    eventsDispatcher: eventsDispatcher as unknown as UI['eventsDispatcher'],
  });

  const editor = createEditorStub();

  if (options.editorOverrides) {
    Object.assign(editor, options.editorOverrides);
  }

  ui.state = editor;

  if (options.attachNodes !== false) {
    (ui as { nodes: UI['nodes'] }).nodes = {
      holder,
      wrapper,
      redactor,
    };
  }

  return {
    ui,
    editor,
    holder,
    wrapper,
    redactor,
    eventsDispatcher,
  };
};

const mockSelectionExists = (value: boolean): ReturnType<typeof vi.spyOn> => {
  return vi.spyOn(SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(value) as unknown as ReturnType<typeof vi.spyOn>;
};

const mockSelectionCollapsed = (value: boolean | null): ReturnType<typeof vi.spyOn> => {
  return vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(value) as unknown as ReturnType<typeof vi.spyOn>;
};

const mockSelectionAnchor = (value: Element | null): ReturnType<typeof vi.spyOn> => {
  return vi.spyOn(SelectionUtils, 'anchorElement', 'get').mockReturnValue(value) as unknown as ReturnType<typeof vi.spyOn>;
};

const mockSelectionRange = (value: Range | null): ReturnType<typeof vi.spyOn> => {
  return vi.spyOn(SelectionUtils, 'range', 'get').mockReturnValue(value) as unknown as ReturnType<typeof vi.spyOn>;
};

const mockSelection = (selection: Partial<Selection> | null): ReturnType<typeof vi.spyOn> => {
  return vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection as Selection | null) as unknown as ReturnType<typeof vi.spyOn>;
};

describe('UI module', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
    delete (window as Partial<Window>).requestIdleCallback;
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
    });

    it('throws when holder is missing', () => {
      const holderLessUI = new UI({
        config: {} as EditorConfig,
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        } as unknown as UI['eventsDispatcher'],
      });

      expect(() => (holderLessUI as unknown as { make: () => void }).make()).toThrowError(
        'Editor holder is not specified in the configuration.'
      );
    });

    it('creates wrapper/redactor nodes and attaches listeners', () => {
      const { ui, holder } = createUI({ attachNodes: false,
        holderWidth: 200 });
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlyInsensitiveListeners: () => void }, 'bindReadOnlyInsensitiveListeners');

      (ui as unknown as { make: () => void }).make();

      const nodes = (ui as { nodes: UI['nodes'] }).nodes;

      expect(nodes.wrapper).toBeInstanceOf(HTMLElement);
      expect(nodes.wrapper?.classList.contains(ui.CSS.editorWrapper)).toBe(true);
      expect(nodes.wrapper?.classList.contains(ui.CSS.editorWrapperNarrow)).toBe(true);
      expect(nodes.wrapper?.getAttribute(DATA_INTERFACE_ATTRIBUTE)).toBe(EDITOR_INTERFACE_VALUE);

      expect(nodes.redactor).toBeInstanceOf(HTMLElement);
      expect(nodes.redactor?.classList.contains(ui.CSS.editorZone)).toBe(true);
      expect(nodes.redactor?.style.paddingBottom).toBe(`${ui['config'].minHeight}px`);

      expect(holder.contains(nodes.wrapper as HTMLElement)).toBe(true);
      expect(bindSpy).toHaveBeenCalledTimes(1);
    });

    it('appends styles with nonce only once', () => {
      const { ui } = createUI();

      (ui as unknown as { config: EditorConfig }).config.style = {
        nonce: 'nonce-value',
      };

      (ui as unknown as { loadStyles: () => void }).loadStyles();

      const styleTag = document.getElementById('editor-js-styles');

      expect(styleTag).toBeTruthy();
      expect(styleTag?.getAttribute('nonce')).toBe('nonce-value');
      expect(document.head.firstChild).toBe(styleTag);

      (ui as unknown as { loadStyles: () => void }).loadStyles();

      expect(document.querySelectorAll('#editor-js-styles')).toHaveLength(1);
    });
  });

  describe('read-only state management', () => {
    it('unbinds sensitive listeners when read-only mode enabled', () => {
      const { ui } = createUI();
      const unbindSpy = vi.spyOn(ui as unknown as { unbindReadOnlySensitiveListeners: () => void }, 'unbindReadOnlySensitiveListeners');
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlySensitiveListeners: () => void }, 'bindReadOnlySensitiveListeners');

      ui.toggleReadOnly(true);

      expect(unbindSpy).toHaveBeenCalledTimes(1);
      expect(bindSpy).not.toHaveBeenCalled();
    });

    it('binds listeners immediately and on idle callback in read-write mode', () => {
      const { ui } = createUI();
      const bindSpy = vi.spyOn(ui as unknown as { bindReadOnlySensitiveListeners: () => void }, 'bindReadOnlySensitiveListeners');
      const idleCallback = vi.fn();

      (window as Partial<Window>).requestIdleCallback = idleCallback as unknown as typeof window.requestIdleCallback;

      ui.toggleReadOnly(false);

      expect(bindSpy).toHaveBeenCalledTimes(1);
      expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
      const scheduled = idleCallback.mock.calls[0][0];

      bindSpy.mockClear();
      scheduled();

      expect(bindSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('state updates and getters', () => {
    it('toggles empty class based on BlockManager state', () => {
      const { ui, editor, wrapper } = createUI();

      Object.assign(editor.BlockManager, { isEditorEmpty: true });
      ui.checkEmptiness();
      expect(wrapper.classList.contains(ui.CSS.editorEmpty)).toBe(true);

      Object.assign(editor.BlockManager, { isEditorEmpty: false });
      ui.checkEmptiness();
      expect(wrapper.classList.contains(ui.CSS.editorEmpty)).toBe(false);
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

      blockContent.classList.add('blok-element__content');
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
      const { ui, editor } = createUI();

      editor.BlockSettings.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      editor.BlockSettings.opened = false;
      editor.InlineToolbar.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      editor.InlineToolbar.opened = false;
      editor.Toolbar.toolbox.opened = true;
      expect(ui.someToolbarOpened).toBe(true);

      editor.Toolbar.toolbox.opened = false;

      vi.mocked(editor.Toolbar.toolbox.hasFocus).mockReturnValue(true);
      expect(ui.someFlipperButtonFocused).toBe(true);

      vi.mocked(editor.Toolbar.toolbox.hasFocus).mockReturnValue(false);
      const flipper = new Flipper({ items: [] });

      flipper.hasFocus = vi.fn(() => true);

      (editor as unknown as Record<string, unknown>).MockModule = {
        flipper,
      };

      expect(ui.someFlipperButtonFocused).toBe(true);
    });

    it('updates mobile flag and emits layout toggle when breakpoint changes', () => {
      const { ui, eventsDispatcher } = createUI();

      window.innerWidth = mobileScreenBreakpoint - 1;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(ui.isMobile).toBe(true);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(EditorMobileLayoutToggled, {
        isEnabled: false,
      });

      eventsDispatcher.emit.mockClear();
      window.innerWidth = mobileScreenBreakpoint + 1;
      (ui as unknown as { setIsMobile: () => void }).setIsMobile();

      expect(ui.isMobile).toBe(false);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(EditorMobileLayoutToggled, {
        isEnabled: true,
      });
    });

    it('closes all toolbars at once', () => {
      const { ui, editor } = createUI();

      ui.closeAllToolbars();

      expect(editor.BlockSettings.close).toHaveBeenCalledTimes(1);
      expect(editor.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(editor.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard handling', () => {
    it('skips enter handling when any toolbar opened', () => {
      const { ui, editor } = createUI();

      editor.InlineToolbar.opened = true;

      (ui as unknown as { enterPressed: (event: KeyboardEvent) => void }).enterPressed(new KeyboardEvent('keydown'));

      expect(editor.BlockManager.insert).not.toHaveBeenCalled();
    });

    it('clears selected blocks on enter when selection absent', () => {
      const { ui, editor } = createUI();

      Object.assign(editor.BlockSelection, { anyBlockSelected: true });
      mockSelectionExists(false);
      mockSelectionCollapsed(true);

      const event = {
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.body,
      } as unknown as KeyboardEvent;

      (ui as unknown as { enterPressed: (event: KeyboardEvent) => void }).enterPressed(event);

      expect(editor.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('inserts new block when enter pressed on body without selection', () => {
      const { ui, editor } = createUI();
      const newBlock = { id: 'new' } as unknown as ReturnType<typeof editor.BlockManager.insert>;

      Object.assign(editor.BlockSelection, { anyBlockSelected: false });
      editor.BlockManager.currentBlockIndex = 1;
      vi.mocked(editor.BlockManager.insert).mockReturnValue(newBlock);
      mockSelectionExists(true);
      mockSelectionCollapsed(false);

      const event = {
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        stopPropagation: vi.fn(),
        target: document.body,
      } as unknown as KeyboardEvent;

      (ui as unknown as { enterPressed: (event: KeyboardEvent) => void }).enterPressed(event);

      expect(editor.BlockManager.insert).toHaveBeenCalledTimes(1);
      expect(editor.Caret.setToBlock).toHaveBeenCalledWith(newBlock);
      expect(editor.Toolbar.moveAndOpen).toHaveBeenCalledWith(newBlock);
      expect(editor.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
    });

    it('handles escape priority order', () => {
      const { ui, editor } = createUI();
      const event = new KeyboardEvent('keydown');

      editor.Toolbar.toolbox.opened = true;
      editor.BlockManager.currentBlock = {
        id: 'test',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as typeof editor.BlockManager.currentBlock;

      (ui as unknown as { escapePressed: (event: KeyboardEvent) => void }).escapePressed(event);

      expect(editor.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
      expect(editor.Caret.setToBlock).toHaveBeenCalledWith(editor.BlockManager.currentBlock, editor.Caret.positions.END);

      editor.Toolbar.toolbox.opened = false;
      editor.BlockSettings.opened = true;
      (ui as unknown as { escapePressed: (event: KeyboardEvent) => void }).escapePressed(event);
      expect(editor.BlockSettings.close).toHaveBeenCalledTimes(1);

      editor.BlockSettings.opened = false;
      editor.InlineToolbar.opened = true;
      (ui as unknown as { escapePressed: (event: KeyboardEvent) => void }).escapePressed(event);
      expect(editor.InlineToolbar.close).toHaveBeenCalledTimes(1);

      editor.InlineToolbar.opened = false;
      (ui as unknown as { escapePressed: (event: KeyboardEvent) => void }).escapePressed(event);
      expect(editor.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('sends keydown to block events or clears caret on default handler', () => {
      const { ui, editor, holder } = createUI();

      const outsideTarget = document.createElement('div');

      document.body.appendChild(outsideTarget);
      editor.BlockManager.currentBlock = {
        id: 'test',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as typeof editor.BlockManager.currentBlock;

      (ui as unknown as { defaultBehaviour: (event: KeyboardEvent) => void }).defaultBehaviour({
        target: outsideTarget,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as KeyboardEvent);

      expect(editor.BlockEvents.keydown).toHaveBeenCalledTimes(1);

      Object.assign(editor.BlockManager, { currentBlock: undefined });
      (ui as unknown as { defaultBehaviour: (event: KeyboardEvent) => void }).defaultBehaviour({
        target: outsideTarget,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as KeyboardEvent);

      expect(editor.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(editor.Toolbar.close).toHaveBeenCalledTimes(1);

      holder.classList.add(ui.CSS.editorWrapper);
      (ui as unknown as { defaultBehaviour: (event: KeyboardEvent) => void }).defaultBehaviour({
        target: holder,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as KeyboardEvent);

      expect(editor.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('selection handling', () => {
    it('responds to selection changes and clears cross block ranges', () => {
      const { ui, editor } = createUI();

      Object.assign(editor.CrossBlockSelection, { isCrossBlockSelectionStarted: true });
      Object.assign(editor.BlockSelection, { anyBlockSelected: true });

      const removeRanges = vi.fn();

      mockSelection({ removeAllRanges: removeRanges });
      mockSelectionAnchor(null);
      mockSelectionRange(null);

      (ui as unknown as { selectionChanged: () => void }).selectionChanged();

      expect(removeRanges).toHaveBeenCalledTimes(1);
      expect(editor.InlineToolbar.close).toHaveBeenCalledTimes(1);
    });

    it('closes inline toolbar when selection outside block content', () => {
      const { ui, editor, holder } = createUI();
      const externalElement = document.createElement('div');

      holder.appendChild(externalElement);

      mockSelectionAnchor(externalElement);

      (ui as unknown as { selectionChanged: () => void }).selectionChanged();

      expect(editor.InlineToolbar.close).toHaveBeenCalledTimes(1);
    });

    it('skips closing when inline toolbar enabled for external element and opens toolbar for block content', async () => {
      const { ui, editor, wrapper } = createUI();
      const blockContent = document.createElement('div');

      blockContent.classList.add('blok-element__content');
      wrapper.classList.add(SelectionUtils.CSS.editorWrapper);
      const external = document.createElement('div');

      wrapper.appendChild(blockContent);
      wrapper.parentElement?.appendChild(external);
      external.setAttribute('data-blok-inline-toolbar', 'true');

      const anchorSpy = vi.spyOn(SelectionUtils, 'anchorElement', 'get');

      anchorSpy.mockReturnValue(external);

      (ui as unknown as { selectionChanged: () => void }).selectionChanged();
      expect(editor.InlineToolbar.close).toHaveBeenCalledTimes(1);

      editor.BlockManager.currentBlock = undefined;
      anchorSpy.mockReturnValue(blockContent);

      await (ui as unknown as { selectionChanged: () => Promise<void> }).selectionChanged();

      expect(editor.BlockManager.setCurrentBlockByChildNode).toHaveBeenLastCalledWith(blockContent);
      expect(editor.InlineToolbar.tryToShow).toHaveBeenCalledWith(true);
    });
  });

  describe('DOM interactions', () => {
    it('moves toolbar on document touch when block selected', () => {
      const { ui, editor, redactor } = createUI();
      const block = document.createElement('div');

      redactor.appendChild(block);

      (ui as unknown as { documentTouched: (event: Event) => void }).documentTouched({
        target: block,
      } as unknown as Event);

      expect(editor.BlockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block);
      expect(editor.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
    });

    it('clears current block when clicking outside of editor', () => {
      const { ui, editor } = createUI();
      const outside = document.createElement('div');

      document.body.appendChild(outside);

      vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(false);

      (ui as unknown as { documentClicked: (event: MouseEvent) => void }).documentClicked({
        target: outside,
        isTrusted: true,
      } as unknown as MouseEvent);

      expect(editor.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(editor.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(editor.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('closes block settings when clicking inside redactor', () => {
      const { ui, editor, redactor } = createUI();

      editor.BlockSettings.opened = true;
      const blockElement = document.createElement('div');

      redactor.appendChild(blockElement);
      const blockStub = {
        id: 'test',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as ReturnType<typeof editor.BlockManager.getBlockByChildNode>;

      vi.mocked(editor.BlockManager.getBlockByChildNode).mockReturnValue(blockStub);

      (ui as unknown as { documentClicked: (event: MouseEvent) => void }).documentClicked({
        target: blockElement,
        isTrusted: true,
      } as unknown as MouseEvent);

      expect(editor.BlockSettings.close).toHaveBeenCalledTimes(1);
      expect(editor.Toolbar.moveAndOpen).toHaveBeenCalledWith(blockStub);
    });
  });

  describe('hover and placeholder helpers', () => {
    it('emits block-hovered events for unique hovered blocks', () => {
      const { ui, editor, redactor, eventsDispatcher } = createUI();
      const blockElement = document.createElement('div');

      blockElement.classList.add('blok-element');
      redactor.appendChild(blockElement);

      const blockStub = {
        id: 'hovered',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as ReturnType<typeof editor.BlockManager.getBlockByChildNode>;

      vi.mocked(editor.BlockManager.getBlockByChildNode).mockReturnValue(blockStub);
      Object.assign(editor.BlockSelection, { anyBlockSelected: false });

      (ui as unknown as { watchBlockHoveredEvents: () => void }).watchBlockHoveredEvents();

      const event = new MouseEvent('mousemove', { bubbles: true });

      Object.defineProperty(event, 'target', { value: blockElement });
      redactor.dispatchEvent(event);

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, { block: blockStub });
      eventsDispatcher.emit.mockClear();

      redactor.dispatchEvent(event);
      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
    });

    it('marks inputs as empty on focus and input events', () => {
      const { ui, wrapper } = createUI();
      const toggleSpy = vi.spyOn(Dom, 'toggleEmptyMark');

      (ui as unknown as { enableInputsEmptyMark: () => void }).enableInputsEmptyMark();

      const input = document.createElement('div');

      wrapper.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('focusin', { bubbles: true }));
      input.dispatchEvent(new Event('focusout', { bubbles: true }));

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
});
