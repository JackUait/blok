import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { Paragraph } from '../../../src/tools';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../types';

// jsdom has no navigator.locks, so the browser platform would never open a session.
vi.mock('../../../src/components/modules/tabSync/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformModule>();
  const { createFakePlatform } = await import('./modules/tabSync/fakes');

  return { ...actual, browserTabPlatform: createFakePlatform() };
});

const cores: Core[] = [];

const paragraph = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id } });

const document3 = (): OutputData => ({ blocks: [paragraph('a'), paragraph('b'), paragraph('c')] });

const createCore = (extra: Partial<BlokConfig>): Core => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({ holder, logLevel: 'ERROR', tools: { paragraph: Paragraph }, ...extra } as BlokConfig);

  cores.push(core);

  return core;
};

/** Same teardown as Blok.destroy() minus markDestroyed: every module, in map order. */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((module) => {
    if (typeof (module as { destroy?: unknown }).destroy === 'function') {
      (module as { destroy: () => void }).destroy();
    }
  });
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const ids = (core: Core): string[] => core.moduleInstances.BlockManager.blocks.map((block) => block.id);

const docIds = (core: Core): string[] => core.moduleInstances.YjsManager.orderedIds();

const texts = (core: Core): string[] =>
  core.moduleInstances.BlockManager.blocks.map((block) => block.holder.textContent ?? '');

/** A leader with onSave and a follower, both on `documentId`, both settled. */
const twoEditors = async (documentId: string): Promise<{ leader: Core; follower: Core; onSave: ReturnType<typeof vi.fn> }> => {
  const onSave = vi.fn();
  const leader = createCore({ documentId, data: document3(), onSave });

  await leader.isReady;
  await wait(50);
  const follower = createCore({ documentId, data: document3() });

  await follower.isReady;
  await wait(100);
  expect(leader.moduleInstances.TabSync.role).toBe('leader');
  expect(follower.moduleInstances.TabSync.role).toBe('follower');
  onSave.mockClear();

  return { leader, follower, onSave };
};

/** One batch window, plus room for the message hop and the serialization. */
const oneWindow = (): Promise<void> => wait(modificationsObserverBatchTimeout + 150);

const savedIds = (onSave: ReturnType<typeof vi.fn>): string[] | undefined =>
  (onSave.mock.lastCall?.[0] as OutputData | undefined)?.blocks.map((block) => block.id);

