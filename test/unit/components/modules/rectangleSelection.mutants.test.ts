import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { BlokEventMap } from '../../../../src/components/events';
import { RectangleSelection } from '../../../../src/components/modules/rectangleSelection';
import { SelectionUtils } from '../../../../src/components/selection';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { Block as BlockType } from '../../../../src/components/block';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

vi.mock('../../../../src/components/utils/announcer', () => ({
  announce: vi.fn(),
}));

/**
 * Client-space geometry. Every rect in this file is written out in full: a
 * fixture where the editor sits at the origin, every row has the same height
 * and nothing is scrolled makes `- scrollLeft` read identically to
 * `+ scrollLeft` and collapses every nearest-edge test onto one answer.
 */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Page scroll used by the default fixture. Non-zero on BOTH axes on purpose. */
const SCROLL_X = 40;
const SCROLL_Y = 60;

/** The overlay container is deliberately NOT at the viewport origin. */
const OVERLAY_ORIGIN: Box = { left: 24, top: 18, right: 1224, bottom: 818 };

const REDACTOR: Box = { left: 200, top: 100, right: 1000, bottom: 900 };
const CONTENT: Box = { left: 300, top: 100, right: 900, bottom: 900 };

/** Stubbed viewport height: jsdom reports 0, which puts every drag in the bottom scroll zone. */
const VIEWPORT_HEIGHT = 800;

/** Default rows, with three DIFFERENT heights so a row index cannot be guessed from one offset. */
const B0: Box = { left: 300, top: 120, right: 900, bottom: 180 };
const B1: Box = { left: 300, top: 200, right: 900, bottom: 300 };
const B2: Box = { left: 300, top: 320, right: 900, bottom: 350 };

const boxToRect = (box: Box): DOMRect => new DOMRect(box.left, box.top, box.right - box.left, box.bottom - box.top);

const stubRect = (element: HTMLElement, box: Box): void => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => boxToRect(box),
  });
};

interface HitRegion {
  box: Box;
  element: Element;
}

/**
 * Registered bottom-to-top; the hit test answers topmost-first, like a real
 * `elementFromPoint`. Filled by each harness and drained in afterEach.
 */
let hitRegions: HitRegion[] = [];

const hitTest = (x: number, y: number): Element[] => hitRegions
  .filter((region) => x >= region.box.left && x <= region.box.right && y >= region.box.top && y <= region.box.bottom)
  .map((region) => region.element)
  .reverse();

interface SlotSpec {
  box: Box;
  kind?: 'plain' | 'childToolbar' | 'cell';
  /** Puts the slot inside an extra [data-blok-element] so it belongs to a DESCENDANT block. */
  insideDescendant?: boolean;
  /** An extra [data-blok-element] placed in the slot BEFORE any child holder. */
  firstChild?: Box;
}

interface BlockSpec {
  id: string;
  parentId?: string | null;
  name?: string;
  holder: Box;
  content?: Box | null;
  ownsChildren?: boolean;
  isUnit?: boolean;
  slot?: SlotSpec;
  /** Registers the holder itself as a hit region (for pointer positions off the content column). */
  hitHolder?: boolean;
  /** Mount into the parent's holder rather than its nested-blocks slot. */
  mountInParentHolder?: boolean;
  /** Mount at the editor root even though the model gives this block a parent. */
  mountRoot?: boolean;
}

interface TestBlock {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  selected: boolean;
  tool: { ownsChildren: boolean };
  isUnit: boolean;
  slotElement: HTMLElement | null;
}

interface BlockSelectionMock {
  allBlocksSelected: boolean;
  selectBlockByIndex: Mock<(index: number) => void>;
  unSelectBlockByIndex: Mock<(index: number) => void>;
  disableNavigationMode: Mock<() => void>;
  readonly selectedBlocks: BlockType[];
}

interface BlockManagerMock {
  blocks: BlockType[];
  getBlockByChildNode: Mock<(node: Node | null) => BlockType | undefined>;
  getBlockByIndex: Mock<(index: number | undefined) => BlockType | undefined>;
  getBlockById: Mock<(id: string | null) => BlockType | undefined>;
  resolveToSelectableBlock: Mock<(block: BlockType) => BlockType>;
  isSelectionUnit: Mock<(block: BlockType) => boolean>;
  getBlockDepth: Mock<(block: BlockType) => number>;
}

interface ToolbarMock {
  close: Mock<() => void>;
  moveAndOpenForMultipleBlocks: Mock<() => void>;
}

interface HarnessOptions {
  blocks?: BlockSpec[];
  /** Backdrop hit region standing in for the editor's empty space. `null` registers none. */
  backdrop?: Box | null;
  /** Whole-page hit region below everything else. */
  pageBackdrop?: boolean;
  /** Where getScrollTop/getScrollLeft must read the offset from. */
  scrollSource?: 'window' | 'documentElement';
  scrollX?: number;
  scrollY?: number;
  /** Skip prepare() so a test can watch the bindings being installed. */
  autoPrepare?: boolean;
}

interface Harness {
  rect: RectangleSelection;
  prepare: () => void;
  blocks: TestBlock[];
  indexOf: (id: string) => number;
  blockManager: BlockManagerMock;
  blockSelection: BlockSelectionMock;
  toolbar: ToolbarMock;
  editor: HTMLElement;
  overlay: HTMLElement;
  overlayRectangle: HTMLElement;
  overlayContainer: HTMLElement;
  scroll: { x: number; y: number };
  scrollBy: Mock<(x: number, y: number) => void>;
  register: (box: Box, element: Element) => void;
  mouseDownAt: (pageX: number, pageY: number, target?: Element) => void;
  moveTo: (pageX: number, pageY: number) => void;
  moveToClientY: (pageX: number, pageY: number, clientY: number) => void;
  releaseThrottle: () => void;
  mouseUp: () => void;
  mouseLeave: () => void;
  scrollWindow: () => void;
  contentEditable: HTMLElement;
  errors: string[];
}

const instances: RectangleSelection[] = [];
const cleanups: Array<() => void> = [];
let listenerErrors: string[] = [];

