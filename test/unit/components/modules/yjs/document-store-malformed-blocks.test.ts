import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Total readers. A peer with a write pass can put ANY shape into the doc: a
 * block whose `data` is a string, whose `id` is a number, or whose data nests
 * thousands of levels. The store's readers run inside the observer during
 * `Y.applyUpdate`, so a throw there ends every member's session and the poison
 * persists in the room. The lockstep rule (mirrored by the C# converter):
 * a block whose `id` or `type` is not a string, or whose `data` is not a map,
 * is skipped on export with a warning naming the id; a value nested past 256
 * levels exports as null.
 */
const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

/** A block Y.Map built field by field, bypassing the serializer on purpose. */
const rawBlock = (fields: Record<string, unknown>): Y.Map<unknown> => {
  const yblock = new Y.Map<unknown>();

  for (const [key, value] of Object.entries(fields)) {
    yblock.set(key, value);
  }

  return yblock;
};

/**
 * Grow a chain of `levels` nested Y.Maps under `root` (key `n`), one
 * integrated map per step so yjs itself never recurses. Returns the deepest.
 */
const growMapChain = (root: Y.Map<unknown>, levels: number): Y.Map<unknown> => {
  let current = root;

  for (let level = 0; level < levels; level++) {
    const next = new Y.Map<unknown>();

    current.set('n', next);
    current = next;
  }

  return current;
};

/** Follow `n` keys down a plain object `levels` times. */
const descend = (value: unknown, levels: number): unknown => {
  let current = value;

  for (let level = 0; level < levels; level++) {
    if (current === null || typeof current !== 'object') {
      return current;
    }

    current = (current as Record<string, unknown>).n;
  }

  return current;
};

/**
 * The writer mints the shape with raw Y writes among two good blocks; the
 * reader receives everything over the binary seam, as a room member would.
 */
const receive = (mint: (writer: DocumentStore) => void): DocumentStore => {
  const writer = createStore();

  writer.fromJSON([paragraph('good-1', 'one'), paragraph('good-2', 'two')]);
  writer.transact(() => mint(writer), 'local');

  const reader = createStore();

  reader.applyRemoteUpdate(writer.encodeStateAsUpdate(), { source: 'peer' });

  return reader;
};

const goodIds = (store: DocumentStore): string[] => store.toJSON().map((block) => block.id as string);

describe('DocumentStore — malformed blocks from a peer', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a block whose data is a string', () => {
    const mint = (writer: DocumentStore): void => {
      writer.blocksMap.set('bad-data', rawBlock({ id: 'bad-data', type: 'paragraph', data: 'junk' }));
      writer.rootOrder.insert(1, ['bad-data']);
    };

    it('is skipped by toJSON with a warning naming its id; the good blocks still serialize', () => {
      const reader = receive(mint);

      expect(goodIds(reader)).toEqual(['good-1', 'good-2']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad-data'), expect.anything(), expect.anything());
    });

    it('is absent from orderedIds(), which equals the ids toJSON emits', () => {
      const reader = receive(mint);

      expect(reader.orderedIds()).toEqual(['good-1', 'good-2']);
      expect(reader.orderedIds()).toEqual(goodIds(reader));
    });

    it('refuses a local data write to it (false, no throw) and keeps the doc readable', () => {
      const reader = receive(mint);

      expect(reader.updateBlockData('bad-data', 'text', 'x')).toBe(false);
      expect(goodIds(reader)).toEqual(['good-1', 'good-2']);
    });
  });

  describe('a block whose id is a number', () => {
    const mint = (writer: DocumentStore): void => {
      writer.blocksMap.set('bad-id', rawBlock({ id: 42, type: 'paragraph', data: new Y.Map<unknown>() }));
      writer.rootOrder.insert(1, ['bad-id']);
    };

    it('is skipped by toJSON with a warning naming its map key; the good blocks still serialize', () => {
      const reader = receive(mint);

      expect(goodIds(reader)).toEqual(['good-1', 'good-2']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad-id'), expect.anything(), expect.anything());
    });

    it('is absent from orderedIds()', () => {
      const reader = receive(mint);

      expect(reader.orderedIds()).toEqual(['good-1', 'good-2']);
    });
  });

  describe('a block whose type is a number', () => {
    const mint = (writer: DocumentStore): void => {
      writer.blocksMap.set('bad-type', rawBlock({ id: 'bad-type', type: 7, data: new Y.Map<unknown>() }));
      writer.rootOrder.push(['bad-type']);
    };

    it('is skipped by toJSON and orderedIds(); the good blocks still serialize', () => {
      const reader = receive(mint);

      expect(goodIds(reader)).toEqual(['good-1', 'good-2']);
      expect(reader.orderedIds()).toEqual(['good-1', 'good-2']);
    });
  });

  describe('a block whose tunes is a string', () => {
    const mint = (writer: DocumentStore): void => {
      const data = new Y.Map<unknown>();

      data.set('text', 'tuned');
      writer.blocksMap.set('str-tunes', rawBlock({ id: 'str-tunes', type: 'paragraph', data, tunes: 'junk' }));
      writer.rootOrder.push(['str-tunes']);
    };

    it('still serializes (tunes dropped) and a local tune write replaces the junk instead of throwing', () => {
      const reader = receive(mint);

      expect(reader.toJSON().find((block) => block.id === 'str-tunes')?.tunes).toBeUndefined();
      expect(() => reader.updateBlockTune('str-tunes', 'anchor', 'intro')).not.toThrow();
      expect(reader.toJSON().find((block) => block.id === 'str-tunes')?.tunes).toEqual({ anchor: 'intro' });
    });
  });

  describe('data nested 2000 levels deep', () => {
    const mint = (writer: DocumentStore): void => {
      writer.addBlock({ id: 'deep', type: 'widget', data: {} });

      const data = writer.getBlockById('deep')?.get('data');

      if (!(data instanceof Y.Map)) {
        throw new Error('test setup: data must be a Y.Map');
      }

      growMapChain(data, 2000).set('leaf', 'bottom');
    };

    it('exports the first 256 levels and null past them, without overflowing the stack', () => {
      const reader = receive(mint);
      const deep = reader.toJSON().find((block) => block.id === 'deep');

      expect(deep).toBeDefined();
      expect(descend(deep?.data, 256)).toEqual({ n: null });
      expect(descend(deep?.data, 257)).toBeNull();
      expect(reader.orderedIds()).toEqual(['good-1', 'good-2', 'deep']);
    });

    it('compares a local write against the capped read-back, so the equality guard cannot overflow', () => {
      const reader = receive(mint);
      const nested = reader.getBlockById('deep')?.get('data');

      if (!(nested instanceof Y.Map)) {
        throw new Error('test setup: data must be a Y.Map');
      }

      // The same value the guard reads back: equal → no write, no recursion
      // into the 2000 levels. (Replacing the value instead would recurse
      // inside yjs's own delete — the server's 256 cap is that guard.)
      const sameAsStored = new YBlockSerializer().yMapToObject(nested.get('n') as Y.Map<unknown>);

      expect(reader.updateBlockData('deep', 'n', sameAsStored)).toBe(false);
    });
  });

  it('orderedIds() derives the order without warning, so a per-event reader stays quiet', () => {
    const reader = receive((writer) => {
      writer.blocksMap.set('bad-data', rawBlock({ id: 'bad-data', type: 'paragraph', data: 'junk' }));
      writer.rootOrder.push(['bad-data']);
    });

    reader.orderedIds();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('YBlockSerializer — depth cap on read-back', () => {
  const serializer = new YBlockSerializer();
  let ydoc: Y.Doc;
  let data: Y.Map<unknown>;

  beforeEach(() => {
    ydoc = new Y.Doc();
    data = ydoc.getMap('data');
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it('a value directly inside data is level 1; the 257th nested map reads as null', () => {
    ydoc.transact(() => {
      growMapChain(data, 300).set('leaf', 'bottom');
    });

    const plain = serializer.yMapToObject(data);

    expect(descend(plain, 255)).toEqual({ n: { n: null } });
    expect(descend(plain, 256)).toEqual({ n: null });
    expect(descend(plain, 257)).toBeNull();
  });

  it('caps nested Y.Arrays the same way', () => {
    ydoc.transact(() => {
      const root = new Y.Array<unknown>();

      data.set('a', root);

      let current = root;

      for (let level = 1; level < 300; level++) {
        const next = new Y.Array<unknown>();

        current.insert(0, [next]);
        current = next;
      }

      current.insert(0, ['bottom']);
    });

    let current: unknown = serializer.yMapToObject(data).a;
    let depth = 1;

    while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) {
      current = current[0];
      depth += 1;
    }

    expect(depth).toBe(256);
    expect(current).toEqual([null]);
  });

  it('counts a keyed grid as ONE level (its rows are the next level, its cells the one after)', () => {
    ydoc.transact(() => {
      const holder = growMapChain(data, 254);

      holder.set('g', serializer.plainToYValue([[{ cell: 1 }, { cell: 2 }]]));
    });

    const holder = descend(serializer.yMapToObject(data), 254) as Record<string, unknown>;

    // grid at level 255, its one row at 256 (kept), the two cells at 257 (null)
    expect(holder.g).toEqual([[null, null]]);
  });

  it('leaves everything within 256 levels intact', () => {
    ydoc.transact(() => {
      growMapChain(data, 255).set('leaf', 'kept');
    });

    expect(descend(serializer.yMapToObject(data), 255)).toEqual({ leaf: 'kept' });
  });
});

describe('BlockYjsSync derives ids without serializing data', () => {
  it('yjs-sync.ts never reads the order through YjsManager.toJSON()', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../../src/components/modules/blockManager/yjs-sync.ts'),
      'utf8'
    );

    // A malformed block makes toJSON skip it and warn on every call; the
    // reconciler runs per remote event and only needs ids, so it must go
    // through orderedIds().
    expect(source).not.toMatch(/YjsManager\.toJSON\(\)/);
    expect(source).toMatch(/YjsManager\.orderedIds\(\)/);
  });
});
