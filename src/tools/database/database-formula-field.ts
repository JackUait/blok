import type { PropertyDefinition } from './types';
import { propertyTypeMeta } from './database-property-types';
import { tokenize } from './formula/tokenizer';
import type { Token } from './formula/tokenizer';

const PROP_CALL = /(?<![\w.$])prop\("((?:[^"\\]|\\.)*)"\)/g;

const unescape = (name: string): string => name.replace(/\\(.)/g, '$1');

/**
 * notion-spec-2 §22.5: a typed `prop("Number")` turns into a "# Number" token.
 * Only names in the schema turn; an unknown one stays text so its error shows.
 */
export const renderFormulaInto = (target: HTMLElement, source: string, schema: PropertyDefinition[]): void => {
  const byName = new Map(schema.map((p) => [p.name, p]));
  const hits = [...source.matchAll(PROP_CALL)]
    .map((match) => ({ match, property: byName.get(unescape(match[1])) }))
    .filter((hit): hit is { match: RegExpExecArray; property: PropertyDefinition } => hit.property !== undefined);
  const ends = [0, ...hits.map(({ match }) => match.index + match[0].length)];
  const nodes = hits.flatMap(({ match, property }, i): Node[] => [
    ...(match.index > ends[i] ? [document.createTextNode(source.slice(ends[i], match.index))] : []),
    formulaToken(match[0], property),
  ]);
  const tail = ends[ends.length - 1];

  // A trailing newline draws no line, and the caret falls back before it, unless a <br> follows.
  const end = source.endsWith('\n') ? [lineEnd()] : [];

  target.replaceChildren(...nodes, ...(tail < source.length ? [document.createTextNode(source.slice(tail))] : []), ...end);
};

const formulaToken = (source: string, property: PropertyDefinition): HTMLElement => {
  const token = document.createElement('span');
  const icon = document.createElement('span');

  token.setAttribute('data-blok-database-formula-token', '');
  token.setAttribute('data-property', property.name);
  token.setAttribute('data-source', source);
  token.setAttribute('contenteditable', 'false');
  icon.setAttribute('data-blok-database-formula-token-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = propertyTypeMeta(property.type).icon;
  token.append(icon, property.name);

  return token;
};

const lineEnd = (): HTMLElement => {
  const br = document.createElement('br');

  br.setAttribute('data-blok-database-formula-line-end', '');

  return br;
};

const isLineEnd = (node: Node): boolean => node instanceof HTMLElement && node.hasAttribute('data-blok-database-formula-line-end');

const isToken = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && node.hasAttribute('data-blok-database-formula-token');

/** The formula text a node stands for. */
const sourceOf = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (isToken(node)) return node.getAttribute('data-source') ?? '';
  if (isLineEnd(node)) return '';
  if (node.nodeName === 'BR') return '\n';

  // A block the browser wrapped a line in starts a new line.
  const inner = [...node.childNodes].map(sourceOf).join('');

  return node.nodeName === 'DIV' || node.nodeName === 'P' ? `\n${inner}` : inner;
};

export type SyntaxKind = 'number' | 'operator' | 'function' | 'punctuation';

/** Notion's shots show only these in grey; `[`, `]` and `.` are unmeasured, so they keep the ink. */
const PUNCTUATION = new Set(['(', ')', ',']);

const kindOf = (token: Token, next: Token | undefined): SyntaxKind | null => {
  if (token.type === 'number') return 'number';
  if (token.type === 'op') return 'operator';
  if (token.type === 'ident' && next?.type === 'punct' && next.value === '(') return 'function';
  if (token.type === 'punct' && PUNCTUATION.has(token.value)) return 'punctuation';

  return null;
};

/** What to colour in `source`. A formula that stops tokenizing is coloured up to where it stops. */
const syntaxOf = (source: string): Array<{ start: number; end: number; kind: SyntaxKind }> => {
  const whole = tokenize(source);
  const prefix = whole.ok ? whole : tokenize(source.slice(0, whole.error.start));
  const tokens = prefix.ok ? prefix.tokens : [];

  return tokens.flatMap((token, i) => {
    const kind = kindOf(token, tokens[i + 1]);

    return kind === null ? [] : [{ start: token.start, end: token.end, kind }];
  });
};