const defineOn = (target: Window, property: string, value: unknown): void => {
  const original = Object.getOwnPropertyDescriptor(target, property);

  Object.defineProperty(target, property, {
    configurable: true,
    writable: true,
    value,
  });
  cleanups.push(() => {
    if (original === undefined) {
      Reflect.deleteProperty(target, property);
    } else {
      Object.defineProperty(target, property, original);
    }
  });
};

/**
 * Stops a document part from answering, the way the harness stops `window.scrollY`.
 * `documentElement` and `body` are prototype accessors, so the restore deletes the
 * own property we install and lets the accessor show through again.
 */
const hideDocumentPart = (property: 'documentElement' | 'body'): void => {
  const original = Object.getOwnPropertyDescriptor(document, property);

  Object.defineProperty(document, property, {
    configurable: true,
    get: () => undefined,
  });
  cleanups.push(() => {
    if (original === undefined) {
      Reflect.deleteProperty(document, property);
    } else {
      Object.defineProperty(document, property, original);
    }
  });
};

const SLOT_MARKERS: Record<string, string> = {
  childToolbar: 'data-blok-child-toolbar',
  cell: 'data-blok-table-cell-blocks',
};

const buildSlot = (slot: SlotSpec, blockHolder: HTMLElement): HTMLElement => {
  const slotElement = document.createElement('div');
  const marker = SLOT_MARKERS[slot.kind ?? 'plain'];

  slotElement.setAttribute('data-blok-nested-blocks', '');
  if (marker !== undefined) {
    slotElement.setAttribute(marker, '');
  }
  stubRect(slotElement, slot.box);

  const mountPoint = slot.insideDescendant === true ? document.createElement('div') : blockHolder;

  if (mountPoint !== blockHolder) {
    mountPoint.setAttribute('data-blok-element', '');
    blockHolder.appendChild(mountPoint);
  }
  mountPoint.appendChild(slotElement);

  if (slot.firstChild !== undefined) {
    const firstChild = document.createElement('div');

    firstChild.setAttribute('data-blok-element', '');
    stubRect(firstChild, slot.firstChild);
    slotElement.appendChild(firstChild);
  }

  return slotElement;
};

const DEFAULT_BLOCKS: BlockSpec[] = [
  { id: 'b0', holder: B0 },
  { id: 'b1', holder: B1 },
  { id: 'b2', holder: B2 },
];

