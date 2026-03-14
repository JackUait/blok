import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RectangleSelection } from '../../../../src/components/modules/rectangleSelection';
import { SelectionUtils } from '../../../../src/components/selection';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { Block as BlockType } from '../../../../src/components/block';

type PartialModules = Partial<BlokModules>;

type ToolbarModuleMock = {
  close: Mock<() => void>;
  moveAndOpenForMultipleBlocks: Mock<() => void>;
};

type InlineToolbarModuleMock = {
  close: Mock<() => void>;
};

type BlockSelectionModuleMock = {
  allBlocksSelected: boolean;
  selectBlockByIndex: Mock<(index: number) => void>;
  unSelectBlockByIndex: Mock<(index: number) => void>;
  disableNavigationMode: Mock<() => void>;
  selectedBlocks: BlockType[];
};

type BlockManagerModuleMock = {
  blocks: BlockType[];
  getBlockByChildNode: Mock<(node: Node) => BlockType | undefined>;
  getBlockByIndex: Mock<(index: number) => BlockType | undefined>;
  getBlockById: Mock<(id: string) => BlockType | undefined>;
  resolveToRootBlock: Mock<(block: BlockType) => BlockType>;
  lastBlock: { holder: HTMLElement };
};

interface RectangleSelectionTestSetup {
  rectangleSelection: RectangleSelection;
  modules: PartialModules;
  blokWrapper: HTMLDivElement;
  holder: HTMLDivElement;
  blockContent: HTMLDivElement;
  toolbar: ToolbarModuleMock;
  inlineToolbar: InlineToolbarModuleMock;
  blockSelection: BlockSelectionModuleMock;
  blockManager: BlockManagerModuleMock;
}

