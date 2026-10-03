import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  history: { undo: () => void };
  blocks: { move: (toIndex: number, fromIndex?: number) => void };
}

interface SeenEvent {
  type: string;
  origin: unknown;
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

const SLOW_SET_DATA_MS = 700;

/** Writes its DOM at once but reports done only later, so the remote window stays open. */
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

const toSeen = (event: unknown): SeenEvent => {
  if (!(event instanceof CustomEvent)) {
    throw new Error('onChange got something other than a CustomEvent');
  }
  const detail: unknown = event.detail;
  const origin = typeof detail === 'object' && detail !== null && 'origin' in detail ? detail.origin : undefined;

  return { type: event.type, origin };
};

describe('block mutation events carry origin', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;
  let yjs: YjsManager | undefined;
  let blockManager: BlockManager | undefined;
  let peer: DocumentStore | undefined;
  const seen: SeenEvent[] = [];

  const requireYjs = (): YjsManager => {
    if (yjs === undefined) {
      throw new Error('YjsManager was not captured');
    }

    return yjs;
  };

  const requireBlockManager = (): BlockManager => {
    if (blockManager === undefined) {
      throw new Error('BlockManager was not captured');
    }

    return blockManager;
  };

  const boot = async (tool: 'paragraph' | 'slow'): Promise<void> => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, slow: SlowText },
      onChange: (_api: unknown, event: unknown) => {
        (Array.isArray(event) ? event : [event]).forEach((item) => seen.push(toSeen(item)));
      },
      data: { blocks: [{ id: 'shared', type: tool, data: { text: 'before' } }] },
    }) as unknown as TestEditor;
    await editor.isReady;
    await settle();
    seen.length = 0;
    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireYjs().encodeStateAsUpdate(peer.getStateVector()));
  };

  const applyPeerText = (text: string): void => {
    if (peer === undefined) {
      throw new Error('peer not created');
    }
    peer.updateBlockData('shared', 'text', text);
    requireYjs().applyRemoteUpdate(peer.encodeStateAsUpdate(requireYjs().getStateVector()), peer);
  };

  const content = (): HTMLElement => {
    const element = holder?.querySelector('[data-blok-id="shared"] [contenteditable="true"]');

    if (!(element instanceof HTMLElement)) {
      throw new Error('block not rendered');
    }

    return element;
  };

  const type = (text: string): void => {
    const element = content();

    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
    element.innerHTML = `${element.innerHTML}${text}`;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installContentEditableReflection();
    seen.length = 0;
    const originalFromJSON = YjsManager.prototype.fromJSON;
    const originalPrepare = BlockManager.prototype.prepare;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (this: YjsManager, blocks: Parameters<YjsManager['fromJSON']>[0]) {
      yjs = this;

      return originalFromJSON.call(this, blocks);
    });
    vi.spyOn(BlockManager.prototype, 'prepare').mockImplementation(function (this: BlockManager) {
      blockManager = this;

      return originalPrepare.call(this);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    await frame();
    await drain();
    peer?.destroy();
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('labels a change applied from a tab update', async () => {
    await boot('paragraph');
    requireBlockManager().setRemoteOriginLabel('tab');

    applyPeerText('from another tab');
    await settle();

    expect(seen).toEqual([{ type: 'block-changed', origin: 'tab' }]);
  });

  const requirePeer = (): DocumentStore => {
    if (peer === undefined) {
      throw new Error('peer not created');
    }

    return peer;
  };

  const sendPeerUpdate = (): void => {
    requireYjs().applyRemoteUpdate(requirePeer().encodeStateAsUpdate(requireYjs().getStateVector()), peer);
  };

  it('labels a block added from a tab update', async () => {
    await boot('paragraph');
    requireBlockManager().setRemoteOriginLabel('tab');

    requirePeer().addBlock({ id: 'second', type: 'paragraph', data: { text: 'new' } });
    sendPeerUpdate();
    await settle();

    expect(seen).toContainEqual({ type: 'block-added', origin: 'tab' });
    expect(seen.every((event) => event.origin === 'tab')).toBe(true);
  });

  it('labels a block removed by a tab update', async () => {
    await boot('paragraph');
    requirePeer().addBlock({ id: 'second', type: 'paragraph', data: { text: 'new' } });
    sendPeerUpdate();
    await settle();
    seen.length = 0;
    requireBlockManager().setRemoteOriginLabel('tab');

    requirePeer().removeBlock('second');
    sendPeerUpdate();
    await settle();

    expect(seen).toContainEqual({ type: 'block-removed', origin: 'tab' });
    expect(seen.every((event) => event.origin === 'tab')).toBe(true);
  });

  // A peer's move emits no block-moved at all, so only the local one is checked.
  it('labels a local move local while the remote label is tab', async () => {
    await boot('paragraph');
    requirePeer().addBlock({ id: 'second', type: 'paragraph', data: { text: 'new' } });
    sendPeerUpdate();
    await settle();
    seen.length = 0;
    requireBlockManager().setRemoteOriginLabel('tab');

    editor?.blocks.move(0, 1);
    await settle();

    expect(seen).toContainEqual({ type: 'block-moved', origin: 'local' });
    expect(seen.every((event) => event.origin === 'local')).toBe(true);
  });

  it('keeps a local edit local when a tab update to the same block lands in the same onChange batch', async () => {
    await boot('paragraph');
    requireBlockManager().setRemoteOriginLabel('tab');

    // The first change is delivered at once; the next two share one batch.
    applyPeerText('opens the window');
    await drain();
    await frame();
    await frame();
    await drain();
    type('a');
    await drain();
    applyPeerText('from another tab');
    await settle();

    expect(seen.map((event) => event.origin)).toContain('local');
  });

  it('labels a change from a collaboration peer remote by default', async () => {
    await boot('paragraph');

    applyPeerText('from a peer');
    await settle();

    expect(seen).toEqual([{ type: 'block-changed', origin: 'remote' }]);
  });

  it('labels a local edit local', async () => {
    await boot('paragraph');
    requireBlockManager().setRemoteOriginLabel('tab');

    type('a');
    await settle();

    expect(seen).toEqual([{ type: 'block-changed', origin: 'local' }]);
  });

  it('labels an undo local', async () => {
    await boot('paragraph');
    requireBlockManager().setRemoteOriginLabel('tab');
    type('a');
    await settle();
    requireYjs().stopCapturing();
    seen.length = 0;

    editor?.history.undo();
    await settle();

    expect(seen).toEqual([{ type: 'block-changed', origin: 'local' }]);
  });

  it('labels a keystroke typed while a tab update is still applying local', async () => {
    await boot('slow');
    requireBlockManager().setRemoteOriginLabel('tab');

    applyPeerText('from another tab');
    // Inside setData's await: the remote window is still open.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const beforeTyping = seen.length;

    type(' and mine');
    await settle();

    // The peer's DOM rewrite is announced by the replay alone, so the first
    // event after typing is the keystroke.
    expect(seen.slice(beforeTyping)[0]).toEqual({ type: 'block-changed', origin: 'local' });
  });
});
