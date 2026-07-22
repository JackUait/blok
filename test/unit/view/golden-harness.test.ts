/**
 * Golden harness (design D3): CI-gating drift guard between the synchronous
 * view renderer (`blocksToHtml` / `blocksToPlainText`) and a REAL editor
 * booted read-only in jsdom over the same saved data.
 *
 * Block wrappers are NOT comparable byte-for-byte BY DESIGN: the live editor
 * renders div-based scaffolding (contenteditable hosts, marker spans, table
 * cell wrappers) while the view emits semantic tags (`<p>`, `<ul>/<li>`,
 * `<table>`). What IS comparable, and what this harness asserts:
 *
 * 1. INLINE-CONTENT FIDELITY — for every text-bearing element ("host"), the
 *    inline HTML (text + marks + semantic attributes) must match after
 *    normalization. Both paths source from `data.*` through their respective
 *    sanitizers, so a mismatch means sanitize/emitter divergence.
 * 2. DOCUMENT SHAPE — same top-level block count, same host order, same
 *    per-block plain text (editor textContent vs blocksToPlainText).
 * 3. SANITIZE COMPOSITION — an editor and a view given
 *    `defineBlokSchema(sameConfig).viewSchema` agree on which inline
 *    tags/attrs survive (mark color styles survive both; `<img onerror>`,
 *    `<script>`, `javascript:` hrefs are stripped by both).
 *
 * Documented, deliberate normalizations (NOT drift):
 * - `<strong>`≡`<b>`, `<em>`≡`<i>`, `<del>/<strike>`≡`<s>`: the editor's
 *   bold-normalization pass rewrites `b`→`strong` on render; the view
 *   preserves the stored tag. Semantically identical.
 * - class, data- and aria- attributes and other editor scaffolding are stripped;
 *   semantic attributes (href, target, rel, style, src, alt, colspan, …) are
 *   kept and compared.
 * - Marker colors: the editor canonicalizes raw rgb() colors to
 *   `var(--blok-color-*)` tokens on render, so fixtures store the canonical
 *   token form (what a real save produces).
 *
 * Tools compared: paragraph, header (incl. toggleable), quote, code, divider,
 * list (unordered/nested/ordered/checklist), callout, toggle (open + closed),
 * table (headings + merged cell), image, columns (column_list/column).
 * Tools skipped (with reasons):
 * - quote `caption`: the editor migrates the legacy caption field into a
 *   separate paragraph block on render; the view renders `<cite>` for the
 *   stored legacy shape. Different document shapes by design — covered by
 *   blocks-to-html unit tests instead.
 * - video/audio/file/bookmark/embed: their editor DOM is a card/player UI
 *   whose visible text is scaffolding (domain labels, player controls), not
 *   comparable content; URL safety is covered by emitter unit tests.
 * - spacer: carries no content on either side.
 * - database/database-row: heavy view-config UI; the view's minimal fallback
 *   (children as blocks) is covered by blocks-to-html unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import {
  Bold,
  Callout,
  Code,
  Column,
  ColumnList,
  Divider,
  Header,
  Image,
  InlineCode,
  Italic,
  Link,
  List,
  Marker,
  Paragraph,
  Quote,
  Strikethrough,
  Table,
  Toggle,
  Underline,
} from '../../../src/tools';
import { blocksToHtml, blocksToPlainText, defineBlokSchema } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/* ------------------------------------------------------------------ */
/* Editor boot                                                         */
/* ------------------------------------------------------------------ */

const fullTools = {
  paragraph: { class: Paragraph, inlineToolbar: true },
  header: { class: Header, inlineToolbar: true },
  list: { class: List, inlineToolbar: true },
  table: { class: Table, inlineToolbar: true },
  toggle: { class: Toggle, inlineToolbar: true },
  callout: { class: Callout, inlineToolbar: true },
  divider: { class: Divider },
  quote: { class: Quote, inlineToolbar: true },
  code: { class: Code },
  image: { class: Image },
  column_list: { class: ColumnList },
  column: { class: Column },
  bold: { class: Bold },
  italic: { class: Italic },
  link: { class: Link },
  marker: { class: Marker },
  inlineCode: { class: InlineCode },
  underline: { class: Underline },
  strikethrough: { class: Strikethrough },
};

