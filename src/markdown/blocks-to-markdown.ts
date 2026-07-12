/**
 * Serialize Blok blocks to Markdown text.
 *
 * This is the inverse of the Markdown import pipeline (mdast-to-blocks) and is
 * used for the `text/plain` clipboard flavor so copied content carries Markdown
 * (headings as `#`, bold as `**`, lists as `-`, …) instead of stripped plain
 * text — matching how Notion serializes blocks on copy.
 */

import type { BlockToolData } from '../../types';

export interface SerializableBlock {
  /**
   * Block id. Required for tools whose data references OTHER blocks by id —
   * today that is `table`, whose cells hold their content as child block ids.
   */
  id?: string;
  /** Id of the structural parent, used to resolve a block's descendants. */
  parentId?: string | null;
  tool: string;
  data: BlockToolData;
  /**
   * Structural nesting depth (the parentId chain length), applied as leading
   * indentation so a Tab/drag-nested block serializes nested instead of flat —
   * matching Notion's Markdown export. Used for EVERY tool, including `list`:
   * list nesting is structural now, so its indent comes from here (with a
   * fallback to the legacy flat `data.depth` for imported lists that have no
   * structural parent yet).
   */
  indent?: number;
}

/** Number of spaces used per nesting level for list items. */
const LIST_INDENT = '    ';

/**
 * Convert a fragment of inline HTML (a block's `text`) into inline Markdown.
 * Walks the DOM so nested marks (e.g. bold inside a link) serialize correctly.
 *
 * @param html - inline HTML string
 * @returns inline Markdown
 */
const inlineHtmlToMarkdown = (html: string): string => {
  const container = document.createElement('div');

  container.innerHTML = html ?? '';

  return serializeChildren(container);
};

/**
 * Serialize all child nodes of an element to inline Markdown.
 *
 * @param node - parent node
 * @returns concatenated inline Markdown of the children
 */
const serializeChildren = (node: Node): string =>
  Array.from(node.childNodes).map(serializeInlineNode).join('');

/**
 * Coerce an unknown value to a string, treating non-strings as empty. Block data
 * values are typed loosely, so this guards against stringifying objects.
 *
 * @param value - value to coerce
 * @returns the string value, or '' when not a string
 */
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Serialize a single inline DOM node to Markdown.
 *
 * @param node - the node to serialize
 * @returns inline Markdown for the node
 */
const serializeInlineNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const inner = serializeChildren(element);

  switch (element.tagName.toLowerCase()) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return inner.trim() === '' ? inner : `**${inner}**`;
    case 'i':
    case 'em':
      return inner.trim() === '' ? inner : `*${inner}*`;
    case 'code':
      return inner.trim() === '' ? inner : `\`${inner}\``;
    case 's':
    case 'del':
    case 'strike':
      return inner.trim() === '' ? inner : `~~${inner}~~`;
    case 'a': {
      const href = element.getAttribute('href');

      return href ? `[${inner}](${href})` : inner;
    }
    default:
      return inner;
  }
};

/**
 * Strip HTML to its text content (used for code blocks, where Markdown is literal).
 *
 * @param html - HTML string
 * @returns plain text
 */
const htmlToText = (html: string): string => {
  const container = document.createElement('div');

  container.innerHTML = html ?? '';

  return container.textContent ?? '';
};

/**
 * Lookup structures shared by every block in one serialization run. Needed by
 * tools whose data references other blocks by id (`table`).
 */
interface SerializationContext {
  /** Every block of the run, keyed by id. */
  byId: Map<string, SerializableBlock>;
  /** Structural children, keyed by parent id. */
  childrenOf: Map<string, SerializableBlock[]>;
}

/**
 * Narrow an unknown value to a plain record.
 *
 * @param value - value to check
 * @returns true when the value is a non-null object
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Read a table block's cell grid, tolerating the legacy string-cell format.
 *
 * @param data - the table block's data
 * @returns the grid of cell records
 */
const readTableGrid = (data: BlockToolData): Array<Array<Record<string, unknown>>> => {
  const { content } = data;

  if (!Array.isArray(content)) {
    return [];
  }

  return content.map((row) => {
    if (!Array.isArray(row)) {
      return [];
    }

    return row.map((cell: unknown) => (isRecord(cell) ? cell : { text: asString(cell) }));
  });
};

