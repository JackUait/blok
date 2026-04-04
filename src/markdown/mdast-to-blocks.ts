import type { Root, Nodes, List, ListItem, PhrasingContent, Table, Blockquote, RootContent } from 'mdast';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { MarkdownImportConfig } from './types';
import { phrasingToHtml } from './phrasing-to-html';

/**
 * Creates a scoped ID generator. Each call to mdastToBlocks gets a fresh generator.
 */
function createIdGenerator(): () => string {
  const prefix = `md-${Date.now().toString(36)}`;
  const state = { counter: 0 };

  return () => `${prefix}-${(state.counter++).toString(36)}`;
}

/**
 * Convert an mdast tree to an array of Blok OutputBlockData.
 */
export function mdastToBlocks(tree: Root, config: MarkdownImportConfig = {}): OutputBlockData[] {
  const generateId = createIdGenerator();

  return convertNodes(tree.children, config, 0, generateId);
}

function convertNodes(
  nodes: RootContent[],
  config: MarkdownImportConfig,
  listDepth: number,
  generateId: () => string,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];

  for (const node of nodes) {
    const result = convertNode(node, config, listDepth, generateId);

    if (result) {
      blocks.push(...result);
    }
  }

  return blocks;
}

function convertNode(
  node: RootContent,
  config: MarkdownImportConfig,
  listDepth: number,
  generateId: () => string,
): OutputBlockData[] | null {
  // 1. Check toolMap first
  if (config.toolMap?.[node.type]) {
    return handleToolMap(node, config, generateId);
  }

  // 2. Built-in handlers
  const builtInResult = handleBuiltInNode(node, config, listDepth, generateId);

  if (builtInResult !== undefined) {
    return builtInResult;
  }

  // 3. onUnknownNode hook
  if (config.onUnknownNode) {
    return tryOnUnknownNode(config.onUnknownNode, node);
  }

  // 4. Fallback: extract any text content as paragraph
  if ('value' in node && typeof node.value === 'string') {
    return [makeParagraph(escapeHtml(node.value), generateId)];
  }

  return null;
}

/**
 * Handle built-in node types. Returns undefined if node type is not built-in.
 */
function handleBuiltInNode(
  node: RootContent,
  config: MarkdownImportConfig,
  listDepth: number,
  generateId: () => string,
): OutputBlockData[] | null | undefined {
  if (node.type === 'paragraph') {
    return [makeParagraph(phrasingToHtml(node.children), generateId)];
  }

  if (node.type === 'heading') {
    return [makeBlock('header', { text: phrasingToHtml(node.children), level: node.depth }, generateId)];
  }

  if (node.type === 'thematicBreak') {
    return [makeBlock('divider', {}, generateId)];
  }

  if (node.type === 'list') {
    return handleList(node, config, listDepth, generateId);
  }

  if (node.type === 'blockquote') {
    return handleBlockquote(node, generateId);
  }

  if (node.type === 'table') {
    return handleTable(node, generateId);
  }

  if (node.type === 'code') {
    return handleFallback(node, config, `<code>${escapeHtml(node.value)}</code>`, generateId);
  }

  if (node.type === 'html') {
    return handleFallback(node, config, escapeHtml(node.value), generateId);
  }

  return undefined;
}

function tryOnUnknownNode(
  onUnknownNode: (node: Nodes) => OutputBlockData[] | null,
  node: RootContent,
): OutputBlockData[] | null {
  try {
    return onUnknownNode(node as Nodes);
  } catch (e) {
    console.warn(`markdownToBlocks: onUnknownNode threw for node type "${node.type}"`, e);

    return null;
  }
}

function handleToolMap(
  node: RootContent,
  config: MarkdownImportConfig,
  generateId: () => string,
): OutputBlockData[] {
  const toolMap = config.toolMap;

  if (!toolMap) {
    return [];
  }

  const entry = toolMap[node.type];

  try {
    const block: OutputBlockData = {
      id: generateId(),
      type: entry.tool,
      data: entry.data(node as Nodes),
    };

    if (entry.children) {
      const childBlocks = entry.children(
        node as Nodes,
        (childNodes) => convertNodes(childNodes as RootContent[], config, 0, generateId),
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
  config: MarkdownImportConfig,
  depth: number,
  generateId: () => string,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];

  for (const [index, item] of list.children.entries()) {
    blocks.push(...handleListItem(item, list, config, depth, index, generateId));
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
  config: MarkdownImportConfig,
  depth: number,
  index: number,
  generateId: () => string,
): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];
  const isChecklist = item.checked !== null && item.checked !== undefined;
  const style = resolveListStyle(isChecklist, list.ordered);

  // Extract text from the first paragraph child
  const paragraphChild = item.children.find(
    (c): c is Extract<typeof c, { type: 'paragraph' }> => c.type === 'paragraph',
  );
  const text = paragraphChild ? phrasingToHtml(paragraphChild.children) : '';

  const data: Record<string, unknown> = { text, style, depth };

  if (isChecklist) {
    data.checked = item.checked;
  }

  if (list.ordered && index === 0 && list.start !== null && list.start !== undefined && list.start !== 1) {
    data.start = list.start;
  }

  blocks.push(makeBlock('list', data, generateId));

  // Process nested lists (increase depth)
  for (const child of item.children) {
    if (child.type === 'list') {
      blocks.push(...handleList(child, config, depth + 1, generateId));
    }
  }

  return blocks;
}

function handleBlockquote(bq: Blockquote, generateId: () => string): OutputBlockData[] {
  const parts: string[] = [];

  for (const child of bq.children) {
    if (child.type === 'paragraph') {
      parts.push(phrasingToHtml(child.children));
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
      parts.push(phrasingToHtml(innerPhrasing));
    }
  }

  return [makeBlock('quote', { text: parts.join('<br>'), size: 'default' }, generateId)];
}

function handleTable(table: Table, generateId: () => string): OutputBlockData[] {
  const blocks: OutputBlockData[] = [];
  const tableId = generateId();
  const content: Array<Array<{ blocks: string[] }>> = [];

  for (const row of table.children) {
    const rowContent = processTableRow(row.children, tableId, blocks, generateId);

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
  generateId: () => string,
): Array<{ blocks: string[] }> {
  const rowContent: Array<{ blocks: string[] }> = [];

  for (const cell of cells) {
    const cellText = phrasingToHtml(cell.children);
    const cellBlockId = generateId();

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
  config: MarkdownImportConfig,
  fallbackText: string,
  generateId: () => string,
): OutputBlockData[] | null {
  // Try onUnknownNode first for unmapped block types
  if (config.onUnknownNode) {
    const result = tryOnUnknownNode(config.onUnknownNode, node);

    // null means "skip this node" — respect the caller's decision
    // non-null means the hook handled it
    if (result === null) {
      return null;
    }

    return result;
  }

  return [makeParagraph(fallbackText, generateId)];
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
