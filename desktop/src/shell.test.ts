import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountDesktop, setCanLeave } from './shell';

let reportPageIcon: (id: string, icon: string) => void = () => undefined;

vi.mock('./workspace', () => ({
  createWorkspace(onLayout: (width: number) => void, onPageIcon: (id: string, icon: string) => void) {
    reportPageIcon = onPageIcon;
    const element = document.createElement('div');
    const sidebar = document.createElement('aside');
    sidebar.setAttribute('data-blok-sidebar', '');
    element.append(sidebar);
    onLayout(260);
    return {
      element,
      start: async () => undefined,
      onRoute: () => undefined,
      toggleSidebar: () => undefined,
      createPage: () => history.pushState(null, '', `/?page=${crypto.randomUUID()}`),
    };
  },
}));

const KEY = 'blok:window-tabs:v1';

interface StoredTab {
  id: string;
  href: string;
  title: string;
  icon: string;
  scrollY: number;
  entries: string[];
  scrollPositions: number[];
  index: number;
}

interface StoredSession {
  tabs: StoredTab[];
  activeId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTab(value: unknown): value is StoredTab {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.href !== 'string') return false;
  if (typeof value.title !== 'string' || typeof value.icon !== 'string') return false;
  if (typeof value.scrollY !== 'number' || typeof value.index !== 'number') return false;
  if (!Array.isArray(value.entries) || !Array.isArray(value.scrollPositions)) return false;
  return value.entries.every((entry) => typeof entry === 'string')
    && value.scrollPositions.every((entry) => typeof entry === 'number');
}

