/**
 * Block-level Markdown serialization, shared by both inline backends.
 *
 * A block's inline content is an HTML fragment, and the two callers read it in
 * different ways: the editor walks a live DOM (`src/markdown/blocks-to-markdown.ts`),
 * while the view renderer must stay DOM-free and walks parse5
 * (`src/view/blocks-to-markdown.ts`). Everything ABOVE that line — which tool
 * becomes which Markdown construct, how containers own their children, how a
 * table becomes a pipe grid — is identical, and lives here so the two cannot
 * drift. Parity is pinned by test/unit/markdown/blocks-to-markdown.parity.test.ts.
 *
 * PURITY CONTRACT: no DOM, no parse5, no editor imports. Only the injected
 * `InlineBackend` touches HTML.
 */

import type { BlockToolData } from '../../types';

export interface SerializableBlock {
  /**
   * Block id. Required for tools whose data references OTHER blocks by id —
   * `table`, whose cells hold their content as child block ids — and for every
   * container that renders its own children.
   */
  id?: string;
  /** Id of the structural parent, used to resolve a block's descendants. */
  parentId?: string | null;
  tool: string;
  data: BlockToolData;
  /**
   * Structural nesting depth (the parentId chain length), applied as leading
   * indentation so a Tab/drag-nested block serializes nested instead of flat —
   * matching Notion's Markdown export. Always honoured for `list` (list nesting
   * is structural now, with a fallback to the legacy flat `data.depth` for
   * imported lists that have no structural parent yet); for every other tool
   * only inside a list item, where four spaces continue the item instead of
   * opening an indented code block.
   */
  indent?: number;
}

/** Reads a block's inline HTML. The only part of serialization that needs a parser. */
export interface InlineBackend {
  /** Inline HTML → inline Markdown (marks, links, `<br>`). */
  inlineToMarkdown(html: string): string;
  /** Inline HTML → literal text, for constructs where Markdown is verbatim (code). */
  htmlToText(html: string): string;
}

/** A construct that could not be carried into Markdown as-is. */
export interface MarkdownDegradation {
  /**
   * What degraded. A block tool name (`callout`) on the way out; a Markdown
   * construct (`html`) on the way in.
   */
  construct: string;
  /** `dropped` — nothing was emitted; `degraded` — emitted, but lossy. */
  action: 'dropped' | 'degraded';
  /** Plain-language explanation of what was lost. */
  detail: string;
}

/** Number of spaces used per nesting level. */
const LIST_INDENT = '    ';

/**
 * The code tool's "no language" id — `DEFAULT_LANGUAGE` in
 * src/tools/code/constants.ts, and the fallback `mdast-to-blocks.ts` writes for
 * an info-less fence. Inlined rather than imported: the core stays pure.
 */
const PLAIN_TEXT_LANGUAGE = 'plain text';

/**
 * Tools that render their own descendants and therefore CLAIM them: a claimed
 * block is never also emitted as a loose top-level line. Table cells hold their
 * content as child block ids; the rest are structural containers.
 */
const CONTAINER_TOOLS = new Set(['table', 'callout', 'toggle', 'column_list', 'column']);

/**
 * Coerce an unknown value to a string, treating non-strings as empty. Block data
 * values are typed loosely, so this guards against stringifying objects.
 * @param value - value to coerce
 */
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Lookup structures shared by every block in one serialization run. */
interface SerializationContext {
  /** Every block of the run, keyed by id. */
  byId: Map<string, SerializableBlock>;
  /** Structural children, keyed by parent id. */
  childrenOf: Map<string, SerializableBlock[]>;
  /** Reads inline HTML. */
  inline: InlineBackend;
  /** Collects degradations; discarded when the caller asked for no report. */
  warnings: MarkdownDegradation[];
  /** Ids already on the render stack — breaks parent-reference cycles. */
  active: Set<string>;
}

/**
 * Record a degradation.
 * @param context - the serialization context
 * @param construct - tool name that degraded
 * @param action - whether anything was emitted
 * @param detail - plain-language explanation
 */
const warn = (
  context: SerializationContext,
  construct: string,
  action: MarkdownDegradation['action'],
  detail: string
): void => {
  context.warnings.push({ construct,
    action,
    detail });
};

