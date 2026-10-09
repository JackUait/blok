import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Listeners } from '../../../../../src/components/utils/listeners';
import { Core } from '../../../../../src/components/core';
import { BlockChanged } from '../../../../../src/components/events';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let ready = false;
const cleanups: Array<() => void> = [];

const settle = async (Blok: BlokModules): Promise<void> => {
  await new Promise<void>((resolve) => {
    cleanups.push(Blok.YjsManager.onPendingBlockWritesSettled(resolve));
  });
  Blok.YjsManager.flushPendingBlockWrites();
};

const boot = async (): Promise<BlokModules> => {
  if (holder === undefined) {
    throw new Error('missing editor holder');
  }

  const instance = new Core({
    holder,
    user: { id: 'human-1', name: 'Human' },
    tools: { paragraph: { class: Paragraph } },
    data: {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
        { id: 'b', type: 'paragraph', data: { text: [{ text: 'B' }] } },
      ],
    },
  });

  core = instance;
  await instance.isReady;
  ready = true;
  await vi.waitFor(() => {
    expect(instance.moduleInstances.BlockManager.isSyncingFromYjs).toBe(false);
  });
  await settle(instance.moduleInstances);

  return instance.moduleInstances;
};

const changes = (Blok: BlokModules): Map<string, unknown> => {
  const details = new Map<string, unknown>();
  const onChange = (payload: unknown): void => {
    if (typeof payload !== 'object' || payload === null || !('event' in payload)
      || !(payload.event instanceof CustomEvent) || payload.event.type !== BlockChangedMutationType) {
      return;
    }

    const detail: unknown = payload.event.detail;

    if (typeof detail !== 'object' || detail === null || !('target' in detail)
      || typeof detail.target !== 'object' || detail.target === null
      || !('id' in detail.target) || typeof detail.target.id !== 'string') {
      return;
    }

    details.set(detail.target.id, detail);
  };

  Blok.EventsAPI.methods.on(BlockChanged, onChange);
  cleanups.push(() => Blok.EventsAPI.methods.off(BlockChanged, onChange));

  return details;
};

const update = async (Blok: BlokModules, id: string, text: string): Promise<void> => {
  const block = Blok.BlockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`missing block ${id}`);
  }

  await Blok.BlockManager.update(block, { text: [{ text }] });
  await settle(Blok);
};

const destroyCore = async (instance: Core): Promise<void> => {
  const modules = Object.values<BlokModules[keyof BlokModules]>({ ...instance.moduleInstances });
  const failures: unknown[] = [];

  for (const module of modules) {
    module.markDestroyed();
  }

  for (const module of modules) {
    const owner: unknown = module;

    if (typeof owner !== 'object' || owner === null) {
      continue;
    }

    try {
      ('destroy' in owner && typeof owner.destroy === 'function' ? await owner.destroy() : undefined);
    } catch (error) {
      failures.push(error);
    } finally {
      const listeners = 'listeners' in owner && owner.listeners instanceof Listeners ? owner.listeners : undefined;

      listeners?.removeAll();
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'editor teardown failed');
  }
};

describe('agent attribution scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ready = false;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined && ready) {
        await settle(core.moduleInstances);
      }
    } finally {
      try {
        cleanups.splice(0).forEach(cleanup => cleanup());
        (core !== undefined ? await destroyCore(core) : undefined);
      } finally {
        core = undefined;
        holder?.remove();
        holder = undefined;
        vi.restoreAllMocks();
      }
    }
  });

  it('attributes only scoped blocks and leaves human edits outside the scope local', async () => {
    const Blok = await boot();
    const details = changes(Blok);
    const release = Blok.BlockManager.attributeTo({
      ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 'turn-1',
    });

    cleanups.push(release);
    await update(Blok, 'a', 'A2');
    await update(Blok, 'b', 'B2');
    const saved = Blok.YjsManager.toJSON();

    expect(saved.find(block => block.id === 'a')?.lastEditedBy).toBe('agent-1');
    expect(details.get('a')).toMatchObject({
      target: { id: 'a' }, agent: { id: 'agent-1', name: 'Agent', turnId: 'turn-1' }, origin: 'local',
    });
    expect(saved.find(block => block.id === 'b')?.lastEditedBy).toBe('human-1');
    expect(details.get('b')).toMatchObject({ target: { id: 'b' }, origin: 'local' });
    expect(details.get('b')).not.toHaveProperty('agent');
  });

  it('restores human stamps and untagged local events when the current scope is released', async () => {
    const Blok = await boot();
    const details = changes(Blok);
    const release = Blok.BlockManager.attributeTo({
      ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 'turn-1',
    });

    cleanups.push(release);
    await update(Blok, 'a', 'A2');
    release();
    details.clear();
    await update(Blok, 'a', 'A3');

    expect(Blok.YjsManager.toJSON().find(block => block.id === 'a')?.lastEditedBy).toBe('human-1');
    expect(details.get('a')).toMatchObject({ target: { id: 'a' }, origin: 'local' });
    expect(details.get('a')).not.toHaveProperty('agent');
  });

  it('keeps the current scope when an older scope is released', async () => {
    const Blok = await boot();
    const details = changes(Blok);
    const releaseOld = Blok.BlockManager.attributeTo({
      ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 'turn-1',
    });
    const releaseCurrent = Blok.BlockManager.attributeTo({
      ids: new Set(['b']), actor: { id: 'agent-2', name: 'New agent' }, turnId: 'turn-2',
    });

    cleanups.push(releaseOld, releaseCurrent);
    releaseOld();
    await update(Blok, 'b', 'B2');

    expect(Blok.YjsManager.toJSON().find(block => block.id === 'b')?.lastEditedBy).toBe('agent-2');
    expect(details.get('b')).toMatchObject({
      target: { id: 'b' }, agent: { id: 'agent-2', name: 'New agent', turnId: 'turn-2' }, origin: 'local',
    });
  });

  it('does not label a peer update as the active local agent', async () => {
    const Blok = await boot();
    const details = changes(Blok);
    const peer = new DocumentStore(new YBlockSerializer());

    cleanups.push(() => peer.destroy());
    peer.applyRemoteUpdate(Blok.YjsManager.encodeStateAsUpdate(peer.getStateVector()));
    cleanups.push(Blok.BlockManager.attributeTo({
      ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 'turn-1',
    }));
    peer.updateBlockData('a', 'text', 'Peer change');
    Blok.YjsManager.applyRemoteUpdate(peer.encodeStateAsUpdate(Blok.YjsManager.getStateVector()), peer);

    await vi.waitFor(() => {
      expect(details.get('a')).toMatchObject({ target: { id: 'a' }, origin: 'remote' });
    });
    expect(details.get('a')).not.toHaveProperty('agent');
  });

});
