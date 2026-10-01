import { createPreview, h } from '../../components/utils/block-preview';
import { IconPlayerPause } from '../../components/icons';

// Bar heights in px; the first PLAYED bars are drawn as already played.
const WAVE = [7, 12, 17, 10, 20, 14, 22, 12, 18, 9, 16, 21, 13, 19, 10, 15, 18, 11, 8, 12];
const PLAYED = 8;

/** Blok's audio card: cover, title, a waveform that plays, transport row. */
export const renderAudioPreview = (): HTMLElement => {
  const wave = h('div', { 'data-part': 'wave' });

  WAVE.forEach((height, i) => {
    wave.append(h('span', {
      'data-part': 'wave-bar',
      ...(i < PLAYED ? { 'data-played': '' } : {}),
      style: `--bar-h:${height}px;--i:${i}`,
    }));
  });

  const play = h('span', { 'data-part': 'play', 'aria-hidden': 'true' });

  play.innerHTML = IconPlayerPause;

  return createPreview(
    'audio',
    h(
      'div',
      { 'data-part': 'card' },
      h('div', { 'data-part': 'cover' }, h('span', { 'data-part': 'cover-sun' })),
      h(
        'div',
        { 'data-part': 'body' },
        h('div', { 'data-part': 'title' }, 'Late Night Drive'),
        h('div', { 'data-part': 'artist' }, 'Nova Lane'),
        wave,
        h(
          'div',
          { 'data-part': 'row' },
          play,
          h('span', { 'data-part': 'time' }, '1:12'),
          h('span', { 'data-part': 'time' }, '−2:36')
        )
      )
    )
  );
};
