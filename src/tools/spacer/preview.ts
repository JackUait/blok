import { createPreview, h } from '../../components/utils/block-preview';

/** Two paragraphs with a gap between them that breathes open. */
export const renderSpacerPreview = (): HTMLElement => createPreview(
  'spacer',
  h('p', { 'data-para': '' }, 'That’s a wrap on the launch notes. Thanks, everyone!'),
  h(
    'div',
    { 'data-gap': '' },
    h('div', { 'data-fill': '' }),
    h('div', { 'data-edge': 'top' }),
    h('div', { 'data-edge': 'bottom' }, h('span', { 'data-grip': '' }))
  ),
  h('div', { 'data-below': '' }, h('p', { 'data-para': '' }, 'Next up: what we learned, and what we’d do again.'))
);
