/**
 * `htmlToBlocks` — DOM-free HTML → Blok document conversion, the inverse of
 * `blocksToHtml` and the twin of `markdownToBlocks`.
 *
 * Reads HTML with parse5 rather than a DOM, so it runs in bare Node, workers,
 * RSC and — the reason it exists — the Jint engine the `Blok.Server` NuGet
 * package embeds, which has no `document`, `window` or `DOMParser`.
 *
 * It deliberately covers the STRUCTURAL subset a document body is made of:
 * headings, paragraphs, lists, tables, images, links, code, blockquotes,
 * toggles and dividers. Anything outside that subset is reported through
 * {@link HtmlImportResult.warnings} rather than dropped in silence — a caller
 * storing the result has to be able to tell what did not survive.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*, parse5, and the
 * DOM-free leaves of src/markdown + src/components/utils/sanitize-url).
 */
import { parse, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

import type { OutputBlockData } from '../../types';
import type { ImageAlignment } from '../../types/tools/image';
import { INLINE_TEXT_SANITIZE } from '../components/shared/inline-content-sanitize';
import { safeImageSrc } from '../components/utils/sanitize-url';
import { normalizeFenceLang } from '../markdown/fence-language';
import type { MarkdownDegradation } from '../markdown/blocks-to-markdown-core';
import { sanitizeHtmlFragment } from './sanitize';

export type { MarkdownDegradation } from '../markdown/blocks-to-markdown-core';

type P5Element = DefaultTreeAdapterMap['element'];
type P5ChildNode = DefaultTreeAdapterMap['childNode'];

/** Blocks parsed out of HTML, plus everything the HTML could not carry into them. */
export interface HtmlImportResult {
  /** Blocks ready for `blok.blocks.render()`, `insertMany()`, or storage. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded or not at all, in document order. */
  warnings: MarkdownDegradation[];
}

/**
 * Tags whose content is machinery, not prose. Removed without a warning: a
 * caller told that a stylesheet did not become a block learns nothing.
 */
const SILENTLY_REMOVED = new Set(['script', 'style', 'template', 'link', 'meta', 'base', 'param', 'source', 'track', 'col', 'colgroup']);

/**
 * Tags that carry content Blok has no block for. Removed WITH a warning naming
 * the tag — this is the class of loss the whole report exists for.
 */
const DROPPED_WITH_WARNING = new Set([
  'iframe', 'video', 'audio', 'object', 'embed', 'canvas', 'svg', 'math',
  'form', 'input', 'button', 'select', 'textarea', 'output', 'progress',
  'meter', 'dialog', 'map', 'area', 'frame', 'frameset', 'applet', 'noscript',
]);

/** Containers with no meaning of their own: unwrapped, children converted in place. */
const TRANSPARENT = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'center',
  'hgroup', 'picture', 'address', 'fieldset', 'body', 'html',
]);

/**
 * Inline tags that survive into a block's stored `text`. Mirrors
 * {@link INLINE_TEXT_SANITIZE}, which is what actually enforces it.
 */
