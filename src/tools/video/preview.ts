import { createPreview, h } from '../../components/utils/block-preview';
import { IconExpandFullscreen, IconPlayerPause, IconPlayerPlay, IconPlayerVolume } from '../../components/icons';

const glyph = (part: string, svg: string): HTMLElement => {
  const el = h('span', { 'data-part': part, 'aria-hidden': 'true' });

  el.innerHTML = svg;

  return el;
};

const SCENE = `
<svg viewBox="0 0 196 110" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <circle data-part="star" cx="24" cy="18" r="0.9"/>
  <circle data-part="star" cx="58" cy="10" r="0.7"/>
  <circle data-part="star" cx="92" cy="22" r="0.8"/>
  <circle data-part="star" cx="150" cy="12" r="0.9"/>
  <circle data-part="star" cx="178" cy="28" r="0.7"/>
  <circle data-part="moon" cx="154" cy="30" r="9"/>
  <path data-part="dune-far" d="M0 74c30-16 58-18 86-8s52 8 72-4 30-8 38-4v52H0Z"/>
  <path data-part="dune" d="M0 88c26-10 56-12 84-4s60 8 112-10v36H0Z"/>
</svg>`;

/** A paused video frame: pressing play fades the centre disc and runs the progress bar. */
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
          h('span', { 'data-part': 'time' }, '1:04 / 3:12'),
          h('span', { 'data-part': 'spacer' }),
          glyph('icon', IconPlayerVolume),
          glyph('icon', IconExpandFullscreen)
        )
      )
    )
  );
};
