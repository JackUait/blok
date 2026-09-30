import { createPreview, h } from '../../../components/utils/block-preview';

/** Blok's bookmark card unfurling: text column, favicon + URL, drawn cover. */
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
        h('span', { 'data-part': 'url' }, 'craft.blog/slow')
      )
    ),
    h(
      'div',
      { 'data-part': 'cover' },
      h('span', { 'data-part': 'cover-orb' })
    )
  )
);
