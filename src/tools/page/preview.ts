import { IconPage } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

/** Page: a sub-page link sitting between lines of its parent page. */
export const renderPagePreview = (): HTMLElement => {
  const icon = h('span', { 'data-icon': '' });

  icon.innerHTML = IconPage;

  return createPreview(
    'page',
    h('p', {}, 'Notes from the Monday sync.'),
    h('div', { 'data-row': '' }, icon, h('span', { 'data-title': '' }, 'Project notes')),
    h('p', {}, 'The details live in there.')
  );
};
