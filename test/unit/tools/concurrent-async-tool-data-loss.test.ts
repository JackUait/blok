import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import { Block, BlockToolAPI } from '../../../src/components/block';
import { Blocks } from '../../../src/components/blocks';
import { BlockRepository } from '../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../src/components/modules/blockManager/types';
import { ToolsCollection } from '../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../src/components/tools/block';
import type { API as ApiModules } from '../../../src/components/modules/api';
import { DocumentStore, captureDataKeySnapshot } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { ImageTool } from '../../../src/tools/image/index';
import { VideoTool } from '../../../src/tools/video/index';
import { FileTool } from '../../../src/tools/file/index';
import { AudioTool } from '../../../src/tools/audio/index';
import { Bookmark } from '../../../src/tools/link/bookmark/index';
import { releaseObjectUrl } from '../../../src/tools/image/detached-upload';

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

/**
 * What a media block becomes when a peer converts it. `BlockMutation.replace`
 * keeps the block id across a conversion, so id alone cannot tell the two apart.
 */
class PlainTextTool {
  private readonly text: string;

  constructor(options: { data: { text?: string } }) {
    this.text = options.data.text ?? '';
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.contentEditable = 'true';
    root.textContent = this.text;

    return root;
  }

  public save(root: HTMLElement): { text: string } {
    return { text: root.textContent ?? '' };
  }
}

/** A promise this test resolves by hand — the in-flight upload. */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
};

/**
 * The live document a tool can still reach after its own Block was destroyed:
 * `api.blocks.getById` answers for whatever block now carries the id, and
 * `api.blocks.update` writes the patch keys into Yjs — which is all
 * `BlockMutation.update` does with them (block-mutation.ts:161 ->
 * `syncDataToYjs`, key by key, so a peer's other keys survive).
 */
class LiveDocument {
  public readonly store: DocumentStore;
  /** How many `getBlockByIndex` calls the tools made — one `new BlockAPI` each in production. */
  public indexProbes = 0;
  /** Ordered exactly like the real flat blocks store, because the API walks it by index. */
  private readonly mounted: { id: string; name: string }[] = [];

  constructor(store: DocumentStore) {
    this.store = store;
  }

  public mount(id: string, name: string): void {
    this.unmount(id);
    this.mounted.push({ id, name });
  }

  public unmount(id: string): void {
    const at = this.mounted.findIndex((entry) => entry.id === id);

    if (at !== -1) {
      this.mounted.splice(at, 1);
    }
  }

  public api(): unknown {
    const find = (id: string): { id: string; name: string } | undefined =>
      this.mounted.find((entry) => entry.id === id);

    return {
      getBlocksCount: (): number => this.mounted.length,
      getBlockByIndex: (index: number): unknown => {
        this.indexProbes += 1;
        const entry = this.mounted[index];

        // Like BlockAPI.save(): what the block holds now.
        return entry === undefined ? undefined : { ...entry, save: async (): Promise<unknown> => ({ data: dataOf(this.store, entry.id) }) };
      },
      // Mirrors api/blocks.ts:125-135: a miss is a WARN, not a silent null.
      getById: (id: string): unknown => {
        const found = find(id);

        if (found === undefined) {
          console.warn('There is no block with id `' + id + '`');

          return null;
        }

        return found;
      },
      getBlockIndex: (id: string): number | undefined => {
        const at = this.mounted.findIndex((entry) => entry.id === id);

        return at === -1 ? undefined : at;
      },
      update: async (id: string, data: Record<string, unknown>): Promise<unknown> => {
        if (find(id) === undefined) {
          throw new Error(`Block with id "${id}" not found`);
        }
        this.store.transact(() => {
          for (const [key, value] of Object.entries(data)) {
            this.store.updateBlockData(id, key, value);
          }
        }, 'local');

        return { id };
      },
    };
  }
}

const toolApi = (live: LiveDocument): unknown => ({
  i18n: {
    t: (key: string): string => key,
    has: (): boolean => false,
  },
  tools: { getBlockTools: (): unknown[] => [] },
  blocks: live.api(),
  uploader: undefined,
});

/**
 * A real `Block` wrapping a real tool instance, wired so each `didMutated`
 * (what `block.dispatchChange()` raises — src/components/block/index.ts:598)
 * flushes the tool's `save()` into `store`.
 */
