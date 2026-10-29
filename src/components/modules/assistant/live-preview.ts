import { readPartialCommands } from '../../../agent/partial-json';
import type { PartialCommand } from '../../../agent/partial-json';
import { ALERT_KINDS, ALERT_MARKER, ALERT_STYLE } from '../../../markdown/alerts';
import type { AlertKind } from '../../../markdown/alerts';
import { normalizeFenceLang } from '../../../markdown/fence-language';
import { isInlineMath } from '../../../markdown/math-syntax';
import { renderLatex } from '../../../shared/katex';
import { DIVIDER_RULE_CLASSES, DIVIDER_WRAPPER_CLASSES } from '../../../shared/tool-classes/divider';
import { headerClasses } from '../../../shared/tool-classes/header';
import { LIST_CONTENT_CLASSES, LIST_ITEM_CLASSES, LIST_ITEM_ROW_CLASSES } from '../../../shared/tool-classes/list';
import { PARAGRAPH_CLASSES } from '../../../shared/tool-classes/paragraph';
import { quoteClasses } from '../../../shared/tool-classes/quote';
import { DEFAULT_LANGUAGE, GUTTER_LINE_STYLES, LANGUAGE_COLORS, LANGUAGES, PLAIN_TEXT_KEY, PREVIEWABLE_LANGUAGES } from '../../../tools/code/constants';
import { buildCalloutDOM } from '../../../tools/callout/dom-builder';
import { buildCodeDOM, setActiveViewMode } from '../../../tools/code/dom-builder';
import { createMarker } from '../../../tools/list/dom-builder';
import { DATA_ATTR } from '../../constants/data-attributes';
import { colorVarName } from '../../shared/color-presets';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { makePreview } from '../../utils/media-empty-preview';
import { isSafeRasterImageDataUrl, safeImageSrc, stripIgnoredUrlChars } from '../../utils/sanitize-url';
import { findTextMatches } from '../../../shared/text-match';

import { gapSize, holdGapChanges, releaseGap, reserveGap } from './gap';
import type { GapSide } from './gap';

export interface LivePreviewDeps {
  /** Overlay host: UI.nodes.wrapper. */
  layer: HTMLElement;
  holderOf(id: string): HTMLElement | null;
  edgeHolder(edge: 'start' | 'end', parentId?: string): HTMLElement | null;
  /** The bar's block. */
  anchorHolder(): HTMLElement | null;
  /**
   * The input that shows a block's rich-text field (`field` missing: the first).
   * Without it, a named field previews only when the block has a single input.
   */
  inputOf?(id: string, field?: string): HTMLElement | null;
  /** A layout is about to place boxes, before its gap writes: the preview now shows where edits land. */
  onDraw?(): void;
  /** The editor's message for a key; without it, a label that comes from messages shows empty. */
  t?(key: string): string;
}

export interface LivePreview {
  /** From tool_input: the `blok_execute` input JSON so far. */
  update(callId: string, json: string): void;
  /** Batch applied: clear on the next frame. */
  settle(callId: string): void;
  /** Failed, stopped or cut off. */
  cancel(callId: string): void;
  clear(): void;
  /** Re-place every box on the next frame, after a scroll, resize or committed batch. */
  relayout(): void;
  /** Blocks this call drew a rewrite over, kept after it ends. Its other rewrites need the fallback reveal. */
  framed(callId: string): string[];
  /** Whether a frame has painted one of this call's words. A call sent whole in one tick never is. */
  shown(callId: string): boolean;
}

/** Words land at least this far apart, so a burst of deltas still reads as typing. Reduced motion skips it. */
const WORD_GAP_MS = 35;

const INSERTS = new Set(['block.insert', 'markdown.insert']);

type Translate = (key: string) => string;

type Kind = 'paragraph' | 'header' | 'list' | 'rewrite' | 'table' | 'quote' | 'code' | 'divider' | 'callout' | 'image';
type ListStyle = 'unordered' | 'ordered' | 'checklist';

/** One table cell. `placement`: the importer's, from the column's alignment. */
interface CellSpec { text: string; complete: boolean; placement?: string }

/**
 * `before` / `after`: a rewrite's text outside the replaced range.
 * `rows`: a table's cells, every row as wide as the widest. `heading`: its first row is a heading row.
 * `children`: a callout's body blocks. `color` / `background`: a callout's preset names.
 * `url`: an image's source, once it is whole and safe; its `text` is the caption.
 */
interface LineSpec {
  kind: Kind;
  level: number;
  style: ListStyle;
  text: string;
  complete: boolean;
  before?: string;
  after?: string;
  rows?: CellSpec[][];
  heading?: boolean;
  language?: string;
  emoji?: string;
  color?: string;
  background?: string;
  children?: LineSpec[];
  url?: string;
}

/** A whole URL the importer keeps as an image. The image view decides what it loads. */
const loadable = (value: unknown, whole: boolean): string | undefined =>
  (whole && typeof value === 'string' ? safeImageSrc(value) ?? undefined : undefined);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A key is final once a later key has started, or the command is done. */
const settled = (record: Record<string, unknown>, key: string, done: boolean): boolean => {
  const keys = Object.keys(record);

  return done || (keys.includes(key) && keys.indexOf(key) < keys.length - 1);
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };

const decodeEntity = (match: string, body: string): string => {
  const hex = body.startsWith('#x') || body.startsWith('#X');
  const code = body.startsWith('#') ? parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10) : NaN;

  if (code >= 0 && code <= 0x10ffff) {
    return String.fromCodePoint(code);
  }

  return ENTITIES[body.toLowerCase()] ?? match;
};

/** Drops a tag or entity cut off at the end; it shows once it is whole. */
const withoutCutTail = (html: string): string => {
  const lt = html.lastIndexOf('<');
  const tagless = lt > html.lastIndexOf('>') ? html.slice(0, lt) : html;
  const amp = tagless.lastIndexOf('&');

  return amp >= 0 && /^&#?\w*$/.test(tagless.slice(amp)) ? tagless.slice(0, amp) : tagless;
};

/** Plain text of streamed inline HTML. Never parsed as HTML. A finished field keeps a literal `<` or `&`. */
const plainText = (html: string, complete: boolean): string =>
  (complete ? html : withoutCutTail(html))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, decodeEntity);

const richText = (value: unknown, complete: boolean): string => {
  if (typeof value === 'string') {
    return plainText(value, complete);
  }
  if (Array.isArray(value)) {
    return value.map((segment) => {
      if (typeof segment === 'string') {
        return segment;
      }

      return isRecord(segment) && typeof segment.text === 'string' ? segment.text : '';
    }).join('');
  }

  return '';
};

const listStyle = (value: unknown): ListStyle => (value === 'ordered' || value === 'checklist' ? value : 'unordered');

/** Every row as wide as the widest, and at least one cell, so the grid has a shape before content arrives. */
const padRows = (rows: CellSpec[][]): CellSpec[][] => {
  const cols = Math.max(1, ...rows.map((row) => row.length));
  const filled = rows.length > 0 ? rows : [[]];

  return filled.map((row) => [...row, ...Array.from({ length: cols - row.length }, () => ({ text: '', complete: true }))]);
};

/** A table's `data.content`: string cells show; a cell that names child blocks has no text here. */
const contentRows = (content: unknown, complete: boolean): CellSpec[][] => {
  const rows = Array.isArray(content) ? content.filter((row): row is unknown[] => Array.isArray(row)) : [];
  const last = rows.length - 1;

  return padRows(rows.map((row, r) => row.map((cell, c) => {
    // Only the newest cell may still be cut off.
    const done = complete || r < last || c < row.length - 1;

    return { text: richText(isRecord(cell) ? cell.text : cell, done), complete: done };
  })));
};

const codeLanguage = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : DEFAULT_LANGUAGE);

