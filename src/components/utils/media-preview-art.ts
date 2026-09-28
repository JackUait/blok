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

export const previewSvg = (kind: MediaPreviewKind): string =>
  `<svg viewBox="0 0 200 120" width="200" height="120" fill="none" focusable="false">${drawings[kind](`blok-media-preview-${uid()}`)}</svg>`;
