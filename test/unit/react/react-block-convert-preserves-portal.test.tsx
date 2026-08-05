/**
 * C2 half (b), the CONVERT residual, end to end against a REAL editor.
 *
 * `BlockMutation.replace` (turn-into, markdown shortcut) goes through
 * `Blocks.insert(index, block, replace = true)`, which:
 *   1. composes the REPLACEMENT block first — its constructor runs the target
 *      tool's `render()`, registering a portal under the PRESERVED block id, and
 *   2. only then calls `REMOVED` + `destroy()` on the block being replaced.
 *
 * So the superseded tool's teardown always lands AFTER the live entry exists.
 * An unqualified `registry.unregister(id)` there deletes the entry the
 * replacement just created, nothing re-registers it, and the converted block's
 * holder stays empty until reload. The tools pass their own host element so the
 * registry's ownership check can reject the stale teardown.
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
import type { Blocks } from '../../../types/api';

interface CardData {
  title: string;
}

interface BadgeData {
  label: string;
}

function Card({ data }: ReactBlockRenderProps<CardData>): React.ReactElement {
  return <span className="card-title">{data.title}</span>;
}

function Badge({ data }: ReactBlockRenderProps<BadgeData>): React.ReactElement {
  return <span className="badge-label">{data.label}</span>;
}

const CardTool = createReactBlock<CardData>({
  type: 'card',
  propSchema: { title: { default: '' } },
  component: Card,
  statics: { conversionConfig: { export: 'title', import: 'title' } },
});

const BadgeTool = createReactBlock<BadgeData>({
  type: 'badge',
  propSchema: { label: { default: '' } },
  component: Badge,
  statics: { conversionConfig: { export: 'label', import: 'label' } },
});

/**
 * The blocks API is attached to the instance dynamically by exportAPI(), so it
 * is not part of the Blok class type.
 * @param editor - ready editor instance
 */
const blocksApiOf = (editor: Blok): Blocks =>
  (editor as unknown as { blocks: Blocks }).blocks;

describe('api.blocks.convert between two React blocks', () => {
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

  const boot = async (): Promise<Blok> => {
    const hostTree = render(<BlockPortalHost registry={registry} />);

    unmountHost = hostTree.unmount;

    let created: Blok | null = null;

    await act(async () => {
      created = new Blok({
        holder,
        tools: {
          card: {
            class: CardTool,
            config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry },
          },
          badge: {
            class: BadgeTool,
            config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry },
          },
        },
        data: {
          blocks: [{ id: 'card-1', type: 'card', data: { title: 'Tab' } }],
        },
      });
      await created.isReady;
    });

    if (created === null) {
      throw new Error('Test setup failed: editor was not created');
    }
    editor = created;

    return created;
  };

  it('keeps the portal mounted when one React tool converts into another', async () => {
    const instance = await boot();

    expect(document.querySelector('.card-title')?.textContent).toBe('Tab');

    await act(async () => {
      await blocksApiOf(instance).convert('card-1', 'badge');
    });

    // The block id is preserved across replace(), so both tools registered
    // under it — the superseded card's teardown must not evict the badge.
    expect(registry.getSnapshot().has('card-1')).toBe(true);
    expect(document.querySelector('.badge-label')?.textContent).toBe('Tab');
  });

  it('leaves the converted block rendering inside its live holder', async () => {
    const instance = await boot();

    await act(async () => {
      await blocksApiOf(instance).convert('card-1', 'badge');
    });

    const entryHost = registry.getSnapshot().get('card-1')?.hostEl;

    expect(entryHost?.isConnected).toBe(true);
    expect(entryHost?.textContent).toBe('Tab');
    expect(holder.textContent).toContain('Tab');
  });
});
