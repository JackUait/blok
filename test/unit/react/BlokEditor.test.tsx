import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { createRef } from 'react';
import { BlokEditor } from '../../../packages/react/src/BlokEditor';
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
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  config: Record<string, unknown>;
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
    public on = vi.fn();
    public off = vi.fn();
    public config: Record<string, unknown>;
    constructor(config: { holder: HTMLElement }) {
      this.config = config;
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

  it('dedupes data by content: a new reference with identical content does NOT recreate or render', async () => {
    const { rerender } = render(<BlokEditor data={{ blocks: [] }} />);
    await act(async () => { await Promise.resolve(); });
    expect(instances).toHaveLength(1);

    rerender(<BlokEditor data={{ blocks: [] }} />); // brand-new object reference, same content
    await act(async () => { await Promise.resolve(); });

    expect(instances).toHaveLength(1);            // not recreated
    expect(instances[0].render).not.toHaveBeenCalled(); // deep-equal: no redundant render
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

  it('fires onReady exactly once per instance under a StrictMode double-mount', async () => {
    const onReady = vi.fn();
    render(
      <React.StrictMode>
        <BlokEditor onReady={onReady} />
      </React.StrictMode>
    );
    await act(async () => { await Promise.resolve(); });

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('re-fires onReady with the NEW instance when deps change (per-instance, not once-per-lifetime)', async () => {
    const onReady = vi.fn();
    const { rerender } = render(<BlokEditor deps={['a']} onReady={onReady} />);
    await act(async () => { await Promise.resolve(); });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toBe(instances[0] as unknown as Blok);

    rerender(<BlokEditor deps={['b']} onReady={onReady} />);
    await act(async () => { await Promise.resolve(); });

    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady.mock.calls[1][0]).toBe(instances[1] as unknown as Blok);
  });

  it('forwards id to the container element', async () => {
    render(<BlokEditor id="editor-entry-point" data-testid="host" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('host').getAttribute('id')).toBe('editor-entry-point');
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

  it('subscribes to blocks:rendered / block:rendered and forwards the payloads', async () => {
    const onBlocksRendered = vi.fn();
    const onBlockRendered = vi.fn();
    render(<BlokEditor onBlocksRendered={onBlocksRendered} onBlockRendered={onBlockRendered} />);
    await act(async () => { await Promise.resolve(); });

    const inst = instances[0];
    const calls = inst.on.mock.calls as Array<[string, (payload: unknown) => void]>;
    const blocksHandler = calls.find((c) => c[0] === 'blocks:rendered')?.[1];
    const blockHandler = calls.find((c) => c[0] === 'block:rendered')?.[1];

    expect(typeof blocksHandler).toBe('function');
    expect(typeof blockHandler).toBe('function');

    blocksHandler?.({ count: 2 });
    blockHandler?.({ index: 1 });

    expect(onBlocksRendered).toHaveBeenCalledWith({ count: 2 });
    expect(onBlockRendered).toHaveBeenCalledWith({ index: 1 });
  });

  it('does not subscribe to rendered events when no handlers are provided', async () => {
    render(<BlokEditor />);
    await act(async () => { await Promise.resolve(); });

    const calls = instances[0].on.mock.calls as Array<[string, unknown]>;
    const subscribed = calls.map((c) => c[0]);
    expect(subscribed).not.toContain('blocks:rendered');
    expect(subscribed).not.toContain('block:rendered');
  });

  it('unsubscribes from rendered events on unmount', async () => {
    const { unmount } = render(<BlokEditor onBlocksRendered={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    const inst = instances[0];

    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(inst.off).toHaveBeenCalledWith('blocks:rendered', expect.any(Function));
  });

  it('does not leak rendered-event handlers onto the container as attributes', async () => {
    render(
      <BlokEditor
        data-testid="host"
        onBlocksRendered={() => undefined}
        onBlockRendered={() => undefined}
      />
    );
    await act(async () => { await Promise.resolve(); });

    const host = screen.getByTestId('host');
    expect(host.hasAttribute('onblocksrendered')).toBe(false);
    expect(host.hasAttribute('onblockrendered')).toBe(false);
  });

  it('routes onSave to the editor config, not onto the container as an attribute', async () => {
    const onSave = vi.fn();
    render(<BlokEditor data-testid="host" onSave={onSave} />);
    await act(async () => { await Promise.resolve(); });

    // onSave reached useBlok → forwarded into the editor config (ref-wrapped)
    expect(typeof instances[0]?.config.onSave).toBe('function');

    // and it did NOT leak onto the container element as an attribute
    const host = screen.getByTestId('host');
    expect(host.hasAttribute('onsave')).toBe(false);
  });

  it('routes onEnter to the editor config, not onto the container as an attribute', async () => {
    // Typed prop: (event, api) => boolean is accepted by BlokEditor
    const onEnter = vi.fn((_event: KeyboardEvent): boolean => true);
    render(<BlokEditor data-testid="host" onEnter={onEnter} />);
    await act(async () => { await Promise.resolve(); });

    // onEnter reached useBlok → forwarded into the editor config (ref-wrapped)
    expect(typeof instances[0]?.config.onEnter).toBe('function');

    // and it did NOT leak onto the container element as an attribute
    const host = screen.getByTestId('host');
    expect(host.hasAttribute('onenter')).toBe(false);
  });
});
