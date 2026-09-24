/**
 * A React container block must host the descendants of a slotless child after a
 * reload, the same way core's toggle and callout do (see withSlotlessDescendants).
 *
 * Boots the REAL core (this package's vitest config aliases it to `src/`): the
 * adapter's slot commits after core has already placed every holder, so only
 * the adapter's own mount can bring the grandchild into the slot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { useBlok, BlokContent, createReactBlock } from '../src';
import type { UseBlokConfig, ReactBlockRenderProps } from '../src';
import type { Blok } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';

const Steps = createReactBlock<Record<string, never>>({
  type: 'steps',
  propSchema: {},
  component: ({ BlockChildren }: ReactBlockRenderProps<Record<string, never>>) => (
    <div data-testid="steps">
      <BlockChildren />
    </div>
  ),
});

const TOOLS: UseBlokConfig['tools'] = {
  paragraph: { class: Paragraph },
  steps: Steps,
};

const DATA: UseBlokConfig['data'] = {
  blocks: [
    { id: 'steps', type: 'steps', data: {}, content: ['child'] },
    { id: 'child', type: 'paragraph', data: { text: 'child' }, parent: 'steps', content: ['grandchild'] },
    { id: 'grandchild', type: 'paragraph', data: { text: 'grandchild' }, parent: 'child' },
    { id: 'after', type: 'paragraph', data: { text: 'after' } },
  ],
};

let editors: Blok[] = [];

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  useEffect(() => {
    if (editor !== null && !editors.includes(editor)) {
      editors.push(editor);
    }
  }, [editor]);

  return <BlokContent editor={editor} data-testid="container" />;
}

describe('React container block hosting a slotless child subtree (real core)', () => {
  beforeEach(() => {
    editors = [];
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Let useBlok's deferred destroy (setTimeout 0) run after RTL's unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.restoreAllMocks();
  });

  it('mounts the grandchild in the container slot, right after its parent', async () => {
    const { getByTestId } = render(<Harness config={{ tools: TOOLS, data: DATA }} />);

    await waitFor(() => {
      expect(editors.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    const container = getByTestId('container');

    await waitFor(() => {
      expect(container.querySelector('[data-blok-nested-blocks] [data-blok-id="child"]')).not.toBeNull();
    }, { timeout: 5000 });

    const slot = container.querySelector<HTMLElement>('[data-blok-nested-blocks]');
    const grandchild = container.querySelector<HTMLElement>('[data-blok-id="grandchild"]');

    expect(grandchild?.parentElement).toBe(slot);
    expect(Array.from(slot?.children ?? []).map(el => el.getAttribute('data-blok-id'))).toStrictEqual([
      'child',
      'grandchild',
    ]);
  });
});
