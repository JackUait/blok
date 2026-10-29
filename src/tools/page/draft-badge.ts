import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PAGE_DRAFT_BADGE_CLASSES } from './constants';

/** Marks a page row as a draft: the status attribute and a badge after the title. */
export const appendDraftBadge = (link: HTMLElement, label: string): void => {
  const badge = document.createElement('span');

  badge.className = PAGE_DRAFT_BADGE_CLASSES;
  badge.setAttribute(DATA_ATTR.testid, 'page-draft-badge');
  badge.textContent = label;
  link.setAttribute('data-blok-page-status', 'draft');
  link.append(badge);
};
