import { createPreview, h } from '../../components/utils/block-preview';
import SCENE from './preview-scene.svg?raw';
import { IconExpandFullscreen, IconPlayerPause, IconPlayerPlay, IconPlayerVolume } from '../../components/icons';

const glyph = (part: string, svg: string): HTMLElement => {
  const el = h('span', { 'data-part': part, 'aria-hidden': 'true' });

  el.innerHTML = svg;

  return el;
};

/** A playing video of a night caravan: the play press fades, then the scene pans while the clock and progress bar run. */
export const renderVideoPreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  // The scene is static and never contains user data.
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
