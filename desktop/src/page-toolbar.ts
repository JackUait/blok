export interface PageToolbar {
  element: HTMLElement;
  setTitle(title: string): void;
  setIcon(icon: string | undefined): void;
  destroy(): void;
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
  title: string,
  icon: string | undefined,
  fullWidth: boolean,
  onFullWidthChange: (value: boolean) => void,
): PageToolbar {
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-desktop-page-toolbar', '');
  const identity = document.createElement('div');
  identity.setAttribute('data-desktop-page-identity', '');
  const iconNode = document.createElement('span');
  iconNode.setAttribute('data-desktop-page-toolbar-icon', '');
  iconNode.setAttribute('aria-hidden', 'true');
  const titleNode = document.createElement('span');
  titleNode.setAttribute('data-desktop-page-toolbar-title', '');
  const local = document.createElement('span');
  local.setAttribute('data-desktop-page-local', '');
  local.title = 'Cette page est enregistrée sur cet appareil';
  local.append(glyph(['M2.5 3.5h11v8h-11z', 'M5.5 13.5h5']), document.createTextNode('Sur cet appareil'));
  identity.append(iconNode, titleNode, local);

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
  titleNode.textContent = title;
  const setIcon = (value: string | undefined): void => {
    if (value) iconNode.textContent = value;
    else iconNode.replaceChildren(glyph(['M4 2.5h5.2L12.5 6v7.5H4z', 'M9.2 2.5V6h3.3']));
  };
  setIcon(icon);

  return {
    element: toolbar,
    setTitle(value) { titleNode.textContent = value; },
    setIcon,
    destroy() { close(); },
  };
}