const createHarness = (options: HarnessOptions = {}): Harness => {
  const specs = options.blocks ?? DEFAULT_BLOCKS;
  const scroll = {
    x: options.scrollX ?? SCROLL_X,
    y: options.scrollY ?? SCROLL_Y,
  };
  const scrollSource = options.scrollSource ?? 'window';

  if (scrollSource === 'window') {
    vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => scroll.x);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll.y);
  } else {
    /**
     * `typeof window.scrollY === 'number'` has to be FALSE for the
     * documentElement fallback to run at all.
     */
    defineOn(window, 'scrollX', undefined);
    defineOn(window, 'scrollY', undefined);
    vi.spyOn(document.documentElement, 'scrollLeft', 'get').mockImplementation(() => scroll.x);
    vi.spyOn(document.documentElement, 'scrollTop', 'get').mockImplementation(() => scroll.y);
  }

  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);

  const scrollBy = vi.fn<(x: number, y: number) => void>((_x, y) => {
    scroll.y += y;
  });

  defineOn(window, 'scrollBy', scrollBy);

  const holder = document.createElement('div');
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');
  editor.setAttribute('data-blok-redactor', '');
  stubRect(editor, REDACTOR);
  holder.appendChild(editor);
  document.body.appendChild(holder);

  const contentEditable = document.createElement('div');

  contentEditable.setAttribute('contenteditable', 'true');
  document.body.appendChild(contentEditable);

  const pageElement = document.createElement('div');

  document.body.appendChild(pageElement);

  if (options.pageBackdrop !== false) {
    hitRegions.push({ box: { left: -2000, top: -2000, right: 4000, bottom: 4000 },
      element: pageElement });
  }

  const backdropBox = options.backdrop === undefined ? REDACTOR : options.backdrop;

  if (backdropBox !== null) {
    const backdrop = document.createElement('div');

    editor.appendChild(backdrop);
    hitRegions.push({ box: backdropBox,
      element: backdrop });
  }

  const blocks: TestBlock[] = [];
  const holderById = new Map<string, HTMLElement>();
  const slotById = new Map<string, HTMLElement>();

  for (const spec of specs) {
    const blockHolder = document.createElement('div');

    blockHolder.setAttribute('data-blok-element', '');
    stubRect(blockHolder, spec.holder);

    const contentBox = spec.content === undefined ? spec.holder : spec.content;

    if (contentBox !== null) {
      const contentElement = document.createElement('div');

      contentElement.setAttribute('data-blok-element-content', '');
      stubRect(contentElement, contentBox);
      blockHolder.appendChild(contentElement);
      hitRegions.push({ box: contentBox,
        element: contentElement });
    }

    const slotElement = spec.slot === undefined ? null : buildSlot(spec.slot, blockHolder);

    if (slotElement !== null) {
      slotById.set(spec.id, slotElement);
    }

    if (spec.hitHolder === true) {
      hitRegions.push({ box: spec.holder,
        element: blockHolder });
    }

    holderById.set(spec.id, blockHolder);
    blocks.push({
      id: spec.id,
      name: spec.name ?? 'paragraph',
      parentId: spec.parentId ?? null,
      holder: blockHolder,
      selected: false,
      tool: { ownsChildren: spec.ownsChildren ?? false },
      isUnit: spec.isUnit ?? true,
      slotElement,
    });
  }

  for (const spec of specs) {
    const blockHolder = holderById.get(spec.id);
    const parentId = spec.parentId ?? null;

    if (blockHolder === undefined) {
      continue;
    }

    const parentHolder = parentId === null ? undefined : holderById.get(parentId);
    const parentSlot = parentId === null ? undefined : slotById.get(parentId);
    const nested = spec.mountInParentHolder === true ? parentHolder : parentSlot ?? parentHolder;
    const mountPoint = parentId === null || spec.mountRoot === true ? editor : nested ?? editor;

    mountPoint.appendChild(blockHolder);
  }

  const asBlocks = blocks.map((block) => block as unknown as BlockType);
  const byId = (id: string | null): TestBlock | undefined => blocks.find((block) => block.id === id);
  const indexOf = (id: string): number => blocks.findIndex((block) => block.id === id);

  const domDepth = (element: HTMLElement): number => {
    let depth = 0;
    let cursor: HTMLElement | null = element.parentElement;

    while (cursor !== null) {
      depth += 1;
      cursor = cursor.parentElement;
    }

    return depth;
  };

  const blockSelection: BlockSelectionMock = {
    allBlocksSelected: false,
    selectBlockByIndex: vi.fn<(index: number) => void>((index) => {
      const block = blocks[index];

      if (block !== undefined) {
        block.selected = true;
      }
    }),
    unSelectBlockByIndex: vi.fn<(index: number) => void>((index) => {
      const block = blocks[index];

      if (block !== undefined) {
        block.selected = false;
      }
    }),
    disableNavigationMode: vi.fn<() => void>(),
    get selectedBlocks(): BlockType[] {
      return asBlocks.filter((_block, index) => blocks[index].selected);
    },
  };

  const blockManager: BlockManagerMock = {
    blocks: asBlocks,
    getBlockByChildNode: vi.fn<(node: Node | null) => BlockType | undefined>((node) => {
      if (node === null || !(node instanceof Node)) {
        return undefined;
      }

      const matches = blocks.filter((block) => block.holder === node || block.holder.contains(node));

      if (matches.length === 0) {
        return undefined;
      }

      const deepest = matches.reduce((best, candidate) =>
        domDepth(candidate.holder) > domDepth(best.holder) ? candidate : best);

      return deepest as unknown as BlockType;
    }),
    getBlockByIndex: vi.fn<(index: number | undefined) => BlockType | undefined>((index) =>
      index === undefined ? undefined : asBlocks[index]),
    getBlockById: vi.fn<(id: string | null) => BlockType | undefined>((id) => {
      const found = byId(id);

      return found === undefined ? undefined : found as unknown as BlockType;
    }),
    resolveToSelectableBlock: vi.fn<(block: BlockType) => BlockType>((block) => block),
    isSelectionUnit: vi.fn<(block: BlockType) => boolean>((block) =>
      (block as unknown as TestBlock).isUnit),
    getBlockDepth: vi.fn<(block: BlockType) => number>((block) => {
      const seen = new Set<string>();
      let cursor = block as unknown as TestBlock | undefined;
      let depth = 0;

      while (cursor !== undefined && cursor.parentId !== null && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        cursor = byId(cursor.parentId);
        depth += 1;
      }

      return depth;
    }),
  };

  const toolbar: ToolbarMock = {
    close: vi.fn<() => void>(),
    moveAndOpenForMultipleBlocks: vi.fn<() => void>(),
  };

  const rect = new RectangleSelection({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  instances.push(rect);

  rect.state = {
    UI: {
      nodes: {
        holder,
        redactor: editor,
      },
      contentRect: boxToRect(CONTENT),
      disableHoverForCooldown: vi.fn(),
      resetBlockHoverState: vi.fn(),
    },
    Toolbar: toolbar,
    BlockSelection: blockSelection,
    BlockManager: blockManager,
    I18n: {
      t: vi.fn((key: string) => key),
    },
  } as unknown as BlokModules;

  let overlay: HTMLElement = editor;
  let overlayRectangle: HTMLElement = editor;
  let overlayContainer: HTMLElement = editor;

  const prepare = (): void => {
    rect.prepare();

    const foundOverlay = editor.querySelector<HTMLElement>('[data-blok-testid="overlay"]');
    const foundRectangle = editor.querySelector<HTMLElement>('[data-blok-testid="overlay-rectangle"]');

    if (foundOverlay === null || foundRectangle === null) {
      throw new Error('harness: prepare() did not build the overlay');
    }

    overlay = foundOverlay;
    overlayRectangle = foundRectangle;

    const parent = foundRectangle.parentElement;

    if (parent === null) {
      throw new Error('harness: overlay rectangle has no container');
    }

    overlayContainer = parent;
    stubRect(overlayContainer, OVERLAY_ORIGIN);
  };

  if (options.autoPrepare !== false) {
    prepare();
  }

  const pageEvent = (type: string, pageX: number, pageY: number, clientY: number): MouseEvent => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: pageX - scroll.x,
      clientY,
    });

    Object.defineProperty(event, 'pageX', { value: pageX });
    Object.defineProperty(event, 'pageY', { value: pageY });

    return event;
  };

  return {
    rect,
    prepare,
    blocks,
    indexOf,
    blockManager,
    blockSelection,
    toolbar,
    editor,
    get overlay(): HTMLElement {
      return overlay;
    },
    get overlayRectangle(): HTMLElement {
      return overlayRectangle;
    },
    get overlayContainer(): HTMLElement {
      return overlayContainer;
    },
    scroll,
    scrollBy,
    register: (box: Box, element: Element): void => {
      hitRegions.push({ box,
        element });
    },
    mouseDownAt: (pageX: number, pageY: number, target?: Element): void => {
      (target ?? pageElement).dispatchEvent(pageEvent('mousedown', pageX, pageY, pageY - scroll.y));
    },
    moveTo: (pageX: number, pageY: number): void => {
      document.body.dispatchEvent(pageEvent('mousemove', pageX, pageY, pageY - scroll.y));
    },
    moveToClientY: (pageX: number, pageY: number, clientY: number): void => {
      document.body.dispatchEvent(pageEvent('mousemove', pageX, pageY, clientY));
    },
    releaseThrottle: (): void => {
      vi.advanceTimersByTime(20);
    },
    mouseUp: (): void => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    mouseLeave: (): void => {
      document.body.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    },
    scrollWindow: (): void => {
      window.dispatchEvent(new Event('scroll'));
    },
    contentEditable,
    errors: listenerErrors,
  };
};

