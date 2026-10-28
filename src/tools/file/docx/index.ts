import type { RenderContext } from './context';
import type { NotesPart } from './notes';
import { blocksAsNodes, renderBlocks } from './blocks';
import { FieldState } from './context';
import { createNumbering } from './numbering';
import { Notes } from './notes';
import { DocxPackage } from './package';
import { Pages, scanSections } from './pages';
import { StyleSheet, parseThemeFonts } from './styles';
import { attr, hexColor, kid, onOff } from './xml';

/** A side part (styles, notes, headers…) and its relationships, or null when it is missing or unreadable. */
async function optionalPart(pkg: DocxPackage, path: string | null): Promise<NotesPart | null> {
  const doc = path === null ? null : await pkg.optionalXml(path);

  return path === null || doc === null ? null : { path, doc, rels: await pkg.rels(path) };
}

/**
 * Render a .docx into `container` as read-only pages:
 * `.blok-docx-wrapper > section.blok-docx` (one per page) holding an optional
 * `header`, the body `article` and an optional `footer`. Only DOM APIs build
 * the output: no innerHTML, no style sheets, no frames, no ids.
 *
 * Resolves once every picture's bytes are read and its src is set, with a
 * function that frees their blob URLs.
 */
export async function renderDocxInto(buf: ArrayBuffer, container: HTMLElement): Promise<() => void> {
  const pkg = await DocxPackage.open(buf);
  const doc = await pkg.xml(pkg.mainPath);
  const body = kid(doc?.documentElement, 'body');
  if (body === null) {
    throw new Error('docx: the main document has no body');
  }
  const rels = await pkg.rels(pkg.mainPath);
  const pathOf = (type: string): string | null => rels.find((rel) => rel.type === type && !rel.external)?.target ?? null;

  const [theme, styles, numbering, settings, footnotes, endnotes] = await Promise.all(
    ['theme', 'styles', 'numbering', 'settings', 'footnotes', 'endnotes'].map((type) => optionalPart(pkg, pathOf(type))),
  );
  const headerParts = new Map<string, NotesPart>();
  for (const rel of rels.filter((r) => (r.type === 'header' || r.type === 'footer') && !r.external)) {
    const part = await optionalPart(pkg, rel.target);
    if (part !== null) {
      headerParts.set(part.path, part);
    }
  }

  const sheet = new StyleSheet(styles?.doc ?? null, parseThemeFonts(theme?.doc ?? null));
  const notes = new Notes({ footnote: footnotes, endnote: endnotes });
  const resources: RenderContext['resources'] = { tasks: [], urls: [], images: new Map() };
  const ctx: RenderContext = {
    pkg,
    part: pkg.mainPath,
    rels,
    styles: sheet,
    numbering: createNumbering(numbering?.doc ?? null, sheet),
    notes,
    resources,
    layer: { para: { css: {} }, run: {} },
    depth: 0,
    pageable: true,
    fields: new FieldState(),
    bookmarks: new Map(),
    blocks: blocksAsNodes,
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'blok-docx-wrapper';
  const evenAndOdd = onOff(settings?.doc.documentElement, 'evenAndOddHeaders') === true;
  const pages = new Pages({
    wrapper,
    sections: scanSections(body),
    headerParts,
    evenAndOdd,
    notes,
    ctx,
    background: hexColor(attr(kid(doc?.documentElement, 'background'), 'color')),
  });

  const release = (): void => {
    for (const url of resources.urls.splice(0)) {
      URL.revokeObjectURL(url);
    }
  };

  try {
    renderBlocks(body, ctx, pages);
    pages.finish();
    container.appendChild(wrapper);
    await Promise.allSettled(resources.tasks);
    pages.fillHeaders();
  } catch (error) {
    // Pictures already started would leak their blob URLs with no one to free them.
    await Promise.allSettled(resources.tasks);
    release();
    throw error;
  }

  return release;
}