/**
 * Read a table block's cell grid, tolerating the legacy string-cell format.
 * @param data - the table block's data
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
 * @param markdown - the cell's Markdown
 */
const escapeTableCell = (markdown: string): string => {
  const segments = markdown.split('|');

  /**
   * A `\` run before a `|` must be doubled before the escaping `\` is added,
   * otherwise `a\|b` exports as `a\\|b` — a literal backslash plus a LIVE
   * delimiter — and re-importing splits the cell in two.
   */
  return segments
    .map((segment, index) => (index === segments.length - 1 ? segment : doubleTrailingBackslashes(segment)))
    .join('\\|')
    .replace(/\n/g, '<br>');
};

/**
 * Double the trailing `\` run of a cell segment.
 * @param segment - cell Markdown between two `|` characters
 * @returns the segment with its trailing backslash run doubled
 */
const doubleTrailingBackslashes = (segment: string): string => {
  const run = Array.from(segment).reduce((count, character) => (character === '\\' ? count + 1 : 0), 0);

  return segment + '\\'.repeat(run);
};

/**
 * Serialize one cell child block plus its structural descendants.
 * @param block - the cell's child block
 * @param context - the serialization context
 * @param depth - nesting depth relative to the cell
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
 */
const tableToMarkdown = (block: SerializableBlock, context: SerializationContext): string => {
  const grid = readTableGrid(block.data);

  if (grid.length === 0) {
    return '';
  }

  const columns = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const unresolved: string[] = [];

  const rows = grid.map((row) =>
    Array.from({ length: columns }, (_unused, index) => {
      const cell = row[index];

      if (cell === undefined) {
        return '';
      }

      const ids = Array.isArray(cell.blocks) ? cell.blocks.filter((id: unknown): id is string => typeof id === 'string') : [];
      const lines = ids.flatMap((id) => {
        const cellBlock = context.byId.get(id);

        if (cellBlock === undefined) {
          unresolved.push(id);

          return [];
        }

        return cellBlockLines(cellBlock, context, 0);
      });

      const markdown = lines.length > 0 ? lines.join('\n') : context.inline.inlineToMarkdown(asString(cell.text));

      return escapeTableCell(markdown).trim();
    })
  );

  /**
   * A cell pointing at a block that is not in the document loses its content
   * with nothing to show for it. Staying silent here is what let a truncated
   * article keep reporting fidelity full.
   */
  if (unresolved.length > 0) {
    const one = unresolved.length === 1;

    warn(
      context,
      block.tool,
      'dropped',
      `${unresolved.length} child block reference${one ? '' : 's'} could not be resolved and ${one ? 'was' : 'were'} dropped`
    );
  }

  const withHeadings = block.data.withHeadings === true;
  const header = withHeadings ? rows[0] : Array.from({ length: columns }, () => '');
  const body = withHeadings ? rows.slice(1) : rows;
  const delimiter = Array.from({ length: columns }, () => '---');

  return [header, delimiter, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
};

/**
 * Serialize an ordered run of blocks: empty results contribute nothing (so a
 * block with no Markdown representation leaves no stray blank line), and two
 * consecutive list items are joined tightly.
 * @param blocks - blocks to serialize, in document order
 * @param context - the serialization context
 */
const sequenceToMarkdown = (blocks: SerializableBlock[], context: SerializationContext): string => {
  const segments: Array<{ text: string; isList: boolean }> = [];

  for (const block of blocks) {
    const markdown = blockToMarkdown(block, context);

    if (markdown !== '') {
      segments.push({ text: markdown,
        isList: block.tool === 'list' });
    }
  }

  return segments.reduce((out, segment, index) => {
    if (index === 0) {
      return segment.text;
    }

    const separator = segment.isList && segments[index - 1].isList ? '\n' : '\n\n';

    return out + separator + segment.text;
  }, '');
};

/**
 * Serialize a container's structural children as a Markdown run.
 *
 * Children are re-based to indent 0 relative to their container: a container
 * expresses its own nesting through its Markdown construct (a blockquote, a
 * bold summary), never through leading spaces, so carrying the absolute depth
 * inward would indent the body into a code block.
 * @param block - the container block
 * @param context - the serialization context
 */
const childrenToMarkdown = (block: SerializableBlock, context: SerializationContext): string => {
  const children = context.childrenOf.get(block.id ?? '') ?? [];
  /**
   * Re-base against the container's ORIGINAL indent, not the copy's: a nested
   * container (a column inside a column list) is itself rendered from a copy
   * whose indent was already zeroed, while its children still carry their
   * absolute depth. Subtracting the zeroed value would leave them indented.
   */
  const original = (block.id === undefined ? undefined : context.byId.get(block.id)) ?? block;
  const base = Math.max(Number(original.indent ?? 0), 0) + 1;

  return sequenceToMarkdown(
    children.map((child) => ({ ...child,
      indent: Math.max(Math.max(Number(child.indent ?? 0), 0) - base, 0) })),
    context
  );
};

/**
 * Whether a block sits inside a list item. Four leading spaces continue a list
 * item, but outside one they are an indented code block — so a non-list block
 * only carries a flat indent when a list actually owns it.
 * @param block - the block being serialized
 * @param context - the serialization context
 * @param seen - parent ids already walked (cycle guard)
 */
const isUnderList = (
  block: SerializableBlock,
  context: SerializationContext,
  seen: Set<string> = new Set()
): boolean => {
  const { parentId } = block;

  if (typeof parentId !== 'string' || seen.has(parentId)) {
    return false;
  }

  seen.add(parentId);

  const parent = context.byId.get(parentId);

  if (parent === undefined) {
    return false;
  }

  return parent.tool === 'list' || isUnderList(parent, context, seen);
};

/**
 * Prefix every line of a block of text, including empty ones — the shape a
 * Markdown blockquote requires to stay one quote rather than several.
 * @param text - text to prefix
 * @param prefix - the line prefix
 */
const prefixLines = (text: string, prefix: string): string =>
  text.split('\n').map((line) => prefix + line).join('\n');

/**
 * Serialize a single block to a Markdown line (or fenced/quoted block).
 * @param block - the block to serialize
 * @param context - the serialization context
 */
const blockToMarkdown = (block: SerializableBlock, context: SerializationContext): string => {
  /** Cycle guard: a parent-reference loop must not recurse forever. */
  if (block.id !== undefined && context.active.has(block.id)) {
    return '';
  }

  if (block.id !== undefined) {
    context.active.add(block.id);
  }

  try {
    return blockMarkdownBody(block, context);
  } finally {
    if (block.id !== undefined) {
      context.active.delete(block.id);
    }
  }
};

/**
 * The Markdown of one block, with the cycle guard already applied by
 * {@link blockToMarkdown}. Kept between `blockToMarkdown` and `buildContext`
 * because the Markdown serialization law scans that region for `case` labels.
 * @param block - the block to serialize
 * @param context - the serialization context
 */
const blockMarkdownBody = (block: SerializableBlock, context: SerializationContext): string => {
  const { data } = block;
  const text = context.inline.inlineToMarkdown(asString(data.text));

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
    /**
     * A callout carries no `data.text` of its own — its content is child
     * blocks — so without this case it serialized to an EMPTY line while its
     * children escaped as loose siblings, indented four spaces into a code
     * block. Rendered as a blockquote: the emoji leads the body; type and
     * colours are lost.
     */
    case 'callout': {
      warn(context, block.tool, 'degraded', 'callout is rendered as a blockquote; its emoji styling, colours and type are lost');

      const emoji = asString(data.emoji);
      const body = childrenToMarkdown(block, context);

      return prefixLines([emoji, body].filter((part) => part !== '').join(' '), '> ');
    }
    /**
     * Markdown has no collapsible section, so the summary becomes a bold line
     * and the body follows it as ordinary blocks.
     */
    case 'toggle': {
      warn(context, block.tool, 'degraded', 'toggle is rendered as a bold summary followed by its body; collapsibility is lost');

      const body = childrenToMarkdown(block, context);
      const title = `**${text}**`;

      return body === '' ? title : `${title}\n\n${body}`;
    }
    /** Markdown has no columns; the layout flattens into reading order. */
    case 'column_list':
      warn(context, block.tool, 'degraded', 'columns are flattened into sequential blocks; the side-by-side layout is lost');

      return childrenToMarkdown(block, context);
    case 'column':
      return childrenToMarkdown(block, context);
    /** Pure vertical whitespace — Markdown has no representation for a gap. */
    case 'spacer':
      warn(context, block.tool, 'dropped', 'spacer is purely visual and has no Markdown equivalent');

      return '';
    default:
      break;
  }

  // A non-list block keeps its Tab-indent only while a list item owns it, where
  // four spaces are the continuation. Anywhere else they are an indented code
  // block, so nesting is dropped rather than exported as code.
  const flatIndent = isUnderList(block, context)
    ? LIST_INDENT.repeat(Math.max(Number(block.indent ?? 0), 0))
    : '';

  switch (block.tool) {
    case 'header': {
      const level = Math.min(Math.max(Number(data.level) || 1, 1), 6);

      if (data.isToggleable === true) {
        warn(context, block.tool, 'degraded', 'collapsible heading is rendered as a heading followed by its body; collapsibility is lost');
      }

      return `${flatIndent}${'#'.repeat(level)} ${text}`;
    }
    case 'quote':
      return `${flatIndent}> ${text}`;
    case 'code': {
      const language = asString(data.language).trim();
      const info = language === PLAIN_TEXT_LANGUAGE ? '' : language;

      return `${flatIndent}\`\`\`${info}\n${context.inline.htmlToText(asString(data.code) || asString(data.text))}\n\`\`\``;
    }
    /** `delimiter` is the Editor.js name for the same block; imported documents still carry it. */
    case 'divider':
    case 'delimiter':
      return `${flatIndent}---`;
    case 'image':
      return `${flatIndent}![${context.inline.inlineToMarkdown(asString(data.caption))}](${asString(data.url)})`;
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
      warn(context, block.tool, 'degraded', `${block.tool} is rendered as a plain link; the embedded player or preview is lost`);

      const url = asString(data.url) || asString(data.source);
      const label = context.inline.inlineToMarkdown(asString(data.caption))
        || asString(data.title)
        || asString(data.fileName)
        || asString(data.service)
        || url;

      return `${flatIndent}[${label}](${url})`;
    }
    default: {
      const fallback = `${flatIndent}${text}`;

      /**
       * A block with no dedicated case and no inline text vanishes from the
       * output. Naming it is the runtime half of the Markdown serialization
       * law: the build-time scan cannot see a tool a consumer registered.
       */
      if (fallback.trim() === '' && typeof data.text !== 'string') {
        warn(context, block.tool, 'dropped', `\`${block.tool}\` has no Markdown representation and carries no inline text`);

        return '';
      }

      return fallback;
    }
  }
};

