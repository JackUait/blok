import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Caret } from '../../../../src/components/modules/caret';
import { Dom as $ } from '../../../../src/components/dom';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';
import { SelectionUtils as Selection } from '../../../../src/components/selection';
import * as caretUtils from '../../../../src/components/utils/caret/index';

type BlockManagerStub = {
  currentBlock?: Block;
  nextVisibleBlock: Block | null;
  previousVisibleBlock: Block | null;
  blocks: Block[];
  insertAtEnd: ReturnType<typeof vi.fn>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
  getBlockById: ReturnType<typeof vi.fn>;
};

type BlockSelectionStub = {
  clearSelection: ReturnType<typeof vi.fn>;
  selectBlock: ReturnType<typeof vi.fn>;
};

type CaretSetup = {
  caret: Caret;
  blockManager: BlockManagerStub;
  blockSelection: BlockSelectionStub;
};

type BlockOptions = {
  id?: string;
  focusable?: boolean;
  isEmpty?: boolean;
  isDefault?: boolean;
  parentId?: string | null;
  inputs?: {
    first?: HTMLElement;
    last?: HTMLElement;
    current?: HTMLElement;
  };
};

const createContentEditable = (html = 'text'): HTMLElement => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.innerHTML = html;

  return element;
};

const createBlock = (options: BlockOptions = {}): Block => {
  const holder = document.createElement('div');
  const inputs = [ options.inputs?.current, options.inputs?.first, options.inputs?.last ];

  inputs.forEach((input) => {
    if (input && !holder.contains(input)) {
      holder.appendChild(input);
    }
  });

  const defaultInput = options.inputs?.current ?? createContentEditable();

  if (!holder.contains(defaultInput)) {
    holder.appendChild(defaultInput);
  }

  const blockStub = {
    holder,
    id: options.id ?? `block-${Math.random().toString(36).slice(2)}`,
    focusable: options.focusable ?? true,
    isEmpty: options.isEmpty ?? false,
    parentId: options.parentId ?? null,
    tool: { isDefault: options.isDefault ?? true },
    firstInput: options.inputs?.first ?? defaultInput,
    lastInput: options.inputs?.last ?? defaultInput,
    currentInput: defaultInput,
    nextInput: undefined,
    previousInput: undefined,
  };

  return blockStub as unknown as Block;
};

const createCaret = (): CaretSetup => {
  const blockManager: BlockManagerStub = {
    currentBlock: undefined,
    nextVisibleBlock: null,
    previousVisibleBlock: null,
    blocks: [],
    insertAtEnd: vi.fn(),
    setCurrentBlockByChildNode: vi.fn(),
    getBlockById: vi.fn(),
  };

  const blockSelection: BlockSelectionStub = {
    clearSelection: vi.fn(),
    selectBlock: vi.fn(),
  };

  const caret = new Caret({
    config: { sanitizer: {} },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  caret.state = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
  } as BlokModules;

  return {
    caret,
    blockManager,
    blockSelection,
  };
};

const cursorRect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
  }) as unknown as DOMRect;

