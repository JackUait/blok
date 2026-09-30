import { createPreview, h } from '../../components/utils/block-preview';

/**
 * Toolbox drawing: a paragraph, then a short line being typed with a
 * blinking caret.
 */
export const renderTextPreview = (): HTMLElement => createPreview(
  'text',
  h(
    'p',
    { 'data-part': 'long' },
    'Good writing is ',
    h('em', {}, 'mostly rewriting'),
    '. Start with a messy draft, then cut until ',
    h('em', {}, 'every word'),
    ' earns its place on the page.'
  ),
  h(
    'p',
    { 'data-part': 'typing' },
    'Then read it out loud',
    h('span', { 'data-part': 'caret', 'aria-hidden': 'true' })
  )
);
