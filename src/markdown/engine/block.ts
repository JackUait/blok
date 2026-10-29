import type { PhrasingContent, Root } from '../../../types/data-formats/markdown-tree';
import { extractDefinitions } from './block-definitions';
import { makeBlock, type Block, type Kind } from './block-model';
import {
  endsHtmlBlock, htmlBlockStart, isClosingFence, isThematicBreak, scanAtxHeading, scanCodeFence,
  scanDelimiterRow, scanFootnoteLabel, scanListMarker, scanMathFence, setextLevel, splitRow, trimEnd, trimStart,
} from './block-syntax';
import { toTree } from './block-tree';
import { isSpaceOrTab, skipSpaces, TAB_STOP } from './text';

/** A leaf whose inline content is parsed after the block pass. */
export interface PendingInline {
  node: { children: PhrasingContent[] };
  /** The leaf's content with block syntax removed: what the inline parser reads. */
  raw: string;
  /** Start column of each later line whose column is not a tab stop, by its index in `raw`. */
  lineColumns?: ReadonlyMap<number, number>;
}

export interface BlockResult {
  root: Root;
  /** Leaves in document order. */
  inline: PendingInline[];
  /** Identifiers of every link definition (normalized, lower-cased). */
  definitions: Set<string>;
  /** Identifiers of every footnote definition. */
  footnotes: Set<string>;
}

export interface BlockOptions {
  gfm: boolean;
  math: boolean;
}

/**
 * Most containers one inside another; a deeper marker is read as text. A list
 * and its item count once, so lists nest as deep as quotes. The converters and
 * the server runtime (Jint) walk the tree recursively; Jint fails a round trip
 * near 150 list levels or 200 quotes.
 */
export const MAX_CONTAINER_DEPTH = 100;

