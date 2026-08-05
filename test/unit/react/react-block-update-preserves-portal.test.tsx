/**
 * C2 regression, end to end against a REAL editor.
 *
 * `api.blocks.update(id, data)` used to always recompose the Block: core built
 * a brand-new Block (new tool instance, new host element, a fresh portal
 * registration under the SAME id) and only afterwards destroyed the old one —
 * whose `removed()`/`destroy()` then unregistered that very id. The portal the
 * replacement had just registered was deleted, nothing re-registered it, and
 * the block's holder stayed empty until reload.
 *
 * The reported exposure is a host calling `api.blocks.update` on a React block
 * once per keystroke (renaming a tab), so this pins the repeated-update shape.
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
import type { OutputData } from '../../../types';

interface CardData {
  title: string;
}

function Card({ data }: ReactBlockRenderProps<CardData>): React.ReactElement {
  return <span className="card-title">{data.title}</span>;
}

const CardTool = createReactBlock<CardData>({
  type: 'card',
  propSchema: { title: { default: '' } },
  component: Card,
});

/**
 * `blocks` and `save()` exist on every Blok instance at runtime — `exportAPI()`
 * re-points the instance prototype at the API methods object and copies the
 * shorthands onto it — and the PUBLISHED surface declares both (`types/index.d.ts`
 * has `save()` on the class and picks up `blocks` from `interface Blok extends
 * Omit<API, 'i18n'>`). The implementation class in `src/blok.ts`, which this
 * test imports, models only what it assigns statically, so reaching for either
 * one straight off the import is a TS2339. These helpers localize that gap:
 * do not "fix" it by widening the published declaration, which is already
 * complete and pinned by test/unit/architecture/blok-class-api-parity-law.test.ts.
 * @param editor - ready editor instance
 */
const blocksApiOf = (editor: Blok): Blocks =>
  (editor as unknown as { blocks: Blocks }).blocks;

/**
 * See {@link blocksApiOf} — same runtime-vs-implementation-class gap.
 * @param editor - ready editor instance
 */
const saveOf = (editor: Blok): Promise<OutputData> =>
  (editor as unknown as { save: () => Promise<OutputData> }).save();

describe('api.blocks.update on a React block', () => {
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

  it('keeps the portal mounted across a single update', async () => {
    const instance = await boot();

    expect(document.querySelector('.card-title')?.textContent).toBe('Tab');

    await act(async () => {
      await blocksApiOf(instance).update('card-1', { title: 'Tab 1' });
    });

    expect(registry.getSnapshot().has('card-1')).toBe(true);
    expect(document.querySelector('.card-title')?.textContent).toBe('Tab 1');
  });

  it('survives an update per keystroke without emptying the holder', async () => {
    const instance = await boot();
    const hostBefore = registry.getSnapshot().get('card-1')?.hostEl;

    for (const title of ['T', 'Ta', 'Tab', 'Tab ', 'Tab 2']) {
      await act(async () => {
        await blocksApiOf(instance).update('card-1', { title });
      });
    }

    const hostAfter = registry.getSnapshot().get('card-1')?.hostEl;

    expect(hostAfter).toBe(hostBefore);
    expect(hostAfter?.textContent).toBe('Tab 2');
    expect(document.querySelector('.card-title')?.textContent).toBe('Tab 2');
  });

  it('keeps the updated data readable through save()', async () => {
    const instance = await boot();

    await act(async () => {
      await blocksApiOf(instance).update('card-1', { title: 'Renamed' });
    });

    const saved = await saveOf(instance);

    expect(saved.blocks[0].data).toEqual({ title: 'Renamed' });
  });
});
