import { createPreview, h } from '../../../components/utils/block-preview';

/** Blok's bookmark card: text column, favicon + host/path, drawn cover in a leaning window. */
export const renderBookmarkPreview = (): HTMLElement => createPreview(
  'bookmark',
  h('p', { 'data-part': 'lead' }, 'Worth a read this week:'),
  h(
    'div',
    { 'data-part': 'card' },
    h(
      'div',
      { 'data-part': 'content' },
      h('div', { 'data-part': 'title' }, 'Slow software wins'),
      h('div', { 'data-part': 'description' }, 'Why the calmest tools win: fewer modes, honest defaults and room to think.'),
      h(
        'div',
        { 'data-part': 'link' },
        h('span', { 'data-part': 'favicon' }),
        h(
          'span',
          { 'data-part': 'url' },
          h('span', { 'data-part': 'host' }, 'craft.blog'),
          h('span', { 'data-part': 'path' }, '/slow')
        )
      )
    ),
    h(
      'div',
      { 'data-part': 'cover' },
      h(
        'div',
        { 'data-part': 'window' },
        h('div', { 'data-part': 'bar' }, h('span', { 'data-part': 'address' }, 'craft.blog/slow')),
        h('div', { 'data-part': 'shot' }, h('span', { 'data-part': 'cover-orb' }))
      )
    )
  )
);