/**
 * Build the id/children lookups for one serialization run.
 * @param blocks - blocks to serialize
 * @param inline - the inline backend
 * @param warnings - accumulator for degradations
 */
const buildContext = (
  blocks: SerializableBlock[],
  inline: InlineBackend,
  warnings: MarkdownDegradation[]
): SerializationContext => {
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
    childrenOf,
    inline,
    warnings,
    active: new Set<string>() };
};

/**
 * Collect the ids of blocks a container already serializes INSIDE itself, so
 * they are not ALSO emitted as loose top-level lines. Container children live
 * in the same flat array as the container, which is why the claim has to be
 * computed up front rather than discovered during the walk.
 * @param blocks - blocks to serialize
 * @param context - the serialization context
 */
const collectOwnedIds = (blocks: SerializableBlock[], context: SerializationContext): Set<string> => {
  const owned = new Set<string>();
  const queue = blocks
    .filter((block) => CONTAINER_TOOLS.has(block.tool))
    .map((block) => block.id)
    .filter((id): id is string => id !== undefined);

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
 * Serialize an ordered list of blocks to a single Markdown string, collecting
 * every construct that could not be carried across.
 * @param blocks - blocks to serialize, in document order
 * @param inline - reads the blocks' inline HTML
 * @returns the Markdown and the degradations recorded while producing it
 */
export const serializeBlocksToMarkdown = (
  blocks: SerializableBlock[],
  inline: InlineBackend
): { markdown: string; warnings: MarkdownDegradation[] } => {
  const warnings: MarkdownDegradation[] = [];
  const context = buildContext(blocks, inline, warnings);
  const ownedIds = collectOwnedIds(blocks, context);
  const topLevel = blocks.filter((block) => block.id === undefined || !ownedIds.has(block.id));

  return { markdown: sequenceToMarkdown(topLevel, context),
    warnings };
};
