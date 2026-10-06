import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { ModificationsObserver } from '../../../src/components/modules/modificationsObserver';
import { TabSync } from '../../../src/components/modules/tabSync';
import { Header, List, Paragraph, Table, Toggle } from '../../../src/tools';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { BlokConfig, OutputBlockData } from '../../../types';

// One in-memory platform for every editor in this file: jsdom has no
// navigator.locks, so the browser platform would never open a session.
vi.mock('../../../src/components/modules/tabSync/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformModule>();
  const { createFakePlatform } = await import('./modules/tabSync/fakes');

  return { ...actual, browserTabPlatform: createFakePlatform() };
});

const paragraph = (text: string, id = `p-${text}`): OutputBlockData => ({ id, type: 'paragraph', data: { text } });

const cores: Core[] = [];

const createCore = (extra: Partial<BlokConfig>): Core => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({ holder, logLevel: 'ERROR', tools: { paragraph: Paragraph }, ...extra } as BlokConfig);

  cores.push(core);

  return core;
};

/** Same teardown as Blok.destroy(): every module, in map order. */
const destroyAll = (): void => {
  cores.splice(0).forEach((core) => {
    Object.values(core.moduleInstances).forEach((module) => {
      if (typeof (module as { destroy?: unknown }).destroy === 'function') {
        (module as { destroy: () => void }).destroy();
      }
    });
  });
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe('Core — tab sync wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    destroyAll();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('start context', () => {
    it('starts tab sync once after render, flagging a persisted load', async () => {
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();

      await createCore({
        persistence: { load: async () => ({ blocks: [paragraph('x')] }), save: async () => {} },
      }).isReady;

      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({ loadedFromPersistence: true, isEmpty: false });
    });

    it('flags a raw data document as not persisted', async () => {
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();

      await createCore({ data: { blocks: [paragraph('x')] } }).isReady;

      expect(start).toHaveBeenCalledWith({ loadedFromPersistence: false, isEmpty: false });
    });

    it('flags an empty persisted load as not persisted', async () => {
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();

      await createCore({ persistence: { load: async () => ({ blocks: [] }), save: async () => {} } }).isReady;

      expect(start).toHaveBeenCalledWith({ loadedFromPersistence: false, isEmpty: true });
    });

    it('flags a missing persisted document as not persisted', async () => {
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();

      await createCore({ persistence: { load: async () => null, save: async () => {} } }).isReady;

      expect(start).toHaveBeenCalledWith(expect.objectContaining({ loadedFromPersistence: false }));
    });

    it('flags data passed next to persistence as not persisted', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();

      await createCore({
        data: { blocks: [paragraph('x')] },
        persistence: { load: async () => ({ blocks: [paragraph('y')] }), save: async () => {} },
      }).isReady;

      expect(start).toHaveBeenCalledWith({ loadedFromPersistence: false, isEmpty: false });
    });

    it('starts before the change observer is enabled', async () => {
      const start = vi.spyOn(TabSync.prototype, 'start').mockResolvedValue();
      const enable = vi.spyOn(ModificationsObserver.prototype, 'enable');

      await createCore({ data: { blocks: [paragraph('x')] } }).isReady;

      expect(start.mock.invocationCallOrder[0]).toBeLessThan(enable.mock.invocationCallOrder[0]);
    });
  });

  describe('real editors', () => {
    const richDocument = (): OutputBlockData[] => [
      { id: 'h1', type: 'header', data: { text: 'Title', level: 2 } },
      paragraph('intro', 'p1'),
      { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'l2', type: 'list', data: { text: 'two', style: 'ordered' } },
      { id: 't1', type: 'toggle', data: { text: 'More' }, content: ['p2'] },
      { ...paragraph('inside', 'p2'), parent: 't1' },
      {
        id: 'tb',
        type: 'table',
        data: { withHeadings: false, content: [['a', 'b'], ['c', 'd']] },
      },
    ];

    const tools = { paragraph: Paragraph, header: Header, list: List, toggle: Toggle, table: Table };

    it('a freshly mounted editor that loaded a document has no local edit at start, so it follows the open tab', async () => {
      const leader = createCore({ documentId: 'boot-doc', tools, data: { blocks: richDocument() } });

      await leader.isReady;
      await wait(50);
      expect(leader.moduleInstances.TabSync.role).toBe('leader');

      const joiner = createCore({
        documentId: 'boot-doc',
        tools,
        persistence: { load: async () => ({ blocks: richDocument() }), save: async () => {} },
      });

      await joiner.isReady;
      // Past the 400 ms write-buffer window and any boot RAF work.
      await wait(800);

      expect(joiner.moduleInstances.TabSync.role).toBe('follower');
    });

    it('no boot-time document write lands after start on a freshly loaded editor', async () => {
      const original = TabSync.prototype.start;
      const writes: unknown[] = [];

      vi.spyOn(TabSync.prototype, 'start').mockImplementation(function (this: TabSync, context) {
        // Listens from the moment start runs: the same window editedSinceStart covers.
        (this as unknown as { Blok: BlokModules }).Blok.YjsManager.onDocUpdate((_update, origin) => writes.push(origin));

        return original.call(this, context);
      });
      const core = createCore({
        documentId: 'quiet-doc',
        tools,
        persistence: { load: async () => ({ blocks: richDocument() }), save: async () => {} },
      });

      await core.isReady;
      await wait(800);

      expect(core.moduleInstances.BlockManager.blocks.map((block) => block.name)).not.toContain('stub');
      expect(writes).toEqual([]);
    });

    it('an editor with no documentId and raw data never opens a session', async () => {
      const core = createCore({ tools, data: { blocks: richDocument() } });

      await core.isReady;
      await wait(50);

      expect(core.moduleInstances.TabSync.role).toBe('solo');
    });
  });
});
