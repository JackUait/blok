import { createPreview, h } from '../../components/utils/block-preview';

const ENTRIES: Array<[depth: number, text: string]> = [
  [0, 'Getting started'],
  [1, 'Install'],
  [1, 'First page'],
  [0, 'Sharing'],
  [1, 'Invite your team'],
];

/** A short outline of indented heading links. */
export const renderTableOfContentsPreview = (): HTMLElement => createPreview(
  'table-of-contents',
  h(
    'div',
    { 'data-outline': '' },
    ...ENTRIES.map(([depth, text]) => h('div', { 'data-entry': '', 'data-depth': String(depth) }, text))
  )
);
