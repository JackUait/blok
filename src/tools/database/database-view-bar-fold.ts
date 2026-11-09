import { tabsThatFit } from '../../components/utils/overflow-list';

/**
 * Notion hides Filter, Sort, Automations, AI Autofill and Search together once
 * the room left for tabs beside the full toolbar drops below this. Measured
 * between 218.7 (hidden) and 222.7 (shown) in two runs (notion-spec-2 §26.1:
 * tb-940-closed, tbp-1350-open). Plain fit would keep the icons ~115px longer
 * and skip the "two tabs come back" step.
 */
export const ICON_FOLD_TAB_ROOM = 220;

/**
 * Notion drops New and its chevron below this content width: shown at a 322px
 * bar, gone at 318, less the bar's 8px inset at each end (§26.1: tbp-1460-open,
 * tb-780-closed).
 */
export const NEW_FOLD_WIDTH = 304;

/** Widths the fold is planned from, in px. Each tab's width includes the 1px gap before it. */
export interface ViewBarParts {
  /** The bar from the first tab to the end of the toolbar: Notion's bar less its 8px insets. */
  width: number;
  /** The gap between the tabs and the toolbar; it costs the tabs, not the switches. */
  gap: number;
  tabs: readonly number[];
  /** The current view's index, or -1. */
  current: number;
  /** "+" with its gaps; 0 when it is not shown. */
  add: number;
  /** "N more…" at its widest count, with its gap. */
  more: number;
  /** The toolbar with everything, and without the icon group. */
  toolbar: { full: number; noIcons: number };
}

export interface ViewBarFold {
  /** Every tab with "+", the shown indices beside "N more…", or "Table ⌄". */
  tabs: 'all' | 'compact' | number[];
  icons: boolean;
  newButton: boolean;
}

/**
 * Notion's order as the bar narrows (§26.1): tabs fold one at a time into
 * "N more…" (keeping two), then become "Table ⌄"; then the icons go together and
 * the tabs get another go; New goes last. Settings never goes.
 */
export const planViewBarFold = (parts: ViewBarParts): ViewBarFold => {
  const icons = parts.width - parts.toolbar.full >= ICON_FOLD_TAB_ROOM;
  const newButton = icons || parts.width >= NEW_FOLD_WIDTH;
  // New's room is not handed to the tabs: Notion shows "Table ⌄" at every width
  // without New (§26.1, bars 178–318), though two tabs would fit at 318.
  const room = parts.width - parts.gap - (icons ? parts.toolbar.full : parts.toolbar.noIcons);
  const all = parts.tabs.reduce((sum, width) => sum + width, 0) + parts.add;

  if (all <= room) {
    return { tabs: 'all', icons, newButton };
  }
  const fit = tabsThatFit(parts.tabs, parts.current, room - parts.more, 0);
  // Only "+" was short: one tab still folds, so "N more…" can offer New view.
  const dropped = fit.length < parts.tabs.length ? undefined : fit.filter((index) => index !== parts.current).at(-1);
  const shown = fit.filter((index) => index !== dropped);

  return { tabs: shown.length >= 2 ? shown : 'compact', icons, newButton };
};

/** A one-view title row: the row's width, what sits before the toolbar, and the toolbar with and without its icons. */
export interface TitleRowParts {
  width: number;
  lead: number;
  toolbar: { full: number; noIcons: number };
}

/**
 * The title row folds the same parts as the view bar: the icon group first,
 * New last, Settings never. Notion's switch points for this row are not
 * measured, so it folds only when the toolbar would run over the title.
 */
export const planTitleRowFold = (parts: TitleRowParts): Omit<ViewBarFold, 'tabs'> => {
  const room = parts.width - parts.lead;
  const icons = parts.toolbar.full <= room;

  return { icons, newButton: icons || parts.toolbar.noIcons <= room };
};

const outerWidth = (el: HTMLElement, width: number): number => {
  const style = getComputedStyle(el);

  return width + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
};

/**
 * Measures a one-view title row and sets the fold marks database.css reads.
 * Probes and marks go on the toolbar, which is mutation-free
 * (database-view-controls.ts): the row is not, so a write there is a block change.
 */
export const foldTitleRow = (row: HTMLElement): void => {
  const toolbar = row.querySelector<HTMLElement>(':scope > [data-blok-database-view-toolbar]');

  if (toolbar === null || !row.isConnected) return;
  toolbar.setAttribute('data-blok-database-fold-probe', 'full');
  const full = toolbar.offsetWidth;

  toolbar.setAttribute('data-blok-database-fold-probe', 'no-icons');
  const noIcons = toolbar.offsetWidth;

  toolbar.removeAttribute('data-blok-database-fold-probe');
  // The title shrinks to fit the row, so its text width is what it needs.
  const lead = Array.from(row.children)
    // The selection bar lies over the row while rows are picked; it takes no room.
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== toolbar && !['absolute', 'fixed'].includes(getComputedStyle(child).position))
    .reduce((sum, child) => sum + outerWidth(child, child.hasAttribute('data-blok-database-title') ? child.scrollWidth : child.offsetWidth), 0);
  const style = getComputedStyle(row);
  const width = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  const fold = planTitleRowFold({ width, lead, toolbar: { full, noIcons } });

  toolbar.toggleAttribute('data-blok-database-fold-icons', !fold.icons);
  toolbar.toggleAttribute('data-blok-database-fold-new', !fold.newButton);
};
