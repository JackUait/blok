import { createPreview, h } from '../../components/utils/block-preview';

const TABS = ['Overview', 'Setup', 'FAQ'];

/** Line widths, so the content does not look like a solid block. */
const WIDTHS = [94, 78, 88, 56];

/** Tabs: a strip of three tabs, the first one open, above its content. */
export const renderTabsPreview = (): HTMLElement => createPreview(
  'tabs',
  h(
    'div',
    { 'data-strip': '' },
    ...TABS.map((title, index) => h('span', { 'data-tab': index === 0 ? 'active' : '' }, title))
  ),
  h(
    'div',
    { 'data-panel': '' },
    h('div', { 'data-title': '' }, 'Getting started'),
    ...WIDTHS.map((width, index) => h('div', { 'data-line': '', style: `width: ${width}%; --i: ${index}` }))
  )
);
