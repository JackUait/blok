import type { BlockSink } from './blocks';
import type { RenderContext } from './context';
import type { Notes, NotesPart } from './notes';
import { alternateBranch } from './inline';
import { MAX_DEPTH, inPart } from './context';
import { attr, kid, kids, num, round } from './xml';

type HeaderKind = 'default' | 'first' | 'even';

export interface Section {
  width: number;
  margins: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  titlePage: boolean;
  /** Newspaper columns of the body, or null for one. */
  columns: { count: number; gap: number } | null;
  /** Starts on the same page as the section before it. */
  continuous: boolean;
  headers: Partial<Record<HeaderKind, string>>;
  footers: Partial<Record<HeaderKind, string>>;
}


/** US Letter with one-inch margins, Word's default page, in twips. */
const LETTER_WIDTH = 12240;
const INCH = 1440;
const HALF_INCH = 720;

/**
 * Most elements all header and footer copies may add. A real document stays far
 * below it; a tiny file that repeats a long header over thousands of page
 * breaks would otherwise multiply it without bound.
 */
const HEADER_COPY_BUDGET = 30_000;
/** Most characters all header and footer copies may add; a long header text costs few elements. */
const HEADER_TEXT_BUDGET = 1_000_000;

const pt = (twipValue: number): string => `${round(twipValue / 20)}pt`;

function refs(sectPr: Element, tag: string): Partial<Record<HeaderKind, string>> {
  const out: Partial<Record<HeaderKind, string>> = {};
  for (const ref of kids(sectPr, tag)) {
    const type = (attr(ref, 'type') ?? 'default') as HeaderKind;
    const id = attr(ref, 'id');
    if (id !== null && ['default', 'first', 'even'].includes(type)) {
      out[type] = id;
    }
  }

  return out;
}

/** Word caps a section at 45 columns; more would be noise. */
const MAX_COLUMNS = 45;

function parseColumns(cols: Element | null): Section['columns'] {
  const count = Math.min(MAX_COLUMNS, Math.trunc(num(attr(cols, 'num')) ?? 1));

  return count > 1 ? { count, gap: Math.max(0, num(attr(cols, 'space')) ?? HALF_INCH) } : null;
}

const sameColumns = (a: Section['columns'], b: Section['columns']): boolean =>
  a?.count === b?.count && a?.gap === b?.gap;

function parseSection(sectPr: Element | null, previous: Section | null): Section {
  const pgSz = kid(sectPr, 'pgSz');
  const pgMar = kid(sectPr, 'pgMar');
  const margin = (name: string, fallback: number): number => Math.max(0, num(attr(pgMar, name)) ?? fallback);

  return {
    width: num(attr(pgSz, 'w')) ?? LETTER_WIDTH,
    margins: {
      top: margin('top', INCH),
      right: margin('right', INCH),
      bottom: margin('bottom', INCH),
      left: margin('left', INCH),
      header: margin('header', HALF_INCH),
      footer: margin('footer', HALF_INCH),
    },
    titlePage: kid(sectPr, 'titlePg') !== null && attr(kid(sectPr, 'titlePg'), 'val') !== '0',
    columns: parseColumns(kid(sectPr, 'cols')),
    continuous: attr(kid(sectPr, 'type'), 'val') === 'continuous',
    // A section without its own header references keeps the previous section's.
    headers: { ...previous?.headers, ...(sectPr === null ? {} : refs(sectPr, 'headerReference')) },
    footers: { ...previous?.footers, ...(sectPr === null ? {} : refs(sectPr, 'footerReference')) },
  };
}

