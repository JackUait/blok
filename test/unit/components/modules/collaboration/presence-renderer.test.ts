/**
 * Presence rendering (Phase 3, task C3) — the DOM half.
 *
 * Two things are pinned here. First the child-holder decoration law: presence
 * writes on a block's HOLDER and appends its own label there, never at or below
 * the tool root and never around the holder. Second R5: every field of a peer's
 * state is written by another browser, so the name only ever reaches the DOM
 * as text or as an attribute value and the colour only reaches CSS after
 * passing a strict pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_PEERS,
  PRESENCE_SCAN_LIMIT,
  presenceColorFor,
  type PresenceState,
} from '../../../../../src/components/modules/collaboration/presence';
import {
  createPresenceRenderer,
  type PresenceRenderer,
} from '../../../../../src/components/modules/collaboration/presence-renderer';
import { clean } from '../../../../../src/components/utils/sanitizer';

const PRESENCE_COLOR = '--blok-presence-color';
const INITIALS_ATTR = 'data-blok-presence-initials';

interface Harness {
  host: HTMLElement;
  renderer: PresenceRenderer;
  holderOf: (blockId: string) => HTMLElement;
  toolRootOf: (blockId: string) => HTMLElement;
  hidden: { value: boolean };
}

const harnesses: Array<{ host: HTMLElement; renderer: PresenceRenderer }> = [];

/**
 * A block's real DOM nesting: holder → content wrapper → tool root. The tool
 * root is what the decoration law forbids writing to.
 * @param blockId - the block this DOM belongs to
 */
const makeHolder = (blockId: string): HTMLElement => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const toolRoot = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-id', blockId);
  content.setAttribute('data-blok-element-content', '');
  toolRoot.setAttribute('data-blok-tool', 'paragraph');
  // The ATTRIBUTE, not the property: jsdom does not reflect `contentEditable`.
  toolRoot.setAttribute('contenteditable', 'true');
  toolRoot.textContent = 'hello';

  content.appendChild(toolRoot);
  holder.appendChild(content);

  return holder;
};

const setup = (options: { maxAvatars?: number; blockIds?: string[] } = {}): Harness => {
  const host = document.createElement('div');
  const redactor = document.createElement('div');
  const holders = new Map<string, HTMLElement>();
  const hidden = { value: false };

  document.body.appendChild(host);
  host.appendChild(redactor);

  (options.blockIds ?? ['block-1', 'block-2', 'block-3']).forEach((blockId) => {
    const holder = makeHolder(blockId);

    holders.set(blockId, holder);
    redactor.appendChild(holder);
  });

  const renderer = createPresenceRenderer({
    host,
    resolveHolder: (blockId) => holders.get(blockId) ?? null,
    resolveInputs: (blockId) => {
      const toolRoot = holders.get(blockId)?.querySelector<HTMLElement>('[contenteditable="true"]');

      return toolRoot === null || toolRoot === undefined ? [] : [toolRoot];
    },
    isHidden: () => hidden.value,
    maxAvatars: options.maxAvatars,
  });

  harnesses.push({ host, renderer });

  const require_ = (blockId: string): HTMLElement => {
    const holder = holders.get(blockId);

    if (holder === undefined) {
      throw new Error(`no holder for ${blockId}`);
    }

    return holder;
  };

  return {
    host,
    renderer,
    hidden,
    holderOf: require_,
    toolRootOf: (blockId) => {
      const toolRoot = require_(blockId).querySelector<HTMLElement>('[data-blok-tool]');

      if (toolRoot === null) {
        throw new Error(`no tool root for ${blockId}`);
      }

      return toolRoot;
    },
  };
};

const peer = (
  clientId: number,
  state: Record<string, unknown>
): PresenceState => ({ clientId, state });

const caretAt = (blockId: string | null): Record<string, unknown> | null =>
  blockId === null ? null : { blockId, inputIndex: 0, anchor: 1, head: 1 };

