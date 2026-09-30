import { createPreview, h } from '../../../components/utils/block-preview';

const MAP = `
<svg viewBox="0 0 196 118" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <path data-part="water" d="M0 98c24-6 44 0 64-2s36-10 54-8 24 10 42 12 24-2 36-2v20H0Z"/>
  <path data-part="building" d="M36 42h30v14H36ZM36 66h30v14H36ZM82 42h18v14H82ZM82 66h18v14H82ZM108 66h18v14H108ZM174 42h22v16H174ZM174 66h22v16H174ZM4 4h22v26H4ZM36 4h32v26H36ZM82 4h18v26H82ZM4 66h22v14H4Z"/>
  <rect data-part="park" x="118" y="10" width="44" height="28" rx="6"/>
  <rect data-part="park" x="12" y="46" width="30" height="22" rx="5"/>
  <path data-part="street" d="M0 62h196M0 84h196M30 0v96M104 0v96M170 0v96M130 44l40 40"/>
  <path data-part="road" d="M-4 36C40 34 70 42 98 36s60-12 102-6"/>
  <path data-part="road" d="M72 -4c4 26 2 50-4 72s-6 30-4 50"/>
  <path data-part="route" d="M44 82c12-2 20-10 30-14s30 2 48-6"/>
</svg>`;

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
