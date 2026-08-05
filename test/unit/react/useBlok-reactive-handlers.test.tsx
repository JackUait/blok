/**
 * Reactive callback PRESENCE (React adapter).
 *
 * `onSubmit`, `onSave`, `onBeforeRender` and `onAfterRender` were attached only
 * when the prop happened to be truthy at construction — and their mere presence
 * is load-bearing in core (an `onSubmit` turns Enter from "split the block" into
 * "serialize and submit"). A host whose "Enter sends" toggle lives in React
 * state therefore had to bump `deps` and destroy/rebuild the editor, losing the
 * caret and the undo history, or hand-roll a permanently-attached no-op that
 * cannot express "no onSubmit" at all.
 *
 * These tests pin the runtime path: a presence flip goes through
 * `editor.handlers.set(...)` on the SAME instance, in both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import type { UseBlokConfig } from '../../../packages/react/src/types';
import type { LiveHandlers } from '../../../types';

interface MockInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  tools: { update: ReturnType<typeof vi.fn>; setInlineToolbar: ReturnType<typeof vi.fn> };
  handlers: { set: ReturnType<typeof vi.fn> };
  config: UseBlokConfig & { holder: HTMLElement };
}

let instances: MockInstance[] = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady = Promise.resolve();
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public tools = { update: vi.fn(), setInlineToolbar: vi.fn() };
    public handlers = { set: vi.fn() };
    public render = vi.fn().mockResolvedValue(undefined);
    public config: UseBlokConfig & { holder: HTMLElement };
    constructor(config: UseBlokConfig & { holder: HTMLElement }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this);
    }
  },
}));

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  return <BlokContent editor={editor} data-testid="container" />;
}

/** Merge of every `handlers.set` payload pushed so far (last write wins). */
const appliedHandlers = (instance: MockInstance): LiveHandlers =>
  instance.handlers.set.mock.calls.reduce<LiveHandlers>(
    (merged, [payload]) => ({ ...merged, ...(payload as LiveHandlers) }),
    {}
  );

describe('useBlok reactive handler presence', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not attach onSubmit at construction when the prop is absent', async () => {
    render(<Harness config={{}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].config.onSubmit).toBeUndefined();
  });

  it('arms onSubmit on the SAME instance when the prop appears', async () => {
    const { rerender } = render(<Harness config={{}} />);

    await act(async () => {
      await Promise.resolve();
    });

    const onSubmit = vi.fn();

    rerender(<Harness config={{ onSubmit }} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances).toHaveLength(1);

    const applied = appliedHandlers(instances[0]);

    expect(typeof applied.onSubmit).toBe('function');

    /* The pushed handler is a stable wrapper that forwards to the latest prop. */
    applied.onSubmit?.({ blocks: [] }, instances[0] as never);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('clears onSubmit on the SAME instance when the prop disappears', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness config={{ onSubmit }} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(typeof instances[0].config.onSubmit).toBe('function');

    rerender(<Harness config={{}} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].handlers.set).toHaveBeenCalled();
    expect(appliedHandlers(instances[0])).toHaveProperty('onSubmit', undefined);
  });

  it('arms onSave with the baseline-recording wrapper, not the raw prop', async () => {
    const { rerender } = render(<Harness config={{}} />);

    await act(async () => {
      await Promise.resolve();
    });

    const onSave = vi.fn();

    rerender(<Harness config={{ onSave }} />);
    await act(async () => {
      await Promise.resolve();
    });

    const applied = appliedHandlers(instances[0]);

    expect(typeof applied.onSave).toBe('function');
    expect(applied.onSave).not.toBe(onSave);

    applied.onSave?.({ blocks: [] }, instances[0] as never);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not re-push when presence is unchanged across renders', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness config={{ onSubmit }} />);

    await act(async () => {
      await Promise.resolve();
    });

    const callsAfterMount = instances[0].handlers.set.mock.calls.length;

    rerender(<Harness config={{ onSubmit: vi.fn() }} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances[0].handlers.set.mock.calls.length).toBe(callsAfterMount);
  });
});
