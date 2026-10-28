import type { RenderContext } from './context';
import { MAX_DEPTH, deeper } from './context';
import type { Css } from './props';
import { applyCss, mergeCss, parseRunProps, runDeclarations } from './props';
import { renderDrawing } from './drawing';
import { visibleGlyph } from './glyphs';
import { renderMath } from './math';
import { safeHref } from '../../../shared/sanitize-url';
import { attr, kid, kids, num } from './xml';

/** Where inline content goes. A page break swaps `target` for a fresh paragraph. */
export interface InlineState {
  target: HTMLElement;
  /** Paragraph-level run layer: defaults, table layer, paragraph style. */
  run: Css;
  /** Starts a new page mid-paragraph; null where pages cannot break. */
  breakPage: (() => void) | null;
}

/** Elements whose children render as if they were not there. */
const TRANSPARENT = new Set(['ins', 'moveTo', 'smartTag', 'customXml', 'fldSimple', 'dir', 'bdo', 'sdtContent']);
/** Elements whose content is not shown. */
const HIDDEN = new Set(['del', 'moveFrom', 'pPr', 'rPr', 'sdtPr', 'sdtEndPr', 'delText', 'delInstrText', 'instrText', 'commentReference']);

/** The branch of `mc:AlternateContent` to render: the first Choice, else the Fallback. */
export function alternateBranch(el: Element): Element | null {
  return kid(el, 'Choice') ?? kid(el, 'Fallback');
}

const MAX_CODE_POINT = 0x10ffff;

/** Word sets equations in Cambria Math whatever the run font says. */
const MATH_FONT = '"Cambria Math", "STIX Two Math", serif';

const hiddenByField = (ctx: RenderContext): boolean => ctx.fields.hidden;

/** Track a complex field's begin / separate / end on the document-wide field stack. */
function fieldChar(el: Element, fields: RenderContext['fields']): void {
  const type = attr(el, 'fldCharType');
  if (type === 'begin') {
    fields.begin();
  } else if (type === 'separate') {
    fields.separate();
  } else if (type === 'end') {
    fields.end();
  }
}

/** A run's own span, created on first content, re-created after a page break. */
class RunWriter {
  private span: HTMLElement | null = null;

  constructor(private readonly state: InlineState, private readonly css: Css) {}

  /** The run is already set as superscript. */
  get raised(): boolean {
    return this.css['@vert'] === 'super';
  }

  out(): HTMLElement {
    if (this.span === null || this.span.parentElement !== this.state.target) {
      this.span = document.createElement('span');
      applyCss(this.span, runDeclarations(this.css));
      this.state.target.appendChild(this.span);
    }

    return this.span;
  }

  text(value: string): void {
    if (value !== '') {
      this.out().append(value);
    }
  }

  node(node: Node): void {
    this.out().appendChild(node);
  }
}

function renderRunChild(child: Element, writer: RunWriter, state: InlineState, ctx: RenderContext): void {
  switch (child.localName) {
    case 'fldChar':
      fieldChar(child, ctx.fields);

      return;
    case 'AlternateContent': {
      const branch = alternateBranch(child);
      for (const inner of branch === null ? [] : kids(branch)) {
        renderRunChild(inner, writer, state, ctx);
      }

      return;
    }
    default:
      break;
  }
  if (hiddenByField(ctx)) {
    return;
  }
  switch (child.localName) {
    case 't':
      writer.text(child.textContent ?? '');
      break;
    case 'tab':
    case 'ptab':
      writer.text('\t');
      break;
    case 'br':
      if (attr(child, 'type') === 'page' && state.breakPage !== null) {
        state.breakPage();
      } else {
        writer.node(document.createElement('br'));
      }
      break;
    case 'cr':
      writer.node(document.createElement('br'));
      break;
    case 'noBreakHyphen':
      writer.text('‑');
      break;
    case 'softHyphen':
      writer.text('­');
      break;
    case 'sym': {
      const code = num(`0x${attr(child, 'char') ?? ''}`);
      writer.text(code === null || code > MAX_CODE_POINT ? '' : visibleGlyph(String.fromCodePoint(code), attr(child, 'font') ?? ''));
      break;
    }
    case 'footnoteReference':
    case 'endnoteReference': {
      const mark = ctx.notes.reference(child.localName === 'footnoteReference' ? 'footnote' : 'endnote', attr(child, 'id') ?? '', writer.raised);
      if (mark !== null) {
        writer.node(mark);
      }
      break;
    }
    case 'footnoteRef':
    case 'endnoteRef': {
      // A run already set as superscript must not be raised a second time.
      const mark = document.createElement(writer.raised ? 'span' : 'sup');
      mark.textContent = ctx.notes.current() ?? '';
      writer.node(mark);
      break;
    }
    case 'drawing':
    case 'pict':
    case 'object': {
      const drawn = renderDrawing(child, ctx);
      if (drawn !== null) {
        writer.node(drawn);
      }
      break;
    }
    default:
      break;
  }
}

