import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  history: { undo: () => void };
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

const eventTypes = (calls: unknown[][]): string[] => calls.map((call) => {
  const event = call[1];
  const events = Array.isArray(event) ? event : [event];

  return events.map((item: { type: string }) => item.type).join(',');
});

describe('onChange for a change applied from the shared document', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;
  let yjs: YjsManager | undefined;
  let peer: DocumentStore | undefined;
  const onChange = vi.fn();

  const requireYjs = (): YjsManager => {
    if (yjs === undefined) {
      throw new Error('YjsManager was not captured');
    }

    return yjs;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    installContentEditableReflection();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (this: YjsManager, blocks: Parameters<YjsManager['fromJSON']>[0]) {
      yjs = this;

      return originalFromJSON.call(this, blocks);
    });
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      onChange,
      data: { blocks: [{ id: 'shared', type: 'paragraph', data: { text: 'before' } }] },
    }) as unknown as TestEditor;
    await editor.isReady;
    await settle();
    onChange.mockClear();
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

  it('fires once for one undo', async () => {
    const paragraph = holder?.querySelector('[data-blok-tool="paragraph"]');

    if (!(paragraph instanceof HTMLElement) || editor === undefined) {
      throw new Error('paragraph not rendered');
    }
    paragraph.innerHTML = 'locally typed';
    await settle();
    onChange.mockClear();

    editor.history.undo();
    await settle();

    expect(eventTypes(onChange.mock.calls)).toEqual(['block-changed']);
  });

  it('fires once for one remote update', async () => {
    if (peer === undefined) {
      throw new Error('peer not created');
    }
    peer.updateBlockData('shared', 'text', 'peer typed');
    requireYjs().applyRemoteUpdate(peer.encodeStateAsUpdate(requireYjs().getStateVector()));
    await settle();

    expect(eventTypes(onChange.mock.calls)).toEqual(['block-changed']);
  });
});
