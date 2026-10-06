import { createPreview, h } from '../../../components/utils/block-preview';
import MAP from './preview-map.svg?raw';

/** An embedded map that loads with a shimmer, then drops its pin. */
export const renderEmbedPreview = (): HTMLElement => {
  const map = h('div', { 'data-part': 'map' });

  map.innerHTML = MAP;

  return createPreview(
    'embed',
    h(
      'div',
      { 'data-part': 'frame' },
      map,
      h('span', { 'data-part': 'pin' }, h('span', { 'data-part': 'pin-dot' })),
      h('span', { 'data-part': 'zoom' }, h('span', {}, '+'), h('span', {}, '−')),
      h('span', { 'data-part': 'label' }, 'Café Luna · 4 min walk'),
      h('span', { 'data-part': 'loader' })
    )
  );
};
