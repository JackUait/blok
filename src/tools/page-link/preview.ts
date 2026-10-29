import { IconPage } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

/** Link to page: looks like a page block, so it reuses the page drawing's styles. */
export const renderPageLinkPreview = (): HTMLElement => {
  const icon = h('span', { 'data-icon': '' });

  icon.innerHTML = IconPage;

  return createPreview(
    'page',
    h('p', {}, 'The plan is written up here:'),
    h('div', { 'data-row': '' }, icon, h('span', { 'data-title': '' }, 'Roadmap')),
    h('p', {}, 'It stays where it is.')
  );
};
