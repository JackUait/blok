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
});
