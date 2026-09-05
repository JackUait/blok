/**
 * Behaviour pins for the Toolbar module's public surface.
 *
 * Covers the paths a mutation run found unasserted: where the toolbar anchors,
 * which block the plus button / settings toggler belong to, and the full reset
 * that close() performs.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Toolbar } from '../../../../../src/components/modules/toolbar';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../src/components/block';
import type * as UtilsModule from '../../../../../src/components/utils';

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual<typeof UtilsModule>('../../../../../src/components/utils');

  return {
    ...actual,
    log: vi.fn(),
  };
});

const { log } = await import('../../../../../src/components/utils');
const logMock = log as unknown as Mock;

/** Class list values the toolbar writes; mirrors `getToolbarStyles()`. */
const OPENED_CLASS = 'block';
const CLOSED_CLASS = 'hidden';
const ACTIONS_OPENED_CLASS = 'opacity-100';

type ToolboxStub = {
  opened: boolean;
  close: Mock;
  open: Mock;
  toggle: Mock;
  hasFocus: Mock;
  contains: Mock;
  updateLeftAlignElement: Mock;
  setI18nLabels: Mock;
  refreshItems: Mock;
};

type PositionerStub = {
  target: Element | null;
  calculateToolbarY: Mock;
  moveToY: Mock;
  setHoveredTarget: Mock;
  resetCachedPosition: Mock;
  applyContentOffset: Mock;
  watchTargetResize: Mock;
  stopWatchingTargetResize: Mock;
  repositionToolbar: Mock;
};

type HandlerStub = {
  setHoveredBlock: Mock;
  refreshI18n: Mock;
  refreshAriaLabel: Mock;
  refreshTooltip: Mock;
  refreshCursor: Mock;
  skipNextToggle: Mock;
};

/**
 * Collaborators the Toolbar builds in its own constructor. Tests swap them for
 * spies; this is the only seam that reaches them.
 */
type ToolbarSeam = {
  toolboxInstance: ToolboxStub | null;
  positioner: PositionerStub;
  plusButtonHandler: HandlerStub;
  settingsTogglerHandler: HandlerStub;
};

const seamOf = (toolbar: Toolbar): ToolbarSeam => toolbar as unknown as ToolbarSeam;

const makeToolboxStub = (): ToolboxStub => ({
  opened: false,
  close: vi.fn(),
  open: vi.fn(),
  toggle: vi.fn(),
  hasFocus: vi.fn(() => false),
  contains: vi.fn(() => false),
  updateLeftAlignElement: vi.fn(),
  setI18nLabels: vi.fn(),
  refreshItems: vi.fn(),
});

const makeHandlerStub = (): HandlerStub => ({
  setHoveredBlock: vi.fn(),
  refreshI18n: vi.fn(),
  refreshAriaLabel: vi.fn(),
  refreshTooltip: vi.fn(),
  refreshCursor: vi.fn(),
  skipNextToggle: vi.fn(),
});

type BlockOptions = {
  id: string;
  name?: string;
  isEmpty?: boolean;
  parentId?: string | null;
  contentIds?: string[];
  holder?: HTMLElement;
  backgroundColor?: string;
};

/**
 * Every holder carries its own id as text so `toBe` failures name the block and
 * so two holders can never compare structurally equal.
 */
const makeBlock = (options: BlockOptions): Block => {
  const holder = options.holder ?? document.createElement('div');

  holder.setAttribute('data-blok-testid', 'block-wrapper');
  holder.setAttribute('data-fixture-block', options.id);
  if (holder.childNodes.length === 0) {
    holder.append(options.id);
  }

  const pluginsContent = document.createElement('div');

  if (options.backgroundColor !== undefined) {
    pluginsContent.style.backgroundColor = options.backgroundColor;
  }

  return {
    id: options.id,
    name: options.name ?? 'paragraph',
    isEmpty: options.isEmpty ?? false,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    holder,
    pluginsContent,
    cleanupDraggable: vi.fn(),
    setupDraggable: vi.fn(),
    getTunes: vi.fn(() => ({
      toolTunes: [],
      commonTunes: [],
    })),
  } as unknown as Block;
};

type Harness = {
  toolbar: Toolbar;
  seam: ToolbarSeam;
  toolbox: ToolboxStub;
  wrapper: HTMLDivElement;
  content: HTMLDivElement;
  actions: HTMLDivElement;
  plusButton: HTMLButtonElement;
  settingsToggler: HTMLButtonElement;
  editorWrapper: HTMLDivElement;
  blockSettings: { opened: boolean; isOpening: boolean; close: Mock; contains: Mock };
  readOnly: { isEnabled: boolean; isControlsHidden: boolean };
  blockManager: { currentBlock: Block | undefined; blocks: Block[]; getBlockById: Mock; getBlockByChildNode: Mock };
  blockSelection: { selectedBlocks: Block[] };
  ui: { isMobile: boolean; nodes: { wrapper: HTMLDivElement }; resetBlockHoverState: Mock };
  dragManager: Record<string, unknown>;
};

type HarnessOptions = {
  config?: ConstructorParameters<typeof Toolbar>[0]['config'];
  omitWrapper?: boolean;
  omitPlusButton?: boolean;
  withoutToolbox?: boolean;
  blocks?: Block[];
};

