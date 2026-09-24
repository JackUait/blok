import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: { getById: (id: string) => { dispatchChange: () => void } | null };
}

interface SaverApi {
  saver: { save: () => Promise<{ blocks: Array<{ id?: string; data: { text?: unknown } }> }> };
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};
const frame = async (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
// Longer than the 400ms onChange batch window, so a trailing delivery shows up.
const settle = async (): Promise<void> => {
  await drain();
  await frame();
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 900));
  await drain();
  await frame();
  await drain();
};

// jsdom does not reflect contentEditable to the attribute Blok reads.
const installContentEditableReflection = (): void => {
  if (Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable') !== undefined) {
    return;
  }
  Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get(this: HTMLElement): string {
      return this.getAttribute('contenteditable') ?? 'inherit';
    },
    set(this: HTMLElement, value: string): void {
      this.setAttribute('contenteditable', value);
    },
  });
};

// Longer than the onChange batch window, so the window of a rewrite is still
// open after the host has been told about it.
const SLOW_SET_DATA_MS = 700;

/** Writes its DOM at once but reports done only later, like a tool that loads something. */
class SlowText {
  private readonly element: HTMLElement;

  constructor({ data }: { data: { text?: string } }) {
    this.element = document.createElement('div');
    this.element.setAttribute('contenteditable', 'true');
    this.element.innerHTML = data.text ?? '';
  }

  public render(): HTMLElement {
    return this.element;
  }

  public save(element: HTMLElement): { text: string } {
    return { text: element.innerHTML };
  }

  public async setData(data: { text?: string }): Promise<boolean> {
    this.element.innerHTML = data.text ?? '';
    await new Promise((resolve) => setTimeout(resolve, SLOW_SET_DATA_MS));

    return true;
  }
}

describe('onChange for a local change while a peer change is still applying', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;
  let yjs: YjsManager | undefined;
  let peer: DocumentStore | undefined;
  const hostSaw: unknown[] = [];

  const requireYjs = (): YjsManager => {
    if (yjs === undefined) {
      throw new Error('YjsManager was not captured');
    }

    return yjs;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    installContentEditableReflection();
    hostSaw.length = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (this: YjsManager, blocks: Parameters<YjsManager['fromJSON']>[0]) {
      yjs = this;

      return originalFromJSON.call(this, blocks);
    });
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, slow: SlowText },
      onChange: async (api: SaverApi) => {
        const saved = await api.saver.save();

        hostSaw.push(saved.blocks.find((block) => block.id === 'shared')?.data.text);
      },
      data: { blocks: [{ id: 'shared', type: 'slow', data: { text: 'before' } }] },
    }) as unknown as TestEditor;
    await editor.isReady;
    await settle();
    hostSaw.length = 0;
    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireYjs().encodeStateAsUpdate(peer.getStateVector()));
  });

  afterEach(async () => {
    editor?.destroy();
    await frame();
    await drain();
    peer?.destroy();
    holder?.remove();
    vi.restoreAllMocks();
  });

  const applyPeerText = (text: string): void => {
    if (peer === undefined) {
      throw new Error('peer not created');
    }
    peer.updateBlockData('shared', 'text', text);
    requireYjs().applyRemoteUpdate(peer.encodeStateAsUpdate(requireYjs().getStateVector()));
  };

  const content = (): HTMLElement => {
    const element = holder?.querySelector('[data-blok-id="shared"] [contenteditable="true"]');

    if (!(element instanceof HTMLElement)) {
      throw new Error('block not rendered');
    }

    return element;
  };

  // After the host was told about the peer's text, still inside the window.
  const intoTheOpenWindow = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 550));
  };

  it('tells the host about a DOM change it did not type (a paste, an inline tool)', async () => {
    applyPeerText('peer');
    await intoTheOpenWindow();

    content().innerHTML = 'peer <b>pasted</b>';
    await settle();

    expect(hostSaw.at(-1)).toBe('peer <b>pasted</b>');
  });

  it('tells the host about a change a tool reports itself', async () => {
    applyPeerText('peer');
    await intoTheOpenWindow();

    const element = content();

    element.textContent = 'peer and toggled';
    editor?.blocks.getById('shared')?.dispatchChange();
    await settle();

    expect(hostSaw.at(-1)).toBe('peer and toggled');
  });

  it('still tells the host once about the peer change alone', async () => {
    applyPeerText('peer');
    await settle();

    expect(hostSaw).toEqual(['peer']);
  });
});