const createRectangleSelection = (overrides: PartialModules = {}): RectangleSelectionTestSetup => {
  const rectangleSelection = new RectangleSelection({
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const holder = document.createElement('div');
  const blokWrapper = document.createElement('div');

  blokWrapper.setAttribute('data-blok-testid', 'blok-wrapper');
  blokWrapper.setAttribute('data-blok-editor', '');
  blokWrapper.setAttribute('data-blok-redactor', '');
  holder.appendChild(blokWrapper);
  document.body.appendChild(holder);

  const blockContent = document.createElement('div');

  blockContent.setAttribute('data-blok-testid', 'block-content');
  blockContent.setAttribute('data-blok-element-content', '');
  blockContent.style.width = '400px';

  const lastBlockHolder = document.createElement('div');

  lastBlockHolder.appendChild(blockContent);

  const blocks: BlockType[] = [];

  const toolbarMock: ToolbarModuleMock = {
    close: vi.fn<() => void>(),
    moveAndOpenForMultipleBlocks: vi.fn<() => void>(),
  };

  const inlineToolbarMock: InlineToolbarModuleMock = {
    close: vi.fn<() => void>(),
  };

  const blockSelectionMock: BlockSelectionModuleMock = {
    allBlocksSelected: false,
    selectBlockByIndex: vi.fn<(index: number) => void>(),
    unSelectBlockByIndex: vi.fn<(index: number) => void>(),
    disableNavigationMode: vi.fn<() => void>(),
    selectedBlocks: [],
  };

  const blockManagerMock: BlockManagerModuleMock = {
    blocks,
    getBlockByChildNode: vi.fn<(node: Node) => BlockType | undefined>(),
    getBlockByIndex: vi.fn<(index: number) => BlockType | undefined>((index: number) => blocks[index]),
    getBlockById: vi.fn<(id: string) => BlockType | undefined>(),
    resolveToRootBlock: vi.fn<(block: BlockType) => BlockType>((block: BlockType) => block),
    lastBlock: {
      holder: lastBlockHolder,
    },
  };

  const defaults: PartialModules = {
    UI: {
      nodes: {
        holder,
      },
      CSS: {
        blokWrapper: '',
      },
      contentRect: blockContent.getBoundingClientRect(),
    } as unknown as BlokModules['UI'],
    Toolbar: toolbarMock as unknown as BlokModules['Toolbar'],
    InlineToolbar: inlineToolbarMock as unknown as BlokModules['InlineToolbar'],
    BlockSelection: blockSelectionMock as unknown as BlokModules['BlockSelection'],
    BlockManager: blockManagerMock as unknown as BlokModules['BlockManager'],
  };

  const mergedState: PartialModules = { ...defaults };

  for (const [moduleName, moduleOverrides] of Object.entries(overrides) as Array<[keyof BlokModules, unknown]>) {
    if (moduleOverrides === undefined) {
      continue;
    }

    const existingModule = mergedState[moduleName];

    if (
      existingModule !== undefined &&
      existingModule !== null &&
      typeof existingModule === 'object' &&
      moduleOverrides !== null &&
      typeof moduleOverrides === 'object'
    ) {
      Object.assign(
        existingModule as unknown as Record<string, unknown>,
        moduleOverrides as unknown as Record<string, unknown>
      );
    } else {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = moduleOverrides as BlokModules[typeof moduleName];
    }
  }

  rectangleSelection.state = mergedState as BlokModules;

  return {
    rectangleSelection,
    modules: mergedState,
    blokWrapper,
    holder,
    blockContent,
    toolbar: toolbarMock,
    inlineToolbar: inlineToolbarMock,
    blockSelection: blockSelectionMock,
    blockManager: blockManagerMock,
  };
};

describe('RectangleSelection', () => {
  beforeAll(() => {
    if (typeof document.elementFromPoint !== 'function') {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: () => document.createElement('div'),
      });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('creates overlay container on prepare', () => {
    const {
      rectangleSelection,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const overlay = blokWrapper.querySelector('[data-blok-testid="overlay"]');
    const rectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]');

    expect(overlay).not.toBeNull();
    expect(rectangle).not.toBeNull();
  });

  it('starts selection inside the blok and resets selection state', () => {
    const {
      rectangleSelection,
      blockSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds to allow selection at pageY=240
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      isRectSelectionActivated: boolean;
      mousedown: boolean;
      startX: number;
      startY: number;
    };

    internal.stackOfSelected.push(1, 2);
    internal.isRectSelectionActivated = true;

    blockSelection.allBlocksSelected = true;

    const startTarget = document.createElement('div');

    blokWrapper.appendChild(startTarget);

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

    rectangleSelection.startSelection(120, 240);

    expect(blockSelection.allBlocksSelected).toBe(false);
    expect(internal.stackOfSelected).toEqual([]);
    expect(internal.isRectSelectionActivated).toBe(false);
    expect(internal.mousedown).toBe(true);
    expect(internal.startX).toBe(120);
    expect(internal.startY).toBe(240);

    elementFromPointSpy.mockRestore();
  });

  it('ignores selection start initiated from the toolbar', () => {
    const {
      rectangleSelection,
      blockSelection,
    } = createRectangleSelection();

    blockSelection.allBlocksSelected = true;

    const toolbarElement = document.createElement('div');

    toolbarElement.setAttribute('data-blok-testid', 'toolbar');
    toolbarElement.setAttribute('data-blok-toolbar', '');
    Object.assign(toolbarElement);
    const toolbarChild = document.createElement('div');

    toolbarElement.appendChild(toolbarChild);
    document.body.appendChild(toolbarElement);

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(toolbarChild);

    const internal = rectangleSelection as unknown as { mousedown: boolean };

    rectangleSelection.startSelection(10, 20);

    expect(blockSelection.allBlocksSelected).toBe(true);
    expect(internal.mousedown).toBe(false);

    elementFromPointSpy.mockRestore();
  });

  it('ignores selection attempts on block content or selectors to avoid', () => {
    const {
      rectangleSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor to have valid vertical bounds
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 800,
      width: 800,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const internal = rectangleSelection as unknown as { mousedown: boolean };

    const blockContent = document.createElement('div');

    blockContent.setAttribute('data-blok-testid', 'block-content');
    blockContent.setAttribute('data-blok-element-content', '');
    blokWrapper.appendChild(blockContent);

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(blockContent);

    rectangleSelection.startSelection(20, 25);

    expect(internal.mousedown).toBe(false);

    elementFromPointSpy.mockRestore();
  });

  it('clears selection activation flag when clearSelection is called', () => {
    const { rectangleSelection } = createRectangleSelection();
    const internal = rectangleSelection as unknown as { isRectSelectionActivated: boolean };

    internal.isRectSelectionActivated = true;
    rectangleSelection.clearSelection();

    expect(internal.isRectSelectionActivated).toBe(false);
  });

  it('reports whether rectangle selection is active', () => {
    const { rectangleSelection } = createRectangleSelection();
    const internal = rectangleSelection as unknown as { isRectSelectionActivated: boolean };

    internal.isRectSelectionActivated = false;
    expect(rectangleSelection.isRectActivated()).toBe(false);

    internal.isRectSelectionActivated = true;
    expect(rectangleSelection.isRectActivated()).toBe(true);
  });

  it('resets selection parameters on endSelection', () => {
    const {
      rectangleSelection,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      mousedown: boolean;
      startX: number;
      startY: number;
      overlayRectangle: HTMLDivElement;
    };

    internal.mousedown = true;
    internal.startX = 50;
    internal.startY = 60;
    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;
    internal.overlayRectangle.style.display = 'block';

    rectangleSelection.endSelection();

    expect(internal.mousedown).toBe(false);
    expect(internal.startX).toBe(0);
    expect(internal.startY).toBe(0);
    expect(internal.overlayRectangle.style.display).toBe('none');
  });

  it('starts selection only for the main mouse button', () => {
    const {
      rectangleSelection,
    } = createRectangleSelection();

    const startSelectionSpy = vi.spyOn(rectangleSelection, 'startSelection');

    const internal = rectangleSelection as unknown as {
      processMouseDown: (event: MouseEvent) => void;
    };

    const primaryEvent = {
      button: 0,
      pageX: 150,
      pageY: 200,
      shiftKey: false,
      target: document.createElement('div'),
    } as unknown as MouseEvent;

    internal.processMouseDown(primaryEvent);

    expect(startSelectionSpy).toHaveBeenCalledWith(150, 200, false);

    startSelectionSpy.mockClear();

    const secondaryEvent = {
      button: 1,
      pageX: 150,
      pageY: 200,
      shiftKey: false,
      target: document.createElement('div'),
    } as unknown as MouseEvent;

    internal.processMouseDown(secondaryEvent);

    expect(startSelectionSpy).not.toHaveBeenCalled();
  });

  it('delegates mouse move handling to rectangle updates and scroll zones', () => {
    const {
      rectangleSelection,
    } = createRectangleSelection();

    const internal = rectangleSelection as unknown as {
      processMouseMove: (event: MouseEvent) => void;
      changingRectangle: (event: MouseEvent) => void;
      scrollByZones: (clientY: number) => void;
    };

    const changeSpy = vi.spyOn(internal, 'changingRectangle');
    const scrollSpy = vi.spyOn(internal, 'scrollByZones');

    const mouseEvent = {
      clientY: 320,
    } as unknown as MouseEvent;

    internal.processMouseMove(mouseEvent);

    expect(changeSpy).toHaveBeenCalledWith(mouseEvent);
    expect(scrollSpy).toHaveBeenCalledWith(320);
  });

  it('updates rectangle on scroll events', () => {
    const {
      rectangleSelection,
    } = createRectangleSelection();

    const internal = rectangleSelection as unknown as {
      processScroll: (event: MouseEvent) => void;
      changingRectangle: (event: MouseEvent) => void;
    };

    const changeSpy = vi.spyOn(internal, 'changingRectangle');
    const scrollEvent = { pageX: 50,
      pageY: 75 } as unknown as MouseEvent;

    internal.processScroll(scrollEvent);

    expect(changeSpy).toHaveBeenCalledWith(scrollEvent);
  });

  it('stops scrolling when cursor leaves scroll zones', () => {
    const { rectangleSelection } = createRectangleSelection();
    const internal = rectangleSelection as unknown as {
      scrollByZones: (clientY: number) => void;
      isScrolling: boolean;
      inScrollZone: number | null;
    };

    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 1000,
    });

    internal.isScrolling = true;
    internal.scrollByZones(200);

    expect(internal.isScrolling).toBe(false);
    expect(internal.inScrollZone).toBeNull();
  });

  it('triggers vertical scrolling when mouse enters scroll zones', () => {
    const {
      rectangleSelection,
    } = createRectangleSelection();

    const internal = rectangleSelection as unknown as {
      scrollByZones: (clientY: number) => void;
      scrollVertical: (speed: number) => void;
      isScrolling: boolean;
    };

    const scrollSpy = vi.spyOn(internal, 'scrollVertical').mockImplementation(() => undefined);

    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 1000,
    });

    internal.isScrolling = false;
    internal.scrollByZones(10);
    expect(scrollSpy).toHaveBeenCalledWith(-3);

    internal.isScrolling = false;
    scrollSpy.mockClear();
    internal.scrollByZones(995);
    expect(scrollSpy).toHaveBeenCalledWith(3);
  });

  it('scrolls vertically while mouse button is pressed in a scroll zone', () => {
    const { rectangleSelection } = createRectangleSelection();
    const internal = rectangleSelection as unknown as {
      scrollVertical: (speed: number) => void;
      inScrollZone: number | null;
      mousedown: boolean;
      mouseY: number;
    };

    vi.useFakeTimers();

    internal.inScrollZone = 1;
    internal.mousedown = true;
    internal.mouseY = 100;

    let yOffset = 0;

    const scrollYSpy = vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => yOffset);

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation((_x, y) => {
      yOffset += y;
    });

    internal.scrollVertical(5);

    internal.inScrollZone = null;
    vi.runOnlyPendingTimers();
    vi.useRealTimers();

    expect(scrollBySpy).toHaveBeenCalledWith(0, 5);
    expect(internal.mouseY).toBe(105);

    scrollBySpy.mockRestore();
    scrollYSpy.mockRestore();
  });

  it('shrinks overlay rectangle to the starting point', () => {
    const {
      rectangleSelection,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      shrinkRectangleToPoint: () => void;
      overlayRectangle: HTMLDivElement;
      startX: number;
      startY: number;
    };

    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;
    internal.startX = 150;
    internal.startY = 260;

    const scrollXSpy = vi.spyOn(window, 'scrollX', 'get').mockReturnValue(10);
    const scrollYSpy = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(20);

    internal.shrinkRectangleToPoint();

    expect(internal.overlayRectangle.style.left).toBe('140px');
    expect(internal.overlayRectangle.style.top).toBe('240px');
    expect(internal.overlayRectangle.style.bottom).toBe('calc(100% - 240px)');
    expect(internal.overlayRectangle.style.right).toBe('calc(100% - 140px)');

    scrollXSpy.mockRestore();
    scrollYSpy.mockRestore();
  });

  it('selects or unselects blocks based on rectangle overlap', () => {
    const {
      rectangleSelection,
      blockSelection,
      blockManager,
    } = createRectangleSelection();

    const selectedBlockState = { selected: false } as unknown as BlockType & { selected: boolean };

    blockManager.getBlockByIndex.mockReturnValue(selectedBlockState);

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      rectCrossesBlocks: boolean;
      inverseSelection: () => void;
    };

    internal.stackOfSelected.push(0, 1);
    internal.rectCrossesBlocks = true;

    internal.inverseSelection();

    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(0);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);
    expect(blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();

    blockSelection.selectBlockByIndex.mockClear();
    selectedBlockState.selected = true;
    internal.rectCrossesBlocks = false;

    internal.inverseSelection();

    expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(0);
    expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(1);
    expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
  });

  it('adds blocks to selection stack via addBlockInSelection', () => {
    const {
      rectangleSelection,
      blockSelection,
    } = createRectangleSelection();

    const internal = rectangleSelection as unknown as {
      rectCrossesBlocks: boolean;
      stackOfSelected: number[];
      addBlockInSelection: (index: number) => void;
    };

    internal.rectCrossesBlocks = true;
    internal.addBlockInSelection(2);

    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(2);
    expect(internal.stackOfSelected).toEqual([ 2 ]);

    blockSelection.selectBlockByIndex.mockClear();
    internal.rectCrossesBlocks = false;
    internal.addBlockInSelection(3);

    expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    expect(internal.stackOfSelected).toEqual([2, 3]);
  });

  it('updates rectangle size based on cursor position', () => {
    const {
      rectangleSelection,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      overlayRectangle: HTMLDivElement;
      startX: number;
      startY: number;
      mouseX: number;
      mouseY: number;
      updateRectangleSize: () => void;
    };

    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;
    internal.startX = 100;
    internal.startY = 150;
    internal.mouseX = 200;
    internal.mouseY = 250;

    internal.updateRectangleSize();

    expect(internal.overlayRectangle.style.left).toBe('100px');
    expect(internal.overlayRectangle.style.top).toBe('150px');
    expect(internal.overlayRectangle.style.right).toBe('calc(100% - 200px)');
    expect(internal.overlayRectangle.style.bottom).toBe('calc(100% - 250px)');
  });

  it('computes block information for current cursor position', () => {
    const {
      rectangleSelection,
      blockManager,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const blockHolder = document.createElement('div');

    const block = {
      holder: blockHolder,
    } as unknown as BlockType;

    blockManager.blocks.push(block);

    blockManager.getBlockByChildNode.mockReturnValue(block);

    const internal = rectangleSelection as unknown as {
      mouseY: number;
      genInfoForMouseSelection: () => { index: number | undefined };
    };

    internal.mouseY = 300;

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(blockHolder);

    const result = internal.genInfoForMouseSelection();

    expect(result.index).toBe(0);

    elementFromPointSpy.mockRestore();
  });

  it('activates rectangle selection and updates state when cursor moves with pressed mouse', () => {
    const {
      rectangleSelection,
      toolbar,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      changingRectangle: (event: MouseEvent) => void;
      mousedown: boolean;
      isRectSelectionActivated: boolean;
      overlayRectangle: HTMLDivElement;
    };

    internal.mousedown = true;
    internal.isRectSelectionActivated = false;
    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;

    const genInfoSpy = vi.spyOn(
      rectangleSelection as unknown as { genInfoForMouseSelection: () => { index: number } },
      'genInfoForMouseSelection'
    ).mockReturnValue({
      index: 1,
    });
    const trySelectSpy = vi.spyOn(
      rectangleSelection as unknown as { trySelectNextBlock: (index: number) => void },
      'trySelectNextBlock'
    );
    const inverseSpy = vi.spyOn(
      rectangleSelection as unknown as { inverseSelection: () => void },
      'inverseSelection'
    );
    const selectionRemove = vi.fn();
    const selectionSpy = vi.spyOn(SelectionUtils, 'get').mockReturnValue({
      removeAllRanges: selectionRemove,
    } as unknown as Selection);

    internal.changingRectangle({
      pageX: 200,
      pageY: 220,
    } as MouseEvent);

    expect(internal.isRectSelectionActivated).toBe(true);
    expect(internal.overlayRectangle.style.display).toBe('block');
    expect(toolbar.close).toHaveBeenCalled();
    expect(trySelectSpy).toHaveBeenCalledWith(1);
    expect(inverseSpy).toHaveBeenCalled();
    expect(selectionRemove).toHaveBeenCalled();

    genInfoSpy.mockRestore();
    selectionSpy.mockRestore();
  });

  it('does not attempt block selection when no block is detected under cursor', () => {
    const {
      rectangleSelection,
      toolbar,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      changingRectangle: (event: MouseEvent) => void;
      mousedown: boolean;
      isRectSelectionActivated: boolean;
      overlayRectangle: HTMLDivElement;
    };

    internal.mousedown = true;
    internal.isRectSelectionActivated = true;
    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;

    const genInfoSpy = vi.spyOn(
      rectangleSelection as unknown as { genInfoForMouseSelection: () => { index: number | undefined } },
      'genInfoForMouseSelection'
    ).mockReturnValue({
      index: undefined,
    });
    const trySelectSpy = vi.spyOn(
      rectangleSelection as unknown as { trySelectNextBlock: (index: number) => void },
      'trySelectNextBlock'
    );
    const selectionSpy = vi.spyOn(SelectionUtils, 'get');

    internal.changingRectangle({
      pageX: 120,
      pageY: 140,
    } as MouseEvent);

    expect(toolbar.close).toHaveBeenCalled();
    expect(trySelectSpy).not.toHaveBeenCalled();
    expect(selectionSpy).not.toHaveBeenCalled();
    // Verify observable state: when no block is detected, selection remains active
    // (the overlay stays visible for continuing the selection)
    expect(internal.isRectSelectionActivated).toBe(true);

    genInfoSpy.mockRestore();
    selectionSpy.mockRestore();
  });

  it('clears selection state on mouse leave and mouse up events', () => {
    const {
      rectangleSelection,
      blokWrapper,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    const internal = rectangleSelection as unknown as {
      processMouseLeave: () => void;
      processMouseUp: () => void;
      mousedown: boolean;
      startX: number;
      startY: number;
      isRectSelectionActivated: boolean;
      overlayRectangle: HTMLDivElement;
    };

    // Set up initial state
    internal.mousedown = true;
    internal.startX = 100;
    internal.startY = 200;
    internal.isRectSelectionActivated = true;
    internal.overlayRectangle = blokWrapper.querySelector('[data-blok-testid="overlay-rectangle"]') as HTMLDivElement;
    internal.overlayRectangle.style.display = 'block';

    internal.processMouseLeave();

    // Verify state changes after mouse leave
    expect(internal.mousedown).toBe(false);
    expect(internal.startX).toBe(0);
    expect(internal.startY).toBe(0);
    expect(internal.isRectSelectionActivated).toBe(false);
    expect(internal.overlayRectangle.style.display).toBe('none');

    // Reset state to test mouse up
    internal.mousedown = true;
    internal.startX = 100;
    internal.startY = 200;
    internal.isRectSelectionActivated = true;

    internal.processMouseUp();

    // Verify state changes after mouse up
    expect(internal.mousedown).toBe(false);
    expect(internal.startX).toBe(0);
    expect(internal.startY).toBe(0);
    expect(internal.isRectSelectionActivated).toBe(false);
  });

  it('extends selection to skipped blocks in downward direction', () => {
    const {
      rectangleSelection,
      blockSelection,
      blockManager,
    } = createRectangleSelection();

    // Populate blocks with sequential vertical positions (50px each)
    for (let i = 0; i < 5; i++) {
      const holder = document.createElement('div');

      holder.getBoundingClientRect = vi.fn(() => ({
        top: i * 50, bottom: (i + 1) * 50, left: 0, right: 800, width: 800, height: 50,
        x: 0, y: i * 50, toJSON: () => ({}),
      }));
      blockManager.blocks.push({ id: `b${i}`, holder, parentId: null } as unknown as BlockType);
    }

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      rectCrossesBlocks: boolean;
      anchorBlockIndex: number | null;
      trySelectNextBlock: (index: number) => void;
      startY: number;
      mouseY: number;
    };

    internal.rectCrossesBlocks = true;

    // Start selection at block 0, expand to 1
    internal.startY = 25;  // anchor at block 0 center (0-50)
    internal.mouseY = 25;
    internal.trySelectNextBlock(0);
    internal.mouseY = 75;  // block 1 center (50-100)
    internal.trySelectNextBlock(1);
    blockSelection.selectBlockByIndex.mockClear();

    // Jump to block 4 (skipping 2, 3)
    internal.mouseY = 225;  // block 4 center (200-250)
    internal.trySelectNextBlock(4);

    expect(internal.stackOfSelected).toEqual([0, 1, 2, 3, 4]);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(2);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(4);
  });

  it('shrinks selection stack when cursor moves backwards', () => {
    const {
      rectangleSelection,
      blockSelection,
      blockManager,
    } = createRectangleSelection();

    // Populate blocks with sequential vertical positions (50px each)
    for (let i = 0; i < 4; i++) {
      const holder = document.createElement('div');

      holder.getBoundingClientRect = vi.fn(() => ({
        top: i * 50, bottom: (i + 1) * 50, left: 0, right: 800, width: 800, height: 50,
        x: 0, y: i * 50, toJSON: () => ({}),
      }));
      blockManager.blocks.push({ id: `b${i}`, holder, parentId: null } as unknown as BlockType);
    }

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      rectCrossesBlocks: boolean;
      anchorBlockIndex: number | null;
      trySelectNextBlock: (index: number) => void;
      startY: number;
      mouseY: number;
    };

    internal.rectCrossesBlocks = true;

    // Build up selection from 0 to 3
    internal.startY = 25;  // anchor at block 0 center (0-50)
    internal.mouseY = 25;
    internal.trySelectNextBlock(0);
    internal.mouseY = 75;  // block 1 center (50-100)
    internal.trySelectNextBlock(1);
    internal.mouseY = 125;  // block 2 center (100-150)
    internal.trySelectNextBlock(2);
    internal.mouseY = 175;  // block 3 center (150-200)
    internal.trySelectNextBlock(3);
    blockSelection.selectBlockByIndex.mockClear();
    blockSelection.unSelectBlockByIndex.mockClear();

    // Shrink back to 1
    internal.mouseY = 75;  // block 1 center
    internal.trySelectNextBlock(1);

    expect(internal.stackOfSelected).toEqual([0, 1]);
    expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(3);
    expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(2);
  });

  it('attaches mousedown listener to document.body instead of container', () => {
    const {
      rectangleSelection,
    } = createRectangleSelection();

    const documentAddListenerSpy = vi.spyOn(document.body, 'addEventListener');

    rectangleSelection.prepare();

    const mousedownCalls = documentAddListenerSpy.mock.calls.filter(
      (call) => call[0] === 'mousedown'
    );

    expect(mousedownCalls.length).toBeGreaterThan(0);

    documentAddListenerSpy.mockRestore();
  });

  it('starts selection when pointer Y is within editor vertical bounds', () => {
    const {
      rectangleSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds: top=100, bottom=500
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      left: 200,
      right: 600,
      width: 400,
      height: 400,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    // Point outside editor horizontally (x=50) but within vertical range (y=300)
    const outsideElement = document.createElement('div');
    document.body.appendChild(outsideElement);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(outsideElement);

    const internal = rectangleSelection as unknown as { mousedown: boolean };

    // pageY=300 is within editor's vertical range (100-500)
    rectangleSelection.startSelection(50, 300);

    expect(internal.mousedown).toBe(true);
  });

  it('ignores selection when pointer Y is outside editor vertical bounds', () => {
    const {
      rectangleSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds: top=100, bottom=500
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      left: 200,
      right: 600,
      width: 400,
      height: 400,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    const outsideElement = document.createElement('div');
    document.body.appendChild(outsideElement);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(outsideElement);

    const internal = rectangleSelection as unknown as { mousedown: boolean };

    // pageY=50 is above editor's vertical range (100-500)
    rectangleSelection.startSelection(50, 50);

    expect(internal.mousedown).toBe(false);

    // pageY=600 is below editor's vertical range
    rectangleSelection.startSelection(50, 600);

    expect(internal.mousedown).toBe(false);
  });

  it('preserves existing selection when Shift key is held during selection start', () => {
    const {
      rectangleSelection,
      blockSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 800,
      width: 800,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      mousedown: boolean;
    };

    // Pre-populate selection stack
    internal.stackOfSelected = [0, 1];
    blockSelection.allBlocksSelected = true;

    const startTarget = document.createElement('div');
    blokWrapper.appendChild(startTarget);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

    // Start selection with Shift key
    rectangleSelection.startSelection(120, 240, true);

    // stackOfSelected should NOT be cleared
    expect(internal.stackOfSelected).toEqual([0, 1]);
    // allBlocksSelected should NOT be reset
    expect(blockSelection.allBlocksSelected).toBe(true);
    expect(internal.mousedown).toBe(true);
  });

  it('clears existing selection when Shift key is not held', () => {
    const {
      rectangleSelection,
      blockSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 800,
      width: 800,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      mousedown: boolean;
    };

    // Pre-populate selection stack
    internal.stackOfSelected = [0, 1];
    blockSelection.allBlocksSelected = true;

    const startTarget = document.createElement('div');
    blokWrapper.appendChild(startTarget);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

    // Start selection without Shift key
    rectangleSelection.startSelection(120, 240, false);

    // stackOfSelected should be cleared
    expect(internal.stackOfSelected).toEqual([]);
    // allBlocksSelected should be reset
    expect(blockSelection.allBlocksSelected).toBe(false);
    expect(internal.mousedown).toBe(true);
  });

  describe('toolbar close on horizontal bounds', () => {
    it('does not close toolbar when click is outside content area but inside redactor', () => {
      const {
        rectangleSelection,
        toolbar,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      rectangleSelection.prepare();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;

        // Content area is narrower (200-600) than redactor (0-800)
        (modules.UI as unknown as Record<string, unknown>).contentRect = {
          top: 0,
          bottom: 500,
          left: 200,
          right: 600,
          width: 400,
          height: 500,
          x: 200,
          y: 0,
          toJSON: () => ({}),
        };
      }

      // Redactor is full-width (0-800)
      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        bottom: 500,
        left: 0,
        right: 800,
        width: 800,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const startTarget = document.createElement('div');
      blokWrapper.appendChild(startTarget);
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

      // Click at x=50, which is inside redactor (0-800) but outside content (200-600)
      rectangleSelection.startSelection(50, 250);

      expect(toolbar.close).not.toHaveBeenCalled();
    });

    it('closes toolbar when click is within content area horizontal bounds', () => {
      const {
        rectangleSelection,
        toolbar,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      rectangleSelection.prepare();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;

        // Content area is 200-600
        (modules.UI as unknown as Record<string, unknown>).contentRect = {
          top: 0,
          bottom: 500,
          left: 200,
          right: 600,
          width: 400,
          height: 500,
          x: 200,
          y: 0,
          toJSON: () => ({}),
        };
      }

      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        bottom: 500,
        left: 0,
        right: 800,
        width: 800,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const startTarget = document.createElement('div');
      blokWrapper.appendChild(startTarget);
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

      const internal = rectangleSelection as unknown as { mousedown: boolean };

      // Click at x=300, which is inside content (200-600)
      rectangleSelection.startSelection(300, 250);

      expect(toolbar.close).toHaveBeenCalled();
      expect(internal.mousedown).toBe(true);
    });
  });

  describe('cancelActiveSelection', () => {
    it('clears active selection state', () => {
      const { rectangleSelection } = createRectangleSelection();

      // Start a selection
      rectangleSelection.startSelection(100, 100, false);

      // Cancel it
      rectangleSelection.cancelActiveSelection();

      expect(rectangleSelection.isRectActivated()).toBe(false);
    });

    it('is safe to call when no selection active', () => {
      const { rectangleSelection } = createRectangleSelection();

      expect(() => {
        rectangleSelection.cancelActiveSelection();
      }).not.toThrow();
    });

    it('clears mousedown flag', () => {
      const { rectangleSelection } = createRectangleSelection();

      rectangleSelection.startSelection(100, 100, false);
      rectangleSelection.cancelActiveSelection();

      // Verify internal state is reset by trying to start a new selection
      rectangleSelection.startSelection(200, 200, false);
      expect(rectangleSelection.isRectActivated()).toBe(false);
    });
  });

  describe('genInfoForMouseSelection returns child block index directly', () => {
    it('returns the child block index when getBlockByChildNode returns a child block with parentId', () => {
      const {
        rectangleSelection,
        blockManager,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;
      }

      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
        x: 0, y: 0, toJSON: () => ({}),
      });

      const tableHolder = document.createElement('div');
      const childHolder = document.createElement('div');

      const tableBlock = {
        id: 'table-1',
        holder: tableHolder,
        parentId: null,
      } as unknown as BlockType;

      const childBlock = {
        id: 'child-1',
        holder: childHolder,
        parentId: 'table-1',
      } as unknown as BlockType;

      blockManager.blocks.push(tableBlock, childBlock);

      blockManager.getBlockByChildNode.mockReturnValue(childBlock);

      const internal = rectangleSelection as unknown as {
        mouseY: number;
        genInfoForMouseSelection: () => { index: number | undefined };
      };

      internal.mouseY = 300;

      const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(childHolder);

      const result = internal.genInfoForMouseSelection();

      // Returns child's own index (1), not resolved root (0)
      expect(blockManager.resolveToRootBlock).not.toHaveBeenCalled();
      expect(result.index).toBe(1);

      elementFromPointSpy.mockRestore();
    });

    it('returns the block index directly when the block has no parentId', () => {
      const {
        rectangleSelection,
        blockManager,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;
      }

      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
        x: 0, y: 0, toJSON: () => ({}),
      });

      const blockHolder = document.createElement('div');

      const rootBlock = {
        id: 'paragraph-1',
        holder: blockHolder,
        parentId: null,
      } as unknown as BlockType;

      blockManager.blocks.push(rootBlock);

      blockManager.getBlockByChildNode.mockReturnValue(rootBlock);

      const internal = rectangleSelection as unknown as {
        mouseY: number;
        genInfoForMouseSelection: () => { index: number | undefined };
      };

      internal.mouseY = 300;

      const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(blockHolder);

      const result = internal.genInfoForMouseSelection();

      expect(blockManager.resolveToRootBlock).not.toHaveBeenCalled();
      expect(result.index).toBe(0);

      elementFromPointSpy.mockRestore();
    });

    it('returns the cell paragraph index directly when mouse is over a cell paragraph inside a table', () => {
      const {
        rectangleSelection,
        blockManager,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;
      }

      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
        x: 0, y: 0, toJSON: () => ({}),
      });

      // Set up blocks: [paragraph, table, cellParagraph1, cellParagraph2, paragraph2]
      const paragraphHolder = document.createElement('div');
      const tableHolder = document.createElement('div');
      const cellParagraph1Holder = document.createElement('div');
      const cellParagraph2Holder = document.createElement('div');
      const paragraph2Holder = document.createElement('div');

      const paragraph = {
        id: 'p-1',
        holder: paragraphHolder,
        parentId: null,
      } as unknown as BlockType;

      const table = {
        id: 'table-1',
        holder: tableHolder,
        parentId: null,
      } as unknown as BlockType;

      const cellParagraph1 = {
        id: 'cell-p-1',
        holder: cellParagraph1Holder,
        parentId: 'table-1',
      } as unknown as BlockType;

      const cellParagraph2 = {
        id: 'cell-p-2',
        holder: cellParagraph2Holder,
        parentId: 'table-1',
      } as unknown as BlockType;

      const paragraph2 = {
        id: 'p-2',
        holder: paragraph2Holder,
        parentId: null,
      } as unknown as BlockType;

      blockManager.blocks.push(paragraph, table, cellParagraph1, cellParagraph2, paragraph2);

      blockManager.getBlockByChildNode.mockReturnValue(cellParagraph1);

      const internal = rectangleSelection as unknown as {
        mouseY: number;
        genInfoForMouseSelection: () => { index: number | undefined };
      };

      internal.mouseY = 300;

      const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(cellParagraph1Holder);

      const result = internal.genInfoForMouseSelection();

      // Returns cellParagraph1's own index (2), not table's index (1)
      expect(blockManager.resolveToRootBlock).not.toHaveBeenCalled();
      expect(result.index).toBe(2);

      elementFromPointSpy.mockRestore();
    });

    it('returns undefined index when no element is found under cursor', () => {
      const {
        rectangleSelection,
        blockManager,
        blokWrapper,
        modules,
      } = createRectangleSelection();

      if (modules.UI) {
        modules.UI.nodes.redactor = blokWrapper;
      }

      vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
        x: 0, y: 0, toJSON: () => ({}),
      });

      const internal = rectangleSelection as unknown as {
        mouseY: number;
        genInfoForMouseSelection: () => { index: number | undefined };
      };

      internal.mouseY = 300;

      const elementFromPointSpy2 = vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

      const result = internal.genInfoForMouseSelection();

      expect(result.index).toBeUndefined();
      expect(blockManager.resolveToRootBlock).not.toHaveBeenCalled();

      elementFromPointSpy2.mockRestore();
    });
  });

  describe('visual-position-based selection', () => {
    /**
     * Helper to create a block stub with mocked getBoundingClientRect for visual position tests
     */
    const createBlockWithPosition = (
      id: string,
      top: number,
      height: number,
      parentId: string | null = null
    ): BlockType => {
      const holder = document.createElement('div');

      holder.getBoundingClientRect = vi.fn(() => ({
        top,
        bottom: top + height,
        left: 100,
        right: 700,
        width: 600,
        height,
        x: 100,
        y: top,
        toJSON: () => ({}),
      }));

      return {
        id,
        holder,
        parentId,
      } as unknown as BlockType;
    };

    describe('genInfoForMouseSelection returns child block index directly', () => {
      it('returns the child block index without calling resolveToRootBlock', () => {
        const {
          rectangleSelection,
          blockManager,
          blokWrapper,
          modules,
        } = createRectangleSelection();

        if (modules.UI) {
          modules.UI.nodes.redactor = blokWrapper;
        }

        vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
          top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
          x: 0, y: 0, toJSON: () => ({}),
        });

        const toggleHolder = document.createElement('div');
        const childHolder = document.createElement('div');

        const toggleBlock = {
          id: 'toggle-1',
          holder: toggleHolder,
          parentId: null,
        } as unknown as BlockType;

        const childBlock = {
          id: 'child-1',
          holder: childHolder,
          parentId: 'toggle-1',
        } as unknown as BlockType;

        blockManager.blocks.push(toggleBlock, childBlock);
        blockManager.getBlockByChildNode.mockReturnValue(childBlock);

        const internal = rectangleSelection as unknown as {
          mouseY: number;
          genInfoForMouseSelection: () => { index: number | undefined };
        };

        internal.mouseY = 300;

        const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(childHolder);

        const result = internal.genInfoForMouseSelection();

        // Should return child's own index (1), NOT resolve to root toggle (0)
        expect(result.index).toBe(1);
        expect(blockManager.resolveToRootBlock).not.toHaveBeenCalled();

        elementFromPointSpy.mockRestore();
      });
    });

    describe('trySelectNextBlock uses visual positions', () => {
      it('excludes blocks with zero height (hidden/collapsed) from selection', () => {
        const {
          rectangleSelection,
          blockManager,
          blockSelection,
        } = createRectangleSelection();

        const block0 = createBlockWithPosition('b0', 0, 50);
        const block1 = createBlockWithPosition('b1', 50, 30);
        const block2 = createBlockWithPosition('b2', 0, 0); // hidden — zero height
        const block3 = createBlockWithPosition('b3', 80, 50);

        blockManager.blocks.push(block0, block1, block2, block3);

        const internal = rectangleSelection as unknown as {
          rectCrossesBlocks: boolean;
          anchorBlockIndex: number | null;
          trySelectNextBlock: (index: number) => void;
          stackOfSelected: number[];
          startY: number;
          mouseY: number;
        };

        internal.rectCrossesBlocks = true;

        // block0: 0-50, block1: 50-80, block2: 0-0 (hidden), block3: 80-130
        internal.startY = 25;   // anchor at block 0 center
        internal.mouseY = 25;
        internal.trySelectNextBlock(0);
        internal.mouseY = 105;  // block 3 center (80+25=105)
        internal.trySelectNextBlock(3);

        // Block 2 has zero height and should NOT be selected
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(2);
        // Blocks 0, 1, 3 should be selected (they are visually in range)
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(0);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
      });

      it('excludes blocks that are visually outside the anchor-to-current range', () => {
        const {
          rectangleSelection,
          blockManager,
          blockSelection,
        } = createRectangleSelection();

        // Block 2 has indices within [0, 3] but is visually far below
        const block0 = createBlockWithPosition('b0', 0, 50);     // top=0, bottom=50
        const block1 = createBlockWithPosition('b1', 50, 30);    // top=50, bottom=80
        const block2 = createBlockWithPosition('b2', 500, 50);   // top=500, bottom=550 (far below)
        const block3 = createBlockWithPosition('b3', 80, 50);    // top=80, bottom=130

        blockManager.blocks.push(block0, block1, block2, block3);

        const internal = rectangleSelection as unknown as {
          rectCrossesBlocks: boolean;
          anchorBlockIndex: number | null;
          trySelectNextBlock: (index: number) => void;
          stackOfSelected: number[];
          startY: number;
          mouseY: number;
        };

        internal.rectCrossesBlocks = true;

        // block0: 0-50, block1: 50-80, block2: 500-550 (far below), block3: 80-130
        internal.startY = 25;   // anchor at block 0 center
        internal.mouseY = 25;
        internal.trySelectNextBlock(0);
        internal.mouseY = 105;  // block 3 center (80+25=105)
        internal.trySelectNextBlock(3);

        // Visual range: top=0 (block 0) to bottom=130 (block 3)
        // Block 2 at top=500 is visually outside this range
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(0);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(2);
      });

      it('includes toggle children that are visually within the selection range', () => {
        const {
          rectangleSelection,
          blockManager,
          blockSelection,
        } = createRectangleSelection();

        // Simulates: paragraph, toggle heading, toggle child, toggle child, paragraph
        const block0 = createBlockWithPosition('paragraph-1', 0, 50);
        const block1 = createBlockWithPosition('toggle-1', 50, 30, null);
        const block2 = createBlockWithPosition('child-1', 80, 50, 'toggle-1');
        const block3 = createBlockWithPosition('child-2', 130, 50, 'toggle-1');
        const block4 = createBlockWithPosition('paragraph-2', 180, 50);

        blockManager.blocks.push(block0, block1, block2, block3, block4);

        const internal = rectangleSelection as unknown as {
          rectCrossesBlocks: boolean;
          anchorBlockIndex: number | null;
          trySelectNextBlock: (index: number) => void;
          stackOfSelected: number[];
          startY: number;
          mouseY: number;
        };

        internal.rectCrossesBlocks = true;

        // Anchor at block 0, mouse moves to toggle child at index 3
        // With old code: genInfoForMouseSelection would resolve to root (index 1),
        // so trySelectNextBlock(1) selects [0, 1] — children not selected (BUG)
        // With new code: genInfoForMouseSelection returns 3 directly,
        // trySelectNextBlock(3) uses visual positions to select [0, 1, 2, 3]
        // block0: 0-50, block1: 50-80, block2: 80-130, block3: 130-180, block4: 180-230
        internal.startY = 25;   // anchor at block 0 center
        internal.mouseY = 25;
        internal.trySelectNextBlock(0);
        internal.mouseY = 155;  // block 3 center (130+25=155)
        internal.trySelectNextBlock(3);

        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(0);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(2);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
        // Block 4 is outside the visual range
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(4);
      });
    });

    describe('trySelectNextBlock constrains selection to rubber band coordinates', () => {
      it('does not select blocks outside the rubber band Y range even if block holders overlap', () => {
        const {
          rectangleSelection,
          blockManager,
          blockSelection,
        } = createRectangleSelection();

        /**
         * Layout: blocks with overlapping holders (8px padding overlap, realistic scenario)
         *
         *   Block 0 (header):     top=80,   bottom=186
         *   Block 1 (paragraph):  top=178,  bottom=254   ← overlaps block 0 by 8px
         *   Block 2 (header):     top=246,  bottom=332   ← overlaps block 1 by 8px
         *   Block 3 (header):     top=324,  bottom=429   ← overlaps block 2 by 8px
         *   Block 4 (header):     top=421,  bottom=507   ← overlaps block 3 by 8px
         *   Block 5 (header):     top=499,  bottom=569   ← overlaps block 4 by 8px
         *   Block 6 (header):     top=561,  bottom=622   ← overlaps block 5 by 8px
         *
         * Rubber band: startY=300, mouseY=500  (viewport Y coords, scrollY=0)
         *   → visually covers blocks 2, 3, 4 (and partially 5 at top=499)
         *   → should NOT select block 1 (bottom=254 < 300) or block 6 (top=561 > 500)
         *
         * Bug: the old algorithm used anchorBlock.holder.top (246) and
         * currentBlock.holder.bottom (569) as the range, which extends beyond
         * the rubber band and catches blocks 1 and 6.
         */
        const block0 = createBlockWithPosition('b0', 80, 106);   // top=80,  bottom=186
        const block1 = createBlockWithPosition('b1', 178, 76);   // top=178, bottom=254
        const block2 = createBlockWithPosition('b2', 246, 86);   // top=246, bottom=332
        const block3 = createBlockWithPosition('b3', 324, 105);  // top=324, bottom=429
        const block4 = createBlockWithPosition('b4', 421, 86);   // top=421, bottom=507
        const block5 = createBlockWithPosition('b5', 499, 70);   // top=499, bottom=569
        const block6 = createBlockWithPosition('b6', 561, 61);   // top=561, bottom=622

        blockManager.blocks.push(block0, block1, block2, block3, block4, block5, block6);

        const internal = rectangleSelection as unknown as {
          rectCrossesBlocks: boolean;
          anchorBlockIndex: number | null;
          trySelectNextBlock: (index: number) => void;
          stackOfSelected: number[];
          startY: number;
          mouseY: number;
        };

        internal.rectCrossesBlocks = true;

        // Simulate the rubber band from Y=300 to Y=500 (page coordinates, no scroll)
        internal.startY = 300;
        internal.mouseY = 500;

        // Anchor at block 2 (first block detected at Y=300, inside its bounds 246-332)
        // Mouse moves to block 5 (at Y=500, inside its bounds 499-569)
        internal.trySelectNextBlock(2);
        internal.trySelectNextBlock(5);

        // Blocks 2, 3, 4, 5 are within or overlap the rubber band [300, 500]
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(2);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(4);
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(5);

        // Block 1 (bottom=254) is entirely above the rubber band start (300) — must NOT be selected
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(1);

        // Block 6 (top=561) is entirely below the rubber band end (500) — must NOT be selected
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(6);

        // Block 0 (bottom=186) is far above — must NOT be selected
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(0);
      });

      it('does not select blocks whose X range does not overlap the rubber band X range', () => {
        const {
          rectangleSelection,
          blockManager,
          blockSelection,
        } = createRectangleSelection();

        /**
         * Layout: two blocks at the same vertical position but different horizontal positions.
         *
         *   Block 0: top=100, height=100 (bottom=200), left=500, right=700  ← RIGHT side, outside rubber band X
         *   Block 1: top=100, height=100 (bottom=200), left=100, right=300  ← LEFT side, inside rubber band X
         *
         * Rubber band: startX=50, mouseX=350, startY=50, mouseY=250 (page coords, scrollX=0)
         *   → X viewport range: [50, 350]  — overlaps block 1 (left=100, right=300) but NOT block 0 (left=500, right=700)
         *   → Y viewport range: [50, 250]  — overlaps BOTH blocks (top=100, bottom=200)
         *
         * Expected: block 1 IS selected, block 0 is NOT selected.
         * Bug: current code only checks Y, so block 0 gets selected despite being outside the rubber band horizontally.
         */
        const block0Holder = document.createElement('div');

        block0Holder.getBoundingClientRect = vi.fn(() => ({
          top: 100,
          bottom: 200,
          left: 500,
          right: 700,
          width: 200,
          height: 100,
          x: 500,
          y: 100,
          toJSON: () => ({}),
        }));

        const block1Holder = document.createElement('div');

        block1Holder.getBoundingClientRect = vi.fn(() => ({
          top: 100,
          bottom: 200,
          left: 100,
          right: 300,
          width: 200,
          height: 100,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        }));

        const block0 = {
          id: 'b0',
          holder: block0Holder,
          parentId: null,
        } as unknown as BlockType;

        const block1 = {
          id: 'b1',
          holder: block1Holder,
          parentId: null,
        } as unknown as BlockType;

        blockManager.blocks.push(block0, block1);

        const internal = rectangleSelection as unknown as {
          rectCrossesBlocks: boolean;
          anchorBlockIndex: number | null;
          trySelectNextBlock: (index: number) => void;
          stackOfSelected: number[];
          startX: number;
          mouseX: number;
          startY: number;
          mouseY: number;
        };

        internal.rectCrossesBlocks = true;

        // Rubber band covers both blocks vertically, but only block 1 horizontally
        internal.startX = 50;
        internal.mouseX = 350;
        internal.startY = 50;
        internal.mouseY = 250;

        // Anchor at block 1 (inside the rubber band X range)
        internal.anchorBlockIndex = 1;
        internal.trySelectNextBlock(1);

        // Block 1 (left=100, right=300) overlaps rubber band X [50, 350] — must be selected
        expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);

        // Block 0 (left=500, right=700) does NOT overlap rubber band X [50, 350] — must NOT be selected
        expect(blockSelection.selectBlockByIndex).not.toHaveBeenCalledWith(0);
      });
    });

    describe('changingRectangle uses root block holder for rectCrossesBlocks', () => {
      it('resolves to root block holder for horizontal intersection check', () => {
        const {
          rectangleSelection,
          blockManager,
          blokWrapper,
          modules,
        } = createRectangleSelection();

        if (modules.UI) {
          modules.UI.nodes.redactor = blokWrapper;
        }

        vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
          top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500,
          x: 0, y: 0, toJSON: () => ({}),
        });

        // Root toggle has wide holder, child has narrow holder
        const rootHolder = document.createElement('div');
        const childHolder = document.createElement('div');

        rootHolder.getBoundingClientRect = vi.fn(() => ({
          top: 50, bottom: 100, left: 100, right: 700, width: 600, height: 50,
          x: 100, y: 50, toJSON: () => ({}),
        }));
        childHolder.getBoundingClientRect = vi.fn(() => ({
          top: 80, bottom: 130, left: 200, right: 400, width: 200, height: 50,
          x: 200, y: 80, toJSON: () => ({}),
        }));

        const rootBlock = {
          id: 'toggle-1',
          holder: rootHolder,
          parentId: null,
        } as unknown as BlockType;

        const childBlock = {
          id: 'child-1',
          holder: childHolder,
          parentId: 'toggle-1',
        } as unknown as BlockType;

        blockManager.blocks.push(rootBlock, childBlock);
        blockManager.getBlockByChildNode.mockReturnValue(childBlock);
        blockManager.resolveToRootBlock.mockReturnValue(rootBlock);

        const internal = rectangleSelection as unknown as {
          mousedown: boolean;
          mouseX: number;
          mouseY: number;
          startX: number;
          startY: number;
          isRectSelectionActivated: boolean;
          rectCrossesBlocks: boolean;
          overlayRectangle: HTMLDivElement;
          changingRectangle: (event: MouseEvent) => void;
        };

        internal.mousedown = true;
        internal.isRectSelectionActivated = true;
        internal.overlayRectangle = document.createElement('div');
        // Rubber band covers x=150 to x=350 — intersects root (100-700) but starts at 150
        internal.startX = 150;
        internal.startY = 50;
        internal.mouseX = 350;
        internal.mouseY = 120;

        const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(childHolder);

        const mouseEvent = new MouseEvent('mousemove', { clientX: 350, clientY: 120 });

        Object.defineProperty(mouseEvent, 'pageX', { value: 350 });
        Object.defineProperty(mouseEvent, 'pageY', { value: 120 });

        internal.changingRectangle(mouseEvent);

        // The rectCrossesBlocks check should use the root block holder (wide: 100-700),
        // not the child block holder (narrow: 200-400)
        expect(blockManager.resolveToRootBlock).toHaveBeenCalledWith(childBlock);
        expect(internal.rectCrossesBlocks).toBe(true);

        elementFromPointSpy.mockRestore();
      });
    });
  });

  describe('trySelectNextBlock - direction changes', () => {
    /**
     * Helper to populate blockManager.blocks with sequential vertical positions
     * Each block is 50px tall, positioned sequentially from top=0
     */
    const populateBlocksWithPositions = (blockManager: BlockManagerModuleMock, count: number): void => {
      for (let i = 0; i < count; i++) {
        const holder = document.createElement('div');

        holder.getBoundingClientRect = vi.fn(() => ({
          top: i * 50, bottom: (i + 1) * 50, left: 0, right: 800, width: 800, height: 50,
          x: 0, y: i * 50, toJSON: () => ({}),
        }));
        blockManager.blocks.push({ id: `b${i}`, holder, parentId: null } as unknown as BlockType);
      }
    };

    it('should deselect blocks when selection shrinks downward then back', () => {
      const {
        rectangleSelection,
        blockSelection,
        blockManager,
      } = createRectangleSelection();

      populateBlocksWithPositions(blockManager, 5);

      const internal = rectangleSelection as unknown as {
        stackOfSelected: number[];
        rectCrossesBlocks: boolean;
        anchorBlockIndex: number | null;
        trySelectNextBlock: (index: number) => void;
        startY: number;
        mouseY: number;
      };

      internal.rectCrossesBlocks = true;

      // Expand down: 0, 1, 2, 3, 4 — block i at i*50 to (i+1)*50, center = i*50+25
      internal.startY = 25;  // anchor at block 0 center
      internal.mouseY = 25;
      internal.trySelectNextBlock(0);
      internal.mouseY = 75;
      internal.trySelectNextBlock(1);
      internal.mouseY = 125;
      internal.trySelectNextBlock(2);
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);
      internal.mouseY = 225;
      internal.trySelectNextBlock(4);

      blockSelection.selectBlockByIndex.mockClear();
      blockSelection.unSelectBlockByIndex.mockClear();

      // Shrink back to 2
      internal.mouseY = 125;
      internal.trySelectNextBlock(2);

      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(3);
      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(4);
      expect(internal.stackOfSelected).toEqual([0, 1, 2]);
    });

    it('should deselect blocks when selection shrinks upward then back', () => {
      const {
        rectangleSelection,
        blockSelection,
        blockManager,
      } = createRectangleSelection();

      populateBlocksWithPositions(blockManager, 6);

      const internal = rectangleSelection as unknown as {
        stackOfSelected: number[];
        rectCrossesBlocks: boolean;
        anchorBlockIndex: number | null;
        trySelectNextBlock: (index: number) => void;
        startY: number;
        mouseY: number;
      };

      internal.rectCrossesBlocks = true;

      // Expand up from 5: block i at i*50 to (i+1)*50, center = i*50+25
      internal.startY = 275;  // anchor at block 5 center (250+25)
      internal.mouseY = 275;
      internal.trySelectNextBlock(5);
      internal.mouseY = 225;
      internal.trySelectNextBlock(4);
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);
      internal.mouseY = 125;
      internal.trySelectNextBlock(2);
      internal.mouseY = 75;
      internal.trySelectNextBlock(1);

      blockSelection.selectBlockByIndex.mockClear();
      blockSelection.unSelectBlockByIndex.mockClear();

      // Shrink to 3
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);

      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(1);
      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(2);
      expect(internal.stackOfSelected).toEqual([3, 4, 5]);
    });

    it('should handle zigzag (down then up then down) correctly', () => {
      const {
        rectangleSelection,
        blockManager,
      } = createRectangleSelection();

      populateBlocksWithPositions(blockManager, 6);

      const internal = rectangleSelection as unknown as {
        stackOfSelected: number[];
        rectCrossesBlocks: boolean;
        anchorBlockIndex: number | null;
        trySelectNextBlock: (index: number) => void;
        startY: number;
        mouseY: number;
      };

      internal.rectCrossesBlocks = true;

      // Expand down 0->4 — block i at i*50 to (i+1)*50, center = i*50+25
      internal.startY = 25;  // anchor at block 0 center
      internal.mouseY = 25;
      internal.trySelectNextBlock(0);
      internal.mouseY = 75;
      internal.trySelectNextBlock(1);
      internal.mouseY = 125;
      internal.trySelectNextBlock(2);
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);
      internal.mouseY = 225;
      internal.trySelectNextBlock(4);

      // Shrink to 2
      internal.mouseY = 125;
      internal.trySelectNextBlock(2);

      // Expand again to 5
      internal.mouseY = 275;
      internal.trySelectNextBlock(5);

      expect(internal.stackOfSelected).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('should correctly handle complete reversal past anchor', () => {
      const {
        rectangleSelection,
        blockSelection,
        blockManager,
      } = createRectangleSelection();

      populateBlocksWithPositions(blockManager, 6);

      const internal = rectangleSelection as unknown as {
        stackOfSelected: number[];
        rectCrossesBlocks: boolean;
        anchorBlockIndex: number | null;
        trySelectNextBlock: (index: number) => void;
        startY: number;
        mouseY: number;
      };

      internal.rectCrossesBlocks = true;

      // Start at 3, expand down to 5 — block i at i*50 to (i+1)*50, center = i*50+25
      internal.startY = 175;  // anchor at block 3 center (150+25)
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);
      internal.mouseY = 225;
      internal.trySelectNextBlock(4);
      internal.mouseY = 275;
      internal.trySelectNextBlock(5);

      blockSelection.selectBlockByIndex.mockClear();
      blockSelection.unSelectBlockByIndex.mockClear();

      // Shrink past anchor to 1
      internal.mouseY = 75;
      internal.trySelectNextBlock(1);

      // Anchor stays at 3, selection flips direction
      expect(internal.stackOfSelected).toEqual([1, 2, 3]);
      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(4);
      expect(blockSelection.unSelectBlockByIndex).toHaveBeenCalledWith(5);
      expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(1);
      expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(2);
    });

    it('should handle single block selection (anchor == current)', () => {
      const {
        rectangleSelection,
        blockSelection,
        blockManager,
      } = createRectangleSelection();

      populateBlocksWithPositions(blockManager, 4);

      const internal = rectangleSelection as unknown as {
        stackOfSelected: number[];
        rectCrossesBlocks: boolean;
        anchorBlockIndex: number | null;
        trySelectNextBlock: (index: number) => void;
        startY: number;
        mouseY: number;
      };

      internal.rectCrossesBlocks = true;

      // block 3 is at 150-200, center = 175
      internal.startY = 175;
      internal.mouseY = 175;
      internal.trySelectNextBlock(3);

      expect(internal.stackOfSelected).toEqual([3]);
      expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(3);
    });
  });

  it('disables navigation mode when starting a new selection', () => {
    const {
      rectangleSelection,
      blockSelection,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Mock editor bounds to allow selection
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const startTarget = document.createElement('div');

    blokWrapper.appendChild(startTarget);

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

    rectangleSelection.startSelection(120, 240);

    expect(blockSelection.disableNavigationMode).toHaveBeenCalled();

    elementFromPointSpy.mockRestore();
  });

  it('uses redactor center X instead of document.body center for elementFromPoint in genInfoForMouseSelection', () => {
    const {
      rectangleSelection,
      blockManager,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    // Set blokWrapper as the redactor in the UI nodes
    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    // Simulate editor offset to the right (e.g., in a sidebar layout)
    // Editor occupies x: 600-1000, so its center is 800
    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      left: 600,
      right: 1000,
      width: 400,
      height: 500,
      x: 600,
      y: 0,
      toJSON: () => ({}),
    });

    // document.body is 1200px wide, so body center = 600 (NOT the editor center of 800)
    Object.defineProperty(document.body, 'offsetWidth', {
      configurable: true,
      value: 1200,
    });

    const blockHolder = document.createElement('div');
    const block = { id: 'b0', holder: blockHolder, parentId: null } as unknown as BlockType;

    blockManager.blocks.push(block);
    blockManager.getBlockByChildNode.mockReturnValue(block);

    blockHolder.getBoundingClientRect = vi.fn(() => ({
      top: 0, bottom: 50, left: 600, right: 1000, width: 400, height: 50,
      x: 600, y: 0, toJSON: () => ({}),
    }));

    blockManager.resolveToRootBlock.mockReturnValue(block);
    blockManager.getBlockByIndex.mockReturnValue(block);

    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(blockHolder);

    const internal = rectangleSelection as unknown as {
      mouseY: number;
      genInfoForMouseSelection: () => { index: number | undefined };
    };

    internal.mouseY = 25;

    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);

    internal.genInfoForMouseSelection();

    // The X coordinate passed to elementFromPoint should be the redactor's center (800),
    // NOT document.body.offsetWidth / 2 (600)
    expect(elementFromPointSpy).toHaveBeenCalledWith(800, 25);

    elementFromPointSpy.mockRestore();
  });

  it('does not deselect previously selected blocks when Shift+dragging a new range', () => {
    const {
      rectangleSelection,
      blockSelection,
      blockManager,
      blokWrapper,
      modules,
    } = createRectangleSelection();

    rectangleSelection.prepare();

    if (modules.UI) {
      modules.UI.nodes.redactor = blokWrapper;
    }

    vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 800,
      width: 800,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Create 6 blocks with sequential vertical positions (50px each)
    for (let i = 0; i < 6; i++) {
      const holder = document.createElement('div');

      holder.getBoundingClientRect = vi.fn(() => ({
        top: i * 50, bottom: (i + 1) * 50, left: 0, right: 800, width: 800, height: 50,
        x: 0, y: i * 50, toJSON: () => ({}),
      }));
      blockManager.blocks.push({ id: `b${i}`, holder, parentId: null, selected: false } as unknown as BlockType);
    }

    const internal = rectangleSelection as unknown as {
      stackOfSelected: number[];
      rectCrossesBlocks: boolean;
      anchorBlockIndex: number | null;
      trySelectNextBlock: (index: number) => void;
      startY: number;
      mouseY: number;
    };

    internal.rectCrossesBlocks = true;

    // First drag: select blocks 0-2 — block i at i*50 to (i+1)*50, center = i*50+25
    internal.startY = 25;   // anchor at block 0 center
    internal.mouseY = 25;
    internal.trySelectNextBlock(0);
    internal.mouseY = 125;  // block 2 center (100+25)
    internal.trySelectNextBlock(2);
    expect(internal.stackOfSelected).toEqual([0, 1, 2]);

    // Simulate mouseup (endSelection) — resets startY/mouseY to 0
    rectangleSelection.endSelection();

    // Mark blocks 0-2 as selected (simulating what BlockSelection would have done)
    for (let i = 0; i < 3; i++) {
      (blockManager.blocks[i] as unknown as { selected: boolean }).selected = true;
    }

    blockSelection.selectBlockByIndex.mockClear();
    blockSelection.unSelectBlockByIndex.mockClear();

    // Second drag with Shift: startSelection sets startY=240 (block 4 area: 200-250)
    const startTarget = document.createElement('div');

    blokWrapper.appendChild(startTarget);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);
    rectangleSelection.startSelection(120, 240, true);

    // Drag over blocks 4-5
    internal.rectCrossesBlocks = true;
    internal.mouseY = 225;  // block 4 center (200+25)
    internal.trySelectNextBlock(4);
    internal.mouseY = 275;  // block 5 center (250+25)
    internal.trySelectNextBlock(5);

    // Blocks 4-5 should be selected in the current drag
    expect(internal.stackOfSelected).toEqual([4, 5]);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(4);
    expect(blockSelection.selectBlockByIndex).toHaveBeenCalledWith(5);

    // Blocks 0-2 should NOT have been deselected
    expect(blockSelection.unSelectBlockByIndex).not.toHaveBeenCalledWith(0);
    expect(blockSelection.unSelectBlockByIndex).not.toHaveBeenCalledWith(1);
    expect(blockSelection.unSelectBlockByIndex).not.toHaveBeenCalledWith(2);
  });

});
