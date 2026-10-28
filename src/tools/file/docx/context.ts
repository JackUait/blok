import type { DocxPackage, Relationship } from './package';
import type { Css, ParaProps } from './props';
import type { StyleSheet } from './styles';

/** A list marker for one numbered paragraph. */
export interface ListMarker {
  /** The marker text, e.g. `1.`, `(a)`, `•`. */
  text: string;
  /** The level's paragraph properties (indents), below the paragraph's own. */
  para: ParaProps;
  /** The level's run properties, for the marker only. */
  run: Css;
  /** What separates the marker from the text. */
  suffix: 'tab' | 'space' | 'nothing';
}

/** List numbering. `marker` advances the counters, so call it once per paragraph, in order. */
export interface NumberingApi {
  marker(numId: string, ilvl: number): ListMarker | null;
}

/** Footnote and endnote numbering, plus the notes each page shows. */
export interface NotesApi {
  /**
   * Render a reference mark and remember the note for the current page.
   * `raised`: the run is already superscript, so the mark must not raise itself again.
   */
  reference(kind: 'footnote' | 'endnote', id: string, raised: boolean): HTMLElement | null;
  /** The number of the note whose body is being rendered (for `w:footnoteRef`). */
  current(): string | null;
}

/** Async work and blob URLs one render owns. */
export interface Resources {
  tasks: Array<Promise<unknown>>;
  urls: string[];
  /** Image part path → its blob URL (null when not a raster image), shared by every use. */
  images: Map<string, Promise<string | null>>;
}

export interface RenderContext {
  pkg: DocxPackage;
  /** Zip path of the part being rendered; relationship ids resolve against it. */
  part: string;
  /** Relationships of `part`. */
  rels: Relationship[];
  styles: StyleSheet;
  numbering: NumberingApi;
  notes: NotesApi;
  resources: Resources;
  /** Table-style layer under the paragraph style, for content inside a table. */
  layer: { para: ParaProps; run: Css };
  /** Nesting depth. Past MAX_DEPTH content is dropped. */
  depth: number;
  /** True only for the main body, where page breaks start new pages. */
  pageable: boolean;
  /** Open complex fields; text is hidden while any is still in its instruction. */
  fields: FieldState;
  /** Bookmark name → the element an internal link scrolls to. */
  bookmarks: Map<string, Element>;
  /** Render block-level children (paragraphs, tables…) of `parent` into nodes. */
  blocks(parent: Element, ctx: RenderContext): Node[];
}

/** Deepest nesting of containers and wrappers (tables, text boxes, sdt, ins, links…). */
/**
 * The stack of open complex fields (`w:fldChar` begin / separate / end). Fields
 * nest, and a field's text shows only once it and every field around it have
 * left their instruction part. O(1) per step: a file may open millions of fields.
 */
export class FieldState {
  private readonly open: boolean[] = [];
  private inInstruction = 0;

  begin(): void {
    this.open.push(true);
    this.inInstruction += 1;
  }

  separate(): void {
    const last = this.open.length - 1;
    if (last >= 0 && this.open[last]) {
      this.open[last] = false;
      this.inInstruction -= 1;
    }
  }

  end(): void {
    if (this.open.pop() === true) {
      this.inInstruction -= 1;
    }
  }

  get hidden(): boolean {
    return this.inInstruction > 0;
  }
}

export const MAX_DEPTH = 24;

/** The same context, one level deeper. Wrappers count too: thousands of nested `w:ins` would overflow the stack. */
export function deeper(ctx: RenderContext): RenderContext {
  return { ...ctx, depth: ctx.depth + 1 };
}

/** A copy of `ctx` for nested, non-pageable content (cells, text boxes, notes, headers). */
export function nested(ctx: RenderContext, extra: Partial<RenderContext> = {}): RenderContext {
  return { ...ctx, depth: ctx.depth + 1, pageable: false, ...extra };
}

/** A copy of `ctx` for another part of the package (a header, footer or note body). */
export function inPart(ctx: RenderContext, part: { path: string; rels: Relationship[] }): RenderContext {
  return nested(ctx, { part: part.path, rels: part.rels, fields: new FieldState() });
}
