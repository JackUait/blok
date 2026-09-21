import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../../../types';

/**
 * Two remote updates for one block landing in the SAME animation frame: the
 * second is dropped and this client's DOM never catches up to the document.
 *
 * Both updates run `handleYjsUpdate` synchronously, and both reach the
 * `await block.setData(data)` in the in-place branch holding the SAME Block
 * instance. The first one's fallback `rematerialize` replaces that instance;
 * the second one then hands `rematerialize` a block the store no longer has,
 * its identity guard returns, and the newer record is applied nowhere.
 *
 * The DOM holds the older text until some LATER remote update for the same
 * block arrives — and while it does, everything that reads the DOM reads the
 * older text. A single local keystroke saves that stale DOM back over the
 * document, destroying the character the peer typed, for everyone.
 *
 * The tool here refuses in-place `setData`, which is what puts the reconciler
 * on the rematerialize branch. That is not a test contrivance: every tool
 * without a `setData` method that is not a contenteditable `text` tool, and
 * every tool whose own `setData` returns false (the list tool does, for a
 * style change), takes it in a real browser — see
 * `DataPersistenceManager.setData`, `src/components/block/data-persistence-manager.ts:127`.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<{ blocks: OutputBlockData[] }>;
}

/**
 * A tool that renders editable text but always refuses an in-place data
 * update, so the reconciler must re-materialise the block.
 */
class RefusingTool {
  private readonly text: string;

  public constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    // setAttribute, not the IDL property: jsdom implements no
    // `contentEditable` reflector, and the block reads the attribute.
    wrapper.setAttribute('contenteditable', 'true');
    wrapper.innerHTML = this.text;

    return wrapper;
  }

  /** Always refuses, the way the list tool does for a style change. */
  public setData(): boolean {
    return false;
  }

  public save(element: HTMLElement): { text: string } {
    return { text: element.innerHTML };
  }
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;
let peer: DocumentStore | undefined;

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const frame = async (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** Past the 400ms mutation batch, with frames on both sides. */
const settle = async (): Promise<void> => {
  await drain();
  await frame();
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await drain();
  await frame();
  await drain();
};

const yjs = (): YjsManager => {
  if (capturedYjs === undefined) {
    throw new Error('YjsManager was not captured');
  }

  return capturedYjs;
};

const otherPeer = (): DocumentStore => {
  if (peer === undefined) {
    throw new Error('peer DocumentStore was not created');
  }

  return peer;
};

const docText = (): unknown =>
  yjs().toJSON().find((block: OutputBlockData) => block.id === 'shared')?.data?.text;

const blockElement = (): HTMLElement | null => {
  const element = holder?.querySelector('[data-blok-id="shared"] [contenteditable]');

  return element instanceof HTMLElement ? element : null;
};

const renderedText = (): string => blockElement()?.innerHTML ?? '';

/** Ship a peer edit over the binary seam, the way a provider does. */
const pushPeerEdit = (text: string): void => {
  otherPeer().updateBlockData('shared', 'text', text);
  yjs().applyRemoteUpdate(otherPeer().encodeStateAsUpdate(yjs().getStateVector()));
};

describe('two remote updates for one block inside a single animation frame', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      capturedYjs = this;

      return originalFromJSON.call(this, blocks);
    });

    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, refusing: RefusingTool },
      data: { blocks: [{ id: 'shared', type: 'refusing', data: { text: 'alpha' } }] },
    }) as unknown as TestEditor;

    await editor.isReady;
    await drain();

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(yjs().encodeStateAsUpdate(peer.getStateVector()));
  });

  afterEach(async () => {
    editor?.destroy();
    await frame();
    await drain();
    peer?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    peer = undefined;
    vi.restoreAllMocks();
  });

  it('does not let a local keystroke write the stale view back over the peer\'s newer character', async () => {
    pushPeerEdit('alpha0');
    pushPeerEdit('alpha01');
    await settle();

    const element = blockElement();

    if (element === null) {
      throw new Error('block not rendered');
    }

    // The user types one character at the end of what they can SEE.
    element.innerHTML = `${element.innerHTML}X`;
    await settle();

    // THE DEFECT: the peer's "1" must still be in the shared document. Losing
    // it here means this client overwrote a peer's character for everyone.
    expect(docText()).toBe('alpha01X');
  });

  it('shows the document\'s text after the burst, not the first update\'s', async () => {
    pushPeerEdit('alpha0');
    pushPeerEdit('alpha01');
    await settle();

    expect(renderedText()).toBe('alpha01');
  });

  it('save() reports the document\'s text after the burst', async () => {
    pushPeerEdit('alpha0');
    pushPeerEdit('alpha01');
    await settle();

    const output = await (editor as TestEditor).save();

    expect(output.blocks[0]?.data.text).toBe('alpha01');
  });

  it('control: the same two updates one frame apart both land', async () => {
    pushPeerEdit('alpha0');
    await settle();
    pushPeerEdit('alpha01');
    await settle();

    expect(renderedText()).toBe('alpha01');
    expect(docText()).toBe('alpha01');
  });
});
