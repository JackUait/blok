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
    constructor(config: { holder: HTMLElement }) {
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
});
