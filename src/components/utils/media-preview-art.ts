/**
 * The media preview drawings. An illustration, not a Blok Line icon (200x120,
 * tone fills, per-instance clip ids, animation hooks), so it lives here and
 * not in the icons registry. media-empty.css animates the
 * `blok-media-preview__*` part classes; `__layer` groups carry a `--d` depth
 * that media-preview-3d.ts turns into distance from the viewer.
 */
import type { MediaPreviewKind } from './media-empty-preview';

const WAVE = [14, 22, 30, 18, 34, 26, 16, 28, 20, 32, 24, 14, 22, 18];

const layer = (depth: number, body: string): string =>
  `<g class="blok-media-preview__layer" style="--d:${depth}">${body}</g>`;

// A blurred copy of the shape's alpha, painted with --blok-media-preview-shadow
// (set on the feFlood in CSS so themes can change it).
const shadowFilter = (id: string, blur: number): string =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="-40" y="-40" width="280" height="200"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="blur"/><feFlood class="blok-media-preview__shade"/><feComposite in2="blur" operator="in"/></filter>`;

const shadowFilters = (id: string): string =>
  shadowFilter(`${id}-c`, 1.8) + shadowFilter(`${id}-a`, 9) + shadowFilter(`${id}-d`, 1.6);

// The floor shadow copies the body's live outline (`#id-s`), so it tilts with
// the 3D drawing. The blur sits on the wrapper: it must soften the flattened
// copy, not be flattened with it.
const ground = (id: string): string => `
  <g class="blok-media-preview__ground">
    <g class="blok-media-preview__ambient" filter="url(#${id}-a)"><use class="blok-media-preview__cast blok-media-preview__cast--ambient" href="#${id}-s"/></g>
    <g class="blok-media-preview__contact" filter="url(#${id}-c)"><use class="blok-media-preview__cast blok-media-preview__cast--contact" href="#${id}-s"/></g>
  </g>`;

// The floating part (`#id-f`) casts onto the layer this is placed in.
const drop = (id: string): string =>
  `<use class="blok-media-preview__drop" href="#${id}-f" filter="url(#${id}-d)"/>`;

const waveBars = (): string => WAVE
  .map((h, i) => {
    const x = 92 + i * 6;
    return `<rect class="blok-media-preview__bar" style="--i:${i}" x="${x}" y="${76 - h / 2}" width="3" height="${h}" rx="1.5"/>`;
  })
  .join('');

// The document page: its top-right corner is cut along a 45-degree diagonal,
// and the dog-ear (FLAP) is that corner folded down onto the page.
const PAGE = 'M78 10h28l26 26v58a8 8 0 0 1-8 8H78a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z';
const FLAP = 'M106 10v22a4 4 0 0 0 4 4h22z';

// Separate shapes, not one multi-part path: media-preview-3d.ts samples each
// shape as a single outline.
const sheetCells = (): string => [32, 42, 52, 62, 72]
  .flatMap((y) => [77, 103].map((x) => `<rect class="blok-media-preview__cell" x="${x}" y="${y}" width="22" height="7" rx="1.5"/>`))
  .join('');

const chartBars = (): string => [14, 24, 18, 30]
  .map((h, i) => `<rect class="blok-media-preview__chart-bar" x="${80 + i * 11}" y="${92 - h}" width="7" height="${h}" rx="1.5"/>`)
  .join('');

// --row orders the lines for the upload write-in in media-empty.css.
const docLines = (): string => [
  { y: 44, width: 30, height: 5, title: true },
  { y: 55, width: 44, height: 3.5, title: false },
  { y: 63, width: 44, height: 3.5, title: false },
  { y: 71, width: 30, height: 3.5, title: false },
]
  .map((line, row) => `<rect class="blok-media-preview__line blok-media-preview__line--write${line.title ? ' blok-media-preview__line--title' : ''}" style="--row:${row}" x="78" y="${line.y}" width="${line.width}" height="${line.height}" rx="${line.height / 2}"/>`)
  .join('');

