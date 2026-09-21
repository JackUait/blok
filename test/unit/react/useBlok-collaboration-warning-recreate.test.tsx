import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import type { UseBlokConfig } from '../../../packages/react/src/types';
import type { OutputData } from '@/types';

interface MockInstance {
  render: ReturnType<typeof vi.fn>;
  config: { data?: unknown };
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
    public config: { holder: HTMLElement; data?: unknown };
    constructor(config: { holder: HTMLElement; data?: unknown }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this);
    }
  },
}));

function Harness({ config, dep }: { config: UseBlokConfig; dep: string }): React.ReactElement {
  const editor = useBlok(config, [dep]);

  return <BlokContent editor={editor} data-testid="container" />;
}

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

const COLLABORATION: UseBlokConfig = {
  server: 'https://blok.example',
  collaboration: { doc: 'notes' },
};

describe('useBlok collaboration warning after a deps recreate', () => {
  let warnings: string[] = [];

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  };

  const collaborationWarnings = (): string[] =>
    warnings.filter((message) => message.includes('collaboration is on'));

  beforeEach(() => {
    instances = [];
    warnings = [];
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns again for the editor created by a deps change', async () => {
    // The one-warning flag is hook state, not per-editor state. After a deps
    // recreate the host gets no feedback at all that its `data` is being
    // ignored by a second live session.
    const { rerender } = render(<Harness config={{ ...COLLABORATION, data: doc('a') }} dep="one" />);

    await act(async () => {
      await flush();
    });

    rerender(<Harness config={{ ...COLLABORATION, data: doc('b') }} dep="one" />);
    await act(async () => {
      await flush();
    });

    expect(collaborationWarnings()).toHaveLength(1);

    rerender(<Harness config={{ ...COLLABORATION, data: doc('b') }} dep="two" />);
    await act(async () => {
      await flush();
    });

    expect(instances).toHaveLength(2);

    rerender(<Harness config={{ ...COLLABORATION, data: doc('c') }} dep="two" />);
    await act(async () => {
      await flush();
    });

    expect(instances[1].render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(2);
  });
});
