import type { GridCell } from '../sheet-grid';
import { extOf } from '../preview';
import { safePreviewSrc } from '../url';

/** What a card object shows. Every value comes from the file itself. */
export type CardContent =
  | { kind: 'pdf'; page: HTMLElement; pages: number }
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; html: string }
  | { kind: 'document'; page: HTMLElement; pageWidth: number; margins?: { top: number; start: number; end: number } }
  | { kind: 'spreadsheet'; rows: GridCell[][] }
  | { kind: 'presentation'; slide: HTMLElement; width: number; height: number }
  | { kind: 'code'; fileName: string; lang: string; text: string; html: string | null }
  | { kind: 'image'; src: string }
  | { kind: 'video'; frames: HTMLElement[] }
  | { kind: 'audio'; title: string }
  | { kind: 'archive'; title: string }
  | { kind: 'generic'; title: string; bytes: Uint8Array | null };

export interface BuiltObject {
  /** Holds every layer; clipped to the card. */
  stage: HTMLElement;
  top: HTMLElement;
  /** Sheets under the top object, nearest first. */
  unders: HTMLElement[];
  /** Columns a spreadsheet shows. */
  columns?: number;
  /** The small second line on a sleeve or a sticker; filled once the file is read. */
  detail?: HTMLElement;
}

/** Width of a sheet in px. Matches `.blok-file-obj` in file.css. */
const SHEET_WIDTH = 180;
const TABLE_ROWS = 6;
const TABLE_COLUMNS = 4;
const PUNCH_ROWS = 10;
const PUNCH_COLUMNS = 30;

/** Tab badge text per highlighter language. The colour is set in file.css by `data-lang`. */
const LANG_BADGE = new Map<string, string>([
  ['typescript', 'TS'], ['javascript', 'JS'], ['python', 'PY'], ['ruby', 'RB'], ['go', 'GO'], ['rust', 'RS'],
  ['java', 'JV'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['php', 'PHP'], ['swift', 'SW'], ['kotlin', 'KT'],
  ['sql', 'SQL'], ['html', '<>'], ['css', 'CSS'], ['json', '{ }'], ['yaml', 'YML'], ['bash', 'SH'],
  ['graphql', 'GQL'], ['lua', 'LUA'], ['dart', 'DT'], ['r', 'R'], ['scala', 'SC'],
]);

/** Elements a miniature must not carry: they load, run or take input. */
const MD_DROPPED = 'img, picture, video, audio, iframe, object, embed, source, link, style, script, svg, form, input, button';

/** A file name as a title: no extension, dashes and underscores as spaces, first letter up. */
export function titleOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[-_]+/g, ' ').trim();
  if (base === '') {
    return fileName;
  }

  return base[0].toUpperCase() + base.slice(1);
}

function make(tag: string, className: string, role?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (role !== undefined) {
    node.setAttribute('data-role', role);
  }

  return node;
}

function makeObject(shape: string): HTMLElement {
  const obj = make('span', 'blok-file-obj');
  obj.setAttribute('data-shape', shape);

  return obj;
}

/** Sheets under the top object, nearest first. */
function makeUnders(count: number, shape: string): HTMLElement[] {
  return Array.from({ length: count }, (_, index) => {
    const under = make('span', 'blok-file-under');
    under.setAttribute('data-shape', shape);
    under.setAttribute('data-depth', String(index + 1));

    return under;
  });
}

function makeFace(...children: Node[]): HTMLElement {
  const face = make('span', 'blok-file-face');
  face.append(...children);

  return face;
}

/** A top object that is one paper sheet holding `children`. */
function sheet(shape: string, ...children: Node[]): HTMLElement {
  const obj = makeObject(shape);
  obj.appendChild(makeFace(...children));

  return obj;
}

/** Sheet padding around a page zoomed onto its content, in px. */
const PAGE_PAD_X = 12;
const PAGE_PAD_Y = 10;

/**
 * Wraps a full-size page or slide and scales it down to the sheet's width.
 * With `margins`, it zooms past them so the text is larger.
 */
function fitted(
  node: HTMLElement,
  width: number,
  role: string,
  margins: { top: number; start: number; end: number } = { top: 0, start: 0, end: 0 },
): HTMLElement {
  const full = width > 0 ? width : SHEET_WIDTH;
  const content = full - margins.start - margins.end;
  const cropped = content > 0 && content < full;
  const scale = cropped ? (SHEET_WIDTH - PAGE_PAD_X * 2) / content : SHEET_WIDTH / full;
  const frame = make('span', 'blok-file-fit', role);
  frame.style.setProperty('--blok-file-fit', String(scale));
  frame.style.width = `${full}px`;
  if (cropped) {
    frame.style.setProperty('--blok-file-fit-x', `${(PAGE_PAD_X - margins.start * scale).toFixed(2)}px`);
    frame.style.setProperty('--blok-file-fit-y', `${(PAGE_PAD_Y - margins.top * scale).toFixed(2)}px`);
  }
  frame.appendChild(node);

  return frame;
}

