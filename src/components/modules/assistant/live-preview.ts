import { readPartialCommands } from '../../../agent/partial-json';
import type { PartialCommand } from '../../../agent/partial-json';
import { headerClasses } from '../../../shared/tool-classes/header';
import { LIST_CONTENT_CLASSES, LIST_ITEM_CLASSES, LIST_ITEM_ROW_CLASSES } from '../../../shared/tool-classes/list';
import { PARAGRAPH_CLASSES } from '../../../shared/tool-classes/paragraph';
import { createMarker } from '../../../tools/list/dom-builder';
import { DATA_ATTR } from '../../constants/data-attributes';
import { prefersReducedMotion } from '../../utils/reduced-motion';

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
  /** A word just landed and is placed: the page may follow it. */
  onWord?(word: HTMLElement): void;
  /** A layout is about to place boxes, before its gap writes: the preview now shows where edits land. */
  onDraw?(): void;
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

type Kind = 'paragraph' | 'header' | 'list' | 'rewrite';
type ListStyle = 'unordered' | 'ordered' | 'checklist';

/** `before` / `after`: a rewrite's text outside the replaced range. */
interface LineSpec { kind: Kind; level: number; style: ListStyle; text: string; complete: boolean; before?: string; after?: string }

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

const blockLine = (command: PartialCommand): LineSpec => {
  const { args, done } = command;
  const data = isRecord(args.data) ? args.data : {};
  const type = args.type;
  const complete = done || settled(args, 'data', done) || settled(data, 'text', done);
  const level = typeof data.level === 'number' && data.level >= 1 && data.level <= 6 ? data.level : 2;
  const style = listStyle(data.style);
  const kind: Kind = type === 'header' || type === 'list' ? type : 'paragraph';

  return { kind, level, style, text: richText(data.text, complete), complete };
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

const markdownLines = (command: PartialCommand): LineSpec[] => {
  const { args, done } = command;
  const markdown = typeof args.markdown === 'string' ? args.markdown : '';
  const allDone = settled(args, 'markdown', done);
  const raw = markdown.split('\n');
  const specs: LineSpec[] = [];
  const paragraph: { texts: string[]; complete: boolean } = { texts: [], complete: true };
  const base = { level: 2, style: 'unordered' as ListStyle };
  const flush = (): void => {
    if (paragraph.texts.length > 0) {
      specs.push({ ...base, kind: 'paragraph', text: inlineMarkdown(paragraph.texts.join(' '), paragraph.complete), complete: paragraph.complete });
    }
    paragraph.texts = [];
  };

  raw.forEach((line, index) => {
    const complete = allDone || index < raw.length - 1;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const check = /^\s*[-*+]\s+\[[ xX]\]\s*(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (line.trim() === '' || (!complete && MARKER_ONLY.test(line.trim()))) {
      flush();
    } else if (heading) {
      flush();
      specs.push({ ...base, kind: 'header', level: heading[1].length, text: inlineMarkdown(heading[2], complete), complete });
    } else if (check ?? bullet ?? number) {
      const [style, match] = listMatch(check, bullet, number);

      flush();
      specs.push({ ...base, kind: 'list', style, text: inlineMarkdown(match, complete), complete });
    } else {
      paragraph.texts.push(line.trim());
      paragraph.complete = complete;
    }
  });
  flush();

  return specs.length > 0 ? specs : [{ ...base, kind: 'paragraph', text: '', complete: allDone }];
};

const tokensOf = (spec: LineSpec): string[] => spec.text.match(/\S+\s*/g) ?? [];

/** Words that can land now: a word still being written waits for its trailing space. */
const landable = (spec: LineSpec): number => {
  const tokens = tokensOf(spec);

  return spec.complete ? tokens.length : tokens.filter((token) => /\s$/.test(token)).length;
};

const SLOTS: Record<Kind, string[]> = { header: ['heading'], list: ['short'], paragraph: ['line', 'short'], rewrite: ['line'] };

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

/** The real tool's markup and classes, so the hand-off to the real block does not jump. */
const makeBlock = (spec: LineSpec, ordinal: number): { block: HTMLElement; text: HTMLElement } => {
  if (spec.kind === 'rewrite') {
    // The box already copies the field's own type, so plain text nodes match it.
    const rewriteFrame = document.createElement('div');
    const rewriteText = document.createElement('span');

    rewriteFrame.append(spec.before ?? '', rewriteText, spec.after ?? '');

    return { block: rewriteFrame, text: rewriteText };
  }
  if (spec.kind === 'header') {
    const heading = document.createElement(`h${spec.level}`);

    heading.className = headerClasses(spec.level).join(' ');
    heading.setAttribute(DATA_ATTR.headingLevel, String(spec.level));

    return { block: heading, text: heading };
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

    return { block: listItem, text: listText };
  }
  const paragraph = document.createElement('div');

  paragraph.className = PARAGRAPH_CLASSES.join(' ');

  return { block: paragraph, text: paragraph };
};

/** One block in the preview: slots until its first word, then the real block's markup. */
class Line {
  public readonly el = document.createElement('div');
  private shape = '';
  /** Where words go; null while the line still shows slots. */
  private text: HTMLElement | null = null;
  private readonly spans: HTMLElement[] = [];

  constructor(public spec: LineSpec, private ordinal: number) {}

  public get pending(): boolean {
    return this.spans.length < landable(this.spec);
  }

  public get newest(): HTMLElement | undefined {
    return this.spans[this.spans.length - 1];
  }

  public update(spec: LineSpec, ordinal: number): void {
    const tokens = tokensOf(spec);

    this.spec = spec;
    this.ordinal = ordinal;
    // A landed word can still change: a soft-wrapped line gains a space, a link loses its bracket.
    this.spans.splice(tokens.length).forEach((span) => span.remove());
    this.spans.forEach((landedWord, index) => {
      if (landedWord.textContent !== tokens[index]) {
        landedWord.replaceChildren(tokens[index]);
      }
    });
    this.draw();
  }

  public land(): void {
    const span = document.createElement('span');

    span.className = 'blok-ai-word';
    span.textContent = tokensOf(this.spec)[this.spans.length] ?? '';
    this.spans.push(span);
    if (this.text === null) {
      this.draw();
    } else {
      this.text.append(span);
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
    const shape = `${this.spec.kind}:${this.spec.level}:${this.spec.style}:${this.ordinal}:${this.spec.before ?? ''}:${this.spec.after ?? ''}`;
    // A range rewrite shows the text around the range at once.
    const framed = this.spans.length > 0 || Boolean(this.spec.before) || Boolean(this.spec.after);

    if (!framed && (this.text !== null || this.shape !== shape)) {
      this.el.replaceChildren(...makeSlots(this.spec.kind));
      this.text = null;
    } else if (framed && (this.text === null || this.shape !== shape)) {
      const { block, text: previewText } = makeBlock(this.spec, this.ordinal);

      previewText.append(...this.spans);
      this.el.replaceChildren(block);
      this.text = previewText;
    }
    this.shape = shape;
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

  constructor(public readonly index: number) {}

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

    const ordinal = { count: 0 };

    specs.forEach((spec, index) => {
      ordinal.count = spec.kind === 'list' && spec.style === 'ordered' ? ordinal.count + 1 : 0;

      const known = this.lines[index];

      if (known) {
        known.update(spec, ordinal.count);

        return;
      }
      const line = new Line(spec, ordinal.count);

      this.root.append(line.el);
      this.lines.push(line);
      line.update(spec, ordinal.count);
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

type RewriteRange = 'all' | { start: number; end: number } | { find: string; occurrence: number };

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

  if (typeof value.find === 'string' && value.find.trim() !== '' && Number.isInteger(occurrence) && Number(occurrence) >= 1) {
    return { find: value.find, occurrence: Number(occurrence) };
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
  const search = { at: -1, count: 0 };

  while (search.count < range.occurrence) {
    search.at = text.indexOf(range.find, search.at + 1);
    if (search.at < 0) {
      return null;
    }
    search.count += 1;
  }

  return { start: search.at, end: search.at + range.find.length };
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

  /** The newest word landed since the last layout: the page may follow it once it is placed. */
  private word: HTMLElement | null = null;

  constructor(
    private readonly id: string,
    private readonly deps: LivePreviewDeps,
    private readonly requestLayout: () => void
  ) {}

  private get key(): string {
    return `call:${this.id}`;
  }

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
      const item = this.items.get(index) ?? new Item(index);

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
      this.landed(lines[lines.length - 1]);

      return;
    }
    const wait = WORD_GAP_MS - (Date.now() - this.lastLanded);

    if (wait <= 0) {
      line.land();
      this.lastLanded = Date.now();
      this.landed(line);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait > 0 ? wait : WORD_GAP_MS);
  }

  /** After a word lands: tails, a layout, a frame to mark the call shown. The page follows the word once it is placed. */
  private landed(line: Line): void {
    this.items.forEach((item) => item.lines.forEach((known) => known.tails()));
    this.word = line.newest ?? this.word;
    this.requestLayout();
    if (this.painted === 'no') {
      this.painted = 'waiting';
      requestAnimationFrame(() => {
        this.painted = 'yes';
      });
    }
  }

  /** After a layout: the newest word is placed, so the page may follow it. */
  public followWord(): void {
    const word = this.word;

    this.word = null;
    if (word !== null) {
      this.deps.onWord?.(word);
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
    const item = known ?? new Item(index);

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
  // Last: following reads the placed word, after the bar has moved too.
  calls.forEach((call) => call.followWord());
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