const blockLine = (command: PartialCommand): LineSpec => {
  const { args, done } = command;
  const data = isRecord(args.data) ? args.data : {};
  const type = args.type;
  const dataDone = done || settled(args, 'data', done);
  const complete = dataDone || settled(data, 'text', done);
  const level = typeof data.level === 'number' && data.level >= 1 && data.level <= 6 ? data.level : 2;
  const base = { level, style: listStyle(data.style), complete };

  if (type === 'table') {
    const tableDone = dataDone || settled(data, 'content', done);

    return { ...base, kind: 'table', text: '', complete: tableDone, rows: contentRows(data.content, tableDone), heading: data.withHeadings === true };
  }
  if (type === 'code') {
    const codeDone = dataDone || settled(data, 'code', done);

    return { ...base, kind: 'code', text: typeof data.code === 'string' ? data.code : '', complete: codeDone, language: codeLanguage(data.language) };
  }
  if (type === 'divider') {
    return { ...base, kind: 'divider', text: '', complete: true };
  }
  if (type === 'image') {
    const caption = typeof data.caption === 'string' ? data.caption : '';

    return { ...base, kind: 'image', text: caption, complete: dataDone || settled(data, 'caption', done), url: loadable(data.url, dataDone || settled(data, 'url', done)) };
  }
  if (type === 'callout') {
    const name = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

    // Its text comes in child blocks of their own, so it shows one empty paragraph, as an empty callout does.
    return {
      ...base, kind: 'callout', text: '', complete: true, emoji: typeof data.emoji === 'string' ? data.emoji : '',
      color: name(data.textColor), background: name(data.backgroundColor), children: [{ ...base, kind: 'paragraph', text: '', complete: true }],
    };
  }
  const kind: Kind = type === 'header' || type === 'list' || type === 'quote' ? type : 'paragraph';

  return { ...base, kind, text: richText(data.text, complete) };
};

/** Marks come off in pairs, so a lone `*` ("2 * 3") stays. */
const EMPHASIS = [/\*\*([^*]+)\*\*/g, /__([^_]+)__/g, /~~([^~]+)~~/g, /`([^`]*)`/g, /\*(?=\S)([^*]*[^*\s])\*/g];

/** While a line streams, an opening mark whose closer has not arrived yet. */
const OPENER = /(^|\s)(\*\*|__|~~|\*|`|\[)(?=\S)/g;

const inlineMarkdown = (text: string, complete: boolean): string => {
  const unmarked = EMPHASIS.reduce((result, pattern) => result.replace(pattern, '$1'), text.replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1'));

  return plainText(complete ? unmarked : unmarked.replace(OPENER, '$1'), complete);
};

const listMatch = (check: RegExpExecArray | null, bullet: RegExpExecArray | null, number: RegExpExecArray | null): [ListStyle, string] => {
  if (check) {
    return ['checklist', check[1]];
  }
  if (bullet) {
    return ['unordered', bullet[1]];
  }

  return ['ordered', number?.[1] ?? ''];
};

/** Only a block marker so far ("##", "-", "1."): the line's kind is not known yet. */
const MARKER_ONLY = /^(#{1,6}|[-*+]|\d+[.)]?)$/;

/** Only break marks so far ("--", "**"): a divider, an underline or emphasis, not known yet. */
const MARKS_ONLY = /^ {0,3}([-*_=])( *\1)* *$/;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/** Three or more of one mark and nothing else: a divider. */
const THEMATIC = /^ {0,3}([-*_])( *\1){2,} *$/;

/** Under a paragraph, `===` makes it a heading 1 and `---` a heading 2. */
const SETEXT = /^ {0,3}(=+|-+) *$/;

const QUOTE = /^ {0,3}> ?(.*)$/;

/** Lines that start another block, so they end a table. */
const BLOCK_START = /^ {0,3}(#{1,6}(\s|$)|>|`{3}|~{3}|([-*+]|\d+[.)])(\s|$))/;

/** The importer's placements; left is the default, so it has none. */
const ALIGN_PLACEMENT: Record<string, string> = { center: 'top-center', right: 'top-right' };

const DELIMITER_CELL = /^:?-+:?$/;

/** Stands in for an escaped pipe while a row is split. */
const ESCAPED_PIPE = '\uE000';

/** A table row's cells, and whether its closing pipe has arrived. */
const splitRow = (line: string): { cells: string[]; closed: boolean } => {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const closed = /(^|[^\\])\|$/.test(inner);
  const body = closed ? inner.slice(0, -1) : inner;

  return {
    cells: body.replace(/\\\|/g, ESCAPED_PIPE).split('|').map((cell) => cell.split(ESCAPED_PIPE).join('|').trim()),
    closed,
  };
};

const alignOf = (cell: string): string | undefined => {
  if (/^:-+:$/.test(cell)) {
    return ALIGN_PLACEMENT.center;
  }

  return /^-+:$/.test(cell) ? ALIGN_PLACEMENT.right : undefined;
};

/** A parsed block and the index of the line after it. */
interface Parsed { spec: LineSpec; next: number }

type LineDone = (index: number) => boolean;

const BASE = { level: 2, style: 'unordered' as ListStyle };

const fencedCode = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  const open = FENCE.exec(raw[index]);

  if (open === null) {
    return null;
  }
  const mark = open[1];
  const closer = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},} *$`);
  const closeAt = raw.findIndex((line, at) => at > index && closer.test(line));
  const body = raw.slice(index + 1, closeAt < 0 ? raw.length : closeAt);
  const last = body[body.length - 1];
  // A closing fence still being written is not code.
  const cut = closeAt < 0 && last !== undefined && !lineDone(raw.length - 1) && /^ {0,3}[`~]+ *$/.test(last);
  const info = open[2];

  return {
    spec: {
      ...BASE,
      kind: 'code',
      text: (cut ? body.slice(0, -1) : body).join('\n'),
      complete: closeAt >= 0 || lineDone(raw.length - 1),
      language: normalizeFenceLang(info) ?? codeLanguage(info),
    },
    next: closeAt < 0 ? raw.length : closeAt + 1,
  };
};

const MATH_FENCE = /^ {0,3}\$\$ *$/;

/** A `$$` block: the importer makes it a LaTeX code block. */
const mathBlock = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  if (!MATH_FENCE.test(raw[index]) || (!lineDone(index) && index === raw.length - 1)) {
    return null;
  }
  const closeAt = raw.findIndex((line, at) => at > index && MATH_FENCE.test(line));
  const body = raw.slice(index + 1, closeAt < 0 ? raw.length : closeAt);
  // A closing `$` still being written is not math.
  const cut = closeAt < 0 && !lineDone(raw.length - 1) && /^ {0,3}\$ *$/.test(body[body.length - 1] ?? '');

  return {
    spec: { ...BASE, kind: 'code', text: (cut ? body.slice(0, -1) : body).join('\n'), complete: closeAt >= 0 || lineDone(raw.length - 1), language: 'latex' },
    next: closeAt < 0 ? raw.length : closeAt + 1,
  };
};

/**
 * A paragraph's text and the math in it, read the way the math extension reads it:
 * `$$x$$` always, `$x$` only when the content is math rather than prices. An escaped `$` is text.
 */
const mathSegments = (text: string): Array<{ math: boolean; text: string }> => {
  const segments: Array<{ math: boolean; text: string }> = [];
  const at = { index: 0, start: 0 };

  while (at.index < text.length) {
    const char = text[at.index];

    if (char === '\\') {
      at.index += 2;
      continue;
    }
    if (char !== '$') {
      at.index += 1;
      continue;
    }
    const run = text.startsWith('$$', at.index) ? '$$' : '$';
    const from = at.index + run.length;
    const close = text.indexOf(run, from);
    const content = close < 0 ? '' : text.slice(from, close);
    const lone = run === '$' || text[close + 2] !== '$';

    if (close < 0 || content.includes('$') || !lone || (run === '$' ? !isInlineMath(content) : content.trim() === '')) {
      at.index = from;
      continue;
    }
    segments.push({ math: false, text: text.slice(at.start, at.index) }, { math: true, text: content });
    at.index = close + run.length;
    at.start = at.index;
  }
  segments.push({ math: false, text: text.slice(at.start) });

  return segments;
};

/** A row's cells; while the row streams, its newest cell is final once its closing pipe arrives. */
const rowCells = (line: string, complete: boolean, align: Array<string | undefined>): CellSpec[] => {
  const { cells, closed } = splitRow(line);

  return cells.map((cell, index) => {
    const done = complete || index < cells.length - 1 || closed;

    return { text: inlineMarkdown(cell, done), complete: done, placement: align[index] };
  });
};