/**
 * Escape a cell's Markdown so it cannot break the pipe-table grid: `|` is
 * escaped and hard line breaks become `<br>` (GFM cells are single-line).
 *
 * @param markdown - the cell's Markdown
 * @returns grid-safe Markdown
 */
const escapeTableCell = (markdown: string): string =>
  markdown.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/**
 * Serialize one cell child block plus its structural descendants.
 *
 * @param block - the cell's child block
 * @param context - the serialization context
 * @param depth - nesting depth relative to the cell
 * @returns Markdown lines for the block and its descendants
 */
const cellBlockLines = (block: SerializableBlock, context: SerializationContext, depth: number): string[] => {
  const lines = [blockToMarkdown({ ...block,
    indent: depth }, context)];

  for (const child of context.childrenOf.get(block.id ?? '') ?? []) {
    lines.push(...cellBlockLines(child, context, depth + 1));
  }

  return lines;
};

/**
 * Serialize a table block as a GFM pipe table.
 *
 * Documented degradations (GFM pipe tables cannot express these):
 * - **Merged cells**: `colspan`/`rowspan` are dropped. The origin cell keeps its
 *   content in place and the cells it covered serialize as empty, so the grid
 *   stays rectangular.
 * - **Heading column** (`withHeadingColumn`): serialized as a plain column.
 * - **No heading row** (`withHeadings: false`): GFM requires a header, so an
 *   EMPTY header row is emitted and every data row stays a data row (rather than
 *   promoting the first row to a heading and lying about the data).
 * - **Multi-block cells**: joined with `<br>`, since a pipe-table cell is inline-only.
 * @param block - the table block
 * @param context - the serialization context (resolves cell child blocks by id)
 * @returns the pipe-table Markdown
 */
