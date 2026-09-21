import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import { Block } from '../../../src/components/block';
import { ToolsCollection } from '../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../src/components/tools/block';
import type { API as ApiModules } from '../../../src/types/index';
import { DocumentStore, captureDataKeySnapshot } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { ImageTool } from '../../../src/tools/image/index';
import { VideoTool } from '../../../src/tools/video/index';

/**
 * Two real Yjs peers, a real `Block`, a real tool. Only the uploader is mocked
 * — it is the genuinely asynchronous part in production.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const forB = a.encodeStateAsUpdate(b.getStateVector());
  const forA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(forB);
  a.applyRemoteUpdate(forA);
};

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.data ?? {};

/**
 * Stand-in for `BlockManager.syncBlockDataToYjs` + `flushBlockDataWrites`
 * (src/components/modules/blockManager/blockManager.ts:2040-2205): snapshot the
 * document's key sets BEFORE the save, await `block.save()`, write each saved
 * key, then prune the keys the save no longer carries.
 */
const flushToDocument = async (block: Block, store: DocumentStore): Promise<void> => {
  const ydata = store.getBlockById(block.id)?.get('data');
  const seenKeys = ydata instanceof Y.Map ? new Set<string>(ydata.keys()) : undefined;
  const seenNested = ydata instanceof Y.Map ? captureDataKeySnapshot(ydata) : undefined;
  const saved = await block.save();

  if (saved === undefined) {
    return;
  }

  const savedKeys = new Set(Object.keys(saved.data));

  store.transact(() => {
    for (const [key, value] of Object.entries(saved.data)) {
      store.updateBlockData(block.id, key, value, seenNested);
    }
  }, 'local');
  store.transactWithoutCapture(() => {
    store.pruneBlockData(block.id, savedKeys, seenKeys);
  });
};

/** A promise this test resolves by hand — the in-flight upload. */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
};

const toolApi = (): unknown => ({
  i18n: {
    t: (key: string): string => key,
    has: (): boolean => false,
  },
  tools: { getBlockTools: (): unknown[] => [] },
  uploader: undefined,
});

/**
 * A real `Block` wrapping a real tool instance, wired so each `didMutated`
 * (what `block.dispatchChange()` raises — src/components/block/index.ts:598)
 * flushes the tool's `save()` into `store`.
 */
const mountBlock = (
  ToolClass: new (options: never) => Record<string, unknown>,
  options: { id: string; toolName: string; data: Record<string, unknown>; config: unknown; store: DocumentStore }
): Block => {
  const adapter = {
    name: options.toolName,
    settings: { config: {} },
    create: (data: Record<string, unknown>, blockAPI: unknown, readOnly: boolean) =>
      new ToolClass({
        data,
        block: blockAPI,
        api: toolApi(),
        config: options.config,
        readOnly,
      } as never),
    tunes: new ToolsCollection(),
    sanitizeConfig: {},
    inlineTools: new ToolsCollection(),
    conversionConfig: undefined,
  } as unknown as BlockToolAdapter;

  const block = new Block({
    id: options.id,
    data: options.data,
    tool: adapter,
    readOnly: false,
    tunesData: {},
    api: {} as ApiModules,
  });

  block.on('didMutated', () => {
    void flushToDocument(block, options.store);
  });

  document.body.appendChild(block.holder);

  return block;
};

/** The image tool's asynchronous entry: a pasted <img>, routed through the uploader. */
const startImageUpload = (block: Block): void => {
  const img = document.createElement('img');

  img.setAttribute('src', 'https://cdn.test/photo.png');
  (block.toolInstance as unknown as { onPaste: (e: unknown) => void }).onPaste({
    type: 'tag',
    detail: { data: img },
  });
};

/** The video tool's only asynchronous entry is a dropped/pasted file. */
const startVideoUpload = (block: Block): void => {
  (block.toolInstance as unknown as { onPaste: (e: unknown) => void }).onPaste({
    type: 'file',
    detail: { file: new File([new Uint8Array([0, 1])], 'clip.mp4', { type: 'video/mp4' }) },
  });
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('async tool data racing a remote peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('why a peer edit rebuilds a media block', () => {
    it('refuses an in-place setData for an image, forcing the reconciler to rematerialise', async () => {
      const store = createStore();

      store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: {},
        store,
      });

      // `BlockYjsSync.applyRemoteData` calls this for a peer's edit; a false
      // answer sends it to `rematerialize` (yjs-sync.ts:1036-1045), which goes
      // through `Blocks.replace` and destroys this Block (blocks.ts:367-380).
      await expect(block.setData({ url: '', caption: 'Cat photo' })).resolves.toBe(false);
    });

    it('refuses an in-place setData for a video too', async () => {
      const store = createStore();

      store.fromJSON([{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }]);

      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: {},
        store,
      });

      await expect(block.setData({ url: '', caption: 'Clip of a cat' })).resolves.toBe(false);
    });
  });

  describe('control: the same upload with no peer edit', () => {
    it('lands the image upload when the block was never rebuilt', async () => {
      const store = createStore();

      store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        store,
      });

      startImageUpload(block);
      await settle();
      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(store, 'img1').url).toBe('https://cdn.test/stored/photo.png');
    });

    it('lands the video upload when the block was never rebuilt', async () => {
      const store = createStore();

      store.fromJSON([{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }]);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        store,
      });

      startVideoUpload(block);
      await settle();
      upload.resolve({ url: 'https://cdn.test/stored/clip.mp4' });
      await settle();

      expect(dataOf(store, 'vid1').url).toBe('https://cdn.test/stored/clip.mp4');
    });
  });

  describe('image', () => {
    it.fails('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerA = createStore();
      const peerB = createStore();
      const seed = [{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }];

      peerA.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(peerA, peerB);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        store: peerA,
      });

      startImageUpload(block);
      await settle();

      // Peer B edits the same block's caption while the upload is in flight.
      peerB.updateBlockData('img1', 'caption', 'Cat photo');
      sync(peerA, peerB);

      // A's reconciler cannot apply that in place (tests above), so it
      // rematerialises the block, which destroys this instance.
      block.destroy();

      // The upload finally lands.
      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(peerA, 'img1').url).toBe('https://cdn.test/stored/photo.png');
      expect(dataOf(peerA, 'img1').caption).toBe('Cat photo');
    });
  });

  describe('video', () => {
    it.fails('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerA = createStore();
      const peerB = createStore();
      const seed = [{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }];

      peerA.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(peerA, peerB);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        store: peerA,
      });

      startVideoUpload(block);
      await settle();

      peerB.updateBlockData('vid1', 'caption', 'Clip of a cat');
      sync(peerA, peerB);

      block.destroy();

      upload.resolve({ url: 'https://cdn.test/stored/clip.mp4' });
      await settle();

      expect(dataOf(peerA, 'vid1').url).toBe('https://cdn.test/stored/clip.mp4');
      expect(dataOf(peerA, 'vid1').caption).toBe('Clip of a cat');
    });
  });
});
