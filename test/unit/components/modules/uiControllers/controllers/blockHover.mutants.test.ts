import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../../src/components/events';
import { BlockHoverController } from '../../../../../../src/components/modules/uiControllers/controllers/blockHover';
import type { EventsDispatcher } from '../../../../../../src/components/utils/events';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mirrors the module's own throttle window. Every handler call in this file is
 * preceded by an advance of at least this much so the throttle takes the
 * leading edge and one call means exactly one handler run.
 */
const THROTTLE_MS = 20;

/** Mirrors BlockHoverController.HOVER_COOLDOWN_MS. */
const COOLDOWN_MS = 50;

const START_TIME = 1_000;

interface RectSpec {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width?: number;
  height?: number;
}

interface HoverPayload {
  block: Block;
  target?: Element;
}

type EmitMock = Mock<(eventName: string, payload: HoverPayload) => void>;

interface ToolbarMock {
  opened: boolean;
  close: Mock<() => void>;
  toolbox: { opened: boolean };
}

interface Editor {
  controller: BlockHoverController;
  wrapper: HTMLElement;
  listener: (event: Event) => void;
  emit: EmitMock;
  blocks: Block[];
  Toolbar: ToolbarMock;
  BlockSettings: { opened: boolean; isOpening: boolean };
  InlineToolbar: { opened: boolean };
  DragManager: { isDragging: boolean };
  addBlock: (options: BlockOptions) => { block: Block; holder: HTMLElement };
}

interface EditorOptions {
  /** false leaves `wrapperElement` null, the state of an editor that never mounted. */
  withWrapper?: boolean;
  wrapperRect?: RectSpec;
  parent?: HTMLElement;
}

interface BlockOptions {
  id: string;
  name?: string;
  parent?: HTMLElement;
  holderRect?: RectSpec;
  /** null builds a holder with no `[data-blok-element-content]` child. */
  contentRect?: RectSpec | null;
}

const DEFAULT_HOLDER_RECT: RectSpec = { top: 0, bottom: 20, left: 0, right: 100 };
const DEFAULT_CONTENT_RECT: RectSpec = { top: 0, bottom: 20, left: 0, right: 100 };

/**
 * jsdom runs no layout, so every rect is all-zeros until it is stubbed. The
 * numbers here are free-standing fixtures: a holder rect and its content rect
 * are stubbed independently and need not describe a physically possible box.
 * @param element - element whose box is being faked
 * @param spec - the box to report
 */
const setRect = (element: HTMLElement, spec: RectSpec): void => {
  const rect = {
    ...spec,
    width: spec.width ?? spec.right - spec.left,
    height: spec.height ?? spec.bottom - spec.top,
    x: spec.left,
    y: spec.top,
    toJSON: () => ({}),
  };

  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => rect,
    configurable: true,
  });
};

/**
 * A bare block-wrapper element with no Block behind it, used to add depth
 * between a container and its child.
 * @param parent - element to append the wrapper to
 */
const appendWrapperElement = (parent: HTMLElement): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute('data-blok-testid', 'block-wrapper');
  parent.appendChild(element);

  return element;
};

/**
 * A child-hosting container element (table cell slot or toggle children slot).
 * @param parent - element to append the container to
 * @param attribute - the container's marker attribute
 */
const appendContainer = (parent: HTMLElement, attribute: string): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute(attribute, '');
  parent.appendChild(element);

  return element;
};

