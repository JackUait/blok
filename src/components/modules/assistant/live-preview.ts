import { readPartialCommands } from '../../../agent/partial-json';
import type { PartialCommand } from '../../../agent/partial-json';
import { BLOCK_CONTENT_CLASSES } from '../../../shared/block-scaffolding';
import { headerClasses } from '../../../shared/tool-classes/header';
import { LIST_CONTENT_CLASSES, LIST_ITEM_CLASSES, LIST_ITEM_ROW_CLASSES } from '../../../shared/tool-classes/list';
import { PARAGRAPH_CLASSES } from '../../../shared/tool-classes/paragraph';
import { createMarker } from '../../../tools/list/dom-builder';
import { DATA_ATTR } from '../../constants/data-attributes';
import { prefersReducedMotion } from '../../utils/reduced-motion';

import { gapSize, releaseGap, reserveGap } from './gap';
import type { GapSide } from './gap';

export interface LivePreviewDeps {
  /** Overlay host: UI.nodes.wrapper. */
  layer: HTMLElement;
  holderOf(id: string): HTMLElement | null;
  edgeHolder(edge: 'start' | 'end', parentId?: string): HTMLElement | null;
  /** The bar's block. */
  anchorHolder(): HTMLElement | null;
}

export interface LivePreview {
  /** From tool_input: the `blok_execute` input JSON so far. */
  update(callId: string, json: string): void;
  /** Batch applied: clear on the next frame. */
  settle(callId: string): void;
  /** Failed, stopped or cut off. */
  cancel(callId: string): void;
  clear(): void;
}

/** Words land at least this far apart, so a burst of deltas still reads as typing. */
const WORD_GAP_MS = 35;

const INSERTS = new Set(['block.insert', 'markdown.insert']);

type Kind = 'paragraph' | 'header' | 'list';
type ListStyle = 'unordered' | 'ordered' | 'checklist';

interface LineSpec { kind: Kind; level: number; style: ListStyle; text: string; complete: boolean }

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

/** Plain text of streamed inline HTML. Never parsed as HTML. */
const plainText = (html: string): string =>
  withoutCutTail(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, decodeEntity);