/**
 * Minimal replica of Blok.destroy()'s module teardown so a Core booted
 * directly (to reach the rendered DOM) does not leak listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as { markDestroyed?: () => void };

    if (typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

/* ------------------------------------------------------------------ */
/* Host discovery + normalization                                      */
/* ------------------------------------------------------------------ */

/** Inline mark tags — never hosts themselves, kept inside host fragments. */
const INLINE_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'mark', 'code', 'span', 'sub', 'sup', 'br',
]);

/** Tags that never qualify as hosts even with direct inline content (their inline children are decorations, e.g. the callout emoji span). */
const NEVER_HOST_TAGS = new Set(['aside', 'figure']);

/** Canonical tag spellings for semantically identical marks. */
const CANONICAL_TAG: Record<string, string> = {
  strong: 'b',
  em: 'i',
  del: 's',
  strike: 's',
};

/** Semantic attributes kept (and compared) on inline marks; everything else is editor/view scaffolding. */
const KEPT_ATTRIBUTES = new Set([
  'href', 'target', 'rel', 'style', 'src', 'alt', 'colspan', 'rowspan', 'start', 'checked', 'open', 'download', 'data-latex', 'title',
]);

/**
 * Should this subtree be skipped entirely during host discovery?
 * Buttons/SVG/inputs and known scaffolding never carry comparable content.
 * `aria-hidden` subtrees are skipped only when they contain no nested blocks
 * (a closed toggle hides its children container but the blocks inside are
 * real content the view also renders inside `<details>`).
 * @param el - element to check
 */
const isSkippedSubtree = (el: Element): boolean => {
  const tag = el.tagName.toLowerCase();

  if (['button', 'svg', 'input', 'select', 'textarea', 'style', 'script', 'col', 'colgroup'].includes(tag)) {
    return true;
  }

  if (el.hasAttribute('data-list-marker') || el.hasAttribute('data-blok-toggle-body-placeholder') || el.hasAttribute('data-blok-table-haze')) {
    return true;
  }

  /** Editor chrome rendered as spans (e.g. the toggle expand arrow). */
  if (el.getAttribute('role') === 'button') {
    return true;
  }

  if (el.getAttribute('aria-hidden') === 'true' && el.querySelector('[data-blok-element]') === null) {
    return true;
  }

  return false;
};

/**
 * Does this element directly hold inline content (a non-whitespace text node
 * or an inline mark child)?
 * @param el - element to check
 */
const hasDirectInlineContent = (el: Element): boolean => {
  return Array.from(el.childNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/[﻿​]/g, '').trim() !== '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const child = node as Element;

    return INLINE_TAGS.has(child.tagName.toLowerCase()) && !isSkippedSubtree(child);
  });
};

/**
 * Collect the "hosts" — innermost elements directly holding inline content —
 * of a DOM subtree, in document order. Works on both the editor's rendered
 * DOM and the view's parsed output, so the two sides are discovered by the
 * same rule rather than per-tool selectors.
 * @param root - subtree root (redactor / parsed view container)
 * @param boundary - stop descending at nested block wrappers when true (per-block "own content" mode)
 */
const collectHosts = (root: Element, boundary = false): Element[] => {
  const hosts: Element[] = [];

  /**
   * Visit one element: qualify it as a host, then keep scanning its
   * NON-inline element children — a host may still contain block-level
   * children (e.g. a nested <ul> inside an <li>) that hold further hosts.
   * Inline mark children stay inside the host's fragment and are never
   * descended into.
   * @param el - element to visit
   */
  const visit = (el: Element): void => {
    if (isSkippedSubtree(el)) {
      return;
    }

    if (boundary && el !== root && el.hasAttribute('data-blok-element')) {
      return;
    }

    const tag = el.tagName.toLowerCase();

    if (!INLINE_TAGS.has(tag) && !NEVER_HOST_TAGS.has(tag) && hasDirectInlineContent(el)) {
      hosts.push(el);
    }

    for (const child of Array.from(el.children)) {
      if (!INLINE_TAGS.has(child.tagName.toLowerCase())) {
        visit(child);
      }
    }
  };

  for (const child of Array.from(root.children)) {
    visit(child);
  }

  return hosts;
};

/**
 * Serialize a host's inline content to a canonical comparable string:
 * non-inline element children removed, tags canonicalized, scaffolding
 * attributes stripped, kept attributes sorted, whitespace collapsed.
 * @param host - host element
 */
