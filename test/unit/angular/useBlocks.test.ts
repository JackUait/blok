import { Component, EnvironmentInjector, runInInjectionContext, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { injectBlocks } from '../../../src/angular/useBlocks';
import type { UseBlocksApi } from '../../../src/angular/blocks-snapshot';
import type { Blok } from '../../../types';

const ALL_METHODS = [
  'getById', 'getChildren', 'insert', 'insertMany', 'insertTree', 'insertMarkdown',
  'move', 'nest', 'unnest', 'remove', 'update', 'convert', 'transact',
  'transactWithoutCapture', 'getBlocksCount', 'getCurrentBlockIndex', 'getBlockByIndex',
  'getBlockByElement', 'getBlockData', 'getBlockIndex', 'composeBlockData', 'renderFromHTML',
  'insertOutputData', 'splitBlock', 'insertInsideParent', 'render', 'clear', 'isSyncingFromYjs',
] as const;

type FakeRecord = { id: string; name: string; parentId: string | null };

const makeFakeEditor = (initial: FakeRecord[]): { editor: Blok; handlers: Array<() => void> } => {
  const flat = [...initial];
  const handlers: Array<() => void> = [];
  const wrap = (r: FakeRecord): unknown => ({ id: r.id, name: r.name, parentId: r.parentId, preservedData: {}, preservedTunes: {} });
  const blocks = {
    getBlocksCount: () => flat.length,
    getBlockByIndex: (i: number) => (flat[i] === undefined ? undefined : wrap(flat[i])),
    getBlockIndex: (id: string) => { const i = flat.findIndex((b) => b.id === id); return i === -1 ? undefined : i; },
    getById: (id: string) => { const r = flat.find((b) => b.id === id); return r === undefined ? null : wrap(r); },
    getChildren: (parentId: string) => flat.filter((b) => b.parentId === parentId).map(wrap),
    isSyncingFromYjs: false,
    insert: vi.fn(), insertMany: vi.fn(() => []), insertInsideParent: vi.fn(),
    setBlockParent: vi.fn(), move: vi.fn(), delete: vi.fn(() => Promise.resolve()),
    update: vi.fn(), convert: vi.fn(), composeBlockData: vi.fn(), render: vi.fn(() => Promise.resolve()),
    renderFromHTML: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()),
    splitBlock: vi.fn(), getCurrentBlockIndex: vi.fn(() => 0), getBlockByElement: vi.fn(),
    transact: vi.fn((fn: () => void) => fn()), transactWithoutCapture: vi.fn((fn: () => void) => fn()),
  };
  const editor = {
    blocks,
    caret: { setToBlock: vi.fn() },
    on: (_e: string, h: () => void) => handlers.push(h),
    off: vi.fn(),
  } as unknown as Blok;

  return { editor, handlers };
};

const run = <T>(fn: () => T): T => {
  const env = TestBed.inject(EnvironmentInjector);

  return runInInjectionContext(env, fn);
};

describe('injectBlocks (Angular) — React/Vue parity surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  afterEach(() => vi.restoreAllMocks());

  it('exposes every method of the shared UseBlocksApi (28-method parity)', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const api = run(() => injectBlocks(signal<Blok | null>(editor)));

    for (const method of ALL_METHODS) {
      expect(typeof (api as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('delegates reads to the bound editor', () => {
    const { editor } = makeFakeEditor([{ id: 'a', name: 'paragraph', parentId: null }]);
    const api = run(() => injectBlocks(signal<Blok | null>(editor)));

    expect(api.getBlockByIndex(0)?.id).toBe('a');
    expect(api.getBlocksCount()).toBe(1);
  });

  it('is a no-op safe facade while the editor is null (EMPTY_API)', () => {
    const api = run(() => injectBlocks(signal<Blok | null>(null)));

    expect(api.getBlocksCount()).toBe(0);
    expect(api.getById('x')).toBeNull();
  });

  it('remove is subtree-aware: deletes the block AND its descendants', () => {
    const { editor } = makeFakeEditor([
      { id: 'p', name: 'toggle', parentId: null },
      { id: 'c1', name: 'paragraph', parentId: 'p' },
    ]);
    const api = run(() => injectBlocks(signal<Blok | null>(editor)));

    api.remove('p');

    expect((editor.blocks.delete as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