const richText = (value: unknown): string => {
  if (typeof value === 'string') {
    return plainText(value);
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

  return { kind, level, style, text: richText(data.text), complete };
};

const inlineMarkdown = (text: string): string =>
  plainText(text.replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1').replace(/\*\*|__|~~|`|\*/g, ''));

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
      specs.push({ ...base, kind: 'paragraph', text: inlineMarkdown(paragraph.texts.join(' ')), complete: paragraph.complete });
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
      specs.push({ ...base, kind: 'header', level: heading[1].length, text: inlineMarkdown(heading[2]), complete });
    } else if (check ?? bullet ?? number) {
      const [style, match] = listMatch(check, bullet, number);

      flush();
      specs.push({ ...base, kind: 'list', style, text: inlineMarkdown(match), complete });
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

const SLOTS: Record<Kind, string[]> = { header: ['heading'], list: ['short'], paragraph: ['line', 'short'] };

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
  if (spec.kind === 'header') {
    const heading = document.createElement(`h${spec.level}`);

    heading.className = headerClasses(spec.level).join(' ');
    heading.setAttribute(DATA_ATTR.headingLevel, String(spec.level));

    return { block: heading, text: heading };
  }
  if (spec.kind === 'list') {
    const block = document.createElement('div');
    const row = document.createElement('div');
    const marker = createMarker(spec.style === 'ordered' ? 'ordered' : 'unordered', 0);
    const text = document.createElement('div');

    block.className = LIST_ITEM_CLASSES.join(' ');
    block.setAttribute('data-list-style', spec.style);
    row.className = LIST_ITEM_ROW_CLASSES.join(' ');
    text.className = LIST_CONTENT_CLASSES.join(' ');
    if (spec.style === 'ordered') {
      marker.textContent = `${ordinal}.`;
    }
    row.append(marker, text);
    block.append(row);

    return { block, text };
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

  constructor(public spec: LineSpec, private ordinal: number) {
    this.el.className = BLOCK_CONTENT_CLASSES.join(' ');
  }

  public get pending(): boolean {
    return this.spans.length < landable(this.spec);
  }

  public update(spec: LineSpec, ordinal: number): void {
    this.spec = spec;
    this.ordinal = ordinal;
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
    const shape = `${this.spec.kind}:${this.spec.level}:${this.spec.style}:${this.ordinal}`;

    if (this.spans.length === 0 && (this.text !== null || this.shape !== shape)) {
      this.el.replaceChildren(...makeSlots(this.spec.kind));
      this.text = null;
    } else if (this.spans.length > 0 && (this.text === null || this.shape !== shape)) {
      const { block, text } = makeBlock(this.spec, this.ordinal);

      text.append(...this.spans);
      this.el.replaceChildren(block);
      this.text = text;
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

  constructor(public readonly index: number) {}

  public join(group: Group): void {
    this.group = group;
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

/** The items of one call that sit in one gap, drawn in one overlay box. */
class Group {
  public readonly box = document.createElement('div');

  constructor(public readonly holder: HTMLElement, public readonly side: GapSide) {
    const computed = getComputedStyle(holder);

    this.box.setAttribute(DATA_ATTR.aiPreview, '');
    this.box.setAttribute('data-blok-testid', 'ai-preview');
    this.box.setAttribute('aria-hidden', 'true');
    this.box.setAttribute('inert', '');
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

  /** Sizes the gap to the box and puts the box in it. */
  public place(key: string, layer: DOMRect): void {
    const height = this.box.getBoundingClientRect().height;
    const offset = reserveGap(this.holder, key, height, this.side);
    const rect = this.holder.getBoundingClientRect();
    const top = this.side === 'end'
      ? rect.bottom - layer.top + offset
      : rect.top - layer.top - gapSize(this.holder, 'start') + offset;

    this.box.style.top = `${top}px`;
    this.box.style.left = `${rect.left - layer.left}px`;
    this.box.style.width = `${rect.width}px`;
  }

  public remove(key: string): void {
    this.box.remove();
    releaseGap(this.holder, key, this.side);
  }
}

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

  constructor(private readonly id: string, private readonly deps: LivePreviewDeps) {}

  private get key(): string {
    return `call:${this.id}`;
  }

  public render(commands: PartialCommand[]): void {
    commands.forEach((command, index) => {
      if (command.name === undefined || !INSERTS.has(command.name)) {
        return;
      }
      const item = this.items.get(index) ?? new Item(index);

      item.ref = command.ref;
      this.items.set(index, item);
      item.sync(command.name === 'markdown.insert' ? markdownLines(command) : [blockLine(command)]);
    });

    const groups: Group[] = [];

    plan(this.deps, this.items, commands).forEach((sides, holder) => {
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
    this.layout();
    this.pump();
  }

  /** Lands the next word, at most one per WORD_GAP_MS. */
  public pump(): void {
    if (this.timer !== null) {
      return;
    }
    const line = this.ordered().flatMap((item) => (item.group ? item.lines : [])).find((known) => known.pending);

    if (line === undefined) {
      this.items.forEach((item) => item.lines.forEach((known) => known.tails()));

      return;
    }
    const wait = WORD_GAP_MS - (Date.now() - this.lastLanded);

    if (wait <= 0) {
      line.land();
      this.lastLanded = Date.now();
      this.items.forEach((item) => item.lines.forEach((known) => known.tails()));
      this.layout();
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait > 0 ? wait : WORD_GAP_MS);
  }

  public settle(): void {
    this.stop();
    this.items.forEach((item) => item.lines.forEach((line) => line.finish()));
    this.layout();
    // One frame, so the real blocks have rendered before the overlay goes.
    requestAnimationFrame(() => this.remove());
  }

  public remove(): void {
    this.stop();
    this.groups.forEach((group) => group.remove(this.key));
    this.groups = [];
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private layout(): void {
    const layer = this.deps.layer.getBoundingClientRect();

    this.groups.forEach((group) => group.place(this.key, layer));
  }

  private ordered(): Item[] {
    return [...this.items.values()].sort((a, b) => a.index - b.index);
  }
}

export const createLivePreview = (deps: LivePreviewDeps): LivePreview => {
  const calls = new Map<string, CallPreview>();
  const finished = new Set<string>();
  const end = (callId: string): CallPreview | undefined => {
    const call = calls.get(callId);

    finished.add(callId);
    calls.delete(callId);

    return call;
  };

  return {
    update(callId, json) {
      if (finished.has(callId)) {
        return;
      }
      const call = calls.get(callId) ?? new CallPreview(callId, deps);

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
      calls.forEach((call) => call.remove());
      calls.clear();
    },
  };
};