const normalizeHostFragment = (host: Element): string => {
  const normalizeStyle = (value: string): string => {
    return value
      .toLowerCase()
      .split(';')
      .map((decl) => decl.replace(/\s+/g, ' ').trim())
      .filter((decl) => decl !== '')
      .sort()
      .join('; ');
  };

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/[﻿​]/g, '').replace(/\s+/g, ' ');

      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as Element;
    const rawTag = el.tagName.toLowerCase();

    if (!INLINE_TAGS.has(rawTag) || isSkippedSubtree(el)) {
      return '';
    }

    const tag = CANONICAL_TAG[rawTag] ?? rawTag;

    const attrs = Array.from(el.attributes)
      .filter((attr) => KEPT_ATTRIBUTES.has(attr.name.toLowerCase()))
      .map((attr) => {
        const name = attr.name.toLowerCase();
        const value = name === 'style' ? normalizeStyle(attr.value) : attr.value;

        return `${name}="${value.replace(/"/g, '&quot;')}"`;
      })
      .sort()
      .join(' ');

    const openTag = attrs === '' ? `<${tag}>` : `<${tag} ${attrs}>`;

    if (rawTag === 'br') {
      return '<br>';
    }

    return `${openTag}${Array.from(el.childNodes).map(serializeNode).join('')}</${tag}>`;
  };

  return Array.from(host.childNodes)
    .map(serializeNode)
    .join('')
    /**
     * Sanitizers removing an element (e.g. a stripped <img>) leave two
     * adjacent whitespace text nodes on one side and a single collapsed one
     * on the other — equivalent rendering, so runs collapse here too.
     */
    .replace(/ {2,}/g, ' ')
    .replace(/(<br>)+$/, '')
    .trim();
};

/**
 * Compare two host lists; returns a human-readable diff or null when equal.
 * Pure so the negative controls can prove it detects planted mismatches.
 * @param editorHosts - hosts discovered in the editor DOM
 * @param viewHosts - hosts discovered in the view output
 */
const fragmentsDiff = (editorHosts: Element[], viewHosts: Element[]): string | null => {
  const editorFragments = editorHosts.map(normalizeHostFragment).filter((fragment) => fragment !== '');
  const viewFragments = viewHosts.map(normalizeHostFragment).filter((fragment) => fragment !== '');

  if (editorFragments.length !== viewFragments.length) {
    return `host count mismatch: editor ${editorFragments.length} vs view ${viewFragments.length}\n` +
      `editor: ${JSON.stringify(editorFragments, null, 2)}\nview: ${JSON.stringify(viewFragments, null, 2)}`;
  }

  for (let i = 0; i < editorFragments.length; i++) {
    if (editorFragments[i] !== viewFragments[i]) {
      return `fragment ${i} mismatch:\n  editor: ${editorFragments[i]}\n  view:   ${viewFragments[i]}`;
    }
  }

  return null;
};

/**
 * Collapse all whitespace runs for plain-text comparison.
 * @param text - raw text
 */
const normalizeWhitespace = (text: string): string => {
  return text.replace(/[﻿​]/g, '').replace(/\s+/g, ' ').trim();
};

/**
 * Parse the view renderer's HTML output into a detached container.
 * @param html - view output
 */
const parseViewHtml = (html: string): HTMLElement => {
  const container = document.createElement('div');

  container.innerHTML = html;

  return container;
};

/* ------------------------------------------------------------------ */
/* Non-vacuity accounting                                              */
/* ------------------------------------------------------------------ */

const comparedTools = new Set<string>();
let comparedFragmentCount = 0;

/* ------------------------------------------------------------------ */
/* The harness                                                         */
/* ------------------------------------------------------------------ */

