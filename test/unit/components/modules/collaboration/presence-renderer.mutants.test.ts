/**
 * Mutation-kill tests for presence-renderer.ts.
 *
 * Three regions, each pinned through the public `PresenceRenderer` API:
 * - the untrusted `blockId` a peer publishes with no caret (rejected whole);
 * - the name cap and the anonymous-silhouette pool (who is counted as nameless);
 * - the reflow watch and `reposition()`'s chromeless gate.
 *
 * Every DOM fixture carries DISTINCT text, because identical markup compares
 * structurally equal and hides a mutant that drew on the wrong node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ANONYMOUS_LABEL_KEYS,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';
import {
  createPresenceRenderer,
  type PresenceRenderer,
  type PresenceRendererOptions,
} from '../../../../../src/components/modules/collaboration/presence-renderer';
import type { PresenceState } from '../../../../../src/components/modules/collaboration/presence';

const FACE_ATTR = 'data-blok-presence-face';
const CARET_ATTR = 'data-blok-presence-caret';
const GLYPH_ATTR = 'data-blok-presence-glyph';
const INITIALS_ATTR = 'data-blok-presence-initials';

interface Harness {
  host: HTMLElement;
  renderer: PresenceRenderer;
  hidden: { value: boolean };
  holderOf: (blockId: string) => HTMLElement;
}

interface SetupOptions {
  blockIds?: string[];
  translate?: (key: string) => string;
  isLocalAnonymous?: () => boolean;
  /** Leave `isHidden` out of the options entirely. */
  omitIsHidden?: boolean;
  /** Holders reachable only by IDENTITY, for an id that is not a string. */
  extraHolders?: Array<{ key: unknown; holder: HTMLElement }>;
}

const harnesses: Array<{ host: HTMLElement; renderer: PresenceRenderer }> = [];

/**
 * A block's real DOM nesting: holder → content wrapper → tool root. Each
 * holder's tool root carries the block id, so two fixtures are never equal.
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
  toolRoot.setAttribute('contenteditable', 'true');
  toolRoot.textContent = `text of ${blockId}`;

  content.appendChild(toolRoot);
  holder.appendChild(content);

  return holder;
};

const setup = (options: SetupOptions = {}): Harness => {
  const host = document.createElement('div');
  const redactor = document.createElement('div');
  const holders = new Map<string, HTMLElement>();
  const hidden = { value: false };
  const extraHolders = options.extraHolders ?? [];

  document.body.appendChild(host);
  host.appendChild(redactor);

  (options.blockIds ?? ['block-1', 'block-2', 'block-3']).forEach((blockId) => {
    const holder = makeHolder(blockId);

    holders.set(blockId, holder);
    redactor.appendChild(holder);
  });

  extraHolders.forEach(({ holder }) => redactor.appendChild(holder));

  const rendererOptions: PresenceRendererOptions = {
    host,
    // Identity first: a holder registered for a non-string id is reachable ONLY
    // by that id, so a pass that lets one through draws where it must not.
    resolveHolder: (blockId) => {
      const extra = extraHolders.find((entry) => entry.key === blockId);

      return extra?.holder ?? holders.get(blockId) ?? null;
    },
    resolveInputs: (blockId) => {
      const toolRoot = holders.get(blockId)?.querySelector<HTMLElement>('[contenteditable="true"]');

      return toolRoot === null || toolRoot === undefined ? [] : [toolRoot];
    },
    translate: options.translate,
    isLocalAnonymous: options.isLocalAnonymous,
  };

  if (options.omitIsHidden !== true) {
    rendererOptions.isHidden = () => hidden.value;
  }

  const renderer = createPresenceRenderer(rendererOptions);

  harnesses.push({ host, renderer });

  const require_ = (blockId: string): HTMLElement => {
    const holder = holders.get(blockId);

    if (holder === undefined) {
      throw new Error(`no holder for ${blockId}`);
    }

    return holder;
  };

  return { host, renderer, hidden, holderOf: require_ };
};

const peer = (clientId: number, state: Record<string, unknown>): PresenceState => ({ clientId, state });

const caretAt = (blockId: string): Record<string, unknown> => ({ blockId, inputIndex: 0, anchor: 1, head: 1 });

const named = (clientId: number, name: string, blockId: string): PresenceState =>
  peer(clientId, { user: { name }, blockId, caret: caretAt(blockId) });

/** A peer who published a `user` object with no name: the anonymous default. */
const anonymous = (clientId: number, blockId: string): PresenceState =>
  peer(clientId, { user: {}, blockId, caret: caretAt(blockId) });

