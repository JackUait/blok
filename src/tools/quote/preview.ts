import { createPreview, h } from '../../components/utils/block-preview';

/** Quote: a line of text beside the quote bar, with its author. */
export const renderQuotePreview = (): HTMLElement =>
  createPreview(
    'quote',
    h('p', { 'data-lead': '' }, 'As someone once said:'),
    h(
      'blockquote',
      {},
      h('span', { 'data-bar': '' }),
      h('span', { 'data-text': '' }, 'Simplicity is the ultimate sophistication.'),
      h('span', { 'data-cite': '' }, '— Leonardo da Vinci')
    )
  );