describe('Core — replacing the document in one tab adds no block in the others', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a follower render leaves exactly the rendered blocks in both tabs and in the save', async () => {
    const { leader, follower, onSave } = await twoEditors('replace-follower-render');

    await follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await oneWindow();

    expect(ids(leader)).toEqual(['x', 'y']);
    expect(ids(follower)).toEqual(['x', 'y']);
    expect(docIds(leader)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
    expect(savedIds(onSave)).toEqual(['x', 'y']);
  });

  it('a leader render leaves exactly the rendered blocks in both tabs', async () => {
    const { leader, follower } = await twoEditors('replace-leader-render');

    await leader.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await oneWindow();

    expect(ids(follower)).toEqual(['x', 'y']);
    expect(ids(leader)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
  });

  it('a follower importMarkdown leaves exactly the imported blocks in both tabs', async () => {
    const { leader, follower } = await twoEditors('replace-follower-markdown');

    await follower.moduleInstances.API.methods.blocks.importMarkdown('one\n\ntwo');
    await oneWindow();

    expect(texts(follower)).toEqual(['one', 'two']);
    expect(texts(leader)).toEqual(['one', 'two']);
    expect(docIds(leader)).toEqual(docIds(follower));
  });

  it('a follower clear leaves exactly one default block, the same one, in both tabs', async () => {
    const { leader, follower, onSave } = await twoEditors('replace-follower-clear');

    await follower.moduleInstances.API.methods.blocks.clear();
    await oneWindow();

    expect(ids(follower)).toHaveLength(1);
    expect(ids(leader)).toEqual(ids(follower));
    expect(docIds(leader)).toEqual(ids(follower));
    // A lone empty paragraph saves as no blocks, same as a solo clear.
    expect(savedIds(onSave)).toEqual([]);
  });

  it('a follower render of no blocks leaves exactly one block, the same one, in both tabs', async () => {
    const { leader, follower } = await twoEditors('replace-follower-render-empty');

    await follower.moduleInstances.API.methods.blocks.render({ blocks: [] });
    await oneWindow();

    expect(ids(follower)).toHaveLength(1);
    expect(ids(leader)).toEqual(ids(follower));
    expect(docIds(leader)).toEqual(ids(follower));
  });

  it('a follower renderFromHTML leaves exactly the pasted blocks in both tabs', async () => {
    const { leader, follower } = await twoEditors('replace-follower-html');

    await follower.moduleInstances.API.methods.blocks.renderFromHTML('<p>one</p><p>two</p>');
    await oneWindow();

    expect(texts(follower)).toEqual(['one', 'two']);
    expect(texts(leader)).toEqual(['one', 'two']);
    expect(docIds(leader)).toEqual(docIds(follower));
  });

  it('a follower that deletes every block leaves exactly one block in both tabs', async () => {
    const { leader, follower } = await twoEditors('replace-follower-delete-all');
    const { blocks } = follower.moduleInstances.API.methods;

    await blocks.delete(0);
    await blocks.delete(0);
    await blocks.delete(0);
    await oneWindow();

    expect(ids(follower)).toHaveLength(1);
    expect(ids(leader)).toEqual(ids(follower));
    expect(docIds(leader)).toEqual(ids(follower));
  });

  describe('overlapping renders', () => {
    const untilRenderStarts = async (core: Core): Promise<void> => {
      while (core.moduleInstances.Renderer.pendingRender === null) {
        await Promise.resolve();
      }
      for (let i = 0; i < 3; i++) {
        await Promise.resolve();
      }
    };

    const insertLater = (core: Core): void => {
      core.moduleInstances.API.methods.blocks.insert('paragraph', { text: 'later' }, {}, undefined, true, false, 'later');
    };

    it('an edit after a renderFromHTML that started during a render still reaches the other tab', async () => {
      const { leader, follower } = await twoEditors('overlap-render-html');
      const { blocks } = follower.moduleInstances.API.methods;
      const first = blocks.render({ blocks: [paragraph('x')] });

      await untilRenderStarts(follower);
      await Promise.all([first, blocks.renderFromHTML('<p>h</p>')]);
      await wait(50);
      insertLater(follower);
      await oneWindow();

      expect(docIds(follower)).toContain('later');
      expect(docIds(leader)).toEqual(docIds(follower));
    });

    it('an edit after a render that started during a renderFromHTML still reaches the other tab', async () => {
      const { leader, follower } = await twoEditors('overlap-html-render');
      const { blocks } = follower.moduleInstances.API.methods;
      const first = blocks.renderFromHTML('<p>h</p>');

      await untilRenderStarts(follower);
      await Promise.all([first, blocks.render({ blocks: [paragraph('x')] })]);
      await wait(50);
      insertLater(follower);
      await oneWindow();

      expect(docIds(follower)).toContain('later');
      expect(docIds(leader)).toEqual(docIds(follower));
    });

    it('an edit after a render that threw still reaches the other tab', async () => {
      const { leader, follower } = await twoEditors('overlap-render-throws');

      vi.spyOn(follower.moduleInstances.Renderer, 'render').mockRejectedValueOnce(new Error('bad block'));
      await expect(follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x')] })).rejects.toThrow('bad block');
      await wait(50);
      insertLater(follower);
      await oneWindow();

      expect(docIds(follower)).toContain('later');
      expect(docIds(leader)).toEqual(docIds(follower));
    });

    it('a save started during overlapping renders resolves', async () => {
      const core = createCore({ documentId: 'overlap-save', data: document3() });

      await core.isReady;
      const { blocks } = core.moduleInstances.API.methods;
      const first = blocks.render({ blocks: [paragraph('x')] });

      await untilRenderStarts(core);
      const save = core.moduleInstances.Saver.save();
      const second = blocks.renderFromHTML('<p>h</p>');

      await Promise.all([first, second]);
      const outcome = await Promise.race([
        save.then(() => 'saved'),
        wait(1000).then(() => 'stuck'),
      ]);

      expect(outcome).toBe('saved');
    });
  });
});
