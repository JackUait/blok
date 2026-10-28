import type {
  Code, Definition, FootnoteDefinition, Heading, Html, List, ListItem, Math, Paragraph, PhrasingContent, Root,
  RootContent, Table, TableCell,
} from '../../../types/data-formats/markdown-tree';
import type { BlockOptions, BlockResult, PendingInline } from './block';
import { extractDefinitions } from './block-definitions';
import { joinLines, type Block } from './block-model';
import { splitInfo, trimEnd, trimStart } from './block-syntax';
import { decodeString, isLineEnding, isSpaceOrTab, normalizeIdentifier, skipSpaces, TAB_STOP } from './text';

/**
 * Drop one line ending from the end of a value.
 * @param value - code or math content
 */
const dropFinalEnding = (value: string): string => {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }

  return isLineEnding(value[value.length - 1]) ? value.slice(0, -1) : value;
};

/**
 * The checkbox of a GFM task item at the start of its first paragraph:
 * the state, and the text after the box. One whitespace character after
 * `]` goes, unless the line ends there.
 * A tab inside the box counts only when it is one column wide.
 * @param raw - the paragraph's text
 * @param column - the column of its `[`
 */
const taskCheck = (raw: string, column: number): { checked: boolean; rest: string } | null => {
  const inside = raw[1];
  const crlf = inside === '\r' && raw[2] === '\n';
  const close = crlf ? 3 : 2;
  const wideTab = inside === '\t' && (column + 1) % TAB_STOP !== TAB_STOP - 1;

  if (raw[0] !== '[' || raw[close] !== ']' || wideTab || !(isSpaceOrTab(inside) || isLineEnding(inside) || inside === 'x' || inside === 'X')) {
    return null;
  }

  const after = raw.slice(close + 1);

  if (isLineEnding(after[0])) {
    return { checked: inside === 'x' || inside === 'X', rest: dropOneEndingChar(after) };
  }

  if (!isSpaceOrTab(after[0])) {
    return null;
  }

  return { checked: inside === 'x' || inside === 'X', rest: afterBoxSpace(after) };
};

/**
 * The text after a task box that a space or tab follows.
 * @param after - text from that whitespace on
 */
const afterBoxSpace = (after: string): string => {
  const cursor = { index: 0 };

  while (isSpaceOrTab(after[cursor.index])) {
    cursor.index++;
  }

  const ws = after.slice(0, cursor.index);

  if (!isLineEnding(after[cursor.index])) {
    return after.slice(1);
  }

  // Two or more spaces before a line ending are a hard break, so they stay.
  if (ws.length >= 2 && !ws.includes('\t')) {
    return after;
  }

  return dropOneEndingChar(after.slice(cursor.index));
};

/**
 * Drop one character of the line ending that starts `text` (so `\r\n`
 * leaves its `\n`), and the next line's indentation once the ending is
 * gone, which text drops after a line ending anyway.
 * @param text - text starting with a line ending
 */
const dropOneEndingChar = (text: string): string => (text.startsWith('\r\n') ? text.slice(1) : trimStart(text.slice(1)));

/**
 * The column of index `at` in a paragraph's joined lines.
 * @param block - the paragraph
 * @param at - an index in its joined lines, inside a line's leading whitespace or at its end
 */
const columnAt = (block: Block, at: number): number => {
  const cursor = { offset: 0, index: 0 };

  while (cursor.index < block.lines.length - 1 && cursor.offset + block.lines[cursor.index].length + block.endings[cursor.index].length <= at) {
    cursor.offset += block.lines[cursor.index].length + block.endings[cursor.index].length;
    cursor.index++;
  }

  const state = { column: block.columns[cursor.index] ?? 0 };

  for (const char of block.lines[cursor.index].slice(0, at - cursor.offset)) {
    state.column += char === '\t' ? TAB_STOP - (state.column % TAB_STOP) : 1;
  }

  return state.column;
};

/**
 * The start columns the inline parser needs for a leaf's text that begins
 * at index `start` of the paragraph's joined lines: lines after the first,
 * keyed by index in that text. Tab stops are left out; they read as 0.
 * @param block - the paragraph
 * @param start - where the leaf's text starts
 */
const lineColumns = (block: Block, start: number): ReadonlyMap<number, number> | undefined => {
  const columns = new Map<number, number>();
  const cursor = { offset: 0 };

  block.lines.forEach((line, index) => {
    const column = block.columns[index] ?? 0;

    if (cursor.offset > start && column % TAB_STOP !== 0) {
      columns.set(cursor.offset - start, column);
    }

    cursor.offset += line.length + block.endings[index].length;
  });

  return columns.size === 0 ? undefined : columns;
};

