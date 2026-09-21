import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { BlockYjsSync } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../../../types';

/**
 * A peer's markup that the RECEIVING client's sanitizer strips is written BACK
 * into the shared document, destroying the peer's original for everyone.
 *
 * The path, all of it executed here:
 *   1. Peer B writes `E = mc<sup>2</sup>` into the doc. (B's build allows
 *      `sup`; this client's does not — the version skew two tabs on different
 *      bundles, or two clients with different inline tools, produce every day.)
 *   2. This client sanitizes on the way IN — `handleYjsUpdate`
 *      (`yjs-sync.ts:906`) → `sanitizeToolData` (`yjs-sync.ts:1781`).
 *      Paragraph's `text` config has no `sup`, so HTMLJanitor unwraps it.
 *   3. `handleYjsUpdate` calls `markRewrittenFromDocument` (`yjs-sync.ts:1026`)
 *      and applies the STRIPPED string through `setData`.
 *   4. The MutationObserver sees the rewrite. `blockDidMutated`
 *      (`blockManager.ts:1863`) finds the reconcile window open and defers the
 *      write-back via `noteSuppressedMutation` (`yjs-sync.ts:239`), which files
 *      it under `deferredMutations` precisely BECAUSE step 3 armed a baseline.
 *   5. The window closes, `drainSuppressedMutations` (`yjs-sync.ts:344`) replays
 *      it as `resyncBlockData(block, { untracked: true })` — and the stripped
 *      string lands in the Y.Doc.
 *
 * Step 5's comment expects the replay to "diff to nothing" for an echo. A
 * sanitize is not an echo: the DOM deliberately differs from the document, so
 * the diff is real and the peer's content is overwritten. Untracked means it is
 * not even an undo step — nobody can get it back.
 *
 * Everything is real: a real `Blok` with the real `Paragraph` tool (so `setData`
 * really renders and `save()` really reads the DOM back), a real second
 * `DocumentStore` peer joined over the binary update seam, and a real mutation
 * flush. Every assertion reads the Y.Doc via `toJSON()` — never the in-memory
 * block store, which shows this client's sanitized view either way.
 */

const SUP_MARKUP = 'E = mc<sup>2</sup>';
const SUP_STRIPPED = 'E = mc2';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;
let peer: DocumentStore | undefined;
let noteSuppressedSpy: ReturnType<typeof vi.spyOn>;

/**
 * jsdom implements no `contentEditable` IDL attribute, so `div.contentEditable
 * = 'true'` (`Paragraph.drawView`, `src/tools/paragraph/index.ts:282`) sets
 * nothing a browser would see. Without this reflection
 * `DataPersistenceManager.setData` reads `contenteditable !== 'true'`
 * (`src/components/block/data-persistence-manager.ts:144`), returns false, and
 * the reconciler falls back to `rematerialize` — which replaces the whole
 * holder and produces no mutation INSIDE any block's tool element, so no
 * write-back is ever recorded. That is a jsdom artifact, not Blok behaviour:
 * every real browser takes the in-place branch. Restoring the reflection is
 * what puts this test on the path users are actually on.
 */
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

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const frame = async (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/**
 * Past the 400ms mutation batch (`modificationsObserverBatchTimeout`) that
 * bounds the write-coalescing buffer, with frames on both sides so every
 * RAF-extended atomic window closes and its drain runs.
 */
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

const docText = (id: string): unknown =>
  yjs().toJSON().find((block: OutputBlockData) => block.id === id)?.data?.text;

const renderedText = (): string =>
  holder?.querySelector('[data-blok-tool="paragraph"]')?.innerHTML ?? '';

describe('a peer edit this client sanitizes — the stripped value is written back to the shared doc', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    installContentEditableReflection();
    noteSuppressedSpy = vi.spyOn(BlockYjsSync.prototype, 'noteSuppressedMutation');

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
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'shared', type: 'paragraph', data: { text: 'before' } }] },
    });

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

  /** Ship the peer's edit over the binary seam, the way a provider does. */
  const pushPeerEdit = (text: string): void => {
    otherPeer().updateBlockData('shared', 'text', text);
    yjs().applyRemoteUpdate(otherPeer().encodeStateAsUpdate(yjs().getStateVector()));
  };

  it('keeps the peer\'s <sup> in the document after this client sanitizes it away', async () => {
    pushPeerEdit(SUP_MARKUP);
    await settle();

    // THE DEFECT: the document must still hold what the peer typed. A stripped
    // value here means this client overwrote the peer's content for EVERYONE —
    // on their screens, on the server, and on every future reload.
    expect(docText('shared')).toBe(SUP_MARKUP);
  });

  it('control: the peer edit really reaches this client and really is sanitized on the way in', async () => {
    pushPeerEdit(SUP_MARKUP);
    await settle();

    expect(renderedText()).toBe(SUP_STRIPPED);
  });

  it('control: a peer edit the sanitizer leaves alone survives in the document', async () => {
    pushPeerEdit('plain peer text');
    await settle();

    expect(docText('shared')).toBe('plain peer text');
  });

  it('control: a local DOM edit reaches the document, so the write-back pipeline is live', async () => {
    const paragraph = holder?.querySelector('[data-blok-tool="paragraph"]');

    if (!(paragraph instanceof HTMLElement)) {
      throw new Error('paragraph element not rendered');
    }

    paragraph.innerHTML = 'locally typed';
    await settle();

    expect(docText('shared')).toBe('locally typed');
  });

  it('mechanism: the sanitized rewrite is deferred as a suppressed mutation and replayed', async () => {
    pushPeerEdit(SUP_MARKUP);
    await settle();

    // `markRewrittenFromDocument` armed the baseline, so the deferred record is
    // replayed untracked — which is how the stripped string reaches the doc.
    expect(noteSuppressedSpy).toHaveBeenCalled();
  });
});