function buildPdf(content: Extract<CardContent, { kind: 'pdf' }>): Omit<BuiltObject, 'stage'> {
  const page = make('span', 'blok-file-pdf-page', 'file-object-page');
  page.appendChild(content.page);
  const mark = make('span', 'blok-file-pages', 'file-object-pages');
  mark.textContent = `1 / ${content.pages}`;

  return { top: sheet('sheet', page, mark), unders: makeUnders(2, 'sheet') };
}

function buildText(content: Extract<CardContent, { kind: 'text' }>): Omit<BuiltObject, 'stage'> {
  const pre = make('pre', 'blok-file-lines', 'file-object-text');
  pre.dir = 'auto';
  pre.textContent = content.text;

  return { top: sheet('sheet', pre), unders: [] };
}

function buildMarkdown(content: Extract<CardContent, { kind: 'markdown' }>): Omit<BuiltObject, 'stage'> {
  const md = make('div', 'blok-file-md', 'file-object-markdown');
  md.dir = 'auto';
  // A template parses without loading or running anything, so pictures and scripts are dropped unfetched.
  const template = document.createElement('template');
  template.innerHTML = content.html;
  template.content.querySelectorAll(MD_DROPPED).forEach((node) => node.remove());
  md.appendChild(template.content);

  return { top: sheet('sheet', md), unders: [] };
}

function buildDocument(content: Extract<CardContent, { kind: 'document' }>): Omit<BuiltObject, 'stage'> {
  return {
    top: sheet('sheet', fitted(content.page, content.pageWidth, 'file-object-page', content.margins)),
    unders: makeUnders(1, 'sheet'),
  };
}

function tableCell(text: string, kind: string): HTMLElement {
  const node = document.createElement('span');
  node.setAttribute('data-cell', kind);
  node.textContent = text;

  return node;
}

function buildSpreadsheet(content: Extract<CardContent, { kind: 'spreadsheet' }>): Omit<BuiltObject, 'stage'> {
  const rows = content.rows.slice(0, TABLE_ROWS);
  const table = make('div', 'blok-file-tbl', 'file-object-table');
  table.dir = 'auto';
  rows.forEach((row, rowIndex) => {
    table.appendChild(tableCell(String(rowIndex + 1), 'gutter'));
    Array.from({ length: TABLE_COLUMNS }, (_, column) => {
      const cell = row[column];
      const numeric = cell !== undefined && cell.value !== null;
      const body = numeric ? 'number' : 'text';
      const kind = rowIndex === 0 ? 'head' : body;

      return table.appendChild(tableCell(cell?.text ?? '', kind));
    });
  });
  const columns = Math.max(1, Math.min(TABLE_COLUMNS, Math.max(0, ...rows.map((row) => row.length))));
  const parts: Node[] = [table];
  // The selection sits on the second row, so a one-row sheet has none.
  if (rows.length > 1) {
    parts.push(make('span', 'blok-file-sel', 'file-object-selection'));
  }

  return { top: sheet('sheet', ...parts), unders: makeUnders(2, 'sheet'), columns };
}

function buildPresentation(content: Extract<CardContent, { kind: 'presentation' }>): Omit<BuiltObject, 'stage'> {
  return {
    top: sheet('land', fitted(content.slide, content.width, 'file-object-slide')),
    unders: makeUnders(2, 'land'),
  };
}

function buildCode(content: Extract<CardContent, { kind: 'code' }>): Omit<BuiltObject, 'stage'> {
  const badge = make('span', 'blok-file-badge');
  badge.setAttribute('data-lang', content.lang);
  badge.textContent = LANG_BADGE.get(content.lang) ?? extOf(content.fileName).toUpperCase().slice(0, 3);
  const tab = make('span', 'blok-file-tab', 'file-object-tab');
  tab.append(badge, content.fileName);
  const tabbar = make('span', 'blok-file-tabbar');
  tabbar.appendChild(tab);

  const count = content.text.replace(/\n$/, '').split('\n').length;
  const numbers = make('pre', 'blok-file-nums', 'file-object-line-numbers');
  numbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  const code = make('pre', 'blok-file-code', 'file-object-code');
  // Source reads LTR in any editor direction.
  code.dir = 'ltr';
  if (content.html === null) {
    code.textContent = content.text;
  } else {
    // The highlighter's own output: escaped text in token spans.
    code.innerHTML = content.html;
  }
  const roll = make('span', 'blok-file-roll');
  roll.append(numbers, code);

  return { top: sheet('editor', tabbar, roll), unders: [] };
}

function buildImage(content: Extract<CardContent, { kind: 'image' }>): Omit<BuiltObject, 'stage'> {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.src = safePreviewSrc(content.src) ?? '';
  const pic = make('span', 'blok-file-pic');
  pic.appendChild(img);

  return { top: sheet('print', pic), unders: makeUnders(1, 'print') };
}

function buildVideo(content: Extract<CardContent, { kind: 'video' }>): Omit<BuiltObject, 'stage'> {
  const track = make('span', 'blok-file-track', 'file-object-track');
  track.append(...content.frames);
  const lower = make('span', 'blok-file-sprockets');
  lower.setAttribute('data-edge', 'end');

  return { top: sheet('strip', make('span', 'blok-file-sprockets'), track, lower), unders: [] };
}

