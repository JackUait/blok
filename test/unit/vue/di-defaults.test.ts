import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../src/vue/BlokEditor';
import { provideBlok } from '../../../src/vue/provide-blok';
import type { UseBlokConfig } from '../../../src/vue/types';

/** Mounts BlokEditor under a parent that provides app-wide defaults. */
async function mountWithDefaults(
  defaults: Partial<UseBlokConfig>,
  editorProps: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const Parent = defineComponent({
    setup() {
      provideBlok(defaults);

      return () => h(BlokEditor, editorProps);
    },
  });

  mount(Parent);
  blokRegistry.last!.resolveReady();
  await flushPromises();

  return blokRegistry.last!.config;
}

describe('BlokEditor provideBlok DI defaults', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies an injected default when the prop is absent', async () => {
    const config = await mountWithDefaults({ theme: 'dark' }, {});

    expect(config.theme).toBe('dark');
  });

  it('lets a per-instance prop override the injected default', async () => {
    const config = await mountWithDefaults({ theme: 'dark' }, { theme: 'light' });

    expect(config.theme).toBe('light');
  });

  it('merges tools registries (default + instance) instead of replacing', async () => {
    const shared = { paragraph: { class: 'P' } };
    const local = { header: { class: 'H' } };

    const config = await mountWithDefaults(
      { tools: shared as unknown as UseBlokConfig['tools'] },
      { tools: local }
    );

    expect(config.tools).toEqual({ paragraph: { class: 'P' }, header: { class: 'H' } });
  });

  it('works with no provider (defaults absent)', async () => {
    const Solo = defineComponent({
      setup() {
        return () => h(BlokEditor, { theme: 'light' });
      },
    });

    mount(Solo);
    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect((blokRegistry.last!.config as { theme?: unknown }).theme).toBe('light');
  });
});
