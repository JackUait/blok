import { renderPageIcon } from '../../src/shell/page-icon';
export interface PageToolbar {
  element: HTMLElement;
  setBreadcrumbs(items: PageBreadcrumbItem[]): void;
  setTitle(title: string): void;
  setIcon(icon: string | undefined): void;
  destroy(): void;
}

export interface PageBreadcrumbItem {
  id: string;
  title: string;
  icon?: string;
  onOpen?: () => void;
  menuHeading?: string;
  menu?: PageBreadcrumbChoice[];
}

export interface PageBreadcrumbChoice {
  id: string;
  title: string;
  icon?: string;
  current?: boolean;
  children?: PageBreadcrumbChoice[];
  onOpen: () => void;
}

function glyph(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

export function createPageToolbar(
  breadcrumbs: PageBreadcrumbItem[],
  fullWidth: boolean,
  onFullWidthChange: (value: boolean) => void,
): PageToolbar {
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-desktop-page-toolbar', '');
  const identity = document.createElement('div');
  identity.setAttribute('data-desktop-page-identity', '');
  const trail = document.createElement('nav');
  trail.setAttribute('data-desktop-page-breadcrumbs', '');
  trail.setAttribute('aria-label', 'Fil d’Ariane');
  const local = document.createElement('span');
  local.setAttribute('data-desktop-page-local', '');
  local.title = 'Cette page est enregistrée sur cet appareil';
  local.append(glyph(['M2.5 3.5h11v8h-11z', 'M5.5 13.5h5']), document.createTextNode('Sur cet appareil'));
  identity.append(trail, local);

  const actions = document.createElement('div');
  actions.setAttribute('data-desktop-page-actions', '');
  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('data-desktop-page-more', '');
  more.setAttribute('aria-label', 'Actions de la page');
  more.setAttribute('aria-haspopup', 'dialog');
  more.setAttribute('aria-expanded', 'false');
  more.append(glyph(['M4 8h.01', 'M8 8h.01', 'M12 8h.01']));
  const menu = document.createElement('div');
  menu.setAttribute('data-desktop-page-menu', '');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Apparence et mise en page');
  menu.hidden = true;
  const heading = document.createElement('div');
  heading.setAttribute('data-desktop-page-menu-heading', '');
  heading.textContent = 'Apparence et mise en page';
  const fullWidthButton = document.createElement('button');
  fullWidthButton.type = 'button';
  fullWidthButton.setAttribute('data-desktop-page-full-width', '');
  fullWidthButton.setAttribute('role', 'switch');
  fullWidthButton.setAttribute('aria-label', 'Pleine largeur');
  fullWidthButton.setAttribute('aria-checked', String(fullWidth));
  const label = document.createElement('span');
  label.textContent = 'Pleine largeur';
  const track = document.createElement('span');
  track.setAttribute('data-desktop-page-switch-track', '');
  fullWidthButton.append(label, track);
  menu.append(heading, fullWidthButton);
  actions.append(more, menu);
  toolbar.append(identity, actions);

  const close = (restoreFocus = false): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    if (restoreFocus) more.focus();
  };
  const outside = (event: PointerEvent): void => {
    if (event.target instanceof Node && actions.contains(event.target)) return;
    close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };
  more.addEventListener('click', () => {
    if (!menu.hidden) {
      close();
      return;
    }
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    fullWidthButton.focus();
  });
  fullWidthButton.addEventListener('click', () => {
    fullWidth = !fullWidth;
    fullWidthButton.setAttribute('aria-checked', String(fullWidth));
    onFullWidthChange(fullWidth);
  });
  const breadcrumbMenu = document.createElement('div');
  breadcrumbMenu.setAttribute('data-desktop-breadcrumb-menu', '');
  breadcrumbMenu.setAttribute('role', 'menu');
  breadcrumbMenu.setAttribute('aria-label', 'Naviguer entre les pages');
  breadcrumbMenu.hidden = true;
  toolbar.append(breadcrumbMenu);
  let activeCrumb: HTMLButtonElement | null = null;
  const closeBreadcrumbMenu = (restoreFocus = false): void => {
    if (breadcrumbMenu.hidden) return;
    breadcrumbMenu.hidden = true;
    activeCrumb?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) activeCrumb?.focus();
    activeCrumb = null;
    document.removeEventListener('pointerdown', outsideBreadcrumbMenu, true);
    document.removeEventListener('keydown', onBreadcrumbKey, true);
    window.removeEventListener('resize', onBreadcrumbResize);
  };
  const outsideBreadcrumbMenu = (event: PointerEvent): void => {
    if (event.target instanceof Node &&
      (breadcrumbMenu.contains(event.target) || activeCrumb?.contains(event.target))) return;
    closeBreadcrumbMenu();
  };
  const onBreadcrumbKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBreadcrumbMenu(true);
    }
  };
  const onBreadcrumbResize = (): void => closeBreadcrumbMenu();
  const openBreadcrumbMenu = (item: PageBreadcrumbItem, anchor: HTMLButtonElement): void => {
    if (activeCrumb === anchor && !breadcrumbMenu.hidden) {
      closeBreadcrumbMenu();
      return;
    }
    closeBreadcrumbMenu();
    close();
    const choices = item.menu ?? [];
    const renderChoices = (level: PageBreadcrumbChoice[], title: string, back?: () => void, expanded = false): void => {
      const heading = document.createElement('div');

      heading.setAttribute('data-desktop-breadcrumb-menu-heading', '');
      heading.textContent = title;
      breadcrumbMenu.replaceChildren(heading);
      if (back) {
        const backButton = document.createElement('button');

        backButton.type = 'button';
        backButton.setAttribute('data-desktop-breadcrumb-menu-back', '');
        backButton.textContent = '‹ Retour';
        backButton.addEventListener('click', back);
        breadcrumbMenu.append(backButton);
      }
      for (const choice of expanded ? level : level.slice(0, 6)) {
        const row = document.createElement('div');
        const button = document.createElement('button');
        const iconNode = document.createElement('span');
        const titleNode = document.createElement('span');

        row.setAttribute('data-desktop-breadcrumb-menu-row', '');
        if (choice.current) row.setAttribute('data-current', '');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('data-desktop-breadcrumb-menu-item', choice.id);
        if (choice.current) button.setAttribute('aria-current', 'page');
        iconNode.setAttribute('data-desktop-breadcrumb-menu-icon', '');
        iconNode.setAttribute('aria-hidden', 'true');
        if (choice.icon) renderPageIcon(iconNode, choice.icon);
        else iconNode.append(glyph(['M4 2.5h5.2L12.5 6v7.5H4z', 'M9.2 2.5V6h3.3']));
        titleNode.textContent = choice.title;
        button.append(iconNode, titleNode);
        button.addEventListener('click', () => { closeBreadcrumbMenu(); choice.onOpen(); });
        row.append(button);
        const childChoices = choice.children;

        if (childChoices?.length) {
          const children = document.createElement('button');

          children.type = 'button';
          children.setAttribute('data-desktop-breadcrumb-menu-children', '');
          children.setAttribute('aria-label', `Sous-pages de ${choice.title}`);
          children.textContent = '›';
          children.addEventListener('click', () => renderChoices(childChoices, choice.title, () => renderChoices(level, title, back)));
          row.append(children);
        }
        breadcrumbMenu.append(row);
      }
      if (!expanded && level.length > 6) {
        const morePages = document.createElement('button');

        morePages.type = 'button';
        morePages.setAttribute('data-desktop-breadcrumb-menu-more', '');
        morePages.textContent = `${level.length - 6} autres`;
        morePages.addEventListener('click', () => renderChoices(level, title, back, true));
        breadcrumbMenu.append(morePages);
      }
    };

    renderChoices(choices, item.menuHeading ?? 'Pages');
    const bounds = anchor.getBoundingClientRect();
    const toolbarBounds = toolbar.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);

    breadcrumbMenu.style.left = `${Math.max(8, Math.min(bounds.left - toolbarBounds.left, toolbarBounds.width - width - 8))}px`;
    breadcrumbMenu.hidden = false;
    activeCrumb = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideBreadcrumbMenu, true);
    document.addEventListener('keydown', onBreadcrumbKey, true);
    window.addEventListener('resize', onBreadcrumbResize);
  };
  let items = breadcrumbs.map((item) => ({ ...item }));
  const paint = (): void => {
    closeBreadcrumbMenu();
    const list = document.createElement('ol');

    items.forEach((item, index) => {
      if (index > 0) {
        const separator = document.createElement('li');

        separator.setAttribute('data-desktop-page-breadcrumb-separator', '');
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '/';
        list.append(separator);
      }
      const entry = document.createElement('li');
      const current = index === items.length - 1;
      const content = document.createElement(item.menu || item.onOpen ? 'button' : 'span');
      const iconNode = document.createElement('span');
      const titleNode = document.createElement('span');

      entry.setAttribute('data-desktop-page-breadcrumb-item', '');
      entry.setAttribute('data-page-id', item.id);
      if (content instanceof HTMLButtonElement) {
        content.type = 'button';
        if (item.menu) {
          content.setAttribute('aria-haspopup', 'menu');
          content.setAttribute('aria-expanded', 'false');
          content.addEventListener('click', () => openBreadcrumbMenu(item, content));
        } else if (item.onOpen) {
          content.addEventListener('click', item.onOpen);
        }
      }
      if (current) content.setAttribute('aria-current', 'page');
      content.title = item.title;
      iconNode.setAttribute('data-desktop-page-toolbar-icon', '');
      iconNode.setAttribute('aria-hidden', 'true');
      if (item.icon) renderPageIcon(iconNode, item.icon);
      else iconNode.append(glyph(['M4 2.5h5.2L12.5 6v7.5H4z', 'M9.2 2.5V6h3.3']));
      titleNode.setAttribute('data-desktop-page-toolbar-title', '');
      titleNode.textContent = item.title;
      content.append(iconNode, titleNode);
      entry.append(content);
      list.append(entry);
    });
    trail.replaceChildren(list);
    trail.scrollLeft = trail.scrollWidth;
  };
  paint();

  const updateCurrent = (change: Partial<Pick<PageBreadcrumbItem, 'title' | 'icon'>>): void => {
    const current = items.at(-1);

    if (!current) return;
    items = [...items.slice(0, -1), { ...current, ...change }];
    paint();
  };

  return {
    element: toolbar,
    setBreadcrumbs(value) { items = value.map((item) => ({ ...item })); paint(); },
    setTitle(value) { updateCurrent({ title: value }); },
    setIcon(value) { updateCurrent({ icon: value }); },
    destroy() { close(); closeBreadcrumbMenu(); },
  };
}