function titled(title: string): { title: HTMLElement; detail: HTMLElement } {
  // Spans, not <b>/<em>: the editor rewrites those tags inside a block.
  const titleEl = make('span', 'blok-file-title', 'file-object-title');
  titleEl.dir = 'auto';
  titleEl.textContent = title;
  const detail = make('span', 'blok-file-detail', 'file-object-detail');

  return { title: titleEl, detail };
}

function buildAudio(content: Extract<CardContent, { kind: 'audio' }>): Omit<BuiltObject, 'stage'> {
  const disc = make('span', 'blok-file-disc');
  disc.appendChild(make('span', 'blok-file-disc-label'));
  const { title, detail } = titled(content.title);
  const sleeve = make('span', 'blok-file-sleeve');
  sleeve.append(title, detail);
  const obj = makeObject('vinyl');
  obj.append(disc, sleeve);

  return { top: obj, unders: [], detail };
}

function buildArchive(content: Extract<CardContent, { kind: 'archive' }>): Omit<BuiltObject, 'stage'> {
  const sheets = ['a', 'b', 'c'].map((slot) => {
    const node = make('span', 'blok-file-folder-sheet', 'file-object-folder-sheet');
    node.setAttribute('data-slot', slot);

    return node;
  });
  const { title, detail } = titled(content.title);
  const sticker = make('span', 'blok-file-sticker');
  sticker.append(title, detail);
  const front = make('span', 'blok-file-folder-front');
  front.appendChild(sticker);
  const obj = makeObject('folder');
  obj.append(make('span', 'blok-file-folder-back'), ...sheets, front);

  return { top: obj, unders: [], detail };
}

const hexPair = (a: number, b: number): string =>
  [a, b].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Whether the card is punched at this row and column. */
function isPunched(bytes: Uint8Array | null, row: number, column: number): boolean {
  if (bytes === null || bytes.length < PUNCH_COLUMNS * 2) {
    // No bytes read: a fixed scatter, so the card is never blank.
    return (column * 7 + row * 13 + column * row) % 11 < 2 || (column + row * 3) % 17 === 0;
  }
  // Two bytes per column, ANDed, so about a quarter of the card is punched.
  const bit = row % 8;
  const first = bytes[(column + row) % PUNCH_COLUMNS];
  const second = bytes[PUNCH_COLUMNS + ((column * 3 + row) % PUNCH_COLUMNS)];

  return ((first >> bit) & 1) === 1 && ((second >> bit) & 1) === 1;
}

function buildGeneric(content: Extract<CardContent, { kind: 'generic' }>): Omit<BuiltObject, 'stage'> {
  const { bytes } = content;
  const groups = Array.from({ length: 7 }, (_, index) => (bytes !== null && bytes.length >= 14
    ? hexPair(bytes[index * 2], bytes[index * 2 + 1])
    : String(index).padStart(4, '0')));
  const head = make('span', 'blok-file-punch-head', 'file-object-punch-head');
  head.textContent = `${content.title.toUpperCase()} · ${groups.join(' ')}`;

  const holes = make('span', 'blok-file-holes', 'file-object-holes');
  Array.from({ length: PUNCH_ROWS * PUNCH_COLUMNS }, (_, index) => {
    const row = Math.floor(index / PUNCH_COLUMNS);
    const node = document.createElement('span');
    if (isPunched(bytes, row, index % PUNCH_COLUMNS)) {
      node.setAttribute('data-hole', '');
    } else {
      node.textContent = String(row);
    }

    return holes.appendChild(node);
  });

  return { top: sheet('punch', head, holes), unders: [] };
}

function buildParts(content: CardContent): Omit<BuiltObject, 'stage'> {
  switch (content.kind) {
    case 'pdf': return buildPdf(content);
    case 'text': return buildText(content);
    case 'markdown': return buildMarkdown(content);
    case 'document': return buildDocument(content);
    case 'spreadsheet': return buildSpreadsheet(content);
    case 'presentation': return buildPresentation(content);
    case 'code': return buildCode(content);
    case 'image': return buildImage(content);
    case 'video': return buildVideo(content);
    case 'audio': return buildAudio(content);
    case 'archive': return buildArchive(content);
    case 'generic': return buildGeneric(content);
    default: return content satisfies never;
  }
}

/** Builds the object a file card shows on its far side: a pile of pages, an editor tab, a record. */
export function buildCardObject(content: CardContent): BuiltObject {
  const stage = make('span', 'blok-file-stage', 'file-object');
  stage.setAttribute('data-file-object', content.kind);
  stage.setAttribute('aria-hidden', 'true');
  // Real page markup may hold links; nothing in the miniature takes focus.
  stage.setAttribute('inert', '');
  const parts = buildParts(content);
  // Deepest sheet first, so each one paints over the one below it.
  stage.append(...[...parts.unders].reverse(), parts.top);

  return { stage, ...parts };
}
