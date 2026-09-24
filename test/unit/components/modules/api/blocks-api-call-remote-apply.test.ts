import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void };
  blocks: {
    setBlockParent: (blockId: string, parentId: string | null) => void;
    transactWithoutCapture: (fn: () => void) => void;
  };
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};
const frame = async (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await drain();
    await frame();
    await nextTask();
  }
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

/** A keystroke the gesture controller sees, then the text it typed, caret at the end. */
const type = (input: HTMLElement, key: string): void => {
  const caret = (): void => {
    const range = document.createRange();
    const text = input.firstChild ?? input;

    range.setStart(text, text.textContent?.length ?? 0);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  };

  caret();
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  input.append(key);
  input.normalize();
  caret();
};

describe('a tool calling the blocks API while a peer change is applied', () => {
  let editor: TestEditor | undefined;
  let holder: HTMLDivElement | undefined;
  let yjs: YjsManager | undefined;
  let peer: DocumentStore | undefined;

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
      tools: { paragraph: Paragraph, table: Table },
      data: {
        blocks: [
          { id: 'para', type: 'paragraph', data: { text: 'start' } },
          { id: 'T', type: 'table', data: { withHeadings: false, content: [['a', 'b']] } },
        ],
      },
    }) as unknown as TestEditor;
    await editor.isReady;
    await settle();
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

  const paragraphInput = (): HTMLElement => {
    const input = holder?.querySelector('[data-blok-id="para"] [contenteditable="true"]');

    if (!(input instanceof HTMLElement)) {
      throw new Error('paragraph not rendered');
    }

    return input;
  };

  const paragraphText = async (): Promise<unknown> =>
    (await editor?.save())?.blocks.find((block) => block.id === 'para')?.data.text;

  it('undoes a typing run in one step', async () => {
    if (editor === undefined) {
      throw new Error('editor not ready');
    }
    const input = paragraphInput();

    type(input, 'x');
    await settle();
    type(input, 'y');
    await settle();

    editor.history.undo();
    await settle();

    expect(await paragraphText()).toBe('start');
  });

  it('keeps the local typing run one undo step when a peer changes a table', async () => {
    if (peer === undefined || editor === undefined) {
      throw new Error('editor not ready');
    }
    const input = paragraphInput();

    type(input, 'x');
    await settle();

    peer.updateBlockData('T', 'withHeadings', true);
    requireYjs().applyRemoteUpdate(peer.encodeStateAsUpdate(requireYjs().getStateVector()));
    await settle();

    type(input, 'y');
    await settle();

    editor.history.undo();
    await settle();

    expect(await paragraphText()).toBe('start');
  });

  it('keeps the local typing run one undo step across an untracked repair', async () => {
    if (editor === undefined) {
      throw new Error('editor not ready');
    }
    const instance = editor;
    const input = paragraphInput();

    type(input, 'x');
    await settle();

    instance.blocks.transactWithoutCapture(() => {
      instance.blocks.setBlockParent('para', null);
    });
    await settle();

    type(input, 'y');
    await settle();

    instance.history.undo();
    await settle();

    expect(await paragraphText()).toBe('start');
  });
});