const named = (clientId: number, name: string, blockId: string | null, color?: string): PresenceState =>
  peer(clientId, {
    user: color === undefined ? { name } : { name, color },
    blockId,
    caret: caretAt(blockId),
  });

const stack = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('[data-blok-presence-stack]');

const avatars = (host: HTMLElement): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-blok-presence-avatar]'));

const caret = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>('[data-blok-presence-caret]');

const face = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>('[data-blok-presence-face]');

describe('presence renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    harnesses.splice(0).forEach(({ host, renderer }) => {
      renderer.clear();
      host.remove();
    });
    vi.restoreAllMocks();
  });

  describe('a remote peer', () => {
    it('gets an avatar in the stack and a coloured caret where they are working', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace Hopper', 'block-2', '#0b6e99')], 42);

      const holder = harness.holderOf('block-2');

      // Notion's shape: the caret IS the presence. No block outline — that says
      // only "somebody is in this paragraph", where a caret says where.
      expect(caret(holder)).not.toBeNull();
      expect(caret(holder)?.style.getPropertyValue(PRESENCE_COLOR)).toBe('#0b6e99');
      // Identity rides the gutter face, not the caret: monogram on it, full
      // name in its title.
      expect(face(holder)?.getAttribute(INITIALS_ATTR)).toBe('GH');
      expect(face(holder)?.getAttribute('title')).toBe('Grace Hopper');
      expect(avatars(harness.host)).toHaveLength(1);
      expect(avatars(harness.host)[0].getAttribute('title')).toBe('Grace Hopper');
    });

    it('is drawn on the holder only — never at or below the tool root', () => {
      const harness = setup();
      const toolRoot = harness.toolRootOf('block-2');
      const before = toolRoot.outerHTML;

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      const holder = harness.holderOf('block-2');

      expect(toolRoot.outerHTML).toBe(before);
      expect(caret(holder)?.parentElement).toBe(holder);
      expect(holder.parentElement?.hasAttribute('data-blok-presence-caret')).toBe(false);
    });

    /**
     * Block-select → copy sanitizes `holder.innerHTML` (blockSelection.ts) with
     * a tag whitelist that unwraps the gutter strip and keeps whatever TEXT it
     * held. Presence chrome inside a holder must therefore carry no text nodes
     * at all — a monogram or a `+N` in one pastes into the next document.
     */
    it('adds no text to a copied block, however many peers sit on it', () => {
      const harness = setup();
      const crowd = Array.from({ length: 5 }, (_unused, index) =>
        named(100 + index, 'Grace Hopper', 'block-2'));

      harness.renderer.render(crowd, 42);

      const holder = harness.holderOf('block-2');
      const copied = document.createElement('div');

      copied.innerHTML = clean(holder.innerHTML, { p: {}, b: {}, i: {}, a: { href: true } });

      expect(holder.querySelectorAll('[data-blok-presence-face]').length).toBeGreaterThan(0);
      expect(copied.textContent).toBe('hello');
      expect(holder.textContent).toBe('hello');
    });

    it('marks the label inert so it never joins the caret or a copied selection', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      const element = caret(harness.holderOf('block-2'));

      expect(element?.getAttribute('contenteditable')).toBe('false');
      expect(element?.getAttribute('aria-hidden')).toBe('true');
    });

    it('is drawn anonymously when they published no display name', () => {
      const harness = setup();

      // `collaboration.user` is optional, so a nameless peer is the DEFAULT
      // configuration, not a broken one. They get a caret and an avatar in their
      // assigned colour; only the name flag has nothing to say.
      harness.renderer.render([peer(98, { user: {}, blockId: 'block-3', caret: caretAt('block-3') })], 42);

      const holder = harness.holderOf('block-3');

      expect(caret(holder)).not.toBeNull();
      expect(caret(holder)?.style.getPropertyValue(PRESENCE_COLOR)).toBe(presenceColorFor(98));
      expect(avatars(harness.host)).toHaveLength(1);
      expect(avatars(harness.host)[0].style.getPropertyValue(PRESENCE_COLOR)).toBe(presenceColorFor(98));
      // A face in their colour, with no monogram and no title claiming a name.
      expect(face(holder)).not.toBeNull();
      expect(face(holder)?.hasAttribute(INITIALS_ATTR)).toBe(false);
      expect(face(holder)?.hasAttribute('title')).toBe(false);
    });

    it('is not drawn by a state that carries no identity at all', () => {
      const harness = setup();

      harness.renderer.render([peer(99, { blockId: 'block-2', caret: caretAt('block-2') })], 42);

      expect(caret(harness.holderOf('block-2'))).toBeNull();
      expect(avatars(harness.host)).toHaveLength(0);
    });
  });

  /**
   * A caret is published only from a measurable input. On an image, an embed,
   * a divider or a table cell's native field the publisher sends `caret: null`
   * with `blockId` still naming the block — and a client from before carets
   * shipped sends no caret field at all. Both are ABSENT, not malformed, and
   * block-level presence is the decision for every block.
   */
  describe('a peer on a block with no measurable caret', () => {
    it.each([
      ['a null caret', { user: { name: 'Grace' }, blockId: 'block-2', caret: null }],
      ['no caret field at all', { user: { name: 'Grace' }, blockId: 'block-2' }],
    ])('still gets a face on their block with %s', (_label, state) => {
      const harness = setup();

      harness.renderer.render([peer(99, state)], 42);

      const holder = harness.holderOf('block-2');

      expect(face(holder)?.getAttribute('title')).toBe('Grace');
      expect(caret(holder)).toBeNull();
      expect(avatars(harness.host)).toHaveLength(1);
    });

    it('gets no face when the caret is present but malformed', () => {
      const harness = setup();

      // Rejected whole: a face parked from the sibling field would sit beside
      // a block whose caret this client refused to draw.
      harness.renderer.render([
        peer(99, { user: { name: 'Grace' }, blockId: 'block-2', caret: { nope: true } }),
      ], 42);

      expect(face(harness.holderOf('block-2'))).toBeNull();
      expect(caret(harness.holderOf('block-2'))).toBeNull();
    });
  });

  describe('the local user', () => {
    it('is never drawn on their own block', () => {
      const harness = setup();

      harness.renderer.render(
        [named(42, 'Me', 'block-1'), named(99, 'Grace', 'block-2')],
        42
      );

      expect(caret(harness.holderOf('block-1'))).toBeNull();
      expect(caret(harness.holderOf('block-2'))).not.toBeNull();
      expect(avatars(harness.host)).toHaveLength(1);
    });
  });

  describe('hostile remote fields', () => {
    it('writes a name as text, never as markup', () => {
      const harness = setup();
      const hostile = '<img src=x onerror=alert(1)>';

      harness.renderer.render([named(99, hostile, 'block-2')], 42);

      const element = face(harness.holderOf('block-2'));

      expect(element?.getAttribute('title')).toBe(hostile);
      expect(element?.children).toHaveLength(0);
      expect(avatars(harness.host)[0].children).toHaveLength(0);
    });

    it('survives a state that is not an object at all', () => {
      const harness = setup();

      expect(() => harness.renderer.render([
        peer(1, null as never),
        peer(2, 0 as never),
        peer(3, 'string' as never),
        peer(4, [] as never),
        named(99, 'Grace', 'block-2'),
      ], 42)).not.toThrow();

      expect(avatars(harness.host)).toHaveLength(1);
    });

    it('caps a very long name instead of letting it paint the page', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'x'.repeat(5000), 'block-2')], 42);

      const element = face(harness.holderOf('block-2'));

      // The cap has to hold on the TITLE too: a hostile name is safe as an
      // attribute value, but a megabyte of it is still a megabyte.
      expect((element?.getAttribute('title') ?? '').length).toBeLessThanOrEqual(64);
      expect((element?.getAttribute(INITIALS_ATTR) ?? '').length).toBeLessThanOrEqual(2);
    });

    it.each([
      'red; background: url(javascript:alert(1))',
      '#fff);--blok-presence-color:url(x',
      'url(https://evil.test/pixel.png)',
      '#12345',
      'javascript:alert(1)',
    ])('refuses the colour %s and falls back to the palette', (color) => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2', color)], 42);

      const element = caret(harness.holderOf('block-2'));

      expect(element?.style.getPropertyValue(PRESENCE_COLOR)).toBe(presenceColorFor(99));
      expect(element?.getAttribute('style') ?? '').not.toContain('url(');
      expect(element?.getAttribute('style') ?? '').not.toContain('javascript');
    });

    it('tolerates a block id that names nothing', () => {
      const harness = setup();

      expect(() => harness.renderer.render([
        named(99, 'Grace', 'no-such-block'),
        named(98, 'Ada', null),
        peer(97, { user: { name: 'Alan' }, blockId: { nope: true } }),
      ], 42)).not.toThrow();

      expect(avatars(harness.host)).toHaveLength(3);
      expect(harness.host.querySelectorAll('[data-blok-presence-caret]')).toHaveLength(0);
    });

    it('caps how many avatars it draws and counts the rest', () => {
      const harness = setup({ maxAvatars: 3 });
      const crowd = Array.from({ length: 9 }, (_unused, index) =>
        named(100 + index, `Peer ${index}`, null));

      harness.renderer.render(crowd, 42);

      expect(avatars(harness.host)).toHaveLength(3);
      expect(stack(harness.host)?.querySelector('[data-blok-presence-overflow]')?.textContent).toBe('+6');
    });
  });

  /**
   * The peer cap protects the DOM from one client that fabricates ids. It must
   * not become the weapon: awareness map order is insertion order, so anything
   * that counts junk toward the cap lets a single peer plant enough of it to
   * blank the presence UI for the whole room.
   */
  describe('the peer cap counts only drawable peers', () => {
    it('draws the real peer behind a wall of identity-less states', () => {
      const harness = setup({ blockIds: ['block-1', 'real'] });
      const junk = Array.from({ length: 60 }, (_unused, index) => peer(1000 + index, {}));

      harness.renderer.render([...junk, named(9999, 'Real Person', 'real')], 42);

      expect(avatars(harness.host)).toHaveLength(1);
      expect(avatars(harness.host)[0].getAttribute('title')).toBe('Real Person');
      expect(caret(harness.holderOf('real'))).not.toBeNull();
    });

    it('draws the real peer behind a wall of local-client duplicates', () => {
      const harness = setup({ blockIds: ['block-1', 'real'] });
      const junk = Array.from({ length: 60 }, () => named(42, 'Me', 'block-1'));

      harness.renderer.render([...junk, named(9999, 'Real Person', 'real')], 42);

      expect(avatars(harness.host)).toHaveLength(1);
      expect(caret(harness.holderOf('block-1'))).toBeNull();
    });

    it('counts junk in neither the avatars nor the +N', () => {
      const harness = setup({ maxAvatars: 3 });
      // Junk is a state with NO identity at all. A `user` object without a name
      // is a real (anonymous) peer since `collaboration.user` became optional,
      // so it is no longer what this cap is defending against.
      const junk = Array.from({ length: 40 }, (_unused, index) => peer(2000 + index, { blockId: null }));
      const crowd = Array.from({ length: 9 }, (_unused, index) =>
        named(100 + index, `Peer ${index}`, null));

      harness.renderer.render([...junk, ...crowd], 42);

      expect(avatars(harness.host)).toHaveLength(3);
      expect(stack(harness.host)?.querySelector('[data-blok-presence-overflow]')?.textContent).toBe('+6');
    });

    it('never draws more than the peer cap, however large the room', () => {
      const harness = setup({ maxAvatars: 4 });
      const crowd = Array.from({ length: 400 }, (_unused, index) =>
        named(100 + index, `Peer ${index}`, null));

      harness.renderer.render(crowd, 42);

      expect(avatars(harness.host)).toHaveLength(4);
      expect(stack(harness.host)?.querySelector('[data-blok-presence-overflow]')?.textContent)
        .toBe(`+${MAX_PEERS - 4}`);
    });

    /**
     * The bound the DoS cap buys, stated as behaviour: past the scan limit the
     * pass stops looking, so junk planted that deep DOES hide a peer behind it.
     * Keeping the map that small is the wire's job (the provider's frame and
     * rebroadcast caps), not the renderer's.
     */
    it('stops looking after the scan limit', () => {
      const harness = setup({ blockIds: ['block-1', 'real'] });
      const junk = Array.from({ length: PRESENCE_SCAN_LIMIT }, (_unused, index) => peer(1000 + index, {}));

      harness.renderer.render([...junk, named(9999, 'Real Person', 'real')], 42);

      expect(avatars(harness.host)).toHaveLength(0);
    });
  });

  describe('hidden controls', () => {
    it('draws nothing while the editor is chromeless, and cleans up what it drew', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.hidden.value = true;
      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(stack(harness.host)).toBeNull();
      expect(caret(harness.holderOf('block-2'))).toBeNull();
    });
  });

  describe('reflow', () => {
    it('re-measures the carets when the editor resizes', () => {
      const observers: ResizeObserverCallback[] = [];
      const original = window.ResizeObserver;

      window.ResizeObserver = class MockResizeObserver {
        public constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }

        public observe = vi.fn();

        public unobserve = vi.fn();

        public disconnect = vi.fn();
      };

      try {
        const harness = setup();
        const rect = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
          left: 10, top: 0, height: 18, right: 10, bottom: 18, width: 0, x: 10, y: 0,
          toJSON: () => ({}),
        });

        harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

        expect(caret(harness.holderOf('block-2'))?.style.left).toBe('10px');

        rect.mockReturnValue({
          left: 90, top: 0, height: 18, right: 90, bottom: 18, width: 0, x: 90, y: 0,
          toJSON: () => ({}),
        });
        // A window resize reflows the text under every remote caret, and no
        // awareness traffic announces it — without this the carets sit at their
        // old coordinates until somebody happens to move.
        observers.forEach((callback) => callback([], {} as unknown as ResizeObserver));

        expect(caret(harness.holderOf('block-2'))?.style.left).toBe('90px');
      } finally {
        window.ResizeObserver = original;
      }
    });
  });

  describe('cleanup', () => {
    it('leaves the holder exactly as it found it when a peer leaves', () => {
      const harness = setup();
      const holder = harness.holderOf('block-2');
      const before = holder.outerHTML;

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([], 42);

      expect(caret(holder)).toBeNull();
      expect(holder.outerHTML).toBe(before);
    });

    it('moves the caret when a peer moves to another block', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([named(99, 'Grace', 'block-3')], 42);

      expect(caret(harness.holderOf('block-2'))).toBeNull();
      expect(face(harness.holderOf('block-2'))).toBeNull();
      expect(caret(harness.holderOf('block-3'))).not.toBeNull();
      expect(face(harness.holderOf('block-3'))?.getAttribute('title')).toBe('Grace');
    });

    it('keeps one caret per block when a peer stays put', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(harness.holderOf('block-2').querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    });

    it('clear() takes the stack and every caret with it', () => {
      const harness = setup();
      const holder = harness.holderOf('block-2');
      const before = holder.outerHTML;

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.clear();

      expect(stack(harness.host)).toBeNull();
      expect(holder.outerHTML).toBe(before);
    });
  });
});
