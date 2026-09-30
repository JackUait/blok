import { IconChevronRight } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

/**
 * One bullet inside the toggle.
 * @param text - bullet text
 */
const bullet = (text: string): HTMLElement =>
  h('div', { 'data-row': '' }, h('span', { 'data-marker': '' }, '•'), h('span', {}, text));

/** Toggle list: an open toggle with bullets inside. */
export const renderTogglePreview = (): HTMLElement => {
  const arrow = h('span', { 'data-arrow': '' });

  arrow.innerHTML = IconChevronRight;

  return createPreview(
    'toggle',
    h('div', { 'data-title': '' }, arrow, h('span', {}, 'Wonders of the World')),
    h(
      'div',
      { 'data-children': '' },
      bullet('Colossus of Rhodes'),
      bullet('Pyramids of Giza'),
      bullet('Hanging Gardens')
    )
  );
};
