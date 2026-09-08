import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

import { InlineSelectionValidator } from '../../../../../../src/components/modules/toolbar/inline/selection-validator';
import { SelectionUtils } from '../../../../../../src/components/selection';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mutation coverage for InlineSelectionValidator.
 *
 * Equivalent mutants: none. Every recorded mutant is killed.
 *
 * Techniques that were needed to make mutants observable:
 * - Exact `toEqual` on the whole result object. `reason` strings overlap
 *   ("...for current block" contains "block"), so substring assertions cannot
 *   tell the block gate from the tools gate apart.
 * - Every negative case is built on top of an otherwise-allowed scenario, so a
 *   deleted `return` falls through to `{ allowed: true }` instead of to another
 *   rejection.
 * - `SelectionUtils.get` returns a valid selection once and something else
 *   afterwards. `canShow` and `getTools` each resolve the selection separately,
 *   which is the only way to drive the getTools fallback branches while the
 *   earlier gates in `canShow` still pass.
 * - A spy on the block Map `has` proves the tool list was empty. The
 *   `[] -> ["Stryker was here"]` mutant yields the same `reason`, and only the
 *   fact that the predicate ran at all separates it.
 * - `SelectionUtils.selection` / `.instance` are instance fields, so the class
 *   object never carries them. They are assigned onto the constructor here and
 *   deleted afterwards, which is the only way to reach either override branch.
 */

type FakeBlock = {
  tool: { inlineTools: Map<string, InlineToolAdapter> };
  holder: HTMLElement | null;
};

type BlockManagerStub = {
  currentBlock: FakeBlock | null | undefined;
  getBlock: Mock<(element: HTMLElement | null) => FakeBlock | null | undefined>;
};

type ReadOnlyStub = {
  isEnabled: boolean;
  isControlsHidden: boolean;
};

/** The two test-only overrides `resolveSelection` reads off the class object. */
type SelectionOverrides = {
  selection?: Selection | null;
  instance?: Selection | null;
};