const mountBlock = (
  ToolClass: new (options: never) => Record<string, unknown>,
  options: { id: string; toolName: string; data: Record<string, unknown>; config: unknown; live: LiveDocument }
): Block => {
  const adapter = {
    name: options.toolName,
    settings: { config: {} },
    create: (data: Record<string, unknown>, blockAPI: unknown, readOnly: boolean) =>
      new ToolClass({
        data,
        block: blockAPI,
        api: toolApi(options.live),
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
    void flushToDocument(block, options.live.store);
  });

  options.live.mount(options.id, options.toolName);
  document.body.appendChild(block.holder);

  return block;
};

/**
 * What `BlockYjsSync.rematerialize` does to a media block: the tool refuses the
 * peer's data in place, so `Blocks.replace` (blocks.ts:374-378) runs `removed()`
 * and `destroy()` on the old instance and puts a freshly composed block with the
 * SAME id in its place.
 */
const rematerialize = (
  block: Block,
  ToolClass: new (options: never) => Record<string, unknown>,
  options: { id: string; toolName: string; data: Record<string, unknown>; config: unknown; live: LiveDocument }
): Block => {
  block.call(BlockToolAPI.REMOVED);
  block.destroy();
  block.holder.remove();

  return mountBlock(ToolClass, options);
};

/** What a peer's DELETE does: the same teardown, and no block takes its place. */
const removeBlock = (block: Block, live: LiveDocument, id: string): void => {
  block.call(BlockToolAPI.REMOVED);
  block.destroy();
  block.holder.remove();
  live.unmount(id);
};

/** The image tool's asynchronous entry: a pasted <img>, routed through the uploader. */
const startImageUpload = (block: Block): void => {
  const img = document.createElement('img');

  img.setAttribute('src', 'https://cdn.test/photo.png');
  block.call(BlockToolAPI.ON_PASTE, { type: 'tag', detail: { data: img } });
};

/** The video tool's only asynchronous entry is a dropped/pasted file. */
const startVideoUpload = (block: Block): void => {
  block.call(BlockToolAPI.ON_PASTE, {
    type: 'file',
    detail: { file: new File([new Uint8Array([0, 1])], 'clip.mp4', { type: 'video/mp4' }) },
  });
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** The file tool's asynchronous entry: a dropped/pasted file. */
const startFileUpload = (block: Block, name = 'notes.pdf', type = 'application/pdf'): void => {
  block.call(BlockToolAPI.ON_PASTE, {
    type: 'file',
    detail: { file: new File([new Uint8Array([0, 1])], name, { type }) },
  });
};

/** The audio tool's asynchronous entry: a dropped/pasted file. */
const startAudioUpload = (block: Block): void => {
  block.call(BlockToolAPI.ON_PASTE, {
    type: 'file',
    detail: { file: new File([new Uint8Array([0, 1])], 'song.mp3', { type: 'audio/mpeg' }) },
  });
};

/** The bookmark tool's asynchronous entry: a pasted link, routed through the metadata endpoint. */
const startBookmarkFetch = (block: Block, url: string): void => {
  block.call(BlockToolAPI.ON_PASTE, { type: 'pattern', detail: { data: url } });
};

describe('async tool data racing a remote peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('why a peer edit rebuilds a media block', () => {
    it('refuses an in-place setData for an image, forcing the reconciler to rematerialise', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: {},
        live,
      });

      // `BlockYjsSync.applyRemoteData` calls this for a peer's edit; a false
      // answer sends it to `rematerialize` (yjs-sync.ts:1036-1045), which goes
      // through `Blocks.replace` and destroys this Block (blocks.ts:367-380).
      await expect(block.setData({ url: '', caption: 'Cat photo' })).resolves.toBe(false);
    });

    it('refuses an in-place setData for a video too', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }]);

      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: {},
        live,
      });

      await expect(block.setData({ url: '', caption: 'Clip of a cat' })).resolves.toBe(false);
    });
  });

  describe('control: the same upload with no peer edit', () => {
    it('lands the image upload when the block was never rebuilt', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        live,
      });

      startImageUpload(block);
      await settle();
      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(live.store, 'img1').url).toBe('https://cdn.test/stored/photo.png');
    });

    it('lands the video upload when the block was never rebuilt', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }]);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        live,
      });

      startVideoUpload(block);
      await settle();
      upload.resolve({ url: 'https://cdn.test/stored/clip.mp4' });
      await settle();

      expect(dataOf(live.store, 'vid1').url).toBe('https://cdn.test/stored/clip.mp4');
    });
  });

  describe('image', () => {
    it('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerB = createStore();
      const live = new LiveDocument(createStore());
      const seed = [{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }];

      live.store.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(live.store, peerB);

      const upload = deferred<{ url: string }>();
      const options = {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        live,
      };
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, options);

      startImageUpload(block);
      await settle();

      // Peer B edits the same block's caption while the upload is in flight.
      peerB.updateBlockData('img1', 'caption', 'Cat photo');
      sync(live.store, peerB);

      // A's reconciler cannot apply that in place (tests above), so it
      // rematerialises the block, destroying the instance the upload belongs to.
      rematerialize(block, ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: { url: '', caption: 'Cat photo' },
      });

      // The upload finally lands.
      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(live.store, 'img1').url).toBe('https://cdn.test/stored/photo.png');
      expect(dataOf(live.store, 'img1').caption).toBe('Cat photo');
    });

    it('does not resurrect a block the peer deleted', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const upload = deferred<{ url: string }>();
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        live,
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      startImageUpload(block);
      await settle();

      live.store.removeBlock('img1');
      removeBlock(block, live, 'img1');

      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(live.store.toJSON().find((entry) => entry.id === 'img1')).toBeUndefined();
      // Never a silent no-op: the stranded file is reported.
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('image file upload', () => {
    const imageFile = (): File => new File([new Uint8Array([0, 1])], 'photo.png', { type: 'image/png' });
    const mountImage = (live: LiveDocument, upload: { promise: Promise<{ url: string }> }): { block: Block; options: Parameters<typeof mountBlock>[1] } => {
      const options = {
        id: 'img1',
        toolName: 'image',
        data: { url: '' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        live,
      };

      return { block: mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, options), options };
    };

    it('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '' } }]);
      const upload = deferred<{ url: string }>();
      const { block, options } = mountImage(live, upload);

      block.call(BlockToolAPI.ON_PASTE, { type: 'file', detail: { file: imageFile() } });
      await settle();
      rematerialize(block, ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: dataOf(live.store, 'img1'),
      });

      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(live.store, 'img1').url).toBe('https://cdn.test/stored/photo.png');
    });

    it('does not land an upload whose pick was undone while it ran', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '' } }]);
      const upload = deferred<{ url: string }>();
      const { block, options } = mountImage(live, upload);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      block.call(BlockToolAPI.ON_PASTE, { type: 'file', detail: { file: imageFile() } });
      await settle();
      expect(dataOf(live.store, 'img1').fileName).toBe('photo.png');
      // Undo of the pick takes the file name back out and rebuilds the block.
      live.store.transact(() => {
        const data = live.store.getBlockById('img1')?.get('data');

        if (data instanceof Y.Map) {
          data.delete('fileName');
        }
      }, 'local');
      rematerialize(block, ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: dataOf(live.store, 'img1'),
      });

      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      expect(dataOf(live.store, 'img1')).toEqual({ url: '' });
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('video', () => {
    it('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerB = createStore();
      const live = new LiveDocument(createStore());
      const seed = [{ id: 'vid1', type: 'video', data: { url: '', caption: 'Clip' } }];

      live.store.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(live.store, peerB);

      const upload = deferred<{ url: string }>();
      const options = {
        id: 'vid1',
        toolName: 'video',
        data: { url: '', caption: 'Clip' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        live,
      };
      const block = mountBlock(VideoTool as unknown as new (options: never) => Record<string, unknown>, options);

      startVideoUpload(block);
      await settle();

      peerB.updateBlockData('vid1', 'caption', 'Clip of a cat');
      sync(live.store, peerB);

      rematerialize(block, VideoTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: { url: '', caption: 'Clip of a cat' },
      });

      upload.resolve({ url: 'https://cdn.test/stored/clip.mp4' });
      await settle();

      expect(dataOf(live.store, 'vid1').url).toBe('https://cdn.test/stored/clip.mp4');
      expect(dataOf(live.store, 'vid1').caption).toBe('Clip of a cat');
    });
  });

  describe('file', () => {
    it('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerB = createStore();
      const live = new LiveDocument(createStore());
      const seed = [{ id: 'file1', type: 'file', data: { url: '', caption: 'Notes' } }];

      live.store.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(live.store, peerB);

      const upload = deferred<{ url: string }>();
      const options = {
        id: 'file1',
        toolName: 'file',
        data: { url: '', caption: 'Notes' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        live,
      };
      const block = mountBlock(FileTool as unknown as new (options: never) => Record<string, unknown>, options);

      startFileUpload(block);
      await settle();

      peerB.updateBlockData('file1', 'caption', 'Meeting notes');
      sync(live.store, peerB);

      rematerialize(block, FileTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: { url: '', caption: 'Meeting notes' },
      });

      upload.resolve({ url: 'https://cdn.test/stored/notes.pdf' });
      await settle();

      expect(dataOf(live.store, 'file1').url).toBe('https://cdn.test/stored/notes.pdf');
      expect(dataOf(live.store, 'file1').caption).toBe('Meeting notes');
    });
  });

  describe('audio', () => {
    it('keeps an upload that resolves after a peer edit rebuilt the block', async () => {
      const peerB = createStore();
      const live = new LiveDocument(createStore());
      const seed = [{ id: 'aud1', type: 'audio', data: { url: '', caption: 'Take' } }];

      live.store.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(live.store, peerB);

      const upload = deferred<{ url: string }>();
      const options = {
        id: 'aud1',
        toolName: 'audio',
        data: { url: '', caption: 'Take' },
        config: { uploader: { uploadByFile: () => upload.promise } },
        live,
      };
      const block = mountBlock(AudioTool as unknown as new (options: never) => Record<string, unknown>, options);

      startAudioUpload(block);
      await settle();

      peerB.updateBlockData('aud1', 'caption', 'Take two');
      sync(live.store, peerB);

      rematerialize(block, AudioTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: { url: '', caption: 'Take two' },
      });

      upload.resolve({ url: 'https://cdn.test/stored/song.mp3' });
      await settle();

      expect(dataOf(live.store, 'aud1').url).toBe('https://cdn.test/stored/song.mp3');
      expect(dataOf(live.store, 'aud1').caption).toBe('Take two');
    });
  });

  describe('a local blob url surviving the rebuild', () => {
    /**
     * With no uploader configured the uploaders hand back
     * `URL.createObjectURL(file)` (image/uploader.ts:91, video/uploader.ts:69,
     * audio/uploader.ts:89), so `data.url` is a live `blob:` the block renders
     * from. `removed()` fires for a rematerialise as well as a delete, so
     * revoking there blanked the rebuilt block.
     */
    const blobCases: [string, new (options: never) => Record<string, unknown>][] = [
      ['image', ImageTool as unknown as new (options: never) => Record<string, unknown>],
      ['video', VideoTool as unknown as new (options: never) => Record<string, unknown>],
      ['audio', AudioTool as unknown as new (options: never) => Record<string, unknown>],
    ];

    it.each(blobCases)('keeps a blob alive for %s when a peer edit rebuilt the block', async (toolName, ToolClass) => {
      const live = new LiveDocument(createStore());
      const url = `blob:https://test/${toolName}-1`;

      live.store.fromJSON([{ id: 'b1', type: toolName, data: { url, caption: 'Before' } }]);

      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const options = {
        id: 'b1',
        toolName,
        data: { url, caption: 'Before' },
        config: {},
        live,
      };
      const block = mountBlock(ToolClass, options);

      rematerialize(block, ToolClass, { ...options, data: { url, caption: 'After' } });
      await settle();

      // The rebuilt block renders this exact url, so it must still resolve.
      expect(revoke).not.toHaveBeenCalled();
    });

    it.each(blobCases)('frees the blob for %s when the peer deleted the block', async (toolName, ToolClass) => {
      const live = new LiveDocument(createStore());
      const url = `blob:https://test/${toolName}-2`;

      live.store.fromJSON([{ id: 'b1', type: toolName, data: { url, caption: 'Before' } }]);

      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const block = mountBlock(ToolClass, {
        id: 'b1',
        toolName,
        data: { url, caption: 'Before' },
        config: {},
        live,
      });

      live.store.removeBlock('b1');
      removeBlock(block, live, 'b1');
      await settle();

      expect(revoke).toHaveBeenCalledWith(url);
    });

    it('walks the blocks store once, not twice, to free one blob', async () => {
      const live = new LiveDocument(createStore());
      const url = 'blob:https://test/image-probe';
      const seed = Array.from({ length: 10 }, (_unused, i) => ({
        id: `b${i}`,
        type: i === 9 ? 'image' : 'paragraph',
        data: i === 9 ? { url, caption: 'Before' } : { text: 'x' },
      }));

      live.store.fromJSON(seed);
      seed.slice(0, 9).forEach((entry) => live.mount(entry.id, entry.type));

      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, {
        id: 'b9',
        toolName: 'image',
        data: { url, caption: 'Before' },
        config: {},
        live,
      });

      live.indexProbes = 0;
      live.store.removeBlock('b9');
      removeBlock(block, live, 'b9');
      await settle();

      // One deferred walk answers "is the block still there?". The synchronous
      // probe that used to run first threw its answer away: it only asked
      // whether there is a document at all.
      expect(live.indexProbes).toBeLessThanOrEqual(10);
    });

    it('frees the blob right away when the tool has no editor to ask', () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const unwired = { blocks: undefined } as unknown as Parameters<typeof releaseObjectUrl>[0];

      releaseObjectUrl(unwired, 'b1', 'blob:https://test/unwired');

      expect(revoke).toHaveBeenCalledWith('blob:https://test/unwired');
    });
  });

  describe('bookmark', () => {
    it('keeps fetched link metadata that arrives after a peer edit rebuilt the block', async () => {
      const peerB = createStore();
      const live = new LiveDocument(createStore());
      const seed = [{ id: 'bm1', type: 'bookmark', data: { url: '' } }];

      live.store.fromJSON(seed);
      peerB.fromJSON(seed);
      sync(live.store, peerB);

      // MetadataFetcher goes through global fetch; hold the response open.
      const unfurl = deferred<void>();

      vi.stubGlobal('fetch', async () => {
        await unfurl.promise;

        return {
          ok: true,
          json: async () => ({
            success: 1,
            link: 'https://example.test/post',
            meta: { title: 'A post' },
          }),
        };
      });

      const options = {
        id: 'bm1',
        toolName: 'bookmark',
        data: { url: '' },
        config: { endpoint: 'https://api.test/meta' },
        live,
      };
      const block = mountBlock(Bookmark as unknown as new (options: never) => Record<string, unknown>, options);

      startBookmarkFetch(block, 'https://example.test/post');
      await settle();

      peerB.updateBlockData('bm1', 'caption', 'A link');
      sync(live.store, peerB);

      rematerialize(block, Bookmark as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        data: { url: 'https://example.test/post', caption: 'A link' },
      });

      unfurl.resolve(undefined);
      await settle();

      expect(dataOf(live.store, 'bm1').title).toBe('A post');
      expect(dataOf(live.store, 'bm1').caption).toBe('A link');
    });
  });
  describe('the blocks store is updated synchronously (what the deferred revoke rests on)', () => {
    /**
     * `releaseObjectUrl` defers its decision by one microtask because `removed()`
     * runs BEFORE the store is touched. That is only sound if the store is
     * updated in the SAME task — otherwise the probe answers "still present" and
     * the blob is never freed. Measured here against the real store, not assumed.
     */
    const probeStore = (
      act: (store: BlocksStore) => void
    ): { insideRemoved: boolean; afterReturn: boolean; nextMicrotask: Promise<boolean> } => {
      const store = new Proxy(new Blocks(document.createElement('div')), {
        set: Blocks.set,
        get: Blocks.get,
      }) as unknown as BlocksStore;
      const repository = new BlockRepository();

      repository.initialize(store);

      const present = (): boolean => repository.getBlockById('probe1') !== undefined;
      const seen: { insideRemoved: boolean } = { insideRemoved: false };
      let resolveNext!: (value: boolean) => void;
      const nextMicrotask = new Promise<boolean>((resolve) => {
        resolveNext = resolve;
      });

      const makeBlock = (): Block => {
        const adapter = {
          name: 'probe',
          settings: { config: {} },
          create: () => ({
            render: (): HTMLElement => document.createElement('div'),
            save: (): Record<string, unknown> => ({}),
            removed: (): void => {
              seen.insideRemoved = present();
              queueMicrotask(() => resolveNext(present()));
            },
          }),
          tunes: new ToolsCollection(),
          sanitizeConfig: {},
          inlineTools: new ToolsCollection(),
          conversionConfig: undefined,
        } as unknown as BlockToolAdapter;

        return new Block({
          id: 'probe1',
          data: {},
          tool: adapter,
          readOnly: false,
          tunesData: {},
          api: {} as ApiModules,
        });
      };

      store.insert(0, makeBlock());
      act(store);

      return { insideRemoved: seen.insideRemoved, afterReturn: present(), nextMicrotask };
    };

    it('Blocks.remove: present inside removed(), gone by the next microtask', async () => {
      const measured = probeStore((store) => store.remove(0));

      // The defect the deferral would hit: a store still holding the block one
      // microtask later means the blob is NEVER revoked.
      await expect(measured.nextMicrotask).resolves.toBe(false);
      expect(measured.insideRemoved).toBe(true);
      expect(measured.afterReturn).toBe(false);
    });

    it('Blocks.replace: the id resolves to the NEW block by the next microtask', async () => {
      const measured = probeStore((store) => {
        const replacement = new Block({
          id: 'probe1',
          data: {},
          tool: {
            name: 'probe',
            settings: { config: {} },
            create: () => ({
              render: (): HTMLElement => document.createElement('div'),
              save: (): Record<string, unknown> => ({}),
            }),
            tunes: new ToolsCollection(),
            sanitizeConfig: {},
            inlineTools: new ToolsCollection(),
            conversionConfig: undefined,
          } as unknown as BlockToolAdapter,
          readOnly: false,
          tunesData: {},
          api: {} as ApiModules,
        });

        store.replace(0, replacement);
      });

      await expect(measured.nextMicrotask).resolves.toBe(true);
      expect(measured.insideRemoved).toBe(true);
      expect(measured.afterReturn).toBe(true);
    });
  });

  describe('an ordinary delete is not a warning', () => {
    const quietCases: [string, new (options: never) => Record<string, unknown>][] = [
      ['image', ImageTool as unknown as new (options: never) => Record<string, unknown>],
      ['video', VideoTool as unknown as new (options: never) => Record<string, unknown>],
      ['audio', AudioTool as unknown as new (options: never) => Record<string, unknown>],
    ];

    it.each(quietCases)('deleting a %s holding an un-uploaded blob logs nothing', async (toolName, ToolClass) => {
      const live = new LiveDocument(createStore());
      const url = `blob:https://test/${toolName}-quiet`;

      live.store.fromJSON([{ id: 'b1', type: toolName, data: { url, caption: 'Before' } }]);

      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const block = mountBlock(ToolClass, {
        id: 'b1',
        toolName,
        data: { url, caption: 'Before' },
        config: {},
        live,
      });

      live.store.removeBlock('b1');
      removeBlock(block, live, 'b1');
      await settle();

      // `api.blocks.getById` WARNS on a miss, and a miss is the normal case
      // here — probing with it made every media delete print to the host's
      // console.
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('a peer converting the block to another tool', () => {
    it('does not write the upload into the converted block, and names the stranded file', async () => {
      const live = new LiveDocument(createStore());

      live.store.fromJSON([{ id: 'img1', type: 'image', data: { url: '', caption: 'Cat' } }]);

      const upload = deferred<{ url: string }>();
      const options = {
        id: 'img1',
        toolName: 'image',
        data: { url: '', caption: 'Cat' },
        config: { uploader: { uploadByUrl: () => upload.promise } },
        live,
      };
      const block = mountBlock(ImageTool as unknown as new (options: never) => Record<string, unknown>, options);

      startImageUpload(block);
      await settle();

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // `BlockMutation.replace` preserves the block id across a conversion, so
      // the id still resolves — to a paragraph.
      rematerialize(block, PlainTextTool as unknown as new (options: never) => Record<string, unknown>, {
        ...options,
        toolName: 'paragraph',
        data: { text: 'hello' },
      });

      upload.resolve({ url: 'https://cdn.test/stored/photo.png' });
      await settle();

      // The defect: `{url, fileName}` merged into paragraph data, recomposing
      // the block under the author's caret for keys `Paragraph.save()` drops.
      // The pasted link itself was written when the paste started the upload.
      expect(dataOf(live.store, 'img1').url).toBe('https://cdn.test/photo.png');
      expect(dataOf(live.store, 'img1').fileName).toBeUndefined();

      // Not a silent drop: the file is named so it can still be reached.
      const said = warn.mock.calls.map((call) => call.join(' ')).join(' | ');

      expect(said).toContain('paragraph');
      expect(warn.mock.calls.some((call) => call.some((arg) => arg === 'https://cdn.test/stored/photo.png' ||
        (typeof arg === 'object' && arg !== null && 'url' in arg &&
          (arg as { url?: unknown }).url === 'https://cdn.test/stored/photo.png')))).toBe(true);
    });
  });
});