/**
 * Five mutants in this file are equivalent — no input can tell them from the
 * original, so no test is written for them.
 *
 * 1. `blockHoveredState = {}` (line 33). The only reads of
 *    `lastHoveredBlockId` compare it with `===` against a block id, which is
 *    always a string: a missing key yields `undefined` and the initialiser
 *    yields `null`, and both are unequal to every string. Nothing tests the
 *    key for presence, and every write puts back a string or `null`.
 *
 * 2. `resolution.kind === 'block' ? ... : null` forced to `true` (line 161).
 *    `HoveredBlockResolution` has three kinds and `'keep'` has already
 *    returned four lines above, so the ternary only ever sees `'block'` or
 *    `'none'`. For `'none'` the mutant yields `resolution.wrapper`, which is
 *    `undefined` on that variant, and `!hoveredBlockElement` takes the same
 *    branch as `null` did.
 *
 * 3. `depthDelta > 0` widened to `>=` (line 346). The two differ only at
 *    `depthDelta === 0`, and the `if (depthDelta !== 0)` guard on the line
 *    above returns before that value can reach the comparison.
 *
 * 4. `controller !== this` forced to `true` (line 392). Reaching the loop
 *    implies the early return above did not fire, i.e.
 *    `this.wrapperElement?.contains(element) !== true`. So on the iteration
 *    where `controller === this`, the second operand of the `&&` is exactly
 *    that false value, and widening the first operand cannot change the `&&`.
 *
 * 5. `index > ownIndex` widened to `>=` (line 430). The two differ only at
 *    `index === ownIndex`, which the guard on line 424 has already turned
 *    into an early `true`.
 *
 */