const createHarness = (options: HarnessOptions = {}): Harness => {
  const toolbar = new Toolbar({
    config: options.config ?? {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const wrapper = document.createElement('div');
  const content = document.createElement('div');
  const actions = document.createElement('div');
  const plusButton = document.createElement('button');
  const settingsToggler = document.createElement('button');

  wrapper.appendChild(content);
  content.appendChild(actions);
  actions.appendChild(plusButton);
  actions.appendChild(settingsToggler);
  wrapper.classList.add(CLOSED_CLASS);

  const editorWrapper = document.createElement('div');

  document.body.appendChild(editorWrapper);
  editorWrapper.appendChild(wrapper);

  const nodes: Record<string, HTMLElement | undefined> = {
    wrapper: options.omitWrapper === true ? undefined : wrapper,
    content,
    actions,
    plusButton: options.omitPlusButton === true ? undefined : plusButton,
    settingsToggler,
  };

  toolbar.nodes = nodes as unknown as typeof toolbar.nodes;

  const seam = seamOf(toolbar);
  const toolbox = makeToolboxStub();

  seam.toolboxInstance = options.withoutToolbox === true ? null : toolbox;
  seam.positioner = {
    target: null,
    calculateToolbarY: vi.fn(() => 100),
    moveToY: vi.fn(),
    setHoveredTarget: vi.fn(),
    resetCachedPosition: vi.fn(),
    applyContentOffset: vi.fn(),
    watchTargetResize: vi.fn(),
    stopWatchingTargetResize: vi.fn(),
    repositionToolbar: vi.fn(),
  };
  seam.plusButtonHandler = makeHandlerStub();
  seam.settingsTogglerHandler = makeHandlerStub();

  const blockSettings = {
    opened: false,
    isOpening: false,
    close: vi.fn(),
    contains: vi.fn(() => false),
  };
  const readOnly = {
    isEnabled: false,
    isControlsHidden: false,
  };
  const blockManager = {
    currentBlock: undefined as Block | undefined,
    blocks: options.blocks ?? [],
    getBlockById: vi.fn(() => undefined),
    getBlockByChildNode: vi.fn(() => undefined),
  };
  const blockSelection = { selectedBlocks: [] as Block[] };
  const ui = {
    isMobile: false,
    nodes: { wrapper: editorWrapper },
    resetBlockHoverState: vi.fn(),
  };
  const dragManager = {};

  toolbar.state = {
    BlockSettings: blockSettings,
    BlockManager: blockManager,
    BlockSelection: blockSelection,
    UI: ui,
    ReadOnly: readOnly,
    DragManager: dragManager,
    I18n: { t: vi.fn((key: string) => `t:${key}`) },
  } as unknown as BlokModules;

  return {
    toolbar,
    seam,
    toolbox,
    wrapper,
    content,
    actions,
    plusButton,
    settingsToggler,
    editorWrapper,
    blockSettings,
    readOnly,
    blockManager,
    blockSelection,
    ui,
    dragManager,
  };
};

describe('Toolbar — public surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('contains()', () => {
    it('reports elements inside the toolbar wrapper', () => {
      const h = createHarness();
      const inner = document.createElement('span');

      h.actions.appendChild(inner);

      expect(h.toolbar.contains(inner)).toBe(true);
      expect(h.toolbox.contains).not.toHaveBeenCalled();
    });

    it('reports elements the toolbox claims', () => {
      const h = createHarness();
      const outside = document.createElement('span');

      h.toolbox.contains.mockReturnValue(true);

      expect(h.toolbar.contains(outside)).toBe(true);
    });

    it('reports elements the block settings menu claims', () => {
      const h = createHarness();
      const outside = document.createElement('span');

      h.blockSettings.contains.mockReturnValue(true);

      expect(h.toolbar.contains(outside)).toBe(true);
    });

    it('reports false for an element no component owns', () => {
      const h = createHarness();

      expect(h.toolbar.contains(document.createElement('span'))).toBe(false);
    });

    it('survives being asked before the wrapper and toolbox exist', () => {
      const h = createHarness({
        omitWrapper: true,
        withoutToolbox: true,
      });

      expect(h.toolbar.contains(document.createElement('span'))).toBe(false);
    });
  });

  describe('setHidden()', () => {
    it('stamps the wrapper attribute and blocks the hover toolbar', () => {
      const h = createHarness();
      const block = makeBlock({ id: 'b1' });

      h.toolbar.setHidden(true);

      expect(h.editorWrapper.hasAttribute('data-blok-toolbar-hidden')).toBe(true);

      h.toolbar.moveAndOpen(block);

      expect(h.toolbar.opened).toBe(false);
    });

    it('removes the attribute and re-allows opening when unhidden', () => {
      const h = createHarness({ config: { hideToolbar: true } });
      const block = makeBlock({ id: 'b1' });

      h.toolbar.setHidden(false);

      expect(h.editorWrapper.hasAttribute('data-blok-toolbar-hidden')).toBe(false);

      h.toolbar.moveAndOpen(block);

      expect(h.toolbar.opened).toBe(true);
    });

    it('closes an already-open toolbar when hiding', () => {
      const h = createHarness();

      h.toolbar.moveAndOpen(makeBlock({ id: 'b1' }));
      expect(h.toolbar.opened).toBe(true);

      h.toolbar.setHidden(true);

      expect(h.toolbar.opened).toBe(false);
    });

    it('leaves an open toolbar alone when unhiding', () => {
      const h = createHarness();

      h.toolbar.moveAndOpen(makeBlock({ id: 'b1' }));
      h.toolbar.setHidden(false);

      expect(h.toolbar.opened).toBe(true);
    });
  });

  describe('setPosition()', () => {
    it('writes the wrapper attribute when the side changes', () => {
      const h = createHarness({ config: { toolbarPosition: 'left' } });

      h.editorWrapper.setAttribute('data-blok-toolbar-position', 'left');
      h.toolbar.setPosition('right');

      expect(h.editorWrapper.getAttribute('data-blok-toolbar-position')).toBe('right');
      expect(h.toolbar.isPositionedRight).toBe(true);
    });

    it('does nothing at all when the side is unchanged', () => {
      const h = createHarness({ config: { toolbarPosition: 'left' } });

      h.editorWrapper.setAttribute('data-blok-toolbar-position', 'untouched');
      h.toolbar.setPosition('left');

      expect(h.editorWrapper.getAttribute('data-blok-toolbar-position')).toBe('untouched');
    });

    it('re-anchors an open toolbar at the block it is already following', () => {
      const h = createHarness({ config: { toolbarPosition: 'left' } });
      const block = makeBlock({ id: 'anchor' });
      const hoverTarget = document.createElement('span');

      h.toolbar.moveAndOpen(block);
      h.seam.positioner.target = hoverTarget;
      h.seam.positioner.calculateToolbarY.mockClear();
      h.seam.plusButtonHandler.setHoveredBlock.mockClear();

      h.toolbar.setPosition('right');

      expect(h.seam.positioner.calculateToolbarY).toHaveBeenCalledTimes(1);
      expect(h.seam.positioner.setHoveredTarget.mock.calls.at(-1)?.[0]).toBe(hoverTarget);
      expect(h.seam.plusButtonHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(block);
    });

    it('does not re-anchor while the toolbar is closed', () => {
      const h = createHarness({ config: { toolbarPosition: 'left' } });

      // Y === null aborts moveAndOpen after the hovered block is recorded but before open().
      h.seam.positioner.calculateToolbarY.mockReturnValue(null);
      h.toolbar.moveAndOpen(makeBlock({ id: 'anchor' }));
      expect(h.toolbar.opened).toBe(false);

      h.seam.positioner.calculateToolbarY.mockClear();
      h.toolbar.setPosition('right');

      expect(h.seam.positioner.calculateToolbarY).not.toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('flips the wrapper back to the closed presentation', () => {
      const h = createHarness();

      h.toolbar.moveAndOpen(makeBlock({ id: 'b1' }));
      h.toolbar.close();

      expect(h.wrapper.classList.contains(OPENED_CLASS)).toBe(false);
      expect(h.wrapper.classList.contains(CLOSED_CLASS)).toBe(true);
      expect(h.wrapper.hasAttribute('data-blok-opened')).toBe(false);
      expect(h.toolbar.opened).toBe(false);
    });

    it('hides the block actions and stops them intercepting clicks', () => {
      const h = createHarness();

      h.toolbar.moveAndOpen(makeBlock({ id: 'b1' }));
      expect(h.actions.classList.contains(ACTIONS_OPENED_CLASS)).toBe(true);

      h.toolbar.close();

      expect(h.actions.classList.contains(ACTIONS_OPENED_CLASS)).toBe(false);
      expect(h.actions.hasAttribute('data-blok-opened')).toBe(false);
      expect(h.actions.style.pointerEvents).toBe('none');
    });

    it('closes the toolbox and the block settings menu', () => {
      const h = createHarness();

      h.toolbar.close();

      expect(h.toolbox.close).toHaveBeenCalledTimes(1);
      expect(h.blockSettings.close).toHaveBeenCalledTimes(1);
    });

    it('resets the hover dedupe so the same block can reopen the toolbar', () => {
      const h = createHarness();

      h.toolbar.close();

      expect(h.ui.resetBlockHoverState).toHaveBeenCalledTimes(1);
    });

    it('leaves the hover dedupe alone when the close is not user-initiated', () => {
      const h = createHarness();

      h.toolbar.close({ setExplicitlyClosed: false });

      expect(h.ui.resetBlockHoverState).not.toHaveBeenCalled();
    });

    it('restores the button styling a previous block left behind', () => {
      const h = createHarness();

      h.plusButton.style.display = 'none';
      h.plusButton.style.color = 'rgb(1, 2, 3)';
      h.settingsToggler.style.display = 'none';
      h.settingsToggler.style.color = 'rgb(4, 5, 6)';
      h.actions.style.transform = 'translateX(9px)';
      h.content.style.marginLeft = '17px';
      h.content.style.maxWidth = '19px';

      h.toolbar.close();

      expect(h.plusButton.style.display).toBe('');
      expect(h.plusButton.style.color).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
      expect(h.settingsToggler.style.color).toBe('');
      expect(h.actions.style.transform).toBe('');
      expect(h.content.style.marginLeft).toBe('');
      expect(h.content.style.maxWidth).toBe('');
    });

    it('keeps the plus button hidden in read-only mode', () => {
      const h = createHarness();

      h.readOnly.isEnabled = true;
      h.plusButton.style.display = '';

      h.toolbar.close();

      expect(h.plusButton.style.display).toBe('none');
    });

    it('drops the resize watch and parks the wrapper back on the editor', () => {
      const h = createHarness();
      const block = makeBlock({ id: 'b1' });

      document.body.appendChild(block.holder);
      h.toolbar.moveAndOpen(block);
      expect(h.wrapper.parentElement).toBe(block.holder);

      h.seam.positioner.setHoveredTarget.mockClear();
      h.seam.positioner.resetCachedPosition.mockClear();
      h.toolbar.close();

      expect(h.seam.positioner.setHoveredTarget).toHaveBeenCalledTimes(1);
      expect(h.seam.positioner.setHoveredTarget).toHaveBeenCalledWith(null);
      expect(h.seam.positioner.stopWatchingTargetResize).toHaveBeenCalledTimes(1);
      expect(h.seam.positioner.resetCachedPosition).toHaveBeenCalledTimes(1);
      expect(h.wrapper.style.top).toBe('unset');
      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
    });

    it('survives a close before the toolbar DOM exists', () => {
      const h = createHarness({
        omitWrapper: true,
        withoutToolbox: true,
      });

      expect(() => h.toolbar.close()).not.toThrow();
      expect(h.blockSettings.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('moveAndOpen() — read-only blocks that paint nothing', () => {
    const openReadOnlyFor = (block: Block): Harness => {
      const h = createHarness({ blocks: [block] });

      h.readOnly.isEnabled = true;
      document.body.appendChild(block.holder);
      h.toolbar.moveAndOpen(block);

      return h;
    };

    it('stays shut for a spacer', () => {
      expect(openReadOnlyFor(makeBlock({
        id: 'spacer',
        name: 'spacer',
      })).toolbar.opened).toBe(false);
    });

    it('stays shut for an empty paragraph', () => {
      expect(openReadOnlyFor(makeBlock({
        id: 'p',
        name: 'paragraph',
        isEmpty: true,
      })).toolbar.opened).toBe(false);
    });

    it('stays shut for an empty heading', () => {
      expect(openReadOnlyFor(makeBlock({
        id: 'h',
        name: 'header',
        isEmpty: true,
      })).toolbar.opened).toBe(false);
    });

    it('does not mark itself explicitly closed when it declines to open', () => {
      const h = openReadOnlyFor(makeBlock({
        id: 'spacer',
        name: 'spacer',
      }));

      expect(h.ui.resetBlockHoverState).not.toHaveBeenCalled();
    });

    it('opens for an empty toggle heading, which still shows its arrow', () => {
      const holder = document.createElement('div');
      const arrow = document.createElement('button');

      arrow.setAttribute('data-blok-toggle-arrow', '');
      holder.appendChild(arrow);

      expect(openReadOnlyFor(makeBlock({
        id: 'toggle-h',
        name: 'header',
        isEmpty: true,
        holder,
      })).toolbar.opened).toBe(true);
    });

    it('opens for an empty list, which still shows its marker', () => {
      expect(openReadOnlyFor(makeBlock({
        id: 'list',
        name: 'list',
        isEmpty: true,
      })).toolbar.opened).toBe(true);
    });

    it('opens for a paragraph with text', () => {
      expect(openReadOnlyFor(makeBlock({
        id: 'p',
        name: 'paragraph',
        isEmpty: false,
      })).toolbar.opened).toBe(true);
    });
  });

  describe('moveAndOpenForMultipleBlocks()', () => {
    const twoSelected = (): { h: Harness; first: Block; second: Block } => {
      const first = makeBlock({ id: 'first' });
      const second = makeBlock({ id: 'second' });

      document.body.append(first.holder, second.holder);

      const h = createHarness({ blocks: [first, second] });

      h.blockSelection.selectedBlocks = [first, second];

      return {
        h,
        first,
        second,
      };
    };

    it('anchors at the first selected block', () => {
      const { h, first } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.wrapper.parentElement).toBe(first.holder);
      expect(h.toolbar.opened).toBe(true);
      expect(h.seam.positioner.moveToY).toHaveBeenCalledWith(h.toolbar.nodes, 100);
    });

    it('anchors at the block it is handed, not the first selected one', () => {
      const { h, second } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks(second);

      expect(h.wrapper.parentElement).toBe(second.holder);
      expect(h.seam.plusButtonHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(second);
      expect(h.seam.settingsTogglerHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(second);
    });

    it('measures with no hover target and no mobile layout', () => {
      const { h } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks();

      const measured = h.seam.positioner.calculateToolbarY.mock.calls[0]?.[0] as {
        hoveredTarget: Element | null;
        isMobile: boolean;
      };

      expect(measured.hoveredTarget).toBe(null);
      expect(measured.isMobile).toBe(false);
      expect(h.seam.positioner.setHoveredTarget).toHaveBeenCalledWith(null);
      expect(h.seam.positioner.resetCachedPosition).toHaveBeenCalled();
    });

    it('releases the drag handle of the block it moved away from', () => {
      const { h, first, second } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks(first);
      expect(first.cleanupDraggable).not.toHaveBeenCalled();

      h.toolbar.moveAndOpenForMultipleBlocks(second);

      expect(first.cleanupDraggable).toHaveBeenCalledTimes(1);
      expect(second.cleanupDraggable).not.toHaveBeenCalled();
    });

    it('does not release the drag handle when re-anchoring at the same block', () => {
      const { h, first } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks(first);
      h.toolbar.moveAndOpenForMultipleBlocks(first);

      expect(first.cleanupDraggable).not.toHaveBeenCalled();
    });

    it('stays shut while the block settings menu is open or opening', () => {
      const openCase = twoSelected();

      openCase.h.blockSettings.opened = true;
      openCase.h.toolbar.moveAndOpenForMultipleBlocks();
      expect(openCase.h.toolbar.opened).toBe(false);

      const openingCase = twoSelected();

      openingCase.h.blockSettings.isOpening = true;
      openingCase.h.toolbar.moveAndOpenForMultipleBlocks();
      expect(openingCase.h.toolbar.opened).toBe(false);
    });

    it('stays shut when the controls are hidden or the toolbar is disabled', () => {
      const hiddenControls = twoSelected();

      hiddenControls.h.readOnly.isControlsHidden = true;
      hiddenControls.h.toolbar.moveAndOpenForMultipleBlocks();
      expect(hiddenControls.h.toolbar.opened).toBe(false);

      const disabled = twoSelected();

      disabled.h.toolbar.setHidden(true);
      disabled.h.toolbar.moveAndOpenForMultipleBlocks();
      expect(disabled.h.toolbar.opened).toBe(false);
    });

    it('needs at least two selected blocks', () => {
      const { h, first } = twoSelected();

      h.blockSelection.selectedBlocks = [first];
      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbar.opened).toBe(false);
      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
    });

    it('warns and stays shut before the toolbox is built', () => {
      const first = makeBlock({ id: 'first' });
      const second = makeBlock({ id: 'second' });
      const h = createHarness({ withoutToolbox: true });

      h.blockSelection.selectedBlocks = [first, second];
      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbar.opened).toBe(false);
      expect(logMock).toHaveBeenCalledWith(
        'Can\'t open Toolbar since Blok initialization is not finished yet',
        'warn'
      );
    });

    it('closes an open toolbox as it moves', () => {
      const { h } = twoSelected();

      h.toolbox.opened = true;
      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbox.close).toHaveBeenCalledTimes(1);
    });

    it('does not close a toolbox that is already shut', () => {
      const { h } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbox.close).not.toHaveBeenCalled();
    });

    it('stays put when the position cannot be measured', () => {
      const { h } = twoSelected();

      h.seam.positioner.calculateToolbarY.mockReturnValue(null);
      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
      expect(h.seam.positioner.moveToY).not.toHaveBeenCalled();
      expect(h.toolbar.opened).toBe(false);
    });

    it('stays put when the plus button has not been built', () => {
      const first = makeBlock({ id: 'first' });
      const second = makeBlock({ id: 'second' });

      document.body.append(first.holder, second.holder);

      const h = createHarness({ omitPlusButton: true });

      h.blockSelection.selectedBlocks = [first, second];

      expect(() => h.toolbar.moveAndOpenForMultipleBlocks()).not.toThrow();
      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
    });

    it('restores button visibility that a table cell had suppressed', () => {
      const { h } = twoSelected();

      h.plusButton.style.display = 'none';
      h.plusButton.style.color = 'rgb(1, 2, 3)';
      h.settingsToggler.style.display = 'none';
      h.settingsToggler.style.color = 'rgb(4, 5, 6)';
      h.settingsToggler.classList.add('hidden');

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.plusButton.style.display).toBe('');
      expect(h.plusButton.style.color).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
      expect(h.settingsToggler.style.color).toBe('');
      expect(h.settingsToggler.classList.contains('hidden')).toBe(false);
    });

    it('keeps the plus button hidden and the block undraggable in read-only mode', () => {
      const { h, first } = twoSelected();

      h.readOnly.isEnabled = true;
      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.plusButton.style.display).toBe('none');
      expect(first.setupDraggable).not.toHaveBeenCalled();
    });

    it('wires the settings toggler as the drag handle when editable', () => {
      const { h, first } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(first.setupDraggable).toHaveBeenCalledTimes(1);
      expect((first.setupDraggable as unknown as Mock).mock.calls[0]?.[0]).toBe(h.settingsToggler);
      expect((first.setupDraggable as unknown as Mock).mock.calls[0]?.[1]).toBe(h.dragManager);
    });

    it('aligns the toolbox with the anchored block content column', () => {
      const { h, first } = twoSelected();
      const contentElement = document.createElement('div');

      contentElement.setAttribute('data-blok-element-content', '');
      contentElement.textContent = 'first content';
      first.holder.appendChild(contentElement);

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbox.updateLeftAlignElement.mock.calls[0]?.[0]).toBe(contentElement);
      expect(h.seam.positioner.applyContentOffset).toHaveBeenCalledTimes(1);
      expect(h.content.style.marginLeft).toBe('0px');
      expect(h.content.style.maxWidth).toBe('0px');
    });

    it('leaves the content sync alone for a block with no content element', () => {
      const { h } = twoSelected();

      h.toolbar.moveAndOpenForMultipleBlocks();

      expect(h.toolbox.updateLeftAlignElement).not.toHaveBeenCalled();
      expect(h.content.style.marginLeft).toBe('');
    });
  });

  describe('toolbox facade', () => {
    it('reports no state and does nothing before the toolbox is built', () => {
      const h = createHarness({ withoutToolbox: true });

      expect(h.toolbar.toolbox.opened).toBe(undefined);
      expect(h.toolbar.toolbox.hasFocus()).toBe(undefined);
      expect(() => h.toolbar.toolbox.close()).not.toThrow();

      h.toolbar.toolbox.open();
      expect(logMock).toHaveBeenCalledWith(
        'toolbox.open() called before initialization is finished',
        'warn'
      );

      h.toolbar.toolbox.openWithoutSlash();
      expect(logMock).toHaveBeenCalledWith(
        'toolbox.openWithoutSlash() called before initialization is finished',
        'warn'
      );

      h.toolbar.toolbox.toggle();
      expect(logMock).toHaveBeenCalledWith(
        'toolbox.toggle() called before initialization is finished',
        'warn'
      );
    });

    it('forwards every command once the toolbox exists', () => {
      const h = createHarness();

      h.toolbox.opened = true;
      h.toolbox.hasFocus.mockReturnValue(true);

      expect(h.toolbar.toolbox.opened).toBe(true);
      expect(h.toolbar.toolbox.hasFocus()).toBe(true);

      h.toolbar.toolbox.close();
      expect(h.toolbox.close).toHaveBeenCalledTimes(1);

      h.toolbar.toolbox.toggle();
      expect(h.toolbox.toggle).toHaveBeenCalledTimes(1);

      h.toolbar.toolbox.open();
      expect(h.toolbox.open.mock.calls[0]).toEqual([]);

      h.toolbar.toolbox.openWithoutSlash();
      expect(h.toolbox.open.mock.calls[1]).toEqual([false]);
    });

    it('re-points the caret block at the hovered block when the toolbox opens', () => {
      const hovered = makeBlock({ id: 'hovered' });
      const current = makeBlock({ id: 'current' });
      const h = createHarness({ blocks: [hovered, current] });

      document.body.append(hovered.holder, current.holder);
      h.blockManager.currentBlock = current;
      h.toolbar.moveAndOpen(hovered);

      h.toolbar.toolbox.open();

      expect(h.blockManager.currentBlock).toBe(hovered);
    });

    it('re-points the caret block for the slash-less open too', () => {
      const hovered = makeBlock({ id: 'hovered' });
      const current = makeBlock({ id: 'current' });
      const h = createHarness({ blocks: [hovered, current] });

      document.body.append(hovered.holder, current.holder);
      h.blockManager.currentBlock = current;
      h.toolbar.moveAndOpen(hovered);

      h.toolbar.toolbox.openWithoutSlash();

      expect(h.blockManager.currentBlock).toBe(hovered);
    });

    it('adopts the hovered block when there is no current block', () => {
      const hovered = makeBlock({ id: 'hovered' });
      const h = createHarness({ blocks: [hovered] });

      document.body.appendChild(hovered.holder);
      h.blockManager.currentBlock = undefined;
      h.toolbar.moveAndOpen(hovered);

      h.toolbar.toolbox.open();

      expect(h.blockManager.currentBlock).toBe(hovered);
    });

    it('keeps a caret that sits inside a table cell', () => {
      const hovered = makeBlock({ id: 'hovered' });
      const cellHost = document.createElement('div');

      cellHost.setAttribute('data-blok-table-cell-blocks', '');

      const cellParagraphHolder = document.createElement('div');

      cellHost.appendChild(cellParagraphHolder);
      document.body.append(hovered.holder, cellHost);

      const current = makeBlock({
        id: 'cell-paragraph',
        holder: cellParagraphHolder,
      });
      const h = createHarness({ blocks: [hovered, current] });

      h.blockManager.currentBlock = current;
      h.toolbar.moveAndOpen(hovered);

      h.toolbar.toolbox.open();
      h.toolbar.toolbox.openWithoutSlash();

      expect(h.blockManager.currentBlock).toBe(current);
    });

    it('keeps the current block when nothing is hovered', () => {
      const current = makeBlock({ id: 'current' });
      const h = createHarness({ blocks: [current] });

      h.blockManager.currentBlock = current;

      h.toolbar.toolbox.open();
      h.toolbar.toolbox.openWithoutSlash();

      expect(h.blockManager.currentBlock).toBe(current);
      expect(h.toolbox.open).toHaveBeenCalledTimes(2);
    });

    it('keeps the cell paragraph when the hover came from a table cell', () => {
      const tableHolder = document.createElement('div');

      tableHolder.setAttribute('data-blok-testid', 'block-wrapper');

      const cellHost = document.createElement('div');

      cellHost.setAttribute('data-blok-table-cell-blocks', '');
      tableHolder.appendChild(cellHost);
      document.body.appendChild(tableHolder);

      const cellParagraph = makeBlock({
        id: 'cell-paragraph',
        holder: cellHost.appendChild(document.createElement('div')),
      });
      const tableBlock = makeBlock({
        id: 'table',
        name: 'table',
        holder: tableHolder,
      });
      const current = makeBlock({ id: 'current' });
      const h = createHarness({ blocks: [tableBlock, cellParagraph, current] });

      document.body.appendChild(current.holder);
      h.blockManager.getBlockByChildNode.mockReturnValue(tableBlock);
      h.blockManager.currentBlock = current;

      h.toolbar.moveAndOpen(cellParagraph);

      h.toolbar.toolbox.open();

      expect(h.blockManager.currentBlock).toBe(current);
    });
  });

  describe('runtime locale refresh', () => {
    it('re-stamps every eagerly written label', () => {
      const h = createHarness();

      h.toolbar.refreshI18n();

      expect(h.wrapper.getAttribute('aria-label')).toBe('t:a11y.blockToolbar');
      expect(h.seam.plusButtonHandler.refreshI18n).toHaveBeenCalledTimes(1);
      expect(h.seam.settingsTogglerHandler.refreshAriaLabel).toHaveBeenCalledTimes(1);
      expect(h.seam.settingsTogglerHandler.refreshTooltip).toHaveBeenCalledTimes(1);
      expect(h.toolbox.setI18nLabels).toHaveBeenCalledWith({
        filter: 't:popover.search',
        nothingFound: 't:popover.nothingFound',
        slashSearchPlaceholder: 't:toolbox.typeToSearch',
      });
      expect(h.toolbox.refreshItems).toHaveBeenCalledTimes(1);
    });

    it('survives a refresh before the toolbar DOM and toolbox exist', () => {
      const h = createHarness({
        omitWrapper: true,
        withoutToolbox: true,
      });

      expect(() => h.toolbar.refreshI18n()).not.toThrow();
    });
  });

  describe('small delegations', () => {
    it('rebuilds the toolbox item list on demand', () => {
      const h = createHarness();

      h.toolbar.refreshToolboxItems();

      expect(h.toolbox.refreshItems).toHaveBeenCalledTimes(1);
    });

    it('survives a rebuild before the toolbox exists', () => {
      const h = createHarness({ withoutToolbox: true });

      expect(() => h.toolbar.refreshToolboxItems()).not.toThrow();
    });

    it('forwards the post-drop settings-toggle suppression', () => {
      const h = createHarness();

      h.toolbar.skipNextSettingsToggle();

      expect(h.seam.settingsTogglerHandler.skipNextToggle).toHaveBeenCalledTimes(1);
    });

    it('hides the action buttons without closing the toolbar', () => {
      const h = createHarness();

      h.toolbar.moveAndOpen(makeBlock({ id: 'b1' }));
      h.toolbar.hideBlockActions();

      expect(h.actions.classList.contains(ACTIONS_OPENED_CLASS)).toBe(false);
      expect(h.actions.style.pointerEvents).toBe('none');
      expect(h.toolbar.opened).toBe(true);
    });
  });

  describe('moveAndOpen() — anchoring', () => {
    const anchor = (options: { isMobile?: boolean; blocks?: Block[] } = {}): {
      h: Harness;
      block: Block;
      target: HTMLElement;
    } => {
      const block = makeBlock({ id: 'anchor' });
      const target = document.createElement('span');

      target.textContent = 'hovered span';
      block.holder.appendChild(target);
      document.body.appendChild(block.holder);

      const h = createHarness({ blocks: options.blocks ?? [block, makeBlock({ id: 'other' })] });

      h.ui.isMobile = options.isMobile ?? false;

      return {
        h,
        block,
        target,
      };
    };

    it('parks the toolbar inside the block it was handed', () => {
      const { h, block } = anchor();

      h.toolbar.moveAndOpen(block);

      expect(h.wrapper.parentElement).toBe(block.holder);
      expect(h.toolbar.opened).toBe(true);
      expect(h.seam.plusButtonHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(block);
      expect(h.seam.settingsTogglerHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(block);
      expect(h.seam.positioner.moveToY).toHaveBeenCalledWith(h.toolbar.nodes, 100);
      expect(h.seam.positioner.watchTargetResize.mock.calls[0]?.[0]).toBe(block.holder);
      expect(h.seam.positioner.applyContentOffset).toHaveBeenCalledTimes(1);
    });

    it('falls back to the current block when handed nothing', () => {
      const { h, block } = anchor();

      h.blockManager.currentBlock = block;
      h.toolbar.moveAndOpen();

      expect(h.wrapper.parentElement).toBe(block.holder);
    });

    it('stays shut when there is no block to anchor at', () => {
      const { h } = anchor();

      h.blockManager.currentBlock = undefined;
      h.toolbar.moveAndOpen();

      expect(h.toolbar.opened).toBe(false);
    });

    it('measures against the hovered element and the mobile layout', () => {
      const { h, block, target } = anchor({ isMobile: true });

      h.toolbar.moveAndOpen(block, target);

      const measured = h.seam.positioner.calculateToolbarY.mock.calls[0]?.[0] as {
        targetBlock: Block;
        hoveredTarget: Element | null;
        isMobile: boolean;
      };

      expect(measured.targetBlock).toBe(block);
      expect(measured.hoveredTarget).toBe(target);
      expect(measured.isMobile).toBe(true);
      expect(h.seam.positioner.calculateToolbarY.mock.calls[0]?.[1]).toBe(h.plusButton);
      expect(h.seam.positioner.setHoveredTarget.mock.calls[0]?.[0]).toBe(target);
    });

    it('records no hovered element when it was not handed one', () => {
      const { h, block } = anchor();

      h.toolbar.moveAndOpen(block);

      expect(h.seam.positioner.setHoveredTarget).toHaveBeenCalledWith(null);
      expect(
        (h.seam.positioner.calculateToolbarY.mock.calls[0]?.[0] as { hoveredTarget: Element | null }).hoveredTarget
      ).toBe(null);
    });

    it('stays put when the position cannot be measured', () => {
      const { h, block } = anchor();

      h.seam.positioner.calculateToolbarY.mockReturnValue(null);
      h.toolbar.moveAndOpen(block);

      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
      expect(h.seam.positioner.moveToY).not.toHaveBeenCalled();
      expect(h.toolbar.opened).toBe(false);
    });

    it('stays put when the plus button has not been built', () => {
      const block = makeBlock({ id: 'anchor' });

      document.body.appendChild(block.holder);

      const h = createHarness({
        blocks: [block],
        omitPlusButton: true,
      });

      expect(() => h.toolbar.moveAndOpen(block)).not.toThrow();
      expect(h.wrapper.parentElement).toBe(h.editorWrapper);
    });

    it('releases the drag handle of the block it moved away from', () => {
      const first = makeBlock({ id: 'first' });
      const second = makeBlock({ id: 'second' });

      document.body.append(first.holder, second.holder);

      const h = createHarness({ blocks: [first, second] });

      h.toolbar.moveAndOpen(first);
      expect(first.cleanupDraggable).not.toHaveBeenCalled();

      h.toolbar.moveAndOpen(second);
      expect(first.cleanupDraggable).toHaveBeenCalledTimes(1);

      h.toolbar.moveAndOpen(second);
      expect(second.cleanupDraggable).not.toHaveBeenCalled();
    });

    it('wires the settings toggler as the drag handle when editable', () => {
      const { h, block } = anchor();

      h.toolbar.moveAndOpen(block);

      expect((block.setupDraggable as unknown as Mock).mock.calls[0]?.[0]).toBe(h.settingsToggler);
      expect((block.setupDraggable as unknown as Mock).mock.calls[0]?.[1]).toBe(h.dragManager);
    });

    it('leaves the block undraggable and the plus button hidden in read-only mode', () => {
      const { h, block } = anchor();

      h.readOnly.isEnabled = true;
      h.toolbar.moveAndOpen(block);

      expect(block.setupDraggable).not.toHaveBeenCalled();
      expect(h.plusButton.style.display).toBe('none');
    });

    it('warns and stays shut before the toolbox is built', () => {
      const block = makeBlock({ id: 'anchor' });
      const h = createHarness({ withoutToolbox: true });

      h.toolbar.moveAndOpen(block);

      expect(h.toolbar.opened).toBe(false);
      expect(logMock).toHaveBeenCalledWith(
        'Can\'t open Toolbar since Blok initialization is not finished yet',
        'warn'
      );
    });

    it('stays shut while the controls are hidden', () => {
      const { h, block } = anchor();

      h.readOnly.isControlsHidden = true;
      h.toolbar.moveAndOpen(block);

      expect(h.toolbar.opened).toBe(false);
    });

    it('closes the toolbox and the settings menu as it moves', () => {
      const { h, block } = anchor();

      h.toolbox.opened = true;
      h.blockSettings.opened = true;

      h.toolbar.moveAndOpen(block);

      expect(h.toolbox.close).toHaveBeenCalledTimes(1);
      expect(h.blockSettings.close).toHaveBeenCalledTimes(1);
    });

    it('leaves a shut toolbox and settings menu alone', () => {
      const { h, block } = anchor();

      h.toolbar.moveAndOpen(block);

      expect(h.toolbox.close).not.toHaveBeenCalled();
      expect(h.blockSettings.close).not.toHaveBeenCalled();
    });

    it('aligns the toolbox with the block content column', () => {
      const { h, block } = anchor();
      const contentElement = document.createElement('div');

      contentElement.setAttribute('data-blok-element-content', '');
      contentElement.textContent = 'anchor content';
      block.holder.appendChild(contentElement);

      h.toolbar.moveAndOpen(block);

      expect(h.toolbox.updateLeftAlignElement.mock.calls[0]?.[0]).toBe(contentElement);
      expect(h.content.style.marginLeft).toBe('0px');
      expect(h.content.style.maxWidth).toBe('0px');
    });

    it('re-enables pointer events the previous block disabled on the buttons', () => {
      const { h, block } = anchor();

      h.plusButton.style.pointerEvents = 'none';
      h.settingsToggler.style.pointerEvents = 'none';

      h.toolbar.moveAndOpen(block);

      expect(h.actions.style.pointerEvents).toBe('auto');
      expect(h.plusButton.style.pointerEvents).toBe('');
      expect(h.settingsToggler.style.pointerEvents).toBe('');
    });
  });

  describe('moveAndOpen() — table cells', () => {
    const tableFixture = (): { h: Harness; table: Block; cellParagraph: Block; cellHost: HTMLElement } => {
      const tableHolder = document.createElement('div');

      tableHolder.setAttribute('data-blok-testid', 'block-wrapper');
      tableHolder.append('table holder');

      const cellHost = document.createElement('div');

      cellHost.setAttribute('data-blok-table-cell-blocks', '');
      tableHolder.appendChild(cellHost);
      document.body.appendChild(tableHolder);

      const cellParagraphHolder = document.createElement('div');

      cellHost.appendChild(cellParagraphHolder);

      const cellParagraph = makeBlock({
        id: 'cell-paragraph',
        holder: cellParagraphHolder,
      });
      const table = makeBlock({
        id: 'table',
        name: 'table',
        holder: tableHolder,
      });
      const h = createHarness({ blocks: [table, cellParagraph] });

      h.blockManager.getBlockByChildNode.mockReturnValue(table);

      return {
        h,
        table,
        cellParagraph,
        cellHost,
      };
    };

    it('anchors at the table, not at the paragraph inside the cell', () => {
      const { h, table, cellParagraph } = tableFixture();

      h.toolbar.moveAndOpen(cellParagraph);

      expect(h.wrapper.parentElement).toBe(table.holder);
      expect(h.seam.plusButtonHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(table);
      expect(h.seam.settingsTogglerHandler.setHoveredBlock.mock.calls[0]?.[0]).toBe(table);
    });

    it('keeps the cell paragraph when no table block owns the holder', () => {
      const { h, cellParagraph } = tableFixture();

      h.blockManager.getBlockByChildNode.mockReturnValue(undefined);
      h.toolbar.moveAndOpen(cellParagraph);

      expect(h.wrapper.parentElement).toBe(cellParagraph.holder);
    });

    it('remembers a hover that started inside a cell so the toolbox keeps the caret', () => {
      const { h, cellHost } = tableFixture();
      const outsideBlock = makeBlock({ id: 'outside' });
      const current = makeBlock({ id: 'current' });

      document.body.append(outsideBlock.holder, current.holder);
      h.blockManager.currentBlock = current;

      h.toolbar.moveAndOpen(outsideBlock, cellHost);
      h.toolbar.toolbox.open();

      expect(h.blockManager.currentBlock).toBe(current);
    });
  });

  describe('moveAndOpen() — callout blocks', () => {
    const calloutFixture = (options: {
      childIds?: string[];
      childId?: string;
      parentName?: string;
      parentFound?: boolean;
      background?: string;
      position?: 'left' | 'right';
    } = {}): { h: Harness; child: Block; callout: Block } => {
      const childId = options.childId ?? 'child-1';
      const callout = makeBlock({
        id: 'callout-1',
        name: options.parentName ?? 'callout',
        contentIds: options.childIds ?? ['child-1', 'child-2'],
        backgroundColor: options.background,
      });
      const child = makeBlock({
        id: childId,
        parentId: 'callout-1',
      });

      document.body.append(callout.holder, child.holder);

      const h = createHarness({
        blocks: [callout, child],
        config: { toolbarPosition: options.position ?? 'left' },
      });

      h.blockManager.getBlockById.mockImplementation((id: string) => {
        if (options.parentFound === false) {
          return undefined;
        }

        return id === 'callout-1' ? callout : undefined;
      });

      return {
        h,
        child,
        callout,
      };
    };

    it('hides both buttons beside a callout first child', () => {
      const { h, child } = calloutFixture();

      h.toolbar.moveAndOpen(child);

      expect(h.plusButton.style.display).toBe('none');
      expect(h.settingsToggler.style.display).toBe('none');
    });

    it('keeps both buttons for a later callout child', () => {
      const { h, child } = calloutFixture({ childId: 'child-2' });

      h.plusButton.style.display = 'none';
      h.settingsToggler.style.display = 'none';
      h.toolbar.moveAndOpen(child);

      expect(h.plusButton.style.display).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
    });

    it('keeps both buttons when the parent is not a callout', () => {
      const { h, child } = calloutFixture({ parentName: 'toggle' });

      h.toolbar.moveAndOpen(child);

      expect(h.plusButton.style.display).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
    });

    it('keeps both buttons when the parent block is gone', () => {
      const { h, child } = calloutFixture({ parentFound: false });

      h.toolbar.moveAndOpen(child);

      expect(h.plusButton.style.display).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
    });

    it('keeps both buttons for a block with no parent at all', () => {
      const h = createHarness();
      const block = makeBlock({ id: 'plain' });

      document.body.appendChild(block.holder);
      h.plusButton.style.display = 'none';
      h.toolbar.moveAndOpen(block);

      expect(h.plusButton.style.display).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
    });

    it('keeps both buttons in the end gutter, where nothing collides', () => {
      const { h, child } = calloutFixture({ position: 'right' });

      h.toolbar.moveAndOpen(child);

      expect(h.plusButton.style.display).toBe('');
      expect(h.settingsToggler.style.display).toBe('');
    });

    it('tints the toolbar to match a coloured callout it sits inside', () => {
      const { h, child } = calloutFixture({
        childId: 'child-2',
        background: 'rgb(10, 20, 30)',
      });

      h.toolbar.moveAndOpen(child);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe(
        'light-dark(color-mix(in srgb, rgb(10, 20, 30) 70%, white), color-mix(in srgb, rgb(10, 20, 30) 85%, white))'
      );
    });

    it('drops the tint for the callout block itself', () => {
      const callout = makeBlock({
        id: 'callout-1',
        name: 'callout',
        backgroundColor: 'rgb(10, 20, 30)',
      });

      document.body.appendChild(callout.holder);

      const h = createHarness({ blocks: [callout] });

      h.wrapper.style.setProperty('--blok-bg-light', 'stale');
      h.toolbar.moveAndOpen(callout);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');
    });

    it('drops the tint for the callout first child', () => {
      const { h, child } = calloutFixture({ background: 'rgb(10, 20, 30)' });

      h.wrapper.style.setProperty('--blok-bg-light', 'stale');
      h.toolbar.moveAndOpen(child);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');
    });

    it('drops the tint for a callout with no background of its own', () => {
      const { h, child } = calloutFixture({ childId: 'child-2' });

      h.wrapper.style.setProperty('--blok-bg-light', 'stale');
      h.toolbar.moveAndOpen(child);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');
    });

    it('drops the tint when the parent is not a callout', () => {
      const { h, child } = calloutFixture({
        childId: 'child-2',
        parentName: 'toggle',
        background: 'rgb(10, 20, 30)',
      });

      h.wrapper.style.setProperty('--blok-bg-light', 'stale');
      h.toolbar.moveAndOpen(child);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');
    });

    it('drops the tint when the parent block is gone', () => {
      const { h, child } = calloutFixture({
        childId: 'child-2',
        parentFound: false,
        background: 'rgb(10, 20, 30)',
      });

      h.wrapper.style.setProperty('--blok-bg-light', 'stale');
      h.toolbar.moveAndOpen(child);

      expect(h.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');
    });
  });

  describe('moveAndOpen() — blocks with a left-edge control', () => {
    const openBeside = (block: Block, position: 'left' | 'right' = 'left'): Harness => {
      document.body.appendChild(block.holder);

      const h = createHarness({
        blocks: [block, makeBlock({ id: 'other' })],
        config: { toolbarPosition: position },
      });

      h.toolbar.moveAndOpen(block);

      return h;
    };

    const withArrow = (id: string, name: string): Block => {
      const holder = document.createElement('div');
      const arrow = document.createElement('button');

      arrow.setAttribute('data-blok-toggle-arrow', '');
      holder.appendChild(arrow);

      return makeBlock({
        id,
        name,
        holder,
      });
    };

    it('lets clicks through to a callout emoji', () => {
      const h = openBeside(makeBlock({
        id: 'callout',
        name: 'callout',
      }));

      expect(h.actions.style.pointerEvents).toBe('none');
      expect(h.plusButton.style.pointerEvents).toBe('none');
      expect(h.settingsToggler.style.pointerEvents).toBe('auto');
    });

    it('lets clicks through to a toggle arrow', () => {
      const h = openBeside(makeBlock({
        id: 'toggle',
        name: 'toggle',
      }));

      expect(h.actions.style.pointerEvents).toBe('none');
    });

    it('lets clicks through to a toggle heading arrow', () => {
      const h = openBeside(withArrow('toggle-h', 'header'));

      expect(h.actions.style.pointerEvents).toBe('none');
    });

    it('keeps the actions clickable for a plain heading', () => {
      const h = openBeside(makeBlock({
        id: 'plain-h',
        name: 'header',
      }));

      expect(h.actions.style.pointerEvents).toBe('auto');
      expect(h.plusButton.style.pointerEvents).toBe('');
    });

    it('keeps the actions clickable in the end gutter, away from the left edge', () => {
      const h = openBeside(makeBlock({
        id: 'callout',
        name: 'callout',
      }), 'right');

      expect(h.actions.style.pointerEvents).toBe('auto');
    });
  });

  describe('moveAndOpen() — settings toggler visibility', () => {
    const openWith = (options: {
      blockCount: number;
      isEmpty: boolean;
      toolTunes?: unknown[];
      commonTunes?: unknown[];
    }): Harness => {
      const block = makeBlock({
        id: 'only',
        isEmpty: options.isEmpty,
      });

      (block.getTunes as unknown as Mock).mockReturnValue({
        toolTunes: options.toolTunes ?? [],
        commonTunes: options.commonTunes ?? [],
      });
      document.body.appendChild(block.holder);

      const blocks = [block];

      for (let i = 1; i < options.blockCount; i++) {
        blocks.push(makeBlock({ id: `filler-${i}` }));
      }

      const h = createHarness({ blocks });

      h.settingsToggler.classList.add('hidden');
      h.toolbar.moveAndOpen(block);

      return h;
    };

    it('hides the toggler beside the document\'s only empty untuned block', () => {
      expect(openWith({
        blockCount: 1,
        isEmpty: true,
      }).settingsToggler.classList.contains('hidden')).toBe(true);
    });

    it('shows the toggler once the only block has text', () => {
      expect(openWith({
        blockCount: 1,
        isEmpty: false,
      }).settingsToggler.classList.contains('hidden')).toBe(false);
    });

    it('shows the toggler once a second block exists', () => {
      expect(openWith({
        blockCount: 2,
        isEmpty: true,
      }).settingsToggler.classList.contains('hidden')).toBe(false);
    });

    it('shows the toggler when the empty block still has tool tunes', () => {
      expect(openWith({
        blockCount: 1,
        isEmpty: true,
        toolTunes: ['tune'],
      }).settingsToggler.classList.contains('hidden')).toBe(false);
    });

    it('shows the toggler when the empty block still has common tunes', () => {
      expect(openWith({
        blockCount: 1,
        isEmpty: true,
        commonTunes: ['tune'],
      }).settingsToggler.classList.contains('hidden')).toBe(false);
    });
  });

  describe('repositioning while the block resizes', () => {
    const openAndGetResizeCallback = (h: Harness, block: Block): (() => void) => {
      h.toolbar.moveAndOpen(block);

      const callback = h.seam.positioner.watchTargetResize.mock.calls[0]?.[1];

      if (typeof callback !== 'function') {
        throw new Error('resize callback was not registered');
      }

      return callback as () => void;
    };

    it('re-measures against the block it is following', () => {
      const block = makeBlock({ id: 'anchor' });
      const target = document.createElement('span');

      target.textContent = 'hovered span';
      block.holder.appendChild(target);
      document.body.appendChild(block.holder);

      const h = createHarness({
        blocks: [block],
        config: { toolbarPosition: 'right' },
      });

      h.ui.isMobile = true;
      h.seam.positioner.target = target;

      const reposition = openAndGetResizeCallback(h, block);

      reposition();

      const args = h.seam.positioner.repositionToolbar.mock.calls[0];

      expect(args?.[0]).toBe(h.toolbar.nodes);
      expect((args?.[1] as { targetBlock: Block }).targetBlock).toBe(block);
      expect((args?.[1] as { hoveredTarget: Element | null }).hoveredTarget).toBe(target);
      expect((args?.[1] as { isMobile: boolean }).isMobile).toBe(true);
      expect((args?.[1] as { dockedToEnd: boolean }).dockedToEnd).toBe(true);
      expect(args?.[2]).toBe(h.plusButton);
    });

    it('does nothing once the toolbar has stopped following a block', () => {
      const block = makeBlock({ id: 'anchor' });

      document.body.appendChild(block.holder);

      const h = createHarness({ blocks: [block] });
      const reposition = openAndGetResizeCallback(h, block);

      h.toolbar.close();
      reposition();

      expect(h.seam.positioner.repositionToolbar).not.toHaveBeenCalled();
    });
  });

  describe('content column alignment', () => {
    const alignFixture = (position: 'left' | 'right', rects: {
      wrapper: { left: number; right: number; width: number };
      content: { left: number; width: number };
      actionsWidth: number;
    }): Harness => {
      const block = makeBlock({ id: 'anchor' });
      const contentElement = document.createElement('div');

      contentElement.setAttribute('data-blok-element-content', '');
      contentElement.textContent = 'anchor content';
      block.holder.appendChild(contentElement);
      document.body.appendChild(block.holder);

      const h = createHarness({
        blocks: [block],
        config: { toolbarPosition: position },
      });

      vi.spyOn(h.wrapper, 'getBoundingClientRect').mockReturnValue({
        left: rects.wrapper.left,
        right: rects.wrapper.right,
        width: rects.wrapper.width,
        top: 0,
        bottom: 0,
        height: 0,
        x: rects.wrapper.left,
        y: 0,
        toJSON: () => ({}),
      });
      vi.spyOn(contentElement, 'getBoundingClientRect').mockReturnValue({
        left: rects.content.left,
        right: rects.content.left + rects.content.width,
        width: rects.content.width,
        top: 0,
        bottom: 0,
        height: 0,
        x: rects.content.left,
        y: 0,
        toJSON: () => ({}),
      });
      Object.defineProperty(h.actions, 'offsetWidth', {
        value: rects.actionsWidth,
        configurable: true,
      });

      h.toolbar.moveAndOpen(block);

      return h;
    };

    it('keeps the start-docked actions bar on screen', () => {
      // offset 50 asked for, but the bar needs 200 - 100 of slack = 100.
      const h = alignFixture('left', {
        wrapper: {
          left: 100,
          right: 900,
          width: 800,
        },
        content: {
          left: 150,
          width: 400,
        },
        actionsWidth: 200,
      });

      expect(h.content.style.marginLeft).toBe('100px');
      expect(h.content.style.maxWidth).toBe('400px');
    });

    it('keeps the end-docked actions bar on screen', () => {
      // viewport 1024: slack right 124, overhang 76, so the offset caps at 324.
      const h = alignFixture('right', {
        wrapper: {
          left: 100,
          right: 900,
          width: 800,
        },
        content: {
          left: 700,
          width: 400,
        },
        actionsWidth: 200,
      });

      expect(window.innerWidth).toBe(1024);
      expect(h.content.style.marginLeft).toBe('324px');
      expect(h.content.style.maxWidth).toBe('400px');
    });
  });

});