function renderRun(r: Element, state: InlineState, ctx: RenderContext): void {
  const rPr = kid(r, 'rPr');
  const direct = parseRunProps(rPr, ctx.styles.theme);
  const css = mergeCss(state.run, ctx.styles.character(kid(rPr, 'rStyle') === null ? null : attr(kid(rPr, 'rStyle'), 'val')), direct);
  const writer = new RunWriter(state, css);
  const hidden = css['@hidden'] === '1';

  for (const child of kids(r)) {
    // Field characters still count inside hidden runs, or the field never closes.
    if (hidden && child.localName !== 'fldChar') {
      continue;
    }
    renderRunChild(child, writer, state, ctx);
  }
}

/** A link from a hyperlink's relationship: only explicit safe schemes, never relative. */
function externalHref(target: string): string | null {
  const href = safeHref(target);

  return href !== null && /^[a-z][a-z0-9+.-]*:/i.test(target.trim()) ? href : null;
}

function renderHyperlink(el: Element, state: InlineState, ctx: RenderContext): void {
  const a = document.createElement('a');
  const anchor = attr(el, 'anchor');
  const relId = attr(el, 'id');

  const rel = ctx.rels.find((r) => r.id === relId && r.external);
  const href = rel === undefined ? null : externalHref(rel.target);
  if (href !== null) {
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else if (anchor !== null && relId === null) {
    a.href = '#';
    a.addEventListener('click', (event) => {
      event.preventDefault();
      ctx.bookmarks.get(anchor)?.scrollIntoView({ block: 'start' });
    });
  }

  state.target.appendChild(a);
  renderInline(el, { ...state, target: a, breakPage: null }, deeper(ctx));
}

function renderInlineOf(parent: Element | null, state: InlineState, ctx: RenderContext): void {
  if (parent !== null) {
    renderInline(parent, state, ctx);
  }
}

/** The first bookmark of a name wins; later duplicates still get their span. */
function renderBookmark(el: Element, state: InlineState, ctx: RenderContext): void {
  const mark = document.createElement('span');
  const bookmark = attr(el, 'name');
  if (bookmark !== null && !ctx.bookmarks.has(bookmark)) {
    ctx.bookmarks.set(bookmark, mark);
  }
  state.target.appendChild(mark);
}

function renderInlineChild(child: Element, state: InlineState, ctx: RenderContext): void {
  const name = child.localName;
  if (name === 'r') {
    renderRun(child, state, ctx);
  } else if (name === 'hyperlink') {
    renderHyperlink(child, state, ctx);
  } else if (name === 'sdt') {
    renderInlineOf(kid(child, 'sdtContent'), state, deeper(ctx));
  } else if (TRANSPARENT.has(name)) {
    renderInline(child, state, deeper(ctx));
  } else if (name === 'AlternateContent') {
    renderInlineOf(alternateBranch(child), state, deeper(ctx));
  } else if (name === 'bookmarkStart') {
    renderBookmark(child, state, ctx);
  } else if ((name === 'oMath' || name === 'oMathPara') && !hiddenByField(ctx)) {
    const math = document.createElement('span');
    applyCss(math, runDeclarations(state.run));
    math.style.setProperty('font-family', MATH_FONT);
    renderMath(child, math);
    state.target.appendChild(math);
  }
}

/** Render the inline children of a paragraph-like element. */
export function renderInline(parent: Element, state: InlineState, ctx: RenderContext): void {
  if (ctx.depth > MAX_DEPTH) {
    return;
  }
  for (const child of kids(parent)) {
    if (!HIDDEN.has(child.localName)) {
      renderInlineChild(child, state, ctx);
    }
  }
}
