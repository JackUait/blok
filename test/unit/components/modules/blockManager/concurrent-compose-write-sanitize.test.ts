import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { hasUnsafeScheme } from '../../../../../src/components/utils/sanitize-url';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * What `BlockMutation.composeWrite` overlays into a Tool's render.
 *
 * `composeWrite` refreshes the keys a caller did not name straight from the
 * shared document, which is the one place in the editor that any peer can
 * write. Two properties of that overlay are pinned here:
 *
 *   - it LAUNDERS what it reads. Every other document->DOM path runs the
 *     tool's sanitize config plus the URL-scheme pass (`yjs-sync.ts`
 *     `sanitizeToolData`, `renderer.ts` `sanitizeToolData`); an unsanitized
 *     overlay renders a peer's `<img onerror>` into this client's page.
 *   - it honours a DELETION. A key the peer removed is absent from the
 *     post-await read, so an overlay alone writes the pre-await snapshot's
 *     copy back and resurrects it.
 *
 * Both are driven through a real editor and a real second `DocumentStore`
 * peer over the binary seam, with the peer's write landing INSIDE the window
 * `update()` holds open — a peer write that lands before the call starts is
 * already in the snapshot and proves nothing.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: {
    update: (id: string, data?: Record<string, unknown>) => Promise<{ id: string }>;
    convert: (id: string, type: string) => Promise<{ id: string }>;
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
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

const requireHolder = (): HTMLDivElement => {
  if (holder === undefined) {
    throw new Error('no holder');
  }

  return holder;
};

/** Deliver the peer's pending updates without waiting for the reconcile. */
const deliverPeerUpdate = (): void => {
  const a = requireLocal();

  a.applyRemoteUpdate(requirePeer().encodeStateAsUpdate(a.getStateVector()));
};

const docOf = (side: 'local' | 'peer'): OutputBlockData[] =>
  side === 'local' ? requireLocal().toJSON() : requirePeer().toJSON();

const dataOf = (side: 'local' | 'peer', id: string): Record<string, unknown> =>
  docOf(side).find((block) => block.id === id)?.data ?? {};

/** The peer's own data map for a block, as it holds it. */
const peerData = (id: string): Y.Map<unknown> => {
  const data = requirePeer().blocksMap.get(id)?.get('data');

  if (!(data instanceof Y.Map)) {
    throw new Error(`the peer holds no data map for «${id}»`);
  }

  return data;
};

/**
 * The peer types `insert` at offset `at` inside its own copy of the block.
 * On a formatted text (format 2) this is just characters, never markup.
 */
const peerTypes = (id: string, at: number, insert: string): void => {
  const text = peerData(id).get('text');

  if (!(text instanceof Y.Text)) {
    throw new Error(`the peer's «${id}».text is not mergeable`);
  }

  text.insert(at, insert, {});
};

/** The peer's formatted text (format 2) for a block. */
const peerRichText = (id: string): Y.XmlText => {
  const text = peerData(id).get('text');

  if (!(text instanceof Y.XmlText)) {
    throw new Error(`the peer's «${id}».text is not formatted`);
  }

  return text;
};

/** Format 2: a raw HTML embed, the way a hostile peer writes it. */
const peerInsertsHtmlEmbed = (id: string, at: number, html: string): void => {
  peerRichText(id).insertEmbed(at, { html }, {});
};

/** Format 2: a link mark over existing characters. */
const peerLinks = (id: string, at: number, length: number, href: string): void => {
  peerRichText(id).format(at, length, { link: { href } });
};

/**
 * Format 1: the field is an unformatted Y.Text holding HTML, as in a room an
 * old client or server seeded. The peer types HTML into it.
 */
const peerTypesFormat1Html = (id: string, at: number, html: string): void => {
  const data = peerData(id);
  const current = data.get('text');
  const plain = current instanceof Y.Text && !(current instanceof Y.XmlText) ? current : null;

  if (plain === null) {
    throw new Error(`the peer's «${id}».text is not a format-1 Y.Text`);
  }

  plain.insert(at, html);
};

const settle = async (call: Promise<unknown>): Promise<'landed' | 'refused'> =>
  call.then(() => 'landed' as const, () => 'refused' as const);

const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
const LINK_PAYLOAD = '<a href="javascript:alert(1)">click</a>';

describe('composeWrite overlaying the shared document into a Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);

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
    await frame();
    holder?.remove();
    peer?.destroy();
    editor = undefined;
    holder = undefined;
    local = undefined;
    peer = undefined;
    vi.restoreAllMocks();
  });

  const boot = async (data: OutputData): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph,
        header: Header },
      data,
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireLocal().encodeStateAsUpdate(peer.getStateVector()));

    return instance;
  };

  const header = (): OutputData => ({
    blocks: [{ id: 'h', type: 'header', data: { text: 'title', level: 2 } }],
  });

  const coloredHeader = (): OutputData => ({
    blocks: [{ id: 'h', type: 'header', data: { text: 'title', level: 2, textColor: 'red' } }],
  });

  describe('a peer\'s markup that this client\'s sanitizer rejects', () => {
    it('does not render the peer\'s <img> when an update races the write', async () => {
      const instance = await boot(header());

      // The peer's payload must land INSIDE the window: `update()` snapshots
      // the document synchronously, so anything already there is not drift.
      const pending = instance.blocks.update('h', { level: 3 });

      peerTypes('h', 5, IMG_PAYLOAD);
      deliverPeerUpdate();

      await pending;
      await frame();

      // The defect assertion first: the overlay must not render peer markup.
      expect(requireHolder().querySelectorAll('img')).toHaveLength(0);
      expect(dataOf('local', 'h').level).toBe(3);
    });

    it('control: the same payload with no racing update renders nothing either', async () => {
      await boot(header());

      peerTypes('h', 5, IMG_PAYLOAD);
      deliverPeerUpdate();
      await frame();

      expect(requireHolder().querySelectorAll('img')).toHaveLength(0);
    });

    it('does not render a javascript: href when an update races the write', async () => {
      const instance = await boot(header());

      const pending = instance.blocks.update('h', { level: 3 });

      peerTypes('h', 5, LINK_PAYLOAD);
      deliverPeerUpdate();

      await pending;
      await frame();

      const hrefs = Array.from(requireHolder().querySelectorAll('a'))
        .map((anchor) => anchor.getAttribute('href'));

      // The defect assertion first.
      expect(hrefs.filter((href) => href !== null && hasUnsafeScheme(href))).toHaveLength(0);
    });
  });

  describe('format 2: a peer writing marks and embeds the sanitizer must reject', () => {
    const unsafeHrefs = (): string[] => Array.from(requireHolder().querySelectorAll('a'))
      .map((anchor) => anchor.getAttribute('href'))
      .filter((href): href is string => href !== null && hasUnsafeScheme(href));

    const savedText = async (): Promise<string> => {
      const saved = await (editor as unknown as { save: () => Promise<OutputData> }).save();

      return JSON.stringify(saved.blocks.find((block) => block.id === 'h')?.data ?? {});
    };

    it('does not render an <img onerror> html embed when an update races the write', async () => {
      const instance = await boot(header());
      const pending = instance.blocks.update('h', { level: 3 });

      peerInsertsHtmlEmbed('h', 2, IMG_PAYLOAD);
      deliverPeerUpdate();

      await pending;
      await frame();

      expect(requireHolder().querySelectorAll('img[onerror], [onerror]')).toHaveLength(0);
      expect(await savedText()).not.toContain('onerror');
      // Not vacuous: the document's reader hands the payload on as HTML.
      expect(dataOf('peer', 'h').text).toContain('onerror');
      expect(dataOf('local', 'h').level).toBe(3);
    });

    it('does not render an <img onerror> html embed with no racing update', async () => {
      await boot(header());

      peerInsertsHtmlEmbed('h', 2, IMG_PAYLOAD);
      deliverPeerUpdate();
      await frame();

      expect(requireHolder().querySelectorAll('img[onerror], [onerror]')).toHaveLength(0);
      expect(await savedText()).not.toContain('onerror');
      // Not vacuous: the document's reader hands the payload on as HTML.
      expect(dataOf('peer', 'h').text).toContain('onerror');
    });

    it('does not render a javascript: link mark when an update races the write', async () => {
      const instance = await boot(header());
      const pending = instance.blocks.update('h', { level: 3 });

      peerLinks('h', 0, 5, 'javascript:alert(1)');
      deliverPeerUpdate();

      await pending;
      await frame();

      expect(unsafeHrefs()).toHaveLength(0);
      expect(await savedText()).not.toContain('javascript:');
      // Not vacuous: the peer's own reader renders the mark as a javascript: href.
      expect(dataOf('peer', 'h').text).toContain('href="javascript:alert(1)"');
    });

    it('does not render a javascript: link mark with no racing update', async () => {
      await boot(header());

      peerLinks('h', 0, 5, 'javascript:alert(1)');
      deliverPeerUpdate();
      await frame();

      expect(unsafeHrefs()).toHaveLength(0);
      expect(await savedText()).not.toContain('javascript:');
      // Not vacuous: the peer's own reader renders the mark as a javascript: href.
      expect(dataOf('peer', 'h').text).toContain('href="javascript:alert(1)"');
    });

    it('format 1: HTML typed into an unformatted Y.Text renders no <img> and no javascript: href', async () => {
      await boot(header());

      // Turn the field into a format-1 HTML Y.Text on both sides first.
      peerData('h').set('text', new Y.Text('title'));
      deliverPeerUpdate();
      await frame();

      peerTypesFormat1Html('h', 5, `${IMG_PAYLOAD}${LINK_PAYLOAD}`);
      deliverPeerUpdate();
      await frame();

      expect(requireHolder().querySelectorAll('img')).toHaveLength(0);
      expect(unsafeHrefs()).toHaveLength(0);
      expect(await savedText()).not.toContain('onerror');
      expect(await savedText()).not.toContain('javascript:');
      expect(dataOf('peer', 'h').text).toContain('onerror');
    });
  });

  describe('a key the peer DELETED', () => {
    it('is not resurrected by an update that does not name it', async () => {
      const instance = await boot(coloredHeader());

      const pending = instance.blocks.update('h', { text: 'retitled' });

      peerData('h').delete('textColor');
      deliverPeerUpdate();

      await pending;
      await frame();

      // The defect assertion first: the overlay wrote the pre-await snapshot's
      // `textColor` back over the peer's removal.
      expect(dataOf('local', 'h')).not.toHaveProperty('textColor');
      expect(dataOf('local', 'h').text).toBe('retitled');
    });

    it('control: a key the caller DOES name survives the peer\'s removal', async () => {
      const instance = await boot(coloredHeader());

      const pending = instance.blocks.update('h', { textColor: 'blue' });

      peerData('h').delete('textColor');
      deliverPeerUpdate();

      await pending;
      await frame();

      expect(dataOf('local', 'h').textColor).toBe('blue');
    });
  });

  describe('convert against a document whose spelling differs from the DOM', () => {
    /**
     * The document and the DOM legitimately disagree on how the same
     * characters are spelled (`a & b` <-> `a &amp; b`) — for every block a
     * host or a server seeded. Refusing a convert over a spelling difference
     * refuses it on every collaborative document; only a difference in the
     * CHARACTERS means the read is behind the peer.
     */
    it('converts, keeping the peer\'s text and the peer\'s other key', async () => {
      const instance = await boot({
        blocks: [{ id: 'one', type: 'paragraph', data: { text: 'alpha' } }],
      });

      // A raw `&` in the document; the DOM renders it back as `&amp;`.
      peerTypes('one', 5, ' & x');
      deliverPeerUpdate();
      await frame();

      const pending = settle(instance.blocks.convert('one', 'header'));

      // A peer write inside the window, on a key the read does not carry.
      peerData('one').set('textColor', 'red');
      deliverPeerUpdate();

      const outcome = await pending;

      await frame();

      // The defect assertion first: the spelling difference alone must not
      // refuse the conversion.
      expect(outcome).toBe('landed');
      expect(docOf('local').find((block) => block.id === 'one')?.type).toBe('header');
      expect(dataOf('local', 'one').text).toBe('alpha &amp; x');
      expect(dataOf('local', 'one').textColor).toBe('red');
    });
  });
});