describe('BlockHoverController mutants', () => {
  let addEventListenerSpy: MockInstance<typeof document.addEventListener>;
  let removeEventListenerSpy: MockInstance<typeof document.removeEventListener>;
  let editors: Editor[] = [];

  /**
   * Every mousemove listener the controllers registered on `document`, in
   * registration order, with the options object they were registered with.
   */
  const mousemoveRegistrations = (): Array<{
    handler: (event: Event) => void;
    options: AddEventListenerOptions | boolean | undefined;
  }> => {
    const found: Array<{
      handler: (event: Event) => void;
      options: AddEventListenerOptions | boolean | undefined;
    }> = [];

    for (const call of addEventListenerSpy.mock.calls) {
      const [type, callback, options] = call;

      if (type !== 'mousemove' || typeof callback !== 'function') {
        continue;
      }

      found.push({ handler: callback, options });
    }

    return found;
  };

  /** Handlers passed to `document.removeEventListener` for 'mousemove'. */
  const mousemoveRemovals = (): Array<(event: Event) => void> => {
    const found: Array<(event: Event) => void> = [];

    for (const call of removeEventListenerSpy.mock.calls) {
      const [type, callback] = call;

      if (type !== 'mousemove' || typeof callback !== 'function') {
        continue;
      }

      found.push(callback);
    }

    return found;
  };

  const createEditor = ({
    withWrapper = true,
    wrapperRect,
    parent,
  }: EditorOptions = {}): Editor => {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-editor', '');
    (parent ?? document.body).appendChild(wrapper);

    if (wrapperRect !== undefined) {
      setRect(wrapper, wrapperRect);
    }

    const emit: EmitMock = vi.fn();
    const blocks: Block[] = [];
    const Toolbar: ToolbarMock = {
      opened: false,
      close: vi.fn<() => void>(),
      toolbox: { opened: false },
    };
    const BlockSettings = { opened: false, isOpening: false };
    const InlineToolbar = { opened: false };
    const DragManager = { isDragging: false };

    const controller = new BlockHoverController({
      config: {},
      eventsDispatcher: { emit } as unknown as EventsDispatcher<BlokEventMap>,
    });

    controller.state = {
      BlockManager: {
        blocks,
        getBlockByChildNode: (node: Node): Block | undefined =>
          blocks.find(block => block.holder === node),
      } as unknown as BlokModules['BlockManager'],
      Toolbar: Toolbar as unknown as BlokModules['Toolbar'],
      BlockSettings: BlockSettings as unknown as BlokModules['BlockSettings'],
      InlineToolbar: InlineToolbar as unknown as BlokModules['InlineToolbar'],
      DragManager: DragManager as unknown as BlokModules['DragManager'],
    } as unknown as BlokModules;

    if (withWrapper) {
      controller.setWrapperElement(wrapper);
    }

    const registrationsBefore = mousemoveRegistrations().length;

    controller.enable();

    const registrations = mousemoveRegistrations();
    const registration = registrations[registrationsBefore];

    const addBlock = ({
      id,
      name = 'paragraph',
      parent: blockParent,
      holderRect = DEFAULT_HOLDER_RECT,
      contentRect = DEFAULT_CONTENT_RECT,
    }: BlockOptions): { block: Block; holder: HTMLElement } => {
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-testid', 'block-wrapper');
      setRect(holder, holderRect);
      (blockParent ?? wrapper).appendChild(holder);

      if (contentRect !== null) {
        const content = document.createElement('div');

        content.setAttribute('data-blok-element-content', '');
        setRect(content, contentRect);
        holder.appendChild(content);
      }

      const block = { id, name, holder } as unknown as Block;

      blocks.push(block);

      return { block, holder };
    };

    const editor: Editor = {
      controller,
      wrapper,
      listener: registration === undefined ? () => undefined : registration.handler,
      emit,
      blocks,
      Toolbar,
      BlockSettings,
      InlineToolbar,
      DragManager,
      addBlock,
    };

    editors.push(editor);

    return editor;
  };

  /**
   * Builds a mousemove whose `target` is set by hand. A never-dispatched event
   * has a null target, which is exactly the input the handler's optional
   * chaining exists for.
   * @param point - pointer client coordinates
   * @param target - element to report as the event target, omitted for none
   */
  const mousemoveAt = (
    point: { x: number; y: number },
    target?: EventTarget
  ): MouseEvent => {
    const event = new MouseEvent('mousemove', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
    });

    if (target !== undefined) {
      Object.defineProperty(event, 'target', { value: target, configurable: true });
    }

    return event;
  };

  /**
   * Runs one handler pass: the advance takes the throttle past its window so
   * the call lands on the leading edge and runs exactly once.
   * @param editor - the editor whose document listener to drive
   * @param event - event to hand the listener
   */
  const fire = (editor: Editor, event: Event): void => {
    vi.advanceTimersByTime(THROTTLE_MS);
    editor.listener(event);
  };

  /** Block ids in the exact order BlockHovered was emitted for them. */
  const emittedBlockIds = (emit: EmitMock): string[] =>
    emit.mock.calls.map(call => call[1].block.id);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME);
    editors = [];
    addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    // Recorded first: a mutant that drops `super.disable()` leaves the listener
    // bound, and restoring the spy would lose the record needed to unbind it.
    for (const registration of mousemoveRegistrations()) {
      document.removeEventListener('mousemove', registration.handler, registration.options);
    }

    for (const editor of editors) {
      editor.controller.disable();
    }

    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('enable / disable', () => {
    it('binds one passive document mousemove listener however often enable() is called', () => {
      const editor = createEditor();

      editor.controller.enable();
      editor.controller.enable();

      expect(mousemoveRegistrations().map(registration => registration.options)).toStrictEqual([
        { passive: true },
      ]);
    });

    it('unbinds on disable() and binds a fresh listener on the next enable()', () => {
      const editor = createEditor();

      editor.controller.disable();

      expect(mousemoveRemovals()).toStrictEqual([editor.listener]);

      editor.controller.enable();

      expect(mousemoveRegistrations()).toHaveLength(2);
    });
  });

  describe('event guards', () => {
    it('ignores a mousemove that is not a MouseEvent', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({ id: 'b1' });
      const event = new Event('mousemove');

      Object.defineProperty(event, 'target', { value: holder, configurable: true });

      fire(editor, event);

      expect(emittedBlockIds(editor.emit)).toStrictEqual([]);
    });

    it('stands down on a page whose global MouseEvent is missing', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({ id: 'b1' });
      const event = mousemoveAt({ x: 50, y: 10 }, holder);

      // The event has to exist before the constructor is taken away.
      vi.stubGlobal('MouseEvent', undefined);

      expect(() => fire(editor, event)).not.toThrow();
      expect(emittedBlockIds(editor.emit)).toStrictEqual([]);
    });

    it('suppresses hover for the cooldown window and resumes at its exact end', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({ id: 'b1' });

      editor.controller.disableHoverForCooldown();

      vi.advanceTimersByTime(THROTTLE_MS);
      editor.listener(mousemoveAt({ x: 50, y: 10 }, holder));

      expect(emittedBlockIds(editor.emit)).toStrictEqual([]);

      // START_TIME + COOLDOWN_MS is the first instant hover is allowed again.
      vi.advanceTimersByTime(COOLDOWN_MS - THROTTLE_MS);
      expect(Date.now()).toBe(START_TIME + COOLDOWN_MS);
      editor.listener(mousemoveAt({ x: 50, y: 10 }, holder));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['b1']);
    });

    it('falls through to nearest-block detection when the event has no target', () => {
      const editor = createEditor();
      const { block, holder } = editor.addBlock({ id: 'b1' });

      const event = mousemoveAt({ x: 50, y: 10 });

      expect(() => fire(editor, event)).not.toThrow();
      expect(emittedBlockIds(editor.emit)).toStrictEqual(['b1']);
      expect(editor.emit.mock.calls[0][1].target).toBe(holder);
      expect(editor.emit.mock.calls[0][1].block).toBe(block);
    });
  });

  describe('nearest-block detection', () => {
    it('emits nothing and does not throw when every block has a zero-size rect', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 0, left: 0, right: 0 },
      });

      expect(() => fire(editor, mousemoveAt({ x: 50, y: 10 }))).not.toThrow();
      expect(emittedBlockIds(editor.emit)).toStrictEqual([]);
    });

    it('anchors the hover zone on the first block that is neither a column nor nested', () => {
      const editor = createEditor();
      const toggleChildren = appendContainer(editor.wrapper, 'data-blok-toggle-children');

      editor.addBlock({
        id: 'column',
        name: 'column',
        holderRect: { top: 5000, bottom: 5020, left: 1000, right: 1100 },
        contentRect: { top: 5000, bottom: 5020, left: 1000, right: 1100 },
      });
      editor.addBlock({
        id: 'nested',
        parent: toggleChildren,
        holderRect: { top: 5000, bottom: 5020, left: 1000, right: 1100 },
        contentRect: { top: 5000, bottom: 5020, left: 1000, right: 1100 },
      });
      editor.addBlock({
        id: 'top',
        holderRect: { top: 0, bottom: 20, left: 200, right: 400 },
        contentRect: { top: 0, bottom: 20, left: 200, right: 400 },
      });

      fire(editor, mousemoveAt({ x: 300, y: 10 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['top']);
    });

    it('hovers at the exact left edge of the zone', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 20, left: 200, right: 400 },
        contentRect: { top: 0, bottom: 20, left: 200, right: 400 },
      });

      fire(editor, mousemoveAt({ x: 100, y: 10 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['b1']);
    });

    it('hovers at the exact right edge of the zone', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 20, left: 200, right: 400 },
        contentRect: { top: 0, bottom: 20, left: 200, right: 400 },
      });

      fire(editor, mousemoveAt({ x: 500, y: 10 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['b1']);
    });

    it('ignores a pointer left of the zone', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 20, left: 200, right: 400 },
        contentRect: { top: 0, bottom: 20, left: 200, right: 400 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 10 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual([]);
    });

    it('skips table-cell blocks when picking the nearest block', () => {
      const editor = createEditor();
      const cellBlocks = appendContainer(editor.wrapper, 'data-blok-table-cell-blocks');

      editor.addBlock({ id: 'normal' });
      editor.addBlock({
        id: 'cell',
        parent: cellBlocks,
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['normal']);
    });

    it('skips zero-width and zero-height blocks when picking the nearest block', () => {
      const editor = createEditor();

      editor.addBlock({ id: 'normal' });
      editor.addBlock({
        id: 'zero-width',
        holderRect: { top: 100, bottom: 200, left: 50, right: 50 },
      });
      editor.addBlock({
        id: 'zero-height',
        holderRect: { top: 100, bottom: 200, left: 0, right: 60, height: 0 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['normal']);
    });

    it('treats a block whose top equals the pointer as being on its line', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({
        id: 'outer',
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      editor.addBlock({
        id: 'inner',
        parent: holder,
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 100 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['inner']);
    });

    it('treats a block whose bottom equals the pointer as being on its line', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({
        id: 'outer',
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      editor.addBlock({
        id: 'inner',
        parent: holder,
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 200 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['inner']);
    });

    it('does not put a block below the pointer on the pointer line', () => {
      const editor = createEditor();
      const { holder } = editor.addBlock({
        id: 'outer',
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });

      editor.addBlock({
        id: 'inner',
        parent: holder,
        holderRect: { top: 300, bottom: 400, left: 0, right: 100 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 0 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['outer']);
    });

    it('keeps the deeper block when a shallower one shares its line', () => {
      const editor = createEditor();
      const shallowHolder = document.createElement('div');

      shallowHolder.setAttribute('data-blok-testid', 'block-wrapper');
      setRect(shallowHolder, { top: 100, bottom: 200, left: 0, right: 100 });
      editor.wrapper.appendChild(shallowHolder);

      const deep = editor.addBlock({
        id: 'deep',
        parent: shallowHolder,
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });
      const shallowContent = document.createElement('div');

      shallowContent.setAttribute('data-blok-element-content', '');
      setRect(shallowContent, { top: 100, bottom: 200, left: 0, right: 100 });
      shallowHolder.appendChild(shallowContent);

      const shallow = { id: 'shallow', name: 'paragraph', holder: shallowHolder } as unknown as Block;

      editor.blocks.push(shallow);

      expect(editor.blocks.map(block => block.id)).toStrictEqual(['deep', 'shallow']);
      expect(deep.block.id).toBe('deep');

      fire(editor, mousemoveAt({ x: 50, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['deep']);
    });

    it('falls back to horizontal distance for equally deep blocks on one line', () => {
      const editor = createEditor();
      const parentWrapper = appendWrapperElement(editor.wrapper);

      editor.addBlock({
        id: 'left',
        parent: parentWrapper,
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
        contentRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });
      editor.addBlock({
        id: 'right',
        parent: parentWrapper,
        holderRect: { top: 100, bottom: 200, left: 500, right: 600 },
        contentRect: { top: 100, bottom: 200, left: 500, right: 600 },
      });

      fire(editor, mousemoveAt({ x: 10, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['left']);
    });

    it('picks the horizontally nearer of two equally deep blocks on one line', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'under-pointer',
        holderRect: { top: 100, bottom: 200, left: 100, right: 200 },
        contentRect: { top: 100, bottom: 200, left: 100, right: 200 },
      });
      editor.addBlock({
        id: 'aside',
        holderRect: { top: 100, bottom: 200, left: 0, right: 50 },
        contentRect: { top: 100, bottom: 200, left: 0, right: 50 },
      });

      fire(editor, mousemoveAt({ x: 100, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['under-pointer']);
    });

    it('keeps the first of two equally distant blocks on one line', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'wide',
        holderRect: { top: 100, bottom: 200, left: 0, right: 200 },
        contentRect: { top: 100, bottom: 200, left: 0, right: 200 },
      });
      editor.addBlock({
        id: 'narrow',
        holderRect: { top: 100, bottom: 200, left: 50, right: 150 },
        contentRect: { top: 100, bottom: 200, left: 50, right: 150 },
      });

      fire(editor, mousemoveAt({ x: 100, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['wide']);
    });

    it('keeps the first of two equally distant blocks off the pointer line', () => {
      const editor = createEditor();

      editor.addBlock({
        id: 'below',
        holderRect: { top: 200, bottom: 300, left: 0, right: 100 },
        contentRect: { top: 200, bottom: 300, left: 0, right: 100 },
      });
      editor.addBlock({
        id: 'above',
        holderRect: { top: -100, bottom: 0, left: 0, right: 100 },
        contentRect: { top: -100, bottom: 0, left: 0, right: 100 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 100 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['below']);
    });

    it('counts every wrapper ancestor when measuring depth', () => {
      const editor = createEditor();
      const outer = editor.addBlock({
        id: 'outer',
        holderRect: { top: 100, bottom: 200, left: 0, right: 100 },
        contentRect: { top: 100, bottom: 200, left: 0, right: 100 },
      });
      const middle = appendWrapperElement(outer.holder);

      editor.addBlock({
        id: 'grandchild',
        parent: middle,
        holderRect: { top: 100, bottom: 200, left: 500, right: 600 },
        contentRect: { top: 100, bottom: 200, left: 500, right: 600 },
      });

      fire(editor, mousemoveAt({ x: 50, y: 150 }));

      expect(emittedBlockIds(editor.emit)).toStrictEqual(['grandchild']);
    });
  });

  describe('arbitration between editors on one page', () => {
    it('keeps hover in the inner editor when its block is also inside the outer one', () => {
      const outer = createEditor();
      const inner = createEditor({ parent: outer.wrapper });
      const { holder } = inner.addBlock({ id: 'inner-block' });

      expect(outer.wrapper.contains(holder)).toBe(true);

      fire(inner, mousemoveAt({ x: 50, y: 10 }, holder));

      expect(emittedBlockIds(inner.emit)).toStrictEqual(['inner-block']);
    });

    it('answers a block that belongs to no editor on the page', () => {
      const first = createEditor();

      createEditor();

      const { holder } = first.addBlock({ id: 'loose', parent: document.body });

      expect(first.wrapper.contains(holder)).toBe(false);

      fire(first, mousemoveAt({ x: 50, y: 10 }, holder));

      expect(emittedBlockIds(first.emit)).toStrictEqual(['loose']);
    });

    it('tolerates a registered editor that never mounted a wrapper', () => {
      const first = createEditor();

      createEditor({ withWrapper: false });

      const { holder } = first.addBlock({ id: 'loose', parent: document.body });

      expect(() => fire(first, mousemoveAt({ x: 50, y: 10 }, holder))).not.toThrow();
      expect(emittedBlockIds(first.emit)).toStrictEqual(['loose']);
    });

    it('runs nearest detection past a registered editor that never mounted a wrapper', () => {
      const first = createEditor({ wrapperRect: { top: 0, bottom: 100, left: 0, right: 100 } });

      createEditor({ withWrapper: false });

      first.addBlock({ id: 'b1' });

      expect(() => fire(first, mousemoveAt({ x: 50, y: 10 }))).not.toThrow();
      expect(emittedBlockIds(first.emit)).toStrictEqual(['b1']);
    });

    it('runs nearest detection for an editor that never mounted a wrapper itself', () => {
      const unmounted = createEditor({ withWrapper: false });

      createEditor({ wrapperRect: { top: 0, bottom: 100, left: 0, right: 100 } });

      unmounted.addBlock({ id: 'b1' });

      expect(() => fire(unmounted, mousemoveAt({ x: 50, y: 10 }))).not.toThrow();
      expect(emittedBlockIds(unmounted.emit)).toStrictEqual(['b1']);
    });

    it('still answers a trailing event after it left the registry', () => {
      // A throttled mousemove can fire after disable(): the DOM listener is
      // gone but the pending trailing call still reaches the same handler.
      const first = createEditor({ wrapperRect: { top: 0, bottom: 100, left: 1000, right: 1100 } });

      createEditor({ wrapperRect: { top: 0, bottom: 100, left: 0, right: 100 } });

      first.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 100, left: 0, right: 100 },
        contentRect: { top: 0, bottom: 100, left: 0, right: 100 },
      });

      first.controller.disable();

      fire(first, mousemoveAt({ x: 50, y: 50 }));

      expect(emittedBlockIds(first.emit)).toStrictEqual(['b1']);
    });

    it('yields gutter hover to the editor nearer the pointer', () => {
      const far = createEditor({ wrapperRect: { top: 0, bottom: 100, left: 1000, right: 1100 } });

      createEditor({ wrapperRect: { top: 0, bottom: 100, left: 0, right: 100 } });

      far.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 100, left: 0, right: 100 },
        contentRect: { top: 0, bottom: 100, left: 0, right: 100 },
      });

      fire(far, mousemoveAt({ x: 50, y: 50 }));

      expect(emittedBlockIds(far.emit)).toStrictEqual([]);
    });

    it('measures the horizontal gap to an editor from its near edge', () => {
      const near = createEditor({ wrapperRect: { top: 0, bottom: 10, left: 100, right: 1000 } });

      createEditor({ wrapperRect: { top: 0, bottom: 10, left: 200, right: 300 } });

      near.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 100, left: 0, right: 100 },
        contentRect: { top: 0, bottom: 100, left: 0, right: 100 },
      });

      fire(near, mousemoveAt({ x: 0, y: 0 }));

      expect(emittedBlockIds(near.emit)).toStrictEqual(['b1']);
    });

    it('measures the vertical gap to an editor from its near edge', () => {
      const near = createEditor({ wrapperRect: { top: 100, bottom: 1000, left: 0, right: 10 } });

      createEditor({ wrapperRect: { top: 200, bottom: 300, left: 0, right: 10 } });

      near.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 100, left: 0, right: 100 },
        contentRect: { top: 0, bottom: 100, left: 0, right: 100 },
      });

      fire(near, mousemoveAt({ x: 0, y: 0 }));

      expect(emittedBlockIds(near.emit)).toStrictEqual(['b1']);
    });

    it('reports zero horizontal gap for a pointer inside an editor box', () => {
      const around = createEditor({ wrapperRect: { top: 0, bottom: 100, left: 0, right: 1000 } });

      createEditor({ wrapperRect: { top: 0, bottom: 100, left: -1000, right: 100 } });

      around.addBlock({
        id: 'b1',
        holderRect: { top: 0, bottom: 100, left: 400, right: 600 },
        contentRect: { top: 0, bottom: 100, left: 400, right: 600 },
      });

      fire(around, mousemoveAt({ x: 500, y: 50 }));

      expect(emittedBlockIds(around.emit)).toStrictEqual(['b1']);
    });

    it('reports zero vertical gap for a pointer inside an editor box', () => {
      const around = createEditor({ wrapperRect: { top: 0, bottom: 1000, left: 0, right: 100 } });

      createEditor({ wrapperRect: { top: -1000, bottom: 100, left: 0, right: 100 } });

      around.addBlock({
        id: 'b1',
        holderRect: { top: 400, bottom: 600, left: 0, right: 100 },
        contentRect: { top: 400, bottom: 600, left: 0, right: 100 },
      });

      fire(around, mousemoveAt({ x: 50, y: 500 }));

      expect(emittedBlockIds(around.emit)).toStrictEqual(['b1']);
    });
  });

  describe('yielding hover', () => {
    it('leaves a closed toolbar alone', () => {
      const first = createEditor();
      const second = createEditor();
      const { holder } = second.addBlock({ id: 'other-block' });

      first.Toolbar.opened = false;

      fire(first, mousemoveAt({ x: 50, y: 10 }, holder));

      expect(first.Toolbar.close.mock.calls).toStrictEqual([]);
      expect(emittedBlockIds(first.emit)).toStrictEqual([]);
    });

    it('leaves an open toolbar alone while its toolbox is open', () => {
      const first = createEditor();
      const second = createEditor();
      const { holder } = second.addBlock({ id: 'other-block' });

      first.Toolbar.opened = true;
      first.Toolbar.toolbox.opened = true;

      fire(first, mousemoveAt({ x: 50, y: 10 }, holder));

      expect(first.Toolbar.close.mock.calls).toStrictEqual([]);
    });
  });
});
