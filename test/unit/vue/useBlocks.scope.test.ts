import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useBlocks } from '../../../packages/vue/src/useBlocks';
import type { Blok } from '../../../types';

type FakeRecord = { id: string; name: string; parentId: string | null };

/** card → step, plus an unrelated root block with a child of its own. */
const TREE: FakeRecord[] = [
  { id: 'card', name: 'card', parentId: null },
  { id: 'step', name: 'paragraph', parentId: 'card' },
  { id: 'elsewhere', name: 'paragraph', parentId: null },
  { id: 'elsewhere-child', name: 'paragraph', parentId: 'elsewhere' },
];

const makeFakeEditor = (): {
  editor: Blok;
  emit: (targetId: string) => void;
} => {
  const flat = [...TREE];
  const handlers: Array<(payload?: unknown) => void> = [];
  const wrap = (r: FakeRecord): unknown => ({ id: r.id, name: r.name, parentId: r.parentId });

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

/**
 * Mounts a component whose render reads `getChildren` through a computed, and
 * counts how many times that computed actually re-evaluates. Vue's reactivity is
 * pull-based, so the observable effect of scoping is that an out-of-scope change
 * does not invalidate the computed.
 */
const mountCounting = (within?: unknown): { evaluations: () => number; emit: (id: string) => void } => {
  const { editor, emit } = makeFakeEditor();
  let evaluations = 0;

  const Host = defineComponent({
    setup() {
      const api = useBlocks(editor, within === undefined ? {} : { within: within as string });
      const children = computed(() => {
        evaluations += 1;

        return api.getChildren('card').map(n => n.id);
      });

      return () => h('div', children.value.join(','));
    },
  });

  const wrapper = mount(Host);

  // Force the initial evaluation before any emission.
  expect(wrapper.text()).toBe('step');

  return { evaluations: () => evaluations,
    emit };
};

describe('Vue useBlocks — within: subtree-scoped reactivity', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('invalidates reads for a change inside the scope', async () => {
    const { evaluations, emit } = mountCounting('card');
    const before = evaluations();

    emit('step');
    await nextTick();

    expect(evaluations()).toBeGreaterThan(before);
  });

  it('leaves reads untouched for a change in an unrelated subtree', async () => {
    const { evaluations, emit } = mountCounting('card');
    const before = evaluations();

    emit('elsewhere-child');
    await nextTick();

    expect(evaluations()).toBe(before);
  });

  it('stays document-wide when no scope is given', async () => {
    const { evaluations, emit } = mountCounting();
    const before = evaluations();

    emit('elsewhere-child');
    await nextTick();

    expect(evaluations()).toBeGreaterThan(before);
  });

  it('tracks a reactive scope without re-subscribing', async () => {
    // Vue passes editors as refs/getters, so the scope has to accept the same —
    // and it is read at EMIT time, so changing it needs no new subscription.
    const { editor, emit } = makeFakeEditor();
    const within = ref<string | null>('card');
    let evaluations = 0;

    const Host = defineComponent({
      setup() {
        const api = useBlocks(editor, { within });
        const children = computed(() => {
          evaluations += 1;

          return api.getChildren('card').map(n => n.id);
        });

        return () => h('div', children.value.join(','));
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.text()).toBe('step');

    // Changing the scope must not itself be a reactive trigger — it is read at
    // emit time, so no re-subscription and no spurious invalidation.
    within.value = 'elsewhere';
    await nextTick();

    const before = evaluations;

    emit('elsewhere-child');
    await nextTick();

    expect(evaluations).toBeGreaterThan(before);
  });
});
