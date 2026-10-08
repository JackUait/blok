import { DATA_ATTR } from '../../constants/data-attributes';
import { PAGE_TITLE_INTERFACE_VALUE } from '../../constants';

export interface HeaderNodes {
  header: HTMLElement;
  iconRow: HTMLElement;
  title: HTMLElement;
}

export const buildHeader = (labels: { placeholder: string; ariaLabel: string }): HeaderNodes => {
  const header = document.createElement('div');
  const iconRow = document.createElement('div');
  const title = document.createElement('h1');

  header.setAttribute(DATA_ATTR.pageHeader, '');
  // Tokens and theme are declared on [data-blok-interface]; an outside holder has no other source.
  header.setAttribute(DATA_ATTR.interface, PAGE_TITLE_INTERFACE_VALUE);
  // Blok's block and editor key handling stand down; the title handles its own keys.
  header.setAttribute(DATA_ATTR.keyboardOwner, '');
  header.setAttribute('data-blok-testid', 'page-header');

  iconRow.setAttribute(DATA_ATTR.pageIconRow, '');

  title.setAttribute(DATA_ATTR.pageTitle, '');
  title.setAttribute('data-blok-testid', 'page-header-title');
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-multiline', 'false');
  title.setAttribute('aria-label', labels.ariaLabel);
  title.setAttribute('data-placeholder', labels.placeholder);
  title.spellcheck = false;

  header.append(iconRow, title);

  return { header, iconRow, title };
};

/** What {@link findHolder} could not resolve, in words a log or an error can carry. */
export const holderProblem = (holder: string): string => {
  try {
    document.querySelector(holder);
  } catch {
    return `"${holder}" is not a valid selector`;
  }

  return `no element matches "${holder}"`;
};

/** querySelector throws on a bad selector; this returns null for it instead. */
export const findHolder = (holder: HTMLElement | string): HTMLElement | null => {
  if (typeof holder !== 'string') {
    return holder;
  }
  try {
    return document.querySelector<HTMLElement>(holder);
  } catch {
    return null;
  }
};