// Clip, filter and shadow ids must be unique per instance: several empty
// blocks share one document.
const drawings: Record<MediaPreviewKind, (id: string) => string> = {
  video: (id) => `
    <defs><clipPath id="${id}"><rect x="32" y="16" width="136" height="62" rx="7"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      <rect id="${id}-s" class="blok-media-preview__frame" x="24" y="8" width="152" height="94" rx="12"/>
      <rect class="blok-media-preview__screen" x="32" y="16" width="136" height="62" rx="7"/>
      <g clip-path="url(#${id})">
        <g class="blok-media-preview__scene">
          <circle class="blok-media-preview__sun" cx="140" cy="32" r="7"/>
          <path class="blok-media-preview__hill blok-media-preview__hill--far" d="M20 80l34-30 26 20 22-16 40 26 30-22 44 30z"/>
          <path class="blok-media-preview__hill" d="M20 80l26-14 30 14 34-20 40 20 36-16 30 16z"/>
        </g>
      </g>
      <rect class="blok-media-preview__track" x="32" y="87" width="136" height="4" rx="2"/>
      <rect class="blok-media-preview__progress" x="32" y="87" width="136" height="4" rx="2"/>
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f" class="blok-media-preview__knob-group">
        <circle class="blok-media-preview__knob" cx="100" cy="47" r="14"/>
        <path class="blok-media-preview__glyph" d="M95.5 40.5v13l11-6.5z"/>
      </g>`)}`,
  audio: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      <rect id="${id}-s" class="blok-media-preview__frame" x="14" y="20" width="172" height="80" rx="16"/>
      <rect class="blok-media-preview__line" x="92" y="36" width="62" height="5" rx="2.5"/>
      <rect class="blok-media-preview__line blok-media-preview__line--soft" x="92" y="46" width="38" height="4" rx="2"/>
      ${waveBars()}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f" class="blok-media-preview__disc">
        <rect class="blok-media-preview__screen" x="24" y="30" width="58" height="60" rx="9"/>
        <circle class="blok-media-preview__groove" cx="53" cy="60" r="19"/>
        <circle class="blok-media-preview__glyph" cx="53" cy="60" r="4"/>
      </g>`)}`,
  image: (id) => `
    <defs><clipPath id="${id}"><rect x="42" y="14" width="120" height="70" rx="3"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(1, `<rect id="${id}-s" class="blok-media-preview__frame blok-media-preview__photo-back" x="38" y="8" width="128" height="96" rx="6"/>${drop(id)}`)}
    ${layer(4, `
      <g class="blok-media-preview__photo">
        <rect id="${id}-f" class="blok-media-preview__frame" x="34" y="6" width="136" height="100" rx="6"/>
        <rect class="blok-media-preview__screen" x="42" y="14" width="120" height="70" rx="3"/>
        <g clip-path="url(#${id})">
          <g class="blok-media-preview__scene">
            <circle class="blok-media-preview__sun" cx="136" cy="32" r="8"/>
            <path class="blok-media-preview__hill blok-media-preview__hill--far" d="M42 84l30-30 24 20 18-12 48 22z"/>
            <path class="blok-media-preview__hill" d="M42 84l22-14 26 14z"/>
          </g>
        </g>
        <rect class="blok-media-preview__line blok-media-preview__line--soft" x="42" y="92" width="46" height="4" rx="2"/>
      </g>`)}`,
  file: (id) => `
    <defs><clipPath id="${id}"><path d="${PAGE}"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(1, `
      <g class="blok-media-preview__sheet blok-media-preview__sheet--back">
        <rect class="blok-media-preview__frame" x="70" y="10" width="62" height="92" rx="8"/>
        <rect class="blok-media-preview__cell blok-media-preview__cell--head" x="77" y="20" width="48" height="8" rx="2"/>
        ${sheetCells()}
      </g>`)}
    ${layer(2, `
      <g class="blok-media-preview__sheet blok-media-preview__sheet--mid">
        <rect class="blok-media-preview__frame" x="70" y="10" width="62" height="92" rx="8"/>
        <rect class="blok-media-preview__line" x="78" y="20" width="30" height="4" rx="2"/>
        ${chartBars()}
      </g>
      ${drop(id)}`)}
    ${layer(5, `
      <g id="${id}-f" class="blok-media-preview__sheet blok-media-preview__sheet--front">
        <path id="${id}-s" class="blok-media-preview__frame" d="${PAGE}"/>
        <g clip-path="url(#${id})"><rect class="blok-media-preview__fill" x="70" y="10" width="62" height="92"/></g>
        <path class="blok-media-preview__crease" filter="url(#${id}-d)" d="${FLAP}"/>
        <path class="blok-media-preview__flap" d="${FLAP}"/>
        ${docLines()}
        <rect class="blok-media-preview__chip" x="78" y="82" width="22" height="11" rx="3"/>
        <rect class="blok-media-preview__chip-mark" x="82" y="86" width="14" height="3" rx="1.5"/>
      </g>`)}`,
};

export const WAVE_BARS = WAVE.length;

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

// Popover "Nothing found": a menu whose result is a dashed empty slot, a
// second menu fanned behind it, and a loupe floating over the slot.
const searchRow = (y: number, width: number, soft: boolean): string =>
  `<rect class="blok-media-preview__cell" x="58" y="${y}" width="12" height="12" rx="3.5"/>`
  + `<rect class="blok-media-preview__line${soft ? ' blok-media-preview__line--soft' : ''}" x="78" y="${y + 4}" width="${width}" height="4" rx="2"/>`;

const search = (id: string): string => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(1, `<rect class="blok-media-preview__frame blok-media-preview__sheet blok-media-preview__sheet--back" x="48" y="14" width="104" height="88" rx="12"/>`)}
    ${layer(3, `
      <rect id="${id}-s" class="blok-media-preview__frame" x="48" y="14" width="104" height="88" rx="12"/>
      <rect class="blok-media-preview__field" x="56" y="22" width="88" height="14" rx="5"/>
      <rect class="blok-media-preview__line blok-media-preview__line--soft" x="62" y="27.5" width="26" height="3" rx="1.5"/>
      ${searchRow(45, 50, false)}
      <rect class="blok-media-preview__slot" x="56" y="62.5" width="88" height="15" rx="5"/>
      ${searchRow(84, 34, true)}
      ${drop(id)}`)}
    ${layer(8, `
      <g id="${id}-f" class="blok-media-preview__loupe">
        <path class="blok-media-preview__frame" d="M139.2 82.6l11.3 11.3a4 4 0 0 1-5.6 5.6l-11.3-11.3z"/>
        <circle class="blok-media-preview__frame" cx="126" cy="70" r="17"/>
        <circle class="blok-media-preview__lens" cx="126" cy="70" r="12"/>
        <path class="blok-media-preview__glint" d="M118 66a9 9 0 0 1 5.5-5.5"/>
      </g>`)}`;