const recordError = (event: Event): void => {
  listenerErrors.push(String((event as ErrorEvent).message));
};

describe('RectangleSelection — surviving mutants', () => {
  beforeAll(() => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      writable: true,
      value: (x: number, y: number): Element | null => hitTest(x, y)[0] ?? null,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      writable: true,
      value: (x: number, y: number): Element[] => hitTest(x, y),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    hitRegions = [];
    listenerErrors = [];
    window.addEventListener('error', recordError);
  });

  afterEach(() => {
    const errors = [ ...listenerErrors ];

    window.removeEventListener('error', recordError);

    for (const instance of instances.splice(0)) {
      instance.cancelActiveSelection();
    }
    for (const restore of cleanups.splice(0)) {
      restore();
    }

    hitRegions = [];
    vi.useRealTimers();
    vi.restoreAllMocks();

    /**
     * jsdom swallows a throw raised inside a dispatched listener, so a mutant
     * whose only symptom is that throw would otherwise pass. The swap drops
     * every body-bound listener the previous instance installed.
     */
    const freshBody = document.createElement('body');

    document.documentElement.replaceChild(freshBody, document.body);

    expect(errors).toEqual([]);
  });

  describe('deprecated CSS map', () => {
    it('exposes every legacy key as an empty string', () => {
      expect(RectangleSelection.CSS).toStrictEqual({
        overlay: '',
        overlayContainer: '',
        rect: '',
        topScrollZone: '',
        bottomScrollZone: '',
      });
    });
  });

  describe('initial state', () => {
    it('is neither active nor holding a mouse button before anything happens', () => {
      const h = createHarness();

      expect(h.rect.isRectActivated()).toBe(false);
      expect(h.rect.isMouseDownWithinBounds).toBe(false);
    });

    it('leaves the overlay hidden when a cancel arrives with no gesture in flight', () => {
      const h = createHarness();

      h.rect.cancelActiveSelection();

      expect(h.overlayRectangle.style.display).toBe('');
    });

    it('resets a selection built before prepare() without touching a missing overlay', () => {
      const bare = new RectangleSelection({
        config: {},
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      });

      expect(() => bare.endSelection()).not.toThrow();
    });
  });

  describe('overlay markup', () => {
    it('builds the three overlay layers with their full class lists and marker attributes', () => {
      const h = createHarness();

      expect([ ...h.overlay.classList ]).toEqual([
        'fixed',
        'inset-0',
        'z-overlay',
        'pointer-events-none',
        'overflow-hidden',
      ]);
      expect([ ...h.overlayContainer.classList ]).toEqual([
        'relative',
        'pointer-events-auto',
        'z-0',
      ]);
      expect([ ...h.overlayRectangle.classList ]).toEqual([
        'absolute',
        'pointer-events-none',
        'bg-selection-highlight',
        'border',
        'border-transparent',
      ]);

      expect(h.overlay.getAttribute('data-blok-overlay')).toBe('');
      expect(h.overlay.getAttribute('aria-hidden')).toBe('true');
      expect(h.overlayContainer.getAttribute('data-blok-overlay-container')).toBe('');
      expect(h.overlayRectangle.getAttribute('data-blok-overlay-rectangle')).toBe('');
    });

    it('refuses to prepare when the holder has no editor element, naming what is missing', () => {
      const rect = new RectangleSelection({
        config: {},
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      });

      instances.push(rect);

      const holder = document.createElement('div');

      document.body.appendChild(holder);

      rect.state = {
        UI: { nodes: { holder } },
      } as unknown as BlokModules;

      expect(() => rect.prepare()).toThrow('RectangleSelection: blok wrapper not found');
    });
  });

  describe('event bindings', () => {
    it('binds each gesture event on its own target with its own listener options', () => {
      const h = createHarness({ autoPrepare: false });
      const onBody = vi.spyOn(document.body, 'addEventListener');
      const onDocument = vi.spyOn(document, 'addEventListener');
      const onWindow = vi.spyOn(window, 'addEventListener');

      h.prepare();

      expect(onBody).toHaveBeenCalledWith('mousedown', expect.any(Function), false);
      expect(onBody).toHaveBeenCalledWith('mousemove', expect.any(Function), { passive: true });
      expect(onBody).toHaveBeenCalledWith('mouseleave', expect.any(Function), false);
      expect(onWindow).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
      expect(onDocument).toHaveBeenCalledWith('mouseup', expect.any(Function), false);
    });

    it('arms the lasso from a real mousedown in the editor gutter', () => {
      const h = createHarness();

      h.mouseDownAt(250, 500);

      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('drops the gesture when the pointer leaves the document body', () => {
      const h = createHarness();

      h.mouseDownAt(250, 500);
      h.mouseLeave();

      expect(h.rect.isRectActivated()).toBe(false);
    });

    it('drops the gesture on mouseup anywhere in the document', () => {
      const h = createHarness();

      h.mouseDownAt(250, 500);
      h.mouseUp();

      expect(h.rect.isRectActivated()).toBe(false);
    });
  });

  describe('startSelection — where a lasso may begin', () => {
    it('subtracts the page scroll before testing the editor vertical bounds', () => {
      const h = createHarness();

      h.rect.startSelection(250, 900);

      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('arms on the editor top edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(250, 160);

      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('arms on the editor bottom edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(250, 960);

      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('hit-tests the down point in viewport space, not page space', () => {
      const h = createHarness();

      /**
       * pageX 290 is the gutter once the 40px horizontal scroll is removed;
       * adding it instead lands on the row content, which refuses to lasso.
       */
      h.rect.startSelection(290, 300);

      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('stops when nothing at all sits under the down point', () => {
      const h = createHarness({
        pageBackdrop: false,
        backdrop: { left: 200,
          top: 400,
          right: 280,
          bottom: 480 },
      });

      expect(() => h.rect.startSelection(90, 500)).not.toThrow();
      expect(h.rect.isRectActivated()).toBe(false);
    });
  });

  describe('startSelection — deferring the toolbar close', () => {
    const firstMoveCloses = (h: Harness): number => {
      h.moveTo(660, 520);

      return h.toolbar.close.mock.calls.length;
    };

    it('closes once for the schedule and once for the drag, then once per later move', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);

      expect(firstMoveCloses(h)).toBe(2);

      h.releaseThrottle();
      h.moveTo(680, 540);

      expect(h.toolbar.close).toHaveBeenCalledTimes(3);
    });

    it('does not schedule a close for a drag started in the left page margin', () => {
      const h = createHarness();

      h.rect.startSelection(250, 500);

      expect(firstMoveCloses(h)).toBe(1);
    });

    it('does not schedule a close for a drag started in the right page margin', () => {
      const h = createHarness();

      h.rect.startSelection(990, 500);

      expect(firstMoveCloses(h)).toBe(1);
    });

    it('schedules a close on the content column left edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(340, 500);

      expect(firstMoveCloses(h)).toBe(2);
    });

    it('schedules a close on the content column right edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(940, 500);

      expect(firstMoveCloses(h)).toBe(2);
    });

    it('removes the horizontal scroll before testing the content column', () => {
      const h = createHarness();

      /** pageX 900 is inside the column at scrollX 40 and outside it at -40. */
      h.rect.startSelection(900, 500);

      expect(firstMoveCloses(h)).toBe(2);
    });
  });

  describe('startSelection — toolbar mousedowns over nested content', () => {
    const TOOLBAR_BOX: Box = { left: 210,
      top: 200,
      right: 290,
      bottom: 300 };

    const buildToolbar = (h: Harness, withNestedBlocks: boolean): void => {
      if (withNestedBlocks) {
        const nested = document.createElement('div');

        nested.setAttribute('data-blok-nested-blocks', '');
        document.body.appendChild(nested);
        h.register(TOOLBAR_BOX, nested);
      }

      const toolbarElement = document.createElement('div');
      const toolbarChild = document.createElement('div');

      toolbarElement.setAttribute('data-blok-toolbar', '');
      toolbarElement.appendChild(toolbarChild);
      document.body.appendChild(toolbarElement);
      h.register(TOOLBAR_BOX, toolbarChild);
    };

    it('refuses the lasso when a nested-blocks container sits under the toolbar', () => {
      const h = createHarness();

      buildToolbar(h, true);
      h.rect.startSelection(290, 300);

      expect(h.rect.isRectActivated()).toBe(false);
    });

    it('still lassos from a toolbar that hovers the page margin', () => {
      const h = createHarness();

      buildToolbar(h, false);
      h.rect.startSelection(290, 300);

      expect(h.rect.isRectActivated()).toBe(true);
    });
  });

  describe('endSelection', () => {
    it('forgets that the mouse went down inside the content bounds', () => {
      const h = createHarness();

      h.mouseDownAt(640, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(true);

      h.rect.endSelection();

      expect(h.rect.isMouseDownWithinBounds).toBe(false);
    });

    it('cancels a toolbar close that was scheduled but never dragged', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.rect.endSelection();
      h.moveTo(660, 520);

      expect(h.toolbar.close).not.toHaveBeenCalled();
    });

    it('empties the selected stack so the next drag deselects nothing', () => {
      const h = createHarness();

      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);
      h.mouseUp();

      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.releaseThrottle();

      /** Shift keeps startSelection from clearing the stack a second time. */
      h.rect.startSelection(250, 280, true);
      h.moveTo(940, 320);

      expect(h.blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();
    });
  });

  describe('cancelActiveSelection', () => {
    it('cancels a drag that is armed but has not moved', () => {
      const h = createHarness();

      h.rect.startSelection(250, 500);

      expect(h.rect.isRectActivated()).toBe(true);

      h.rect.cancelActiveSelection();

      expect(h.rect.isRectActivated()).toBe(false);
    });

    it('cancels a drag that is already painting a rectangle', () => {
      const h = createHarness();

      h.rect.startSelection(250, 500);
      h.moveTo(400, 520);

      h.rect.cancelActiveSelection();

      expect(h.rect.isRectActivated()).toBe(false);
    });
  });

  describe('mousedown that starts in editable text', () => {
    it('never arms the lasso', () => {
      const h = createHarness();

      h.mouseDownAt(250, 500, h.contentEditable);

      expect(h.rect.isRectActivated()).toBe(false);
    });

    it('records the press when it lands inside the content column', () => {
      const h = createHarness();

      h.mouseDownAt(640, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(true);
    });

    it('removes the horizontal scroll before the content-column test', () => {
      const h = createHarness();

      h.mouseDownAt(900, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(true);
    });

    it('ignores a press in the left page margin', () => {
      const h = createHarness();

      h.mouseDownAt(250, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(false);
    });

    it('ignores a press in the right page margin', () => {
      const h = createHarness();

      h.mouseDownAt(990, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(false);
    });

    it('records a press on the content column left edge exactly', () => {
      const h = createHarness();

      h.mouseDownAt(340, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(true);
    });

    it('records a press on the content column right edge exactly', () => {
      const h = createHarness();

      h.mouseDownAt(940, 500, h.contentEditable);

      expect(h.rect.isMouseDownWithinBounds).toBe(true);
    });

    it('closes the toolbar on the first drag out of the text', () => {
      const h = createHarness();

      h.mouseDownAt(640, 500, h.contentEditable);
      h.moveTo(660, 520);

      expect(h.toolbar.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('mousemove with no button held', () => {
    it('closes nothing and paints nothing', () => {
      const h = createHarness();

      h.moveTo(660, 520);

      expect(h.toolbar.close).not.toHaveBeenCalled();
      expect(h.rect.isRectActivated()).toBe(false);
    });
  });

  describe('scroll zones', () => {
    it('scrolls up on the exact top scroll-zone edge', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(660, 100);

      expect(h.scrollBy).toHaveBeenCalledWith(0, -3);
    });

    it('scrolls down on the exact bottom scroll-zone edge', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(660, 820);

      expect(h.scrollBy).toHaveBeenCalledWith(0, 3);
    });

    it('does not restart an auto-scroll that is already running', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(660, 100);

      /** Disarm the pending self-reschedule so the throttle can be released safely. */
      h.rect.endSelection();
      h.releaseThrottle();

      h.rect.startSelection(640, 500);

      /** The first scroll moved the page, so the same zone is now a different pageY. */
      h.moveToClientY(660, 97, 40);

      expect(h.scrollBy).toHaveBeenCalledTimes(1);
    });

    it('keeps scrolling on its own timer while the pointer stays in the zone', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(660, 100);

      vi.advanceTimersToNextTimer();

      expect(h.scrollBy).toHaveBeenCalledTimes(2);
    });

    it('carries the auto-scrolled distance into the rectangle redrawn by a page scroll', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(660, 100);
      h.scrollWindow();

      expect(h.overlayRectangle.style.left).toBe('576px');
      expect(h.overlayRectangle.style.width).toBe('20px');
      expect(h.overlayRectangle.style.top).toBe('22px');
      expect(h.overlayRectangle.style.height).toBe('403px');
    });
  });

  describe('rectangle painting', () => {
    it('spans the whole drag box in container-local coordinates', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);
      h.moveTo(760, 620);

      expect(h.overlayRectangle.style.left).toBe('576px');
      expect(h.overlayRectangle.style.top).toBe('422px');
      expect(h.overlayRectangle.style.width).toBe('120px');
      expect(h.overlayRectangle.style.height).toBe('120px');
    });

    it('falls back to the viewport origin when the rectangle has no container', () => {
      const h = createHarness();

      h.overlayRectangle.remove();
      h.rect.startSelection(640, 500);
      h.moveTo(760, 620);

      expect(h.overlayRectangle.style.left).toBe('600px');
      expect(h.overlayRectangle.style.top).toBe('440px');
    });

    it('reads the scroll offset off the document element when the window reports none', () => {
      const h = createHarness({ scrollSource: 'documentElement',
        scrollX: 80,
        scrollY: 120 });

      h.rect.startSelection(640, 500);
      h.moveTo(700, 560);

      expect(h.overlayRectangle.style.left).toBe('536px');
      expect(h.overlayRectangle.style.top).toBe('362px');
      expect(h.overlayRectangle.style.width).toBe('60px');
      expect(h.overlayRectangle.style.height).toBe('60px');
    });
  });

  describe('rows crossed horizontally by the band', () => {
    it('selects the row when the drag starts right of the editor and sweeps left', () => {
      const h = createHarness();

      h.rect.startSelection(1100, 280);
      h.moveTo(1000, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('selects the row when the drag starts left of the editor and sweeps right', () => {
      const h = createHarness();

      h.rect.startSelection(200, 280);
      h.moveTo(300, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('stops crossing once the band shrinks back past the editor left edge', () => {
      const h = createHarness();

      h.rect.startSelection(150, 280);
      h.moveTo(1000, 320);
      h.releaseThrottle();
      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.moveTo(200, 320);

      expect(h.blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();
    });

    it('keeps crossing while the band still reaches the editor gutter', () => {
      const h = createHarness();

      h.rect.startSelection(150, 280);
      h.moveTo(1000, 320);
      h.releaseThrottle();
      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.moveTo(300, 320);

      expect(h.blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();
    });

    it('crosses the row from a band drawn entirely inside the right gutter', () => {
      const h = createHarness();

      h.rect.startSelection(1000, 280);
      h.moveTo(1030, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('selects nothing from a straight-down drag in the left page margin', () => {
      const h = createHarness();

      h.rect.startSelection(100, 280);
      h.moveTo(100, 320);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('selects nothing from a straight-down drag in the right page margin', () => {
      const h = createHarness();

      h.rect.startSelection(1100, 280);
      h.moveTo(1100, 320);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('selects the row from a straight-down drag on the editor left edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(240, 280);
      h.moveTo(240, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('selects the row from a straight-down drag on the editor right edge exactly', () => {
      const h = createHarness();

      h.rect.startSelection(1040, 280);
      h.moveTo(1040, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });
  });

  describe('rows crossed vertically by the band', () => {
    it('selects exactly the one row the band spans, and asks no parent for it', () => {
      const h = createHarness();

      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
      expect(h.blockManager.getBlockById).not.toHaveBeenCalled();
    });

    it('selects all three rows a tall band spans', () => {
      const h = createHarness();

      h.rect.startSelection(250, 180);
      h.moveTo(940, 400);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ], [ 1 ], [ 2 ] ]);

      /** A root row has no parent to look up, so the ancestor walk must stop before asking. */
      expect(h.blockManager.getBlockById).not.toHaveBeenCalledWith(null);
    });

    it('leaves out the row whose bottom edge is exactly the band top', () => {
      const h = createHarness();

      h.rect.startSelection(250, 360);
      h.moveTo(940, 400);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 2 ] ]);
    });

    it('leaves out the row whose top edge is exactly the band bottom', () => {
      const h = createHarness();

      h.rect.startSelection(250, 310);
      h.moveTo(940, 380);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('never lassoes a collapsed row', () => {
      const h = createHarness({
        blocks: [
          { id: 'tall',
            holder: { left: 300,
              top: 200,
              right: 900,
              bottom: 300 } },
          { id: 'collapsed',
            holder: { left: 300,
              top: 250,
              right: 900,
              bottom: 250 } },
        ],
      });

      h.rect.startSelection(250, 270);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('does not reach a row when the band ends exactly on its left hit edge', () => {
      const h = createHarness();

      h.rect.startSelection(190, 280);
      h.moveTo(240, 320);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
      expect(h.blockManager.getBlockByIndex).not.toHaveBeenCalledWith(undefined);
    });

    it('does not reach a row when the band starts exactly on its right hit edge', () => {
      const h = createHarness();

      h.rect.startSelection(1040, 280);
      h.moveTo(1090, 320);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('reaches the row from a band drawn only in the right gutter', () => {
      const h = createHarness();

      h.rect.startSelection(960, 280);
      h.moveTo(1020, 320);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });
  });

  describe('rows joining and leaving the band', () => {
    it('deselects only the rows that left, in row order', () => {
      const h = createHarness();

      h.rect.startSelection(250, 180);
      h.moveTo(940, 400);
      h.releaseThrottle();
      h.blockSelection.selectBlockByIndex.mockClear();
      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.moveTo(940, 220);

      expect(h.blockSelection.unSelectBlockByIndex.mock.calls).toEqual([ [ 1 ], [ 2 ] ]);
      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('selects only the rows that joined', () => {
      const h = createHarness();

      h.rect.startSelection(250, 180);
      h.moveTo(940, 220);
      h.releaseThrottle();
      h.blockSelection.selectBlockByIndex.mockClear();
      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.moveTo(940, 400);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ], [ 2 ] ]);
      expect(h.blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();
    });

    it('re-issues nothing while the band holds still', () => {
      const h = createHarness();

      h.rect.startSelection(250, 180);
      h.moveTo(940, 400);
      h.releaseThrottle();
      h.blockSelection.selectBlockByIndex.mockClear();
      h.blockSelection.unSelectBlockByIndex.mockClear();
      h.moveTo(940, 400);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
      expect(h.blockSelection.unSelectBlockByIndex).not.toHaveBeenCalled();
    });
  });

  describe('the block under the probe point', () => {
    it('asks for no block index when nothing sits under the probe point', () => {
      const h = createHarness();

      h.blockManager.getBlockByChildNode.mockReturnValue(undefined);
      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);

      expect(h.blockManager.getBlockByIndex).not.toHaveBeenCalled();
    });

    it('does not hit-test a block when nothing at all is under the probe point', () => {
      const h = createHarness({
        pageBackdrop: false,
        backdrop: { left: 200,
          top: 400,
          right: 280,
          bottom: 480 },
      });

      h.rect.startSelection(250, 500);
      h.moveTo(260, 520);

      expect(h.blockManager.getBlockByChildNode).not.toHaveBeenCalled();
    });

    it('selects nothing when the row under the pointer is no longer in the block list', () => {
      const h = createHarness();
      const stray = document.createElement('div');

      stray.setAttribute('data-blok-element', '');
      h.blockManager.getBlockByChildNode.mockReturnValue({
        id: 'stray',
        parentId: null,
        holder: stray,
      } as unknown as BlockType);

      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('survives a row that disappears from the manager mid-drag', () => {
      const h = createHarness();

      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);
      h.releaseThrottle();
      h.blockManager.getBlockByIndex.mockReturnValue(undefined);
      h.moveTo(940, 320);

      expect(h.errors).toEqual([]);
      expect(h.rect.isRectActivated()).toBe(true);
    });

    it('drags on when the document has no live selection to clear', () => {
      const h = createHarness();

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);

      h.rect.startSelection(250, 280);
      h.moveTo(940, 320);

      expect(h.errors).toEqual([]);
      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });
  });

  describe('rows inside a tool-owned layout', () => {
    const COLUMN_LAYOUT: BlockSpec[] = [
      {
        id: 'col',
        name: 'column',
        holder: { left: 300,
          top: 200,
          right: 900,
          bottom: 400 },
        content: null,
        ownsChildren: true,
        isUnit: false,
        slot: { box: { left: 300,
          top: 200,
          right: 900,
          bottom: 400 } },
      },
      {
        id: 'tog',
        parentId: 'col',
        holder: { left: 500,
          top: 220,
          right: 700,
          bottom: 320 },
        content: { left: 500,
          top: 220,
          right: 700,
          bottom: 260 },
        slot: { box: { left: 520,
          top: 260,
          right: 700,
          bottom: 320 } },
      },
      {
        id: 'para',
        parentId: 'tog',
        holder: { left: 520,
          top: 260,
          right: 690,
          bottom: 320 },
        content: { left: 530,
          top: 260,
          right: 680,
          bottom: 320 },
      },
    ];

    it('does not reach a column row from the editor gutter beside the column', () => {
      const h = createHarness({ blocks: COLUMN_LAYOUT });

      h.rect.startSelection(250, 330);
      h.moveTo(300, 360);

      expect(h.blockSelection.selectBlockByIndex).not.toHaveBeenCalled();
    });

    it('reaches the column row once the band covers its own width', () => {
      const h = createHarness({ blocks: COLUMN_LAYOUT });

      h.rect.startSelection(250, 330);
      h.moveTo(590, 360);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ h.indexOf('para') ] ]);
    });
  });

  describe('a container and the rows it hosts', () => {
    const toggleLayout = (slotBox: Box, slotKind: SlotSpec['kind'] = 'plain'): BlockSpec[] => [
      {
        id: 'tog',
        holder: { left: 300,
          top: 200,
          right: 900,
          bottom: 400 },
        content: { left: 300,
          top: 200,
          right: 900,
          bottom: 240 },
        slot: { box: slotBox,
          kind: slotKind },
        hitHolder: true,
      },
      {
        id: 'kid',
        parentId: 'tog',
        holder: { left: 320,
          top: 250,
          right: 900,
          bottom: 300 },
      },
    ];

    const PLAIN_SLOT: Box = { left: 320,
      top: 250,
      right: 900,
      bottom: 400 };

    it('gives the row the band touches to the child, not to the container', () => {
      const h = createHarness({ blocks: toggleLayout(PLAIN_SLOT) });

      h.rect.startSelection(250, 320);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('treats a container line that ends exactly on the band top as untouched', () => {
      const h = createHarness({ blocks: toggleLayout(PLAIN_SLOT) });

      h.rect.startSelection(250, 310);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('keeps the container when the band only reaches its padding below the last child', () => {
      const h = createHarness({ blocks: toggleLayout(PLAIN_SLOT) });

      h.rect.startSelection(250, 400);
      h.moveTo(940, 440);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('treats a collapsed child slot as no slot at all', () => {
      const h = createHarness({
        blocks: toggleLayout({ left: 320,
          top: 250,
          right: 900,
          bottom: 250 }),
      });

      h.rect.startSelection(250, 320);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('ignores a table cell slot when measuring the container own line', () => {
      const h = createHarness({ blocks: toggleLayout(PLAIN_SLOT, 'cell') });

      h.rect.startSelection(250, 320);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('ignores a nested slot that belongs to a descendant block', () => {
      const h = createHarness({
        blocks: [
          {
            id: 'tog',
            holder: { left: 300,
              top: 200,
              right: 900,
              bottom: 400 },
            content: { left: 300,
              top: 200,
              right: 900,
              bottom: 240 },
            slot: { box: PLAIN_SLOT,
              insideDescendant: true },
            hitHolder: true,
          },
          {
            id: 'kid',
            parentId: 'tog',
            holder: { left: 320,
              top: 250,
              right: 900,
              bottom: 300 },
          },
        ],
      });

      h.rect.startSelection(250, 320);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });
  });

  describe('a container whose own line is its first child', () => {
    const calloutLayout = (options: {
      firstChild?: Box;
      kidHolder?: Box;
      kidInHolder?: boolean;
    } = {}): BlockSpec[] => [
      {
        id: 'callout',
        holder: { left: 300,
          top: 200,
          right: 900,
          bottom: 400 },
        content: { left: 300,
          top: 200,
          right: 900,
          bottom: 240 },
        slot: { box: { left: 320,
          top: 250,
          right: 900,
          bottom: 400 },
        kind: 'childToolbar',
        firstChild: options.firstChild },
        hitHolder: true,
      },
      {
        id: 'kid',
        parentId: 'callout',
        holder: options.kidHolder ?? { left: 320,
          top: 260,
          right: 900,
          bottom: 300 },
        mountInParentHolder: options.kidInHolder,
      },
    ];

    it('keeps the container when the band covers the line the container renders itself', () => {
      const h = createHarness({ blocks: calloutLayout() });

      h.rect.startSelection(250, 330);
      h.moveTo(940, 350);

      expect(h.errors).toEqual([]);
      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('falls back to the slot box when the child slot holds no block', () => {
      const h = createHarness({ blocks: calloutLayout({ kidInHolder: true }) });

      h.rect.startSelection(250, 330);
      h.moveTo(940, 350);

      expect(h.errors).toEqual([]);
      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('falls back to the slot box when the first child has collapsed to nothing', () => {
      const h = createHarness({
        blocks: calloutLayout({
          firstChild: { left: 320,
            top: 270,
            right: 900,
            bottom: 270 },
        }),
      });

      h.rect.startSelection(250, 320);
      h.moveTo(940, 350);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });

    it('treats a container line that starts exactly on the band bottom as untouched', () => {
      const h = createHarness({
        blocks: calloutLayout({
          firstChild: { left: 320,
            top: 300,
            right: 900,
            bottom: 340 },
          kidHolder: { left: 320,
            top: 210,
            right: 900,
            bottom: 260 },
          kidInHolder: true,
        }),
      });

      h.rect.startSelection(250, 270);
      h.moveTo(940, 360);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 1 ] ]);
    });
  });

  describe('walking the parent chain', () => {
    it('does not treat a row with a missing parent as anyone descendant', () => {
      const h = createHarness({
        blocks: [
          { id: 'a',
            holder: B0 },
          { id: 'orphan',
            parentId: 'ghost',
            holder: B1,
            mountRoot: true },
        ],
      });

      h.rect.startSelection(250, 180);
      h.moveTo(940, 360);

      expect(h.errors).toEqual([]);
      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ], [ 1 ] ]);
    });

    it('drops a grandchild the outermost container already represents', () => {
      const h = createHarness({
        blocks: [
          {
            id: 'tog',
            holder: { left: 300,
              top: 200,
              right: 900,
              bottom: 400 },
            content: { left: 300,
              top: 200,
              right: 900,
              bottom: 240 },
            slot: { box: { left: 320,
              top: 250,
              right: 900,
              bottom: 400 } },
          },
          {
            id: 'mid',
            parentId: 'tog',
            holder: { left: 320,
              top: 250,
              right: 900,
              bottom: 350 },
            content: { left: 320,
              top: 250,
              right: 900,
              bottom: 290 },
            slot: { box: { left: 330,
              top: 290,
              right: 900,
              bottom: 350 } },
          },
          {
            id: 'leaf',
            parentId: 'mid',
            holder: { left: 330,
              top: 290,
              right: 890,
              bottom: 340 },
          },
        ],
      });

      h.rect.startSelection(250, 270);
      h.moveTo(940, 400);

      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ] ]);
    });

    it('stops walking a parent chain that loops back on itself', () => {
      const h = createHarness({
        blocks: [
          /**
           * ownsChildren keeps rowHitBounds off the loop, which has no guard of
           * its own; the walk under test is the one in isDescendantOf.
           */
          { id: 'a',
            parentId: 'b',
            holder: B0,
            ownsChildren: true,
            mountRoot: true },
          { id: 'b',
            parentId: 'a',
            holder: B1,
            ownsChildren: true,
            mountRoot: true },
          { id: 'c',
            holder: B2 },
        ],
      });

      h.rect.startSelection(250, 180);
      h.moveTo(940, 400);

      expect(h.errors).toEqual([]);
      expect(h.blockSelection.selectBlockByIndex.mock.calls).toEqual([ [ 0 ], [ 2 ] ]);
    });
  });

  describe('a drag whose overlay rectangle is missing', () => {
    it('drops the move instead of dereferencing the rectangle it no longer has', () => {
      const h = createHarness();

      h.rect.startSelection(640, 500);

      /**
       * prepare() is the only thing that gives the module a rectangle, so the
       * missing-overlay state has to be installed on the field directly.
       */
      Reflect.set(h.rect, 'overlayRectangle', null);

      h.moveTo(700, 560);

      expect(h.errors).toEqual([]);
      expect(h.rect.isRectActivated()).toBe(true);
      expect(h.overlayRectangle.style.display).toBe('');
    });
  });

  describe('the scroll fallback when the document has no element tree', () => {
    it('reads a zero offset instead of dereferencing the missing document parts', () => {
      const h = createHarness({ scrollSource: 'documentElement' });

      hideDocumentPart('documentElement');
      hideDocumentPart('body');

      h.rect.startSelection(640, 500);

      expect(h.errors).toEqual([]);
      expect(h.rect.isRectActivated()).toBe(true);

      expect(h.overlayRectangle.style.left).toBe('');
    });
  });
});
