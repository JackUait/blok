import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { createRef } from 'react';
import { BlokEditor } from '../../../src/react/BlokEditor';
import type { Blok } from '@/types';

interface MockInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
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
    public save = vi.fn().mockResolvedValue({ blocks: [] });
    constructor(config: { holder: HTMLElement }) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-editor', 'true');
      wrapper.setAttribute('data-testid', 'blok-editor-inner');
      config.holder.appendChild(wrapper);
      this.isReady = Promise.resolve();
      instances.push(this as unknown as MockInstance);
    }
  },
}));

describe('BlokEditor', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the editor and applies className to the container', async () => {
    render(<BlokEditor className="my-editor" data-testid="editor-host" />);
    await act(async () => { await Promise.resolve(); });

    const host = screen.getByTestId('editor-host');
    expect(host.classList.contains('my-editor')).toBe(true);
    expect(screen.getByTestId('blok-editor-inner')).not.toBeNull();
  });

  it('forwards a typed ref to the live instance once ready (null before)', async () => {
    const ref = createRef<Blok | null>();
    render(<BlokEditor ref={ref} />);
    // Before isReady resolves, ref is null
    expect(ref.current).toBeNull();

    await act(async () => { await Promise.resolve(); });
    expect(ref.current).toBe(instances[0] as unknown as Blok);
    expect(typeof ref.current?.save).toBe('function');
  });

  it('treats data as seed-only: new data reference does NOT recreate or render', async () => {
    const { rerender } = render(<BlokEditor data={{ blocks: [] }} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(1);

    rerender(<BlokEditor data={{ blocks: [] }} />); // brand-new object reference
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1);            // not recreated
    expect(instances[0].render).not.toHaveBeenCalled(); // not re-seeded
  });

  it('recreates when deps change', async () => {
    const { rerender } = render(<BlokEditor deps={['a']} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(1);

    rerender(<BlokEditor deps={['b']} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(2);
  });

  it('fires onReady with the live instance after the ref is committed', async () => {
    const ref = createRef<Blok | null>();
    const onReady = vi.fn();
    render(<BlokEditor ref={ref} onReady={onReady} />);
    await act(async () => { await Promise.resolve(); });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toBe(instances[0] as unknown as Blok);
    expect(ref.current).toBe(instances[0] as unknown as Blok);
  });

  it('forwards id to the container element', async () => {
    render(<BlokEditor id="editor-entry-point" />);
    await act(async () => { await Promise.resolve(); });

    expect(document.getElementById('editor-entry-point')).not.toBeNull();
  });

  it('forwards arbitrary div props (aria-*, data-*, title) to the container', async () => {
    render(
      <BlokEditor
        data-testid="host"
        aria-label="My editor"
        data-section="body"
        title="hint"
      />
    );
    await act(async () => { await Promise.resolve(); });

    const host = screen.getByTestId('host');
    expect(host.getAttribute('aria-label')).toBe('My editor');
    expect(host.getAttribute('data-section')).toBe('body');
    expect(host.getAttribute('title')).toBe('hint');
  });

  it('does NOT leak editor-config props onto the container as attributes', async () => {
    render(<BlokEditor data-testid="host" readOnly theme="dark" placeholder="Type…" />);
    await act(async () => { await Promise.resolve(); });

    const host = screen.getByTestId('host');
    expect(host.hasAttribute('readonly')).toBe(false);
    expect(host.hasAttribute('theme')).toBe(false);
    expect(host.hasAttribute('placeholder')).toBe(false);
  });

  it('routes readOnly to the editor config (reactive), not the div', async () => {
    render(<BlokEditor data-testid="host" readOnly />);
    await act(async () => { await Promise.resolve(); });

    // readOnly reached useBlok → editor.readOnly.set was called
    expect(instances[0]?.readOnly.set).toHaveBeenCalledWith(true);
  });
});
