import { mountTeamspaceSettings } from './cloud/teamspace-settings';
import { teamspaceClient } from './cloud/teamspaces';
import { mountWorkspaceIcon, workspaceGlyph } from './workspace-identity';
import { WORKSPACE_ROLES } from './access-vocabulary';
import { createChoice, styleTextField, wrapSearchField } from './ui/controls';
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
import {loadReactGrab, reactGrabAvailable} from './react-grab';
import { mountInstanceSettings, type InstancePanel } from './instance/instance-settings';

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
  if (mode !== 'auto') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function settingsPanelSource(panel: string): string {
  if (panel === 'emojis') return 'custom-emoji-settings.ts';
  if (panel === 'mcp') return 'mcp-settings.ts';
  if (panel === 'ai') return 'ai-settings.ts';
  if (panel === 'members') return 'cloud/workspace-settings.ts';
  if (panel.startsWith('instance-')) return 'instance/instance-settings.ts';
  return 'settings.ts';
}

function openLocalWorkspaceDialog(onCreate: (name: string) => void): void {
  const overlay = el('div', 'data-desktop-settings-overlay');
  const surface = el('section', 'data-desktop-shortcuts-surface');
  surface.append(el('h2', 'data-desktop-settings-title', 'Nouvel espace local'));
  const form = document.createElement('form');
  const name = el('input', 'data-desktop-settings-name');
  name.type = 'text';
  styleTextField(name);
  name.placeholder = 'Nom du Workspace';
  name.required = true;
  name.maxLength = 80;
  const actions = el('div', 'data-desktop-account-actions');
  const cancel = el('button', 'data-desktop-settings-copy', 'Annuler');
  cancel.type = 'button';
  const submit = el('button', 'data-desktop-settings-copy', 'Créer');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(name, actions);
  surface.append(form);
  overlay.append(surface);
  const handle = openModalDialog({
    content: overlay,
    surface,
    label: 'Nouvel espace local',
    initialFocus: () => name,
    onDismiss: () => handle.close(),
  });
  cancel.addEventListener('click', () => handle.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = name.value.trim();
    if (!value) return;
    handle.close();
    onCreate(value);
  });
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

