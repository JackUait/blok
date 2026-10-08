import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, act, waitFor } from '@testing-library/react';
import React from 'react';

import { BlokEditor } from '../../../packages/react/src/BlokEditor';
import { Paragraph } from '../../../src/tools/paragraph';
import type { Blok } from '@/types';

const TOOLS = { paragraph: { class: Paragraph } };

const unmounts: Array<() => void> = [];

const render = (ui: React.ReactElement): ReturnType<typeof rtlRender> => {
  const result = rtlRender(ui);

  unmounts.push(result.unmount);

  return result;
};

const readyEditor = async (onReady: ReturnType<typeof vi.fn>): Promise<Blok> => {
  await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 5000 });
  const editor: unknown = onReady.mock.calls[onReady.mock.calls.length - 1][0];

  return editor as Blok;
};

describe('BlokEditor pageTitle prop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    unmounts.splice(0).forEach((unmount) => unmount());
    // useBlok defers destroy by a timer; flush it so editors do not leak into the next test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('forwards pageTitle into the editor config', async () => {
    const onReady = vi.fn();
    const { container } = render(
      <BlokEditor tools={TOOLS} pageTitle={{ placeholder: 'Untitled' }} onReady={onReady} />
    );

    await readyEditor(onReady);

    const title = container.querySelector('[data-blok-testid="page-header-title"]');

    expect(title).not.toBeNull();
    expect(title?.getAttribute('data-placeholder')).toBe('Untitled');
  });

  it('loads the title from data', async () => {
    const onReady = vi.fn();

    render(<BlokEditor tools={TOOLS} pageTitle data={{ title: 'T', blocks: [] }} onReady={onReady} />);

    const editor = await readyEditor(onReady);

    expect(editor.title.get()).toBe('T');
  });

  it('calls the onChange of the latest render', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const onReady = vi.fn();
    const { rerender } = render(<BlokEditor tools={TOOLS} pageTitle={{ onChange: a }} onReady={onReady} />);
    const before = await readyEditor(onReady);

    rerender(<BlokEditor tools={TOOLS} pageTitle={{ onChange: b }} onReady={onReady} />);

    // A recreated editor would call b with no fix at all.
    expect(onReady).toHaveBeenCalledTimes(1);
    act(() => before.title.set('x'));

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith('x', { source: 'api' });
  });

  it('calls the onIconChange of the latest render', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const onReady = vi.fn();
    const { rerender } = render(<BlokEditor tools={TOOLS} pageTitle={{ onIconChange: a }} onReady={onReady} />);
    const before = await readyEditor(onReady);

    rerender(<BlokEditor tools={TOOLS} pageTitle={{ onIconChange: b }} onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    act(() => before.title.icon.set({ type: 'emoji', value: '🚀' }));

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('hears an onChange added after mounting with pageTitle: true', async () => {
    const b = vi.fn();
    const onReady = vi.fn();
    const { rerender } = render(<BlokEditor tools={TOOLS} pageTitle onReady={onReady} />);
    const before = await readyEditor(onReady);

    rerender(<BlokEditor tools={TOOLS} pageTitle={{ onChange: b }} onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    act(() => before.title.set('x'));

    expect(b).toHaveBeenCalledTimes(1);
  });
});