const DEPTHS: Array<Heading['depth']> = [1, 2, 3, 4, 5, 6];

/**
 * A heading depth as mdast types it.
 * @param depth - 1 to 6
 */
const headingDepth = (depth: number): Heading['depth'] => DEPTHS[Math.min(Math.max(depth, 1), 6) - 1];

/**
 * Builds the mdast tree from the parsed blocks, with an explicit stack so
 * deep nesting cannot overflow the call stack.
 */
class BlockTreeBuilder {
  public readonly inline: PendingInline[] = [];
  public readonly definitions = new Set<string>();
  public readonly footnotes = new Set<string>();
  /** Paragraphs that a task checkbox shortened: the text left, and where it starts in the joined lines. */
  private readonly taskRest = new Map<Block, { text: string; start: number }>();

  /**
   * @param options - syntax switches
   */
  constructor(private readonly options: BlockOptions) {}

  /**
   * Convert the document block.
   * @param doc - the document
   */
  public build(doc: Block): Root {
    const root: Root = { type: 'root', children: [] };
    const stack: Array<{ block: Block; into: RootContent[] }> = [];

    this.pushChildren(stack, doc, root.children);

    for (;;) {
      const frame = stack.pop();

      if (frame === undefined) {
        return root;
      }

      const children = this.convert(frame.block, frame.into);

      if (children !== null) {
        this.pushChildren(stack, frame.block, children);
      }
    }
  }

  /**
   * Queue a block's children, so they pop in document order.
   * @param stack - the work stack
   * @param block - the parent block
   * @param into - where their nodes go
   */
  private pushChildren(stack: Array<{ block: Block; into: RootContent[] }>, block: Block, into: RootContent[]): void {
    for (const child of [...block.children].reverse()) {
      stack.push({ block: child, into });
    }
  }

  /**
   * Append a block's nodes to `into`; return the array its children go into,
   * or null for a leaf.
   * @param block - the block
   * @param into - the parent's children
   */
  private convert(block: Block, into: RootContent[]): RootContent[] | null {
    switch (block.kind) {
      case 'blockquote':
        return this.container(into, { type: 'blockquote', children: [] });
      case 'list':
        return this.container(into, this.list(block));
      case 'item':
        return this.container(into, this.item(block));
      case 'footnote':
        return this.container(into, this.footnote(block));
      case 'document':
      case 'paragraph':
      case 'heading':
      case 'thematicBreak':
      case 'code':
      case 'math':
      case 'html':
      case 'table':
        this.leaf(block, into);

        return null;
    }
  }

  /**
   * Append a container node and hand back its children.
   * @param into - the parent's children
   * @param node - the node
   */
  private container(into: RootContent[], node: RootContent & { children: RootContent[] }): RootContent[] {
    into.push(node);

    return node.children;
  }

  /**
   * A list node.
   * @param block - the list block
   */
  private list(block: Block): List {
    return { type: 'list', ordered: block.ordered, start: block.ordered ? block.start : null, children: [] };
  }

  /**
   * A list item, with its GFM task state.
   * @param block - the item block
   */
  private item(block: Block): ListItem {
    const first = block.children[0];
    const node: ListItem = { type: 'listItem', checked: null, children: [] };

    if (!this.options.gfm || block.noTask || first === undefined || first.kind !== 'paragraph') {
      return node;
    }

    const { joined, rest } = extractDefinitions(first);
    const leading = trimStart(rest);
    const start = joined.length - leading.length;
    const text = trimEnd(leading);
    const check = taskCheck(text, columnAt(first, start));

    if (check !== null) {
      node.checked = check.checked;
      this.taskRest.set(first, { text: check.rest, start: start + text.length - check.rest.length });
    }

    return node;
  }

  /**
   * A footnote definition node.
   * @param block - the footnote block
   */
  private footnote(block: Block): FootnoteDefinition {
    const identifier = normalizeIdentifier(block.label);

    this.footnotes.add(identifier);

    return { type: 'footnoteDefinition', identifier, label: decodeString(block.label), children: [] };
  }

