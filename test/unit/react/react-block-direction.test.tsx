/**
 * A React block's portal commits after core's render(), so its text is not in
 * the DOM when the block is first composed. Its direction stamp has to land
 * once the text is there.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { Blok } from '../../../src/blok';
import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import {
  createBlockPortalRegistry,
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';

interface NoteData {
  text: string;
}

function Note({ data }: ReactBlockRenderProps<NoteData>): React.ReactElement {
  return <div contentEditable="true" suppressContentEditableWarning>{data.text}</div>;
}

const NoteTool = createReactBlock<NoteData>({
  type: 'note',
  propSchema: { text: { default: '' } },
  component: Note,
});

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

describe('per-block direction of a React block', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;
  let registry: BlockPortalRegistry;
  let unmountHost: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    registry = createBlockPortalRegistry();
  });

  afterEach(async () => {
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    unmountHost?.();
    unmountHost = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('stamps the block once its portal has committed the text', async () => {
    unmountHost = render(<BlockPortalHost registry={registry} />).unmount;

    await act(async () => {
      editor = new Blok({
        holder,
        tools: { note: { class: NoteTool, config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry } } },
        data: { blocks: [{ id: 'n', type: 'note', data: { text: 'مرحبا' } }] },
      });
      await editor.isReady;
    });
    await act(async () => {
      await frames(3);
    });

    const content = holder.querySelector('[data-blok-id="n"] [data-blok-element-content]');

    expect(content?.textContent).toBe('مرحبا');
    expect(content?.getAttribute('dir')).toBe('rtl');
  });

  it('re-stamps after an update re-renders the text', async () => {
    unmountHost = render(<BlockPortalHost registry={registry} />).unmount;

    await act(async () => {
      editor = new Blok({
        holder,
        tools: { note: { class: NoteTool, config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry } } },
        data: { blocks: [{ id: 'n', type: 'note', data: { text: 'Hello' } }] },
      });
      await editor.isReady;
    });
    await act(async () => {
      await (editor as unknown as { blocks: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> } }).blocks.update('n', { text: 'مرحبا' });
      await frames(3);
    });

    const content = holder.querySelector('[data-blok-id="n"] [data-blok-element-content]');

    expect(content?.textContent).toBe('مرحبا');
    expect(content?.getAttribute('dir')).toBe('rtl');
  });
});