const KEPT_INLINE = new Set(['br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'a', 'code', 'mark', 'span']);

/**
 * Inline tags the sanitizer unwraps whose MEANING goes with them — `H<sub>2</sub>O`
 * and `H2O` do not say the same thing. Reported once per occurrence. Purely
 * presentational inline markup (`span`, `font`, `label`) is unwrapped without a
 * warning: its text survives intact, so nothing a reader can point at is lost.
 */
const LOSSY_INLINE = new Set(['sub', 'sup', 'ins', 'abbr', 'q', 'cite', 'kbd', 'samp', 'var', 'small', 'big', 'ruby', 'rt']);

/** Tags read as inline content when they appear beside text. */
const INLINE_TAGS = new Set([
  ...KEPT_INLINE, ...LOSSY_INLINE,
  'font', 'label', 'strike', 'tt', 'nobr', 'wbr', 'bdi', 'bdo', 'data', 'time', 'dfn',
]);

const HEADING = /^h([1-6])$/;

/** Everything one conversion shares. */
interface Ctx {
  nextId: () => string;
  warnings: MarkdownDegradation[];
  blocks: OutputBlockData[];
}

/**
 * Record one degradation.
 * @param ctx - conversion state
 * @param construct - the tag or construct that degraded
 * @param action - `dropped` when nothing was emitted, `degraded` when something lossy was
 * @param detail - plain-language explanation
 */
const warn = (ctx: Ctx, construct: string, action: 'dropped' | 'degraded', detail: string): void => {
  ctx.warnings.push({ construct, action, detail });
};

/**
 * Ids are scoped to one conversion, so two documents converted in the same
 * millisecond cannot collide through a shared counter.
 */
const createIdGenerator = (): () => string => {
  const prefix = `html-${Date.now().toString(36)}`;
  const state = { counter: 0 };

  return () => `${prefix}-${(state.counter++).toString(36)}`;
};

/**
 * @param node - node to test
 */
const isElement = (node: P5ChildNode): node is P5Element => 'tagName' in node;

/**
 * @param node - node to test
 */
const isText = (node: P5ChildNode): node is DefaultTreeAdapterMap['textNode'] => node.nodeName === '#text';

/**
 * @param node - element to read
 * @param name - attribute name
 */
const attr = (node: P5Element, name: string): string | undefined =>
  node.attrs.find((candidate) => candidate.name === name)?.value;

/**
 * @param node - node whose children are wanted
 */
const childrenOf = (node: P5ChildNode): P5ChildNode[] =>
  'childNodes' in node ? node.childNodes : [];

/**
 * Raw text of a subtree, entities already decoded by the tokenizer.
 * @param nodes - nodes to read
 */
const rawText = (nodes: P5ChildNode[]): string => nodes.map((node) => {
  if (isText(node)) {
    return node.value;
  }

  return 'childNodes' in node ? rawText(node.childNodes) : '';
}).join('');

/**
 * Serialize loose nodes by lending them a fragment to hang off. parse5's
 * serializer only ever reads `childNodes`, so the borrowed parent costs one
 * object rather than a re-parse.
 * @param nodes - nodes to serialize
 */
const serializeNodes = (nodes: P5ChildNode[]): string =>
  serialize({ nodeName: '#document-fragment', childNodes: nodes });

/**
 * Report the inline tags a sanitize pass is about to unwrap along with their
 * meaning. Walks before sanitizing, because afterwards there is nothing left to
 * see.
 * @param ctx - conversion state
 * @param nodes - the inline nodes about to be serialized
 */
const reportLossyInline = (ctx: Ctx, nodes: P5ChildNode[]): void => {
  for (const node of nodes) {
    if (!isElement(node)) {
      continue;
    }

    if (LOSSY_INLINE.has(node.tagName)) {
      warn(ctx, node.tagName, 'degraded', `<${node.tagName}> is unwrapped; its text is kept but Blok has no inline mark for it`);
    }

    reportLossyInline(ctx, node.childNodes);
  }
};

/**
 * Inline nodes as the HTML string Blok stores in a block's `text`.
 * @param ctx - conversion state
 * @param nodes - inline nodes
 */
const inlineHtml = (ctx: Ctx, nodes: P5ChildNode[]): string => {
  reportLossyInline(ctx, nodes);

  return sanitizeHtmlFragment(serializeNodes(nodes), INLINE_TEXT_SANITIZE).trim();
};

/**
 * @param ctx - conversion state
 * @param type - block type
 * @param data - block data
 */
const push = (ctx: Ctx, type: string, data: Record<string, unknown>): OutputBlockData => {
  const block: OutputBlockData = { id: ctx.nextId(), type, data };

  ctx.blocks.push(block);

  return block;
};

/**
 * Whether a node is inline content rather than a block of its own. An unknown
 * tag counts as a block, so a wrapper nobody has heard of still gets reported
 * instead of being silently folded into a paragraph.
 * @param node - node to classify
 */
const isInline = (node: P5ChildNode): boolean => {
  if (isText(node)) {
    return true;
  }

  return isElement(node) && INLINE_TAGS.has(node.tagName);
};

/**
 * An element's inline style, keyed by property. Both halves are lower-cased,
 * so a declaration only has to be compared one way.
 * @param element - element to read
 */
const styleOf = (element: P5Element): Map<string, string> => {
  const declarations = (attr(element, 'style') ?? '').toLowerCase().split(';');

  return new Map(declarations.flatMap((declaration): Array<[string, string]> => {
    const colon = declaration.indexOf(':');

    return colon === -1 ? [] : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]];
  }));
};

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/**
 * A CSS width as `ImageData.width` stores it — a percent of the container,
 * 10–100. Anything else reads as no width at all, a px length included: the
 * container is not knowable from the HTML, and dividing by a guessed one puts
 * the result outside the range the field allows.
 * @param raw - a declaration value or an attribute value
 */
const percentWidth = (raw: string | undefined): number | null => {
  const match = PERCENT.exec((raw ?? '').trim());

  if (match === null) {
    return null;
  }

  const percent = Math.round(Number(match[1]));

  return percent >= 10 && percent <= 100 ? percent : null;
};

/**
 * The left and right margins in force, the shorthand resolved the way CSS
 * reads it and the longhands laid over it.
 * @param style - the element's inline style
 */
