import type { Root, Nodes, List, ListItem, PhrasingContent, Table, Blockquote, RootContent, Definition } from 'mdast';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { MarkdownImportConfig } from './types';
import { safeImageSrc } from '../components/utils/sanitize-url';
import { phrasingToHtml } from './phrasing-to-html';
import type { DefinitionMap } from './phrasing-to-html';
import { normalizeFenceLang } from './fence-language';

/** Everything one `mdastToBlocks` call shares with every node handler. */
interface ConvertContext {
  config: MarkdownImportConfig;
  generateId: () => string;
  definitions: DefinitionMap;
}

/**
 * Creates a scoped ID generator. Each call to mdastToBlocks gets a fresh generator.
 */
function createIdGenerator(): () => string {
  const prefix = `md-${Date.now().toString(36)}`;
  const state = { counter: 0 };

  return () => `${prefix}-${(state.counter++).toString(36)}`;
}

/**
 * Collect every link/image definition in the tree.
 *
 * A definition may sit anywhere — after the references that use it, or inside a
 * blockquote or list item — so the whole tree is walked before any node is
 * converted. Mirrors the prepass in `markdownToHtml.ts`.
 */
function collectDefinitions(tree: Root): DefinitionMap {
  const definitions = new Map<string, Definition>();

  /**
   * Visit one node and its children.
   * @param node - the node to visit
   */
  const visit = (node: RootContent): void => {
    if (node.type === 'definition') {
      definitions.set(node.identifier, node);
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  tree.children.forEach(visit);

  return definitions;
}

/**
 * Convert an mdast tree to an array of Blok OutputBlockData.
 */
export function mdastToBlocks(tree: Root, config: MarkdownImportConfig = {}): OutputBlockData[] {
  const ctx: ConvertContext = {
    config,
    generateId: createIdGenerator(),
    definitions: collectDefinitions(tree),
  };

  return convertNodes(tree.children, ctx, 0);
}

function convertNodes(
  nodes: RootContent[],
  ctx: ConvertContext,
  listDepth: number,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];

  for (const node of nodes) {
    const result = convertNode(node, ctx, listDepth);

    if (result) {
      blocks.push(...result);
    }
  }

  return blocks;
}

function convertNode(
  node: RootContent,
  ctx: ConvertContext,
  listDepth: number,
): OutputBlockData[] | null {
  // 1. Check toolMap first
  if (ctx.config.toolMap?.[node.type]) {
    return handleToolMap(node, ctx);
  }

  // 2. Built-in handlers
  const builtInResult = handleBuiltInNode(node, ctx, listDepth);

  if (builtInResult !== undefined) {
    return builtInResult;
  }

  // 3. onUnknownNode hook
  if (ctx.config.onUnknownNode) {
    return tryOnUnknownNode(ctx.config.onUnknownNode, node);
  }

  // 4. Fallback: extract any text content as paragraph
  if ('value' in node && typeof node.value === 'string') {
    return [makeParagraph(escapeHtml(node.value), ctx.generateId)];
  }

  return null;
}

/**
 * Handle built-in node types. Returns undefined if node type is not built-in.
 */
function handleBuiltInNode(
  node: RootContent,
  ctx: ConvertContext,
  listDepth: number,
): OutputBlockData[] | null | undefined {
  if (node.type === 'paragraph') {
    return handleParagraph(node.children, ctx);
  }

  if (node.type === 'heading') {
    return [makeBlock('header', { text: phrasingToHtml(node.children, ctx.definitions), level: node.depth }, ctx.generateId)];
  }

  if (node.type === 'thematicBreak') {
    return [makeBlock('divider', {}, ctx.generateId)];
  }

  if (node.type === 'list') {
    return handleList(node, ctx, listDepth);
  }

  if (node.type === 'blockquote') {
    return handleBlockquote(node, ctx);
  }

  if (node.type === 'table') {
    return handleTable(node, ctx);
  }

  if (node.type === 'code') {
    const rawLang = node.lang ?? '';

    return [makeBlock('code', {
      code: node.value,
      // Unknown languages keep their raw label rather than collapsing to
      // "plain text" — the fence still says what the snippet is.
      language: normalizeFenceLang(rawLang) ?? (rawLang || 'plain text'),
    }, ctx.generateId)];
  }

  if (node.type === 'math') {
    return [makeBlock('code', { code: node.value, language: 'latex' }, ctx.generateId)];
  }

  if (node.type === 'html') {
    return handleFallback(node, ctx, escapeHtml(node.value));
  }

  return undefined;
}

type ParagraphChild = { type: string; value?: string; children?: unknown[] };

/** Source and alt text of the single image a paragraph consists of. */
interface StandaloneImage {
  url: string;
  alt: string;
}

/**
 * Pair a URL with its alt text once the URL is known safe.
 *
 * @param rawUrl - the URL written in the Markdown
 * @param alt - the image's alt text, if any
 */
function safeStandaloneImage(rawUrl: string, alt: string | null | undefined): StandaloneImage | null {
  const url = safeImageSrc(rawUrl);

  return url === null ? null : { url, alt: alt ?? '' };
}

/**
 * The image a paragraph consists of, ignoring whitespace around it.
 *
 * Returns null when the paragraph mixes an image with other content, when a
 * reference-style image has no definition, and when the URL carries an unsafe
 * scheme — all three keep the plain-paragraph behaviour.
 *
 * @param children - the paragraph's phrasing children
 * @param definitions - definitions a reference-style image resolves against
 */
function soleImage(children: PhrasingContent[], definitions: DefinitionMap): StandaloneImage | null {
  const meaningful = children.filter((child) => child.type !== 'text' || child.value.trim() !== '');

  if (meaningful.length !== 1) {
    return null;
  }

  const [node] = meaningful;

  if (node.type === 'image') {
    return safeStandaloneImage(node.url, node.alt);
  }

  if (node.type === 'imageReference') {
    const definition = definitions.get(node.identifier);

    return definition === undefined ? null : safeStandaloneImage(definition.url, node.alt);
  }

  return null;
}

/**
 * Image block for a paragraph that holds nothing but an image.
 *
 * The alt text lands in `caption` because the export direction writes `caption`
 * into the Markdown alt slot, and in `alt` because that is the field the
 * rendered `<img alt>` reads. Both hold plain text — the caption editor writes
 * it via `textContent` and the view emitter escapes it on output.
 *
 * @param image - the resolved source and alt text
 * @param generateId - block id generator
 */
function makeImage(image: StandaloneImage, generateId: () => string): OutputBlockData {
  const data: Record<string, unknown> = { url: image.url };

  if (image.alt !== '') {
    data.caption = image.alt;
    data.alt = image.alt;
  }

  return makeBlock('image', data, generateId);
}

/**
 * Convert a paragraph's phrasing children to blocks.
 * A lone image becomes an image block; inlineMath splits the paragraph into
 * latex code blocks.
 */
function handleParagraph(children: ParagraphChild[], ctx: ConvertContext): OutputBlockData[] {
  const image = soleImage(children as PhrasingContent[], ctx.definitions);

  if (image !== null) {
    return [makeImage(image, ctx.generateId)];
  }

  const hasInlineMath = children.some(c => c.type === 'inlineMath');

  if (!hasInlineMath) {
    return [makeParagraph(phrasingToHtml(children as PhrasingContent[], ctx.definitions), ctx.generateId)];
  }

  return splitOnInlineMath(children, ctx);
}

function splitOnInlineMath(children: ParagraphChild[], ctx: ConvertContext): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];
  const segments = groupByInlineMath(children);

  for (const segment of segments) {
    if (segment.type === 'math') {
      blocks.push(makeBlock('code', { code: segment.value, language: 'latex' }, ctx.generateId));
      continue;
    }

    const text = phrasingToHtml(segment.nodes as PhrasingContent[], ctx.definitions).trim();

    if (text) {
      blocks.push(makeParagraph(text, ctx.generateId));
    }
  }

  return blocks;
}