/** A GFM table, read the way the importer reads it. While the header streams, a leading pipe says it is one. */
const tableAt = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  const header = raw[index];
  const second = raw[index + 1] as string | undefined;
  const piped = header.trim().startsWith('|');

  if (!header.includes('|')) {
    return null;
  }
  if (second === undefined && (!piped || lineDone(index))) {
    return null;
  }
  const secondDone = second !== undefined && lineDone(index + 1);
  const delimiter = second === undefined ? [] : splitRow(second).cells;
  const whole = secondDone && delimiter.every((cell) => DELIMITER_CELL.test(cell)) && delimiter.length === splitRow(header).cells.length;
  const forming = second !== undefined && !secondDone && /^[ |:-]+$/.test(second) && (piped || second.includes('|'));

  if (second !== undefined && !whole && !forming) {
    return null;
  }
  const align = whole ? delimiter.map(alignOf) : [];
  const bodyEnd = whole
    ? raw.findIndex((line, at) => at > index + 1 && (line.trim() === '' || BLOCK_START.test(line) || (!lineDone(at) && MARKER_ONLY.test(line.trim()))))
    : -1;
  const bodyStop = bodyEnd < 0 ? raw.length : bodyEnd;
  const stop = whole ? bodyStop : Math.min(index + 2, raw.length);
  const head = rowCells(header, lineDone(index), align);
  const body = whole ? raw.slice(index + 2, stop).map((line, at) => rowCells(line, lineDone(index + 2 + at), align)) : [];
  // GFM needs a header row, so an export of a table without one writes it empty.
  const headless = body.length > 0 && head.every((cell) => cell.text === '');
  const rows = headless ? body : [head, ...body];
  const complete = lineDone(stop - 1);

  return {
    spec: { ...BASE, kind: 'table', text: '', complete, rows: padRows(rows), heading: !headless && (rows.length > 1 || !complete) },
    next: stop,
  };
};

const ALERT_TAGS = ALERT_KINDS.map((kind) => `[!${kind.toUpperCase()}]`);

/** A quote line whose text may still become an alert marker: it is not quote text yet. */
const alertPrefix = (line: string): boolean => {
  const text = QUOTE.exec(line)?.[1].trim() ?? '';

  return text !== '' && ALERT_TAGS.some((tag) => tag.startsWith(text) && tag !== text);
};

/** A GitHub alert: the importer makes it a callout whose body is child blocks. */
const calloutAt = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  const first = QUOTE.exec(raw[index])?.[1] ?? '';
  const marker = ALERT_MARKER.exec(first);

  if (marker === null) {
    return null;
  }
  const end = raw.findIndex((line, at) => at > index && !QUOTE.test(line));
  const stop = end < 0 ? raw.length : end;
  const lead = first.slice(marker[0].length);
  const skip = lead === '' ? 1 : 0;
  const body = [lead, ...raw.slice(index + 1, stop).map((line) => QUOTE.exec(line)?.[1] ?? '')].slice(skip);
  const style = ALERT_STYLE[marker[1].toLowerCase() as AlertKind];

  return {
    spec: {
      ...BASE, kind: 'callout', text: '', complete: lineDone(stop - 1), emoji: style.emoji, background: style.backgroundColor,
      children: parseLines(body, (at) => lineDone(index + skip + at)),
    },
    next: stop,
  };
};

/** A paragraph that is one image, read the way the importer reads it: the alt text becomes the caption. */
const WHOLE_IMAGE = /^ {0,3}!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$/;

/** While it streams: the alt text so far, and the rest once the `]` arrives. */
const OPEN_IMAGE = /^ {0,3}!\[([^\]]*)(\]\(([^)]*))?$/;

const imageAt = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  const complete = lineDone(index);
  const whole = WHOLE_IMAGE.exec(raw[index]);
  const partial = complete ? null : OPEN_IMAGE.exec(raw[index]);
  const next = index + 1;

  // A lone line that follows would join the paragraph, which the importer then keeps a paragraph.
  if (whole === null && partial === null) {
    return null;
  }
  if (whole !== null) {
    const url = loadable(whole[2], true);

    // An unsafe URL leaves the importer an empty paragraph.
    return url === undefined
      ? { spec: { ...BASE, kind: 'paragraph', text: '', complete: true }, next }
      : { spec: { ...BASE, kind: 'image', text: inlineMarkdown(whole[1], true), complete, url }, next };
  }
  const altDone = partial?.[2] !== undefined;

  return { spec: { ...BASE, kind: 'image', text: inlineMarkdown(partial?.[1] ?? '', altDone), complete: altDone }, next };
};

const quoteAt = (raw: string[], index: number, lineDone: LineDone): Parsed | null => {
  if (!QUOTE.test(raw[index])) {
    return null;
  }
  const end = raw.findIndex((line, at) => at > index && !QUOTE.test(line));
  const stop = end < 0 ? raw.length : end;
  const texts = raw.slice(index, stop).map((line) => (QUOTE.exec(line)?.[1] ?? '').trim()).filter((text) => text !== '');
  const complete = lineDone(stop - 1);

  return { spec: { ...BASE, kind: 'quote', text: inlineMarkdown(texts.join(' '), complete), complete }, next: stop };
};