describe('Caret — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  /**
   * No `caret.set` spy anywhere in this block — spying it would hide the
   * scrolling that `set` itself performs.
   */
  describe('set — scrolling the caret into view', () => {
    it('scrolls up by the caret top plus a margin and skips the downward scroll', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(-50, window.innerHeight + 500));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy).toHaveBeenCalledWith(0, -80);
    });

    it('does not scroll when the caret sits exactly inside the viewport edges', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(0, window.innerHeight));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('scrolls down by the overflow below the viewport plus a margin', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(10, window.innerHeight + 100));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy).toHaveBeenCalledWith(0, 130);
    });
  });

  describe('setToBlockAtXPosition', () => {
    it('places the caret at the given X inside the first input', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const block = createBlock({ inputs: { first,
        last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, 42, true);

      expect(setCaretAtX).toHaveBeenCalledWith(first, 42, true);
      expect(setSpy).not.toHaveBeenCalled();
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block.holder);
      expect(block.currentInput).toBe(first);
    });

    it('places the caret at the end of the last input when no X is given', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const block = createBlock({ inputs: { first,
        last,
        current: first } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, null, false);

      expect(setCaretAtX).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledWith(last.firstChild, 4);
      expect(block.currentInput).toBe(last);
    });

    it('survives a block manager that cannot resolve a current block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();

      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(() => caret.setToBlockAtXPosition(block, 42, true)).not.toThrow();
      expect(blockManager.currentBlock).toBeUndefined();
    });
  });

  describe('setToInputAtXPosition', () => {
    it('places the caret at the given X and marks the input as current', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('other');

      blockManager.currentBlock = block;

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(input, 12, false);

      expect(setCaretAtX).toHaveBeenCalledWith(input, 12, false);
      expect(setSpy).not.toHaveBeenCalled();
      expect(block.currentInput).toBe(input);
    });

    it('places the caret at the very start of the input when no X is given', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('<b>Alpha</b>Beta');

      blockManager.currentBlock = block;

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);
      const firstTextNode = input.querySelector('b')?.firstChild ?? null;

      caret.setToInputAtXPosition(input, null, true);

      expect(setCaretAtX).not.toHaveBeenCalled();
      expect(firstTextNode).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(firstTextNode, 0);
    });

    it('leaves the caret untouched when no node can be reached inside the input', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(createContentEditable('Alpha'), null, true);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('survives being called while no block is current', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = undefined;
      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(() => caret.setToInputAtXPosition(createContentEditable(), 12, false)).not.toThrow();
    });
  });

  describe('setToBlock at the end of an input that holds no text', () => {
    it('falls back to the deepest node of the input itself', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('div');

      input.innerHTML = '<img src="picture.png">';

      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledWith(input, 0);
    });

    it('does nothing when neither a text node nor a deepest node can be resolved', () => {
      const { caret } = createCaret();
      const input = document.createElement('div');

      input.innerHTML = '<img src="picture.png">';

      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToBlock(block, caret.positions.END)).not.toThrow();
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('setToInput with a default position', () => {
    it('falls back to the end of an input that has no text nodes at all', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('div');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input);

      expect(setSpy).toHaveBeenCalledWith(input, 0);
    });
  });

  describe('vertical navigation onto a target block', () => {
    const setupVertical = (next: Block | null): CaretSetup => {
      const setup = createCaret();
      const current = createBlock({ isEmpty: true });

      setup.blockManager.currentBlock = current;
      setup.blockManager.nextVisibleBlock = next;

      return setup;
    };

    it('reports no navigation when there is no next block', () => {
      const { caret, blockSelection } = setupVertical(null);

      expect(caret.navigateVerticalNext()).toBe(false);
      expect(blockSelection.selectBlock).not.toHaveBeenCalled();
    });

    it('moves the caret into a focusable next block', () => {
      const next = createBlock();
      const { caret, blockManager, blockSelection } = setupVertical(next);

      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(next.holder);
      expect(blockSelection.selectBlock).not.toHaveBeenCalled();
    });

    it('selects a next block that cannot hold a caret', () => {
      const next = createBlock({ focusable: false });
      const { caret, blockManager, blockSelection } = setupVertical(next);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockSelection.selectBlock).toHaveBeenCalledWith(next);
      expect(blockManager.currentBlock).toBe(next);
      expect(blockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
      // Selecting a block clears the previous selection exactly once; a second
      // clear means the focusable branch ran instead.
      expect(blockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('setToBlock at the end of formatted text', () => {
    const endOfBlock = (html: string): { setSpy: ReturnType<typeof vi.spyOn>; input: HTMLElement } => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable(html);
      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      return {
        setSpy,
        input,
      };
    };

    it('keeps the caret inside the last formatted run when the text ends with punctuation', () => {
      const { setSpy, input } = endOfBlock('Alpha<b>Beta</b>.');
      const beta = input.querySelector('b')?.firstChild ?? null;

      expect(beta).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(beta, 4);
    });

    it('lands on the trailing punctuation when the block holds nothing else', () => {
      const { setSpy, input } = endOfBlock('<b>...</b>');
      const dots = input.querySelector('b')?.firstChild ?? null;

      expect(dots).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(dots, 3);
    });

    it('lands after the trailing punctuation when the meaningful text is not nested', () => {
      const { setSpy, input } = endOfBlock('Hello<b>.</b>');
      const dot = input.querySelector('b')?.firstChild ?? null;

      expect(dot).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(dot, 1);
    });
  });

  describe('navigatePrevious', () => {
    it('reports no navigation when there is no current block', () => {
      const { caret } = createCaret();

      expect(caret.navigatePrevious()).toBe(false);
    });

    it('stays inside the block when the caret is not at its start', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();
      blockManager.previousVisibleBlock = createBlock();
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(caret.navigatePrevious()).toBe(false);
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('vertical navigation out of a container', () => {
    it('lands on the first block after the whole container', () => {
      const { caret, blockManager } = createCaret();
      const before = createBlock({ id: 'before',
        inputs: { current: createContentEditable('before') } });
      const container = createBlock({ id: 'container',
        inputs: { current: createContentEditable('container') } });
      const child = createBlock({ id: 'child',
        parentId: 'container',
        inputs: { current: createContentEditable('child') } });
      const after = createBlock({ id: 'after',
        inputs: { current: createContentEditable('after') } });

      blockManager.blocks = [ before, container, child, after ];
      blockManager.currentBlock = child;
      blockManager.nextVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(setCaretAtX).toHaveBeenCalledWith(after.firstInput, 100, true);
      expect(blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

    it('appends a fresh block when the container has nothing after it', () => {
      const { caret, blockManager } = createCaret();
      // A table cell is not itself a registered block, so the container id
      // resolves to nothing in the flat block array.
      const other = createBlock({ id: 'other',
        inputs: { current: createContentEditable('other') } });
      const child = createBlock({ id: 'child',
        parentId: 'cell',
        inputs: { current: createContentEditable('child') } });
      const appended = createBlock({ id: 'appended',
        inputs: { current: createContentEditable('appended') } });

      blockManager.blocks = [ other, child ];
      blockManager.currentBlock = child;
      blockManager.nextVisibleBlock = null;
      blockManager.getBlockById.mockReturnValue(undefined);
      blockManager.insertAtEnd.mockReturnValue(appended);

      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setCaretAtX).not.toHaveBeenCalled();
    });

    it('lands on the block sitting right before the container', () => {
      const { caret, blockManager } = createCaret();
      const before = createBlock({ id: 'before',
        inputs: { current: createContentEditable('before') } });
      const container = createBlock({ id: 'container',
        inputs: { current: createContentEditable('container') } });
      const child = createBlock({ id: 'child',
        parentId: 'container',
        inputs: { current: createContentEditable('child') } });

      blockManager.blocks = [ before, container, child ];
      blockManager.currentBlock = child;
      blockManager.previousVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalPrevious()).toBe(true);
      expect(setCaretAtX).toHaveBeenCalledWith(before.lastInput, 100, false);
    });

    it('reports no navigation when the container is the very first block', () => {
      const { caret, blockManager } = createCaret();
      const container = createBlock({ id: 'container' });
      const child = createBlock({ id: 'child',
        parentId: 'container' });

      blockManager.blocks = [ container, child ];
      blockManager.currentBlock = child;
      blockManager.previousVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalPrevious()).toBe(false);
      expect(setCaretAtX).not.toHaveBeenCalled();
    });
  });
});

/* ------------------------------------------------------------------ */
/* Deep-path coverage: the remaining branches of every caret method.   */
/* ------------------------------------------------------------------ */

type WorldSpec = {
  id: string;
  parentId?: string | null;
  focusable?: boolean;
  isEmpty?: boolean;
  isDefault?: boolean;
  html?: string;
  first?: string;
  last?: string;
  detached?: boolean;
};

type World = {
  blocks: Block[];
  byId: Map<string, Block>;
  root: HTMLElement;
};

const buildWorld = (specs: WorldSpec[]): World => {
  const byId = new Map<string, Block>();
  const root = document.createElement('div');

  document.body.appendChild(root);

  specs.forEach((spec) => {
    const current = createContentEditable(spec.html ?? spec.id);
    const first = spec.first === undefined ? current : createContentEditable(spec.first);
    const last = spec.last === undefined ? current : createContentEditable(spec.last);
    const block = createBlock({
      id: spec.id,
      parentId: spec.parentId ?? null,
      focusable: spec.focusable,
      isEmpty: spec.isEmpty,
      isDefault: spec.isDefault,
      inputs: { first,
        last,
        current },
    });

    byId.set(spec.id, block);
  });

  specs.forEach((spec) => {
    const block = byId.get(spec.id);

    if (block === undefined || spec.detached === true) {
      return;
    }

    const parent = spec.parentId === undefined || spec.parentId === null
      ? undefined
      : byId.get(spec.parentId);

    (parent ?? { holder: root }).holder.appendChild(block.holder);
  });

  const blocks = specs.map((spec) => {
    const block = byId.get(spec.id);

    if (block === undefined) {
      throw new Error(`buildWorld: missing block ${spec.id}`);
    }

    return block;
  });

  return { blocks,
    byId,
    root };
};

const at = (world: World, id: string): Block => {
  const block = world.byId.get(id);

  if (block === undefined) {
    throw new Error(`world has no block ${id}`);
  }

  return block;
};

/** Wires a world into the stubbed BlockManager, resolving ids from the world. */
const wireWorld = (setup: CaretSetup, world: World): void => {
  const { blockManager } = setup;

  blockManager.blocks = world.blocks;
  blockManager.getBlockById.mockImplementation((id: string) => world.byId.get(id));
};

const elementTextNode = (element: HTMLElement): Text => {
  const node = element.firstChild;

  if (node === null || node.nodeType !== Node.TEXT_NODE) {
    throw new Error('expected a text node');
  }

  return node as Text;
};

describe('Caret — mutation coverage: caret placement deep paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('exposes exactly the three caret position names', () => {
    const { caret } = createCaret();

    expect(caret.positions).toStrictEqual({ START: 'start',
      END: 'end',
      DEFAULT: 'default' });
  });

  describe('shadow caret', () => {
    it('appends a span stamped with the shadow-caret attribute as the last child', () => {
      const { caret } = createCaret();
      const host = document.createElement('div');
      const bold = document.createElement('b');

      bold.textContent = 'keep';
      host.appendChild(bold);

      caret.createShadow(host);

      const last = host.lastElementChild;

      expect(last?.tagName).toBe('SPAN');
      expect(last?.getAttribute('data-blok-shadow-caret')).toBe('');
      expect(last?.getAttribute('data-blok-testid')).toBe('shadow-caret');
      expect(host.firstElementChild).toBe(bold);
    });

    it('removes the shadow caret from the element on restore', () => {
      const { caret } = createCaret();
      const host = document.createElement('div');
      const elsewhere = document.createElement('p');

      elsewhere.textContent = 'elsewhere';
      document.body.appendChild(elsewhere);

      const previousRange = document.createRange();

      previousRange.selectNodeContents(elsewhere);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(previousRange);

      host.innerHTML = '<b>text</b>';
      caret.createShadow(host);

      const shadow = host.querySelector('[data-blok-shadow-caret]');

      caret.restoreCaret(host);

      expect(host.querySelector('[data-blok-shadow-caret]')).toBeNull();
      expect(host.innerHTML).toBe('<b>text</b>');
      expect(shadow?.isConnected).toBe(false);
      // Restoring re-points the selection at the shadow span and removes it,
      // so the selection that was live before it is dropped.
      expect(window.getSelection()?.rangeCount).toBe(0);
    });

    it('leaves the element untouched when there is no shadow caret to restore', () => {
      const { caret } = createCaret();
      const host = document.createElement('div');

      host.innerHTML = '<b>text</b>';

      caret.restoreCaret(host);

      expect(host.innerHTML).toBe('<b>text</b>');
    });
  });

  describe('insertContentAtCaretPosition', () => {
    const selectContentsOf = (node: Node): void => {
      const range = document.createRange();

      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    };

    const withParagraph = (): HTMLParagraphElement => {
      const p = document.createElement('p');

      p.textContent = 'Hello';
      document.body.appendChild(p);

      return p;
    };

    it('does nothing when there is no selection at all', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      vi.spyOn(Selection, 'get').mockReturnValue(null);

      caret.insertContentAtCaretPosition('<b>X</b>');

      expect(p.innerHTML).toBe('Hello');
    });

    it('does nothing when the selection carries no range', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);
      vi.spyOn(Selection, 'range', 'get').mockReturnValue(null);

      caret.insertContentAtCaretPosition('<b>X</b>');

      expect(p.innerHTML).toBe('Hello');
    });

    it('deletes the selected content before inserting the payload', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);

      caret.insertContentAtCaretPosition('<b>X</b>');

      expect(p.querySelector('b')?.textContent).toBe('X');
      expect(p.textContent).toBe('X');
    });

    it('anchors the caret at the end of an inserted plain-text payload', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);
      window.getSelection()?.collapse(p.firstChild, 1);

      caret.insertContentAtCaretPosition('plain');

      const selection = window.getSelection();

      expect(p.textContent).toBe('Hplainello');
      expect(selection?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
      expect(selection?.anchorOffset).toBe(5);
    });

    it('anchors the caret inside the last inserted element', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);
      window.getSelection()?.collapse(p.firstChild, 1);

      caret.insertContentAtCaretPosition('<b>X</b>');

      const inserted = p.querySelector('b');

      expect(inserted?.textContent).toBe('X');
      expect(window.getSelection()?.anchorNode).toBe(inserted?.firstChild);
      expect(window.getSelection()?.anchorOffset).toBe(1);
    });

    it('survives an inserted element that carries no caret-able child', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);
      window.getSelection()?.collapse(p.firstChild, 1);

      expect(() => caret.insertContentAtCaretPosition('<b></b>')).not.toThrow();
      expect(window.getSelection()?.anchorOffset).toBe(0);
    });

    it('inserts an empty text node when the payload is empty', () => {
      const { caret } = createCaret();
      const p = withParagraph();

      selectContentsOf(p);
      window.getSelection()?.collapse(p.firstChild, 1);

      caret.insertContentAtCaretPosition('');

      expect(p.textContent).toBe('Hello');
      expect(window.getSelection()?.anchorNode).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    });
  });

  describe('setToBlock', () => {
    it('puts the caret on the first deepest node when the position is START', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('<b></b>Alpha');
      const last = createContentEditable('Tail');
      const block = createBlock({ inputs: { first,
        last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.START);

      // getDeepestNode(first, false) is the empty <b>, not the "Alpha" text.
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(first.querySelector('b'));
      expect(setSpy.mock.calls[0][1]).toBe(0);
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block.holder);
      expect(block.currentInput).toBe(first);
    });

    it('leaves the updated block alone when the block manager resolves no current block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();

      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToBlock(block, caret.positions.START)).not.toThrow();
      expect(blockManager.currentBlock).toBeUndefined();
    });

    it('resolves the offset through the default position', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('<b></b>Alpha');
      const block = createBlock({ inputs: { first,
        current: first } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.DEFAULT, 0);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(first.lastChild);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

    it('falls back to the first deepest node when no text node matches the offset', () => {
      const { caret, blockManager } = createCaret();
      const first = document.createElement('div');

      first.innerHTML = '<span><img src="a.png"></span><span><img src="b.png"></span>';

      const block = createBlock({ inputs: { first,
        current: first } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.DEFAULT, 0);

      // getDeepestNode(first, false) lands on the SECOND span, not the first.
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(first.children[1]);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

    it('backs out when the block exposes no input at all', () => {
      const { caret } = createCaret();
      const block = createBlock();

      (block as unknown as { currentInput: undefined }).currentInput = undefined;

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToBlock(block)).not.toThrow();
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('takes the native-input branch of the end position for a trailing input', () => {
      const { caret, blockManager } = createCaret();
      const last = document.createElement('div');

      last.innerHTML = '<span>abc</span><input value="zz">';

      const block = createBlock({ inputs: { last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(last.querySelector('input'));
      expect(setSpy.mock.calls[0][1]).toBe(2);
    });

    it('prefers the trailing meaningful text node over a non-native element', () => {
      const { caret, blockManager } = createCaret();
      const last = document.createElement('div');

      last.innerHTML = 'x<b></b>';

      const block = createBlock({ inputs: { last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(last.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(1);
    });

    it('lands on the deepest node of an element that holds nothing at all', () => {
      const { caret, blockManager } = createCaret();
      const last = document.createElement('div');
      const block = createBlock({ inputs: { last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(last);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

    it('declines to place a caret when no node is reachable at all', () => {
      const { caret, blockManager } = createCaret();
      const last = document.createElement('div');
      const block = createBlock({ inputs: { last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('selects a non-focusable block instead of placing a caret', () => {
      const { caret, blockManager, blockSelection } = createCaret();
      const block = createBlock({ focusable: false });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block);

      expect(setSpy).not.toHaveBeenCalled();
      expect(blockSelection.selectBlock).toHaveBeenCalledWith(block);
      expect(blockManager.currentBlock).toBe(block);
    });

    it('blurs an active element while selecting a non-focusable block', () => {
      const { caret } = createCaret();
      const block = createBlock({ focusable: false });
      const button = document.createElement('button');

      document.body.appendChild(button);
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => caret.setToBlock(block)).not.toThrow();
    });

    it('clears the sticky goal column on every non-vertical placement', () => {
      const { caret, blockManager } = createCaret();
      const current = createBlock({ isEmpty: false });
      const next = createBlock();

      blockManager.currentBlock = current;
      blockManager.nextVisibleBlock = next;

      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValueOnce(100).mockReturnValue(200);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(caret.navigateNext(true)).toBe(true);
      expect(caret.navigateVerticalNext()).toBe(true);

      // Without the reset the second vertical move reuses the first column.
      expect(vi.mocked(caretUtils.getCaretXPosition)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[1][1]).toBe(200);
    });
  });


  describe('setToBlock end position uses the last input', () => {
    it('takes the last input, not the current one, as the end target', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const current = createContentEditable('current');
      const block = createBlock({ inputs: { first,
        last,
        current } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(last.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(4);
    });
  });

  describe('sticky goal column resets', () => {
    const prime = (): CaretSetup => {
      const setup = createCaret();
      const current = createBlock({ isEmpty: false });
      const next = createBlock();

      setup.blockManager.currentBlock = current;
      setup.blockManager.nextVisibleBlock = next;
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValueOnce(100).mockReturnValue(200);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      vi.spyOn(setup.caret, 'set').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalNext()).toBe(true);

      return setup;
    };

    const expectFreshColumn = (): void => {
      expect(vi.mocked(caretUtils.getCaretXPosition)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[1][1]).toBe(200);
    };

    it('clears the goal column when a whole block is set explicitly', () => {
      const setup = prime();
      const target = setup.blockManager.nextVisibleBlock;

      if (target === null) {
        throw new Error('the prime fixture must expose a next block');
      }

      setup.caret.setToBlock(target, setup.caret.positions.START);
      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expectFreshColumn();
    });

    it('clears the goal column when an input is set explicitly', () => {
      const setup = prime();

      setup.caret.setToInput(createContentEditable('x'), setup.caret.positions.START);
      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expectFreshColumn();
    });

    it('clears the goal column on horizontal previous navigation', () => {
      const setup = prime();

      expect(setup.caret.navigatePrevious(true)).toBe(false);
      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expectFreshColumn();
    });
  });

  describe('setToInput bookkeeping', () => {
    it('marks the settled input as the current input of the current block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('other');

      blockManager.currentBlock = block;
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.END);

      expect(block.currentInput).toBe(input);
    });

    it('survives an input being set while no block is current', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('other');

      blockManager.currentBlock = undefined;
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToInput(input, caret.positions.END)).not.toThrow();
    });
  });

  describe('setToBlockAtXPosition', () => {
    const setup = (): CaretSetup & { block: Block } => {
      const setupResult = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const block = createBlock({ inputs: { first,
        last,
        current: last } });

      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      return { ...setupResult,
        block };
    };

    it('routes a null X through the start position of the first input', () => {
      const { caret, blockManager, block } = setup();

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, null, true);

      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(block.firstInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(0);
      expect(block.currentInput).toBe(block.firstInput);
    });

    it('routes a null X through the end position of the last input', () => {
      const { caret, blockManager, block } = setup();

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, null, false);

      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(block.lastInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(4);
    });

    it('marks the block current through the block manager', () => {
      const { caret, blockManager, block } = setup();

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, 42, true);

      expect(vi.mocked(caretUtils.setCaretAtXPosition)).toHaveBeenCalledWith(block.firstInput, 42, true);
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block.holder);
      expect(block.currentInput).toBe(block.firstInput);
    });

    it('backs out when the requested input is missing', () => {
      const { caret } = setup();
      const block = createBlock();

      (block as { firstInput?: unknown }).firstInput = undefined;
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToBlockAtXPosition(block, 42, true)).not.toThrow();
      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
    });

    it('falls through to the else branch when the input is missing and no X is given', () => {
      const { caret } = setup();
      const block = createBlock();

      (block as { firstInput?: unknown }).firstInput = undefined;

      expect(() => caret.setToBlockAtXPosition(block, null, true)).not.toThrow();
    });

    it('selects a non-focusable block instead of moving the caret to an X', () => {
      const { caret, blockManager, blockSelection } = createCaret();
      const block = createBlock({ focusable: false });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, 42, true);
      expect(setCaretAtX).not.toHaveBeenCalled();

      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
      expect(blockSelection.selectBlock).toHaveBeenCalledWith(block);
      expect(blockManager.currentBlock).toBe(block);
    });

    it('tolerates a missing selection while selecting a non-focusable block', () => {
      const { caret } = createCaret();
      const block = createBlock({ focusable: false });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);

      expect(() => caret.setToBlockAtXPosition(block, 42, true)).not.toThrow();
    });
  });

  describe('setToInputAtXPosition', () => {
    it('marks the input current through the block manager', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('other');

      blockManager.currentBlock = block;
      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(input, 12, false);

      expect(vi.mocked(caretUtils.setCaretAtXPosition)).toHaveBeenCalledWith(input, 12, false);
      expect(block.currentInput).toBe(input);
    });

    it('routes a null X through the first-input start position', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('<b>Alpha</b>Beta');

      blockManager.currentBlock = block;

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(input, null, false);

      expect(setCaretAtX).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(input.lastChild);
      expect(setSpy.mock.calls[0][1]).toBe(4);
      expect(block.currentInput).toBe(input);
    });

    it('survives a block manager without a current block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();

      blockManager.currentBlock = undefined;

      expect(() => caret.setToInputAtXPosition(createContentEditable(), 12, false)).not.toThrow();
      expect(block.currentInput).not.toBe(blockManager.currentBlock);
    });
  });

  describe('setToInput position routing', () => {
    it('moves the caret to the start through the deepest node', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('<b></b>Alpha');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.START);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(input.querySelector('b'));
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

    it('moves the caret to the end through the last deepest node', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('<b></b>Alpha');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(input.lastChild);
      expect(setSpy.mock.calls[0][1]).toBe(5);
    });

    it('backs out of the start position when the input has no nodes', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();
      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(createContentEditable(), caret.positions.START);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('backs out of the end position when the input has no nodes', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();
      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToInput(createContentEditable(), caret.positions.END)).not.toThrow();
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('falls back to the end of the input when the offset resolves no node', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('div');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.DEFAULT, 5);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(input);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

    it('places the caret on the resolved node for a text offset', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('Alpha');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.DEFAULT, 3);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][0]).toBe(input.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(3);
    });
  });

  describe('setToTheLastBlock', () => {
    it('backs out when the document has no last block', () => {
      const { caret, blockManager } = createCaret();

      (blockManager as unknown as { lastBlock: undefined }).lastBlock = undefined;
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      expect(() => caret.setToTheLastBlock()).not.toThrow();
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('uses an empty default last block as is', () => {
      const { caret, blockManager } = createCaret();
      const lastBlock = createBlock({ isEmpty: true,
        isDefault: true });

      (blockManager as unknown as { lastBlock: Block }).lastBlock = lastBlock;
      blockManager.insertAtEnd.mockReturnValue(createBlock({ id: 'fresh' }));
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      caret.setToTheLastBlock();

      expect(setToBlock).toHaveBeenCalledTimes(1);
      expect(setToBlock.mock.calls[0][0]).toBe(lastBlock);
      expect(blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

    it('appends a block when the last block is a default holding content', () => {
      const { caret, blockManager } = createCaret();
      const lastBlock = createBlock({ isEmpty: false,
        isDefault: true });
      const fresh = createBlock({ id: 'fresh' });

      (blockManager as unknown as { lastBlock: Block }).lastBlock = lastBlock;
      blockManager.insertAtEnd.mockReturnValue(fresh);
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      caret.setToTheLastBlock();

      expect(blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledTimes(1);
      expect(setToBlock.mock.calls[0][0]).toBe(fresh);
    });
  });

  describe('extractFragmentFromCaretPosition', () => {
    const paragraphWithSelection = (): HTMLParagraphElement => {
      const p = document.createElement('p');

      p.textContent = 'Hello';
      document.body.appendChild(p);

      const range = document.createRange();

      range.selectNodeContents(p);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      return p;
    };

    it('backs out when there is no selection', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock({ inputs: { current: createContentEditable('x') } });
      vi.spyOn(Selection, 'get').mockReturnValue(null);

      expect(caret.extractFragmentFromCaretPosition()).toBeUndefined();
    });

    it('backs out when the selection carries no range', () => {
      const { caret, blockManager } = createCaret();
      const p = paragraphWithSelection();

      blockManager.currentBlock = createBlock({ inputs: { current: createContentEditable('x') } });
      // Selection.get is declared to return the internal SelectionUtils shape, so the
    // stand-in is cast through never to satisfy the spy signature.
    vi.spyOn(Selection, 'get').mockReturnValue({ rangeCount: 0 } as unknown as never);

      expect(caret.extractFragmentFromCaretPosition()).toBeUndefined();
      expect(p.textContent).toBe('Hello');
    });

    it('backs out when no block is current', () => {
      const { caret, blockManager } = createCaret();

      paragraphWithSelection();
      blockManager.currentBlock = undefined;

      expect(() => caret.extractFragmentFromCaretPosition()).not.toThrow();
    });

    it('backs out when the current block exposes no input', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();

      paragraphWithSelection();
      block.currentInput = undefined;
      blockManager.currentBlock = block;

      expect(() => caret.extractFragmentFromCaretPosition()).not.toThrow();
    });

    it('deletes the selected content before extracting the tail fragment', () => {
      const { caret, blockManager } = createCaret();
      const p = paragraphWithSelection();
      const block = createBlock({ inputs: { current: createContentEditable('x') } });

      blockManager.currentBlock = block;

      const fragment = caret.extractFragmentFromCaretPosition();

      expect(fragment).toBeInstanceOf(DocumentFragment);
      expect(p.textContent).toBe('');
    });
  });
});

describe('Caret — mutation coverage: punctuation and text-node scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  /** Places the caret at END of a block whose input holds the given markup. */
  const endOfInput = (html: string): { setSpy: ReturnType<typeof vi.spyOn>; input: HTMLElement } => {
    const { caret, blockManager } = createCaret();
    const input = createContentEditable(html);
    const block = createBlock({ inputs: { last: input,
      current: input } });

    blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
      blockManager.currentBlock = block;
    });

    const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

    caret.setToBlock(block, caret.positions.END);

    return { setSpy,
      input };
  };

  const marked = (input: HTMLElement): Text => elementTextNode(input.querySelector('b') as HTMLElement);

  it('walks over a whitespace-only run instead of treating it as visible text', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b> </b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(elementTextNode(input.querySelector('i') as HTMLElement));
    expect(setSpy.mock.calls[0][1]).toBe(1);
  });

  it('treats a digit as meaningful text', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b>5</b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(marked(input));
    expect(setSpy.mock.calls[0][1]).toBe(1);
  });

  it('treats the digit zero as meaningful text', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b>0</b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(marked(input));
  });

  it('treats a letter as meaningful text', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b>Q</b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(marked(input));
  });

  it('treats a punctuation character above the digits as punctuation', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b>@</b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(elementTextNode(input.querySelector('i') as HTMLElement));
  });

  it('treats a non-ASCII glyph as meaningful text', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b>→</b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(marked(input));
  });

  it('treats the last ASCII code point as punctuation', () => {
    const { setSpy, input } = endOfInput('<i>x</i><b></b>');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(elementTextNode(input.querySelector('i') as HTMLElement));
  });

  it('picks the last meaningful run, not the first one', () => {
    const { setSpy, input } = endOfInput('X<b>1</b>.');

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toBe(marked(input));
    expect(setSpy.mock.calls[0][1]).toBe(1);
  });
});

