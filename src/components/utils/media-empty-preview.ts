/**
 * Decorative outlines of the finished media block, drawn in the media empty
 * state's Upload panel. The `blok-media-preview__*` part classes are the hooks
 * media-empty.css animates on hover and drag-over.
 */

export type MediaPreviewKind = 'video' | 'audio' | 'image' | 'file';

const WAVE = [10, 18, 26, 14, 30, 22, 12, 24, 16, 28, 20, 10, 18];

const waveBars = (): string => WAVE
  .map((h, i) => {
    const x = 42 + i * 5.5;
    return `<rect class="blok-media-preview__bar" style="--i:${i}" x="${x}" y="${36 - h / 2}" width="2.5" height="${h}" rx="1.25"/>`;
  })
  .join('');

const DRAWINGS: Record<MediaPreviewKind, string> = {
  video: `
    <rect class="blok-media-preview__frame" x="1" y="1" width="118" height="70" rx="9"/>
    <circle class="blok-media-preview__knob" cx="60" cy="32" r="13"/>
    <path class="blok-media-preview__glyph" d="M56 26.5v11l9-5.5z"/>
    <rect class="blok-media-preview__track" x="12" y="59" width="96" height="3" rx="1.5"/>
    <rect class="blok-media-preview__progress" x="12" y="59" width="34" height="3" rx="1.5"/>`,
  audio: `
    <rect class="blok-media-preview__frame" x="1" y="11" width="118" height="50" rx="25"/>
    <circle class="blok-media-preview__knob" cx="24" cy="36" r="12"/>
    <path class="blok-media-preview__glyph" d="M20.5 31v10l8-5z"/>
    ${waveBars()}`,
  image: `
    <rect class="blok-media-preview__frame" x="1" y="1" width="118" height="70" rx="9"/>
    <circle class="blok-media-preview__sun" cx="86" cy="22" r="7"/>
    <path class="blok-media-preview__hill blok-media-preview__hill--far" d="M10 63l28-26 22 18 16-12 34 20z"/>
    <path class="blok-media-preview__hill" d="M10 63l22-15 22 15z"/>`,
  file: `
    <g class="blok-media-preview__sheet blok-media-preview__sheet--back">
      <rect x="40" y="6" width="44" height="58" rx="6"/>
    </g>
    <g class="blok-media-preview__sheet blok-media-preview__sheet--mid">
      <rect x="38" y="6" width="44" height="58" rx="6"/>
    </g>
    <g class="blok-media-preview__sheet blok-media-preview__sheet--front">
      <path d="M44 7h20l14 14v37a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V13a6 6 0 0 1 6-6z"/>
      <path class="blok-media-preview__fold" d="M64 7v10a4 4 0 0 0 4 4h10"/>
      <path class="blok-media-preview__line" d="M46 34h24M46 42h24M46 50h14"/>
    </g>`,
};

export function makePreview(kind: MediaPreviewKind): HTMLElement {
  const stage = document.createElement('span');
  stage.className = 'blok-media-preview';
  stage.setAttribute('data-blok-media-preview', kind);
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = `<svg viewBox="0 0 120 72" width="120" height="72" fill="none" focusable="false">${DRAWINGS[kind]}</svg>`;
  return stage;
}
