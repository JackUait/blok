/**
 * Presence stylesheet — what src/styles/presence.css resolves to on the DOM
 * the renderer actually writes.
 *
 * The sheet is injected as authored and read back through jsdom's cascade
 * (declared properties, plus inheritance for the ones jsdom implements —
 * `pointer-events` and `display` among them), so each case pins a computed
 * value on a real face, strip, avatar or stack rather than a line of text.
 * Pseudo-element styles are the one thing jsdom cannot compute, and its CSSOM
 * drops `attr()` as a `content` value on read-back, so the rule that paints
 * the monogram is pinned by its parsed selector and its authored declaration.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DragPreview } from '../../../../../src/components/modules/drag/preview/DragPreview';
import {
  createPresenceRenderer,
  type PresenceRenderer,
} from '../../../../../src/components/modules/collaboration/presence-renderer';
import {
  ANONYMOUS_GLYPHS,
  UNKNOWN_GLYPH,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';
import type { PresenceState } from '../../../../../src/components/modules/collaboration/presence';

const STYLESHEET = readFileSync(resolve(__dirname, '../../../../../src/styles/presence.css'), 'utf8');

const INITIALS_ATTR = 'data-blok-presence-initials';
const GLYPH_ATTR = 'data-blok-presence-glyph';

interface Harness {
  root: HTMLElement;
  renderer: PresenceRenderer;
  holder: HTMLElement;
  contentWrapper: HTMLElement;
}

const mounted: HTMLElement[] = [];
const renderers: PresenceRenderer[] = [];

/**
 * One block inside an editor root, with the sheet's scope attribute on the
 * root so its token block applies.
 */
const setup = (): Harness => {
  const root = document.createElement('div');
  const host = document.createElement('div');
  const holder = document.createElement('div');
  const contentWrapper = document.createElement('div');
  const toolRoot = document.createElement('div');

  root.setAttribute('data-blok-interface', 'blok');
  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-id', 'block-1');
  contentWrapper.setAttribute('data-blok-element-content', '');
  toolRoot.setAttribute('data-blok-tool', 'paragraph');
  toolRoot.setAttribute('contenteditable', 'true');
  toolRoot.textContent = 'hello';

  contentWrapper.appendChild(toolRoot);
  holder.appendChild(contentWrapper);
  host.appendChild(holder);
  root.appendChild(host);
  document.body.appendChild(root);
  mounted.push(root);

  const renderer = createPresenceRenderer({
    host,
    resolveHolder: (blockId) => (blockId === 'block-1' ? holder : null),
    resolveInputs: (blockId) => (blockId === 'block-1' ? [toolRoot] : []),
  });

  renderers.push(renderer);

  return {
    root,
    renderer,
    holder,
    contentWrapper,
  };
};

const grace = (clientId: number): PresenceState => ({
  clientId,
  state: {
    user: { name: 'Grace Hopper', color: '#0b6e99' },
    blockId: 'block-1',
    caret: { blockId: 'block-1', inputIndex: 0, anchor: 1, head: 1 },
  },
});

const query = (scope: ParentNode, selector: string): HTMLElement => {
  const element = scope.querySelector<HTMLElement>(selector);

  if (element === null) {
    throw new Error(`nothing matches ${selector}`);
  }

  return element;
};

/** Every style rule in the injected sheet, flattened out of its at-rules. */
const styleRules = (sheet: CSSStyleSheet): CSSStyleRule[] => {
  const flatten = (rules: CSSRuleList): CSSStyleRule[] =>
    Array.from(rules).flatMap((rule) => {
      if (rule instanceof CSSStyleRule) {
        return [rule];
      }

      return rule instanceof CSSGroupingRule ? flatten(rule.cssRules) : [];
    });

  return flatten(sheet.cssRules);
};