const marginSides = (style: Map<string, string>): { left: string; right: string } => {
  const parts = (style.get('margin') ?? '').split(/\s+/).filter((part) => part !== '');
  const sides = parts[1] ?? parts[0] ?? '';

  return {
    left: style.get('margin-left') ?? parts[3] ?? sides,
    right: style.get('margin-right') ?? sides,
  };
};

/**
 * Alignment the margins imply: two `auto` sides centre the box, one `auto`
 * side pushes it to the other one.
 * @param style - the element's inline style
 */
const marginAlignment = (style: Map<string, string>): ImageAlignment | null => {
  const { left, right } = marginSides(style);

  if (left === 'auto') {
    return right === 'auto' ? 'center' : 'right';
  }

  return right === 'auto' ? 'left' : null;
};

/** The `align` values that map onto an {@link ImageAlignment}; `justify` and `middle` do not. */
const LEGACY_ALIGN = new Map<string, ImageAlignment>([['left', 'left'], ['center', 'center'], ['right', 'right']]);

/**
 * Horizontal alignment of an image, read from the CSS that carries it and only
 * then from the presentational attribute that CSS would have overridden.
 * @param element - the `img` element
 * @param style - the element's inline style
 */
const imageAlignment = (element: P5Element, style: Map<string, string>): ImageAlignment | null => {
  const float = style.get('float');

  if (float === 'left' || float === 'right') {
    return float;
  }

  const legacy = (attr(element, 'align') ?? '').trim().toLowerCase();

  return marginAlignment(style) ?? LEGACY_ALIGN.get(legacy) ?? null;
};

/**
 * An image's block data, or null when the source is missing or unsafe.
 * @param element - the `img` element
 * @param caption - caption text overriding the element's own alt
 */
const imageData = (element: P5Element, caption?: string): Record<string, unknown> | null => {
  const src = (attr(element, 'src') ?? '').trim();
  const url = src === '' ? null : safeImageSrc(src);

  if (url === null) {
    return null;
  }

  const text = caption ?? attr(element, 'alt') ?? '';
  const style = styleOf(element);
  const data: Record<string, unknown> = text === '' ? { url } : { url, caption: text, alt: text };
  const width = percentWidth(style.get('width')) ?? percentWidth(attr(element, 'width'));
  const alignment = imageAlignment(element, style);

  if (width !== null) {
    data.width = width;
  }

  if (alignment !== null) {
    data.alignment = alignment;
  }

  return data;
};

/**
 * Emit an image block, reporting an image whose source cannot be used.
 * @param ctx - conversion state
 * @param element - the `img` element
 * @param caption - caption text overriding the element's own alt
 */
const emitImage = (ctx: Ctx, element: P5Element, caption?: string): void => {
  const data = imageData(element, caption);

  if (data === null) {
    warn(ctx, 'img', 'dropped', 'The image has no usable src; Blok cannot store an image without one');

    return;
  }

  push(ctx, 'image', data);
};

/**
 * Whether an `img` sits anywhere under a node. An inline wrapper holding one —
 * `<a>`, or the sized `<span>` a Docs export writes — has to be taken apart,
 * because the inline sanitizer keeps the wrapper and strips the image.
 * @param node - node to search
 */
const hasImage = (node: P5ChildNode): boolean =>
  childrenOf(node).some((child) => (isElement(child) && child.tagName === 'img') || hasImage(child));

/**
 * Report the link an image wrapper carries, which the image it wraps cannot
 * keep — Blok's image block has no link field.
 * @param ctx - conversion state
 * @param element - the inline element wrapping an image
 */
const reportImageLink = (ctx: Ctx, element: P5Element): void => {
  if (element.tagName === 'a' && (attr(element, 'href') ?? '').trim() !== '') {
    warn(ctx, 'a', 'degraded', 'A link around an image is dropped and the image kept; Blok\'s image block has no link field');
  }
};

/** One piece a run of inline nodes splits into, in document order. */
type InlineSegment = { image: P5Element } | { block: P5Element } | { inline: P5ChildNode[] };

/**
 * Split a run of inline nodes on the images inside it, so a paragraph that
 * mixes prose and an image yields both rather than losing the image to the
 * inline sanitizer, which has no `img` rule.
 * @param ctx - conversion state
 * @param nodes - inline nodes
 */
