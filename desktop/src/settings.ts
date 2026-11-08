import { dataDirectory } from './storage';
import corePackage from '../../package.json';
import appPackage from '../package.json';

export type Appearance = 'dark' | 'light' | 'auto';

const KEY = 'blok:desktop:appearance';
const CORE_VERSION = corePackage.version;
const APP_VERSION = appPackage.version;

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' || value === 'auto' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

function resolved(mode: Appearance): 'dark' | 'light' {
  return mode === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
}

export function applyAppearance(root: HTMLElement, mode: Appearance): void {
  const value = resolved(mode);
  root.setAttribute('data-blok-theme', value);
  document.body.setAttribute('data-blok-theme', value);
  if (mode === 'auto') document.documentElement.removeAttribute('data-blok-theme');
  else document.documentElement.setAttribute('data-blok-theme', mode);
}

export function watchSystemAppearance(root: HTMLElement): void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return;
  query.addEventListener('change', () => {
    if (readAppearance() === 'auto') applyAppearance(root, 'auto');
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attr: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute(attr, '');
  if (text !== undefined) node.textContent = text;
  return node;
}

function chevron(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm4 6 4 4 4-4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function menuIcon(kind: 'settings' | 'storage'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', kind === 'settings'
    ? 'M8.7 2.2h2.6l.4 1.8 1.4.8 1.8-.6 1.3 2.2-1.4 1.3v1.6l1.4 1.3-1.3 2.2-1.8-.6-1.4.8-.4 1.8H8.7l-.4-1.8-1.4-.8-1.8.6-1.3-2.2 1.4-1.3V7.7L3.8 6.4l1.3-2.2 1.8.6 1.4-.8.4-1.8ZM10 6.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Z'
    : 'M3 5.2h5l1.3 1.5H17v8.1H3V5.2Z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function actionButton(attribute: string, label: string, kind: 'settings' | 'storage'): HTMLButtonElement {
  const button = el('button', attribute);
  button.type = 'button';
  button.append(menuIcon(kind), document.createTextNode(label));
  return button;
}

export function createDesktopFooter(onThemeChange: (mode: Appearance) => void): HTMLElement {
  const footer = el('div', 'data-desktop-footer');
  const switcher = el('button', 'data-desktop-switcher');
  switcher.type = 'button';
  switcher.setAttribute('aria-label', 'Espace local et réglages');
  switcher.setAttribute('aria-haspopup', 'menu');
  switcher.setAttribute('aria-expanded', 'false');
  switcher.append(el('span', 'data-desktop-avatar', 'B'), el('span', 'data-desktop-switcher-name', 'Espace local'), chevron());
  footer.append(switcher);

  const menu = el('div', 'data-desktop-footer-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const account = el('div', 'data-desktop-menu-account');
  account.append(el('span', 'data-desktop-menu-avatar', 'B'));
  const accountText = el('span', 'data-desktop-menu-account-text');
  accountText.append(el('strong', 'data-desktop-menu-title', 'Espace local'), el('small', 'data-desktop-menu-subtitle', 'Données sur cet appareil'));
  account.append(accountText);
  const preferences = actionButton('data-desktop-menu-item', 'Préférences', 'settings');
  preferences.setAttribute('role', 'menuitem');
  const storage = actionButton('data-desktop-menu-item', 'Copier le chemin des données', 'storage');
  storage.setAttribute('role', 'menuitem');
  menu.append(account, preferences, storage);
  footer.append(menu);

  const overlay = el('div', 'data-desktop-settings-overlay');
  overlay.hidden = true;
  const dialog = el('div', 'data-desktop-settings-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Réglages');
  dialog.tabIndex = -1;
  const nav = el('aside', 'data-desktop-settings-nav');
  nav.append(el('div', 'data-desktop-settings-nav-heading', 'Application'));
  const prefsTab = actionButton('data-desktop-settings-nav-item', 'Préférences', 'settings');
  const dataTab = actionButton('data-desktop-settings-nav-item', 'Données locales', 'storage');
  nav.append(prefsTab, dataTab);
  const main = el('main', 'data-desktop-settings-main');
  const close = el('button', 'data-desktop-settings-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer les réglages');
  main.append(close);
  dialog.append(nav, main);
  overlay.append(dialog);
  document.body.append(overlay);

  let directory = 'Chargement…';
  void dataDirectory().then((value) => {
    directory = value;
    const path = overlay.querySelector('[data-desktop-settings-path]');
    if (path) path.textContent = value;
  }).catch(() => { directory = 'Indisponible'; });

  const closeMenu = (): void => {
    menu.hidden = true;
    switcher.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsideMenu, true);
    document.removeEventListener('keydown', menuKey);
  };
  const outsideMenu = (event: PointerEvent): void => {
    if (event.target instanceof Node && footer.contains(event.target)) return;
    closeMenu();
  };
  const menuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { closeMenu(); switcher.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [preferences, storage];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    }
  };
  switcher.addEventListener('click', () => {
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false;
    switcher.setAttribute('aria-expanded', 'true');
    preferences.focus();
    document.addEventListener('pointerdown', outsideMenu, true);
    document.addEventListener('keydown', menuKey);
  });

  const closeSettings = (): void => {
    overlay.hidden = true;
    document.removeEventListener('keydown', settingsKey);
    switcher.focus();
  };
  const settingsKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { closeSettings(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  close.addEventListener('click', closeSettings);
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) closeSettings(); });

  const showPanel = (panel: 'preferences' | 'data'): void => {
    prefsTab.setAttribute('aria-current', panel === 'preferences' ? 'page' : 'false');
    dataTab.setAttribute('aria-current', panel === 'data' ? 'page' : 'false');
    main.querySelector('[data-desktop-settings-content]')?.remove();
    const content = el('div', 'data-desktop-settings-content');
    if (panel === 'preferences') {
      content.append(el('h1', 'data-desktop-settings-title', 'Préférences'));
      content.append(el('p', 'data-desktop-settings-intro', 'Personnalisez l’apparence de Blok sur cet appareil.'));
      content.append(el('h2', 'data-desktop-settings-section', 'Apparence'));
      const row = el('div', 'data-desktop-settings-row');
      const labels = el('div', 'data-desktop-settings-row-labels');
      labels.append(el('strong', 'data-desktop-settings-row-title', 'Thème'), el('span', 'data-desktop-settings-row-help', 'Choisissez l’apparence de Blok sur cet appareil.'));
      const select = el('select', 'data-desktop-settings-theme');
      select.setAttribute('aria-label', 'Thème');
      for (const [value, label] of [['dark', 'Sombre'], ['light', 'Clair'], ['auto', 'Système']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = readAppearance();
      select.addEventListener('change', () => {
        const mode = select.value as Appearance;
        localStorage.setItem(KEY, mode);
        const root = document.querySelector('[data-desktop-shell]');
        if (root instanceof HTMLElement) applyAppearance(root, mode);
        onThemeChange(mode);
      });
      row.append(labels, select);
      content.append(row);
    } else {
      content.append(el('h1', 'data-desktop-settings-title', 'Données locales'));
      content.append(el('p', 'data-desktop-settings-intro', 'Les pages sont enregistrées sur cet appareil.'));
      const path = el('code', 'data-desktop-settings-path', directory);
      const copy = el('button', 'data-desktop-settings-copy', 'Copier le chemin');
      copy.type = 'button';
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(directory).then(() => { copy.textContent = 'Chemin copié'; });
      });
      content.append(path, copy, el('p', 'data-desktop-settings-version', `Blok ${CORE_VERSION} · App ${APP_VERSION}`));
    }
    main.append(content);
  };
  prefsTab.addEventListener('click', () => showPanel('preferences'));
  dataTab.addEventListener('click', () => showPanel('data'));
  preferences.addEventListener('click', () => {
    closeMenu();
    showPanel('preferences');
    overlay.hidden = false;
    dialog.focus();
    document.addEventListener('keydown', settingsKey);
  });
  storage.addEventListener('click', () => {
    closeMenu();
    void navigator.clipboard.writeText(directory).then(() => {
      storage.textContent = 'Chemin copié';
      window.setTimeout(() => { storage.replaceChildren(menuIcon('storage'), document.createTextNode('Copier le chemin des données')); }, 1800);
    });
  });
  return footer;
}