/** Every section of the body, in order: one per paragraph `w:sectPr`, then the body's own. */
export function scanSections(body: Element): Section[] {
  const sectPrs: Array<Element | null> = [];
  // Walks the same wrappers, to the same depth, as renderBlocks: a section it
  // finds must be one that renders.
  const walk = (el: Element | null, depth: number): void => {
    if (el === null || depth > MAX_DEPTH) {
      return;
    }
    for (const child of kids(el)) {
      const sectPr = child.localName === 'p' ? kid(kid(child, 'pPr'), 'sectPr') : null;
      if (sectPr !== null) {
        sectPrs.push(sectPr);
      } else if (child.localName === 'sdt') {
        walk(kid(child, 'sdtContent'), depth + 1);
      } else if (child.localName === 'AlternateContent') {
        walk(alternateBranch(child), depth + 1);
      } else if (['customXml', 'ins', 'moveTo'].includes(child.localName)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(body, 0);
  sectPrs.push(kid(body, 'sectPr'));

  const sections: Section[] = [];
  for (const sectPr of sectPrs) {
    sections.push(parseSection(sectPr, sections[sections.length - 1] ?? null));
  }

  return sections;
}

export interface PagesOptions {
  wrapper: HTMLElement;
  sections: Section[];
  /** Header and footer parts by zip path. */
  headerParts: Map<string, NotesPart>;
  /** `w:evenAndOddHeaders` from the settings. */
  evenAndOdd: boolean;
  notes: Notes;
  ctx: RenderContext;
  /** The document's `w:background` colour, or null. */
  background: string | null;
}

interface OpenPage {
  section: HTMLElement;
  article: HTMLElement;
  footer: HTMLElement | null;
  empty: boolean;
}

/** The page flow of the main body: pages, their headers, footers and footnotes. */
export class Pages implements BlockSink {
  private sectionIndex = 0;
  private pageInSection = 0;
  private pageCount = 0;
  private readonly templates = new Map<string, DocumentFragment>();
  private readonly slots: Array<{ el: HTMLElement; path: string }> = [];
  private page: OpenPage | null = null;

  private readonly wrapper: HTMLElement;
  private readonly sections: Section[];
  private readonly headerParts: Map<string, NotesPart>;
  private readonly evenAndOdd: boolean;
  private readonly notes: Notes;
  private readonly ctx: RenderContext;
  private readonly background: string | null;

  constructor(options: PagesOptions) {
    ({
      wrapper: this.wrapper,
      sections: this.sections,
      headerParts: this.headerParts,
      evenAndOdd: this.evenAndOdd,
      notes: this.notes,
      ctx: this.ctx,
      background: this.background,
    } = options);
  }

  add(node: Node): void {
    const page = this.open();
    page.article.appendChild(node);
    page.empty = false;
  }

  pageBreak(): void {
    if (this.page !== null && !this.page.empty) {
      this.close();
    }
  }

  endSection(): void {
    const next = this.sections[this.sectionIndex + 1];
    if (next === undefined) {
      return;
    }
    const current = this.sections[this.sectionIndex];
    this.sectionIndex += 1;
    if (!next.continuous) {
      this.close();
      this.pageInSection = 0;
    } else if (this.page !== null && !sameColumns(current.columns, next.columns)) {
      // Same page, new column layout: the rest of the body flows in a new article.
      this.page.article = this.article(next);
      this.page.section.appendChild(this.page.article);
    }
  }

  /** Close the last page; a document with no content still shows one blank page. */
  finish(): void {
    const page = this.open();
    const endnotes = this.notes.flush('endnote', this.ctx);
    if (endnotes !== null) {
      page.article.appendChild(endnotes);
    }
    this.close();
  }

  private headerKind(section: Section): HeaderKind {
    if (this.pageInSection === 0 && section.titlePage) {
      return 'first';
    }

    return this.evenAndOdd && (this.pageCount + 1) % 2 === 0 ? 'even' : 'default';
  }

  private headerFor(kind: 'headers' | 'footers', section: Section): HTMLElement | null {
    const type = this.headerKind(section);
    const relId = section[kind][type];
    const ctx = this.ctx;
    const path = relId === undefined ? undefined : ctx.rels.find((rel) => rel.id === relId && !rel.external)?.target;
    const part = path === undefined ? undefined : this.headerParts.get(path);
    if (part === undefined) {
      return null;
    }
    if (!this.templates.has(part.path)) {
      const template = document.createDocumentFragment();
      template.append(...ctx.blocks(part.doc.documentElement, inPart(ctx, part)));
      this.templates.set(part.path, template);
    }
    const el = document.createElement(kind === 'headers' ? 'header' : 'footer');
    this.slots.push({ el, path: part.path });

    return el;
  }

  /**
   * Fill every page's header and footer with a copy of its part. Each part
   * renders once, so a short file cannot multiply a long header over thousands
   * of pages. Call it after the pictures load, or the copies would miss them.
   */
  fillHeaders(): void {
    const sizes = new Map<string, { elements: number; text: number }>();
    const spent = { elements: 0, text: 0 };
    for (const slot of this.slots.splice(0)) {
      const template = this.templates.get(slot.path);
      if (template === undefined) {
        continue;
      }
      const size = sizes.get(slot.path) ?? { elements: template.querySelectorAll('*').length, text: template.textContent?.length ?? 0 };
      sizes.set(slot.path, size);
      spent.elements += size.elements;
      spent.text += size.text;
      if (spent.elements > HEADER_COPY_BUDGET || spent.text > HEADER_TEXT_BUDGET) {
        return;
      }
      slot.el.appendChild(template.cloneNode(true));
    }
  }

  private article(section: Section): HTMLElement {
    const article = document.createElement('article');
    if (section.columns !== null) {
      article.style.columnCount = String(section.columns.count);
      article.style.columnGap = pt(section.columns.gap);
    }

    return article;
  }

  private open(): OpenPage {
    if (this.page !== null) {
      return this.page;
    }
    const section = this.sections[this.sectionIndex] ?? parseSection(null, null);
    const { margins } = section;
    const el = document.createElement('section');
    el.className = 'blok-docx';
    el.style.width = pt(section.width);
    const header = this.headerFor('headers', section);
    const footer = this.headerFor('footers', section);
    el.style.paddingTop = pt(header === null ? margins.top : Math.min(margins.header, margins.top));
    el.style.paddingInlineEnd = pt(margins.right);
    el.style.paddingBottom = pt(footer === null ? margins.bottom : Math.min(margins.footer, margins.bottom));
    el.style.paddingInlineStart = pt(margins.left);
    if (header !== null) {
      // The body starts at the top margin; the header sits in the space above it.
      header.style.marginBottom = pt(Math.max(0, margins.top - margins.header));
      el.appendChild(header);
    }
    if (footer !== null) {
      footer.style.marginTop = pt(Math.max(0, margins.bottom - margins.footer));
    }
    if (this.background !== null) {
      el.style.backgroundColor = this.background;
    }
    const article = this.article(section);
    el.appendChild(article);
    this.wrapper.appendChild(el);
    this.page = { section: el, article, footer, empty: true };

    return this.page;
  }

  private close(): void {
    const page = this.page;
    if (page === null) {
      return;
    }
    const footnotes = this.notes.flush('footnote', this.ctx);
    if (footnotes !== null) {
      page.article.appendChild(footnotes);
    }
    if (page.footer !== null) {
      page.section.appendChild(page.footer);
    }
    this.page = null;
    this.pageCount += 1;
    this.pageInSection += 1;
  }
}