const faceOf = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>(`[${FACE_ATTR}]`);

const caretOf = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>(`[${CARET_ATTR}]`);

const rectAt = (left: number): DOMRect => ({
  left, top: 0, height: 18, right: left, bottom: 18, width: 0, x: left, y: 0,
  toJSON: () => ({}),
});

describe('presence renderer — mutants', () => {
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

  /**
   * `blockIdWithoutCaret` is the fallback for a peer who is on a block but
   * published no caret. It has to reject the id WHOLE — an empty string and a
   * non-string are not block ids, and the holder lookup below will happily
   * answer for anything the map was keyed by.
   */
  describe('a peer who published no caret', () => {
    it('draws nothing for an empty block id', () => {
      const harness = setup({ blockIds: ['', 'block-2'] });

      harness.renderer.render([peer(99, { user: { name: 'Ghost' }, blockId: '', caret: null })], 42);

      expect(harness.host.querySelectorAll(`[${FACE_ATTR}]`)).toHaveLength(0);
      expect(faceOf(harness.holderOf(''))).toBeNull();
      expect(caretOf(harness.holderOf(''))).toBeNull();
    });

    it('draws nothing for a block id that is not a string', () => {
      const hostile: unknown = { nope: true };
      const holder = makeHolder('not-a-string');
      const harness = setup({
        blockIds: ['block-2'],
        extraHolders: [{ key: hostile, holder }],
      });

      harness.renderer.render([peer(99, { user: { name: 'Ghost' }, blockId: hostile, caret: null })], 42);

      expect(faceOf(holder)).toBeNull();
      expect(harness.host.querySelectorAll(`[${FACE_ATTR}]`)).toHaveLength(0);
    });
  });

  describe('a peer name off the wire', () => {
    it('trims before it reaches the label and the monogram', () => {
      const harness = setup();

      harness.renderer.render([named(99, '   Grace Hopper   ', 'block-2')], 42);

      const element = faceOf(harness.holderOf('block-2'));

      expect(element?.getAttribute('aria-label')).toBe('Grace Hopper');
      expect(element?.getAttribute(INITIALS_ATTR)).toBe('GH');
    });

    it('caps the label at 32 code points', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 'block-2')], 42);

      expect(faceOf(harness.holderOf('block-2'))?.getAttribute('aria-label'))
        .toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef');
    });
  });

  /**
   * The silhouette pool is handed out to the NAMELESS alone, and the same set
   * of ids in every browser. Counting a named peer as a contestant — or
   * handing a glyph back to a peer who published a name — renames somebody.
   */
  describe('who contests a silhouette', () => {
    it('keeps a named peer named, and lets only the nameless contest', () => {
      // 6 and 54 share base slot 6; 42 (the reader) shares it too. Every id in
      // this room is picked so that one extra contestant moves 54 on.
      const harness = setup({ blockIds: ['named-block', 'anon-block'], translate: (key) => `t:${key}` });

      harness.renderer.render([
        named(6, 'Grace Hopper', 'named-block'),
        anonymous(54, 'anon-block'),
      ], 42);

      const namedFace = faceOf(harness.holderOf('named-block'));
      const anonFace = faceOf(harness.holderOf('anon-block'));

      expect(namedFace?.getAttribute('aria-label')).toBe('Grace Hopper');
      expect(namedFace?.getAttribute(INITIALS_ATTR)).toBe('GH');
      expect(namedFace?.hasAttribute(GLYPH_ATTR)).toBe(false);

      // 54 % 12 = 6 on its own -> 'star'; one extra contestant pushes it to 'sun'.
      expect(anonFace?.getAttribute(GLYPH_ATTR)).toBe('star');
      expect(anonFace?.getAttribute('aria-label')).toBe(`t:${ANONYMOUS_LABEL_KEYS['star']}`);
    });

    it('does not let a named peer take a silhouette slot from the nameless', () => {
      const anonBlocks = Array.from({ length: 12 }, (_unused, index) => `anon-${index}`);
      const harness = setup({ blockIds: [...anonBlocks, 'named-block'], translate: (key) => key });

      // Twelve nameless peers, one per base slot, so the pool is exactly
      // exhausted. A NAMED peer must contribute nothing to it: any extra
      // contestant — even one that matches no slot — spends a slot the twelfth
      // nameless peer would have worn.
      harness.renderer.render([
        named(100, 'Grace', 'named-block'),
        ...anonBlocks.map((blockId, index) => anonymous(index, blockId)),
      ], 42);

      const glyphs = anonBlocks.map((blockId) => faceOf(harness.holderOf(blockId))?.getAttribute(GLYPH_ATTR));

      expect(glyphs).not.toContain('unknown');
      expect(new Set(glyphs).size).toBe(12);
    });

    it('does not count a reader who published a name of their own', () => {
      const harness = setup({ translate: (key) => key });

      // `isLocalAnonymous` is absent, so the reader is NOT anonymous — and the
      // reader's id is chosen to collide with the peer's base slot.
      harness.renderer.render([anonymous(54, 'block-2')], 42);

      expect(faceOf(harness.holderOf('block-2'))?.getAttribute(GLYPH_ATTR)).toBe('star');
    });

    it('does not count a reader whose client id is not known yet', () => {
      const harness = setup({ isLocalAnonymous: () => true, translate: (key) => key });

      harness.renderer.render([anonymous(12, 'block-2')], null);

      // Only 12 is in the pool: 12 % 12 = 0 -> 'astronaut'. A `null` pushed into
      // the pool takes slot 0 first and pushes 12 on to 'rocket'.
      expect(faceOf(harness.holderOf('block-2'))?.getAttribute(GLYPH_ATTR)).toBe('astronaut');
    });
  });

  describe('the reflow watch', () => {
    it('watches the host once, however many passes run', () => {
      const built: Array<{ observe: ReturnType<typeof vi.fn> }> = [];
      const original = window.ResizeObserver;

      window.ResizeObserver = class CountingResizeObserver {
        public observe = vi.fn();

        public unobserve = vi.fn();

        public disconnect = vi.fn();

        public constructor(_callback: ResizeObserverCallback) {
          built.push(this);
        }
      };

      try {
        const harness = setup();

        harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
        harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

        expect(built).toHaveLength(1);
        expect(built[0]?.observe).toHaveBeenCalledWith(harness.host);
      } finally {
        window.ResizeObserver = original;
      }
    });

    it('still draws when the environment has no ResizeObserver', () => {
      const scope = window as unknown as Record<string, unknown>;
      const original = scope.ResizeObserver;

      scope.ResizeObserver = undefined;

      try {
        const harness = setup();

        expect(() => harness.renderer.render([named(99, 'Grace', 'block-2')], 42)).not.toThrow();
        expect(caretOf(harness.holderOf('block-2'))).not.toBeNull();
      } finally {
        scope.ResizeObserver = original;
      }
    });
  });

  /**
   * `reposition()` re-measures what is already drawn — local typing reflows the
   * line under a remote caret with no awareness traffic to ride on — and it is
   * the one entry point the chromeless gate must also cover.
   */
  describe('reposition', () => {
    it('re-measures the carets it already drew', () => {
      const rect = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(10));
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(caretOf(harness.holderOf('block-2'))?.style.left).toBe('10px');

      rect.mockReturnValue(rectAt(90));
      harness.renderer.reposition();

      expect(caretOf(harness.holderOf('block-2'))?.style.left).toBe('90px');
    });

    it('re-measures nothing while the editor is chromeless', () => {
      const rect = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rectAt(10));
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(caretOf(harness.holderOf('block-2'))?.style.left).toBe('10px');

      harness.hidden.value = true;
      rect.mockReturnValue(rectAt(90));
      harness.renderer.reposition();

      expect(caretOf(harness.holderOf('block-2'))?.style.left).toBe('10px');
    });

    it('repositions for a host that never passed an isHidden', () => {
      const harness = setup({ omitIsHidden: true });

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(caretOf(harness.holderOf('block-2'))).not.toBeNull();
      expect(() => harness.renderer.reposition()).not.toThrow();
    });
  });
});
