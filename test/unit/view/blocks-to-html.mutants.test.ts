// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToHtml } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Behaviour of `src/view/blocks-to-html.ts` that only an EXACT output string
 * can see: the dispatcher's stamping regexes, the defensive guards on wire
 * data, and the render-cycle bookkeeping. A `toContain` assertion survives a
 * renderer that adds, reorders or widens markup, so every case here pins the
 * whole string.
 *
 * Mutants deliberately left alone, with the evidence that they cannot change
 * output:
 * - `stampAttr`/`stampClass` losing their `^` anchor: every emitter in
 *   `builtinEmitters` opens with `<[a-z]` (or returns `''`, as `emitTable` does
 *   for a content-less table), so an unanchored search finds the same leading
 *   tag at index 0.
 * - `withExistingClass` narrowed rather than widened, and its whole branch: no
 *   centrally-stamped emitter puts a `class` on its FIRST tag — the three that
 *   carry one on the root (header, code, divider) are in `SELF_STAMPING_TOOLS`
 *   and return before stamping — so the `.test()` is false for every document
 *   and the branch never runs. The two mutants that make it match a LATER tag
 *   (`^` dropped, `\s*` → `\S*`) do change output and are covered below.
 * - `onUnknownBlock` defaulting to `''` instead of `'skip'`: the value is only
 *   ever read as `=== 'comment'`.
 * - `typeof id === 'string'` in `blocksById`: `model.byId` is keyed by string
 *   ids, so `Map.get` of a non-string is `undefined` either way.
 * - `list.length > 0` in `classList`: all nine call sites pass a non-empty
 *   constant (LIST_*, TOGGLE_*, CALLOUT_CHILDREN, CODE_AREA, DIVIDER_RULE).
 * - `block.id !== undefined` in `renderGuarded`'s `finally` forced true:
 *   `active.delete(undefined)` is a no-op on a `Set<string>`.
 * - `item.id === undefined` in `renderList`'s run filter forced false:
 *   `renderGuarded` guards `active.add`, so `active.has(undefined)` is always
 *   false and the remaining `!active.has(item.id)` keeps an id-less item anyway.
 */

/**
 * Wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

/** The core's holder → content scaffolding, emitted only under `classes`. */
const HOLDER_OPEN = '<div data-blok-element class="relative opacity-100 first:mt-0 last:pb-0 last:mb-0 '
  + '[&amp;_a]:cursor-pointer [&amp;_a]:underline [&amp;_a]:text-link [&amp;_b]:font-bold [&amp;_i]:italic">'
  + '<div class="relative mx-auto transition-colors duration-150 ease-out max-w-blok-content">';

/**
 * One block's parity output: its own markup inside the block scaffolding.
 * @param inner - the block's rendered markup
 */
const scaffolded = (inner: string): string => `${HOLDER_OPEN}${inner}</div></div>`;

/**
 * A value the published types forbid but a saved document can still carry —
 * `transformUrl` and `ViewRenderContext` are typed, the wire data behind them
 * is not.
 * @param value - the untyped value
 */
const asString = (value: unknown): string => value as string;

