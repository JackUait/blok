import type { NotesApi, RenderContext } from './context';
import type { Relationship } from './package';
import { inPart } from './context';
import { attr, kids } from './xml';

export interface NotesPart {
  path: string;
  doc: Document;
  rels: Relationship[];
}

interface Pending {
  number: number;
  el: Element;
}

/** Note bodies by id, without the separator notes Word keeps at ids -1 and 0. */
function notesById(part: NotesPart | null, tag: string): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const el of part === null ? [] : kids(part.doc.documentElement, tag)) {
    const type = attr(el, 'type');
    const id = attr(el, 'id');
    if (id !== null && (type === null || type === 'normal')) {
      map.set(id, el);
    }
  }

  return map;
}

/**
 * Footnotes and endnotes. Each kind is numbered through the whole document, as
 * Word does by default. Footnotes list at the end of the page that references
 * them; endnotes at the end of the document.
 */
export class Notes implements NotesApi {
  private readonly bodies: Record<'footnote' | 'endnote', Map<string, Element>>;
  private readonly counts = { footnote: 0, endnote: 0 };
  private readonly numbers: Record<'footnote' | 'endnote', Map<string, number>> = { footnote: new Map(), endnote: new Map() };
  private readonly pending: Record<'footnote' | 'endnote', Pending[]> = { footnote: [], endnote: [] };
  private rendering: string | null = null;

  constructor(private readonly parts: Record<'footnote' | 'endnote', NotesPart | null>) {
    this.bodies = { footnote: notesById(parts.footnote, 'footnote'), endnote: notesById(parts.endnote, 'endnote') };
  }

  reference(kind: 'footnote' | 'endnote', id: string, raised: boolean): HTMLElement | null {
    const el = this.bodies[kind].get(id);
    // A reference inside a note body would queue notes while they are being listed.
    if (el === undefined || this.rendering !== null) {
      return null;
    }
    // A note referenced again keeps its number and is listed once.
    const known = this.numbers[kind].get(id);
    const number = known ?? this.counts[kind] + 1;
    if (known === undefined) {
      this.counts[kind] = number;
      this.numbers[kind].set(id, number);
      this.pending[kind].push({ number, el });
    }
    const mark = document.createElement(raised ? 'span' : 'sup');
    mark.className = 'blok-docx-noteref';
    mark.textContent = String(number);

    return mark;
  }

  current(): string | null {
    return this.rendering;
  }

  /** The list of queued notes of one kind, or null when none are queued. */
  flush(kind: 'footnote' | 'endnote', ctx: RenderContext): HTMLElement | null {
    const part = this.parts[kind];
    const queued = this.pending[kind].splice(0);
    if (part === null || queued.length === 0) {
      return null;
    }
    const list = document.createElement('ol');
    list.className = `blok-docx-${kind}s`;
    for (const note of queued) {
      const item = document.createElement('li');
      item.value = note.number;
      this.rendering = String(note.number);
      item.append(...ctx.blocks(note.el, inPart(ctx, part)));
      this.rendering = null;
      list.appendChild(item);
    }

    return list;
  }
}
