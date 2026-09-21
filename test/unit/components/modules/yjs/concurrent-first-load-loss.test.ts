import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Two people open the SAME document at the same moment and each renders the
 * same initial blocks into it — a host seeding a new page from a template, an
 * `api.blocks.render()` on a room that is still empty, a server that hands the
 * same starter document to both tabs.
 *
 * `DocumentStore.fromJSON` writes a block it does not already hold with a bare
 * `yBlocksMap.set(id, freshYBlock)`. Two peers doing that under the SAME id
 * each author their own Y.Map, map-set is last-writer-wins, and the loser's map
 * is discarded WHOLE — with everything typed into it inside.
 *
 * The peers meet only through encoded updates, the provider's own path.
 */
describe('YjsManager.fromJSON — two peers seeding the same document', () => {
  const managers: YjsManager[] = [];

  const createPeer = (): YjsManager => {
    const manager = new YjsManager({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    managers.push(manager);

    return manager;
  };

  /** One peer's ops to every other peer. */
  const broadcast = (from: YjsManager): void => {
    managers
      .filter((to) => to !== from)
      .forEach((to) => to.applyRemoteUpdate(from.encodeStateAsUpdate(to.getStateVector())));
  };

  /** Ship every peer's ops to every other peer until the mesh is quiet. */
  const syncMesh = (): void => {
    for (let round = 0; round < 2; round += 1) {
      managers.forEach(broadcast);
    }
  };

  const blockData = (manager: YjsManager, id: string): Record<string, unknown> => {
    const block = manager.toJSON().find((entry: YjsOutputBlockData) => entry.id === id);

    return block?.data ?? {};
  };

  const template: YjsOutputBlockData[] = [
    { id: 'tpl-title', type: 'paragraph', data: { text: 'Weekly notes' } },
    { id: 'tpl-body', type: 'paragraph', data: { text: '' } },
  ];

  const seedTemplate = (manager: YjsManager): void => {
    manager.fromJSON(template.map((block) => ({ ...block,
      data: { ...block.data } })));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const manager of managers) {
      manager.destroy();
    }
    managers.length = 0;
    vi.restoreAllMocks();
  });

  it.fails('keeps what each peer wrote into the seeded block', () => {
    const alice = createPeer();
    const bob = createPeer();

    seedTemplate(alice);
    seedTemplate(bob);

    // Each writes a field of their own, before the two seeds have met. Two
    // peers editing DIFFERENT keys of one block is the case a shared Y.Map
    // merges — the same law the serializer's eager `tunes`/`contentIds` mint
    // exists to protect.
    alice.updateBlockData('tpl-body', 'alice', 'what alice typed');
    bob.updateBlockData('tpl-body', 'bob', 'what bob typed');

    syncMesh();

    expect(blockData(alice, 'tpl-body'), 'a peer lost everything they wrote into the seeded block').toEqual(
      expect.objectContaining({ alice: 'what alice typed',
        bob: 'what bob typed' })
    );
    expect(blockData(bob, 'tpl-body')).toEqual(blockData(alice, 'tpl-body'));
  });

  it.fails('keeps a tune each peer set on the seeded block', () => {
    const alice = createPeer();
    const bob = createPeer();

    seedTemplate(alice);
    seedTemplate(bob);

    alice.updateBlockTune('tpl-title', 'alignment', { alignment: 'center' });
    bob.updateBlockTune('tpl-title', 'textColor', { color: '#ff0000' });

    syncMesh();

    const tunes = alice.toJSON().find((entry: YjsOutputBlockData) => entry.id === 'tpl-title')?.tunes ?? {};

    expect(tunes, 'a peer lost the tune they set on the seeded block').toEqual(
      expect.objectContaining({ alignment: { alignment: 'center' },
        textColor: { color: '#ff0000' } })
    );
  });

  /**
   * The control for the two above: the SAME two writes, on an id the document
   * already holds, go through `rewriteBlockInPlace` — one shared Y.Map — and
   * both survive. The loss is the bare `set` of a fresh map, nothing else.
   */
  it('keeps both writes when the seeded id is already in the document', () => {
    const alice = createPeer();
    const bob = createPeer();

    seedTemplate(alice);
    syncMesh();

    // Both re-render the template over a document that already carries it.
    seedTemplate(alice);
    seedTemplate(bob);

    alice.updateBlockData('tpl-body', 'alice', 'what alice typed');
    bob.updateBlockData('tpl-body', 'bob', 'what bob typed');

    syncMesh();

    expect(blockData(alice, 'tpl-body')).toEqual(
      expect.objectContaining({ alice: 'what alice typed',
        bob: 'what bob typed' })
    );
  });
});
