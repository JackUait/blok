import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { BlokEditor } from '../../../packages/react/src/BlokEditor';
import { useBlokHandle, type BlokEditorHandle } from '../../../packages/react/src/useBlokHandle';
import type { OutputData } from '../../../types';

interface MockInstance {
  render: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  config: { data?: unknown; onSave?: (data: OutputData) => void };
}

let instances: MockInstance[] = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void> = Promise.resolve();
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public tools = { update: vi.fn() };
    public render = vi.fn().mockResolvedValue(undefined);
    public clear = vi.fn().mockResolvedValue(undefined);
    public on = vi.fn();
    public off = vi.fn();
    public config: { holder: HTMLElement; data?: unknown; onSave?: (data: OutputData) => void };
    constructor(config: { holder: HTMLElement; data?: unknown; onSave?: (data: OutputData) => void }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this);
    }
  },
}));

const handleSlot: { current: BlokEditorHandle | null } = { current: null };

/**
 * The documented controlled setup: `<BlokEditor data … onSave …>` driven by
 * React state, with `useBlokHandle()` attached for imperative calls.
 * @param props - controlled content and the save callback
 * @param props.data - controlled document
 * @param props.onSave - controlled output half
 * @returns the editor element
 */
function Harness({ data, onSave }: { data: OutputData; onSave?: (payload: OutputData) => void }): React.ReactElement {
  const handle = useBlokHandle();

  handleSlot.current = handle;

  return <BlokEditor ref={handle.ref} data={data} onSave={onSave} />;
}

/** The handle attached to the mounted editor. */
const attachedHandle = (): BlokEditorHandle => {
  const handle = handleSlot.current;

  if (handle === null) {
    throw new Error('handle was never attached');
  }

  return handle;
};

/** The render chain is microtask-deferred, so drain several microtasks. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

describe('imperative handle vs the controlled data baseline', () => {
  beforeEach(() => {
    instances = [];
    handleSlot.current = null;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the draft again when controlled data restores it after an imperative clear()', async () => {
    // The host keeps the editor's own output in React state, wipes the editor
    // imperatively, then puts the draft back. The draft is content the editor
    // once emitted, but it is NOT what the editor holds any more — dismissing it
    // as an echo leaves the editor empty while React state says otherwise.
    const seed: OutputData = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const draft: OutputData = {
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }],
      time: 1,
      version: '1',
    };
    const onSave = vi.fn();

    const { rerender } = render(<Harness data={seed} onSave={onSave} />);
    await act(async () => { await flush(); });

    // The user types; the editor emits its serialized draft.
    act(() => { instances[0].config.onSave?.(draft); });
    expect(onSave).toHaveBeenCalledWith(draft);

    await act(async () => {
      await attachedHandle().clear();
      await flush();
    });
    expect(instances[0].clear).toHaveBeenCalledTimes(1);

    // Host restores the draft it kept in state.
    rerender(<Harness data={draft} onSave={onSave} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenCalledWith(draft);
  });

  it('renders a controlled revert after an imperative render() moved the editor past it', async () => {
    // Mirror image: the imperative render leaves the cached baseline pointing at
    // content the editor no longer shows, so a deliberate revert to that content
    // is deduped away and the editor keeps showing the imperative document.
    const seed: OutputData = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const other: OutputData = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'b' } }] };
    const revertToSeed: OutputData = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };

    const { rerender } = render(<Harness data={seed} />);
    await act(async () => { await flush(); });

    await act(async () => {
      await attachedHandle().render(other);
      await flush();
    });
    expect(instances[0].render).toHaveBeenCalledTimes(1);

    rerender(<Harness data={revertToSeed} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).toHaveBeenCalledTimes(2);
    expect(instances[0].render).toHaveBeenLastCalledWith(revertToSeed);
  });

  it('still dedupes an ordinary onSave echo (no imperative call in between)', async () => {
    // Guard rail: the fix must invalidate the echo bookkeeping at the site that
    // destroyed the content, NOT disable it.
    const seed: OutputData = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const draft: OutputData = {
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }],
      time: 1,
      version: '1',
    };
    const onSave = vi.fn();

    const { rerender } = render(<Harness data={seed} onSave={onSave} />);
    await act(async () => { await flush(); });

    act(() => { instances[0].config.onSave?.(draft); });

    rerender(<Harness data={draft} onSave={onSave} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).not.toHaveBeenCalled();
  });

  it('does not re-render a controlled value whose only delta is edit metadata', async () => {
    // A host that persists a stripped copy of the editor's document (no
    // `lastEditedAt` stamp, no envelope) is handing back content the editor
    // already shows — the same structural lens the echo window uses must apply
    // to the baseline, or the round-trip resets the caret for zero visual change.
    const stamped: OutputData = {
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' }, lastEditedAt: 1700000000000 }],
      time: 1,
      version: '1',
    };
    const stripped: OutputData = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };

    const { rerender } = render(<Harness data={stamped} />);
    await act(async () => { await flush(); });

    rerender(<Harness data={stripped} />);
    await act(async () => { await flush(); });

    expect(instances[0].render).not.toHaveBeenCalled();
  });
});