const splitOnImages = (ctx: Ctx, nodes: P5ChildNode[]): InlineSegment[] => {
  const segments: InlineSegment[] = [];
  const pending: { run: P5ChildNode[] } = { run: [] };

  /** Close the run of inline nodes collected so far. */
  const flush = (): void => {
    if (pending.run.length > 0) {
      segments.push({ inline: pending.run });
      pending.run = [];
    }
  };

  /**
   * Fold a wrapper's own parts into this run, re-wrapping the inline ones so
   * `<b>text <img></b>` keeps its bold on the text. The clone borrows the
   * wrapper's tag and attributes, which is all the serializer reads.
   * @param wrapper - the inline element being taken apart
   * @param parts - what its children split into
   */
  const absorb = (wrapper: P5Element, parts: InlineSegment[]): void => {
    for (const part of parts) {
      if ('inline' in part) {
        pending.run.push({ ...wrapper, childNodes: part.inline });
        continue;
      }

      flush();
      segments.push(part);
    }
  };

  for (const node of nodes) {
    if (isElement(node) && node.tagName === 'img') {
      flush();
      segments.push({ image: node });
      continue;
    }

    if (isElement(node) && !INLINE_TAGS.has(node.tagName)) {
      // Hoisted whole rather than walked: `convertElement` is the only place
      // that knows an element is dropped, so walking past it drops it silently.
      flush();
      segments.push({ block: node });
      continue;
    }

    if (isElement(node) && hasImage(node)) {
      reportImageLink(ctx, node);
      absorb(node, splitOnImages(ctx, node.childNodes));
      continue;
    }

    pending.run.push(node);
  }

  flush();

  return segments;
};

/**
 * Emit the non-text segments of an inline run, for a caller that has already
 * taken the text for a field of its own.
 * @param ctx - conversion state
 * @param segments - what the run split into
 */
const emitSegmentMedia = (ctx: Ctx, segments: InlineSegment[]): void => {
  for (const segment of segments) {
    if ('image' in segment) {
      emitImage(ctx, segment.image);
      continue;
    }

    if ('block' in segment) {
      convertNodes(ctx, [segment.block]);
    }
  }
};

/**
 * Emit the blocks a run of inline content amounts to: one paragraph, or a
 * paragraph/image sequence when images are mixed in.
 * @param ctx - conversion state
 * @param nodes - inline nodes
 * @param type - block type for the text segments
 * @param extra - extra data merged into each text block
 */
const emitInlineRun = (
  ctx: Ctx,
  nodes: P5ChildNode[],
  type = 'paragraph',
  extra: Record<string, unknown> = {}
): void => {
  for (const segment of splitOnImages(ctx, nodes)) {
    if ('image' in segment) {
      emitImage(ctx, segment.image);
      continue;
    }

    if ('block' in segment) {
      convertNodes(ctx, [segment.block]);
      continue;
    }

    const text = inlineHtml(ctx, segment.inline);

    if (text !== '') {
      push(ctx, type, { text, ...extra });
    }
  }
};

/**
 * The language a `pre` declares, through its own class or its `code` child's.
 * @param element - the `pre` element
 */