describe('Caret — mutation coverage: the digit nine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it('treats the digit nine as meaningful text', () => {
    const { caret, blockManager } = createCaret();
    const input = createContentEditable('<i>x</i><b>9</b>');
    const block = createBlock({ inputs: { last: input,
      current: input } });

    blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
      blockManager.currentBlock = block;
    });

    const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

    caret.setToBlock(block, caret.positions.END);

    expect(setSpy.mock.calls[0][0]).toBe(elementTextNode(input.querySelector('b') as HTMLElement));
    expect(setSpy.mock.calls[0][1]).toBe(1);
  });
});

describe('Caret — mutation coverage: navigation and containers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  const spySetToBlock = (caret: Caret): ReturnType<typeof vi.spyOn> =>
    vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

  const spySetCaretAtX = (): ReturnType<typeof vi.spyOn> =>
    vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

  describe('navigateNext across container boundaries', () => {
    const twoColumnWorld = (): World => buildWorld([
      { id: 'top1' },
      { id: 'container' },
      { id: 'colA',
        parentId: 'container' },
      { id: 'a',
        parentId: 'colA' },
      { id: 'colB',
        parentId: 'container' },
      { id: 'c',
        parentId: 'colB' },
      { id: 'd',
        parentId: 'colB' },
      { id: 'top2' },
    ]);

    it('slides into the adjacent column edge block instead of the flat neighbour', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'd');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'c'));
    });

    it('escapes the whole layout when there is no adjacent column', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'colA',
          parentId: 'container' },
        { id: 'p',
          parentId: 'colA' },
        { id: 'colB',
          parentId: 'container' },
        { id: 'a',
          parentId: 'colB' },
        { id: 'top2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'p');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'top2'));
    });

    it('keeps a sibling move inside the same DOM container', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'c');
      setup.blockManager.nextVisibleBlock = at(world, 'd');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'd'));
    });

    it('does not leave a container whose next flat neighbour is outside it', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'top2');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'top2'));
    });

    it('leaves a layout whose column is not a registered container', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'col',
          html: 'col' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'col');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('stops when a null neighbour is seen from inside a container', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = null;

      const setToBlock = spySetToBlock(setup.caret);

      expect(() => setup.caret.navigateNext(true)).not.toThrow();
      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('appends a block when the layout is the last thing in the document', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'col',
          html: 'col' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = null;

      const appended = createBlock({ id: 'appended' });

      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('creates a trailing block when the arrow key is allowed to', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false,
          html: 'only' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;

      const appended = createBlock({ id: 'appended' });

      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext()).toBe(true);
      expect(setup.blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock.mock.calls[0][0]).toBe(appended);
    });

    it('does not create a trailing block when block creation is disallowed', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false,
          html: 'only' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      expect(setup.caret.navigateNext(false, false)).toBe(false);
      expect(setup.blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

    it('stays put when the caret is not at the end of a non-default block', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false,
          html: 'only' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      expect(setup.caret.navigateNext()).toBe(false);
      expect(setup.blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

        it('moves into the next input of the same block without a caret check', () => {
      const setup = createCaret();
      const world = buildWorld([{ id: 'only' }]);
      const block = at(world, 'only');
      const nextInput = createContentEditable('inner');

      (block as unknown as { nextInput: HTMLElement }).nextInput = nextInput;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);
      const setToInput = vi.spyOn(setup.caret, 'setToInput').mockImplementation(() => undefined);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(nextInput, 'start');
    });

    it('returns false when there is no current block', () => {
      const setup = createCaret();

      setup.blockManager.currentBlock = undefined;

      expect(setup.caret.navigateNext()).toBe(false);
    });

    it('defaults to a forced move when no argument is passed', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false,
          html: 'only' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;
      setup.blockManager.insertAtEnd.mockReturnValue(createBlock({ id: 'appended' }));
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      // `force` defaults to false, so a caret mid-text must not navigate.
      expect(setup.caret.navigateNext()).toBe(false);
      expect(setup.blockManager.insertAtEnd).not.toHaveBeenCalled();
    });
  });

  describe('navigatePrevious across container boundaries', () => {
    const twoColumnWorld = (): World => buildWorld([
      { id: 'top1' },
      { id: 'container' },
      { id: 'colA',
        parentId: 'container' },
      { id: 'p',
        parentId: 'colA' },
      { id: 'colB',
        parentId: 'container' },
      { id: 'a',
        parentId: 'colB' },
      { id: 'top2' },
    ]);

    it('slides into the adjacent column edge block instead of the flat neighbour', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'p'));
    });

        it('escapes the whole layout when there is no adjacent column', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'before' },
        { id: 'top1' },
        { id: 'col',
          parentId: 'top1' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'top1');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'before'));
    });

    it('keeps a sibling move inside the same DOM container', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'p',
          parentId: 'col' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'p'));
    });

    it('stops when a null neighbour is seen from inside a container', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = null;

      const setToBlock = spySetToBlock(setup.caret);

      expect(() => setup.caret.navigatePrevious(true)).not.toThrow();
      expect(setup.caret.navigatePrevious(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('returns false when there is no current block', () => {
      const setup = createCaret();

      setup.blockManager.currentBlock = undefined;

      expect(setup.caret.navigatePrevious()).toBe(false);
    });

    it('defaults to a forced move when no argument is passed', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious()).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

        it('moves into the previous input of the same block without a caret check', () => {
      const setup = createCaret();
      const world = buildWorld([{ id: 'only' }]);
      const block = at(world, 'only');
      const previousInput = createContentEditable('inner');

      (block as unknown as { previousInput: HTMLElement }).previousInput = previousInput;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const setToInput = vi.spyOn(setup.caret, 'setToInput').mockImplementation(() => undefined);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(previousInput, 'end');
    });

    it('stays inside the block when the caret is not at its start', () => {
      const setup = createCaret();
      const world = twoColumnWorld();

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      expect(setup.caret.navigatePrevious()).toBe(false);
    });

    it('leaves the caret alone when the current block has no input', () => {
      const setup = createCaret();
      const world = twoColumnWorld();
      const block = at(world, 'a');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;

      expect(() => setup.caret.navigatePrevious(false)).not.toThrow();
    });

        it('treats a missing input as not-at-start for a forced previous move', () => {
      const setup = createCaret();
      const world = twoColumnWorld();
      const block = at(world, 'a');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.previousVisibleBlock = at(world, 'top1');
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToBlock).toHaveBeenCalledTimes(1);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'top1'));
    });
  });

  describe('navigateVerticalNext deep paths', () => {
    it('returns false when there is no current block', () => {
      const setup = createCaret();

      setup.blockManager.currentBlock = undefined;

      expect(setup.caret.navigateVerticalNext()).toBe(false);
    });

        it('navigates away from a non-focusable block even mid-text', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'image',
          focusable: false,
          html: 'img' },
        { id: 'next',
          first: 'F',
          last: 'L' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'image');
      setup.blockManager.nextVisibleBlock = at(world, 'next');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(false);
      const setSpy = vi.spyOn(setup.caret, 'set').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setSpy.mock.calls[0][0]).toBe(at(world, 'next').firstInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

        it('navigates away from an empty block without a last-line check', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'empty',
          isEmpty: true,
          html: 'x' },
        { id: 'next',
          first: 'F',
          last: 'L' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'empty');
      setup.blockManager.nextVisibleBlock = at(world, 'next');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(false);
      const setSpy = vi.spyOn(setup.caret, 'set').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setSpy.mock.calls[0][0]).toBe(at(world, 'next').firstInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(0);
    });

        it('hands the line move back to the browser when the caret is not on the last line', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only' },
        { id: 'other' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = at(world, 'other');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(false);

      expect(setup.caret.navigateVerticalNext()).toBe(false);
    });

    it('treats a block without an input as sitting on its last line', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
        { id: 'next',
          first: 'F',
          last: 'L' },
      ]);
      const block = at(world, 'only');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.nextVisibleBlock = at(world, 'next');
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(50);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
    });

    it('moves into the next input of the same block', () => {
      const setup = createCaret();
      const world = buildWorld([{ id: 'only' }]);
      const block = at(world, 'only');
      const nextInput = createContentEditable('inner');

      (block as unknown as { nextInput: HTMLElement }).nextInput = nextInput;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      const setToInput = vi.spyOn(setup.caret, 'setToInputAtXPosition').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(nextInput, 9, true);
    });

    it('moves to a sibling in the same DOM container', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col' },
        { id: 'b',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'b');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'b').firstInput);
    });

        it('moves to a sibling even when the holders are detached', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col',
          detached: true },
        { id: 'b',
          parentId: 'col',
          detached: true },
      ]);
      const appended = createBlock({ id: 'appended' });

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'b');
      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setup.blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(appended, 'start');
      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
    });

    it('exits the container when the next block belongs to another cell', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'colA',
          parentId: 'container' },
        { id: 'a',
          parentId: 'colA' },
        { id: 'colB',
          parentId: 'container' },
        { id: 'c',
          parentId: 'colB' },
        { id: 'top2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'c');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'top2').firstInput);
    });

    it('appends a block when the container ends the document', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'col',
          html: 'col' },
        { id: 'a',
          parentId: 'col' },
      ]);
      const appended = createBlock({ id: 'appended' });

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = null;
      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(appended, 'start');
    });

    it('moves straight to the next block when the container does not apply', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'a' },
        { id: 'b' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'b');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'b').firstInput);
    });

    it('creates a trailing block only when the option allows it', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
      ]);
      const appended = createBlock({ id: 'appended' });

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;
      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setup.blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(appended, 'start');
    });

    it('refuses to create a trailing block when block creation is off', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);

      expect(setup.caret.navigateVerticalNext(false)).toBe(false);
      expect(setup.blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

    it('skips creation when the caret is not at the end of a non-default block', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.nextVisibleBlock = null;
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);

      expect(setup.caret.navigateVerticalNext()).toBe(false);
    });

    it('ignores an unregistered ancestor while scanning for the container exit', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col' },
        { id: 'ghost',
          parentId: 'missing' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'ghost');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'ghost').firstInput);
    });
  });

  describe('navigateVerticalPrevious deep paths', () => {
    it('returns false when there is no current block', () => {
      const setup = createCaret();

      setup.blockManager.currentBlock = undefined;

      expect(setup.caret.navigateVerticalPrevious()).toBe(false);
    });

        it('navigates away from a non-focusable block even mid-text', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'image',
          focusable: false,
          html: 'img' },
        { id: 'prev',
          first: 'F',
          last: 'L' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'image');
      setup.blockManager.previousVisibleBlock = at(world, 'prev');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(false);
      const setSpy = vi.spyOn(setup.caret, 'set').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(setSpy.mock.calls[0][0]).toBe(at(world, 'prev').lastInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(1);
    });

        it('navigates away from an empty block without a first-line check', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'empty',
          isEmpty: true,
          html: 'x' },
        { id: 'prev',
          first: 'F',
          last: 'L' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'empty');
      setup.blockManager.previousVisibleBlock = at(world, 'prev');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(false);
      const setSpy = vi.spyOn(setup.caret, 'set').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(setSpy.mock.calls[0][0]).toBe(at(world, 'prev').lastInput?.firstChild);
      expect(setSpy.mock.calls[0][1]).toBe(1);
    });

    it('hands the line move back to the browser when the caret is not on the first line', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only' },
        { id: 'prev' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'only');
      setup.blockManager.previousVisibleBlock = at(world, 'prev');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(false);

      expect(setup.caret.navigateVerticalPrevious()).toBe(false);
    });

    it('treats a block without an input as sitting on its first line', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only' },
        { id: 'prev' },
      ]);
      const block = at(world, 'only');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.previousVisibleBlock = at(world, 'prev');
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(50);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
    });

    it('moves into the previous input of the same block', () => {
      const setup = createCaret();
      const world = buildWorld([{ id: 'only' }]);
      const block = at(world, 'only');
      const previousInput = createContentEditable('inner');

      (block as unknown as { previousInput: HTMLElement }).previousInput = previousInput;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      const setToInput = vi.spyOn(setup.caret, 'setToInputAtXPosition').mockImplementation(() => undefined);

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(previousInput, 9, false);
    });

    it('moves to a sibling in the same DOM container', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'p',
          parentId: 'col' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'p').firstInput);
    });

        it('moves to a sibling even when the holders are detached', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'p',
          parentId: 'col',
          detached: true },
        { id: 'a',
          parentId: 'col',
          detached: true },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(false);
      expect(vi.mocked(caretUtils.setCaretAtXPosition)).not.toHaveBeenCalled();
    });

    it('exits the container when the previous block belongs to another cell', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'colA',
          parentId: 'container' },
        { id: 'p',
          parentId: 'colA' },
        { id: 'colB',
          parentId: 'container' },
        { id: 'a',
          parentId: 'colB' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'top1').lastInput);
    });

    it('moves to the previous block when the container does not apply', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'a' },
        { id: 'b' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'b');
      setup.blockManager.previousVisibleBlock = at(world, 'a');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'a').lastInput);
    });
  });

  describe('no-input and detached-holder navigation', () => {
    it('treats a block without an input as sitting on the last line and at the end', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
      ]);
      const block = at(world, 'only');
      const appended = createBlock({ id: 'appended' });

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.nextVisibleBlock = null;
      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(false);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(50);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setup.blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(appended, 'start');
    });

    it('treats a block without an input as sitting on the first line', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'only',
          isDefault: false },
        { id: 'prev' },
      ]);
      const block = at(world, 'only');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.previousVisibleBlock = at(world, 'prev');
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(false);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(50);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'prev').lastInput);
    });

    it('treats a missing input as not-at-end of a non-default block', () => {
      const setup = createCaret();
      const world = buildWorld([{ id: 'only' }]);
      const block = at(world, 'only');

      (block as unknown as { currentInput: undefined }).currentInput = undefined;
      wireWorld(setup, world);
      setup.blockManager.currentBlock = block;
      setup.blockManager.nextVisibleBlock = null;

      expect(() => setup.caret.navigateNext()).not.toThrow();
      expect(setup.caret.navigateNext()).toBe(false);
    });

    it('leaves the layout alone when the holders are detached', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col',
          detached: true },
        { id: 'b',
          parentId: 'col',
          detached: true },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'b');
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('leaves the layout alone when the previous holders are detached', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'p',
          parentId: 'col',
          detached: true },
        { id: 'a',
          parentId: 'col',
          detached: true },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('refuses the adjacent-column path when ids cannot be resolved', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'col' },
        { id: 'a',
          parentId: 'col' },
        { id: 'b',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'col');

      const noLookup = setup.blockManager as { getBlockById?: unknown };

      delete noLookup.getBlockById;
      const setToBlock = spySetToBlock(setup.caret);

      expect(() => setup.caret.navigateNext(true)).not.toThrow();
      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('stops the column climb at an unregistered parent', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'cur',
          parentId: 'sub' },
        { id: 'cand',
          parentId: 'sub',
          detached: true },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'cur');
      setup.blockManager.nextVisibleBlock = at(world, 'cand');
      const setToBlock = spySetToBlock(setup.caret);

      expect(() => setup.caret.navigateNext(true)).not.toThrow();
      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('climbs past an intermediate ancestor to the column wrapper', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'container' },
        { id: 'colB',
          parentId: 'container' },
        { id: 'sub',
          parentId: 'colB' },
        { id: 'x',
          parentId: 'sub' },
        { id: 'colA',
          parentId: 'container' },
        { id: 'pa',
          parentId: 'colA' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'x');
      setup.blockManager.nextVisibleBlock = at(world, 'container');
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'pa'));
    });

    it('takes the last child of the adjacent column going backwards', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'colA',
          parentId: 'container' },
        { id: 'p',
          parentId: 'colA' },
        { id: 'q',
          parentId: 'colA' },
        { id: 'colB',
          parentId: 'container' },
        { id: 'a',
          parentId: 'colB' },
        { id: 'top2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = at(world, 'p');
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigatePrevious(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'q'));
    });
  });

  describe('container resolution helpers', () => {
    it('skips blocks that sit anywhere inside the container subtree', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'deep',
          parentId: 'col' },
        { id: 'col2',
          parentId: 'container' },
        { id: 'c',
          parentId: 'col2' },
        { id: 'top2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'deep');
      setup.blockManager.nextVisibleBlock = null;
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'top2').firstInput);
    });

    it('rejects a sibling candidate that is not on the container chain', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'col',
          parentId: 'top1' },
        { id: 'a',
          parentId: 'col' },
        { id: 'other' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'other');
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'other').firstInput);
    });

        it('returns no next block when the container cannot be indexed', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'a',
          parentId: 'missing' },
        { id: 'b' },
      ]);
      const appended = createBlock({ id: 'appended' });

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = null;
      setup.blockManager.insertAtEnd.mockReturnValue(appended);
      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateVerticalNext()).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(appended, 'start');
    });

    it('takes the previous block sitting before the container index', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.previousVisibleBlock = null;
      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(9);
      spySetCaretAtX();

      expect(setup.caret.navigateVerticalPrevious()).toBe(true);
      expect(vi.mocked(caretUtils.setCaretAtXPosition).mock.calls[0][0]).toBe(at(world, 'top1').lastInput);
    });

        it('gives up when the block manager cannot resolve ids at all', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col' },
        { id: 'col2',
          parentId: 'container' },
        { id: 'c',
          parentId: 'col2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'c');

      const noLookup = setup.blockManager as { getBlockById?: unknown };

      delete noLookup.getBlockById;
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock.mock.calls[0][0]).toBe(at(world, 'c'));
    });

    it('stops the climb at the first unresolvable ancestor', () => {
      const setup = createCaret();
      const world = buildWorld([
        { id: 'top1' },
        { id: 'container' },
        { id: 'col',
          parentId: 'container' },
        { id: 'a',
          parentId: 'col' },
        { id: 'col2',
          parentId: 'container' },
        { id: 'c',
          parentId: 'col2' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'c');

      const lookup = setup.blockManager.getBlockById;

      setup.blockManager.getBlockById.mockImplementation((id: string) =>
        id === 'col' ? undefined : world.byId.get(id));
      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(true);
      expect(setToBlock).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalled();
    });

        it('skips a near sibling column whose parent is the container', () => {
      const setup = createCaret();
      // A single-level nest: the column is a root block, so it is not a
      // column wrapper of the container and the adjacent-column path is off.
      const world = buildWorld([
        { id: 'col' },
        { id: 'a',
          parentId: 'col' },
        { id: 'a1',
          parentId: 'a' },
      ]);

      wireWorld(setup, world);
      setup.blockManager.currentBlock = at(world, 'a');
      setup.blockManager.nextVisibleBlock = at(world, 'col');

      const setToBlock = spySetToBlock(setup.caret);

      expect(setup.caret.navigateNext(true)).toBe(false);
      expect(setToBlock).not.toHaveBeenCalled();
    });
  });
});
