import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { type DependencyList } from 'react';
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
  config: { data?: unknown };
}

let instances: MockInstance[] = [];
// When set, the next constructed editor's render() rejects on its first call,
// then resolves on every subsequent call — simulating a transient failure.
let rejectFirstRender = false;

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void> = Promise.resolve();
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public render: ReturnType<typeof vi.fn>;
    public config: { holder: HTMLElement; data?: unknown };
    constructor(config: { holder: HTMLElement; data?: unknown }) {
      this.config = config;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);

      let calls = 0;
      const shouldRejectFirst = rejectFirstRender;
      this.render = vi.fn().mockImplementation(() => {
        calls += 1;
        if (shouldRejectFirst && calls === 1) {
          return Promise.reject(new Error('render failed'));
        }
        return Promise.resolve();
      });

      instances.push(this as unknown as MockInstance);
    }
  },
}));

function Harness({ config, deps }: { config: UseBlokConfig; deps?: DependencyList }) {
  const editor = useBlok(config, deps);
  return <BlokContent editor={editor} data-testid="container" />;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

describe('useBlok reactive data — render resilience', () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    instances = [];
    rejectFirstRender = false;
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
  });

  it('a failed render() does not surface as an unhandled promise rejection', async () => {
    rejectFirstRender = true;
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const next = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] };

    const { rerender } = render(<Harness config={{ data: seed }} />);
    await act(async () => { await flush(); });

    rerender(<Harness config={{ data: next }} />);
    await act(async () => { await flush(); });

    // The render rejected; the chain must own that rejection locally.
    expect(instances[0].render).toHaveBeenCalledWith(next);
    expect(unhandled).toHaveLength(0);
  });

  it('retries the same content after a failed render (does not lock the baseline)', async () => {
    rejectFirstRender = true;
    const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    // Two distinct references with identical content. The first render fails;
    // the second (same content, new ref) must still attempt a render rather than
    // being deduped against a baseline that never actually rendered.
    const attempt1 = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] };
    const attempt2 = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] };

    const { rerender } = render(<Harness config={{ data: seed }} />);
    await act(async () => { await flush(); });

    rerender(<Harness config={{ data: attempt1 }} />);
    await act(async () => { await flush(); });
    expect(instances[0].render).toHaveBeenCalledTimes(1); // failed attempt

    rerender(<Harness config={{ data: attempt2 }} />);
    await act(async () => { await flush(); });

    // The retry must have happened (and succeeded this time).
    expect(instances[0].render).toHaveBeenCalledTimes(2);
    expect(instances[0].render).toHaveBeenLastCalledWith(attempt2);
  });

  it('does not render on an editor destroyed in the same commit (deps + data change together)', async () => {
    const initial = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    const updated = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'b' } }] };

    const { rerender } = render(<Harness config={{ data: initial }} deps={[1]} />);
    await act(async () => { await flush(); });
    expect(instances).toHaveLength(1);

    // deps change forces recreate; data changes in the SAME commit. The stale
    // (destroyed) editor closure must not receive a render() call.
    rerender(<Harness config={{ data: updated }} deps={[2]} />);
    await act(async () => { await flush(); });

    expect(instances).toHaveLength(2); // recreated
    // The old editor was destroyed — it must never have rendered the new data.
    expect(instances[0].render).not.toHaveBeenCalled();
    // The new editor was constructed with `updated`, so it is already seeded.
    expect(instances[1].render).not.toHaveBeenCalled();
  });
});