function readSession(): StoredSession {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) throw new Error('missing session');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== 'string') {
    throw new Error('bad session');
  }
  const tabs = parsed.tabs.filter(isTab);
  if (tabs.length !== parsed.tabs.length) throw new Error('bad tab');
  return { tabs, activeId: parsed.activeId };
}

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountDesktop(root);
  return root;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => {
    return node.getAttribute('aria-label') === label || node.textContent === label;
  });
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${label}`);
  return found;
}

function tabLabels(root: ParentNode): string[] {
  return [...root.querySelectorAll('[role="tab"]')].map((tab) => {
    return tab.querySelector('[data-desktop-tab-label]')?.textContent ?? '';
  });
}

function selected(root: ParentNode): HTMLElement {
  const tab = root.querySelector('[role="tab"][aria-selected="true"]');
  if (!(tab instanceof HTMLElement)) throw new Error('no active tab');
  return tab;
}

function clickTab(root: ParentNode, index: number): void {
  const tab = root.querySelectorAll('[role="tab"]').item(index);
  if (!(tab instanceof HTMLElement)) throw new Error(`no tab ${index}`);
  tab.click();
}

function closeTab(root: ParentNode, index: number): void {
  const tab = root.querySelectorAll('[role="tab"]').item(index);
  const control = tab?.querySelector('[data-desktop-close]');
  if (!(control instanceof HTMLButtonElement)) throw new Error(`no close ${index}`);
  control.click();
}

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

const scroll = { y: 0 };

function installScroll(): void {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get() {
      return scroll.y;
    },
  });
  window.scrollTo = (x?: number | ScrollToOptions, y?: number) => {
    if (typeof x === 'object' && x) {
      scroll.y = x.top ?? scroll.y;
      return;
    }
    scroll.y = typeof y === 'number' ? y : scroll.y;
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  document.title = 'Nouvelle page';
  sessionStorage.clear();
  setCanLeave(() => true);
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  scroll.y = 0;
  installScroll();
});

installScroll();

describe('desktop tab strip', () => {
  it('opens one readable tab in a 40px strip', () => {
    const root = mount();
    const strip = root.querySelector('[data-desktop-tabstrip]');
    const list = root.querySelector('[role="tablist"]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('data-tauri-drag-region')).toBe('deep');
    expect(list?.getAttribute('aria-label')).toBe("Onglets de l'application");
    expect(tabLabels(root)).toEqual(['Nouvelle page']);
    expect(selected(root).getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('[data-desktop-close]')).toBeNull();
    expect(button(root, 'Page précédente').disabled).toBe(true);
    expect(button(root, 'Page suivante').disabled).toBe(true);
    expect(button(root, 'Afficher ou masquer la barre latérale')).toBeInstanceOf(HTMLButtonElement);
    expect(button(root, 'Nouvelle page')).toBeInstanceOf(HTMLButtonElement);
    expect(button(root, 'Nouvel onglet').getAttribute('title')).toBe('Nouvel onglet (⌘T)');
  });

  it('sizes the traffic-light spacer and the sidebar cluster for the browser', () => {
    const root = mount();
    const traffic = root.querySelector('[data-desktop-traffic]');
    const leading = root.querySelector('[data-desktop-leading]');
    expect(traffic).toBeInstanceOf(HTMLElement);
    expect(leading).toBeInstanceOf(HTMLElement);
    if (!(traffic instanceof HTMLElement) || !(leading instanceof HTMLElement)) return;
    expect(traffic.style.width).toBe('11px');
    expect(root.style.getPropertyValue('--desktop-sidebar-width')).toBe('260px');
    expect(traffic.getAttribute('data-tauri-drag-region')).not.toBeNull();
    expect(root.querySelector('[data-desktop-leading-drag]')?.getAttribute('data-tauri-drag-region')).not.toBeNull();
    expect(root.querySelector('[data-desktop-trailing-drag]')?.getAttribute('data-tauri-drag-region')).not.toBeNull();
  });

  it('widens the cluster for Tauri and tracks a sidebar that is already wider', () => {
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: vi.fn(() => Promise.resolve()) });
    const root = mount();
    const traffic = root.querySelector('[data-desktop-traffic]');
    const leading = root.querySelector('[data-desktop-leading]');
    if (!(traffic instanceof HTMLElement) || !(leading instanceof HTMLElement)) {
      throw new Error('missing cluster');
    }
    expect(traffic.style.width).toBe('83px');
    expect(root.style.getPropertyValue('--desktop-sidebar-width')).toBe('260px');
    expect(document.querySelectorAll('[data-blok-sidebar]')).toHaveLength(1);
    button(root, 'Afficher ou masquer la barre latérale').click();
    expect(document.querySelectorAll('[data-blok-sidebar]')).toHaveLength(1);
  });

  it('keeps the cluster aligned with the sidebar width', () => {
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: vi.fn(() => Promise.resolve()) });
    const root = mount();
    const leading = root.querySelector('[data-desktop-leading]');
    if (!(leading instanceof HTMLElement)) throw new Error('missing cluster');
    expect(root.style.getPropertyValue('--desktop-sidebar-width')).toBe('260px');
  });

  it('gives each tab its own history and leaves the other tab alone', () => {
    const root = mount();
    history.pushState(null, '', '/?page=alpha');
    history.pushState(null, '', '/?page=beta');
    const lengthAfterPush = history.length;
    button(root, 'Nouvel onglet').click();
    history.pushState(null, '', '/?page=side');
    const saved = readSession();
    expect(saved.tabs).toHaveLength(2);
    expect(saved.tabs[0]?.entries.map((href) => new URL(href).search)).toEqual(['', '?page=alpha', '?page=beta']);
    expect(saved.tabs[1]?.entries.map((href) => new URL(href).search)).toEqual(['', '?page=side']);
    expect(history.length).toBe(lengthAfterPush);
    clickTab(root, 0);
    expect(new URL(location.href).search).toBe('?page=beta');
    button(root, 'Page précédente').click();
    expect(new URL(location.href).search).toBe('?page=alpha');
    clickTab(root, 1);
    expect(new URL(location.href).search).toBe('?page=side');
    button(root, 'Page précédente').click();
    expect(new URL(location.href).search).toBe('');
    clickTab(root, 0);
    expect(new URL(location.href).search).toBe('?page=alpha');
  });

  it('drops the forward stack when the active tab navigates again', () => {
    const root = mount();
    history.pushState(null, '', '/?page=alpha');
    history.pushState(null, '', '/?page=beta');
    button(root, 'Page précédente').click();
    history.pushState(null, '', '/?page=gamma');
    expect(button(root, 'Page suivante').disabled).toBe(true);
    button(root, 'Page précédente').click();
    expect(new URL(location.href).search).toBe('?page=alpha');
    const searches = readSession().tabs[0]?.entries.map((href) => new URL(href).search);
    expect(searches).toEqual(['', '?page=alpha', '?page=gamma']);
  });

  it('restores each entry scroll and the scroll saved when switching tabs', () => {
    const root = mount();
    scroll.y = 80;
    history.pushState(null, '', '/?page=alpha');
    expect(scroll.y).toBe(0);
    scroll.y = 30;
    button(root, 'Nouvel onglet').click();
    clickTab(root, 0);
    expect(scroll.y).toBe(30);
    button(root, 'Page précédente').click();
    expect(scroll.y).toBe(80);
    const positions = readSession().tabs[0]?.scrollPositions;
    expect(positions?.[0]).toBe(80);
  });

  it('follows document.title and updates matching tabs from the page icon', async () => {
    const root = mount();
    history.pushState(null, '', '/?page=alpha');
    document.title = 'Carnet';
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(tabLabels(root)).toEqual(['Carnet']);
    button(root, 'Nouvel onglet').click();
    history.pushState(null, '', '/?page=beta');
    reportPageIcon('alpha', '👩‍💻');
    expect(root.querySelectorAll('[role="tab"]')[0]?.querySelector('[data-desktop-tab-icon]')?.textContent).toBe('👩‍💻');
    expect(selected(root).querySelector('[data-desktop-tab-icon="document"]')).not.toBeNull();
    reportPageIcon('beta', '📘');
    expect(selected(root).querySelector('[data-desktop-tab-icon]')?.textContent).toBe('📘');
    reportPageIcon('beta', '');
    expect(selected(root).querySelector('[data-desktop-tab-icon="document"]')).not.toBeNull();
  });

  it('hides the close control on the last tab and closes any other tab', () => {
    const root = mount();
    button(root, 'Nouvel onglet').click();
    document.title = 'Deux';
    expect(root.querySelectorAll('[data-desktop-close]')).toHaveLength(2);
    expect(button(root, 'Fermer Deux')).toBeInstanceOf(HTMLButtonElement);
    closeTab(root, 1);
    expect(tabLabels(root)).toEqual(['Nouvelle page']);
    expect(root.querySelector('[data-desktop-close]')).toBeNull();
    key({ key: 'w', ctrlKey: true });
    expect(tabLabels(root)).toEqual(['Nouvelle page']);
  });

  it('closes the webview from the last tab only inside Tauri', () => {
    const tauriInvoke = vi.fn(() => Promise.resolve());
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: tauriInvoke });
    const root = mount();
    window.dispatchEvent(new Event('blok:desktop-close-tab'));
    expect(tabLabels(root)).toEqual(['Nouvelle page']);
    expect(tauriInvoke).toHaveBeenCalledWith('close_editor_window', {});
    tauriInvoke.mockClear();
    button(root, 'Nouvel onglet').click();
    key({ key: 'w', ctrlKey: true });
    key({ key: 't', ctrlKey: true });
    expect(tauriInvoke).not.toHaveBeenCalled();
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
    window.dispatchEvent(new Event('blok:desktop-close-tab'));
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(tauriInvoke).not.toHaveBeenCalled();
  });

  it('lets the browser own new and close shortcuts, and leaves them to Tauri', () => {
    const root = mount();
    key({ key: 't', metaKey: true });
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
    key({ key: 'w', metaKey: true });
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(1);
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: vi.fn(() => Promise.resolve()) });
    key({ key: 't', ctrlKey: true });
    key({ key: 'T', metaKey: true });
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  it('walks history and tabs from the keyboard', () => {
    const root = mount();
    history.pushState(null, '', '/?page=alpha');
    button(root, 'Nouvel onglet').click();
    document.title = 'Deux';
    button(root, 'Nouvel onglet').click();
    document.title = 'Trois';
    key({ key: 'ArrowLeft', altKey: true });
    expect(button(root, 'Page précédente').disabled).toBe(true);
    key({ key: '[', ctrlKey: true, code: 'BracketLeft' });
    expect(new URL(location.href).search).toBe('');
    clickTab(root, 0);
    key({ key: ']', metaKey: true, code: 'BracketRight' });
    expect(new URL(location.href).search).toBe('?page=alpha');
    key({ key: 'ArrowRight', altKey: true });
    expect(button(root, 'Page suivante').disabled).toBe(true);
    key({ key: 'Tab', ctrlKey: true });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Deux');
    key({ key: '[', ctrlKey: true, shiftKey: true, code: 'BracketLeft' });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Nouvelle page');
    key({ key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Deux');
    key({ key: '9', ctrlKey: true });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Trois');
    key({ key: '1', metaKey: true });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Nouvelle page');
    key({ key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(selected(root).querySelector('[data-desktop-tab-label]')?.textContent).toBe('Trois');
  });

  it('stops when the page cannot be left', () => {
    const root = mount();
    history.pushState(null, '', '/?page=alpha');
    button(root, 'Nouvel onglet').click();
    setCanLeave(() => false);
    clickTab(root, 0);
    button(root, 'Nouvel onglet').click();
    button(root, 'Page précédente').click();
    key({ key: 'w', ctrlKey: true });
    key({ key: '[', ctrlKey: true, code: 'BracketLeft' });
    window.dispatchEvent(new Event('blok:desktop-new-tab'));
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(new URL(location.href).search).toBe('');
    expect(readSession().tabs[1]?.index).toBe(0);
  });

  it('persists at most 20 tabs and 100 history entries', () => {
    const root = mount();
    Array.from({ length: 25 }, (_unused, index) => index).forEach(() => {
      button(root, 'Nouvel onglet').click();
    });
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(20);
    Array.from({ length: 105 }, (_unused, index) => index).forEach((index) => {
      history.pushState(null, '', `/?page=${index}`);
    });
    const tab = readSession().tabs[19];
    expect(tab?.entries.length).toBe(100);
    expect(tab?.scrollPositions.length).toBe(100);
    expect(tab?.index).toBe(99);
    root.remove();
    const again = mount();
    expect(again.querySelectorAll('[role="tab"]')).toHaveLength(20);
    expect(new URL(location.href).search).toBe('?page=104');
  });

  it('updates only the active tab when the browser pops state', () => {
    const nativePush = History.prototype.pushState;
    const root = mount();
    button(root, 'Nouvel onglet').click();
    nativePush.call(history, null, '', '/?popped');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const saved = readSession();
    expect(new URL(saved.tabs[1]?.href ?? '').search).toBe('?popped');
    expect(new URL(saved.tabs[0]?.href ?? '').search).toBe('');
    expect(saved.tabs[0]?.entries).toHaveLength(1);
  });

  it('replaceState rewrites the current entry instead of pushing', () => {
    mount();
    history.pushState(null, '', '/?page=alpha');
    history.replaceState(null, '', '/?page=replaced');
    const tab = readSession().tabs[0];
    expect(tab?.entries.map((href) => new URL(href).search)).toEqual(['', '?page=replaced']);
    expect(tab?.index).toBe(1);
  });

  it('paints the strip from the stylesheet contract', () => {
    const css = readFileSync(join(process.cwd(), 'src/shell.css'), 'utf8');
    expect(css).toMatch(/\[data-desktop-tabstrip\][^}]*height:\s*40px/);
    expect(css).toMatch(/\[data-desktop-tabstrip\][^}]*position:\s*sticky/);
    expect(css).toMatch(/\[data-desktop-tabstrip\][^}]*top:\s*0/);
    expect(css).toMatch(/min-width:\s*120px/);
    expect(css).toMatch(/max-width:\s*280px/);
    expect(css).toMatch(/\[data-desktop-close\][^}]*opacity:\s*0/);
    expect(css).toMatch(/:hover \[data-desktop-close\]/);
    expect(css).toMatch(/:focus-within \[data-desktop-close\]/);
    expect(css).toMatch(/\[aria-selected="true"\][^}]*var\(--desktop-canvas\)/);
    expect(css).toMatch(/\[role="tablist"\][^}]*flex:\s*0 1 auto/);
    expect(css).not.toMatch(/\[aria-selected="true"\][^}]*blue/);
  });

  it('scrolls the active tab into view', () => {
    const seen: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      seen.push(this);
    };
    const root = mount();
    button(root, 'Nouvel onglet').click();
    expect(seen.some((node) => node === selected(root))).toBe(true);
  });
});

describe('Tauri window', () => {
  it('matches the reference window and removes Close Window from the File menu', () => {
    const config: unknown = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'));
    if (!isRecord(config)) throw new Error('config');
    expect(config.productName).toBe('Blok');
    expect(config.identifier).toBe('dev.notiooon.blok');
    if (!isRecord(config.app) || !Array.isArray(config.app.windows)) throw new Error('windows');
    const windowConfig: unknown = config.app.windows[0];
    if (!isRecord(windowConfig) || !isRecord(windowConfig.trafficLightPosition)) throw new Error('window');
    expect(windowConfig.title).toBe('Blok');
    expect(windowConfig.width).toBe(1440);
    expect(windowConfig.height).toBe(900);
    expect(windowConfig.minWidth).toBe(900);
    expect(windowConfig.minHeight).toBe(600);
    expect(windowConfig.titleBarStyle).toBe('Overlay');
    expect(windowConfig.hiddenTitle).toBe(true);
    expect(windowConfig.trafficLightPosition.x).toBe(16);
    expect(windowConfig.trafficLightPosition.y).toBe(21);
    const rust = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');
    expect(rust).toContain('New Tab');
    expect(rust).toContain('Close Tab');
    expect(rust).toContain('CmdOrCtrl+T');
    expect(rust).toContain('CmdOrCtrl+W');
    expect(rust).toContain("window.dispatchEvent(new Event('blok:desktop-new-tab'))");
    expect(rust).toContain("window.dispatchEvent(new Event('blok:desktop-close-tab'))");
    expect(rust).toContain('fn close_editor_window');
    expect(rust).not.toContain('close_window');
  });
});
