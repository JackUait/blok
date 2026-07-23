import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import type { OutputData } from '@/types';

/** The config object core was constructed with (after useBlok's wrapping). */
function coreConfig(): Record<string, unknown> {
  return blokRegistry.last!.config;
}

async function mountEditor(options: Parameters<typeof mount>[1] = {}): Promise<void> {
  mount(BlokEditor, options);
  blokRegistry.last!.resolveReady();
  await flushPromises();
}

describe('BlokEditor callbacks + gating', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires core onChange only when a change listener exists', async () => {
    await mountEditor({ attrs: { onChange: (): void => undefined } });

    expect(typeof coreConfig().onChange).toBe('function');
  });

  it('does NOT wire core onChange without a change listener', async () => {
    await mountEditor();

    expect(coreConfig().onChange).toBeUndefined();
  });

  it('forwards { api, event } when core onChange fires', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onChange: (): void => undefined } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const api = { blocks: {} };
    const event = { type: 'block-added' };

    (coreConfig().onChange as (api: unknown, event: unknown) => void)(api, event);

    expect(wrapper.emitted('change')?.[0]?.[0]).toEqual({ api, event });
  });

  it('wires core onSave when a v-model:data (update:data) listener exists', async () => {
    await mountEditor({ attrs: { 'onUpdate:data': (): void => undefined } });

    expect(typeof coreConfig().onSave).toBe('function');
  });

  it('wires core onSave when a save listener exists', async () => {
    await mountEditor({ attrs: { onSave: (): void => undefined } });

    expect(typeof coreConfig().onSave).toBe('function');
  });

  it('does NOT wire core onSave when neither save nor update:data is listened', async () => {
    await mountEditor();

    expect(coreConfig().onSave).toBeUndefined();
  });

  it('emits both save and update:data from a single core save', async () => {
    const wrapper = mount(BlokEditor, {
      attrs: { onSave: (): void => undefined, 'onUpdate:data': (): void => undefined },
    });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const payload = { blocks: [], time: 1, version: '1' } as OutputData;

    (coreConfig().onSave as (data: OutputData) => void)(payload);

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(payload);
    expect(wrapper.emitted('update:data')?.[0]?.[0]).toEqual(payload);
  });

  it('threads the onBeforeRender prop return value into core', async () => {
    const blocks = [{ type: 'paragraph', data: { text: 'x' } }];
    const transformed = [{ type: 'paragraph', data: { text: 'y' } }];
    const onBeforeRender = vi.fn().mockReturnValue(transformed);

    await mountEditor({ props: { onBeforeRender } });

    const result = (coreConfig().onBeforeRender as (b: unknown) => unknown)(blocks);

    expect(onBeforeRender).toHaveBeenCalledWith(blocks);
    expect(result).toBe(transformed);
  });

  it('threads the onBeforePaste prop return value into core', async () => {
    const onBeforePaste = vi.fn().mockReturnValue('<b>clean</b>');

    await mountEditor({ props: { onBeforePaste } });

    const result = (coreConfig().onBeforePaste as (html: string) => unknown)('<b>dirty</b>');

    expect(onBeforePaste).toHaveBeenCalledWith('<b>dirty</b>');
    expect(result).toBe('<b>clean</b>');
  });

  it('threads the onEnter prop return value into core', async () => {
    const onEnter = vi.fn().mockReturnValue(true);

    await mountEditor({ props: { onEnter } });

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    const api = { blocks: {} };
    const result = (coreConfig().onEnter as (event: unknown, api: unknown) => unknown)(event, api);

    expect(onEnter).toHaveBeenCalledWith(event, api);
    expect(result).toBe(true);
  });

  it('threads the onError prop into core', async () => {
    const onError = vi.fn();

    await mountEditor({ props: { onError } });

    const error = new Error('boom');

    (coreConfig().onError as (error: Error, context: { source: string }) => void)(error, { source: 'save' });

    expect(onError).toHaveBeenCalledWith(error, { source: 'save' });
  });
});