describe('golden harness: view renderer vs live editor', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core !== undefined) {
      destroyCore(core);
      core = undefined;
    }
    holder.remove();
    vi.restoreAllMocks();
  });

  /**
   * Boot a real read-only editor over the given blocks and return its
   * redactor element (the content zone; toolbars/overlays live outside it).
   * @param blocks - saved document blocks
   * @param tools - editor tools config (defaults to the full built-in set)
   */
  const renderInEditor = async (
    blocks: OutputBlockData[],
    tools: Record<string, unknown> = fullTools
  ): Promise<Element> => {
    core = new Core({
      holder,
      tools: tools as never,
      readOnly: true,
      data: { blocks },
    });
    await core.isReady;

    const redactor = holder.querySelector('[data-blok-redactor]');

    expect(redactor).not.toBeNull();

    return redactor as Element;
  };

  /**
   * Run the three guarantees over one fixture document.
   * @param toolName - tool under test (non-vacuity accounting)
   * @param blocks - fixture blocks
   */
  const compareFixture = async (toolName: string, blocks: OutputBlockData[]): Promise<{ redactor: Element; viewRoot: HTMLElement }> => {
    const data: OutputData = { blocks };
    const redactor = await renderInEditor(blocks);
    const viewRoot = parseViewHtml(blocksToHtml(data, { schema: defineBlokSchema({ tools: fullTools as never }).viewSchema }));

    const editorHosts = collectHosts(redactor);
    const viewHosts = collectHosts(viewRoot);

    /** Guarantee 1: inline-content fidelity, host by host, in order. */
    const diff = fragmentsDiff(editorHosts, viewHosts);

    expect(diff, `[${toolName}] ${diff ?? ''}`).toBeNull();

    /** Guarantee 2a: top-level rendered block count matches the document. */
    const topLevelFixtureCount = blocks.filter((block) => !('parent' in block) || block.parent === undefined).length;
    const topLevelRendered = Array.from(redactor.children).filter((child) => child.hasAttribute('data-blok-element')).length;

    expect(topLevelRendered, `[${toolName}] top-level block count`).toBe(topLevelFixtureCount);

    /** Guarantee 2b: whole-document plain text agrees (whitespace-normalized). */
    const editorText = normalizeWhitespace(editorHosts.map((host) => host.textContent ?? '').join(' '));
    const viewText = normalizeWhitespace(blocksToPlainText(data));

    expect(editorText, `[${toolName}] plain text`).toBe(viewText);

    comparedTools.add(toolName);
    comparedFragmentCount += editorHosts.length;

    return { redactor, viewRoot };
  };

  it('paragraph: inline marks (bold, italic, link, inline code, underline, strikethrough, colored mark) survive identically', async () => {
    const { redactor, viewRoot } = await compareFixture('paragraph', [
      {
        id: 'p1',
        type: 'paragraph',
        data: {
          text: 'A <b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>mono</code> ' +
            '<a href="https://example.com/x" target="_blank" rel="noopener">link</a> ' +
            '<mark style="background-color: var(--blok-color-red-bg);">red</mark> tail',
        },
      },
      { id: 'p2', type: 'paragraph', data: { text: 'Second block' } },
    ]);

    /** The colored mark must survive on BOTH sides (guards against a vacuous both-stripped pass). */
    expect(redactor.querySelector('mark')?.getAttribute('style')).toContain('--blok-color-red-bg');
    expect(viewRoot.querySelector('mark')?.getAttribute('style')).toContain('--blok-color-red-bg');
  }, 60_000);

  it('header: levels render with matching inline content', async () => {
    await compareFixture('header', [
      { id: 'h1', type: 'header', data: { text: 'Top <i>title</i>', level: 1 } },
      { id: 'h2', type: 'header', data: { text: 'Sub', level: 2 } },
      { id: 'h3', type: 'header', data: { text: 'Deep <b>one</b>', level: 4 } },
    ]);
  }, 60_000);

  it('header: toggleable header keeps its children', async () => {
    await compareFixture('header', [
      { id: 'h1', type: 'header', data: { text: 'Section', level: 3, isToggleable: true, isOpen: true } },
      { id: 'c1', type: 'paragraph', parent: 'h1', data: { text: 'Under the header' } },
    ]);
  }, 60_000);

  it('quote: inline content matches (legacy caption skipped — the editor migrates it to a separate block)', async () => {
    await compareFixture('quote', [
      { id: 'q1', type: 'quote', data: { text: 'Wise <b>words</b> here' } },
    ]);
  }, 60_000);

  it('code: content is entity-escaped identically', async () => {
    await compareFixture('code', [
      { id: 'c1', type: 'code', data: { code: 'if (a < b && c > d) { e("&"); }', language: 'js' } },
    ]);
  }, 60_000);

  it('divider: renders as content-free on both sides', async () => {
    const { viewRoot } = await compareFixture('divider', [
      { id: 'd1', type: 'divider', data: {} },
      { id: 'p1', type: 'paragraph', data: { text: 'After the divider' } },
    ]);

    expect(viewRoot.querySelector('hr')).not.toBeNull();
  }, 60_000);

  it('list: unordered with nesting, ordered, and checklist agree item by item', async () => {
    const { redactor, viewRoot } = await compareFixture('list', [
      { id: 'l1', type: 'list', data: { text: 'One <b>bold</b>', style: 'unordered' } },
      { id: 'l2', type: 'list', data: { text: 'Nested', style: 'unordered', depth: 1 } },
      { id: 'l3', type: 'list', data: { text: 'Two', style: 'unordered' } },
      { id: 'p0', type: 'paragraph', data: { text: 'break' } },
      { id: 'o1', type: 'list', data: { text: 'First', style: 'ordered' } },
      { id: 'o2', type: 'list', data: { text: 'Second', style: 'ordered' } },
      { id: 'k1', type: 'list', data: { text: 'Done', style: 'checklist', checked: true } },
      { id: 'k2', type: 'list', data: { text: 'Todo', style: 'checklist', checked: false } },
    ]);

    /** Checkbox state is attribute-borne (stripped from fragments) — compare it explicitly. */
    const editorChecks = Array.from(redactor.querySelectorAll('input[type="checkbox"]')).map((input) => (input as HTMLInputElement).checked);
    const viewChecks = Array.from(viewRoot.querySelectorAll('input[type="checkbox"]')).map((input) => input.hasAttribute('checked'));

    expect(editorChecks).toEqual([true, false]);
    expect(viewChecks).toEqual([true, false]);

    /** Nesting shape: the view nests item 2 one level deep. */
    expect(viewRoot.querySelector('li > ul > li')?.textContent).toBe('Nested');
  }, 60_000);

  it('callout: children render inside; the emoji is decoration on both sides', async () => {
    const { viewRoot } = await compareFixture('callout', [
      { id: 'ca1', type: 'callout', data: { emoji: '💡' } },
      { id: 'cp1', type: 'paragraph', parent: 'ca1', data: { text: 'Callout <i>body</i>' } },
      { id: 'cp2', type: 'paragraph', parent: 'ca1', data: { text: 'Second line' } },
    ]);

    expect(viewRoot.querySelector('aside')?.textContent).toContain('💡');
  }, 60_000);

  it('toggle: open and closed toggles both keep their children content', async () => {
    const { viewRoot } = await compareFixture('toggle', [
      { id: 't1', type: 'toggle', data: { text: 'Open toggle', isOpen: true } },
      { id: 'tp1', type: 'paragraph', parent: 't1', data: { text: 'Visible body' } },
      { id: 't2', type: 'toggle', data: { text: 'Closed toggle', isOpen: false } },
      { id: 'tp2', type: 'paragraph', parent: 't2', data: { text: 'Hidden body' } },
    ]);

    const details = Array.from(viewRoot.querySelectorAll('details'));

    expect(details.map((el) => el.hasAttribute('open'))).toEqual([true, false]);
  }, 60_000);

  it('table: headings, cell blocks, and a merged cell agree', async () => {
    const { redactor, viewRoot } = await compareFixture('table', [
      {
        id: 'tb1',
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ blocks: ['ha'] }, { blocks: ['hb'] }],
            [{ blocks: ['ba'], colspan: 2 }, { blocks: [], mergedInto: [1, 0] }],
            [{ blocks: ['ca'] }, { blocks: ['cb'] }],
          ],
        },
      },
      { id: 'ha', type: 'paragraph', parent: 'tb1', data: { text: 'Col A' } },
      { id: 'hb', type: 'paragraph', parent: 'tb1', data: { text: 'Col <b>B</b>' } },
      { id: 'ba', type: 'paragraph', parent: 'tb1', data: { text: 'Wide cell' } },
      { id: 'ca', type: 'paragraph', parent: 'tb1', data: { text: 'C' } },
      { id: 'cb', type: 'paragraph', parent: 'tb1', data: { text: '<i>D</i>' } },
    ]);

    /** colspan is attribute-borne on the cell (outside host fragments) — compare explicitly. */
    expect(redactor.querySelector('[colspan]')?.getAttribute('colspan')).toBe('2');
    expect(viewRoot.querySelector('[colspan]')?.getAttribute('colspan')).toBe('2');

    /** Heading semantics: the view renders the first row as thead > th. */
    expect(viewRoot.querySelectorAll('thead th').length).toBe(2);
    expect(redactor.querySelector('[data-blok-table-heading]')).not.toBeNull();
  }, 60_000);

  it('image: src/alt/caption agree', async () => {
    const { redactor, viewRoot } = await compareFixture('image', [
      { id: 'im1', type: 'image', data: { url: 'https://example.com/pic.png', caption: 'A <b>caption</b>', alt: 'Alt text' } },
    ]);

    const editorImg = redactor.querySelector('img');
    const viewImg = viewRoot.querySelector('img');

    expect(editorImg?.getAttribute('src')).toBe('https://example.com/pic.png');
    expect(viewImg?.getAttribute('src')).toBe('https://example.com/pic.png');
    expect(viewImg?.getAttribute('alt')).toBe('Alt text');
  }, 60_000);

  it('columns: column children render in order on both sides', async () => {
    await compareFixture('column_list', [
      { id: 'cl', type: 'column_list', data: {} },
      { id: 'colA', type: 'column', parent: 'cl', data: {} },
      { id: 'pA', type: 'paragraph', parent: 'colA', data: { text: 'Left <b>column</b>' } },
      { id: 'colB', type: 'column', parent: 'cl', data: {} },
      { id: 'pB', type: 'paragraph', parent: 'colB', data: { text: 'Right column' } },
    ]);
  }, 60_000);

  it('per-block plain text: each text block agrees with blocksToPlainText of that block alone', async () => {
    const blocks: OutputBlockData[] = [
      { id: 'x1', type: 'paragraph', data: { text: 'Alpha <b>beta</b>' } },
      { id: 'x2', type: 'header', data: { text: 'Gamma', level: 2 } },
      { id: 'x3', type: 'quote', data: { text: 'Delta' } },
      { id: 'x4', type: 'list', data: { text: 'Epsilon', style: 'unordered' } },
      { id: 'x5', type: 'code', data: { code: 'zeta();' } },
    ];
    const redactor = await renderInEditor(blocks);

    for (const block of blocks) {
      const blockHolder = redactor.querySelector(`[data-blok-id="${block.id}"]`);

      expect(blockHolder, `holder for ${block.id}`).not.toBeNull();

      const ownHosts = collectHosts(blockHolder as Element, true);
      const editorText = normalizeWhitespace(ownHosts.map((host) => host.textContent ?? '').join(' '));
      const viewText = normalizeWhitespace(blocksToPlainText({ blocks: [block] }));

      expect(editorText, `plain text of ${block.id}`).toBe(viewText);
    }
  }, 60_000);
});

