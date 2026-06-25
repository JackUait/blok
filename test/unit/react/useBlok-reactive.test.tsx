import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../src/react/useBlok';
import { BlokContent } from '../../../src/react/BlokContent';
import type { UseBlokConfig } from '../../../src/react/types';

interface MockInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  config: { onSave?: (...args: unknown[]) => void };
}

let instances: MockInstance[] = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void>;
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public render = vi.fn();
    public config: { holder: HTMLElement; onSave?: (...args: unknown[]) => void };
    constructor(config: { holder: HTMLElement; onSave?: (...args: unknown[]) => void }) {
      this.config = config;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      this.isReady = Promise.resolve();
      instances.push(this as unknown as MockInstance);
    }
  },
}));

function Harness({ config }: { config: UseBlokConfig }) {
  const editor = useBlok(config);
  return <BlokContent editor={editor} data-testid="container" />;
}

describe('useBlok reactive theme/width', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs theme via editor.theme.set without recreating', async () => {
    const { rerender } = render(<Harness config={{ theme: 'light' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(1);

    rerender(<Harness config={{ theme: 'dark' }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1); // no recreate
    expect(instances[0].theme.set).toHaveBeenLastCalledWith('dark');
  });

  it('syncs width via editor.width.set without recreating', async () => {
    const { rerender } = render(<Harness config={{ width: 'narrow' }} />);
    await act(async () => { await Promise.resolve(); });

    rerender(<Harness config={{ width: 'full' }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1);
    expect(instances[0].width.set).toHaveBeenLastCalledWith('full');
  });

  it('syncs placeholder via editor.placeholder.set without recreating', async () => {
    const { rerender } = render(<Harness config={{ placeholder: 'First' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(1);
    expect(instances[0].placeholder.set).toHaveBeenCalledWith('First');

    rerender(<Harness config={{ placeholder: 'Second' }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].placeholder.set).toHaveBeenLastCalledWith('Second');
  });

  it('propagates placeholder=false (clear) — guards on undefined, not falsiness', async () => {
    const { rerender } = render(<Harness config={{ placeholder: 'Hint' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances[0].placeholder.set).toHaveBeenCalledWith('Hint');

    rerender(<Harness config={{ placeholder: false }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].placeholder.set).toHaveBeenLastCalledWith(false);
  });
});

describe('useBlok reactive data', () => {
  /**
   * The render chain is microtask-deferred (serialized), so flush several
   * microtasks to let queued editor.render() calls run.
   */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render on initial mount (data is seeded at construction)', async () => {
    render(<Harness config={{ data: { blocks: [] } }} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1);
    expect(instances[0].render).not.toHaveBeenCalled();
  });

  it('renders new data reactively when content changes, without recreating', async () => {
    const first = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const second = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] };

    const { rerender } = render(<Harness config={{ data: first }} />);
    await act(async () => { await flush(); });
    expect(instances[0].render).not.toHaveBeenCalled();

    rerender(<Harness config={{ data: second }} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenCalledWith(second);
  });

  it('does not render when a new data reference has identical content (deep-equal dedup)', async () => {
    const { rerender } = render(
      <Harness config={{ data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'x' } }] } }} />
    );
    await act(async () => { await flush(); });

    rerender(
      <Harness config={{ data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'x' } }] } }} />
    );
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1);
    expect(instances[0].render).not.toHaveBeenCalled();
  });

  it('does not re-render (no caret reset) when controlled data echoes the onSave payload', async () => {
    // Editor is seeded, the user edits, and the serialized payload carries a
    // fresh time/version so it does NOT deep-equal the seed. A naive controlled
    // setup would render() it back in and reset the caret — the editor already
    // reflects this content, so it must be a no-op.
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const payload = {
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }],
      time: 123,
      version: '1',
    };
    const onSave = vi.fn();

    const { rerender } = render(<Harness config={{ data: seed, onSave }} />);
    await act(async () => { await flush(); });
    expect(instances[0].render).not.toHaveBeenCalled();

    // Editor emits onSave (a user edit, serialized) -> forwarded to the consumer
    act(() => { instances[0].config.onSave?.(payload); });
    expect(onSave).toHaveBeenCalledWith(payload);

    // Controlled consumer echoes the payload straight back into `data`
    rerender(<Harness config={{ data: payload, onSave }} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1);            // not recreated
    expect(instances[0].render).not.toHaveBeenCalled(); // no render -> caret preserved
  });

  it('still renders a genuine external change that differs from the last onSave payload', async () => {
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const payload = {
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }],
      time: 123,
      version: '1',
    };
    const external = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'loaded elsewhere' } }] };
    const onSave = vi.fn();

    const { rerender } = render(<Harness config={{ data: seed, onSave }} />);
    await act(async () => { await flush(); });

    act(() => { instances[0].config.onSave?.(payload); });

    // A different document (not the editor's own output) must still render
    rerender(<Harness config={{ data: external, onSave }} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenCalledWith(external);
  });

  it('serializes successive data changes in order', async () => {
    const v1 = { blocks: [{ id: '1', type: 'paragraph', data: { text: '1' } }] };
    const v2 = { blocks: [{ id: '1', type: 'paragraph', data: { text: '2' } }] };

    const { rerender } = render(<Harness config={{ data: v1 }} />);
    await act(async () => { await flush(); });

    rerender(<Harness config={{ data: v2 }} />);
    await act(async () => { await flush(); });

    const calls = instances[0].render.mock.calls;

    expect(calls.at(-1)?.[0]).toEqual(v2);
  });
});
