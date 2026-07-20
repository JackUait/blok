import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import { BlokEditor } from '../../../packages/react/src/BlokEditor';
import type { UseBlokConfig } from '../../../packages/react/src/types';

interface MockInstance {
  isReady: Promise<void>;
  resolveReady: () => void;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  tools: { update: ReturnType<typeof vi.fn> };
  config: { data?: unknown; onSave?: (...args: unknown[]) => void };
}

let instances: MockInstance[] = [];
// When true, the next constructed editor keeps isReady pending until its
// resolveReady() is called — lets a test re-render with new data BEFORE the
// editor reports ready (the pre-isReady race).
let deferReady = false;

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void>;
    public resolveReady: () => void = () => undefined;
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public tools = { update: vi.fn() };
    public render = vi.fn();
    public config: { holder: HTMLElement; data?: unknown; onSave?: (...args: unknown[]) => void };
    constructor(config: { holder: HTMLElement; data?: unknown; onSave?: (...args: unknown[]) => void }) {
      this.config = config;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      if (deferReady) {
        this.isReady = new Promise<void>((resolve) => {
          this.resolveReady = resolve;
        });
      } else {
        this.isReady = Promise.resolve();
      }
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
    deferReady = false;
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

  it('normalizes object readOnly config to a boolean for readOnly.set', async () => {
    render(<Harness config={{ readOnly: { hideControls: true } }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances[0].readOnly.set).toHaveBeenLastCalledWith(true);
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
    deferReady = false;
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

  it('does not re-render a STALE echo — an earlier onSave payload arriving after a newer one', async () => {
    // The persist-and-refetch pattern: every save PUTs to a server whose
    // refetch feeds `data` back. The user keeps typing, so by the time the
    // refetch for save #1 resolves, save #2 already replaced the baseline.
    // Rendering that stale echo would clobber the caret AND the content typed
    // since — it is still the editor's own output, so it must be a no-op.
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const save1 = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }], time: 1, version: '1' };
    const save2 = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'abc' } }], time: 2, version: '1' };
    const onSave = vi.fn();

    const { rerender } = render(<Harness config={{ data: seed, onSave }} />);
    await act(async () => { await flush(); });

    act(() => { instances[0].config.onSave?.(save1); });
    act(() => { instances[0].config.onSave?.(save2); });

    // Refetch for save #1 resolves LAST — a fresh object with save #1's content
    // (server round-trips stamp their own envelope).
    const staleEcho = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }], time: 99 };
    rerender(<Harness config={{ data: staleEcho, onSave }} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1);
    expect(instances[0].render).not.toHaveBeenCalled();
  });

  it('does not re-render an echo whose ids were stripped by the backend', async () => {
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const payload = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }], time: 1, version: '1' };
    const onSave = vi.fn();

    const { rerender } = render(<Harness config={{ data: seed, onSave }} />);
    await act(async () => { await flush(); });

    act(() => { instances[0].config.onSave?.(payload); });

    // Legacy backends drop block ids; the content is still the editor's own.
    const idlessEcho = { blocks: [{ type: 'paragraph', data: { text: 'ab' } }] };
    rerender(<Harness config={{ data: idlessEcho, onSave }} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).not.toHaveBeenCalled();
  });

  it('renders emitted-window content again once external content has taken over', async () => {
    // After a genuine external render, earlier onSave payloads are moot: a
    // host that deliberately reverts to one of them must get a real render.
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const payload = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }], time: 1, version: '1' };
    const external = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'external' } }] };
    const revert = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }], time: 5 };
    const onSave = vi.fn();

    const { rerender } = render(<Harness config={{ data: seed, onSave }} />);
    await act(async () => { await flush(); });

    act(() => { instances[0].config.onSave?.(payload); });

    rerender(<Harness config={{ data: external, onSave }} />);
    await act(async () => { await flush(); });
    expect(instances[0].render).toHaveBeenCalledTimes(1);

    rerender(<Harness config={{ data: revert, onSave }} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).toHaveBeenCalledTimes(2);
    expect(instances[0].render).toHaveBeenLastCalledWith(revert);
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

  it('renders when data transitions from undefined to a loaded value after mount', async () => {
    // The async-fetch pattern: <BlokEditor data={fetched} /> mounts while the
    // content is still undefined, then the fetch resolves and `data` becomes
    // defined. The editor was seeded with nothing, so it MUST render the loaded
    // content — not silently stay empty.
    const loaded = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'loaded' } }] };

    const { rerender } = render(<Harness config={{ data: undefined }} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1);
    expect(instances[0].render).not.toHaveBeenCalled();

    rerender(<Harness config={{ data: loaded }} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenCalledWith(loaded);
  });

  it('renders the latest data when the prop changes before the editor becomes ready', async () => {
    // The editor is constructed with the mount-time data but does not surface
    // until isReady resolves. If the parent re-renders with new content during
    // that window, the editor was built with the STALE value — once ready it
    // must render the latest prop, not silently keep the construction-time data.
    deferReady = true;
    const initial = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'initial' } }] };
    const updated = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'updated' } }] };

    const { rerender } = render(<Harness config={{ data: initial }} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1);

    // Prop changes BEFORE isReady resolves (editor not yet surfaced).
    rerender(<Harness config={{ data: updated }} />);
    await act(async () => { await flush(); });

    // Now the editor reports ready.
    await act(async () => {
      instances[0].resolveReady();
      await flush();
    });

    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].render).toHaveBeenCalledWith(updated);
  });

  it('content → empty → content re-renders in place: one instance, one onReady, no recreation', async () => {
    // Pins the contract the JSDoc promises: transitions to and from empty
    // content are ordinary render() calls on the SAME instance — the editor is
    // never recreated and onReady never re-fires for a data change.
    const content = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const empty = { blocks: [] };
    const onReady = vi.fn();

    const { rerender } = render(<BlokEditor data={content} onReady={onReady} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1);
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(<BlokEditor data={empty} onReady={onReady} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1); // not recreated
    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenLastCalledWith(empty);

    rerender(<BlokEditor data={content} onReady={onReady} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1); // still the same instance
    expect(instances[0].render).toHaveBeenCalledTimes(2);
    expect(instances[0].render).toHaveBeenLastCalledWith(content);
    expect(onReady).toHaveBeenCalledTimes(1); // never re-fired
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

  it('accepts a deep-frozen data prop without throwing and never mutates it', async () => {
    // Host apps pass data straight from frozen stores (Redux/Immer); the
    // adapter and the editor must never write through to the prop object.
    const deepFreeze = <T,>(value: T): T => {
      if (value !== null && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };

    const v1 = deepFreeze({ blocks: [{ id: '1', type: 'paragraph', data: { text: 'one' } }] });
    const v2 = deepFreeze({ blocks: [{ id: '1', type: 'paragraph', data: { text: 'two' } }] });
    const v1Snapshot = structuredClone(v1);
    const v2Snapshot = structuredClone(v2);

    const { rerender } = render(<Harness config={{ data: v1 }} />);
    await act(async () => { await flush(); });

    rerender(<Harness config={{ data: v2 }} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).toHaveBeenCalledWith(v2);
    expect(v1).toEqual(v1Snapshot);
    expect(v2).toEqual(v2Snapshot);
  });
});

describe('useBlok reactive tool-level toolbox setting', () => {
  beforeEach(() => {
    instances = [];
    deferReady = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  class GoodsTool {}

  const toolsFor = (canManage: boolean): UseBlokConfig['tools'] =>
    ({
      goods: {
        class: GoodsTool,
        config: { canManage },
        ...(canManage ? {} : { toolbox: false as const }),
      },
    }) as unknown as UseBlokConfig['tools'];

  it('applies a toolbox visibility flip via tools.update without recreating the editor', async () => {
    const { rerender } = render(<Harness config={{ tools: toolsFor(true) }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1);
    expect(instances[0].tools.update).not.toHaveBeenCalled();

    rerender(<Harness config={{ tools: toolsFor(false) }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1); // no recreate
    expect(instances[0].tools.update).toHaveBeenCalledWith('goods', { toolbox: false });

    rerender(<Harness config={{ tools: toolsFor(true) }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances[0].tools.update).toHaveBeenLastCalledWith('goods', { toolbox: undefined });
  });

  it('does not call tools.update when the toolbox setting is unchanged (new object, same content)', async () => {
    const withEntry = (): UseBlokConfig['tools'] =>
      ({ goods: { class: GoodsTool, toolbox: { title: 'Goods' } } }) as unknown as UseBlokConfig['tools'];

    const { rerender } = render(<Harness config={{ tools: withEntry() }} />);
    await act(async () => { await Promise.resolve(); });

    rerender(<Harness config={{ tools: withEntry() }} />);
    await act(async () => { await Promise.resolve(); });

    expect(instances[0].tools.update).not.toHaveBeenCalled();
  });

  it('defers a toolbox change until the editor is ready, then applies it', async () => {
    deferReady = true;

    const { rerender } = render(<Harness config={{ tools: toolsFor(true) }} />);
    await act(async () => { await Promise.resolve(); });

    rerender(<Harness config={{ tools: toolsFor(false) }} />);
    await act(async () => { await Promise.resolve(); });

    // Editor not ready yet: the tools API is not attached, so nothing is applied.
    expect(instances[0].tools.update).not.toHaveBeenCalled();

    await act(async () => {
      instances[0].resolveReady();
      await Promise.resolve();
    });

    expect(instances[0].tools.update).toHaveBeenCalledWith('goods', { toolbox: false });
  });
});
