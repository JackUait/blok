import { createPreview, h } from '../../components/utils/block-preview';
import { IconExpandFullscreen, IconPlayerPause, IconPlayerPlay, IconPlayerVolume } from '../../components/icons';

const glyph = (part: string, svg: string): HTMLElement => {
  const el = h('span', { 'data-part': part, 'aria-hidden': 'true' });

  el.innerHTML = svg;

  return el;
};

// Dunes run past both edges so the pan never shows their ends.
const SCENE = `
<svg viewBox="0 0 196 110" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <circle data-part="star" style="--i:0" cx="24" cy="18" r="0.9"/>
  <circle data-part="star" style="--i:1" cx="58" cy="10" r="0.7"/>
  <circle data-part="star" style="--i:2" cx="92" cy="22" r="0.8"/>
  <circle data-part="star" style="--i:3" cx="150" cy="12" r="0.9"/>
  <circle data-part="star" style="--i:4" cx="178" cy="28" r="0.7"/>
  <path data-part="meteor" d="M118 6l-14 7"/>
  <circle data-part="moon" cx="154" cy="30" r="9"/>
  <path data-part="cloud" style="--i:0" d="M132 34h22M140 38h28"/>
  <path data-part="cloud" style="--i:1" d="M40 30h26M48 34h16"/>
  <path data-part="dune-far" d="M-30 80c14-4 22-6 30-6c30-16 58-18 86-8s52 8 72-4 30-8 38-4l30 6v52H-30Z"/>
  <path data-part="dune" d="M-40 92c14-2 28-3 40-4c26-10 56-12 84-4s60 8 112-10c14-5 28-6 44-4V116H-40Z"/>
</svg>`;

/** A playing video: the play press fades, then the scene pans while the clock and progress bar run. */
export const renderVideoPreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  scene.innerHTML = SCENE;

  const track = h(
    'div',
    { 'data-part': 'track' },
    h('div', { 'data-part': 'fill' }),
    h('div', { 'data-part': 'head' })
  );

  return createPreview(
    'video',
    h(
      'div',
      { 'data-part': 'frame' },
      scene,
      glyph('disc', IconPlayerPlay),
      h(
        'div',
        { 'data-part': 'bar' },
        track,
        h(
          'div',
          { 'data-part': 'row' },
          glyph('play', IconPlayerPause),
          h(
            'span',
            { 'data-part': 'time' },
            h('span', { 'data-part': 'elapsed' }),
            ' / ',
            h('span', { 'data-part': 'duration' }, '0:24')
          ),
          h('span', { 'data-part': 'spacer' }),
          glyph('icon', IconPlayerVolume),
          glyph('icon', IconExpandFullscreen)
        )
      )
    )
  );
};