const tableToMarkdown = (block: SerializableBlock, context: SerializationContext): string => {
  const grid = readTableGrid(block.data);

  if (grid.length === 0) {
    return '';
  }

  const columns = grid.reduce((max, row) => Math.max(max, row.length), 0);

  const rows = grid.map((row) =>
    Array.from({ length: columns }, (_unused, index) => {
      const cell = row[index];

      if (cell === undefined) {
        return '';
      }

      const ids = Array.isArray(cell.blocks) ? cell.blocks.filter((id: unknown): id is string => typeof id === 'string') : [];
      const lines = ids.flatMap((id) => {
        const cellBlock = context.byId.get(id);

        return cellBlock === undefined ? [] : cellBlockLines(cellBlock, context, 0);
      });

      const markdown = lines.length > 0 ? lines.join('\n') : inlineHtmlToMarkdown(asString(cell.text));

      return escapeTableCell(markdown).trim();
    })
  );

  const withHeadings = block.data.withHeadings === true;
  const header = withHeadings ? rows[0] : Array.from({ length: columns }, () => '');
  const body = withHeadings ? rows.slice(1) : rows;
  const delimiter = Array.from({ length: columns }, () => '---');

  return [header, delimiter, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
};

/**
 * Serialize a single block to a Markdown line (or fenced block).
 *
 * @param block - the block to serialize
 * @param context - the serialization context
 * @returns Markdown for the block
 */
const blockToMarkdown = (block: SerializableBlock, context: SerializationContext): string => {
  const { data } = block;
  const text = inlineHtmlToMarkdown(asString(data.text));

  switch (block.tool) {
    // A pipe table must start at column 0 — a flat indent of 4 spaces would turn
    // it into an indented code block — so it is handled before `flatIndent`.
    case 'table':
      return tableToMarkdown(block, context);
    case 'list': {
      // List nesting is structural (parentId chain), carried in `indent` —
      // consistent with how Tab-nested text/headers serialize. Fall back to the
      // legacy flat `data.depth` for imported lists that have no structural parent
      // yet, so their indentation survives a copy-as-markdown.
      const structuralDepth = Math.max(Number(block.indent ?? 0), 0);
      const flatDepth = Math.max(Number(data.depth ?? 0), 0);
      const indent = LIST_INDENT.repeat(structuralDepth > 0 ? structuralDepth : flatDepth);

      if (data.style === 'ordered') {
        return `${indent}1. ${text}`;
      }

      if (data.style === 'checklist') {
        return `${indent}- [${data.checked ? 'x' : ' '}] ${text}`;
      }

      return `${indent}- ${text}`;
    }
    default:
      break;
  }

  // Flat Tab-indent applies to every non-list block so nested paragraphs,
  // headers and quotes serialize indented instead of flattened.
  const flatIndent = LIST_INDENT.repeat(Math.max(Number(block.indent ?? 0), 0));

  switch (block.tool) {
    case 'header': {
      const level = Math.min(Math.max(Number(data.level) || 1, 1), 6);

      return `${flatIndent}${'#'.repeat(level)} ${text}`;
    }
    case 'quote':
      return `${flatIndent}> ${text}`;
    case 'code':
      return `${flatIndent}\`\`\`\n${htmlToText(asString(data.code) || asString(data.text))}\n\`\`\``;
    case 'divider':
      return `${flatIndent}---`;
    case 'image':
      return `${flatIndent}![${inlineHtmlToMarkdown(asString(data.caption))}](${asString(data.url)})`;
    /**
     * Markdown has no media or embed syntax, so these degrade to a link — which
     * still carries the URL. Without a case they serialized to an EMPTY line
     * (they hold no `data.text`), silently dropping the block on copy/export.
     */
    case 'video':
    case 'audio':
    case 'file':
    case 'bookmark':
    case 'embed': {
      const url = asString(data.url) || asString(data.source);
      const label = inlineHtmlToMarkdown(asString(data.caption))
        || asString(data.title)
        || asString(data.fileName)
        || asString(data.service)
        || url;

      return `${flatIndent}[${label}](${url})`;
    }
    default:
      return `${flatIndent}${text}`;
  }
};

/**
 * Build the id/children lookups for one serialization run.
 *
 * @param blocks - blocks to serialize
 * @returns the serialization context
 */
const buildContext = (blocks: SerializableBlock[]): SerializationContext => {
  const byId = new Map<string, SerializableBlock>();
  const childrenOf = new Map<string, SerializableBlock[]>();

  for (const block of blocks) {
    if (block.id !== undefined) {
      byId.set(block.id, block);
    }

    const parentId = block.parentId;

    if (typeof parentId === 'string') {
      const siblings = childrenOf.get(parentId) ?? [];

      siblings.push(block);
      childrenOf.set(parentId, siblings);
    }
  }

  return { byId,
    childrenOf };
};

/**
 * Collect the ids of blocks that a table already serializes INSIDE its cells, so
 * they are not ALSO emitted as loose top-level lines. A table cell's content is
 * a set of child blocks that live in the same flat array as the table itself.
 *
 * @param blocks - blocks to serialize
 * @param context - the serialization context
 * @returns ids owned by some table (every descendant of a table block)
 */
const collectTableOwnedIds = (blocks: SerializableBlock[], context: SerializationContext): Set<string> => {
  const owned = new Set<string>();
  const queue = blocks.filter((block) => block.tool === 'table').map((block) => block.id).filter((id): id is string => id !== undefined);

  /**
   * Queue a not-yet-owned child id.
   * @param child - a structural child of an owned block
   */
  const claim = (child: SerializableBlock): void => {
    if (child.id === undefined || owned.has(child.id)) {
      return;
    }

    owned.add(child.id);
    queue.push(child.id);
  };

  while (queue.length > 0) {
    const parentId = queue.shift() ?? '';

    (context.childrenOf.get(parentId) ?? []).forEach(claim);
  }

  return owned;
};

/**
 * Serialize an ordered list of blocks to a single Markdown string.
 *
 * Consecutive list items are joined with single newlines (a tight list); all
 * other block boundaries use a blank line.
 *
 * @param blocks - blocks to serialize, in document order
 * @returns Markdown string
 */
export const blocksToMarkdown = (blocks: SerializableBlock[]): string => {
  const context = buildContext(blocks);
  const tableOwnedIds = collectTableOwnedIds(blocks, context);
  const topLevel = blocks.filter((block) => block.id === undefined || !tableOwnedIds.has(block.id));

  return topLevel.reduce((out, block, index) => {
    const markdown = blockToMarkdown(block, context);

    if (index === 0) {
      return markdown;
    }

    const previous = topLevel[index - 1];
    const separator = previous.tool === 'list' && block.tool === 'list' ? '\n' : '\n\n';

    return out + separator + markdown;
  }, '');
};