/** The coloured stretches of `target`'s own text nodes. Text inside a property token is never coloured. */
const syntaxSlices = (target: HTMLElement): Array<{ node: Text; from: number; to: number; kind: SyntaxKind }> => {
  const children = [...target.childNodes];
  const lengths = children.map((child) => sourceOf(child).length);
  const runs = syntaxOf(children.map(sourceOf).join(''));

  return children.flatMap((child, i) => {
    const start = lengths.slice(0, i).reduce((sum, length) => sum + length, 0);
    const length = lengths[i];

    if (!(child instanceof Text)) return [];

    return runs
      .filter((run) => run.start >= start && run.end <= start + length)
      .map((run) => ({ node: child, from: run.start - start, to: run.end - start, kind: run.kind }));
  });
};

/** Wraps the coloured stretches of `target`'s text in spans, for text no one edits. */
export const paintFormulaInto = (target: HTMLElement): void => {
  for (const { node, from, to, kind } of syntaxSlices(target).reverse()) {
    const span = document.createElement('span');
    const tail = node.splitText(to);

    span.setAttribute('data-blok-database-formula-syntax', kind);
    span.textContent = node.data.slice(from);
    node.data = node.data.slice(0, from);
    tail.before(span);
  }
};

/**
 * The formula box: a contenteditable that shows property references as
 * tokens and reads back as plain formula text. Offsets count that text.
 */
interface Snapshot {
  value: string;
  caret: number;
}

/** Typing this soon after the last keystroke joins its undo step. */
const TYPING_STEP_MS = 1000;

export class FormulaField {
  readonly element = document.createElement('div');
  /**
   * Its own undo: re-rendering tokens wipes the browser's history, and
   * Cmd+Z must not reach the document's.
   */
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private current: Snapshot = { value: '', caret: 0 };
  private lastTyped = 0;
  /**
   * The colours, as CSS highlights: they paint the text without touching the DOM, so the caret,
   * IME and the browser's own editing never meet a syntax span.
   */
  private painted: Array<[Highlight, Range]> = [];
  private readonly onChange: () => void;