// Whitespace between tags is stripped: it would become text and leak into the
// popover message's textContent, next to the "Nothing found" label.
export const searchPreviewSvg = (): string =>
  `<svg viewBox="0 0 200 120" width="200" height="120" fill="none" aria-hidden="true" focusable="false">${search(`blok-media-preview-${uid()}`)}</svg>`
    .replace(/>\s+</g, '><')
    .trim();

export const previewSvg = (kind: MediaPreviewKind): string =>
  `<svg viewBox="0 0 200 120" width="200" height="120" fill="none" focusable="false">${drawings[kind](`blok-media-preview-${uid()}`)}</svg>`;

// ---- Embed window scenes: what a typed link will become ----

export const EMBED_SCENE_KINDS = [
  'idle', 'generic', 'video', 'audio', 'image', 'social', 'document',
  'table', 'form', 'code', 'design', 'chart', 'map', 'calendar',
] as const;

export type EmbedSceneKind = (typeof EMBED_SCENE_KINDS)[number];

const cls = (names: string): string => names.split(' ').map((name) => `blok-media-preview__${name}`).join(' ');
const rect = (names: string, x: number, y: number, w: number, h: number, rx: number, extra = ''): string =>
  `<rect class="${cls(names)}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${extra}/>`;
const circle = (names: string, cx: number, cy: number, r: number): string =>
  `<circle class="${cls(names)}" cx="${cx}" cy="${cy}" r="${r}"/>`;
const path = (names: string, d: string, extra = ''): string => `<path class="${cls(names)}" d="${d}"${extra}/>`;
const body = (id: string): string => ` id="${id}-s"`;
const winDots = (x: number, y: number): string => [0, 1, 2].map((i) => circle('cell', x + i * 7, y, 2.2)).join('');

type EmbedScene = Exclude<EmbedSceneKind, 'video' | 'audio' | 'image'>;