describe('blocksToHtml — output-exact renderer contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('root stamping', () => {
    it('adds no class attribute to a tool that has no presentational classes', () => {
      const html = blocksToHtml(doc([{ type: 'image', data: { url: 'https://x.y/a.png', alt: 'x' } }]), { classes: true });

      expect(html).toBe(scaffolded('<figure><img src="https://x.y/a.png" alt="x"></figure>'));
    });

    it('stamps the block classes on the callout root, never on its children cell', () => {
      const html = blocksToHtml(doc([{ type: 'callout', data: { emoji: '' } }]), { classes: true });

      /**
       * The children cell is the first tag in the output that already carries a
       * `class`, so a stamping regex that scans past the root lands there.
       */
      expect(html).toBe(scaffolded(
        '<aside class="text-[length:var(--blok-callout-font-size,var(--blok-paragraph-font-size,inherit))] '
        + 'rounded-xl pl-8 pr-4 pt-[var(--blok-callout-padding-block,5px)] pb-[var(--blok-callout-padding-block,5px)] '
        + 'my-1 flex items-start gap-2 relative">'
        + '<div class="flex-1 min-w-0" data-blok-toggle-children></div></aside>'
      ));
    });

    it('joins an inner element class list with spaces', () => {
      const html = blocksToHtml(doc([{ type: 'divider', data: {} }]), { classes: true });

      expect(html).toBe(scaffolded(
        '<div class="py-3 leading-[1px]">'
        + '<hr class="border-t border-(--blok-border-primary) border-b-0 border-l-0 border-r-0"></div>'
      ));
    });

    it('emits no scaffolding for a block that rendered nothing', () => {
      expect(blocksToHtml(doc([{ type: 'table', data: { content: [] } }]), { classes: true })).toBe('');
    });
  });

  describe('defensive reads of wire data', () => {
    it('renders a non-string code field as empty text', () => {
      const render = (): string => blocksToHtml(doc([{ type: 'code', data: { code: 42 } }]));

      expect(render).not.toThrow();
      expect(render()).toBe('<pre><code></code></pre>');
    });

    it('falls back to the cell text when a cell reference list is not an array', () => {
      const render = (): string => blocksToHtml(doc([
        { type: 'table', data: { content: [[{ blocks: 'p1', text: 'T' }]] } },
      ]));

      expect(render).not.toThrow();
      expect(render()).toBe('<table><tbody><tr><td>T</td></tr></tbody></table>');
    });

    it('falls back to the cell text when every referenced id is unknown', () => {
      const render = (): string => blocksToHtml(doc([
        { type: 'table', data: { content: [[{ blocks: ['gone'], text: 'T' }]] } },
      ]));

      expect(render).not.toThrow();
      expect(render()).toBe('<table><tbody><tr><td>T</td></tr></tbody></table>');
    });

    it('leaves an id-less list item unstamped under blockIds', () => {
      const render = (): string => blocksToHtml(
        doc([{ type: 'list', data: { text: 'one', style: 'unordered' } }]),
        { blockIds: true }
      );

      expect(render).not.toThrow();
      expect(render()).toBe('<ul><li>one</li></ul>');
    });

    it('leaves an id-less self-stamping block unstamped under blockIds', () => {
      const render = (): string => blocksToHtml(doc([{ type: 'header', data: { text: 'T', level: 2 } }]), { blockIds: true });

      expect(render).not.toThrow();
      expect(render()).toBe('<h2>T</h2>');
    });
  });

  describe('url pipeline', () => {
    it('never hands an empty url to transformUrl', () => {
      const html = blocksToHtml(
        doc([{ type: 'image', data: { url: '', alt: 'x' } }]),
        { transformUrl: () => 'https://cdn.test/x.png' }
      );

      expect(html).toBe('<figure><img alt="x"></figure>');
    });

    it('never hands a non-string url to transformUrl', () => {
      const html = blocksToHtml(
        doc([{ type: 'image', data: { url: 42, alt: 'x' } }]),
        { transformUrl: () => 'https://cdn.test/x.png' }
      );

      expect(html).toBe('<figure><img alt="x"></figure>');
    });

    it('drops a url a transform turned into a non-string', () => {
      const render = (): string => blocksToHtml(
        doc([{ type: 'image', data: { url: 'https://x.y/a.png', alt: 'x' } }]),
        { transformUrl: () => asString(42) }
      );

      expect(render).not.toThrow();
      expect(render()).toBe('<figure><img alt="x"></figure>');
    });

    it('tells an inline anchor transform which attribute it is rewriting', () => {
      const html = blocksToHtml(
        doc([{ type: 'paragraph', data: { text: 'see <a href="/a">link</a>' } }]),
        { transformUrl: (url, ctx) => `${url}#${String(ctx.attr)}-${String(ctx.blockType)}` }
      );

      expect(html).toBe('<p>see <a href="/a#href-undefined">link</a></p>');
    });
  });

  describe('custom renderer context', () => {
    it('reads a non-string plainText argument as empty text', () => {
      const html = blocksToHtml(doc([{ type: 'widget', data: {} }]), {
        renderers: { widget: (_data, ctx) => ctx.plainText(asString(42)) },
      });

      expect(html).toBe('');
    });

    it('drops malformed entries handed to renderBlocks', () => {
      const render = (): string => blocksToHtml(doc([{ type: 'widget', data: {} }]), {
        renderers: {
          widget: (_data, ctx) => ctx.renderBlocks([{ type: '', data: {} }, { type: 'paragraph', data: { text: 'ok' } }]),
        },
      });

      expect(render).not.toThrow();
      expect(render()).toBe('<p>ok</p>');
    });

    it('renders nothing when renderBlocks is handed a non-array', () => {
      const render = (): string => blocksToHtml(doc([{ type: 'widget', data: {} }]), {
        onUnknownBlock: 'comment',
        renderers: { widget: (_data, ctx) => ctx.renderBlocks('nope' as unknown as OutputBlockData[]) },
      });

      expect(render).not.toThrow();
      expect(render()).toBe('');
    });

    it('sends every list block to a custom list renderer instead of grouping the run', () => {
      const html = blocksToHtml(
        doc([
          { type: 'list', data: { text: 'one', style: 'unordered' } },
          { type: 'list', data: { text: 'two', style: 'unordered' } },
        ]),
        { renderers: { list: (data) => `<div>${typeof data.text === 'string' ? data.text : ''}</div>` } }
      );

      expect(html).toBe('<div>one</div><div>two</div>');
    });
  });

  describe('unknown-block comment', () => {
    it('collapses dash runs in the commented tool name so it cannot close the comment', () => {
      const html = blocksToHtml(doc([{ type: 'a--b>', data: {} }]), { onUnknownBlock: 'comment' });

      expect(html).toBe('<!-- blok:unknown a-b&gt; -->');
    });
  });

  describe('render cycles', () => {
    it('renders an empty cell for a table whose cell references the table itself', () => {
      const render = (): string => blocksToHtml(doc([
        { id: 't1', type: 'table', data: { content: [[{ blocks: ['t1'] }]] } },
      ]));

      expect(render).not.toThrow();
      expect(render()).toBe('<table><tbody><tr><td></td></tr></tbody></table>');
    });

    it('renders a block once per reference when two cells point at it', () => {
      const html = blocksToHtml(doc([
        { id: 't1', type: 'table', data: { content: [[{ blocks: ['p1'] }, { blocks: ['p1'] }]] } },
        { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'X' } },
      ]));

      expect(html).toBe('<table><tbody><tr><td><p>X</p></td><td><p>X</p></td></tr></tbody></table>');
    });

    it('drops a list item whose id is already on the render stack', () => {
      /**
       * The duplicate id is the point: a run item is only ever reached through
       * the grouping path, so the only way its id can be active is a second
       * block reusing an ancestor's id. Without the filter the item renders
       * inside its own ancestor.
       */
      const html = blocksToHtml(doc([
        { id: 'X', type: 'paragraph', data: { text: 'P' } },
        { id: 'C', type: 'column', parent: 'X', data: {} },
        { id: 'X', type: 'list', parent: 'C', data: { text: 'L', style: 'unordered' } },
      ]));

      expect(html).toBe('<p>P</p><div></div>');
    });
  });
});
