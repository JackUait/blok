import { EnvironmentInjector, computed, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { injectBlocks } from '../../../packages/angular/src/useBlocks';
import type { Blok } from '../../../types';

type FakeRecord = { id: string; name: string; parentId: string | null };

/** card → step, plus an unrelated root block with a child of its own. */
const TREE: FakeRecord[] = [
  { id: 'card', name: 'card', parentId: null },
  { id: 'step', name: 'paragraph', parentId: 'card' },
  { id: 'elsewhere', name: 'paragraph', parentId: null },
  { id: 'elsewhere-child', name: 'paragraph', parentId: 'elsewhere' },
];

const makeFakeEditor = (): { editor: Blok; emit: (targetId: string) => void } => {
  const flat = [...TREE];
  const handlers: Array<(payload?: unknown) => void> = [];
  const wrap = (r: FakeRecord): unknown => ({ id: r.id,
    name: r.name,
    parentId: r.parentId });

  const editor = {
    blocks: {
      getBlocksCount: () => flat.length,
      getBlockByIndex: (i: number) => (flat[i] === undefined ? undefined : wrap(flat[i])),
      getBlockIndex: (id: string) => {
        const i = flat.findIndex(b => b.id === id);

        return i === -1 ? undefined : i;
      },
      getById: (id: string) => {
        const r = flat.find(b => b.id === id);

        return r === undefined ? null : wrap(r);
      },
      transact: vi.fn((fn: () => void) => fn()),
    },
    on: (_e: string, h: (payload?: unknown) => void) => handlers.push(h),
    off: vi.fn(),
  } as unknown as Blok;

  return {
    editor,
    emit: (targetId: string) => {
      handlers.forEach(h => h({ event: { detail: { target: { id: targetId } } } }));
    },
  };
};

const run = <T>(fn: () => T): T => runInInjectionContext(TestBed.inject(EnvironmentInjector), fn);

/**
 * Angular signals are pull-based too, so scoping is observable as "the computed
 * did not re-evaluate": read it after each emission and count evaluations.
 */
const setup = (within?: unknown): { evaluations: () => number; read: () => string; emit: (id: string) => void } => {
  const { editor, emit } = makeFakeEditor();
  let evaluations = 0;

  const children = run(() => {
    const api = injectBlocks(
      signal<Blok | null>(editor),
      within === undefined ? {} : { within: within as string }
    );

    return computed(() => {
      evaluations += 1;

      return api.getChildren('card').map(n => n.id).join(',');
    });
  });

  // Prime the computed so later reads measure invalidation, not first access.
  expect(children()).toBe('step');

  return { evaluations: () => evaluations,
    read: () => children(),
    emit };
};

describe('injectBlocks (Angular) — within: subtree-scoped reactivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
  });

  afterEach(() => vi.restoreAllMocks());

  it('invalidates reads for a change inside the scope', () => {
    const { evaluations, read, emit } = setup('card');
    const before = evaluations();

    emit('step');
    read();

    expect(evaluations()).toBeGreaterThan(before);
  });

  it('leaves reads untouched for a change in an unrelated subtree', () => {
    const { evaluations, read, emit } = setup('card');
    const before = evaluations();

    emit('elsewhere-child');
    read();

    expect(evaluations()).toBe(before);
  });

  it('stays document-wide when no scope is given', () => {
    const { evaluations, read, emit } = setup();
    const before = evaluations();

    emit('elsewhere-child');
    read();

    expect(evaluations()).toBeGreaterThan(before);
  });

  it('accepts the scope as a signal, read at emit time', () => {
    const { editor, emit } = makeFakeEditor();
    const within = signal<string | null>('card');
    let evaluations = 0;

    const children = run(() => {
      const api = injectBlocks(signal<Blok | null>(editor), { within });

      return computed(() => {
        evaluations += 1;

        return api.getChildren('card').map(n => n.id).join(',');
      });
    });

    expect(children()).toBe('step');

    within.set('elsewhere');
    const before = evaluations;

    emit('elsewhere-child');
    children();

    expect(evaluations).toBeGreaterThan(before);
  });
});
