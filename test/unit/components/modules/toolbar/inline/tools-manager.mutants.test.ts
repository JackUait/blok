import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { InlineTool } from '../../../../../../types';
import { SelectionUtils } from '../../../../../../src/components/selection/index';
import { InlineToolsManager } from '../../../../../../src/components/modules/toolbar/inline/tools-manager';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mutation coverage for src/components/modules/toolbar/inline/tools-manager.ts.
 *
 * Every mutant recorded live on this file is killed here; no equivalent
 * mutants remain, so there are no equivalence proofs to record.
 *
 * These levers make the private paths observable through the public API:
 * - `resolveSelection` reads `selection` and `instance` as STATIC properties of
 *   SelectionUtils. The class declares both as instance fields only, so the
 *   statics are absent by default and `delete` restores the exact original
 *   shape after each test.
 * - The last fallback is the real `window.getSelection()`. An override branch is
 *   only distinguishable while that fallback yields nothing, so beforeEach
 *   clears its ranges; the one case that exercises the fallback itself sets
 *   neither override and attaches its anchor to the document, because jsdom
 *   drops a Range whose root is not the document.
 * - The `instance` override guard is unreachable while the `selection` guard
 *   returns first, so it needs a case where BOTH overrides are absent.
 * - `CommonInternalSettings.Shortcut` is the string 'shortcut', so the shortcut
 *   read off a created tool INSTANCE and the one read off the ADAPTER share a
 *   key. They must carry different values or the internal-tool branch is
 *   indistinguishable from the fallback.
 */
interface BlockLike {
  tool: { inlineTools: Map<string, InlineToolAdapter> };
}

type SelectionHost = { selection?: Selection | null; instance?: Selection | null };

const selectionHost = SelectionUtils as unknown as SelectionHost;

const createAdapter = (options: {
  name: string;
  adapterShortcut?: string;
  instanceShortcut?: string;
  isReadOnlySupported?: boolean;
}): InlineToolAdapter => ({
  name: options.name,
  title: options.name,
  shortcut: options.adapterShortcut,
  isReadOnlySupported: options.isReadOnlySupported ?? true,
  create: (): InlineTool => ({
    shortcut: options.instanceShortcut,
    render: () => document.createElement('button'),
  } as unknown as InlineTool),
} as unknown as InlineToolAdapter);

interface BlokHarness {
  blok: BlokModules;
  getBlock: Mock<(element: HTMLElement) => BlockLike | undefined>;
}

const createBlok = (options: {
  currentBlock?: BlockLike | null;
  blockFromElement?: BlockLike;
  inlineTools?: Map<string, InlineToolAdapter>;
  internalInlineTools?: Map<string, InlineToolAdapter>;
} = {}): BlokHarness => {
  const getBlock = vi.fn<(element: HTMLElement) => BlockLike | undefined>(() => options.blockFromElement);

  const blok = {
    Tools: {
      inlineTools: options.inlineTools ?? new Map<string, InlineToolAdapter>(),
      internal: { inlineTools: options.internalInlineTools ?? new Map<string, InlineToolAdapter>() },
    },
    ReadOnly: { isEnabled: false },
    BlockManager: {
      currentBlock: options.currentBlock ?? null,
      getBlock,
    },
  } as unknown as BlokModules;

  return { blok, getBlock };
};

const asSelection = (anchorNode: Node | null): Selection => ({ anchorNode } as unknown as Selection);

const blockWith = (adapter: InlineToolAdapter): BlockLike => ({
  tool: { inlineTools: new Map([[adapter.name, adapter]]) },
});

const attached: HTMLElement[] = [];

describe('InlineToolsManager mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete selectionHost.selection;
    delete selectionHost.instance;
    window.getSelection()?.removeAllRanges();

    while (attached.length > 0) {
      attached.pop()?.remove();
    }
  });

  describe('getToolShortcut', () => {
    it('prefers the created instance shortcut over the adapter shortcut for internal tools', () => {
      const adapter = createAdapter({ name: 'bold', adapterShortcut: 'ADAPTER', instanceShortcut: 'INSTANCE' });
      const tools = new Map([['bold', adapter]]);
      const { blok } = createBlok({ inlineTools: tools, internalInlineTools: tools });
      const manager = new InlineToolsManager(() => blok);

      expect(manager.getToolShortcut('bold')).toBe('INSTANCE');
    });

    it('returns undefined for an internal tool that has no registered adapter', () => {
      const ghost = createAdapter({ name: 'ghost', adapterShortcut: 'ADAPTER', instanceShortcut: 'INSTANCE' });
      const { blok } = createBlok({
        inlineTools: new Map(),
        internalInlineTools: new Map([['ghost', ghost]]),
      });
      const manager = new InlineToolsManager(() => blok);

      expect(manager.getToolShortcut('ghost')).toBeUndefined();
    });
  });

  describe('getAvailableTools selection fallback', () => {
    it('resolves the block from the selection override when there is no current block', () => {
      const adapter = createAdapter({ name: 'bold' });
      const { blok, getBlock } = createBlok({ blockFromElement: blockWith(adapter) });
      const manager = new InlineToolsManager(() => blok);
      const anchor = document.createElement('span');

      selectionHost.selection = asSelection(anchor);

      expect(manager.getAvailableTools()).toEqual([adapter]);
      expect(getBlock).toHaveBeenCalledWith(anchor);
    });

    it('resolves the block from the instance override when no selection override is set', () => {
      const adapter = createAdapter({ name: 'bold' });
      const { blok, getBlock } = createBlok({ blockFromElement: blockWith(adapter) });
      const manager = new InlineToolsManager(() => blok);
      const anchor = document.createElement('span');

      selectionHost.instance = asSelection(anchor);

      expect(manager.getAvailableTools()).toEqual([adapter]);
      expect(getBlock).toHaveBeenCalledWith(anchor);
    });

    it('falls back to the live window selection when neither override is set', () => {
      const adapter = createAdapter({ name: 'bold' });
      const { blok, getBlock } = createBlok({ blockFromElement: blockWith(adapter) });
      const manager = new InlineToolsManager(() => blok);
      const host = document.createElement('div');

      host.textContent = 'anchor text';
      document.body.appendChild(host);
      attached.push(host);

      const range = document.createRange();
      const textNode = host.firstChild;

      if (textNode === null) {
        throw new Error('expected a text node');
      }

      range.setStart(textNode, 0);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      expect(manager.getAvailableTools()).toEqual([adapter]);
      expect(getBlock).toHaveBeenCalledWith(host);
    });

    it('gives up when the anchor node has no element to resolve from', () => {
      const adapter = createAdapter({ name: 'bold' });
      const { blok, getBlock } = createBlok({ blockFromElement: blockWith(adapter) });
      const manager = new InlineToolsManager(() => blok);

      // A detached text node has a null parentElement, so no anchor element exists.
      selectionHost.selection = asSelection(document.createTextNode('orphan'));

      expect(manager.getAvailableTools()).toEqual([]);
      expect(getBlock).not.toHaveBeenCalled();
    });

    it('gives up when the resolved selection is null', () => {
      const adapter = createAdapter({ name: 'bold' });
      const { blok, getBlock } = createBlok({ blockFromElement: blockWith(adapter) });
      const manager = new InlineToolsManager(() => blok);

      selectionHost.selection = null;

      expect(manager.getAvailableTools()).toEqual([]);
      expect(getBlock).not.toHaveBeenCalled();
    });
  });
});