const codeLanguage = (element: P5Element): string => {
  const code = element.childNodes.find((node): node is P5Element => isElement(node) && node.tagName === 'code');
  const classes = `${attr(element, 'class') ?? ''} ${code === undefined ? '' : attr(code, 'class') ?? ''}`;
  const match = /(?:^|\s)(?:language|lang|highlight)-([\w+#-]+)/.exec(classes);
  const raw = match?.[1] ?? '';

  return normalizeFenceLang(raw) ?? (raw === '' ? 'plain text' : raw);
};

/** Elements a blockquote unwraps into its own text, the way a browser lays them out. */
const QUOTE_UNWRAPPED = new Set([...TRANSPARENT, 'p']);

/**
 * Group a blockquote's children into the runs its text is built from: adjacent
 * inline nodes read as one run, a paragraph or wrapper contributes its own
 * children, and anything else stays whole so `splitOnImages` hoists it out
 * rather than folding it into a field that cannot hold it.
 * @param nodes - the blockquote's children
 */
const quoteRuns = (nodes: P5ChildNode[]): P5ChildNode[][] => {
  const runs: P5ChildNode[][] = [];
  const pending: { run: P5ChildNode[] } = { run: [] };

  /** Close the run of inline nodes collected so far. */
  const flush = (): void => {
    if (pending.run.length > 0) {
      runs.push(pending.run);
      pending.run = [];
    }
  };

  for (const node of nodes) {
    if (isInline(node)) {
      pending.run.push(node);
      continue;
    }

    flush();
    runs.push(isElement(node) && (QUOTE_UNWRAPPED.has(node.tagName) || HEADING.test(node.tagName))
      ? node.childNodes
      : [node]);
  }

  flush();

  return runs;
};

/**
 * Convert a blockquote. Its paragraphs join with `<br>`, matching the Markdown
 * importer — Blok's quote holds one inline field, not a block list. What that
 * field cannot hold follows the quote as blocks of its own, and a quote left
 * with no text at all is not emitted.
 * @param ctx - conversion state
 * @param element - the `blockquote` element
 */
const emitQuote = (ctx: Ctx, element: P5Element): void => {
  const segments = quoteRuns(element.childNodes).flatMap((run) => splitOnImages(ctx, run));
  const text = segments
    .flatMap((segment) => 'inline' in segment ? [inlineHtml(ctx, segment.inline)] : [])
    .filter((part) => part !== '')
    .join('<br>');

  if (text !== '') {
    push(ctx, 'quote', { text, size: 'default' });
  }

  emitSegmentMedia(ctx, segments);
};

/**
 * Convert `details` into a toggle whose body blocks reference it as `parent`.
 * A toggle's title is one inline field, so an image the summary carries opens
 * the body instead, where it stays attached to the toggle.
 * @param ctx - conversion state
 * @param element - the `details` element
 */
const emitToggle = (ctx: Ctx, element: P5Element): void => {
  const summary = element.childNodes.find((node): node is P5Element => isElement(node) && node.tagName === 'summary');
  const segments = summary === undefined ? [] : splitOnImages(ctx, summary.childNodes);
  const toggle = push(ctx, 'toggle', {
    text: inlineHtml(ctx, segments.flatMap((segment) => 'inline' in segment ? segment.inline : [])),
    isOpen: attr(element, 'open') !== undefined,
  });

  const body = element.childNodes.filter((node) => node !== summary);
  const before = ctx.blocks.length;

  emitSegmentMedia(ctx, segments);
  convertNodes(ctx, body);

  for (const block of ctx.blocks.slice(before)) {
    if (block.parent === undefined) {
      block.parent = toggle.id;
    }
  }
};

/** One list item, split into the parts a Blok list block is built from. */
interface ListItemParts {
  inline: P5ChildNode[];
  blocks: P5ChildNode[];
  nested: P5Element[];
  checkbox: P5Element | undefined;
}

/**
 * Split a list item's children into its own text, its nested lists, and the
 * block-level content that becomes sibling blocks after it.
 * @param item - the `li` element
 */
const splitListItem = (item: P5Element): ListItemParts => {
  const parts: ListItemParts = { inline: [], blocks: [], nested: [], checkbox: undefined };

  for (const node of item.childNodes) {
    if (isElement(node) && (node.tagName === 'ul' || node.tagName === 'ol')) {
      parts.nested.push(node);
      continue;
    }

    if (isElement(node) && node.tagName === 'input' && attr(node, 'type') === 'checkbox') {
      parts.checkbox = node;
      continue;
    }

    if (isInline(node)) {
      parts.inline.push(node);
      continue;
    }

    parts.blocks.push(node);
  }

  /**
   * An item written as `<li><p>text</p></li>` says the same thing as
   * `<li>text</li>`, so its lone paragraph becomes the item's text rather than
   * a stray block after it.
   */
  const [first] = parts.blocks;

  if (rawText(parts.inline).trim() === '' && first !== undefined && isElement(first) && first.tagName === 'p') {
    parts.inline = first.childNodes;
    parts.blocks = parts.blocks.slice(1);
  }

  return parts;
};

/**
 * Convert a `ul`/`ol` into Blok's flat list blocks.
 * @param ctx - conversion state
 * @param element - the list element
 * @param depth - nesting level, 0 at the root
 */
const emitList = (ctx: Ctx, element: P5Element, depth: number): void => {
  const ordered = element.tagName === 'ol';
  const bulletStyle = ordered ? 'ordered' : 'unordered';
  const start = Number(attr(element, 'start'));
  const firstItem = element.childNodes.find(
    (node): node is P5Element => isElement(node) && node.tagName === 'li'
  );

  for (const node of element.childNodes) {
    if (!isElement(node)) {
      continue;
    }

    /**
     * A `ul`/`ol` that is a SIBLING of the items rather than a child of one:
     * what HTML5 parsing makes of the unclosed-`li` nesting legacy editors
     * emit. A browser renders it one level in, so it is imported that way.
     */
    if (node.tagName === 'ul' || node.tagName === 'ol') {
      emitList(ctx, node, depth + 1);
      continue;
    }

    if (node.tagName !== 'li') {
      continue;
    }

    const parts = splitListItem(node);
    const style = parts.checkbox === undefined ? bulletStyle : 'checklist';

    /**
     * An item's text is one field, so an image the inline nodes carry cannot
     * stay in it. It is lifted out and emitted after the item, the way a block
     * child of the item already is.
     */
    const segments = splitOnImages(ctx, parts.inline);
    const data: Record<string, unknown> = {
      text: inlineHtml(ctx, segments.flatMap((segment) => 'inline' in segment ? segment.inline : [])),
      style,
      depth,
    };

    if (parts.checkbox !== undefined) {
      data.checked = attr(parts.checkbox, 'checked') !== undefined;
    }

    if (ordered && node === firstItem && Number.isInteger(start)) {
      data.start = start;
    }

    push(ctx, 'list', data);
    emitSegmentMedia(ctx, segments);
    convertNodes(ctx, parts.blocks);

    for (const nested of parts.nested) {
      emitList(ctx, nested, depth + 1);
    }
  }
};

/** A cell as Blok stores it. */
interface GridCell {
  blocks: string[];
  colspan?: number;
  rowspan?: number;
  mergedInto?: [number, number];
}

/**
 * Every `tr` under a table, in document order, reading through
 * `thead`/`tbody`/`tfoot`.
 * @param element - the `table` element
 */
const tableRows = (element: P5Element): P5Element[] => {
  const rows: P5Element[] = [];

  /**
   * @param nodes - nodes to walk
   */
  const walk = (nodes: P5ChildNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) {
        continue;
      }

      if (node.tagName === 'tr') {
        rows.push(node);
        continue;
      }

      if (node.tagName === 'thead' || node.tagName === 'tbody' || node.tagName === 'tfoot') {
        walk(node.childNodes);
      }
    }
  };

  walk(element.childNodes);

  return rows;
};

