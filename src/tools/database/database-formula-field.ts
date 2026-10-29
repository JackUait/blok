import type { PropertyDefinition } from './types';
import { propertyTypeMeta } from './database-property-types';

const PROP_CALL = /prop\("((?:[^"\\]|\\.)*)"\)/g;

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

  target.replaceChildren(...nodes, ...(tail < source.length ? [document.createTextNode(source.slice(tail))] : []));
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

const isToken = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && node.hasAttribute('data-blok-database-formula-token');

/** The formula text a node stands for. */
const sourceOf = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (isToken(node)) return node.getAttribute('data-source') ?? '';
  if (node.nodeName === 'BR') return '\n';

  // A block the browser wrapped a line in starts a new line.
  const inner = [...node.childNodes].map(sourceOf).join('');

  return node.nodeName === 'DIV' || node.nodeName === 'P' ? `\n${inner}` : inner;
};

/**
 * The formula box: a contenteditable that shows property references as
 * tokens and reads back as plain formula text. Offsets count that text.
 */
export class FormulaField {
  readonly element = document.createElement('div');

  constructor(
    private readonly schema: PropertyDefinition[],
    private readonly onChange: () => void
  ) {
    this.element.setAttribute('contenteditable', 'true');
    this.element.spellcheck = false;
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    this.element.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.isComposing) return;
      this.normalize();
      this.onChange();
    });
    this.element.addEventListener('compositionend', () => {
      this.normalize();
      this.onChange();
    });
    this.element.addEventListener('keydown', (event) => this.handleKey(event));
    this.element.addEventListener('paste', (event) => {
      event.preventDefault();
      this.replaceSelection(event.clipboardData?.getData('text/plain') ?? '');
    });
  }

  get value(): string {
    return [...this.element.childNodes].map(sourceOf).join('');
  }

  set value(source: string) {
    renderFormulaInto(this.element, source, this.schema);
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

    this.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    this.setCaret(start + text.length);
    this.onChange();
  }

  private replaceSelection(text: string): void {
    const at = this.selection() ?? { start: this.value.length, end: this.value.length };

    this.replace(at.start, at.end, text);
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
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
      || [...this.element.childNodes].some((node) => node.nodeType !== Node.TEXT_NODE && !isToken(node));

    if (!needsRender) return;
    const caret = this.caret();

    this.value = value;
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