const embedScenes: Record<EmbedScene, (id: string) => string> = {
  idle: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame dashed', 30, 12, 140, 88, 12, body(id))}
      ${winDots(43, 24)}
      ${rect('field', 70, 19, 86, 10, 5)}
      ${rect('line line--title', 44, 42, 62, 5, 2.5)}
      ${rect('line', 44, 54, 96, 3.5, 1.75)}
      ${rect('line', 44, 62, 80, 3.5, 1.75)}
      ${rect('line line--soft', 44, 70, 52, 3.5, 1.75)}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f" class="blok-media-preview__chip-float">
        ${rect('frame', 96, 72, 68, 24, 12)}
        ${rect('link', 105, 80, 11, 8, 4)}
        ${rect('link', 112, 80, 11, 8, 4)}
        ${rect('line', 130, 82, 24, 4, 2)}
      </g>`)}`,
  generic: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 26, 10, 148, 92, 12, body(id))}
      ${winDots(39, 22)}
      ${rect('field', 66, 17, 94, 10, 5)}
      ${rect('screen', 38, 36, 56, 52, 6)}
      ${rect('line line--title', 104, 40, 52, 5, 2.5)}
      ${rect('line', 104, 52, 58, 3.5, 1.75)}
      ${rect('line', 104, 60, 48, 3.5, 1.75)}
      ${rect('line line--soft', 104, 68, 34, 3.5, 1.75)}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${circle('frame', 156, 86, 15)}
        <ellipse class="blok-media-preview__groove" cx="156" cy="86" rx="6.5" ry="15"/>
        ${path('groove', 'M141 86h30')}
      </g>`)}`,
  social: (id) => `
    <defs><clipPath id="${id}"><rect x="52" y="58" width="96" height="36" rx="6"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 40, 6, 120, 98, 12, body(id))}
      ${circle('screen', 61, 24, 8)}
      ${rect('line line--title', 75, 19, 40, 4.5, 2.25)}
      ${rect('line line--soft', 75, 27, 26, 3, 1.5)}
      ${rect('line', 52, 40, 92, 3.5, 1.75)}
      ${rect('line', 52, 48, 70, 3.5, 1.75)}
      ${rect('screen', 52, 58, 96, 36, 6)}
      <g clip-path="url(#${id})"><g class="blok-media-preview__scene">
        ${circle('sun', 128, 68, 5)}
        ${path('hill hill--far', 'M52 94l24-20 20 12 18-10 34 18z')}
      </g></g>
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${circle('frame', 158, 92, 13)}
        ${path('heart', 'M158 98.5c-6-4-9-7-9-11a4.5 4.5 0 0 1 9-2a4.5 4.5 0 0 1 9 2c0 4-3 7-9 11z')}
      </g>`)}`,
  document: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(1, `
      <g class="blok-media-preview__sheet blok-media-preview__sheet--back">
        ${rect('frame', 70, 10, 62, 92, 8)}
        ${rect('line', 78, 22, 30, 4, 2)}
        ${rect('line line--soft', 78, 32, 44, 3, 1.5)}
        ${rect('line line--soft', 78, 40, 40, 3, 1.5)}
      </g>
      ${drop(id)}`)}
    ${layer(5, `
      <g id="${id}-f" class="blok-media-preview__sheet">
        ${path('frame', PAGE, body(id))}
        ${path('crease', FLAP, ` filter="url(#${id}-d)"`)}
        ${path('flap', FLAP)}
        ${rect('line line--title', 78, 44, 30, 5, 2.5)}
        ${rect('line', 78, 55, 44, 3.5, 1.75)}
        ${rect('line', 78, 63, 44, 3.5, 1.75)}
        ${rect('line', 78, 71, 36, 3.5, 1.75)}
        ${rect('line line--soft', 78, 79, 26, 3.5, 1.75)}
      </g>`)}`,
  table: (id) => {
    const head = [0, 1, 2, 3].map((col) => rect('cell cell--head', 36 + col * 33, 21, 29, 9, 2.5)).join('');
    const rows = [35, 47, 59, 71, 83].flatMap((y) => [0, 1, 2, 3].map((col) => rect('cell', 36 + col * 33, y, 29, 8, 2))).join('');

    return `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `${rect('frame', 26, 12, 148, 90, 10, body(id))}${head}${rows}${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${rect('frame select', 98, 44, 37, 17, 4)}
        ${rect('line', 104, 51, 18, 3.5, 1.75)}
        ${circle('glyph', 135, 61, 2.6)}
      </g>`)}`;
  },
  form: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 42, 6, 116, 98, 12, body(id))}
      ${rect('line line--title', 54, 18, 48, 5, 2.5)}
      ${rect('line line--soft', 54, 31, 26, 3, 1.5)}
      ${rect('screen', 54, 37, 92, 13, 4.5)}
      ${rect('line line--soft', 54, 57, 34, 3, 1.5)}
      ${rect('screen', 54, 63, 92, 13, 4.5)}
      ${rect('button', 54, 84, 42, 12, 4.5)}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${rect('frame', 128, 76, 30, 30, 9)}
        ${path('tick', 'M135.5 91.5l5 5 10-11')}
      </g>`)}`,
  code: (id) => {
    const rows: Array<[number, number, boolean]> = [[0, 46, false], [12, 52, true], [12, 38, false], [24, 30, true], [12, 44, false], [0, 22, false]];
    const lines = rows
      .map(([indent, width, strong], i) => rect('cell', 38, 37 + i * 10, 5, 3, 1.5)
        + rect(strong ? 'line line--title' : 'line', 50 + indent, 37 + i * 10, width, 3.5, 1.75))
      .join('');

    return `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 26, 10, 148, 92, 10, body(id))}
      ${winDots(39, 22)}
      ${rect('field', 64, 17, 36, 10, 4)}
      ${lines}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${rect('frame', 124, 74, 46, 26, 9)}
        ${path('tick', 'M139 81l-6 6 6 6')}
        ${path('tick', 'M155 81l6 6-6 6')}
        ${path('tick', 'M149.5 80l-5 14')}
      </g>`)}`;
  },
  design: (id) => `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 26, 10, 148, 92, 10, body(id))}
      ${rect('cell', 34, 18, 10, 76, 4)}
      ${rect('screen', 62, 30, 42, 42, 8)}
      ${circle('blob', 116, 62, 21)}
      ${rect('dashed', 57, 25, 52, 52, 3)}
      ${rect('frame', 55, 23, 4, 4, 1)}${rect('frame', 107, 23, 4, 4, 1)}${rect('frame', 55, 75, 4, 4, 1)}${rect('frame', 107, 75, 4, 4, 1)}
      ${drop(id)}`)}
    ${layer(8, `
      <g id="${id}-f">
        ${path('pointer', 'M138 70v22l6-5.5 4.5 9.5 4-1.8-4.5-9.5h8z')}
        ${rect('tag', 152, 92, 26, 11, 5.5)}
      </g>`)}`,
  chart: (id) => {
    const bars = [22, 36, 28, 48, 40, 58].map((h, i) => rect('chart-bar', 40 + i * 19, 92 - h, 11, h, 2.5)).join('');

    return `
    <defs>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 26, 10, 148, 92, 10, body(id))}
      ${rect('line line--title', 38, 20, 40, 5, 2.5)}
      ${bars}
      ${path('trend', 'M45.5 64L64.5 50L83.5 58L102.5 38L121.5 46L140.5 28')}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${rect('frame', 120, 54, 46, 24, 7)}
        ${rect('line line--title', 127, 61, 24, 4, 2)}
        ${rect('line line--soft', 127, 69, 32, 3, 1.5)}
      </g>`)}`;
  },
  map: (id) => `
    <defs><clipPath id="${id}"><rect x="32" y="16" width="136" height="80" rx="6"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 24, 8, 152, 96, 12, body(id))}
      ${rect('screen', 32, 16, 136, 80, 6)}
      <g clip-path="url(#${id})">
        ${path('park', 'M120 16h48v34c-14 6-30 2-40-8s-12-18-8-26z')}
        ${path('road', 'M28 76C64 66 104 86 172 54')}
        ${path('road road--minor', 'M88 12L112 100')}
        ${path('road road--minor', 'M28 34C60 40 80 30 100 36')}
      </g>
      ${drop(id)}`)}
    ${layer(9, `
      <g id="${id}-f">
        ${path('pin', 'M117 34a13 13 0 0 1 13 13c0 10-13 22-13 22s-13-12-13-22a13 13 0 0 1 13-13z')}
        ${circle('frame', 117, 47, 4.5)}
      </g>`)}`,
  calendar: (id) => {
    const days = Array.from({ length: 21 }, (_, i) =>
      rect(i === 9 ? 'glyph' : 'cell', 52 + (i % 7) * 14, 44 + Math.floor(i / 7) * 13, 10, 8, 2)).join('');

    return `
    <defs><clipPath id="${id}"><rect x="40" y="14" width="120" height="88" rx="12"/></clipPath>${shadowFilters(id)}</defs>
    ${ground(id)}
    ${layer(3, `
      ${rect('frame', 40, 14, 120, 88, 12, body(id))}
      <g clip-path="url(#${id})">${rect('band', 40, 14, 120, 20, 0)}</g>
      ${rect('frame', 68, 8, 6, 13, 3)}${rect('frame', 126, 8, 6, 13, 3)}
      ${days}
      ${drop(id)}`)}
    ${layer(7, `
      <g id="${id}-f">
        ${rect('frame', 110, 80, 62, 22, 7)}
        ${rect('glyph', 115, 85, 3, 12, 1.5)}
        ${rect('line line--title', 123, 86, 34, 4, 2)}
        ${rect('line line--soft', 123, 93, 24, 3, 1.5)}
      </g>`)}`;
  },
};

/** The embed window scene for a kind; video, audio and image reuse the media drawings. */
export const embedPreviewSvg = (kind: EmbedSceneKind): string => {
  if (kind === 'video' || kind === 'audio' || kind === 'image') return previewSvg(kind);

  return `<svg viewBox="0 0 200 120" width="200" height="120" fill="none" focusable="false">${embedScenes[kind](`blok-media-preview-${uid()}`)}</svg>`;
};