/** Blocks from Markdown lines; also a callout's body. */
function parseLines(raw: string[], lineDone: LineDone): LineSpec[] {
  const specs: LineSpec[] = [];
  const paragraph: { texts: string[]; complete: boolean } = { texts: [], complete: true };
  const flush = (): void => {
    const { complete } = paragraph;
    const segments = paragraph.texts.length > 0 ? mathSegments(paragraph.texts.join(' ')) : [];

    // Math splits the paragraph, and the text around it is trimmed; a paragraph without math keeps its spacing.
    segments.forEach((segment) => {
      if (segment.math) {
        specs.push({ ...BASE, kind: 'code', text: segment.text, complete: true, language: 'latex' });
      } else if (segments.length === 1 || segment.text.trim() !== '') {
        specs.push({ ...BASE, kind: 'paragraph', text: inlineMarkdown(segments.length === 1 ? segment.text : segment.text.trim(), complete), complete });
      }
    });
    paragraph.texts = [];
  };
  const at = { index: 0 };

  while (at.index < raw.length) {
    const index = at.index;
    const line = raw[index];
    const complete = lineDone(index);
    const block = fencedCode(raw, index, lineDone) ?? mathBlock(raw, index, lineDone) ?? tableAt(raw, index, lineDone) ?? calloutAt(raw, index, lineDone) ?? quoteAt(raw, index, lineDone)
      ?? (paragraph.texts.length === 0 ? imageAt(raw, index, lineDone) : null);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const check = /^\s*[-*+]\s+\[[ xX]\]\s*(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const underline = complete && paragraph.texts.length > 0 ? SETEXT.exec(line) : null;

    at.index += 1;
    if (line.trim() === '' || (!complete && (MARKER_ONLY.test(line.trim()) || MARKS_ONLY.test(line) || alertPrefix(line)))) {
      flush();
    } else if (underline) {
      specs.push({ ...BASE, kind: 'header', level: underline[1].startsWith('=') ? 1 : 2, text: inlineMarkdown(paragraph.texts.join(' '), true), complete: true });
      paragraph.texts = [];
    } else if (complete && THEMATIC.test(line)) {
      flush();
      specs.push({ ...BASE, kind: 'divider', text: '', complete: true });
    } else if (block) {
      flush();
      specs.push(block.spec);
      at.index = block.next;
    } else if (heading) {
      flush();
      specs.push({ ...BASE, kind: 'header', level: heading[1].length, text: inlineMarkdown(heading[2], complete), complete });
    } else if (check ?? bullet ?? number) {
      const [style, match] = listMatch(check, bullet, number);

      flush();
      specs.push({ ...BASE, kind: 'list', style, text: inlineMarkdown(match, complete), complete });
    } else {
      paragraph.texts.push(line.trim());
      paragraph.complete = complete;
    }
  }
  flush();

  return specs.length > 0 ? specs : [{ ...BASE, kind: 'paragraph', text: '', complete: lineDone(raw.length - 1) }];
}

const markdownLines = (command: PartialCommand): LineSpec[] => {
  const { args, done } = command;
  const markdown = typeof args.markdown === 'string' ? args.markdown : '';
  const allDone = settled(args, 'markdown', done);
  const raw = markdown.split('\n');

  return parseLines(raw, (index) => allDone || index < raw.length - 1);
};

/** A field words land in: a block's text, one table cell, or a field of a callout's child. `verbatim`: code, which keeps its spacing. */
interface Field { text: string; complete: boolean; verbatim: boolean }

/** Fields in reading order; a finished line has every field final. */
const fieldsOf = (spec: LineSpec): Field[] => {
  const fields: Field[] = spec.children
    ? spec.children.flatMap(fieldsOf)
    : (spec.rows ? spec.rows.flat() : [spec]).map((field) => ({ text: field.text, complete: field.complete, verbatim: spec.kind === 'code' }));

  return spec.complete ? fields.map((field) => ({ ...field, complete: true })) : fields;
};

interface Token { text: string; field: number }

/** Code keeps its indent, so leading space is a token of its own there. */
const splitWords = (text: string, verbatim: boolean): string[] => text.match(verbatim ? /^\s+|\S+\s*/g : /\S+\s*/g) ?? [];

const tokensOf = (spec: LineSpec): Token[] =>
  fieldsOf(spec).flatMap((field, index) => splitWords(field.text, field.verbatim).map((text) => ({ text, field: index })));

/** Words that can land now: a word still being written waits for its trailing space. Only the newest field is ever unfinished. */
const landable = (spec: LineSpec): number => fieldsOf(spec).reduce((count, field) => {
  const fieldWords = splitWords(field.text, field.verbatim);

  return count + (field.complete ? fieldWords.length : fieldWords.filter((token) => /\s$/.test(token)).length);
}, 0);

const SLOTS: Record<Kind, string[]> = {
  header: ['heading'], list: ['short'], paragraph: ['line', 'short'], rewrite: ['line'], quote: ['line'], table: [], code: [], divider: [], callout: [], image: [],
};

/** Blocks whose final form shows before any word: a grid, a code box, a rule. */
const FRAMED_EMPTY = new Set<Kind>(['table', 'code', 'divider', 'callout', 'image']);

const makeSlots = (kind: Kind): HTMLElement[] => {
  const shimmer = !prefersReducedMotion();

  return SLOTS[kind].map((slotKind) => {
    const slot = document.createElement('div');

    slot.setAttribute(DATA_ATTR.aiSlot, slotKind);
    if (shimmer) {
      slot.classList.add('blok-ai-shimmer');
    }

    return slot;
  });
};

/** A block's preview markup: where each field's words go, and how it follows a spec that grew. */
interface View {
  block: HTMLElement;
  targets: HTMLElement[];
  /** False: the spec outgrew this markup, so it is built again. */
  sync?(spec: LineSpec): boolean;
}

/**
 * Mirrors TableGrid in `tools/table/table-core.ts` and the table's wrapper, so `tables.css` styles it like the real one.
 * Importing that file would pull the whole table tool into core.
 */
const TABLE_BORDER = '1px solid var(--blok-table-border)';
const TABLE_MIN_COL_WIDTH = 50;
const TABLE_WRAPPER_CLASSES = ['my-2', 'pe-5', 'relative', 'mb-7'];
const TABLE_CELL_CLASSES = ['py-1', 'px-2', 'min-h-[2em]', 'outline-hidden', 'leading-none'];

const tableCell = (): { cell: HTMLTableCellElement; text: HTMLElement } => {
  const cell = document.createElement('td');
  const blocks = document.createElement('div');
  const text = document.createElement('div');

  cell.className = TABLE_CELL_CLASSES.join(' ');
  Object.assign(cell.style, { borderRight: TABLE_BORDER, borderBottom: TABLE_BORDER, overflow: 'hidden', overflowWrap: 'break-word', height: '0' });
  cell.setAttribute('data-blok-table-cell', '');
  blocks.setAttribute('data-blok-table-cell-blocks', '');
  Object.assign(blocks.style, { display: 'flex', flexDirection: 'column', minHeight: '100%' });
  text.className = PARAGRAPH_CLASSES.join(' ');
  blocks.append(text);
  cell.append(blocks);

  return { cell, text };
};

const makeTable = (spec: LineSpec): View => {
  const cols = spec.rows?.[0]?.length ?? 1;
  const wrapper = document.createElement('div');
  const scroll = document.createElement('div');
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  const tbody = document.createElement('tbody');
  const targets: HTMLElement[] = [];
  const width = Math.round((100 / cols) * 100) / 100;

  wrapper.className = TABLE_WRAPPER_CLASSES.join(' ');
  scroll.setAttribute('data-blok-table-scroll', '');
  scroll.classList.add('overflow-x-auto', 'overflow-y-hidden');
  Object.assign(table.style, {
    tableLayout: 'fixed', width: '100%', borderCollapse: 'separate', borderSpacing: '0px',
    borderTop: TABLE_BORDER, borderLeft: TABLE_BORDER, minWidth: `${cols * TABLE_MIN_COL_WIDTH}px`,
  });
  colgroup.append(...Array.from({ length: cols }, () => {
    const col = document.createElement('col');

    col.style.width = `${width}%`;

    return col;
  }));
  table.append(colgroup, tbody);
  scroll.append(table);
  wrapper.append(scroll);

  return {
    block: wrapper,
    targets,
    // Rows only grow here: a rebuilt row would replay its words' blur-in.
    sync: (next) => {
      const rows = next.rows ?? [];

      if ((rows[0]?.length ?? 1) !== cols || rows.length < tbody.rows.length) {
        return false;
      }
      while (tbody.rows.length < rows.length) {
        const row = tbody.insertRow();

        Array.from({ length: cols }, () => {
          const { cell, text } = tableCell();

          row.append(cell);
          targets.push(text);
        });
      }
      [...tbody.rows].forEach((row, r) => {
        row.toggleAttribute('data-blok-table-heading', r === 0 && next.heading === true);
        [...row.cells].forEach((cell, c) => {
          const corners = [
            r === 0 && c === 0 && 'top-start',
            r === 0 && c === cols - 1 && 'top-end',
            r === rows.length - 1 && c === 0 && 'bottom-start',
            r === rows.length - 1 && c === cols - 1 && 'bottom-end',
          ].filter(Boolean).join(' ');
          const placement = rows[r][c].placement;

          if (corners === '') {
            cell.removeAttribute('data-blok-table-corner');
          } else {
            cell.setAttribute('data-blok-table-corner', corners);
          }
          if (placement === undefined) {
            cell.firstElementChild?.removeAttribute('data-blok-cell-placement');
          } else {
            cell.firstElementChild?.setAttribute('data-blok-cell-placement', placement);
          }
        });
      });

      return true;
    },
  };
};

/** Rendering waits this long after the newest word, so a streaming formula is not rendered once per word. */
const MATH_RENDER_MS = 150;

/** Mermaid stays out of core until an agent writes a diagram; the real block loads it then too. */
const renderPreview = async (language: string, code: string): Promise<string> =>
  (language === 'mermaid' ? (await import('../../../tools/code/mermaid-loader')).renderMermaid(code) : renderLatex(code));

/**
 * The editable code block's markup, as the real block renders: its controls show on hover only,
 * so their empty labels never show. Math and diagrams open in preview mode, as they do in the tool.
 */
const makeCode = (spec: LineSpec, t: Translate): View => {
  const language = spec.language ?? DEFAULT_LANGUAGE;
  const previewable = PREVIEWABLE_LANGUAGES.has(language);
  // Mirrors CodeTool.getLanguageName.
  const name = language === DEFAULT_LANGUAGE ? t(PLAIN_TEXT_KEY) : LANGUAGES.find((entry) => entry.id === language)?.name ?? language;
  const dom = buildCodeDOM({
    code: '', languageName: name, languageColor: LANGUAGE_COLORS[language], readOnly: false, copyLabel: '',
    previewable, viewModeLabels: { code: '', preview: '', split: '' },
  });
  const gutter = dom.gutterElement;
  const rendered = { code: '', timer: undefined as ReturnType<typeof setTimeout> | undefined };

  dom.codeElement.removeAttribute('contenteditable');
  dom.codeElement.removeAttribute('spellcheck');
  if (previewable && dom.viewModeContainer !== null && dom.previewElement !== null) {
    // Mirrors CodeTool.applyViewMode('preview').
    setActiveViewMode(dom.viewModeContainer, 'preview');
    dom.preElement.hidden = true;
    gutter.hidden = true;
    dom.previewElement.hidden = false;
    const codeHalf = dom.preElement.parentElement?.parentElement;

    if (codeHalf) {
      codeHalf.hidden = true;
    }
  }
  const output = dom.previewElement;
  const render = (code: string): void => {
    void renderPreview(language, code).then((html) => {
      // A formula cut mid-command fails to render: the last good one stays until the next.
      if (output !== null && code === rendered.code && (!html.includes('katex-error') || output.childElementCount === 0)) {
        output.innerHTML = html;
      }
    });
  };

  return {
    block: dom.wrapper,
    targets: [dom.codeElement],
    sync: (next) => {
      const count = next.text.split('\n').length;

      while (gutter.children.length < count) {
        const number = document.createElement('div');

        number.className = GUTTER_LINE_STYLES;
        number.textContent = String(gutter.children.length + 1);
        number.setAttribute('data-line-index', String(gutter.children.length));
        gutter.append(number);
      }
      while (gutter.children.length > count) {
        gutter.lastElementChild?.remove();
      }
      // A diagram cut mid-line is not drawn; it waits for the whole fence.
      if (previewable && next.text !== rendered.code && (next.complete || language !== 'mermaid')) {
        rendered.code = next.text;
        clearTimeout(rendered.timer);
        rendered.timer = setTimeout(() => render(next.text), next.complete ? 0 : MATH_RENDER_MS);
      }

      return true;
    },
  };
};

const makeDivider = (): View => {
  const wrapper = document.createElement('div');
  const rule = document.createElement('hr');

  wrapper.className = DIVIDER_WRAPPER_CLASSES.join(' ');
  rule.className = DIVIDER_RULE_CLASSES.join(' ');
  wrapper.append(rule);

  return { block: wrapper, targets: [] };
};

/** What a view is built for: a spec that differs here needs new markup. A callout's children are its sync's business. */
const shapeOf = (spec: LineSpec, ordinal: number): string => {
  const { kind, level, style, before, after, language, rows, emoji, color, background } = spec;

  return [kind, level, style, ordinal, before ?? '', after ?? '', language ?? '', rows?.[0]?.length ?? 0, emoji ?? '', color ?? '', background ?? ''].join(':');
};

/** An ordered list item's number: it counts up through a run of them. */
const ordinalsOf = (specs: LineSpec[]): number[] => specs.reduce<number[]>((ordinals, spec, index) => {
  ordinals.push(spec.kind === 'list' && spec.style === 'ordered' ? (ordinals[index - 1] ?? 0) + 1 : 0);

  return ordinals;
}, []);

/** Mirrors the callout tool's `applyColors`. */
const CALLOUT_DEFAULT_BORDER = '1px solid var(--blok-callout-default-border, #e5e7eb)';

/** The callout tool's markup; its body holds one view per child block, the way its child holders stack. */
const makeCallout = (spec: LineSpec, t: Translate): View => {
  const dom = buildCalloutDOM({ emoji: spec.emoji ?? '', readOnly: true, addEmojiLabel: '' });
  const body = dom.childContainer;
  const parts: Array<{ view: View; shape: string }> = [];

  dom.wrapper.style.color = spec.color === undefined ? '' : colorVarName(spec.color, 'text');
  if (spec.background === undefined) {
    dom.wrapper.style.border = CALLOUT_DEFAULT_BORDER;
  } else {
    dom.wrapper.style.backgroundColor = colorVarName(spec.background, 'bg');
  }

  return {
    block: dom.wrapper,
    get targets() {
      return parts.flatMap((part) => part.view.targets);
    },
    // Children only grow here, like table rows: a rebuilt child would replay its words' blur-in.
    sync: (next) => {
      const children = next.children ?? [];
      const ordinals = ordinalsOf(children);
      const shapes = children.map((child, index) => shapeOf(child, ordinals[index]));

      if (children.length < parts.length || parts.some((part, index) => part.shape !== shapes[index] || part.view.sync?.(children[index]) === false)) {
        return false;
      }
      children.slice(parts.length).forEach((child) => {
        const index = parts.length;
        const slot = document.createElement('div');
        const view = makeView(child, ordinals[index], t);

        view.sync?.(child);
        slot.append(view.block);
        body.append(slot);
        parts.push({ view, shape: shapes[index] });
      });

      return true;
    },
  };
};

/**
 * Mirrors the image tool's rendered state (`renderImage` and its caption row) at its defaults.
 * Its hover controls are absolutely placed, so leaving them out moves nothing.
 */
const makeImage = (): View => {
  const root = document.createElement('div');
  const figure = document.createElement('figure');
  const img = document.createElement('img');
  const row = document.createElement('div');
  const captionText = document.createElement('div');
  const placeholder = makePreview('image');

  root.setAttribute('data-blok-tool', 'image');
  Object.entries({ 'data-state': 'rendered', 'data-size': 'full', 'data-align': 'center', 'data-frame': 'none', 'data-rounded': 'on', 'data-caption': 'on' })
    .forEach(([name, value]) => root.setAttribute(name, value));
  figure.className = 'blok-image-inner';
  figure.setAttribute('data-role', 'image-figure');
  Object.assign(figure.style, { margin: '0', textAlign: 'center', position: 'relative' });
  img.alt = '';
  img.draggable = false;
  row.className = 'blok-image-caption-row';
  captionText.className = 'blok-image-caption';
  Object.assign(captionText.style, { outline: 'none', textAlign: 'start' });
  row.append(captionText);
  figure.append(placeholder, row);
  root.append(figure);

  return {
    block: root,
    targets: [captionText],
    sync: (next) => {
      if (next.url === undefined) {
        return true;
      }
      // Nothing the agent names loads before the call runs and the host's allowMediaUrl checks it.
      // A data: raster reaches no server, so it draws; anything else shows the media drawing.
      if (!isSafeRasterImageDataUrl(stripIgnoredUrlChars(next.url))) {
        if (placeholder.parentElement === null) {
          img.remove();
          figure.prepend(placeholder);
        }

        return true;
      }
      if (img.getAttribute('src') !== next.url) {
        placeholder.remove();
        figure.prepend(img);
        img.src = next.url;
      }

      return true;
    },
  };
};

/** The real tool's markup and classes, so the hand-off to the real block does not jump. */
function makeView(spec: LineSpec, ordinal: number, t: Translate): View {
  if (spec.kind === 'table') {
    return makeTable(spec);
  }
  if (spec.kind === 'code') {
    return makeCode(spec, t);
  }
  if (spec.kind === 'divider') {
    return makeDivider();
  }
  if (spec.kind === 'callout') {
    return makeCallout(spec, t);
  }
  if (spec.kind === 'image') {
    return makeImage();
  }
  if (spec.kind === 'quote') {
    const quote = document.createElement('blockquote');

    quote.className = quoteClasses('default').join(' ');

    return { block: quote, targets: [quote] };
  }
  if (spec.kind === 'rewrite') {
    // The box already copies the field's own type, so plain text nodes match it.
    const rewriteFrame = document.createElement('div');
    const rewriteText = document.createElement('span');

    rewriteFrame.append(spec.before ?? '', rewriteText, spec.after ?? '');

    return { block: rewriteFrame, targets: [rewriteText] };
  }
  if (spec.kind === 'header') {
    const heading = document.createElement(`h${spec.level}`);

    heading.className = headerClasses(spec.level).join(' ');
    heading.setAttribute(DATA_ATTR.headingLevel, String(spec.level));

    return { block: heading, targets: [heading] };
  }
  if (spec.kind === 'list') {
    const listItem = document.createElement('div');
    const listRow = document.createElement('div');
    const marker = createMarker(spec.style === 'ordered' ? 'ordered' : 'unordered', 0);
    const listText = document.createElement('div');

    listItem.className = LIST_ITEM_CLASSES.join(' ');
    listItem.setAttribute('data-list-style', spec.style);
    listRow.className = LIST_ITEM_ROW_CLASSES.join(' ');
    listText.className = LIST_CONTENT_CLASSES.join(' ');
    if (spec.style === 'ordered') {
      marker.textContent = `${ordinal}.`;
    }
    listRow.append(marker, listText);
    listItem.append(listRow);

    return { block: listItem, targets: [listText] };
  }
  const paragraph = document.createElement('div');

  paragraph.className = PARAGRAPH_CLASSES.join(' ');

  return { block: paragraph, targets: [paragraph] };
}

/** One block in the preview: slots until its first word, then the real block's markup. */
class Line {
  public readonly el = document.createElement('div');
  private shape = '';
  /** The real block's markup; null while the line still shows slots. */
  private view: View | null = null;
  private readonly spans: HTMLElement[] = [];

  constructor(public spec: LineSpec, private ordinal: number, private readonly t: Translate) {}

  public get pending(): boolean {
    return this.spans.length < landable(this.spec);
  }

  public update(spec: LineSpec, ordinal: number): void {
    const tokens = tokensOf(spec);

    this.spec = spec;
    this.ordinal = ordinal;
    // A landed word can still change: a soft-wrapped line gains a space, a link loses its bracket.
    this.spans.splice(tokens.length).forEach((span) => span.remove());
    this.spans.forEach((landedWord, index) => {
      if (landedWord.textContent !== tokens[index].text) {
        landedWord.replaceChildren(tokens[index].text);
      }
    });
    this.draw();
  }

  public land(): void {
    const span = document.createElement('span');
    const token = tokensOf(this.spec)[this.spans.length] as Token | undefined;

    span.className = 'blok-ai-word';
    span.textContent = token?.text ?? '';
    this.spans.push(span);

    const target = this.view?.targets[token?.field ?? 0];

    if (this.view === null) {
      this.draw();
    } else {
      target?.append(span);
    }
  }

  /** Lands every word left, cut-off ones too: the real block is about to replace it. */
  public finish(): void {
    this.spec = { ...this.spec, complete: true };
    while (this.pending) {
      this.land();
    }
    this.tails();
  }

  /** The newest two words carry the tail; a finished line fades back to ink. */
  public tails(): void {
    const done = this.spec.complete && this.spans.length >= tokensOf(this.spec).length;

    this.spans.forEach((span, index) => {
      span.classList.toggle('blok-ai-tail', !done && index >= this.spans.length - 2);
    });
  }

  private draw(): void {
    const { kind, before, after } = this.spec;
    const shape = shapeOf(this.spec, this.ordinal);
    // A range rewrite shows the text around the range at once.
    const framed = FRAMED_EMPTY.has(kind) || this.spans.length > 0 || Boolean(before) || Boolean(after);

    if (!framed) {
      if (this.view !== null || this.shape !== shape) {
        this.el.replaceChildren(...makeSlots(kind));
        this.view = null;
      }
      this.shape = shape;

      return;
    }
    const fits = this.view !== null && this.shape === shape && (this.view.sync?.(this.spec) ?? true);

    if (!fits) {
      this.view = makeView(this.spec, this.ordinal, this.t);
      this.view.sync?.(this.spec);
      this.el.replaceChildren(this.view.block);
    }
    this.shape = shape;
    this.home(this.view);
  }

  /** Puts each landed word in its field; only words whose field moved are touched. */
  private home(view: View | null): void {
    const tokens = tokensOf(this.spec);

    this.spans.forEach((span, index) => {
      const target = view?.targets[tokens[index]?.field ?? 0];

      if (target !== undefined && span.parentElement !== target) {
        target.append(span);
      }
    });
  }
}

/** One insert command: one line for block.insert, one per block for markdown.insert. */
class Item {
  public readonly root = document.createElement('div');
  public readonly lines: Line[] = [];
  public ref?: string;
  public group: Group | null = null;
  /** Set for a rewrite: the box drawn over the block it rewrites. */
  public frame: RewriteBox | null = null;

  constructor(public readonly index: number, private readonly t: Translate) {}

  public join(group: Group): void {
    this.group = group;
  }

  /** Shows the rewritten block again. */
  public unframe(key: string): void {
    this.frame?.remove(key);
    this.frame = null;
  }

  /** Forgets a group that no longer exists. */
  public keepIn(groups: Group[]): void {
    if (this.group && !groups.includes(this.group)) {
      this.group = null;
    }
  }

  public sync(specs: LineSpec[]): void {
    this.lines.splice(specs.length).forEach((line) => line.el.remove());

    const ordinals = ordinalsOf(specs);

    specs.forEach((spec, index) => {
      const known = this.lines[index];

      if (known) {
        known.update(spec, ordinals[index]);

        return;
      }
      const line = new Line(spec, ordinals[index], this.t);

      this.root.append(line.el);
      this.lines.push(line);
      line.update(spec, ordinals[index]);
    });
  }
}

const isOwn = (holder: HTMLElement, node: Element): boolean => node.closest(`[${DATA_ATTR.element}]`) === holder;

/** The holder's own first match, never one inside a nested child block. */
const ownFirst = (holder: HTMLElement, selector: string): HTMLElement | null =>
  [...holder.querySelectorAll<HTMLElement>(selector)].find((node) => isOwn(holder, node)) ?? null;

/** A tune may wrap the content column, so it is not always a direct child. */
const contentColumn = (holder: HTMLElement): HTMLElement => ownFirst(holder, `[${DATA_ATTR.elementContent}]`) ?? holder;

const markPreviewBox = (box: HTMLElement): void => {
  box.setAttribute(DATA_ATTR.aiPreview, '');
  box.setAttribute('data-blok-testid', 'ai-preview');
  box.setAttribute('aria-hidden', 'true');
  box.setAttribute('inert', '');
};

interface Spot { top: number; left: number; width: number }

const placeBox = (box: HTMLElement, spot: Spot): void => {
  const { style } = box;

  style.setProperty('top', `${spot.top}px`);
  style.setProperty('left', `${spot.left}px`);
  style.setProperty('width', `${spot.width}px`);
};

/** A box's layout, in the four steps one frame runs for every box: sizes, gaps, positions, styles. */
interface Placed {
  measure(): void;
  reserve(key: string): void;
  locate(layer: DOMRect): void;
  apply(): void;
}

/** The items of one call that sit in one gap, drawn in one overlay box. */
class Group implements Placed {
  public readonly box = document.createElement('div');
  private column: HTMLElement | null = null;
  private height = 0;
  private offset = 0;
  private spot: Spot = { top: 0, left: 0, width: 0 };

  constructor(public readonly holder: HTMLElement, public readonly side: GapSide) {
    const computed = getComputedStyle(holder);

    markPreviewBox(this.box);
    // The tools size text with `inherit`, so take what a real block would inherit here (a callout's size, say).
    this.box.style.fontSize = computed.fontSize;
    this.box.style.fontFamily = computed.fontFamily;
    this.box.style.color = computed.color;
  }

  /** Moves only the roots that are out of place: a moved node replays its words' blur-in. */
  public arrange(items: Item[]): void {
    items.forEach((item, index) => {
      const child = this.box.children[index];

      if (child !== item.root) {
        this.box.insertBefore(item.root, child ?? null);
      }
    });
  }

  public measure(): void {
    this.height = this.box.getBoundingClientRect().height;
  }

  /** Sizes the gap to the box. */
  public reserve(key: string): void {
    this.offset = reserveGap(this.holder, key, this.height, this.side);
  }

  public locate(layer: DOMRect): void {
    const rect = this.holder.getBoundingClientRect();
    // The real column: the alignment rules move it inside a wider holder.
    this.column ??= contentColumn(this.holder);

    const column = this.column.getBoundingClientRect();
    const top = this.side === 'end'
      ? rect.bottom - layer.top + this.offset
      : rect.top - layer.top - gapSize(this.holder, 'start') + this.offset;

    this.spot = { top, left: column.left - layer.left, width: column.width };
  }

  /** Puts the box in its gap. */
  public apply(): void {
    placeBox(this.box, this.spot);
  }

  public remove(key: string): void {
    this.box.remove();
    releaseGap(this.holder, key, this.side);
  }
}

/** Copied from the field, so the overlay text sits exactly over the hidden text. */
const FIELD_TYPE = [
  'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-align',
  'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end', 'white-space', 'overflow-wrap',
];

interface RewriteTarget { id: string; holder: HTMLElement; input: HTMLElement; original: string }

/**
 * Holders under a rewrite box, across calls and previews. A second rewrite waits until the
 * first box is gone (one frame after commit), so it reads the committed text.
 */
const rewriting = new WeakSet<HTMLElement>();

/** One rewrite: the holder's content is hidden, and this box draws the new text over its field. */
class RewriteBox implements Placed {
  public readonly box = document.createElement('div');
  private extra = 0;
  private spot: Spot = { top: 0, left: 0, width: 0 };

  constructor(public readonly target: RewriteTarget, root: HTMLElement) {
    const computed = getComputedStyle(target.input);

    markPreviewBox(this.box);
    FIELD_TYPE.forEach((property) => this.box.style.setProperty(property, computed.getPropertyValue(property)));
    // The width below is the field's border box, padding included.
    this.box.style.boxSizing = 'border-box';
    this.box.append(root);
    target.holder.setAttribute(DATA_ATTR.aiRewriting, '');
    rewriting.add(target.holder);
  }

  public measure(): void {
    this.extra = this.box.getBoundingClientRect().height - this.target.input.getBoundingClientRect().height;
  }

  /** Text longer than the field holds the extra height in the gap. */
  public reserve(key: string): void {
    // Nearest the holder: the box grows down from the field, so the bar and inserts must sit below it.
    reserveGap(this.target.holder, key, this.extra, 'end', true);
  }

  public locate(layer: DOMRect): void {
    const field = this.target.input.getBoundingClientRect();

    this.spot = { top: field.top - layer.top, left: field.left - layer.left, width: field.width };
  }

  /** Puts the box over the field. */
  public apply(): void {
    placeBox(this.box, this.spot);
  }

  public remove(key: string): void {
    this.box.remove();
    releaseGap(this.target.holder, key);
    this.target.holder.removeAttribute(DATA_ATTR.aiRewriting);
    rewriting.delete(this.target.holder);
  }
}

type RewriteRange = 'all' | { start: number; end: number } | { find: string; occurrence: number; matchCase: boolean; wholeWord: boolean };

/** `drawable: false`: the new text holds an embed, which plain overlay text cannot show. */
interface RewriteSpec { id: string; field?: string; strictField: boolean; range: RewriteRange; text: string; complete: boolean; drawable: boolean }

const hasEmbed = (value: unknown): boolean => Array.isArray(value) && value.some((segment) => isRecord(segment) && 'embed' in segment);

const isRich = (value: unknown): boolean => typeof value === 'string' || Array.isArray(value);

const rangeOf = (value: unknown): RewriteRange | null => {
  if (value === undefined || value === 'all') {
    return 'all';
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Number.isInteger(value.start) && Number.isInteger(value.end)) {
    return { start: Number(value.start), end: Number(value.end) };
  }
  // The executor rejects an occurrence that is not a whole number from 1.
  const occurrence = value.occurrence ?? 1;

  // A replace-all changes many spans; one overlay cannot show it.
  if (typeof value.find === 'string' && value.find.trim() !== '' && Number.isInteger(occurrence) && Number(occurrence) >= 1 && value.all !== true) {
    return { find: value.find, occurrence: Number(occurrence), matchCase: value.matchCase === true, wholeWord: value.wholeWord === true };
  }

  return null;
};

/** Same search as the executor's findRange, so the preview marks the span commit will replace. */
const locate = (text: string, range: RewriteRange): { start: number; end: number } | null => {
  if (range === 'all') {
    return { start: 0, end: text.length };
  }
  if ('start' in range) {
    return range.start >= 0 && range.start <= range.end && range.end <= text.length ? range : null;
  }
  const { matchCase, wholeWord } = range;

  return findTextMatches(text, range.find, { matchCase, wholeWord, keepEdgeSpaces: true })[range.occurrence - 1] ?? null;
};

/** A rewrite whose target and range are final; null while they may still change, or for no rewrite. */
const rewriteOf = (command: PartialCommand): RewriteSpec | null => {
  const { name, args, done } = command;
  const fieldReady = args.field === undefined || (typeof args.field === 'string' && settled(args, 'field', done));

  if (typeof args.id !== 'string' || !settled(args, 'id', done) || !fieldReady) {
    return null;
  }
  const field = typeof args.field === 'string' ? args.field : undefined;

  if (name === 'text.replace') {
    const range = args.range === undefined || settled(args, 'range', done) ? rangeOf(args.range) : null;

    if (!('with' in args) || range === null) {
      return null;
    }
    const complete = settled(args, 'with', done);

    return { id: args.id, field, strictField: field !== undefined, range, text: richText(args.with, complete), complete, drawable: !hasEmbed(args.with) };
  }
  if (name === 'block.update' && isRecord(args.data) && isRich(args.data.text)) {
    const complete = settled(args, 'data', done) || settled(args.data, 'text', done);
    const { text } = args.data;

    // Only `text`: another string field (a list style, a url) is not shown text.
    return { id: args.id, field: 'text', strictField: false, range: 'all', text: richText(text, complete), complete, drawable: !hasEmbed(text) };
  }

  return null;
};

const EDITABLE = '[contenteditable]:not([contenteditable="false"])';

/** A collapsed toggle hides its child holders with the `hidden` class. */
const showsChildren = (holder: HTMLElement): boolean =>
  [...holder.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`)].some((child) =>
    child.parentElement?.closest(`[${DATA_ATTR.element}]`) === holder
    && !child.hidden
    && !child.classList.contains('hidden')
    && (typeof child.checkVisibility !== 'function' || child.checkVisibility()));

const fieldInput = (deps: LivePreviewDeps, holder: HTMLElement, spec: RewriteSpec): HTMLElement | null => {
  if (deps.inputOf) {
    return deps.inputOf(spec.id, spec.field);
  }
  const inputs = [...holder.querySelectorAll<HTMLElement>(EDITABLE)].filter((input) => isOwn(holder, input));

  // No DOM hook names a field: with several inputs, a named one cannot be told apart.
  return !spec.strictField || inputs.length === 1 ? inputs[0] ?? null : null;
};

type Plan = Map<HTMLElement, Partial<Record<GapSide, Item[]>>>;

const previousHolder = (holder: HTMLElement): HTMLElement | null => {
  const prev = holder.previousElementSibling;

  return prev instanceof HTMLElement && prev.hasAttribute(DATA_ATTR.element) ? prev : null;
};

/** Where each insert goes this update, as ordered item lists per holder side. */
const plan = (deps: LivePreviewDeps, items: Map<number, Item>, commands: PartialCommand[]): Plan => {
  const result: Plan = new Map();
  const where = new Map<Item, { holder: HTMLElement; side: GapSide }>();
  const listOf = (holder: HTMLElement, side: GapSide): Item[] => {
    const sides = result.get(holder) ?? {};
    const list = sides[side] ?? [];

    sides[side] = list;
    result.set(holder, sides);

    return list;
  };
  const put = (item: Item, holder: HTMLElement, side: GapSide, at: number | 'last'): void => {
    const list = listOf(holder, side);

    list.splice(at === 'last' ? list.length : at, 0, item);
    where.set(item, { holder, side });
  };
  const byRef = (id: string | undefined): Item | null =>
    id?.startsWith('$') ? [...where.keys()].find((item) => item.ref === id.slice(1)) ?? null : null;
  const putNear = (item: Item, other: Item, after: boolean): void => {
    const spot = where.get(other);

    if (spot) {
      put(item, spot.holder, spot.side, listOf(spot.holder, spot.side).indexOf(other) + (after ? 1 : 0));
    }
  };

  const atEdge = (item: Item, edge: 'start' | 'end', parentId: string | undefined): boolean => {
    const parentItem = byRef(parentId);

    if (parentItem) {
      putNear(item, parentItem, true);

      return true;
    }
    if (parentId?.startsWith('$')) {
      return false;
    }
    const holder = deps.edgeHolder(edge, parentId);
    // A parent with no children yet: the new child shows right under it.
    const parent = holder === null && parentId !== undefined ? deps.holderOf(parentId) : null;

    if (holder) {
      put(item, holder, edge, edge === 'start' ? 0 : 'last');
    } else if (parent) {
      put(item, parent, 'end', 'last');
    }

    return holder !== null || parent !== null;
  };

  const nextTo = (item: Item, target: string, after: boolean): boolean => {
    const other = byRef(target);

    if (other) {
      putNear(item, other, after);

      return true;
    }
    const holder = target.startsWith('$') ? null : deps.holderOf(target);
    const prev = holder && !after ? previousHolder(holder) : null;

    if (holder === null) {
      return false;
    }
    if (after) {
      put(item, holder, 'end', 0);
    } else if (prev) {
      put(item, prev, 'end', 'last');
    } else {
      put(item, holder, 'start', 'last');
    }

    return true;
  };

  const resolve = (item: Item, command: PartialCommand): boolean => {
    const { args, done } = command;
    const position = args.position;
    const parentId = typeof args.parentId === 'string' ? args.parentId : undefined;

    // No position yet: it may still come, so wait under the bar.
    if (position === undefined && !done) {
      const anchor = deps.anchorHolder();

      if (anchor) {
        put(item, anchor, 'end', 'last');
      }

      return anchor !== null;
    }
    // The executor's default when a finished command has none.
    if (position === undefined || position === 'end' || position === 'start') {
      return atEdge(item, position ?? 'end', parentId);
    }
    // An id may still be cut off until a later key starts.
    if (!isRecord(position) || !settled(args, 'position', done)) {
      return false;
    }
    if (typeof position.after === 'string') {
      return nextTo(item, position.after, true);
    }

    return typeof position.before === 'string' && nextTo(item, position.before, false);
  };

  commands.forEach((command, index) => {
    const item = items.get(index);

    // Not resolvable yet: keep the last spot so the preview does not blink.
    if (item && !resolve(item, command) && item.group) {
      put(item, item.group.holder, item.group.side, 'last');
    }
  });

  return result;
};

class CallPreview {
  private readonly items = new Map<number, Item>();
  private groups: Group[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLanded = -Infinity;
  private painted: 'no' | 'waiting' | 'yes' = 'no';

  public get shown(): boolean {
    return this.painted === 'yes';
  }

  constructor(
    private readonly id: string,
    private readonly deps: LivePreviewDeps,
    private readonly requestLayout: () => void
  ) {}

  private get key(): string {
    return `call:${this.id}`;
  }

  private readonly t: Translate = (key) => this.deps.t?.(key) ?? '';

  public get layer(): HTMLElement {
    return this.deps.layer;
  }

  public render(commands: PartialCommand[]): void {
    commands.forEach((command, index) => {
      if (command.name === 'text.replace' || command.name === 'block.update') {
        this.rewrite(index, command);

        return;
      }
      if (command.name === undefined || !INSERTS.has(command.name)) {
        return;
      }
      const item = this.items.get(index) ?? new Item(index, this.t);

      item.ref = command.ref;
      this.items.set(index, item);
      item.sync(command.name === 'markdown.insert' ? markdownLines(command) : [blockLine(command)]);
    });

    const groups: Group[] = [];
    const inserts = new Map([...this.items].filter(([, item]) => item.frame === null));

    plan(this.deps, inserts, commands).forEach((sides, holder) => {
      (['end', 'start'] as const).forEach((side) => {
        const items = sides[side];

        if (!items) {
          return;
        }
        const group = this.groups.find((known) => known.holder === holder && known.side === side) ?? new Group(holder, side);

        if (!group.box.isConnected) {
          this.deps.layer.appendChild(group.box);
        }
        group.arrange(items);
        items.forEach((item) => item.join(group));
        groups.push(group);
      });
    });

    this.groups.filter((group) => !groups.includes(group)).forEach((group) => group.remove(this.key));
    this.items.forEach((item) => item.keepIn(groups));
    this.groups = groups;
    this.requestLayout();
    this.pump();
  }

  /** Lands the next word, at most one per WORD_GAP_MS; under reduced motion, every word that has arrived. */
  public pump(): void {
    if (this.timer !== null) {
      return;
    }
    const lines = this.ordered().flatMap((item) => (item.group || item.frame ? item.lines : [])).filter((known) => known.pending);
    const line = lines[0];

    if (line === undefined) {
      this.items.forEach((item) => item.lines.forEach((known) => known.tails()));

      return;
    }
    if (prefersReducedMotion()) {
      lines.forEach((known) => {
        while (known.pending) {
          known.land();
        }
      });
      this.landed();

      return;
    }
    const wait = WORD_GAP_MS - (Date.now() - this.lastLanded);

    if (wait <= 0) {
      line.land();
      this.lastLanded = Date.now();
      this.landed();
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait > 0 ? wait : WORD_GAP_MS);
  }

  /** After a word lands: tails, a layout, a frame to mark the call shown. */
  private landed(): void {
    this.items.forEach((item) => item.lines.forEach((known) => known.tails()));
    this.requestLayout();
    if (this.painted === 'no') {
      this.painted = 'waiting';
      requestAnimationFrame(() => {
        this.painted = 'yes';
      });
    }
  }

  public settle(): void {
    this.stop();
    this.items.forEach((item) => item.lines.forEach((line) => line.finish()));
    layoutAll([this]);
    // One frame, so the real blocks have rendered before the overlay goes.
    requestAnimationFrame(() => this.remove());
  }

  public remove(): void {
    this.stop();
    this.groups.forEach((group) => group.remove(this.key));
    this.groups = [];
    this.items.forEach((item) => this.dropFrame(item));
  }

  private rewrite(index: number, command: PartialCommand): void {
    const spec = rewriteOf(command);
    const known = this.items.get(index);

    // Target or range may still change: keep what is drawn.
    if (spec === null) {
      return;
    }
    const target = spec.drawable ? known?.frame?.target ?? this.target(spec) : null;
    const at = target ? locate(target.original, spec.range) : null;

    // A find that misses: commit decides, so nothing shows. Undrawable text gets the reveal after commit.
    if (target === null || at === null) {
      if (known) {
        this.dropFrame(known);
        this.items.delete(index);
      }

      return;
    }
    const item = known ?? new Item(index, this.t);

    this.items.set(index, item);
    if (item.frame === null) {
      item.frame = new RewriteBox(target, item.root);
      this.deps.layer.appendChild(item.frame.box);
    }
    item.sync([{
      kind: 'rewrite',
      level: 2,
      style: 'unordered',
      text: spec.text,
      complete: spec.complete,
      // Words drop leading space, so a reply that starts with one keeps it here.
      before: target.original.slice(0, at.start) + (/^\s*/.exec(spec.text)?.[0] ?? ''),
      after: target.original.slice(at.end),
    }]);
  }

  /** The block to rewrite, its input, and its text as it is now. */
  private target(spec: RewriteSpec): RewriteTarget | null {
    const holder = this.deps.holderOf(spec.id);
    const input = holder ? fieldInput(this.deps, holder, spec) : null;
    if (holder === null || input === null || rewriting.has(holder)) {
      return null;
    }
    // A longer box would cover shown child blocks: the old text stays until commit.
    if (showsChildren(holder)) {
      return null;
    }

    return { id: spec.id, holder, input, original: input.textContent ?? '' };
  }

  public framedIds(): string[] {
    return [...this.items.values()].flatMap((item) => (item.frame === null ? [] : [item.frame.target.id]));
  }

  private dropFrame(item: Item): void {
    item.unframe(this.frameKey(item));
  }

  private frameKey(item: Item): string {
    return `rewrite:${this.id}:${item.index}`;
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Each box with its gap key. Rewrites first: their extra height sits right under their block, above any insert gap. */
  public placed(): Array<[Placed, string]> {
    return [
      ...[...this.items.values()].flatMap((item): Array<[Placed, string]> => (item.frame === null ? [] : [[item.frame, this.frameKey(item)]])),
      ...this.groups.map((group): [Placed, string] => [group, this.key]),
    ];
  }

  private ordered(): Item[] {
    return [...this.items.values()].sort((a, b) => a.index - b.index);
  }
}

/**
 * Lays out every box in four steps, so a frame forces at most two reflows however many boxes there are:
 * read sizes, write gaps, read positions, write styles. A gap moves the holders below it, so positions wait for all gaps.
 * Gap listeners (the bar) hear once, at the end.
 */
const layoutAll = (calls: CallPreview[], onDraw?: () => void): void => {
  const boxes = calls.flatMap((call) => call.placed());

  if (boxes.length === 0) {
    return;
  }
  onDraw?.();
  holdGapChanges(() => {
    boxes.forEach(([box]) => box.measure());
    boxes.forEach(([box, key]) => box.reserve(key));

    const layer = calls[0].layer.getBoundingClientRect();

    boxes.forEach(([box]) => box.locate(layer));
    boxes.forEach(([box]) => box.apply());
  });
};

export const createLivePreview = (deps: LivePreviewDeps): LivePreview => {
  const calls = new Map<string, CallPreview>();
  const finished = new Set<string>();
  const framed = new Map<string, string[]>();
  const frame: { id: number | null } = { id: null };
  const schedule = (): void => {
    if (frame.id !== null) {
      return;
    }
    frame.id = requestAnimationFrame(() => {
      frame.id = null;
      layoutAll([...calls.values()], deps.onDraw);
    });
  };
  const end = (callId: string): CallPreview | undefined => {
    const call = calls.get(callId);

    finished.add(callId);
    calls.delete(callId);
    if (call !== undefined) {
      framed.set(callId, call.framedIds());
    }

    return call;
  };

  return {
    update(callId, json) {
      if (finished.has(callId)) {
        return;
      }
      const call = calls.get(callId) ?? new CallPreview(callId, deps, schedule);

      calls.set(callId, call);
      call.render(readPartialCommands(json));
    },

    settle(callId) {
      end(callId)?.settle();
    },

    cancel(callId) {
      end(callId)?.remove();
    },

    clear() {
      calls.forEach((call, callId) => {
        finished.add(callId);
        call.remove();
      });
      calls.clear();
      framed.clear();
      if (frame.id !== null) {
        cancelAnimationFrame(frame.id);
        frame.id = null;
      }
    },

    relayout() {
      schedule();
    },

    framed(callId) {
      return framed.get(callId) ?? [];
    },

    shown(callId) {
      return calls.get(callId)?.shown === true;
    },
  };
};
