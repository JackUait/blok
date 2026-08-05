import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { createBlockPortalRegistry } from '../../../packages/angular/src/block-portal-registry';
import { injectBlokInstance } from '../../../packages/angular/src/blok-instance';
import { injectBlocks } from '../../../packages/angular/src/useBlocks';
import type { Blok } from '../../../types';
import type { API, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import type { BlockAPI } from '../../../types/api';

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

interface FlatBlock {
  id: string;
  name: string;
  parentId: string | null;
}

const makeFakeEditor = (
  initial: FlatBlock[]
): { editor: Blok; addBlock: (block: FlatBlock) => void } => {
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

const seen: (Blok | null)[] = [];

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  template: `<span class="count">{{ childCount() }}</span>`,
})
class ContainerProbe {
  private readonly editor = injectBlokInstance();
  private readonly blocks = injectBlocks(this.editor);

  childCount(): number {
    seen.push(this.editor());

    return this.blocks.getChildren('container').length;
  }
}

const makeBlockApi = (id: string): BlockAPI =>
  ({ id, contentIds: [], getChildren: () => [], dispatchChange: vi.fn() } as unknown as BlockAPI);

const makeApi = (): API => ({ blocks: { isPointerDragActive: false } } as unknown as API);

describe('Angular block components reach the live editor through DI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seen.length = 0;
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('injectBlokInstance() returns the editor that owns the block, and drives useBlocks', () => {
    const { editor, addBlock } = makeFakeEditor([
      { id: 'container', name: 'container', parentId: null },
    ]);
    const instance = signal<Blok | null>(editor);

    const appRef = TestBed.inject(ApplicationRef);
    const registry = createBlockPortalRegistry(
      TestBed.inject(EnvironmentInjector),
      appRef,
      TestBed.inject(ErrorHandler),
      instance
    );

    const Tool = createAngularBlock({
      type: 'container',
      propSchema: {},
      component: ContainerProbe,
    });
    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeBlockApi('container'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    const host = tool.render();

    expect(seen.at(-1)).toBe(editor);
    expect(host.querySelector('.count')?.textContent).toBe('0');

    // A PLAIN CORE child: nothing in the adapter re-renders the container; only
    // the editor's 'block changed' subscription can.
    addBlock({ id: 'para', name: 'paragraph', parentId: 'container' });
    // No adapter-side flush: the block was marked dirty by the version signal
    // `injectBlocks` bumps on 'block changed', so a plain tick re-renders it.
    appRef.tick();

    expect(host.querySelector('.count')?.textContent).toBe('1');

    registry.destroyAll();
  });
});