describe('golden harness: sanitize composition end-to-end', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core !== undefined) {
      destroyCore(core);
      core = undefined;
    }
    holder.remove();
    vi.restoreAllMocks();
  });

  const HOSTILE_TEXT = 'Safe <b>bold</b> ' +
    '<mark style="background-color: var(--blok-color-red-bg); position: fixed;">colored</mark> ' +
    '<img src="https://example.com/x.png" onerror="alert(1)"> ' +
    '<script>alert(2)</script> ' +
    '<a href="javascript:alert(3)">bad link</a> ' +
    '<a href="https://ok.example">good link</a>';

  /**
   * Boot an editor with the given tools over one hostile paragraph and return
   * the normalized fragments from both pipelines under the SAME composed
   * schema (`defineBlokSchema` on the identical tools config).
   * @param tools - tools config shared by the editor and the view schema
   */
  const renderHostile = async (tools: Record<string, unknown>): Promise<{ editor: string; view: string }> => {
    const blocks: OutputBlockData[] = [{ id: 'hp1', type: 'paragraph', data: { text: HOSTILE_TEXT } }];

    core = new Core({
      holder,
      tools: tools as never,
      readOnly: true,
      data: { blocks },
    });
    await core.isReady;

    const redactor = holder.querySelector('[data-blok-redactor]') as Element;
    const viewRoot = parseViewHtml(blocksToHtml({ blocks }, { schema: defineBlokSchema({ tools: tools as never }).viewSchema }));

    const editorHosts = collectHosts(redactor);
    const viewHosts = collectHosts(viewRoot);

    expect(editorHosts.length).toBe(1);
    expect(viewHosts.length).toBe(1);

    return {
      editor: normalizeHostFragment(editorHosts[0]),
      view: normalizeHostFragment(viewHosts[0]),
    };
  };

  it('full config: dangerous content is stripped identically; the colored mark survives both', async () => {
    const { editor, view } = await renderHostile(fullTools);

    expect(view).toBe(editor);

    /** Both sides kept the mark with ONLY the color style (position: fixed stripped). */
    expect(editor).toContain('<mark style="background-color: var(--blok-color-red-bg)">');
    /** Neither side let the payloads through. */
    for (const fragment of [editor, view]) {
      expect(fragment).not.toContain('onerror');
      expect(fragment).not.toContain('alert(2)');
      expect(fragment).not.toContain('javascript:');
      expect(fragment).toContain('href="https://ok.example"');
    }
  }, 60_000);

  it('restricted config (paragraph + bold only): both pipelines agree on what survives', async () => {
    const restricted = {
      paragraph: { class: Paragraph, inlineToolbar: true },
      bold: { class: Bold },
    };

    const { editor, view } = await renderHostile(restricted);

    expect(view).toBe(editor);
    expect(editor).toContain('<b>bold</b>');
  }, 60_000);

  it('custom inline tool round-trip: content SAVED by a real editor renders through blocksToHtml under the same schema', async () => {
    /**
     * A consumer-registered inline tool whose sanitize tag is NOT in the
     * default inline map (the DescriptionColor scenario the design motivated):
     * the tag must survive the editor's save AND the view's display when both
     * resolve from one defineBlokSchema — "one map edit away" closed for real.
     */
    class SupInlineTool {
      public static isInline = true;
      public static title = 'Superscript';

      public static get sanitize(): Record<string, Record<string, never>> {
        return { sup: {} };
      }

      public render(): HTMLElement {
        return document.createElement('button');
      }
    }

    const tools = {
      paragraph: { class: Paragraph, inlineToolbar: true },
      sup: { class: SupInlineTool },
    };

    core = new Core({
      holder,
      tools,
      data: { blocks: [{ id: 'sp1', type: 'paragraph', data: { text: 'E = mc<sup>2</sup>' } }] },
    });
    await core.isReady;

    const saved = await core.moduleInstances.Saver.save();

    expect(saved).toBeDefined();
    expect(saved?.blocks[0]?.data.text).toContain('<sup>2</sup>');

    const schema = defineBlokSchema({ tools: tools as never }).viewSchema;
    const viewHtml = blocksToHtml(saved, { schema });

    expect(viewHtml).toBe('<p>E = mc<sup>2</sup></p>');
    /** Without the schema, the default inline map strips the custom tag — the schema is load-bearing. */
    expect(blocksToHtml(saved)).toBe('<p>E = mc2</p>');
  }, 60_000);
});

