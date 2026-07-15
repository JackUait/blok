import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import { BlokContent } from '../../../packages/vue/src/BlokContent';
import { provideBlok, useBlokDefaults } from '../../../packages/vue/src/provide-blok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

/**
 * Mounts a child that uses the raw `useBlok` composable (the escape hatch — NOT
 * `<BlokEditor>`) under a parent that registers app-wide defaults. Returns the
 * config the mock editor was constructed with.
 */
async function mountChildWithDefaults(
  defaults: Partial<UseBlokConfig>,
  childConfig: UseBlokConfig
): Promise<Record<string, unknown>> {
  const Child = defineComponent({
    setup() {
      const editor = useBlok(() => childConfig);

      return () => h(BlokContent, { editor: editor.value });
    },
  });

  const Parent = defineComponent({
    setup() {
      provideBlok(defaults);

      return () => h(Child);
    },
  });

  mount(Parent);
  blokRegistry.last!.resolveReady();
  await flushPromises();

  return blokRegistry.last!.config;
}

describe('useBlok escape hatch honors provideBlok defaults', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies an injected default when the config omits it', async () => {
    const config = await mountChildWithDefaults({ theme: 'dark' }, {});

    expect(config.theme).toBe('dark');
  });

  it('lets the per-instance config override the injected default', async () => {
    const config = await mountChildWithDefaults({ theme: 'dark' }, { theme: 'light' });

    expect(config.theme).toBe('light');
  });

  it('merges tools registries (default + instance) instead of replacing', async () => {
    const shared = { paragraph: { class: 'P' } };
    const local = { header: { class: 'H' } };

    const config = await mountChildWithDefaults(
      { tools: shared as unknown as UseBlokConfig['tools'] },
      { tools: local as unknown as UseBlokConfig['tools'] }
    );

    expect(config.tools).toEqual({ paragraph: { class: 'P' }, header: { class: 'H' } });
  });

  it('works with no provider present (config passes through untouched)', async () => {
    const config = await mountChildWithDefaults({}, { theme: 'light' });

    expect(config.theme).toBe('light');
  });

  it('exposes the injected defaults via useBlokDefaults', () => {
    const seen: { value: Partial<UseBlokConfig> | null } = { value: null };

    const Child = defineComponent({
      setup() {
        seen.value = useBlokDefaults();

        return () => h('div');
      },
    });
    const Parent = defineComponent({
      setup() {
        provideBlok({ theme: 'dark' });

        return () => h(Child);
      },
    });

    mount(Parent);

    expect(seen.value).toEqual({ theme: 'dark' });
  });
});