describe('presence stylesheet', () => {
  let style: HTMLStyleElement;

  beforeEach(() => {
    vi.clearAllMocks();
    style = document.createElement('style');
    style.textContent = STYLESHEET;
    document.head.appendChild(style);
  });

  afterEach(() => {
    renderers.splice(0).forEach((renderer) => renderer.clear());
    mounted.splice(0).forEach((element) => element.remove());
    style.remove();
    vi.restoreAllMocks();
  });

  /**
   * A nameless peer wears a silhouette instead of a monogram. The shapes live
   * in the stylesheet and not in the DOM: the gutter face sits inside a block
   * holder, and block copy unwraps the strip and keeps every node it held, so
   * an inline `<svg>` would ride into the next document. A mask painted from a
   * data URI leaves the holder with nothing to carry.
   */
  describe('an anonymous silhouette', () => {
    it('carries a shape for every silhouette the assigner can hand out', () => {
      const glyphs = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];

      glyphs.forEach((glyph) => {
        expect(STYLESHEET).toMatch(
          new RegExp(`\\[${GLYPH_ATTR}="${glyph}"\\][^{]*\\{[^}]*--blok-presence-glyph:\\s*url\\("data:image/svg\\+xml`)
        );
      });
    });

    it('paints the mask on the same pseudo-element the monogram uses', () => {
      const sheet = style.sheet;

      if (sheet === null) {
        throw new Error('stylesheet did not parse');
      }

      const painter = styleRules(sheet).find((rule) =>
        rule.selectorText.includes(`[${GLYPH_ATTR}]::after`));

      expect(painter?.style.getPropertyValue('mask-image')).not.toBe('');
      expect(painter?.style.getPropertyValue('background-color')).not.toBe('');
    });
  });

  describe('the gutter face', () => {
    it('paints the monogram from its attribute, so the holder holds no text for it', () => {
      const sheet = style.sheet;

      if (sheet === null) {
        throw new Error('stylesheet did not parse');
      }

      const painter = styleRules(sheet).find((rule) =>
        rule.selectorText.includes('[data-blok-presence-face]::after')
        && rule.selectorText.includes('[data-blok-presence-face-overflow]::after'));

      expect(painter).toBeDefined();
      expect(STYLESHEET).toMatch(
        new RegExp(`\\[data-blok-presence-face-overflow\\]::after\\s*\\{\\s*content:\\s*attr\\(${INITIALS_ATTR}\\);\\s*\\}`)
      );
    });

    /**
     * `pointer-events` inherits. The strip and the stack are transparent so
     * the +/⠿ hover zone under them is untouched — but a face whose only
     * identification is its `title` has to be hoverable, or the tooltip the
     * avatar tests pin can never appear.
     */
    it('is hoverable for its tooltip while its strip stays transparent', () => {
      const harness = setup();

      harness.renderer.render([grace(99)], 42);

      const strip = query(harness.holder, '[data-blok-presence-gutter]');
      const face = query(strip, '[data-blok-presence-face]');

      expect(getComputedStyle(strip).pointerEvents).toBe('none');
      expect(getComputedStyle(face).pointerEvents).toBe('auto');
    });

    /**
     * `:hover` is true for every ancestor of the hovered element, and the
     * +/⠿ controls attach to the INNERMOST hovered block — so a container's
     * face must not step aside when one of its children is the block hovered.
     * jsdom cannot simulate `:hover`; the selector is pinned as parsed.
     */
    it('steps aside only for the innermost hovered block', () => {
      const sheet = style.sheet;

      if (sheet === null) {
        throw new Error('stylesheet did not parse');
      }

      const slides = styleRules(sheet).filter((rule) =>
        rule.selectorText.includes(':hover') && rule.selectorText.includes('[data-blok-presence-gutter]'));

      expect(slides.length).toBeGreaterThan(0);
      slides.forEach((rule) => {
        expect(rule.selectorText).toContain('[data-blok-element]:hover:not(:has([data-blok-element]:hover))');
        expect(rule.style.transform).not.toBe('');
      });
    });

    it('does not ride along in the drag ghost', () => {
      const harness = setup();

      harness.renderer.render([grace(99)], 42);

      // The ghost clones the content wrapper — the very element the strip is
      // mounted on — so without a rule of its own the face would drag along.
      const preview = new DragPreview().createSingle(harness.contentWrapper, false);

      document.body.appendChild(preview);
      mounted.push(preview);

      const ghostStrip = query(preview, '[data-blok-presence-gutter]');

      expect(getComputedStyle(ghostStrip).display).toBe('none');
      expect(getComputedStyle(query(harness.holder, '[data-blok-presence-gutter]')).display).not.toBe('none');
    });
  });

  describe('the avatar stack', () => {
    it('is hoverable per avatar for its tooltip while the stack stays transparent', () => {
      const harness = setup();

      harness.renderer.render([grace(99)], 42);

      const stack = query(harness.root, '[data-blok-presence-stack]');
      const avatar = query(stack, '[data-blok-presence-avatar]');

      expect(getComputedStyle(stack).pointerEvents).toBe('none');
      expect(getComputedStyle(avatar).pointerEvents).toBe('auto');
    });
  });
});
