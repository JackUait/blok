import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import Blok from '../../../../../src/blok';
import { Core } from '../../../../../src/components/core';
import { readPageFields } from '../../../../../src/components/modules/yjs/page-fields';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig, OutputData } from '../../../../../types';
import type { PageCover } from '../../../../../types/tools/page';

const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: { paragraph: { class: Paragraph } }, ...config }) as unknown as PublicBlok;

const DOC: OutputData = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] };
const IMAGE: PageCover = { type: 'image', url: 'https://example.com/cover.png', position: 30 };
const GALLERY: PageCover = { type: 'gallery', id: 'dusk' };

describe('page cover field', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('loads from config data and saves back unchanged', async () => {
    blok = create({ holder, pageTitle: true, data: { ...DOC, cover: IMAGE } });
    await blok.isReady;

    expect(blok.title.cover.get()).toEqual(IMAGE);
    expect((await blok.save()).cover).toEqual(IMAGE);
  });

  it('round-trips with the title switched off, so a second host keeps it', async () => {
    blok = create({ holder, data: { ...DOC, cover: GALLERY } });
    await blok.isReady;

    expect((await blok.save()).cover).toEqual(GALLERY);
  });

  it('round-trips with the cover flag off', async () => {
    blok = create({ holder, pageTitle: true, data: { ...DOC, cover: IMAGE } });
    await blok.isReady;

    expect((await blok.save()).cover).toEqual(IMAGE);
  });

  it('title.cover.set saves, fires onCoverChange with source api, and undoes in one step', async () => {
    const onCoverChange = vi.fn();

    blok = create({ holder, pageTitle: { cover: true, onCoverChange }, data: DOC });
    await blok.isReady;
    blok.title.cover.set(GALLERY);

    expect(onCoverChange).toHaveBeenNthCalledWith(1, GALLERY, { source: 'api' });
    expect((await blok.save()).cover).toEqual(GALLERY);

    blok.history.undo();

    expect(blok.title.cover.get()).toBeNull();
    expect(onCoverChange).toHaveBeenLastCalledWith(null, { source: 'undo' });
    expect((await blok.save()).cover).toBeUndefined();

    blok.history.redo();

    expect(blok.title.cover.get()).toEqual(GALLERY);
  });

  it('title.cover.set with record: false adds no undo step', async () => {
    blok = create({ holder, pageTitle: { cover: true }, data: DOC });
    await blok.isReady;
    blok.title.cover.set(IMAGE, { record: false });
    blok.history.undo();

    expect(blok.title.cover.get()).toEqual(IMAGE);
  });

  it('title.cover.set before ready lands after ready', async () => {
    blok = create({ holder, pageTitle: { cover: true }, data: DOC });
    blok.title.cover.set(GALLERY);
    await blok.isReady;

    expect(blok.title.cover.get()).toEqual(GALLERY);
  });

  it('render swaps the cover with the document', async () => {
    blok = create({ holder, pageTitle: true, data: { ...DOC, cover: IMAGE } });
    await blok.isReady;
    await blok.render({ ...DOC, cover: GALLERY });

    expect(blok.title.cover.get()).toEqual(GALLERY);

    await blok.render(DOC);

    expect(blok.title.cover.get()).toBeNull();
  });
});

describe('page cover in the page map', () => {
  it('reads a malformed cover as none', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('page');
    const bad: unknown[] = [
      { type: 'image' },
      { type: 'gallery', id: 3 },
      { type: 'video', url: 'x' },
      { type: 'image', url: 'https://a/b.png', position: 101 },
      { type: 'image', url: 'https://a/b.png', position: 12.5 },
      'https://a/b.png',
    ];

    for (const value of bad) {
      map.set('cover', value);

      expect(readPageFields(map).cover).toBeUndefined();
    }
    map.set('cover', IMAGE);

    expect(readPageFields(map).cover).toEqual(IMAGE);
  });

  it('a peer cover write reaches the listener as remote', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [] } });

    await core.isReady;
    const yjs = core.moduleInstances.YjsManager;
    const listener = vi.fn();
    const peer = new Y.Doc();

    yjs.onPageChange(listener);
    Y.applyUpdate(peer, yjs.encodeStateAsUpdate());
    peer.getMap('page').set('cover', GALLERY);
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });

    expect(listener).toHaveBeenCalledWith('cover', 'remote');
    expect(yjs.getPageFields().cover).toEqual(GALLERY);
    holder.remove();
  });
});