type MenuIcon = 'profile' | 'settings' | 'ai' | 'storage' | 'connections' | 'emoji' | 'help';

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
    help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 14.2h.01M8.4 7.6a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.9.7-.9 1.3v.4',
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
  const ui = {
    members: null as ReturnType<typeof mountWorkspaceMembers> | null,
    instancePanel: null as ReturnType<typeof mountInstanceSettings> | null,
    modal: null as ModalDialogHandle | null,
    choices: [] as Array<{destroy(): void; dismiss?(): boolean}>,
    panelGeneration: 0,
    teamspaceId: undefined as string | undefined,
    directory: 'Chargement…',
  };
  const openInvitation = (container?: HTMLElement): void => {
    if (!admin || !client || currentWorkspace.kind !== 'remote') return;
    if (!container) switcher.focus();
    openWorkspaceInvitation({client, slug: currentWorkspace.workspaceId, workspaceName: currentWorkspace.name, container, onComplete: () => ui.members?.refresh()});
  };
  const footer = el('div', 'data-desktop-footer');
  const switcher = el('button', 'data-desktop-switcher');
  switcher.type = 'button';
  switcher.setAttribute('aria-label', 'Espace local et réglages');
  switcher.setAttribute('aria-haspopup', 'menu');
  switcher.setAttribute('aria-expanded', 'false');
  switcher.append(el('span', 'data-desktop-avatar', workspaceGlyph(currentWorkspace)), el('span', 'data-desktop-switcher-name', 'Espace local'), chevron());
  footer.append(switcher);

  const menu = el('div', 'data-desktop-footer-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const account = currentWorkspace.kind === 'remote' ? el('div', 'data-desktop-menu-account') : el('button', 'data-desktop-menu-account');
  if (account instanceof HTMLButtonElement) { account.type = 'button'; account.setAttribute('role', 'menuitem'); }
  account.append(el('span', 'data-desktop-menu-avatar', workspaceGlyph(currentWorkspace)));
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
    choice.replaceChildren(el('span', 'data-desktop-workspace-avatar', workspaceGlyph(ref)), label);
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
    for (const ref of all.filter((item) => item.kind === 'local')) addChoice(ref, group);
    const addLocal = actionButton('data-desktop-menu-new-workspace', 'Créer un espace local', 'storage');
    addLocal.setAttribute('data-desktop-menu-item', ''); addLocal.setAttribute('role', 'menuitem');
    addLocal.addEventListener('click', () => {
      closeMenu();
      openLocalWorkspaceDialog((name) => {
        footer.dispatchEvent(new CustomEvent('blok:desktop-select-workspace', {bubbles: true, detail: createLocalWorkspace(name)}));
      });
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
  nav.setAttribute('aria-label', 'Rubriques des réglages');
  const search = el('input', 'data-desktop-settings-search');
  search.type = 'search'; search.placeholder = 'Rechercher…';
  search.setAttribute('aria-label', 'Rechercher dans les réglages');
  const searchBox = wrapSearchField(search);
  const navList = el('div', 'data-desktop-settings-nav-list');
  const noResults = el('p', 'data-desktop-settings-no-results', 'Aucune rubrique trouvée.');
  noResults.hidden = true; noResults.setAttribute('role', 'status');
  nav.append(searchBox, navList, noResults);
  navList.append(el('div', 'data-desktop-settings-nav-heading', 'Compte'));
  const accountTab = actionButton('data-desktop-settings-nav-item', currentWorkspace.kind === 'remote' ? currentWorkspace.userName ?? 'Mon compte' : 'Profil local', 'profile');
  const connectionsTab = actionButton('data-desktop-settings-nav-item', 'Connexions', 'connections');
  navList.append(accountTab);
  navList.append(connectionsTab);
  const prefsTab = actionButton('data-desktop-settings-nav-item', 'Préférences', 'settings');
  const aiTab = actionButton('data-desktop-settings-nav-item', 'Assistant IA', 'ai');
  navList.append(prefsTab);
  const mcpTab = actionButton('data-desktop-settings-nav-item', 'MCP', 'connections');
  const generalTab = actionButton('data-desktop-settings-nav-item', 'Général', 'storage');
  const emojiTab = actionButton('data-desktop-settings-nav-item', 'Émojis', 'emoji');
  const teamspacesTab = actionButton('data-desktop-settings-nav-item', 'Espaces d’équipe', 'storage');
  const membersTab = actionButton('data-desktop-settings-nav-item', 'Membres', 'profile');
  navList.append(el('div', 'data-desktop-settings-nav-heading', 'Workspace'), generalTab, emojiTab);
  if (admin) navList.append(membersTab);
  if (client) navList.append(teamspacesTab);
  navList.append(el('div', 'data-desktop-settings-nav-heading', 'Fonctionnalités'), aiTab);
  if (client) navList.append(mcpTab);
  const navEntries: Array<[HTMLButtonElement, string]> = [
    [accountTab, 'compte profil identité email'], [connectionsTab, client ? 'connexion compte serveur espace' : 'connexion mcp jeton compte serveur espace'],
    ...(client ? [[mcpTab, 'mcp jeton accès outils'] as [HTMLButtonElement, string]] : []),
    [prefsTab, 'préférences apparence thème clair sombre'], [aiTab, 'assistant ia openai modèle clé api'],
    ...(client ? [[teamspacesTab, 'équipe teamspace membres accès workspace'] as [HTMLButtonElement,string]] : []),
    [generalTab, 'général workspace espace nom stockage'], [emojiTab, 'émoji emoji image icône logo'], [membersTab, 'membres invitations accès rôles'],
  ];
  type SettingsPanel =
    | 'teamspaces' | 'account' | 'preferences' | 'ai' | 'mcp' | 'general' | 'members' | 'emojis' | 'connections'
    | 'instance-general' | 'instance-access' | 'instance-accounts' | 'instance-workspaces' | 'instance-health';
  const panelTabs = new Map<SettingsPanel, HTMLButtonElement>([
    ['teamspaces',teamspacesTab], ['mcp', mcpTab], ['account', accountTab], ['connections', connectionsTab], ['preferences', prefsTab], ['ai', aiTab],
    ['general', generalTab], ['emojis', emojiTab], ['members', membersTab],
  ]);
  const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const headingHasVisibleItem = (heading: HTMLElement): boolean => {
    const walk = { sibling: heading.nextElementSibling };
    while (walk.sibling && !walk.sibling.hasAttribute('data-desktop-settings-nav-heading')) {
      if (walk.sibling instanceof HTMLButtonElement && !walk.sibling.hidden) return true;
      walk.sibling = walk.sibling.nextElementSibling;
    }
    return false;
  };
  const filterNav = (): void => {
    const query = normalize(search.value.trim());
    for (const [button, keywords] of navEntries) button.hidden = !normalize(`${button.textContent} ${keywords}`).includes(query);
    for (const heading of navList.querySelectorAll<HTMLElement>('[data-desktop-settings-nav-heading]')) {
      heading.hidden = !headingHasVisibleItem(heading);
    }
    noResults.hidden = Boolean(navList.querySelector('[data-desktop-settings-nav-item]:not([hidden])'));
  };
  if (client) {
    void client.session().then((session) => {
      if (!session.user.instanceAdmin) return;
      const instanceHeading = el('div', 'data-desktop-settings-nav-heading', 'Serveur');
      const instanceGeneralTab = actionButton('data-desktop-settings-nav-item', 'Général', 'storage');
      const instanceAccessTab = actionButton('data-desktop-settings-nav-item', 'Accès', 'settings');
      const instanceAccountsTab = actionButton('data-desktop-settings-nav-item', 'Comptes', 'profile');
      const instanceWorkspacesTab = actionButton('data-desktop-settings-nav-item', 'Workspaces', 'storage');
      const instanceHealthTab = actionButton('data-desktop-settings-nav-item', 'Santé et e-mail', 'connections');
      for (const tab of [instanceGeneralTab, instanceAccessTab, instanceAccountsTab, instanceWorkspacesTab, instanceHealthTab]) {
        tab.setAttribute('data-instance-panel', '');
      }
      navList.append(instanceHeading, instanceGeneralTab, instanceAccessTab, instanceAccountsTab, instanceWorkspacesTab, instanceHealthTab);
      panelTabs.set('instance-general', instanceGeneralTab);
      panelTabs.set('instance-access', instanceAccessTab);
      panelTabs.set('instance-accounts', instanceAccountsTab);
      panelTabs.set('instance-workspaces', instanceWorkspacesTab);
      panelTabs.set('instance-health', instanceHealthTab);
      navEntries.push(
        [instanceGeneralTab, 'instance général nom adresse versions'],
        [instanceAccessTab, 'instance accès inscription signup politique espaces'],
        [instanceAccountsTab, 'instance comptes utilisateurs administrateurs'],
        [instanceWorkspacesTab, 'instance espaces workspaces métadonnées'],
        [instanceHealthTab, 'instance santé email smtp test livraison'],
      );
      instanceGeneralTab.addEventListener('click', () => showPanel('instance-general'));
      instanceAccessTab.addEventListener('click', () => showPanel('instance-access'));
      instanceAccountsTab.addEventListener('click', () => showPanel('instance-accounts'));
      instanceWorkspacesTab.addEventListener('click', () => showPanel('instance-workspaces'));
      instanceHealthTab.addEventListener('click', () => showPanel('instance-health'));
      filterNav();
    }).catch(() => { /* Session unavailable: no Instance rubrique. */ });
  }
  search.addEventListener('input', filterNav);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); navList.querySelector<HTMLButtonElement>('button:not([hidden])')?.click(); }
  });
  if (reactGrabAvailable) {
    const feedback = el('div', 'data-desktop-settings-feedback');
    feedback.setAttribute('data-react-grab-ignore', '');
    const grab = actionButton('data-desktop-settings-grab', 'Sélectionner un élément', 'connections');
    const hint = el('small', 'data-desktop-settings-grab-hint', 'React Grab · ⌘/Ctrl + ⇧ + G');
    grab.addEventListener('click', () => {
      grab.disabled = true;
      void loadReactGrab().then((api) => { api.activate(); hint.textContent = 'Sélectionnez un élément, puis collez-le dans le chat.'; })
        .catch(() => { hint.textContent = 'Chargement impossible. Réessayez.'; }).finally(() => { grab.disabled = false; });
    });
    feedback.append(grab, hint); nav.append(feedback);
  }
  const main = el('main', 'data-desktop-settings-main');
  const close = el('button', 'data-desktop-settings-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer les réglages');
  main.append(close);
  dialog.append(nav, main);
  overlay.append(dialog);
  document.body.append(overlay);

  if (native && currentWorkspace.kind === 'local') void dataDirectory().then((value) => {
    ui.directory = value;
    const path = overlay.querySelector('[data-desktop-settings-path]');
    if (path) path.textContent = value;
  }).catch(() => { ui.directory = 'Indisponible'; });

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

  const closeSettings = (): void => { ui.modal?.close(); };
  close.addEventListener('click', closeSettings);

  const updateWorkspaceName = (next: string): void => {
    currentWorkspace.name = next;
    rememberWorkspace(currentWorkspace);
    if (currentWorkspace.kind === 'local' && currentWorkspace.id === 'default') {
      localStorage.setItem('blok:desktop:profile-name', next);
    }
    const switcherName = switcher.querySelector('[data-desktop-switcher-name]');
    if (switcherName) switcherName.textContent = next;
    const accountTitle = account.querySelector('[data-desktop-menu-title]');
    if (accountTitle) accountTitle.textContent = next;
    const switcherAvatar = switcher.querySelector('[data-desktop-avatar]');
    if (switcherAvatar) switcherAvatar.textContent = workspaceGlyph(currentWorkspace);
    const avatar = account.querySelector('[data-desktop-menu-avatar]');
    if (avatar) avatar.textContent = workspaceGlyph(currentWorkspace);
    const choice = menu.querySelector('[data-desktop-menu-workspace][aria-current="true"]');
    const label = choice?.querySelector('[data-desktop-menu-workspace-name]');
    if (label) label.textContent = next;
    const choiceAvatar = choice?.querySelector('[data-desktop-workspace-avatar]');
    if (choiceAvatar) choiceAvatar.textContent = workspaceGlyph(currentWorkspace);
    footer.dispatchEvent(new CustomEvent('blok:desktop-workspace-renamed', {bubbles: true, detail: {key: workspaceKey(currentWorkspace), name: next}}));
  };

  const showPanel = (panel: SettingsPanel): void => {
    for (const [name, tab] of panelTabs) {
      tab.setAttribute('aria-current', panel === name ? 'page' : 'false');
    }
    ui.members?.destroy(); ui.members = null;
    ui.instancePanel?.destroy(); ui.instancePanel = null;
    ui.choices.splice(0).forEach((choice) => choice.destroy());
    ++ui.panelGeneration;
    main.querySelector('[data-desktop-settings-content]')?.remove();
    const content = el('div', 'data-desktop-settings-content');
    const panelSource = settingsPanelSource(panel);
    content.dataset.settingsSource = `desktop/src/${panelSource}`;
    nav.dataset.settingsSource = 'desktop/src/settings.ts';
    if (panel.startsWith('instance-') && client) {
      const kind = panel.slice('instance-'.length) as InstancePanel;
      content.dataset.settingsSource = 'desktop/src/instance/instance-settings.ts';
      main.append(content);
      ui.instancePanel = mountInstanceSettings(content, kind, {
        client,
        dialog,
        publicUrl: currentWorkspace.kind === 'remote' ? currentWorkspace.server : '',
        coreVersion: CORE_VERSION,
        appVersion: APP_VERSION,
      });
      return;
    }
    if (panel === 'teamspaces' && client && currentWorkspace.kind === 'remote') {
      ui.choices.push(mountTeamspaceSettings(content, {
        api:teamspaceClient(client,currentWorkspace.workspaceId), canCreate:admin, initialId:ui.teamspaceId,
        onChanged:()=>footer.dispatchEvent(new CustomEvent('blok:desktop-teamspaces-changed',{bubbles:true})),
      }));
      ui.teamspaceId=undefined;
      main.append(content);
      return;
    }
    if (panel === 'mcp' && client) {
      main.append(content);
      mountMcpSettings(content, client);
      return;
    }
    if (panel === 'connections') {
      content.append(el('h1', 'data-desktop-settings-title', 'Connexions'), el('p', 'data-desktop-settings-intro', 'Gérez vos comptes et connectez vos outils à Blok.'));
      const accounts = el('section', 'data-desktop-connections-accounts');
      const labels = el('div', 'data-desktop-settings-row-labels');
      labels.append(el('strong', 'data-desktop-settings-row-title', 'Comptes et espaces'), el('span', 'data-desktop-settings-row-help', 'Ouvrez un autre espace ou connectez-vous avec une autre adresse.'));
      const manage = actionButton('data-desktop-settings-copy', client ? 'Gérer les comptes' : 'Se connecter', 'profile');
      manage.addEventListener('click', () => { closeSettings(); emitCloud('account'); });
      accounts.append(labels, manage); content.append(accounts);
      main.append(content);
      return;
    }
    if (panel === 'emojis') {
      content.append(el('h1', 'data-desktop-settings-title', 'Émojis'));
      ui.choices.push(mountCustomEmojiSettings(content, currentWorkspace));
      main.append(content);
      return;
    }
    if (panel === 'members' && admin && client && currentWorkspace.kind === 'remote') {
      content.append(el('h1', 'data-desktop-settings-title', 'Membres'));
      main.append(content);
      ui.members = mountWorkspaceMembers(content, {client, slug: currentWorkspace.workspaceId, onInvite: () => openInvitation(dialog)});
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
      roleRow.append(el('strong', 'data-desktop-settings-row-title', 'Rôle'), el('span', 'data-desktop-settings-row-value', WORKSPACE_ROLES[currentWorkspace.role ?? 'member']));
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
        updateWorkspaceName(next);
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
      theme.element.setAttribute('data-desktop-settings-theme', ''); ui.choices.push(theme);
      row.append(labels, theme.element);
      content.append(row);
      if (native && currentWorkspace.kind === 'local') {
        const advanced = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'Avancé';
        advanced.append(summary, el('code', 'data-desktop-settings-path', ui.directory));
        const copy = el('button', 'data-desktop-settings-copy', 'Copier le chemin des données'); copy.type = 'button';
        copy.addEventListener('click', () => { void navigator.clipboard.writeText(ui.directory).then(() => { copy.textContent = 'Chemin copié'; }); });
        advanced.append(copy); content.append(advanced);
      }
    } else if (panel === 'ai') {
      ui.choices.push(mountAiSettings(content, currentWorkspace));
    } else if (panel === 'general') {
      content.append(el('h1', 'data-desktop-settings-title', 'Général'), el('p', 'data-desktop-settings-intro', 'Personnalisez le nom et l’icône de votre espace.'));
      content.append(el('h2', 'data-desktop-settings-section', 'Identité de l’espace'));
      const nameRow = el('div', 'data-desktop-settings-row');
      nameRow.setAttribute('data-desktop-settings-field', '');
      nameRow.append(el('strong', 'data-desktop-settings-row-title', 'Nom du Workspace'));
      nameRow.append(el('p', 'data-desktop-settings-row-help', 'Un nom reconnaissable pour retrouver cet espace. Jusqu’à 120 caractères.'));
      if (currentWorkspace.kind === 'local' || admin) {
        const form = document.createElement('form');
        form.setAttribute('data-desktop-workspace-rename', '');
        const name = el('input', 'data-desktop-settings-name');
        name.type = 'text'; name.required = true; name.maxLength = 240;
        name.value = currentWorkspace.name;
        name.setAttribute('aria-label', 'Nom du Workspace');
        styleTextField(name);
        const save = el('button', 'data-desktop-settings-copy', 'Enregistrer');
        save.type = 'submit';
        const status = el('p', 'data-desktop-settings-row-help');
        status.setAttribute('role', 'status');
        form.append(name, save, status);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (save.disabled) return;
          const next = name.value.trim();
          if (!next || [...next].length > 120) {
            status.textContent = 'Le nom doit contenir entre 1 et 120 caractères.';
            name.focus();
            return;
          }
          save.disabled = true; name.disabled = true;
          status.textContent = 'Enregistrement…';
          const renamed = currentWorkspace.kind === 'remote' && client
            ? client.renameWorkspace(currentWorkspace.workspaceId, next).then((workspace) => workspace.name)
            : Promise.resolve(next);
          void renamed.then((saved) => {
            updateWorkspaceName(saved);
            name.value = saved;
            status.textContent = 'Nom du Workspace enregistré.';
          }).catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message : 'Le renommage a échoué. Réessayez.';
          }).finally(() => { save.disabled = false; name.disabled = false; });
        });
        nameRow.append(form);
      } else nameRow.append(el('span', 'data-desktop-settings-row-value', currentWorkspace.name));
      content.append(nameRow);
      ui.choices.push(mountWorkspaceIcon(content, currentWorkspace, client, () => {
        for (const selector of ['[data-desktop-avatar]', '[data-desktop-menu-avatar]', '[data-desktop-menu-workspace][aria-current="true"] [data-desktop-workspace-avatar]']) {
          const glyph=footer.querySelector(selector);if(glyph)glyph.textContent=workspaceGlyph(currentWorkspace);
        }
        footer.dispatchEvent(new CustomEvent('blok:desktop-workspace-renamed', {bubbles:true,detail:{key:workspaceKey(currentWorkspace),name:currentWorkspace.name,icon:currentWorkspace.icon ?? null}}));
      }));
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
  mcpTab.addEventListener('click', () => showPanel('mcp'));
  teamspacesTab.addEventListener('click', () => {ui.teamspaceId=undefined;showPanel('teamspaces');});
  generalTab.addEventListener('click', () => showPanel('general'));
  emojiTab.addEventListener('click', () => showPanel('emojis'));
  connectionsTab.addEventListener('click', () => showPanel('connections'));
  membersTab.addEventListener('click', () => { if (admin) showPanel('members'); });
  const openSettings = (panel: SettingsPanel): void => {
    closeMenu();
    search.value = ''; filterNav();
    showPanel(panel);
    switcher.focus();
    overlay.hidden = false;
    ui.modal = openModalDialog({
      content: overlay, surface: dialog, label: 'Paramètres', initialFocus: () => dialog,
      onDismiss: (reason) => {
        if (ui.choices.some(choice => choice.dismiss?.())) return;
        if (reason === 'escape' && document.activeElement === search && search.value) { search.value = ''; filterNav(); return; }
        closeSettings();
      },
      onClose: () => {
        overlay.hidden = true; ++ui.panelGeneration;
        ui.choices.splice(0).forEach((choice) => choice.destroy());
        ui.members?.destroy(); ui.members = null;
        ui.instancePanel?.destroy(); ui.instancePanel = null;
        ui.modal = null;
      },
    });
  };
  footer.addEventListener('blok:desktop-open-ai-settings', () => openSettings('ai'));
  footer.addEventListener('blok:desktop-open-settings', (event) => {
    const section = (event as CustomEvent<string>).detail;
    if (section === 'invites' && admin) { closeMenu(); openInvitation(); }
    else if (section === 'members' && admin) openSettings('members');
    else openSettings('general');
  });
  preferences.addEventListener('click', () => openSettings('preferences'));
  if (account instanceof HTMLButtonElement) account.addEventListener('click', () => openSettings('account'));
  const profileName = currentWorkspace.kind === 'local' && currentWorkspace.id === 'default' ? localStorage.getItem('blok:desktop:profile-name') : currentWorkspace.name;
  if (profileName) {
    const switcherName = switcher.querySelector('[data-desktop-switcher-name]');
    if (switcherName) switcherName.textContent = profileName;
    const accountTitle = account.querySelector('[data-desktop-menu-title]');
    if (accountTitle) accountTitle.textContent = profileName;
  }
  if (currentWorkspace.kind === 'remote') {
    const accountSubtitle = account.querySelector('[data-desktop-menu-subtitle]');
    if (accountSubtitle) accountSubtitle.textContent = currentWorkspace.userName ?? 'Compte en ligne';
    switcher.setAttribute('aria-label', 'Workspaces et réglages');
  }
  footer.addEventListener('blok:desktop-open-teamspace',(event)=>{
    if(!client)return;
    ui.teamspaceId=(event as CustomEvent<{id?:string}>).detail?.id;
    openSettings('teamspaces');
  });
  const pendingSettings = sessionStorage.getItem('blok:desktop:pending-settings');
  if (pendingSettings) {
    sessionStorage.removeItem('blok:desktop:pending-settings');
    queueMicrotask(() => {
      footer.dispatchEvent(new CustomEvent('blok:desktop-open-settings', {detail: pendingSettings}));
    });
  }
  return footer;
}
