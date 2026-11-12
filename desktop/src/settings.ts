import { createChoice, styleTextField } from './ui/controls';
import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import { CloudClient } from './cloud/client';
import { nativeSessionAdapter } from './native-session';
import { mountWorkspaceMembers, openWorkspaceInvitation } from './cloud/workspace-settings';
import { activeWorkspace, listWorkspaces, createLocalWorkspace, workspaceKey, rememberWorkspace } from './workspace-registry';
import { dataDirectory } from './storage';
import corePackage from '../../package.json';
import appPackage from '../package.json';
import { mountAiSettings } from './ai-settings';
import { mountCustomEmojiSettings } from './custom-emoji-settings';
import { mountMcpSettings } from './mcp-settings';

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

type MenuIcon = 'profile' | 'settings' | 'ai' | 'storage' | 'connections' | 'emoji';

function menuIcon(kind: MenuIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const paths: Record<MenuIcon, string> = {
    profile: 'M10 10.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2ZM3.7 16.5c.3-2.8 2.7-4.6 6.3-4.6s6 1.8 6.3 4.6H3.7Z',
    settings: 'M3 5h14M3 10h14M3 15h14M7 3v4M13 8v4M8 13v4',
    ai: 'M10 2.5l1.6 5.1L17 9.2l-5.4 1.6L10 16l-1.6-5.2L3 9.2l5.4-1.6L10 2.5ZM16.5 14.3l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2Z',
    connections: 'M8 12l4-4M7 13l-1 1a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M13 7l1-1a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0',
    emoji: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM7 8h.01M13 8h.01M7 12c1.5 2 4.5 2 6 0',
    storage: 'M3 5.2h5l1.3 1.5H17v8.1H3V5.2Z',
  };
  path.setAttribute('d', paths[kind]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function actionButton(attribute: string, label: string, kind: MenuIcon): HTMLButtonElement {
  const button = el('button', attribute);
  button.type = 'button';
  button.append(menuIcon(kind), el('span', 'data-desktop-action-label', label));
  button.title = label;
  return button;
}

export function createDesktopFooter(onThemeChange: (mode: Appearance) => void): HTMLElement {
  const currentWorkspace = activeWorkspace();
  const native = '__TAURI_INTERNALS__' in window;
  const admin = currentWorkspace.kind === 'remote' && currentWorkspace.role === 'admin';
  const client = currentWorkspace.kind === 'remote' ? new CloudClient({origin: currentWorkspace.server, sessionAdapter: native ? nativeSessionAdapter(currentWorkspace.server) : undefined}) : null;
  let members: ReturnType<typeof mountWorkspaceMembers> | null = null;
  let modal: ModalDialogHandle | null = null;
  let choices: Array<{destroy(): void}> = [];
  let panelGeneration = 0;
  const openInvitation = (container?: HTMLElement): void => {
    if (!admin || !client || currentWorkspace.kind !== 'remote') return;
    if (!container) switcher.focus();
    openWorkspaceInvitation({client, slug: currentWorkspace.workspaceId, workspaceName: currentWorkspace.name, container, onComplete: () => members?.refresh()});
  };
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
  const account = currentWorkspace.kind === 'remote' ? el('div', 'data-desktop-menu-account') : el('button', 'data-desktop-menu-account');
  if (account instanceof HTMLButtonElement) { account.type = 'button'; account.setAttribute('role', 'menuitem'); }
  account.append(el('span', 'data-desktop-menu-avatar', currentWorkspace.name.charAt(0).toLocaleUpperCase()));
  const accountText = el('span', 'data-desktop-menu-account-text');
  accountText.append(el('strong', 'data-desktop-menu-title', 'Espace local'), el('small', 'data-desktop-menu-subtitle', 'Données sur cet appareil'));
  account.append(accountText);
  const preferences = actionButton('data-desktop-menu-item', 'Paramètres', 'settings');
  preferences.setAttribute('role', 'menuitem');
  const emitCloud = (section: 'settings' | 'invites' | 'account'): void => {
    closeMenu();
    footer.dispatchEvent(new CustomEvent('blok:desktop-connect-cloud', {bubbles: true, detail: {section}}));
  };
  const connect = actionButton('data-desktop-menu-connect', currentWorkspace.kind === 'remote' ? 'Gérer mon compte' : 'Ajouter un compte', 'profile');
  connect.setAttribute('data-desktop-menu-item', '');
  connect.setAttribute('role', 'menuitem');
  connect.addEventListener('click', () => {
    if (currentWorkspace.kind === 'remote') openSettings('account');
    else emitCloud('account');
  });
  menu.append(account, preferences);
  if (admin) {
    const invite = actionButton('data-desktop-menu-invite', 'Inviter des membres', 'profile');
    invite.setAttribute('data-desktop-menu-item', '');
    invite.setAttribute('role', 'menuitem');
    invite.addEventListener('click', () => { closeMenu(); openInvitation(); });
    menu.append(invite);
  }
  menu.append(connect);
  const all = listWorkspaces();
  const remote = all.filter((ref) => ref.kind === 'remote');
  const groups = new Map<string, typeof remote>();
  for (const ref of remote) {
    const email = ref.userName ?? 'Compte en ligne';
    const members = groups.get(email) ?? [];
    members.push(ref); groups.set(email, members);
  }
  const addChoice = (ref: (typeof all)[number], group: HTMLElement): void => {
    const choice = actionButton('data-desktop-menu-workspace', ref.name, 'storage');
    const label = el('span', 'data-desktop-menu-workspace-name', ref.name);
    choice.replaceChildren(el('span', 'data-desktop-workspace-avatar', ref.name.charAt(0).toLocaleUpperCase()), label);
    choice.setAttribute('role', 'menuitemradio');
    choice.setAttribute('data-desktop-menu-item', '');
    const current = workspaceKey(ref) === workspaceKey(currentWorkspace);
    choice.setAttribute('aria-checked', String(current));
    if (current) {
      choice.setAttribute('aria-current', 'true');
      const check = el('span', 'data-desktop-menu-check', '✓');
      check.setAttribute('aria-hidden', 'true'); choice.append(check);
    }
    choice.addEventListener('click', () => {
      closeMenu();
      if (!current) footer.dispatchEvent(new CustomEvent('blok:desktop-select-workspace', { bubbles: true, detail: ref }));
    });
    group.append(choice);
  };
  for (const [email, refs] of groups) {
    const group = el('div', 'data-desktop-menu-group');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', email);
    group.append(el('div', 'data-desktop-menu-group-label', email));
    for (const ref of refs) addChoice(ref, group);
    menu.append(group);
  }
  if (native) {
    const group = el('div', 'data-desktop-menu-group');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Sur cet appareil');
    group.append(el('div', 'data-desktop-menu-group-label', 'Sur cet appareil'));
    for (const ref of all) if (ref.kind === 'local') addChoice(ref, group);
    const addLocal = actionButton('data-desktop-menu-new-workspace', 'Créer un espace local', 'storage');
    addLocal.setAttribute('data-desktop-menu-item', ''); addLocal.setAttribute('role', 'menuitem');
    addLocal.addEventListener('click', () => {
      const name = window.prompt('Nom du nouvel espace local');
      if (name === null) return;
      closeMenu();
      footer.dispatchEvent(new CustomEvent('blok:desktop-select-workspace', {bubbles: true, detail: createLocalWorkspace(name)}));
    });
    group.append(addLocal); menu.append(group);
  }
  footer.append(menu);

  const overlay = el('div', 'data-desktop-settings-overlay');
  overlay.hidden = true;
  const dialog = el('div', 'data-desktop-settings-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Réglages');
  dialog.tabIndex = -1;
  const nav = el('aside', 'data-desktop-settings-nav');
  nav.append(el('div', 'data-desktop-settings-nav-heading', 'Compte'));
  const accountTab = actionButton('data-desktop-settings-nav-item', currentWorkspace.kind === 'remote' ? currentWorkspace.userName ?? 'Mon compte' : 'Profil local', 'profile');
  const connectionsTab = actionButton('data-desktop-settings-nav-item', 'Connexions', 'connections');
  nav.append(accountTab);
  if (client) nav.append(connectionsTab);
  nav.append(el('div', 'data-desktop-settings-nav-heading', 'Application'));
  const prefsTab = actionButton('data-desktop-settings-nav-item', 'Préférences', 'settings');
  const aiTab = actionButton('data-desktop-settings-nav-item', 'Assistant IA', 'ai');
  nav.append(prefsTab, aiTab);
  const generalTab = actionButton('data-desktop-settings-nav-item', 'Général', 'storage');
  const emojiTab = actionButton('data-desktop-settings-nav-item', 'Émojis', 'emoji');
  const membersTab = actionButton('data-desktop-settings-nav-item', 'Membres', 'profile');
  nav.append(el('div', 'data-desktop-settings-nav-heading', 'Espace'), generalTab, emojiTab);
  if (admin) nav.append(membersTab);
  const main = el('main', 'data-desktop-settings-main');
  const close = el('button', 'data-desktop-settings-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer les réglages');
  main.append(close);
  dialog.append(nav, main);
  overlay.append(dialog);
  document.body.append(overlay);

  let directory = 'Chargement…';
  if (native && currentWorkspace.kind === 'local') void dataDirectory().then((value) => {
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
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem], [role=menuitemradio]')];
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

  const closeSettings = (): void => { modal?.close(); };
  close.addEventListener('click', closeSettings);

  type SettingsPanel = 'account' | 'preferences' | 'ai' | 'general' | 'members' | 'emojis' | 'connections';
  const showPanel = (panel: SettingsPanel): void => {
    accountTab.setAttribute('aria-current', panel === 'account' ? 'page' : 'false');
    connectionsTab.setAttribute('aria-current', panel === 'connections' ? 'page' : 'false');
    prefsTab.setAttribute('aria-current', panel === 'preferences' ? 'page' : 'false');
    aiTab.setAttribute('aria-current', panel === 'ai' ? 'page' : 'false');
    generalTab.setAttribute('aria-current', panel === 'general' ? 'page' : 'false');
    emojiTab.setAttribute('aria-current', panel === 'emojis' ? 'page' : 'false');
    membersTab.setAttribute('aria-current', panel === 'members' ? 'page' : 'false');
    members?.destroy(); members = null;
    choices.splice(0).forEach((choice) => choice.destroy());
    ++panelGeneration;
    main.querySelector('[data-desktop-settings-content]')?.remove();
    const content = el('div', 'data-desktop-settings-content');
    if (panel === 'connections' && client) {
      main.append(content);
      mountMcpSettings(content, client);
      return;
    }
    if (panel === 'emojis') {
      content.append(el('h1', 'data-desktop-settings-title', 'Émojis'));
      choices.push(mountCustomEmojiSettings(content, currentWorkspace));
      main.append(content);
      return;
    }
    if (panel === 'members' && admin && client && currentWorkspace.kind === 'remote') {
      content.append(el('h1', 'data-desktop-settings-title', 'Membres'));
      main.append(content);
      members = mountWorkspaceMembers(content, {client, slug: currentWorkspace.workspaceId, onInvite: () => openInvitation(dialog)});
      return;
    }
    if (panel === 'account' && currentWorkspace.kind === 'remote') {
      content.setAttribute('data-desktop-account', '');
      content.append(el('h1', 'data-desktop-settings-title', 'Mon compte'), el('p', 'data-desktop-settings-intro', 'Votre identité et votre accès à cet espace.'));
      const identity = el('section', 'data-desktop-account-section');
      identity.append(el('h2', 'data-desktop-settings-section', 'Identité'));
      const row = el('div', 'data-desktop-settings-row');
      row.append(el('strong', 'data-desktop-settings-row-title', 'Adresse e-mail'), el('span', 'data-desktop-settings-row-value', currentWorkspace.userName ?? 'Compte en ligne'));
      identity.append(row);
      const workspace = el('section', 'data-desktop-account-section');
      workspace.append(el('h2', 'data-desktop-settings-section', 'Espace actuel'));
      const workspaceRow = el('div', 'data-desktop-settings-row');
      workspaceRow.append(el('strong', 'data-desktop-settings-row-title', 'Nom'), el('span', 'data-desktop-settings-row-value', currentWorkspace.name));
      const roleRow = el('div', 'data-desktop-settings-row');
      roleRow.append(el('strong', 'data-desktop-settings-row-title', 'Rôle'), el('span', 'data-desktop-settings-row-value', currentWorkspace.role === 'admin' ? 'Administrateur' : currentWorkspace.role === 'viewer' ? 'Lecture seule' : 'Membre'));
      workspace.append(workspaceRow, roleRow);
      const accounts = actionButton('data-desktop-settings-copy', 'Comptes et espaces', 'profile');
      accounts.addEventListener('click', () => { closeSettings(); emitCloud('account'); });
      const accountActions = el('div', 'data-desktop-account-actions');
      accountActions.append(el('p', 'data-desktop-settings-row-help', 'Retrouvez vos espaces ou connectez un autre compte.'), accounts);
      content.append(identity, workspace, accountActions);
    } else if (panel === 'account') {
      content.append(el('h1', 'data-desktop-settings-title', 'Profil local'));
      content.append(el('p', 'data-desktop-settings-intro', 'Cet espace appartient à cet appareil.'));
      content.append(el('h2', 'data-desktop-settings-section', 'Identité affichée'));
      const row = el('div', 'data-desktop-settings-row');
      const labels = el('div', 'data-desktop-settings-row-labels');
      labels.append(el('strong', 'data-desktop-settings-row-title', 'Nom'), el('span', 'data-desktop-settings-row-help', 'Nom local, sans connexion ni partage.'));
      const name = el('input', 'data-desktop-settings-name');
      name.type = 'text';
      styleTextField(name);
      name.maxLength = 48;
      name.value = currentWorkspace.kind === 'local' && currentWorkspace.id === 'default' ? localStorage.getItem('blok:desktop:profile-name') || 'Espace local' : currentWorkspace.name;

      name.setAttribute('aria-label', 'Nom du profil local');
      name.addEventListener('change', () => {
        const next = name.value.trim() || 'Espace local';
        if (currentWorkspace.kind === 'local' && currentWorkspace.id === 'default') localStorage.setItem('blok:desktop:profile-name', next);
        else rememberWorkspace({...currentWorkspace, name: next});
        switcher.querySelector('[data-desktop-switcher-name]')!.textContent = next;
        account.querySelector('[data-desktop-menu-title]')!.textContent = next;
      });
      row.append(labels, name);
      content.append(row, el('p', 'data-desktop-settings-explanation', 'Pour partager et modifier des pages à plusieurs via Internet, il faudra connecter l’app à un service avec comptes et droits d’accès. Utilisez « Connecter un espace en ligne » dans le menu des espaces.'));
    } else if (panel === 'preferences') {
      content.append(el('h1', 'data-desktop-settings-title', 'Préférences'));
      content.append(el('p', 'data-desktop-settings-intro', 'Personnalisez l’apparence de Blok sur cet appareil.'));
      content.append(el('h2', 'data-desktop-settings-section', 'Apparence'));
      const row = el('div', 'data-desktop-settings-row');
      const labels = el('div', 'data-desktop-settings-row-labels');
      labels.append(el('strong', 'data-desktop-settings-row-title', 'Thème'), el('span', 'data-desktop-settings-row-help', 'Choisissez l’apparence de Blok sur cet appareil.'));
      const theme = createChoice<Appearance>({
        label: 'Thème', value: readAppearance(),
        options: [{value:'dark',label:'Sombre'},{value:'light',label:'Clair'},{value:'auto',label:'Système'}],
        onChange(mode) {
          localStorage.setItem(KEY, mode);
          const root = document.querySelector('[data-desktop-shell]');
          if (root instanceof HTMLElement) applyAppearance(root, mode);
          onThemeChange(mode);
        },
      });
      theme.element.setAttribute('data-desktop-settings-theme', ''); choices.push(theme);
      row.append(labels, theme.element);
      content.append(row);
      if (native && currentWorkspace.kind === 'local') {
        const advanced = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'Avancé';
        advanced.append(summary, el('code', 'data-desktop-settings-path', directory));
        const copy = el('button', 'data-desktop-settings-copy', 'Copier le chemin des données'); copy.type = 'button';
        copy.addEventListener('click', () => { void navigator.clipboard.writeText(directory).then(() => { copy.textContent = 'Chemin copié'; }); });
        advanced.append(copy); content.append(advanced);
      }
    } else if (panel === 'ai') {
      choices.push(mountAiSettings(content, currentWorkspace));
    } else if (panel === 'general') {
      content.append(el('h1', 'data-desktop-settings-title', 'Général'), el('p', 'data-desktop-settings-intro', 'Informations sur votre espace.'));
      const nameRow = el('div', 'data-desktop-settings-row');
      nameRow.append(el('strong', 'data-desktop-settings-row-title', 'Nom de l’espace'), el('span', 'data-desktop-settings-row-value', currentWorkspace.name));
      content.append(nameRow);
      if (currentWorkspace.kind === 'remote') {
        const serverRow = el('div', 'data-desktop-settings-row');
        serverRow.append(el('strong', 'data-desktop-settings-row-title', 'Serveur'), el('span', 'data-desktop-settings-row-value', currentWorkspace.server));
        const advanced = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'Avancé';
        advanced.append(summary, serverRow); content.append(advanced);
      } else content.append(el('p', 'data-desktop-settings-explanation', 'Les pages de cet espace sont enregistrées sur cet appareil.'));
      content.append(el('p', 'data-desktop-settings-version', `Blok ${CORE_VERSION} · App ${APP_VERSION}`));
    }

    main.append(content);
  };
  accountTab.addEventListener('click', () => showPanel('account'));
  prefsTab.addEventListener('click', () => showPanel('preferences'));
  aiTab.addEventListener('click', () => showPanel('ai'));
  generalTab.addEventListener('click', () => showPanel('general'));
  emojiTab.addEventListener('click', () => showPanel('emojis'));
  connectionsTab.addEventListener('click', () => showPanel('connections'));
  membersTab.addEventListener('click', () => { if (admin) showPanel('members'); });
  const openSettings = (panel: SettingsPanel): void => {
    closeMenu();
    showPanel(panel);
    switcher.focus();
    overlay.hidden = false;
    modal = openModalDialog({
      content: overlay, surface: dialog, label: 'Paramètres', initialFocus: () => dialog,
      onDismiss: () => closeSettings(),
      onClose: () => { overlay.hidden = true; ++panelGeneration; choices.splice(0).forEach((choice) => choice.destroy()); members?.destroy(); members = null; modal = null; },
    });
  };
  footer.addEventListener('blok:desktop-open-ai-settings', () => openSettings('ai'));
  preferences.addEventListener('click', () => openSettings('preferences'));
  if (account instanceof HTMLButtonElement) account.addEventListener('click', () => openSettings('account'));
  const profileName = currentWorkspace.kind === 'local' && currentWorkspace.id === 'default' ? localStorage.getItem('blok:desktop:profile-name') : currentWorkspace.name;
  if (profileName) {
    switcher.querySelector('[data-desktop-switcher-name]')!.textContent = profileName;
    account.querySelector('[data-desktop-menu-title]')!.textContent = profileName;
  }
  if (currentWorkspace.kind === 'remote') {
    account.querySelector('[data-desktop-menu-subtitle]')!.textContent = currentWorkspace.userName ?? 'Compte en ligne';
    switcher.setAttribute('aria-label', 'Espaces et réglages');
  }
  return footer;
}