/** Characters a block start can begin with; any other line is a paragraph line. */
const MAYBE_SPECIAL = new Set(['#', '`', '~', '*', '+', '_', '=', '<', '>', '-', '[', '$', '|', ':', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** What a block start did with the line. */
const enum Start { None, Container, Leaf, Done }

/** What a continuation check did with the line. */
const enum Continue { Matched, Failed, Done }

/**
 * Columns of leading whitespace.
 * @param line - a line
 */
const leadingColumns = (line: string): number => {
  const cursor = { index: 0, columns: 0 };

  while (isSpaceOrTab(line[cursor.index])) {
    cursor.columns += line[cursor.index] === '\t' ? TAB_STOP - (cursor.columns % TAB_STOP) : 1;
    cursor.index++;
  }

  return cursor.columns;
};

/**
 * The block itself when it is a container, else its parent.
 * @param block - any block
 */
const innermostContainer = (block: Block): Block | null => (isContainer(block.kind) ? block : block.parent);

/**
 * Whether blocks of `kind` hold other blocks.
 * @param kind - a block kind
 */
const isContainer = (kind: Kind): boolean =>
  kind === 'document' || kind === 'blockquote' || kind === 'list' || kind === 'item' || kind === 'footnote';

/**
 * Whether one more container fits inside `container` under the cap.
 * Measured from `container` itself, which may be a leaf the new block
 * will close, so it can refuse one level early but never lets one past.
 * @param container - the block new blocks would go into
 */
const fitsUnderCap = (container: Block): boolean => container.nesting < MAX_CONTAINER_DEPTH;

/**
 * The last index holding a character other than `marker`, a space or a tab.
 * @param line - the line
 * @param marker - a thematic break marker
 */
const lastBlocker = (line: string, marker: string): number => {
  const cursor = { index: line.length - 1 };

  while (cursor.index >= 0 && (line[cursor.index] === marker || isSpaceOrTab(line[cursor.index]))) {
    cursor.index--;
  }

  return cursor.index;
};

/**
 * Whether a raw block that a new container line closes keeps the line
 * ending before it; a lazy line drops it.
 * @param block - the block being closed
 */
const keepsLastEnding = (block: Block): boolean =>
  block.kind === 'math' || (block.kind === 'code' && block.fenced) || (block.kind === 'html' && block.htmlKind <= 5);

/**
 * Whether a block of `parent` kind may hold a block of `child` kind.
 * @param parent - the container kind
 * @param child - the new block's kind
 */
const canContain = (parent: Kind, child: Kind): boolean => {
  if (parent === 'list') {
    return child === 'item';
  }

  return (parent === 'document' || parent === 'blockquote' || parent === 'item' || parent === 'footnote') && child !== 'item';
};

/**
 * The block parser: CommonMark's two-phase line algorithm (continue the open
 * blocks, then look for new ones), with micromark's extra rules. Every walk
 * over the open blocks is a loop, so nesting depth never grows the call stack.
 */
class BlockParser {
  private readonly doc: Block = makeBlock('document', null);
  private tip: Block = this.doc;
  private oldTip: Block = this.doc;
  private lastMatched: Block = this.doc;
  private line = '';
  private ending = '';
  private offset = 0;
  private column = 0;
  private nextNonspace = 0;
  private nextNonspaceColumn = 0;
  private indent = 0;
  private indented = false;
  private blank = false;
  private partiallyConsumedTab = false;
  /** The whitespace run last measured on this line. */
  private readonly run = { from: -1, end: -1, column: 0 };
  /** Per marker, the last index on this line holding a character a thematic break of that marker cannot. */
  private readonly breakBlockers = new Map<string, number>();
  /** The line's content once the open containers took their prefixes; a split tab leaves spaces. */
  private content = '';
  /** The column `content` starts at. */
  private contentColumn = 0;
  /** A paragraph or indented code was open with every container matched: lists may not start empty or past 1. */
  private interrupt = false;
  /** A container started on this line. */
  private newContainer = false;
  /** The line is an indented-code line that is blank and short of four columns. */
  private shortBlank = false;
  /** A footnote start on this line was refused at the nesting cap: its text must not read as a link definition. */
  private footnoteRefused = false;

  /**
   * @param options - syntax switches
   */
  constructor(private readonly options: BlockOptions) {}

  /**
   * Parse a whole document.
   * @param source - Markdown source
   */
  public parse(source: string): BlockResult {
    const text = (source.startsWith('\uFEFF') ? source.slice(1) : source).replace(/\0/g, '\uFFFD');
    const cursor = { start: 0, index: 0 };

    while (cursor.index < text.length) {
      const char = text[cursor.index];

      if (char !== '\n' && char !== '\r') {
        cursor.index++;
        continue;
      }

      const width = char === '\r' && text[cursor.index + 1] === '\n' ? 2 : 1;

      this.incorporate(text.slice(cursor.start, cursor.index), text.slice(cursor.index, cursor.index + width));
      cursor.index += width;
      cursor.start = cursor.index;
    }

    this.incorporate(text.slice(cursor.start), '');

    while (this.tip !== this.doc) {
      this.finalize(this.tip);
    }

    return toTree(this.doc, this.options);
  }

  /**
   * Feed one line.
   * @param line - the line without its ending
   * @param ending - the line ending
   */
  private incorporate(line: string, ending: string): void {
    this.line = line;
    this.ending = ending;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.oldTip = this.tip;
    this.run.from = -1;
    this.run.end = -1;
    this.breakBlockers.clear();
    this.newContainer = false;
    this.shortBlank = false;
    this.footnoteRefused = false;

    const container = this.continueOpenBlocks();

    if (container === null) {
      return;
    }

    this.lastMatched = container;
    this.content = this.restOfLine();
    this.contentColumn = this.column;
    this.interrupt = container.kind === 'paragraph'
      || (this.oldTip.kind === 'code' && !this.oldTip.fenced && container === this.oldTip.parent);

    const started = this.openNewBlocks(container);

    if (started !== null) {
      this.addRest(started);
    }
  }

  /**
   * Match the line against each open block, outermost first. Returns the
   * deepest block it continues, or null when a block used the whole line.
   */
  private continueOpenBlocks(): Block | null {
    const state = { container: this.doc };

    for (;;) {
      const last = state.container.children[state.container.children.length - 1];

      if (last === undefined || !last.open) {
        return state.container;
      }

      this.findNextNonspace();

      const result = this.continueBlock(last);

      if (result === Continue.Done) {
        return null;
      }

      if (result === Continue.Failed) {
        return state.container;
      }

      state.container = last;
    }
  }

  /**
   * Try every block start until none matches or a leaf opens. Returns the
   * block the rest of the line belongs to, or null when the line is used up.
   * @param matched - the deepest block the line continued
   */
  private openNewBlocks(matched: Block): Block | null {
    const state = { container: matched };

    while (!this.acceptsLines(state.container)) {
      this.findNextNonspace();

      if (!this.indented && !MAYBE_SPECIAL.has(this.line[this.nextNonspace])) {
        this.advanceNextNonspace();
        break;
      }

      const result = this.tryStarts(state.container);

      if (result === Start.Done) {
        return null;
      }

      if (result === Start.None) {
        this.advanceNextNonspace();
        break;
      }

      state.container = this.tip;

      if (result === Start.Leaf) {
        break;
      }
    }

    return state.container;
  }

  /**
   * Whether a block takes the rest of a line as content without looking for
   * new blocks in it.
   * @param block - the block
   */
  private acceptsLines(block: Block): boolean {
    return block.kind === 'code' || block.kind === 'html' || block.kind === 'math';
  }

  /**
   * Put what is left of the line where it belongs.
   * @param container - the block the line ended up in
   */
  private addRest(container: Block): void {
    if (this.tip !== this.lastMatched && !this.blank && this.tip.kind === 'paragraph' && this.lastMatched === container) {
      this.addParagraphLine(this.tip, this.content, this.contentColumn);

      return;
    }

    const afterTable = this.oldTip.kind === 'table' && this.isLazy();

    this.closeUnmatched();

    if (this.acceptsLines(container)) {
      this.addLine(container);

      if (container.kind === 'code' && !container.fenced) {
        Object.assign(container, { blankTail: this.shortBlank ? container.blankTail + 1 : 0 });
      }

      if (container.kind === 'code' && !container.fenced && container.closed) {
        this.finalize(container);
      }

      if (container.kind === 'html' && endsHtmlBlock(container.htmlKind, container.lines[container.lines.length - 1], container.lines.length === 1)) {
        this.finalize(container);
      }

      return;
    }

    if (this.blank) {
      return;
    }

    if (container.kind === 'table') {
      container.rows.push(splitRow(this.line.slice(this.nextNonspace)));

      return;
    }

    if (container.kind === 'paragraph') {
      this.addParagraphLine(container, this.content, this.contentColumn);

      return;
    }

    const paragraph = this.addChild('paragraph');

    // A lazy line after a table can never be a table head.
    paragraph.noHead = afterTable;
    this.addParagraphLine(paragraph, this.line.slice(this.nextNonspace), this.nextNonspaceColumn);
  }

  /**
   * Check one open block against the line, consuming its prefix.
   * @param block - an open block
   */
  private continueBlock(block: Block): Continue {
    switch (block.kind) {
      case 'blockquote':
        return this.continueBlockquote();
      case 'item':
        return this.continueItem(block);
      case 'footnote':
        return this.continueFootnote(block);
      case 'code':
        return block.fenced ? this.continueFence(block, block.fenceChar) : this.continueIndentedCode();
      case 'math':
        return this.continueFence(block, '$');
      case 'html':
        return this.blank && block.htmlKind >= 6 ? Continue.Failed : Continue.Matched;
      case 'paragraph':
      case 'table':
        return this.blank ? Continue.Failed : Continue.Matched;
      case 'list':
        return Continue.Matched;
      case 'document':
      case 'heading':
      case 'thematicBreak':
        return Continue.Failed;
    }
  }

  /** `>` with up to three spaces before it, and one optional space after. */
  private continueBlockquote(): Continue {
    if (this.indented || this.line[this.nextNonspace] !== '>') {
      return Continue.Failed;
    }

    this.advanceNextNonspace();
    this.advanceOffset(1, false);

    if (isSpaceOrTab(this.line[this.offset])) {
      this.advanceOffset(1, true);
    }

    return Continue.Matched;
  }

  /**
   * An item continues on a blank line, or on a line indented by its size.
   * After a blank first line and then another blank line, it ends.
   * @param item - the item
   */
  private continueItem(item: Block): Continue {
    if (this.blank) {
      Object.assign(item, { furtherBlank: item.furtherBlank || item.initialBlank });
      this.advanceOffset(Math.min(this.indent, item.size), true);

      return Continue.Matched;
    }

    const further = item.furtherBlank;
    const firstContent = item.initialBlank && item.children.length === 0;

    Object.assign(item, { furtherBlank: false, initialBlank: false });

    if (further || this.indent < item.size) {
      return Continue.Failed;
    }

    this.advanceOffset(item.size, true);
    // Indentation left over before an item's first content rules out a task box.
    Object.assign(item, { noTask: item.noTask || (firstContent && this.nextNonspaceColumn > this.column) });

    return Continue.Matched;
  }

  /**
   * A footnote definition continues on blank lines and lines indented by
   * four. Inside another footnote that just took four columns, a line with no
   * indentation left continues it too: the outer footnote's indent counts
   * for the inner one.
   * @param footnote - the footnote block
   */
  private continueFootnote(footnote: Block): Continue {
    if (this.blank || (this.indent === 0 && footnote.parent?.kind === 'footnote')) {
      return Continue.Matched;
    }

    if (this.indent < TAB_STOP) {
      return Continue.Failed;
    }

    this.advanceOffset(TAB_STOP, true);

    return Continue.Matched;
  }

  /** Indented code continues on lines indented by four, and on blank lines. */
  private continueIndentedCode(): Continue {
    if (this.indent >= TAB_STOP) {
      this.advanceOffset(TAB_STOP, true);
    } else if (this.blank) {
      this.shortBlank = true;
      this.advanceNextNonspace();
    } else {
      return Continue.Failed;
    }

    return Continue.Matched;
  }

  /**
   * A fenced block ends at its closing fence; other lines lose up to the
   * opening fence's indentation.
   * @param block - a fenced code or math block
   * @param char - the fence character
   */
  private continueFence(block: Block, char: string): Continue {
    if (!this.indented && isClosingFence(this.line, this.nextNonspace, char, block.fenceLength)) {
      Object.assign(block, { closed: true });
      this.finalize(block);

      return Continue.Done;
    }

    const state = { left: block.fenceOffset };

    while (state.left > 0 && isSpaceOrTab(this.line[this.offset])) {
      this.advanceOffset(1, true);
      state.left--;
    }

    return Continue.Matched;
  }

  /**
   * Try each block start at the current position, in precedence order.
   * @param container - the block new blocks would go into
   */
  private tryStarts(container: Block): Start {
    const starts = [
      this.startBlockquote, this.startFootnote, this.startAtxHeading, this.startCodeFence, this.startMathFence,
      this.startHtml, this.startSetext, this.startThematicBreak, this.startListItem, this.startTable,
      this.startIndentedCode,
    ];

    for (const start of starts) {
      const result = start.call(this, container);

      if (result !== Start.None) {
        return result;
      }
    }

    return Start.None;
  }

  /**
   * `>` starts a block quote.
   * @param container - the block it would go into
   */
  private startBlockquote(container: Block): Start {
    if (this.indented || this.line[this.nextNonspace] !== '>' || !fitsUnderCap(container)) {
      return Start.None;
    }

    this.continueBlockquote();
    this.closeUnmatched(true);
    this.addChild('blockquote');

    return Start.Container;
  }

  /**
   * `[^label]:` starts a GFM footnote definition.
   * @param container - the block it would go into
   */
  private startFootnote(container: Block): Start {
    const found = this.options.gfm && !this.indented ? scanFootnoteLabel(this.line, this.nextNonspace) : null;

    if (found === null) {
      return Start.None;
    }

    if (!fitsUnderCap(container)) {
      this.footnoteRefused = true;

      return Start.None;
    }

    this.closeUnmatched(true);
    this.addChild('footnote').label = found.label;
    this.advanceNextNonspace();
    this.advanceOffset(found.end - this.offset, false);
    this.findNextNonspace();
    this.advanceNextNonspace();

    return Start.Container;
  }

  /** `#` to `######` start an ATX heading. */
  private startAtxHeading(): Start {
    const heading = this.indented ? null : scanAtxHeading(this.line, this.nextNonspace);

    if (heading === null) {
      return Start.None;
    }

    this.closeUnmatched();

    const block = this.addChild('heading');

    block.depth = heading.depth;
    block.raw = heading.raw;
    this.finalize(block);

    return Start.Done;
  }

  /** Three or more backticks or tildes open fenced code. */
  private startCodeFence(): Start {
    const fence = this.indented ? null : scanCodeFence(this.line, this.nextNonspace);

    if (fence === null) {
      return Start.None;
    }

    this.closeUnmatched();
    this.openFence(this.addChild('code'), fence.char, fence.length, fence.info);

    return Start.Done;
  }

  /** Two or more dollars open a math block. */
  private startMathFence(): Start {
    const fence = this.options.math && !this.indented ? scanMathFence(this.line, this.nextNonspace) : null;

    if (fence === null) {
      return Start.None;
    }

    this.closeUnmatched();
    this.openFence(this.addChild('math'), '$', fence.length, fence.info);

    return Start.Done;
  }

  /**
   * Fill in a fenced block's opening.
   * @param block - the new code or math block
   * @param char - the fence character
   * @param length - the fence length
   * @param info - what follows the fence
   */
  private openFence(block: Block, char: string, length: number, info: string): void {
    Object.assign(block, { fenced: true, fenceChar: char, fenceLength: length, fenceOffset: this.indent, info });
  }

  /**
   * `<` starts an HTML block when it matches one of the seven kinds.
   * @param container - the block it would go into
   */
  private startHtml(container: Block): Start {
    const kind = this.indented ? 0 : htmlBlockStart(this.line, this.nextNonspace, container.kind === 'paragraph');

    if (kind === 0) {
      return Start.None;
    }

    if (kind === 7 && this.tip.kind === 'paragraph' && this.isLazy() && this.ending !== '') {
      // This interruption is decided only on the next line, by when the line
      // already sits inside the open containers.
      this.finalize(this.tip);
      this.lastMatched = this.tip;
      this.oldTip = this.tip;
    }

    this.closeUnmatched();
    this.addChild('html').htmlKind = kind;

    return Start.Leaf;
  }

  /** The line left an open container unmatched without starting a new one. */
  private isLazy(): boolean {
    return !this.newContainer && innermostContainer(this.oldTip) !== innermostContainer(this.lastMatched);
  }

  /**
   * `===` or `---` under a paragraph turns it into a heading, unless the
   * paragraph is only link definitions.
   * @param container - the block it would go into
   */
  private startSetext(container: Block): Start {
    const level = !this.indented && container.kind === 'paragraph' ? setextLevel(this.line, this.nextNonspace) : 0;

    if (level === 0) {
      return Start.None;
    }

    const { rest } = extractDefinitions(container);

    if (rest === '') {
      return Start.None;
    }

    this.closeUnmatched();
    Object.assign(container, { kind: 'heading', setext: true, depth: level, raw: trimEnd(trimStart(rest)) });
    this.finalize(container);

    return Start.Done;
  }

  /** `***`, `---` or `___` makes a thematic break. */
  private startThematicBreak(): Start {
    if (this.indented || !this.isThematicBreakHere()) {
      return Start.None;
    }

    this.closeUnmatched();
    this.finalize(this.addChild('thematicBreak'));

    return Start.Done;
  }

  /**
   * A bullet or ordered marker starts a list item, and a list when the
   * marker differs from the open list's.
   * @param container - the block it would go into
   */
  private startListItem(container: Block): Start {
    const found = this.indented ? null : scanListMarker(this.line, this.nextNonspace);

    if (found === null || (found.end < this.line.length && !isSpaceOrTab(this.line[found.end]))) {
      return Start.None;
    }

    const sameList = container.kind === 'list' && container.marker === found.marker && container.ordered === found.ordered;

    if (!fitsUnderCap(container)) {
      return Start.None;
    }

    if ((found.marker === '*' || found.marker === '-') && this.isThematicBreakHere()) {
      return Start.None;
    }

    const blankItem = skipSpaces(this.line, found.end) === this.line.length;

    if (this.interrupt && (blankItem || (found.ordered && found.digits !== '1'))) {
      return Start.None;
    }

    const markerOffset = this.indent;

    this.closeUnmatched(true);

    if (!sameList) {
      const list = this.addChild('list');

      list.marker = found.marker;
      list.ordered = found.ordered;
      list.start = Number.parseInt(found.digits || '0', 10);
    }

    const item = this.addChild('item');

    this.advanceNextNonspace();
    this.advanceOffset(found.end - this.offset, true);
    item.size = markerOffset + found.end - this.nextNonspace + this.consumeItemPadding(blankItem);
    item.initialBlank = blankItem;
    item.noTask = blankItem && found.end < this.line.length;

    return Start.Container;
  }

  /**
   * Consume the spaces after a list marker; returns their width. One to four
   * columns count; more means indented code, so only one counts.
   * @param blankItem - the rest of the line is blank
   */
  private consumeItemPadding(blankItem: boolean): number {
    if (blankItem) {
      return 1;
    }

    this.findNextNonspace();

    const width = this.nextNonspaceColumn - this.column;

    if (width <= TAB_STOP) {
      this.advanceNextNonspace();

      return width;
    }

    this.advanceOffset(1, true);

    return 1;
  }

  /**
   * A GFM delimiter row under a paragraph turns its last line into a table
   * head, when the cell counts agree.
   * @param container - the block it would go into
   */
  private startTable(container: Block): Start {
    if (!this.options.gfm || this.indented || container.kind !== 'paragraph') {
      return Start.None;
    }

    const align = scanDelimiterRow(this.line, this.nextNonspace);
    const lastLine = container.lines[container.lines.length - 1];
    const head = lastLine.slice(skipSpaces(lastLine, 0));
    const cells = splitRow(head);

    // An indented continuation line is plain paragraph text, never a head row.
    if (
      align === null || cells.length !== align.length || trimEnd(head) === '|' || leadingColumns(lastLine) >= TAB_STOP
      || (container.noHead && container.lines.length === 1)
    ) {
      return Start.None;
    }

    this.closeUnmatched();
    container.lines.pop();
    container.columns.pop();

    const headEnding = container.endings.pop() ?? '';

    if (container.lines.length === 0) {
      this.removeTip();
    } else {
      this.finalize(container);
    }

    // Once the table has ended the paragraph, the head line is read afresh:
    // an HTML tag line that could not interrupt now starts HTML.
    if (htmlBlockStart(head, 0, false) === 7) {
      const html = this.addChild('html');

      html.htmlKind = 7;
      html.lines.push(lastLine);
      html.endings.push(headEnding);

      return Start.Leaf;
    }

    const table = this.addChild('table');

    table.align = align;
    table.rows.push(cells);

    return Start.Done;
  }

  /** Four columns of indentation start indented code, except in a paragraph. */
  private startIndentedCode(): Start {
    if (!this.indented || this.tip.kind === 'paragraph' || this.blank) {
      return Start.None;
    }

    const lazy = this.isLazy();

    this.advanceOffset(TAB_STOP, true);
    this.closeUnmatched();
    // Code begun on a lazy line ends with it: laziness is checked before the line ending.
    this.addChild('code').closed = lazy;

    return Start.Leaf;
  }

  /** Drop the tip, an empty paragraph, from its parent. */
  private removeTip(): void {
    const { parent } = this.tip;

    if (parent !== null) {
      parent.children.pop();
      this.tip = parent;
    }
  }

  /**
   * Open a block at the tip, closing blocks that cannot hold it.
   * @param kind - the new block's kind
   */
  private addChild(kind: Kind): Block {
    while (!canContain(this.tip.kind, kind)) {
      this.finalize(this.tip);
    }

    const block = makeBlock(kind, this.tip);

    block.nesting = this.tip.nesting + (isContainer(kind) && kind !== 'list' ? 1 : 0);
    this.tip.children.push(block);
    this.tip = block;

    return block;
  }

  /** Close the blocks this line did not continue. */
  private closeUnmatched(newContainer = false): void {
    while (this.oldTip !== this.lastMatched && this.oldTip.parent !== null) {
      const parent: Block = this.oldTip.parent;

      this.newContainer ||= newContainer;

      if (newContainer && keepsLastEnding(this.oldTip)) {
        this.oldTip.lines.push('');
        this.oldTip.endings.push('');
      }

      this.finalize(this.oldTip);
      this.oldTip = parent;
    }
  }

  /**
   * Close a block; the tip moves to its parent.
   * @param block - an open block
   */
  private finalize(block: Block): void {
    const { parent } = block;

    Object.assign(block, { open: false });

    if (parent !== null) {
      this.tip = parent;
    }
  }

  /** The line from the current offset. A tab cut by a container prefix leaves its remaining columns as spaces. */
  private restOfLine(): string {
    return this.partiallyConsumedTab
      ? ' '.repeat(TAB_STOP - (this.column % TAB_STOP)) + this.line.slice(this.offset + 1)
      : this.line.slice(this.offset);
  }

  /**
   * Add the rest of the line to a code, HTML or math block.
   * @param block - the leaf
   */
  private addLine(block: Block): void {
    block.lines.push(this.restOfLine());
    block.endings.push(this.ending);
  }

  /**
   * Add a line to a paragraph. Continuation lines keep their indentation,
   * which a multi-line definition label keeps.
   * @param paragraph - the paragraph
   * @param text - the line's content
   * @param column - the column it starts at
   */
  private addParagraphLine(paragraph: Block, text: string, column: number): void {
    if (this.footnoteRefused) {
      Object.assign(paragraph, { definitionLines: Math.min(paragraph.definitionLines, paragraph.lines.length) });
    }

    paragraph.lines.push(text);
    paragraph.endings.push(this.ending);
    paragraph.columns.push(column);
  }

  /**
   * Whether the rest of the line is a thematic break. A line of nested
   * `- - - … x` asks once per level, so the answer for "no" is cached.
   */
  private isThematicBreakHere(): boolean {
    const marker = this.line[this.nextNonspace];
    const cached = this.breakBlockers.get(marker);
    const blocker = cached ?? lastBlocker(this.line, marker);

    this.breakBlockers.set(marker, blocker);

    return blocker < this.nextNonspace && isThematicBreak(this.line, this.nextNonspace);
  }

  /** Measure the whitespace from the current offset. */
  private findNextNonspace(): void {
    // Deeply nested items re-measure the same indentation once per level:
    // the end of a whitespace run and its column do not depend on where in
    // the run the scan starts, so one scan serves them all.
    if (this.offset < this.run.from || this.offset > this.run.end) {
      const cursor = { index: this.offset, columns: this.column };

      while (isSpaceOrTab(this.line[cursor.index])) {
        cursor.columns += this.line[cursor.index] === '\t' ? TAB_STOP - (cursor.columns % TAB_STOP) : 1;
        cursor.index++;
      }

      this.run.from = this.offset;
      this.run.end = cursor.index;
      this.run.column = cursor.columns;
    }

    this.blank = this.run.end >= this.line.length;
    this.nextNonspace = this.run.end;
    this.nextNonspaceColumn = this.run.column;
    this.indent = this.run.column - this.column;
    this.indented = this.indent >= TAB_STOP;
  }

  /** Move to the first character that is not whitespace. */
  private advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  /**
   * Move forward by characters, or by columns so a tab can be split.
   * @param count - how far
   * @param columns - count columns rather than characters
   */
  private advanceOffset(count: number, columns: boolean): void {
    const state = { left: count };

    while (state.left > 0 && this.offset < this.line.length) {
      if (this.line[this.offset] !== '\t') {
        this.partiallyConsumedTab = false;
        this.offset++;
        this.column++;
        state.left--;
        continue;
      }

      const toTab = TAB_STOP - (this.column % TAB_STOP);

      if (columns && toTab > state.left) {
        this.partiallyConsumedTab = true;
        this.column += state.left;
        state.left = 0;
        continue;
      }

      this.partiallyConsumedTab = false;
      this.column += toTab;
      this.offset++;
      state.left -= columns ? toTab : 1;
    }
  }
}

/**
 * Parse the block structure of a document.
 * @param source - Markdown source
 * @param options - syntax switches
 */
export const parseBlocks = (source: string, options: BlockOptions): BlockResult => new BlockParser(options).parse(source);