/**
 * @param row - a `tr` element
 */
const rowCells = (row: P5Element): P5Element[] =>
  row.childNodes.filter((node): node is P5Element => isElement(node) && (node.tagName === 'td' || node.tagName === 'th'));

/**
 * Read a span attribute, clamped to something a grid can be built from.
 * @param cell - the cell element
 * @param name - `colspan` or `rowspan`
 */
const spanOf = (cell: P5Element, name: 'colspan' | 'rowspan'): number => {
  const value = Number.parseInt(attr(cell, name) ?? '', 10);

  return Number.isInteger(value) && value > 1 ? Math.min(value, 1000) : 1;
};

/**
 * Convert a table into a table block plus the cell blocks it references, which
 * are siblings carrying `parent` = the table's id.
 * @param ctx - conversion state
 * @param element - the `table` element
 */
const emitTable = (ctx: Ctx, element: P5Element): void => {
  const rows = tableRows(element);
  const caption = element.childNodes.find((node): node is P5Element => isElement(node) && node.tagName === 'caption');

  if (caption !== undefined) {
    warn(ctx, 'caption', 'degraded', 'A table caption leads the table as a paragraph; Blok\'s table has no caption field');
    emitInlineRun(ctx, caption.childNodes);
  }

  const table = push(ctx, 'table', {});
  const grid: Array<Array<GridCell | undefined>> = rows.map(() => []);

  /**
   * @param index - row index to guarantee exists
   */
  const rowAt = (index: number): Array<GridCell | undefined> => {
    while (grid.length <= index) {
      grid.push([]);
    }

    return grid[index];
  };

  /**
   * Reserve the area a spanning cell covers, so the cells after it in later
   * rows land in the column they actually occupy.
   * @param origin - [row, column] of the merge origin
   * @param colspan - columns the origin covers
   * @param rowspan - rows the origin covers
   */
  const cover = (origin: [number, number], colspan: number, rowspan: number): void => {
    const [originRow, originColumn] = origin;
    const offsets = Array.from({ length: rowspan }, (_, r) => r)
      .flatMap((r) => Array.from({ length: colspan }, (_, c) => [r, c] as const))
      .filter(([r, c]) => r !== 0 || c !== 0);

    for (const [r, c] of offsets) {
      rowAt(originRow + r)[originColumn + c] = { blocks: [], mergedInto: [originRow, originColumn] };
    }
  };

  /**
   * Convert one cell into the blocks it owns and the grid entry referencing them.
   * @param cell - the `td`/`th` element
   * @returns ids of the blocks the cell owns
   */
  const cellBlockIds = (cell: P5Element): string[] => {
    const before = ctx.blocks.length;

    convertCell(ctx, cell);

    const owned = ctx.blocks.slice(before);

    for (const block of owned) {
      block.parent ??= table.id;
    }

    return owned
      .filter((block) => block.parent === table.id)
      .map((block) => block.id)
      .filter((id): id is string => id !== undefined);
  };

  /**
   * Place every cell of one row, skipping the columns a cell above already covers.
   * @param row - the `tr` element
   * @param rowIndex - its index among the table's rows
   */
  const placeRow = (row: P5Element, rowIndex: number): void => {
    const cursor = { column: 0 };

    for (const cell of rowCells(row)) {
      while (rowAt(rowIndex)[cursor.column] !== undefined) {
        cursor.column += 1;
      }

      const colspan = spanOf(cell, 'colspan');
      const rowspan = spanOf(cell, 'rowspan');
      const blocks = cellBlockIds(cell);

      rowAt(rowIndex)[cursor.column] = {
        blocks,
        ...(colspan > 1 ? { colspan } : {}),
        ...(rowspan > 1 ? { rowspan } : {}),
      };

      cover([rowIndex, cursor.column], colspan, rowspan);
      cursor.column += colspan;
    }
  };

  rows.forEach(placeRow);

  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0);
  const content = grid.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? { blocks: [] }));
  const headRow = element.childNodes.some((node) => isElement(node) && node.tagName === 'thead' && rowCells(node).length + tableRows(node).length > 0);
  const allTh = (row: P5Element): boolean => {
    const cells = rowCells(row);

    return cells.length > 0 && cells.every((cell) => cell.tagName === 'th');
  };

  table.data = {
    withHeadings: headRow || (rows.length > 1 && rows[0] !== undefined && allTh(rows[0])),
    withHeadingColumn: rows.length > 1 && rows.every((row) => rowCells(row)[0]?.tagName === 'th'),
    content,
  };
};

