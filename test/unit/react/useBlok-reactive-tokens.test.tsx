/**
 * Reactive `style.tokens` in the React adapter.
 *
 * `style` was a construction-only config key, so a host with a live light/dark
 * toggle could not drive Blok's theme tokens from React state — changing the
 * prop was inert unless the host also bumped `deps`, which destroys and
 * recreates the whole editor (losing caret, history and scroll). That pushed
 * hosts onto a `createGlobalStyle` sheet hand-targeting
 * `[data-blok-interface], [data-blok-popover], [data-blok-top-layer]`,
 * duplicating the stylesheet Blok already injects.
 *
 * `style.tokens` now flows through the runtime `editor.tokens` API, deduped by
 * deep equality so a fresh object literal with identical contents is a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import type { UseBlokConfig } from '../../../packages/react/src/types';

interface MockInstance {
  tokens: { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  destroy: ReturnType<typeof vi.fn>;
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
    public tokens = { set: vi.fn(), get: vi.fn().mockReturnValue({}) };
    public tools = { update: vi.fn() };
    public render = vi.fn();
    public config: { holder: HTMLElement };
    constructor(config: { holder: HTMLElement }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this as unknown as MockInstance);
    }
  },
}));

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  return <BlokContent editor={editor} data-testid="container" />;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useBlok reactive style.tokens', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes changed tokens through editor.tokens.set without recreating', async () => {
    const { rerender } = render(<Harness config={{ style: { tokens: { '--blok-popover-bg': '#fff' } } }} />);

    await flush();
    expect(instances).toHaveLength(1);

    rerender(<Harness config={{ style: { tokens: { '--blok-popover-bg': '#1f1f1f' } } }} />);
    await flush();

    expect(instances).toHaveLength(1);
    expect(instances[0]?.tokens.set).toHaveBeenLastCalledWith({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('does not re-push an identical token set passed as a fresh object', async () => {
    const { rerender } = render(<Harness config={{ style: { tokens: { '--blok-popover-bg': '#fff' } } }} />);

    await flush();

    const callsAfterMount = instances[0]?.tokens.set.mock.calls.length ?? 0;

    rerender(<Harness config={{ style: { tokens: { '--blok-popover-bg': '#fff' } } }} />);
    await flush();

    expect(instances[0]?.tokens.set.mock.calls.length).toBe(callsAfterMount);
  });

  it('applies an emptied token set so removed tokens stop applying', async () => {
    const { rerender } = render(<Harness config={{ style: { tokens: { '--blok-popover-bg': '#fff' } } }} />);

    await flush();

    rerender(<Harness config={{ style: { tokens: {} } }} />);
    await flush();

    expect(instances[0]?.tokens.set).toHaveBeenLastCalledWith({});
  });

  it('leaves tokens alone when style.tokens is absent', async () => {
    render(<Harness config={{ style: { nativeSelection: true } }} />);

    await flush();

    expect(instances[0]?.tokens.set).not.toHaveBeenCalled();
  });
});