  constructor(
    private readonly schema: PropertyDefinition[],
    onChange: () => void
  ) {
    this.onChange = () => {
      this.paint();
      onChange();
    };
    this.element.setAttribute('contenteditable', 'true');
    this.element.spellcheck = false;
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    this.element.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.isComposing) return;
      this.normalize();
      this.record(true);
      this.onChange();
    });
    this.element.addEventListener('compositionend', () => {
      this.normalize();
      this.record(true);
      this.onChange();
    });
    this.element.addEventListener('keydown', (event) => this.handleKey(event));
    this.element.addEventListener('paste', (event) => {
      event.preventDefault();
      this.replaceSelection(event.clipboardData?.getData('text/plain') ?? '');
    });
  }

  get value(): string {
    const nodes = [...this.element.childNodes].filter((node) => node.nodeType !== Node.TEXT_NODE || node.nodeValue !== '');

    // A browser that deletes everything leaves one <br> to hold the line open: that is no text.
    if (nodes.length === 1 && nodes[0].nodeName === 'BR' && !isLineEnd(nodes[0])) return '';

    return nodes.map(sourceOf).join('');
  }

  /** Starts the box on `source`, with an empty undo history. */
  reset(source: string): void {
    renderFormulaInto(this.element, source, this.schema);
    this.past = [];
    this.future = [];
    this.current = { value: source, caret: source.length };
    this.paint();
  }

  /** Takes the box's colours off the page. */
  dispose(): void {
    this.painted.forEach(([highlight, range]) => highlight.delete(range));
    this.painted = [];
  }

  private paint(): void {
    this.dispose();
    // Older browsers lack the Highlight API: the box stays in plain ink there.
    if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
    for (const { node, from, to, kind } of syntaxSlices(this.element)) {
      const name = `blok-formula-${kind}`;
      const highlight = CSS.highlights.get(name) ?? new Highlight();
      const range = this.element.ownerDocument.createRange();

      CSS.highlights.set(name, highlight);
      range.setStart(node, from);
      range.setEnd(node, to);
      highlight.add(range);
      this.painted.push([highlight, range]);
    }
  }

  /** The caret's offset in `value`; the end when the selection is elsewhere. */
  caret(): number {
    return this.selection()?.end ?? this.value.length;
  }

  setCaret(offset: number): void {
    const selection = this.element.ownerDocument.getSelection();

    if (selection === null) return;
    const range = this.element.ownerDocument.createRange();
    const children = [...this.element.childNodes];
    const starts = children.map((_, i) => children.slice(0, i).reduce((sum, child) => sum + sourceOf(child).length, 0));
    const index = children.findIndex((child, i) => {
      const left = offset - starts[i];

      return child.nodeType === Node.TEXT_NODE ? left <= sourceOf(child).length : left < sourceOf(child).length;
    });
    const target = children[index];

    if (target === undefined) {
      range.setStart(this.element, children.length);
    } else if (target.nodeType === Node.TEXT_NODE) {
      range.setStart(target, offset - starts[index]);
    } else {
      // Inside a token: the caret goes after it, never into it.
      range.setStartAfter(target);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Puts `text` where `[start, end)` of `value` was, then the caret after it. */
  replace(start: number, end: number, text: string): void {
    const value = this.value;

    renderFormulaInto(this.element, `${value.slice(0, start)}${text}${value.slice(end)}`, this.schema);
    this.setCaret(start + text.length);
    this.record(false);
    this.onChange();
  }

  /** Makes the box's state the newest undo step; typing in a run shares one. */
  private record(typing: boolean): void {
    const now = Date.now();
    const next = { value: this.value, caret: this.caret() };

    if (next.value === this.current.value) return;
    if (!typing || now - this.lastTyped > TYPING_STEP_MS || this.past.length === 0) this.past.push(this.current);
    this.current = next;
    this.future = [];
    this.lastTyped = typing ? now : 0;
  }

  private step(from: Snapshot[], to: Snapshot[]): void {
    const target = from.pop();

    if (target === undefined) return;
    to.push(this.current);
    this.current = target;
    this.lastTyped = 0;
    renderFormulaInto(this.element, target.value, this.schema);
    this.setCaret(target.caret);
    this.onChange();
  }

  private replaceSelection(text: string): void {
    const at = this.selection() ?? { start: this.value.length, end: this.value.length };

    this.replace(at.start, at.end, text);
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;

    if (mod && (key === 'z' || (key === 'y' && event.ctrlKey && !event.metaKey))) {
      event.preventDefault();
      if (key === 'z' && !event.shiftKey) this.step(this.past, this.future);
      else this.step(this.future, this.past);

      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      this.replaceSelection('\n');

      return;
    }
    // §22.5: Backspace right after a token removes it whole.
    if (event.key === 'Backspace') {
      const before = this.nodeBeforeCaret();

      if (before !== null && isToken(before)) {
        event.preventDefault();
        const caret = this.caret() - sourceOf(before).length;

        before.remove();
        this.setCaret(caret);
        this.record(false);
        this.onChange();
      }
    }
  }

  /** The token or text node right before a collapsed caret at a node boundary. */
  private nodeBeforeCaret(): Node | null {
    const selection = this.element.ownerDocument.getSelection();

    if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return null;
    const { startContainer, startOffset } = selection.getRangeAt(0);

    if (startContainer === this.element) return this.element.childNodes[startOffset - 1] ?? null;
    if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0 && startContainer.parentNode === this.element) {
      return startContainer.previousSibling;
    }

    return null;
  }

  /** Turns typed references into tokens and drops a lone browser `<br>`, keeping the caret. */
  private normalize(): void {
    const value = this.value;
    const hasLooseReference = [...this.element.childNodes]
      .some((node) => node.nodeType === Node.TEXT_NODE && [...(node.nodeValue ?? '').matchAll(PROP_CALL)]
        .some((match) => this.schema.some((p) => p.name === unescape(match[1]))));
    const needsRender = hasLooseReference || (value === '' && this.element.childNodes.length > 0)
      || value.endsWith('\n') !== (this.element.lastChild !== null && isLineEnd(this.element.lastChild))
      || [...this.element.childNodes].some((node) => node.nodeType !== Node.TEXT_NODE && !isToken(node) && !isLineEnd(node));

    if (!needsRender) return;
    const caret = this.caret();

    renderFormulaInto(this.element, value, this.schema);
    if (this.element.ownerDocument.activeElement === this.element) this.setCaret(Math.min(caret, value.length));
  }

  private selection(): { start: number; end: number } | null {
    const selection = this.element.ownerDocument.getSelection();

    if (selection === null || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);

    if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer)) return null;

    return {
      start: this.offsetOf(range.startContainer, range.startOffset),
      end: this.offsetOf(range.endContainer, range.endOffset),
    };
  }

  private offsetOf(node: Node, offset: number): number {
    const children = [...this.element.childNodes];

    if (node === this.element) {
      return children.slice(0, offset).reduce((sum, child) => sum + sourceOf(child).length, 0);
    }
    const index = children.findIndex((child) => child === node || child.contains(node));
    const before = children.slice(0, index === -1 ? children.length : index).reduce((sum, child) => sum + sourceOf(child).length, 0);
    const child = children[index];

    if (child === undefined) return before;
    if (child === node) return before + offset;

    // In a token, the caret counts as after it; in a wrapped line, as inside its text.
    return before + (isToken(child) ? sourceOf(child).length : Math.min(offset, sourceOf(child).length));
  }
}