type MathSegment = { type: 'math'; value: string } | { type: 'text'; nodes: ParagraphChild[] };

function groupByInlineMath(children: ParagraphChild[]): MathSegment[] {
  const segments: MathSegment[] = [];
  const textNodes: ParagraphChild[] = [];

  for (const child of children) {
    if (child.type !== 'inlineMath') {
      textNodes.push(child);
      continue;
    }

    if (textNodes.length > 0) {
      segments.push({ type: 'text', nodes: [...textNodes] });
      textNodes.length = 0;
    }

    segments.push({ type: 'math', value: child.value ?? '' });
  }

  if (textNodes.length > 0) {
    segments.push({ type: 'text', nodes: textNodes });
  }

  return segments;
}

function tryOnUnknownNode(
  onUnknownNode: (node: Nodes) => OutputBlockData[] | null,
  node: RootContent,
): OutputBlockData[] | null {
  try {
    return onUnknownNode(node);
  } catch (e) {
    console.warn(`markdownToBlocks: onUnknownNode threw for node type "${node.type}"`, e);

    return null;
  }
}

function handleToolMap(
  node: RootContent,
  ctx: ConvertContext,
): OutputBlockData[] {
  const toolMap = ctx.config.toolMap;

  if (!toolMap) {
    return [];
  }

  const entry = toolMap[node.type];

  try {
    const block: OutputBlockData = {
      id: ctx.generateId(),
      type: entry.tool,
      data: entry.data(node),
    };

    if (entry.children) {
      const childBlocks = entry.children(
        node,
        (childNodes) => convertNodes(childNodes as RootContent[], ctx, 0),
      );

      return [block, ...childBlocks];
    }

    return [block];
  } catch (e) {
    console.warn(`markdownToBlocks: toolMap handler threw for node type "${node.type}"`, e);

    return [];
  }
}

