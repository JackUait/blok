import React, { type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { BlokContent } from '../../../packages/react/src/BlokContent';
import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import { useBlokInstance } from '../../../packages/react/src/blok-instance-context';
import { useBlocks } from '../../../packages/react/src/useBlocks';
import { createBlockPortalRegistry } from '../../../packages/react/src/block-portal-registry';
import { setHolder, removeHolder } from '../../../packages/react/src/holder-map';
import { setRegistry, removeRegistry } from '../../../packages/react/src/registry-map';
import type { Blok } from '../../../types';
import type { BlockAPI } from '../../../types/api';
import type { API } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

interface FlatBlock {
  id: string;
  name: string;
  parentId: string | null;
}

interface FakeEditor {
  editor: Blok;
  /** Append a block to the flat tree and emit the editor's structural change. */
  addBlock(block: FlatBlock): void;
}

/**
 * A minimal stand-in for a live editor: the flat block list `useBlocks` reads
 * through, plus the `block changed` emitter it subscribes to.
 */
const makeFakeEditor = (initial: FlatBlock[]): FakeEditor => {
  const list = [...initial];
  const listeners = new Set<() => void>();

  const editor = {
    blocks: {
      getBlocksCount: (): number => list.length,
      getBlockByIndex: (index: number): FlatBlock | undefined => list[index],
      getBlockIndex: (id: string): number => list.findIndex(block => block.id === id),
    },
    on: (event: string, handler: () => void): void => {
      if (event === 'block changed') {
        listeners.add(handler);
      }
    },
    off: (_event: string, handler: () => void): void => {
      listeners.delete(handler);
    },
  } as unknown as Blok;

  return {
    editor,
    addBlock: (block: FlatBlock): void => {
      list.push(block);
      listeners.forEach(handler => handler());
    },
  };
};

const makeBlockApi = (id: string): BlockAPI =>
  ({
    id,
    contentIds: [],
    getChildren: () => [],
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI);

const makeApi = (): API => ({ blocks: { isPointerDragActive: false } } as unknown as API);

describe('block components reach the live editor through context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('useBlokInstance() inside a block component returns the editor that owns it', () => {
    const { editor } = makeFakeEditor([{ id: 'container', name: 'container', parentId: null }]);
    const registry = createBlockPortalRegistry();

    setHolder(editor, document.createElement('div'));
    setRegistry(editor, registry);

    const seen: (Blok | null)[] = [];

    function InstanceProbe(): ReactElement {
      seen.push(useBlokInstance());

      return <span className="view" />;
    }

    const Tool = createReactBlock({
      type: 'container',
      propSchema: {},
      component: InstanceProbe,
    });

    const { unmount } = render(<BlokContent editor={editor} />);

    const tool = new Tool({
      data: {},
      block: makeBlockApi('container'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    act(() => {
      tool.render();
    });

    expect(seen.at(-1)).toBe(editor);

    unmount();
    removeRegistry(editor);
    removeHolder(editor);
  });

  it('re-renders a container block when a NON-React child joins its subtree', () => {
    const { editor, addBlock } = makeFakeEditor([
      { id: 'container', name: 'container', parentId: null },
    ]);
    const registry = createBlockPortalRegistry();

    setHolder(editor, document.createElement('div'));
    setRegistry(editor, registry);

    function ChildCounter({ block }: ReactBlockRenderProps<Record<string, never>>): ReactElement {
      const blocks = useBlocks(useBlokInstance());

      return <span className="count">{blocks.getChildren(block.id).length}</span>;
    }

    const Tool = createReactBlock({
      type: 'container',
      propSchema: {},
      component: ChildCounter,
    });

    const { unmount } = render(<BlokContent editor={editor} />);

    const tool = new Tool({
      data: {},
      block: makeBlockApi('container'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const holder: { host: HTMLElement | null } = { host: null };

    act(() => {
      holder.host = tool.render();
    });

    const host = holder.host;

    if (host === null) {
      throw new Error('tool.render() did not run');
    }

    document.body.appendChild(host);
    expect(host.querySelector('.count')?.textContent).toBe('0');

    // A PLAIN CORE child: it registers no portal entry, so nothing in the
    // adapter's own machinery re-renders the parent — only the editor's
    // 'block changed' subscription can.
    act(() => {
      addBlock({ id: 'para', name: 'paragraph', parentId: 'container' });
    });

    expect(host.querySelector('.count')?.textContent).toBe('1');

    unmount();
    removeRegistry(editor);
    removeHolder(editor);
  });
});
