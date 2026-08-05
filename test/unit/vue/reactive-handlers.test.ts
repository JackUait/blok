/**
 * Reactive callback PRESENCE (Vue adapter).
 *
 * `<BlokEditor>` gates the core callbacks on listener presence (`@save`,
 * `v-model:data`, `@change`, …) and `useBlok` copied them into the construction
 * snapshot once. Since callback presence IS the semantics in core — an
 * `onSubmit` turns Enter from "split the block" into "serialize and submit", an
 * `onSave` arms the change-observation pipeline — a listener added or removed
 * after mount could only take effect by recreating the editor.
 *
 * These tests pin the runtime path: presence flips go through
 * `editor.handlers.set(...)` on the SAME instance, in both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { LiveHandlers } from '@/types';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

/** Merge of every `handlers.set` payload pushed so far (last write wins). */
function appliedHandlers(): LiveHandlers {
  const calls = blokRegistry.last?.handlers.set.mock.calls ?? [];

  return calls.reduce<LiveHandlers>(
    (merged, [payload]) => ({ ...merged, ...(payload as LiveHandlers) }),
    {}
  );
}

/**
 * Mounts `useBlok` against a reactive config ref and resolves the editor.
 * @param initial - the config the editor is constructed with
 * @returns the live config ref so a test can flip a handler after mount
 */
async function mountWith(initial: UseBlokConfig): Promise<Ref<UseBlokConfig>> {
  const config = ref<UseBlokConfig>(initial);

  mount(
    defineComponent({
      setup() {
        useBlok(config);

        return () => h('div');
      },
    })
  );

  blokRegistry.last?.resolveReady();
  await flushPromises();

  return config;
}

describe('useBlok reactive handler presence', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not attach onSubmit at construction when the config omits it', async () => {
    await mountWith({});

    expect(blokRegistry.instances).toHaveLength(1);
    expect(blokRegistry.last?.config.onSubmit).toBeUndefined();
  });

  it('arms onSubmit on the SAME instance when the config gains it', async () => {
    const config = await mountWith({});
    const onSubmit = vi.fn();

    config.value = { onSubmit };
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);

    const applied = appliedHandlers();

    expect(typeof applied.onSubmit).toBe('function');

    applied.onSubmit?.({ blocks: [] }, {} as never);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('clears onSubmit on the SAME instance when the config drops it', async () => {
    const onSubmit = vi.fn();
    const config = await mountWith({ onSubmit });

    expect(typeof blokRegistry.last?.config.onSubmit).toBe('function');

    config.value = {};
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(appliedHandlers()).toHaveProperty('onSubmit', undefined);
  });

  it('arms onSave with the baseline-recording wrapper, not the raw callback', async () => {
    const config = await mountWith({});
    const onSave = vi.fn();

    config.value = { onSave };
    await flushPromises();

    const applied = appliedHandlers();

    expect(typeof applied.onSave).toBe('function');
    expect(applied.onSave).not.toBe(onSave);

    applied.onSave?.({ blocks: [] }, {} as never);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not re-push when presence is unchanged', async () => {
    const config = await mountWith({ onSubmit: vi.fn() });
    const callsAfterMount = blokRegistry.last?.handlers.set.mock.calls.length ?? 0;

    config.value = { onSubmit: vi.fn() };
    await flushPromises();

    expect(blokRegistry.last?.handlers.set.mock.calls.length ?? 0).toBe(callsAfterMount);
  });
});
