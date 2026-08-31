/**
 * Presence rendering (Phase 3, task C3) — the DOM half.
 *
 * Two things are pinned here. First the child-holder decoration law: presence
 * writes on a block's HOLDER and appends its own label there, never at or below
 * the tool root and never around the holder. Second R5: every field of a peer's
 * state is written by another browser, so the name only ever reaches the DOM
 * through `textContent` and the colour only reaches CSS after passing a strict
 * pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { presenceColorFor, type PresenceState } from '../../../../../src/components/modules/collaboration/presence';
import {
  createPresenceRenderer,
  type PresenceRenderer,
} from '../../../../../src/components/modules/collaboration/presence-renderer';

const PRESENCE_ATTR = 'data-blok-presence';
const PRESENCE_COLOR = '--blok-presence-color';

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
  toolRoot.contentEditable = 'true';
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

const named = (clientId: number, name: string, blockId: string | null, color?: string): PresenceState =>
  peer(clientId, { user: color === undefined ? { name } : { name, color }, blockId });

const stack = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('[data-blok-presence-stack]');

const avatars = (host: HTMLElement): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-blok-presence-avatar]'));

const label = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>('[data-blok-presence-label]');

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
    it('gets an avatar in the stack and a coloured outline on the holder', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace Hopper', 'block-2', '#0b6e99')], 42);

      const holder = harness.holderOf('block-2');

      expect(holder.getAttribute(PRESENCE_ATTR)).toBe('');
      expect(holder.style.getPropertyValue(PRESENCE_COLOR)).toBe('#0b6e99');
      expect(label(holder)?.textContent).toBe('Grace Hopper');
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
      expect(label(holder)?.parentElement).toBe(holder);
      expect(holder.parentElement?.hasAttribute('data-blok-presence-label')).toBe(false);
    });

    it('marks the label inert so it never joins the caret or a copied selection', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      const element = label(harness.holderOf('block-2'));

      expect(element?.getAttribute('contenteditable')).toBe('false');
      expect(element?.getAttribute('aria-hidden')).toBe('true');
    });

    it('is not drawn without a display name', () => {
      const harness = setup();

      harness.renderer.render([peer(99, { blockId: 'block-2' }), peer(98, { user: {}, blockId: 'block-3' })], 42);

      expect(harness.holderOf('block-2').hasAttribute(PRESENCE_ATTR)).toBe(false);
      expect(avatars(harness.host)).toHaveLength(0);
    });
  });

  describe('the local user', () => {
    it('is never drawn on their own block', () => {
      const harness = setup();

      harness.renderer.render(
        [named(42, 'Me', 'block-1'), named(99, 'Grace', 'block-2')],
        42
      );

      expect(harness.holderOf('block-1').hasAttribute(PRESENCE_ATTR)).toBe(false);
      expect(harness.holderOf('block-2').hasAttribute(PRESENCE_ATTR)).toBe(true);
      expect(avatars(harness.host)).toHaveLength(1);
    });
  });

  describe('hostile remote fields', () => {
    it('writes a name as text, never as markup', () => {
      const harness = setup();
      const hostile = '<img src=x onerror=alert(1)>';

      harness.renderer.render([named(99, hostile, 'block-2')], 42);

      const element = label(harness.holderOf('block-2'));

      expect(element?.textContent).toBe(hostile);
      expect(element?.children).toHaveLength(0);
      expect(avatars(harness.host)[0].children).toHaveLength(0);
    });

    it('caps a very long name instead of letting it paint the page', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'x'.repeat(5000), 'block-2')], 42);

      const text = label(harness.holderOf('block-2'))?.textContent ?? '';

      expect(text.length).toBeLessThanOrEqual(64);
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

      const holder = harness.holderOf('block-2');

      expect(holder.style.getPropertyValue(PRESENCE_COLOR)).toBe(presenceColorFor(99));
      expect(holder.getAttribute('style') ?? '').not.toContain('url(');
      expect(holder.getAttribute('style') ?? '').not.toContain('javascript');
    });

    it('tolerates a block id that names nothing', () => {
      const harness = setup();

      expect(() => harness.renderer.render([
        named(99, 'Grace', 'no-such-block'),
        named(98, 'Ada', null),
        peer(97, { user: { name: 'Alan' }, blockId: { nope: true } }),
      ], 42)).not.toThrow();

      expect(avatars(harness.host)).toHaveLength(3);
      expect(harness.host.querySelectorAll('[data-blok-presence-label]')).toHaveLength(0);
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

  describe('hidden controls', () => {
    it('draws nothing while the editor is chromeless, and cleans up what it drew', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.hidden.value = true;
      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(stack(harness.host)).toBeNull();
      expect(harness.holderOf('block-2').hasAttribute(PRESENCE_ATTR)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('undoes every attribute, property and element it wrote when a peer leaves', () => {
      const harness = setup();
      const holder = harness.holderOf('block-2');
      const before = holder.outerHTML;

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([], 42);

      expect(holder.hasAttribute(PRESENCE_ATTR)).toBe(false);
      expect(holder.style.getPropertyValue(PRESENCE_COLOR)).toBe('');
      expect(label(holder)).toBeNull();
      expect(holder.outerHTML).toBe(before);
    });

    it('moves the decoration when a peer moves to another block', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([named(99, 'Grace', 'block-3')], 42);

      expect(harness.holderOf('block-2').hasAttribute(PRESENCE_ATTR)).toBe(false);
      expect(label(harness.holderOf('block-2'))).toBeNull();
      expect(harness.holderOf('block-3').hasAttribute(PRESENCE_ATTR)).toBe(true);
      expect(label(harness.holderOf('block-3'))?.textContent).toBe('Grace');
    });

    it('keeps one label per block when a peer stays put', () => {
      const harness = setup();

      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);
      harness.renderer.render([named(99, 'Grace', 'block-2')], 42);

      expect(harness.holderOf('block-2').querySelectorAll('[data-blok-presence-label]')).toHaveLength(1);
    });

    it('clear() takes the stack and every stamp with it', () => {
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
