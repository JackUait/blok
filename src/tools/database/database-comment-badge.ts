import type { I18n } from '../../../types';
import { IconMessage } from '../../components/icons';

/** The host's comment counts for the rows of one view. */
export interface CommentBadges {
  /** A dashboard shows rows of other databases; a refresh touches only this one's. */
  databaseId: string;
  count(rowId: string): number;
  open(rowId: string, anchor: HTMLElement): void;
}

const BADGE = 'data-blok-database-comment-badge';
const ANCHOR = 'data-blok-database-comment-anchor';
const COUNT = 'data-blok-database-comment-count';
const DATABASE = 'data-blok-database-comment-database';

/**
 * Puts, updates or drops the "Open comments" badge right after `anchor`.
 * An existing badge is updated, never replaced: the host's thread popover is
 * anchored to it.
 */
export const syncCommentBadge = (
  anchor: HTMLElement,
  rowId: string,
  badges: CommentBadges,
  i18n: Pick<I18n, 't'>,
  options: { tabIndex?: number } = {}
): void => {
  anchor.setAttribute(ANCHOR, rowId);
  anchor.setAttribute(DATABASE, badges.databaseId);
  const count = badges.count(rowId);
  const next = anchor.nextElementSibling;
  const existing = next !== null && next.hasAttribute(BADGE) ? next : null;

  if (count <= 0) {
    existing?.remove();

    return;
  }
  const countEl = existing?.querySelector(`[${COUNT}]`);

  if (countEl !== null && countEl !== undefined) {
    countEl.textContent = String(count);

    return;
  }
  const badge = document.createElement('button');
  const icon = document.createElement('span');
  const label = document.createElement('span');

  badge.type = 'button';
  badge.setAttribute(BADGE, '');
  badge.setAttribute('aria-label', i18n.t('tools.database.openComments'));
  if (options.tabIndex !== undefined) badge.tabIndex = options.tabIndex;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconMessage;
  label.setAttribute(COUNT, '');
  label.textContent = String(count);
  badge.append(icon, label);
  // The row's own click opens its page; the badge opens the thread only.
  badge.addEventListener('click', (event) => {
    event.stopPropagation();
    badges.open(rowId, badge);
  });
  anchor.after(badge);
};

/** Reads every shown row's count again, keeping each badge node. */
export const refreshCommentBadges = (root: ParentNode, badges: CommentBadges, i18n: Pick<I18n, 't'>): void => {
  root.querySelectorAll<HTMLElement>(`[${ANCHOR}][${DATABASE}="${CSS.escape(badges.databaseId)}"]`).forEach((anchor) => {
    const rowId = anchor.getAttribute(ANCHOR) ?? '';
    // The table keeps its in-cell buttons out of the tab order.
    const inGrid = anchor.closest('[role="gridcell"]') !== null;

    syncCommentBadge(anchor, rowId, badges, i18n, inGrid ? { tabIndex: -1 } : {});
  });
};