  /**
   * Append a leaf's nodes.
   * @param block - the leaf
   * @param into - the parent's children
   */
  private leaf(block: Block, into: RootContent[]): void {
    switch (block.kind) {
      case 'paragraph':
        this.paragraph(block, into);
        break;
      case 'heading':
        this.heading(block, into);
        break;
      case 'thematicBreak':
        into.push({ type: 'thematicBreak' });
        break;
      case 'code':
        into.push(this.code(block));
        break;
      case 'math':
        into.push(this.math(block));
        break;
      case 'html':
        into.push({ type: 'html', value: joinLines(block) } satisfies Html);
        break;
      case 'table':
        into.push(this.table(block));
        break;
      case 'document':
      case 'blockquote':
      case 'list':
      case 'item':
      case 'footnote':
        break;
    }
  }

  /**
   * Register and append definitions.
   * @param definitions - parsed definitions
   * @param into - the parent's children
   */
  private addDefinitions(definitions: Definition[], into: RootContent[]): void {
    for (const definition of definitions) {
      this.definitions.add(definition.identifier);
      into.push(definition);
    }
  }

  /**
   * A paragraph: its leading definitions, then the paragraph if text is left.
   * @param block - the paragraph block
   * @param into - the parent's children
   */
  private paragraph(block: Block, into: RootContent[]): void {
    const { joined, definitions, rest } = extractDefinitions(block);

    this.addDefinitions(definitions, into);

    if (rest === '') {
      return;
    }

    const leading = trimStart(rest);
    const { text, start } = this.taskRest.get(block) ?? { text: leading, start: joined.length - leading.length };
    const node: Paragraph = { type: 'paragraph', children: [] };

    into.push(node);
    this.inline.push({ node, raw: trimEnd(text), lineColumns: lineColumns(block, start) });
  }

  /**
   * A heading; a setext heading also brings the definitions before it.
   * @param block - the heading block
   * @param into - the parent's children
   */
  private heading(block: Block, into: RootContent[]): void {
    const node: Heading = { type: 'heading', depth: headingDepth(block.depth), children: [] };

    if (!block.setext) {
      into.push(node);
      this.inline.push({ node, raw: block.raw });

      return;
    }

    const { joined, definitions, rest } = extractDefinitions(block);

    this.addDefinitions(definitions, into);
    into.push(node);
    this.inline.push({ node, raw: block.raw, lineColumns: lineColumns(block, joined.length - trimStart(rest).length) });
  }

  /**
   * A code node. Fenced code splits its info string into lang and meta.
   * @param block - the code block
   */
  private code(block: Block): Code {
    if (!block.fenced) {
      const lines = block.lines.slice(0, block.lines.length - block.blankTail);

      return { type: 'code', lang: null, meta: null, value: dropFinalEnding(joinLines({ ...block, lines })) };
    }

    const { lang, meta } = splitInfo(block.info);

    return {
      type: 'code',
      lang: lang === null ? null : decodeString(lang),
      meta: meta === null ? null : decodeString(meta),
      value: this.fencedValue(block),
    };
  }

  /**
   * A math node.
   * @param block - the math block
   */
  private math(block: Block): Math {
    const meta = block.info.slice(skipSpaces(block.info, 0));

    return { type: 'math', meta: meta === '' ? null : decodeString(meta), value: this.fencedValue(block) };
  }

  /**
   * A fenced block's content. Without a closing fence the last line ending
   * that reached the block is not content.
   * @param block - a fenced code or math block
   */
  private fencedValue(block: Block): string {
    const value = joinLines(block);

    return block.closed ? value : dropFinalEnding(value);
  }

  /**
   * A table node, its first row the head.
   * @param block - the table block
   */
  private table(block: Block): Table {
    return {
      type: 'table',
      align: block.align,
      children: block.rows.map((cells) => ({
        type: 'tableRow',
        children: cells.map((raw) => this.cell(raw)),
      })),
    };
  }

  /**
   * A table cell. Its `\|` reaches the inline parser as written: only code
   * reads it as `|` (the `inTable` switch), autolinks and HTML keep it.
   * @param raw - the cell's text
   */
  private cell(raw: string): TableCell {
    const node: TableCell = { type: 'tableCell', children: [] as PhrasingContent[] };

    this.inline.push({ node, raw });

    return node;
  }
}

/**
 * Turn parsed blocks into the mdast root and the inline work list.
 * @param doc - the document block
 * @param options - syntax switches
 */
export const toTree = (doc: Block, options: BlockOptions): BlockResult => {
  const builder = new BlockTreeBuilder(options);
  const root = builder.build(doc);

  return { root, inline: builder.inline, definitions: builder.definitions, footnotes: builder.footnotes };
};