/**
 * Convert one cell's content. A cell holds blocks, so a paragraph, list or
 * image inside it converts normally; a nested table does not, because its own
 * cells would need a second level of parenting Blok's grid cannot express.
 * @param ctx - conversion state
 * @param cell - the `td`/`th` element
 */
const convertCell = (ctx: Ctx, cell: P5Element): void => {
  const nested = cell.childNodes.filter((node): node is P5Element => isElement(node) && node.tagName === 'table');

  if (nested.length === 0) {
    const before = ctx.blocks.length;

    convertNodes(ctx, cell.childNodes);

    if (ctx.blocks.length === before) {
      push(ctx, 'paragraph', { text: '' });
    }

    return;
  }

  warn(ctx, 'table', 'degraded', 'A nested table is flattened into the cell\'s paragraphs; a Blok cell holds blocks, not another grid');

  convertNodes(ctx, cell.childNodes.filter((node) => !nested.includes(node as P5Element)));

  const innerCells = nested.flatMap((inner) => tableRows(inner).flatMap(rowCells));

  for (const innerCell of innerCells) {
    emitInlineRun(ctx, innerCell.childNodes);
  }
};

/**
 * Convert a `figure`: an image with its caption when it holds one, otherwise
 * just its children.
 * @param ctx - conversion state
 * @param element - the `figure` element
 */
const emitFigure = (ctx: Ctx, element: P5Element): void => {
  const images: P5Element[] = [];
  const found: { caption: P5Element | undefined } = { caption: undefined };

  /**
   * @param nodes - nodes to walk
   */
  const walk = (nodes: P5ChildNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) {
        continue;
      }

      if (node.tagName === 'img') {
        images.push(node);
      } else if (node.tagName === 'figcaption') {
        found.caption ??= node;
      } else {
        walk(node.childNodes);
      }
    }
  };

  walk(element.childNodes);

  if (images.length !== 1) {
    convertNodes(ctx, element.childNodes);

    return;
  }

  const { caption } = found;
  // A caption is one plain-text field: an image inside it follows the figure.
  const segments = caption === undefined ? [] : splitOnImages(ctx, caption.childNodes);
  const text = rawText(segments.flatMap((segment) => 'inline' in segment ? segment.inline : [])).trim();

  emitImage(ctx, images[0], text === '' ? undefined : text);
  emitSegmentMedia(ctx, segments);
};

/**
 * Convert an element with no block handler of its own: recurse when it holds
 * block content, read it as a paragraph when it holds only inline content.
 * @param ctx - conversion state
 * @param element - the element to flatten
 */
const flatten = (ctx: Ctx, element: P5Element): void => {
  if (element.childNodes.some((node) => !isInline(node))) {
    convertNodes(ctx, element.childNodes);

    return;
  }

  emitInlineRun(ctx, element.childNodes);
};

/**
 * Convert one element.
 * @param ctx - conversion state
 * @param element - the element to convert
 */