function handleList(
  list: List,
  ctx: ConvertContext,
  depth: number,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];

  for (const [index, item] of list.children.entries()) {
    // Blok's list is flat: a non-list block already emitted for this list ends
    // the numbering run (ListMarkerCalculator stops counting at a foreign
    // block), so the items after it must carry their own `start`.
    const runInterrupted = blocks.some((block) => block.type !== 'list');

    blocks.push(...handleListItem(item, list, ctx, depth, index, runInterrupted));
  }

  return blocks;
}

function resolveListStyle(isChecklist: boolean, ordered: boolean | null | undefined): string {
  if (isChecklist) {
    return 'checklist';
  }

  return ordered ? 'ordered' : 'unordered';
}

function handleListItem(
  item: ListItem,
  list: List,
  ctx: ConvertContext,
  depth: number,
  index: number,
  runInterrupted: boolean,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];
  const isChecklist = item.checked !== null && item.checked !== undefined;
  const style = resolveListStyle(isChecklist, list.ordered);

  // Extract text from the first paragraph child
  const paragraphChild = item.children.find(
    (c): c is Extract<typeof c, { type: 'paragraph' }> => c.type === 'paragraph',
  );
  const text = paragraphChild ? phrasingToHtml(paragraphChild.children, ctx.definitions) : '';

  const data: Record<string, unknown> = { text, style, depth };

  if (isChecklist) {
    data.checked = item.checked;
  }

  const startValue = (list.start ?? 1) + index;

  if (list.ordered && (index === 0 ? startValue !== 1 : runInterrupted)) {
    data.start = startValue;
  }

  blocks.push(makeBlock('list', data, ctx.generateId));

  // Everything else in the item becomes sibling blocks in document order.
  // Skipped by identity, not by type: a SECOND paragraph is real content.
  // listDepth is depth + 1 so a nested list keeps indenting.
  for (const child of item.children) {
    if (child === paragraphChild) {
      continue;
    }

    const childBlocks = convertNode(child, ctx, depth + 1);

    if (childBlocks) {
      blocks.push(...childBlocks);
    }
  }

  return blocks;
}

function handleBlockquote(bq: Blockquote, ctx: ConvertContext): OutputBlockData[] {
  const parts: string[] = [];

  for (const child of bq.children) {
    if (child.type === 'paragraph') {
      parts.push(phrasingToHtml(child.children, ctx.definitions));
      continue;
    }

    if (!('children' in child) || !Array.isArray(child.children)) {
      continue;
    }

    // For non-paragraph flow content, extract text
    const innerPhrasing = child.children.filter(
      (c): c is PhrasingContent => 'value' in c || 'children' in c,
    );

    if (innerPhrasing.length > 0) {
      parts.push(phrasingToHtml(innerPhrasing, ctx.definitions));
    }
  }

  return [makeBlock('quote', { text: parts.join('<br>'), size: 'default' }, ctx.generateId)];
}

function handleTable(table: Table, ctx: ConvertContext): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];
  const tableId = ctx.generateId();
  const content: Array<Array<{ blocks: string[] }>> = [];

  for (const row of table.children) {
    const rowContent = processTableRow(row.children, tableId, blocks, ctx);

    content.push(rowContent);
  }

  const tableBlock: OutputBlockData = {
    id: tableId,
    type: 'table',
    data: {
      withHeadings: table.children.length > 1,
      withHeadingColumn: false,
      content,
    },
  };

  // Table block first, then cell blocks
  return [tableBlock, ...blocks];
}

function processTableRow(
  cells: Table['children'][number]['children'],
  tableId: string,
  blocks: OutputBlockData[],
  ctx: ConvertContext,
): Array<{ blocks: string[] }> {
  const rowContent: Array<{ blocks: string[] }> = [];

  for (const cell of cells) {
    const cellText = phrasingToHtml(cell.children, ctx.definitions);
    const cellBlockId = ctx.generateId();

    blocks.push({
      id: cellBlockId,
      type: 'paragraph',
      data: { text: cellText },
      parent: tableId,
    });

    rowContent.push({ blocks: [cellBlockId] });
  }

  return rowContent;
}

function handleFallback(
  node: RootContent,
  ctx: ConvertContext,
  fallbackText: string,
): OutputBlockData[] | null {
  // Try onUnknownNode first for unmapped block types
  if (ctx.config.onUnknownNode) {
    const result = tryOnUnknownNode(ctx.config.onUnknownNode, node);

    // null means "skip this node" — respect the caller's decision
    // non-null means the hook handled it
    if (result === null) {
      return null;
    }

    return result;
  }

  return [makeParagraph(fallbackText, ctx.generateId)];
}

function makeParagraph(text: string, generateId: () => string): OutputBlockData {
  return makeBlock('paragraph', { text }, generateId);
}

function makeBlock(type: string, data: Record<string, unknown>, generateId: () => string): OutputBlockData {
  return {
    id: generateId(),
    type,
    data,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
