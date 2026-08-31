import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import type { UseBlokConfig } from '../../../packages/react/src/types';
import type { OutputData } from '@/types';

interface MockInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  tools: { update: ReturnType<typeof vi.fn> };
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

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  return <BlokContent editor={editor} data-testid="container" />;
}

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

const COLLABORATION: UseBlokConfig = {
  server: 'https://blok.example',
  collaboration: { doc: 'notes' },
};

describe('useBlok controlled data under collaboration', () => {
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

  it('seeds data at mount without rendering or warning', async () => {
    render(<Harness config={{ ...COLLABORATION, data: doc('seed') }} />);
    await act(async () => {
      await flush();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].config.data).toEqual(doc('seed'));
    expect(instances[0].render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(0);
  });

  it('skips the controlled re-render and warns once across repeated data changes', async () => {
    const { rerender } = render(<Harness config={{ ...COLLABORATION, data: doc('a') }} />);

    await act(async () => {
      await flush();
    });

    // A render the adapter must never reach: reaching it would also surface an
    // unhandled rejection, which is the bug this guard removes.
    instances[0].render.mockRejectedValue(
      new Error('blocks.render() is not allowed while collaboration is on')
    );

    rerender(<Harness config={{ ...COLLABORATION, data: doc('b') }} />);
    await act(async () => {
      await flush();
    });
    rerender(<Harness config={{ ...COLLABORATION, data: doc('c') }} />);
    await act(async () => {
      await flush();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].render).not.toHaveBeenCalled();

    const seen = collaborationWarnings();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('POST /sync/notes/reset');
  });

  it('skips data that arrives after an undefined-at-mount seed', async () => {
    // The seed branch falls THROUGH to a render when the prop diverged from what
    // the editor was constructed with — the one path where "initial" and "change"
    // blur, and the guard has to hold there too.
    const { rerender } = render(<Harness config={{ ...COLLABORATION }} />);

    await act(async () => {
      await flush();
    });

    rerender(<Harness config={{ ...COLLABORATION, data: doc('loaded') }} />);
    await act(async () => {
      await flush();
    });

    expect(instances[0].render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(1);
  });

  it('still re-renders on a data change when collaboration is off', async () => {
    const { rerender } = render(<Harness config={{ data: doc('a') }} />);

    await act(async () => {
      await flush();
    });

    const next = doc('b');

    rerender(<Harness config={{ data: next }} />);
    await act(async () => {
      await flush();
    });

    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(instances[0].render).toHaveBeenCalledWith(next);
    expect(collaborationWarnings()).toHaveLength(0);
  });
});
