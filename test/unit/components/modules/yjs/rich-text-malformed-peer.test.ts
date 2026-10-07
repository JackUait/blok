/**
 * A peer can write any value into a formatted text. A mark or embed value of
 * the wrong type must not make the room unreadable: this client, a fresh
 * store and a late-joining editor all still read and save every block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: {
    update: (id: string, data?: Record<string, unknown>) => Promise<{ id: string }>;
  };
}

let editor: TestEditor | undefined;
let joiner: TestEditor | undefined;
let holders: HTMLDivElement[] = [];
let local: YjsManager | undefined;
let peer: DocumentStore | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const frame = async (): Promise<void> => {
  await flush();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await flush();
};

const requireLocal = (): YjsManager => {
  if (local === undefined) {
    throw new Error('the editor never built a YjsManager');
  }

  return local;
};

const requirePeer = (): DocumentStore => {
  if (peer === undefined) {
    throw new Error('the peer store was never created');
  }

  return peer;
};

const deliverTo = (manager: YjsManager): void => {
  manager.applyRemoteUpdate(requirePeer().encodeStateAsUpdate(manager.getStateVector()));
};

const peerText = (id: string): Y.XmlText => {
  const text = requirePeer().blocksMap.get(id)?.get('data')?.get('text');

  if (!(text instanceof Y.XmlText)) {
    throw new Error(`the peer's «${id}».text is not formatted`);
  }

  return text;
};

const newHolder = (): HTMLDivElement => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  return holder;
};

const textIn = (holder: HTMLDivElement, id: string): string =>
  holder.querySelector(`[data-blok-id="${id}"]`)?.textContent ?? '';

const plainOf = (value: unknown): string =>
  Array.isArray(value) ? value.map((segment: { text?: string }) => segment.text ?? '').join('') : String(value);

const savedTexts = (saved: OutputData): Record<string, string> => Object.fromEntries(
  saved.blocks.map((block): [string, string] => [block.id ?? '', plainOf(block.data.text)])
);

const MALFORMED: Array<[string, (text: Y.XmlText) => void]> = [
  ['tag attr number', text => text.format(0, 4, { 'tag:b': { x: 1 } })],
  ['tag attr null', text => text.format(0, 4, { 'tag:b': { x: null } })],
  ['color object', text => text.format(0, 4, { color: {} })],
  ['embed equation expression number', text => text.insertEmbed(4, { equation: { expression: 5 } }, {})],
  ['embed equation null', text => text.insertEmbed(4, { equation: null }, {})],
  ['embed page id object', text => text.insertEmbed(4, { page: { id: {} } }, {})],
];

describe('malformed rich text written by a peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      local = this;

      return originalFromJSON.call(this, blocks);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    joiner?.destroy();
    await frame();
    holders.forEach(holder => holder.remove());
    peer?.destroy();
    editor = undefined;
    joiner = undefined;
    holders = [];
    local = undefined;
    peer = undefined;
    vi.restoreAllMocks();
  });

  const boot = async (): Promise<{ instance: TestEditor; holder: HTMLDivElement }> => {
    const holder = newHolder();
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, header: Header },
      data: {
        blocks: [
          { id: 'h', type: 'header', data: { text: 'title', level: 2 } },
          { id: 'p', type: 'paragraph', data: { text: 'body text' } },
        ],
      },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireLocal().encodeStateAsUpdate(peer.getStateVector()));

    return { instance, holder };
  };

  it.each(MALFORMED)('%s: the receiving editor still reads and saves every block', async (_label, write) => {
    const { instance, holder } = await boot();

    write(peerText('p'));
    deliverTo(requireLocal());
    await frame();

    expect(savedTexts(await instance.save())).toEqual({ h: 'title', p: 'body text' });
    expect(textIn(holder, 'p')).toBe('body text');
    expect(() => requirePeer().toJSON()).not.toThrow();
  });

  it.each(MALFORMED)('%s: a fresh store and a late joiner still read every block', async (_label, write) => {
    await boot();
    write(peerText('p'));

    const fresh = new DocumentStore(new YBlockSerializer());

    fresh.applyRemoteUpdate(requirePeer().encodeStateAsUpdate(fresh.getStateVector()));
    expect(fresh.toJSON().map(block => block.id)).toEqual(['h', 'p']);
    fresh.destroy();

    const holder = newHolder();
    const first = local;
    const instance = new Blok({ holder, tools: { paragraph: Paragraph, header: Header }, data: { blocks: [] } }) as unknown as TestEditor;

    joiner = instance;
    await instance.isReady;
    await flush();

    const joinerManager = requireLocal();

    expect(joinerManager).not.toBe(first);
    deliverTo(joinerManager);
    await frame();

    expect(savedTexts(await instance.save())).toEqual({ h: 'title', p: 'body text' });
    expect(textIn(holder, 'p')).toBe('body text');
  });

  it('a local edit after a peer\'s bad embed lands at the right place', async () => {
    const { instance } = await boot();

    peerText('p').insertEmbed(4, { equation: null }, {});
    deliverTo(requireLocal());
    await frame();

    await instance.blocks.update('p', { text: 'body more text' });
    await frame();

    const localUpdate = requireLocal().encodeStateAsUpdate(requirePeer().getStateVector());

    requirePeer().applyRemoteUpdate(localUpdate);

    const read = (blocks: OutputData['blocks']): unknown => blocks.find(block => block.id === 'p')?.data.text;

    expect(read(requireLocal().toJSON())).toBe('body more text');
    expect(read(requirePeer().toJSON())).toBe('body more text');
  });
});