describe('InlineSelectionValidator — mutation coverage', () => {
  let validator: InlineSelectionValidator;
  let blockManager: BlockManagerStub;
  let readOnly: ReadOnlyStub;
  let getSpy: MockInstance<() => Selection | null>;
  let atBlokSpy: MockInstance<(selection: Selection | null) => boolean>;

  const overrides = SelectionUtils as unknown as SelectionOverrides;

  const makeTool = (name: string, isReadOnlySupported = true): InlineToolAdapter => {
    return { name, isReadOnlySupported } as unknown as InlineToolAdapter;
  };

  const makeBlock = (options: { holder?: HTMLElement | null; tools?: InlineToolAdapter[] } = {}): FakeBlock => {
    const tools = options.tools ?? [makeTool('bold')];

    return {
      tool: { inlineTools: new Map(tools.map((tool) => [tool.name, tool])) },
      holder: options.holder === undefined ? document.createElement('div') : options.holder,
    };
  };

  const makeSelection = (
    anchorNode: Node | null,
    focusNode: Node | null = null,
    isCollapsed = false
  ): Selection => {
    return { anchorNode, focusNode, isCollapsed, rangeCount: 1 } as unknown as Selection;
  };

  const setSelection = (selection: Selection | null): void => {
    getSpy.mockReturnValue(selection);
  };

  const setSelectionText = (text: string): void => {
    vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue(text);
  };

  /** Text node inside a contenteditable host, attached to the document. */
  const mountEditable = (): Text => {
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');

    const text = document.createTextNode('hello');

    editable.appendChild(text);
    document.body.appendChild(editable);

    return text;
  };

  /** Text node inside a plain host, so neither the target nor its ancestors are editable. */
  const mountPlain = (): Text => {
    const host = document.createElement('div');
    const text = document.createTextNode('hello');

    host.appendChild(text);
    document.body.appendChild(host);

    return text;
  };

  const useBlock = (block: FakeBlock): void => {
    blockManager.currentBlock = block;
    blockManager.getBlock.mockReturnValue(block);
  };

  beforeEach(() => {
    vi.clearAllMocks();

    document.body.innerHTML = '';

    blockManager = {
      currentBlock: undefined,
      getBlock: vi.fn<(element: HTMLElement | null) => FakeBlock | null | undefined>(),
    };
    readOnly = { isEnabled: false, isControlsHidden: false };

    const modules = { BlockManager: blockManager, ReadOnly: readOnly } as unknown as BlokModules;

    validator = new InlineSelectionValidator(() => modules);

    getSpy = vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
    atBlokSpy = vi.spyOn(SelectionUtils, 'isSelectionAtBlok').mockReturnValue(true);
    setSelectionText('selected');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // Plain assignments on the class object; restoreAllMocks does not undo them.
    delete overrides.selection;
    delete overrides.instance;
  });

  it('reports hidden controls before any other gate', () => {
    setSelection(makeSelection(mountEditable()));
    useBlock(makeBlock());
    readOnly.isControlsHidden = true;

    expect(validator.canShow()).toEqual({
      allowed: false,
      reason: 'Editor controls are hidden in read-only mode',
    });
  });

  it('accepts a selection of exactly one character', () => {
    setSelection(makeSelection(mountEditable()));
    setSelectionText('a');
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('rejects an anchor node that has no parent element', () => {
    setSelection(makeSelection(document.createTextNode('detached')));
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Target element is null' });
  });

  it('rejects a selection whose anchor sits in a code block', () => {
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    editable.innerHTML = '<pre><code>code</code></pre>';
    document.body.appendChild(editable);

    const code = editable.querySelector('code');

    expect(code).not.toBeNull();

    const anchor = code === null ? document.createTextNode('') : code.childNodes[0];

    setSelection(makeSelection(anchor, null));
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Selection is inside a code block' });
  });

  it('rejects a selection whose focus alone sits in a code block', () => {
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    editable.innerHTML = '<p>prose</p><pre><code>code</code></pre>';
    document.body.appendChild(editable);

    const prose = editable.querySelector('p');
    const code = editable.querySelector('code');

    expect(prose).not.toBeNull();
    expect(code).not.toBeNull();

    const anchor = prose === null ? document.createTextNode('') : prose.childNodes[0];
    const focus = code === null ? document.createTextNode('') : code.childNodes[0];

    setSelection(makeSelection(anchor, focus));
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Selection is inside a code block' });
  });

  it('falls back to the current block when the anchor resolves to no block', () => {
    setSelection(makeSelection(mountEditable()));

    const block = makeBlock();

    blockManager.currentBlock = block;
    blockManager.getBlock.mockReturnValue(null);

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('rejects when the anchor block and the current block are both null', () => {
    setSelection(makeSelection(mountEditable()));
    blockManager.currentBlock = null;
    blockManager.getBlock.mockReturnValue(null);

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Current block is null or undefined' });
  });

  it('rejects when the anchor block and the current block are both undefined', () => {
    setSelection(makeSelection(mountEditable()));
    blockManager.currentBlock = undefined;
    blockManager.getBlock.mockReturnValue(undefined);

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Current block is null or undefined' });
  });

  it('accepts an editable target even when the block holder is not editable', () => {
    setSelection(makeSelection(mountEditable()));
    useBlock(makeBlock({ holder: document.createElement('div') }));

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('rejects when neither the target nor the block holder is editable', () => {
    setSelection(makeSelection(mountPlain()));
    useBlock(makeBlock({ holder: document.createElement('div') }));
    readOnly.isEnabled = false;
    atBlokSpy.mockReturnValue(true);

    expect(validator.canShow()).toEqual({ allowed: false, reason: 'Target is not contenteditable' });
  });

  it('accepts when the block holder itself is editable', () => {
    const holder = document.createElement('div');

    holder.setAttribute('contenteditable', 'true');

    setSelection(makeSelection(mountPlain()));
    useBlock(makeBlock({ holder }));

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('accepts when the block holder sits inside an editable ancestor', () => {
    const editableAncestor = document.createElement('div');
    const holder = document.createElement('div');

    editableAncestor.setAttribute('contenteditable', 'true');
    editableAncestor.appendChild(holder);
    document.body.appendChild(editableAncestor);

    setSelection(makeSelection(mountPlain()));
    useBlock(makeBlock({ holder }));

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('accepts a read-only selection that is inside Blok', () => {
    setSelection(makeSelection(mountPlain()));
    useBlock(makeBlock({ holder: document.createElement('div') }));
    readOnly.isEnabled = true;
    atBlokSpy.mockReturnValue(true);

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('rejects a read-only selection that is outside Blok', () => {
    setSelection(makeSelection(mountPlain()));
    useBlock(makeBlock({ holder: document.createElement('div') }));
    readOnly.isEnabled = true;
    atBlokSpy.mockReturnValue(false);

    expect(validator.canShow()).toEqual({
      allowed: false,
      reason: 'Read-only mode and selection not at Blok',
    });
  });

  it('drops inline tools that do not support read-only mode', () => {
    setSelection(makeSelection(mountEditable()));
    useBlock(makeBlock({ tools: [makeTool('bold', false)] }));
    readOnly.isEnabled = true;

    expect(validator.canShow()).toEqual({
      allowed: false,
      reason: 'No inline tools available for current block',
    });
  });

  it('resolves the tool list from the anchor when BlockManager has no current block', () => {
    setSelection(makeSelection(mountEditable()));

    const block = makeBlock();

    blockManager.currentBlock = undefined;
    blockManager.getBlock.mockReturnValue(block);

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('resolves no tools when the selection is gone by the time tools are read', () => {
    const block = makeBlock();
    const hasSpy = vi.spyOn(block.tool.inlineTools, 'has');

    blockManager.currentBlock = undefined;
    blockManager.getBlock.mockReturnValue(block);
    getSpy.mockReturnValueOnce(makeSelection(mountEditable())).mockReturnValue(null);

    expect(validator.canShow()).toEqual({
      allowed: false,
      reason: 'No inline tools available for current block',
    });
    expect(hasSpy).not.toHaveBeenCalled();
  });

  it('resolves no tools when the fallback anchor has no parent element', () => {
    const block = makeBlock();

    blockManager.currentBlock = undefined;
    blockManager.getBlock.mockReturnValue(block);
    getSpy
      .mockReturnValueOnce(makeSelection(mountEditable()))
      .mockReturnValue(makeSelection(document.createTextNode('detached')));

    expect(validator.canShow()).toEqual({
      allowed: false,
      reason: 'No inline tools available for current block',
    });
  });

  it('prefers the SelectionUtils selection override over the live selection', () => {
    overrides.selection = makeSelection(mountEditable());
    setSelection(null);
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: true });
  });

  it('falls back to the SelectionUtils instance override over the live selection', () => {
    overrides.instance = makeSelection(mountEditable());
    setSelection(null);
    useBlock(makeBlock());

    expect(validator.canShow()).toEqual({ allowed: true });
  });
});
