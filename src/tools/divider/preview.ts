import { createPreview, h } from '../../components/utils/block-preview';

/** Divider: a line that splits two short sections. */
export const renderDividerPreview = (): HTMLElement =>
  createPreview(
    'divider',
    h('p', {}, 'And that was the week. Mostly coffee, some code.'),
    h('div', { 'data-rule': '' }, h('span', {})),
    h('p', { 'data-heading': '' }, 'Next week'),
    h('p', {}, 'Ship it. Then more coffee.')
  );
