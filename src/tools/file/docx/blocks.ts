import type { RenderContext } from './context';
import type { ParaProps } from './props';
import { MAX_DEPTH, deeper } from './context';
import { alternateBranch, renderInline } from './inline';
import { applyCss, mergeCss, mergePara, parseParaProps, runDeclarations } from './props';
import { renderTable } from './table';
import { attr, kid, kids } from './xml';

/** Where block-level output goes. Only the main body can break pages. */
export interface BlockSink {
  add(node: Node): void;
  /** Start a new page; a no-op while the current page is still empty. */
  pageBreak(): void;
  /** The paragraph that carried a `w:sectPr` has ended its section. */
  endSection(): void;
}

/** Collects nodes and ignores page and section breaks (cells, text boxes, notes). */
export function collectingSink(nodes: Node[]): BlockSink {
  return { add: (node) => nodes.push(node), pageBreak: () => undefined, endSection: () => undefined };
}

/** Word draws a bare tab stop every half inch. */
const DEFAULT_TAB = '36pt';

function paragraphElement(props: ParaProps): HTMLParagraphElement {
  const el = document.createElement('p');
  applyCss(el, props.css);
  el.style.setProperty('tab-size', DEFAULT_TAB);
  if (props.bidi === true) {
    el.dir = 'rtl';
  }

  return el;
}

/** Give a paragraph with no visible content its line height. */
function keepLine(el: HTMLElement): void {
  if (el.textContent === '' && el.querySelector('br, img') === null) {
    el.appendChild(document.createElement('br'));
  }
}

export function renderParagraph(p: Element, ctx: RenderContext, sink: BlockSink): void {
  const direct = parseParaProps(kid(p, 'pPr'));
  const style = ctx.styles.paragraph(direct.styleId);
  const numId = direct.numId ?? style.para.numId;
  const ilvl = direct.ilvl ?? style.para.ilvl ?? 0;
  const marker = numId === undefined || numId === '0' ? null : ctx.numbering.marker(numId, ilvl);
  const props = mergePara(ctx.styles.defaultPara, ctx.layer.para, style.para, marker?.para, direct);
  const run = mergeCss(ctx.styles.defaultRun, ctx.layer.run, style.run);

  if (props.pageBreakBefore === true && ctx.pageable) {
    sink.pageBreak();
  }

  const fragments: HTMLParagraphElement[] = [paragraphElement(props)];
  const state = {
    target: fragments[0] as HTMLElement,
    run,
    breakPage: ctx.pageable
      ? () => {
        const done = fragments[fragments.length - 1];
        keepLine(done);
        sink.add(done);
        sink.pageBreak();
        const next = paragraphElement(props);
        next.style.removeProperty('text-indent');
        fragments.push(next);
        state.target = next;
      }
      : null,
  };

  if (marker !== null) {
    const span = document.createElement('span');
    span.className = 'blok-docx-marker';
    applyCss(span, runDeclarations(mergeCss(run, marker.run)));
    span.textContent = marker.text + (marker.suffix === 'space' ? ' ' : '');
    // A tab after the marker reaches the hanging indent, where the text starts.
    const hanging = /^-([\d.]+)pt$/.exec(props.css['text-indent'] ?? '');
    if (marker.suffix === 'tab' && hanging !== null) {
      span.style.display = 'inline-block';
      span.style.minWidth = `${hanging[1]}pt`;
      // An inline-block inherits text-indent and would shift its own text by it.
      span.style.textIndent = '0';
    } else if (marker.suffix === 'tab') {
      span.append('\t');
    }
    fragments[0].appendChild(span);
  }

  renderInline(p, state, ctx);

  const last = fragments[fragments.length - 1];
  // A page break that ends the paragraph leaves nothing for the next page.
  const emptyTail = fragments.length > 1 && last.childNodes.length === 0;
  if (!emptyTail) {
    keepLine(last);
    sink.add(last);
  }

  const sectPr = kid(kid(p, 'pPr'), 'sectPr');
  if (sectPr !== null && ctx.pageable) {
    sink.endSection();
  }
}

/** Bookmarks between blocks (pandoc puts every heading's there) point at the next block. */
function bookmarkingSink(sink: BlockSink, pending: string[], ctx: RenderContext): BlockSink {
  return {
    pageBreak: () => sink.pageBreak(),
    endSection: () => sink.endSection(),
    add: (node) => {
      for (const name of pending.splice(0)) {
        if (node instanceof Element && !ctx.bookmarks.has(name)) {
          ctx.bookmarks.set(name, node);
        }
      }
      sink.add(node);
    },
  };
}

/** Render the block-level children of a body, cell, text box, note or header. */
export function renderBlocks(parent: Element, ctx: RenderContext, target: BlockSink): void {
  if (ctx.depth > MAX_DEPTH) {
    return;
  }
  const pending: string[] = [];
  const sink = bookmarkingSink(target, pending, ctx);
  for (const child of kids(parent)) {
    switch (child.localName) {
      case 'bookmarkStart':
        pending.push(attr(child, 'name') ?? '');
        break;
      case 'p':
        renderParagraph(child, ctx, sink);
        break;
      case 'tbl':
        sink.add(renderTable(child, ctx));
        break;
      case 'sdt':
        renderBlocksOf(kid(child, 'sdtContent'), deeper(ctx), sink);
        break;
      case 'customXml':
      case 'ins':
      case 'moveTo':
        renderBlocks(child, deeper(ctx), sink);
        break;
      case 'AlternateContent':
        renderBlocksOf(alternateBranch(child), deeper(ctx), sink);
        break;
      default:
        break;
    }
  }
}

function renderBlocksOf(parent: Element | null, ctx: RenderContext, sink: BlockSink): void {
  if (parent !== null) {
    renderBlocks(parent, ctx, sink);
  }
}

/** `RenderContext.blocks`: block children as a node list, outside any page flow. */
export function blocksAsNodes(parent: Element, ctx: RenderContext): Node[] {
  const nodes: Node[] = [];
  renderBlocks(parent, ctx, collectingSink(nodes));

  return nodes;
}