describe('golden harness: negative controls (the comparison is not vacuous)', () => {
  it('detects a planted tag mismatch', () => {
    const editorSide = parseViewHtml('<p>Hello <b>world</b></p>');
    const viewSide = parseViewHtml('<p>Hello <i>world</i></p>');

    expect(fragmentsDiff(collectHosts(editorSide), collectHosts(viewSide))).not.toBeNull();
  });

  it('detects a planted attribute mismatch (href tampering)', () => {
    const editorSide = parseViewHtml('<p><a href="https://real.example">x</a></p>');
    const viewSide = parseViewHtml('<p><a href="https://evil.example">x</a></p>');

    expect(fragmentsDiff(collectHosts(editorSide), collectHosts(viewSide))).not.toBeNull();
  });

  it('detects a planted host-count mismatch (a dropped block)', () => {
    const editorSide = parseViewHtml('<p>One</p><p>Two</p>');
    const viewSide = parseViewHtml('<p>One</p>');

    expect(fragmentsDiff(collectHosts(editorSide), collectHosts(viewSide))).not.toBeNull();
  });

  it('treats semantically identical spellings as equal (b/strong, em/i)', () => {
    const editorSide = parseViewHtml('<p><strong>x</strong> <em>y</em></p>');
    const viewSide = parseViewHtml('<p><b>x</b> <i>y</i></p>');

    expect(fragmentsDiff(collectHosts(editorSide), collectHosts(viewSide))).toBeNull();
  });

  it('non-vacuity floor: the corpus covered at least 8 distinct tools and 15 fragments', () => {
    expect(comparedTools.size, `compared tools: ${Array.from(comparedTools).join(', ')}`).toBeGreaterThanOrEqual(8);
    expect(comparedFragmentCount).toBeGreaterThanOrEqual(15);
  });
});