const convertElement = (ctx: Ctx, element: P5Element): void => {
  const tag = element.tagName;

  if (SILENTLY_REMOVED.has(tag)) {
    return;
  }

  if (DROPPED_WITH_WARNING.has(tag)) {
    warn(ctx, tag, 'dropped', `<${tag}> and its contents are dropped; Blok has no block for it`);

    return;
  }

  const heading = HEADING.exec(tag);

  if (heading !== null) {
    emitInlineRun(ctx, element.childNodes, 'header', { level: Number(heading[1]) });

    return;
  }

  switch (tag) {
    case 'p':
      emitInlineRun(ctx, element.childNodes);

      return;
    case 'hr':
      push(ctx, 'divider', {});

      return;
    case 'br':
      return;
    case 'img':
      emitImage(ctx, element);

      return;
    case 'pre':
      push(ctx, 'code', { code: rawText(element.childNodes).replace(/\n$/, ''), language: codeLanguage(element) });

      return;
    case 'blockquote':
      emitQuote(ctx, element);

      return;
    case 'ul':
    case 'ol':
      emitList(ctx, element, 0);

      return;
    case 'table':
      emitTable(ctx, element);

      return;
    case 'details':
      emitToggle(ctx, element);

      return;
    case 'figure':
      emitFigure(ctx, element);

      return;
    case 'dl':
      warn(ctx, 'dl', 'degraded', 'A definition list becomes plain paragraphs; Blok has no term/definition block');
      convertNodes(ctx, element.childNodes);

      return;
    case 'aside':
      warn(ctx, 'aside', 'degraded', '<aside> becomes plain blocks; Blok\'s callout is not inferred from markup');
      convertNodes(ctx, element.childNodes);

      return;
    default:
      break;
  }

  if (TRANSPARENT.has(tag) || tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'summary' || tag === 'figcaption') {
    flatten(ctx, element);

    return;
  }

  warn(ctx, tag, 'degraded', `<${tag}> has no Blok block; its content is flattened into paragraphs`);
  flatten(ctx, element);
};

/**
 * Convert a run of sibling nodes, gathering the inline ones between block
 * elements into paragraphs of their own.
 * @param ctx - conversion state
 * @param nodes - the nodes to convert
 */
function convertNodes(ctx: Ctx, nodes: P5ChildNode[]): void {
  const pending: { run: P5ChildNode[] } = { run: [] };

  /** Close the run of loose inline nodes collected so far. */
  const flush = (): void => {
    if (pending.run.length > 0) {
      emitInlineRun(ctx, pending.run);
      pending.run = [];
    }
  };

  for (const node of nodes) {
    if (node.nodeName === '#comment') {
      continue;
    }

    if (isInline(node)) {
      pending.run.push(node);
      continue;
    }

    flush();

    if (isElement(node)) {
      convertElement(ctx, node);
    }
  }

  flush();
}

/**
 * Report a document title, which is metadata about the document rather than
 * content in it — a Blok document has nowhere to put one.
 * @param ctx - conversion state
 * @param head - the parsed `head` element
 */
const reportTitle = (ctx: Ctx, head: P5ChildNode | undefined): void => {
  const title = childrenOf(head ?? { nodeName: '#text' } as P5ChildNode)
    .find((node): node is P5Element => isElement(node) && node.tagName === 'title');

  if (title !== undefined && rawText(title.childNodes).trim() !== '') {
    warn(ctx, 'title', 'dropped', 'The document title is not imported; a Blok document has no title field');
  }
};

/**
 * Parse HTML into Blok blocks and report what it could not carry into them.
 *
 * Takes either a fragment (`<p>a</p>`) or a whole document — parse5 builds the
 * same `html > head + body` tree for both, and only the body is converted.
 *
 * @param html - the HTML source
 * @returns the blocks and their degradations
 */
export const htmlToBlocksWithReport = (html: string): HtmlImportResult => {
  const ctx: Ctx = { nextId: createIdGenerator(), warnings: [], blocks: [] };
  const document = parse(html);
  const root = document.childNodes.find((node): node is P5Element => isElement(node) && node.tagName === 'html');
  const head = root?.childNodes.find((node) => isElement(node) && node.tagName === 'head');
  const body = root?.childNodes.find((node): node is P5Element => isElement(node) && node.tagName === 'body');

  reportTitle(ctx, head);

  if (body !== undefined) {
    convertNodes(ctx, body.childNodes);
  }

  return { blocks: ctx.blocks, warnings: ctx.warnings };
};

/**
 * Parse HTML into Blok blocks.
 *
 * Reach for {@link htmlToBlocksWithReport} when the caller has to be told what
 * the HTML could not carry — storing the result without reading the report is
 * how content goes missing quietly.
 *
 * @param html - the HTML source
 * @returns blocks ready for `blok.blocks.render()` or storage
 */
export const htmlToBlocks = (html: string): OutputBlockData[] => htmlToBlocksWithReport(html).blocks;
