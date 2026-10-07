import { DATA_ATTR } from '../../constants/data-attributes';
import { BLOK_INTERFACE_VALUE } from '../../constants';

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
  header.setAttribute(DATA_ATTR.interface, BLOK_INTERFACE_VALUE);
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
