import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import { PopoverDesktop } from '@blok/popover';
import { IconPeople, IconDotsHorizontal, IconTrash } from '../../../src/components/icons';
import { MEMBERS_ROLES_INTRO, roleOptions, WORKSPACE_ROLES } from '../access-vocabulary';
import type { CloudClient, CloudRole } from './client';
import './workspace-settings.css';
import { createChoice, styleTextField, wrapSearchField, type ChoiceControl } from '../ui/controls';

export interface WorkspaceMembersOptions { client: CloudClient; slug: string; onInvite?: () => void }
export interface WorkspaceMembersHandle { destroy(): void; refresh(): Promise<void> }
export interface WorkspaceInvitationOptions {
  client: CloudClient;
  slug: string;
  workspaceName?: string;
  /** Nest inside the existing settings dialog when opened from its members panel. */
  container?: HTMLElement;
  onComplete?: () => void | Promise<void>;
}
interface Member { id: string; email: string; role: CloudRole }
interface JoinRequest { id: string; email: string; message?: string; status: string }
interface Invite { id: string; email: string; role: CloudRole; status: string }
type Tab = 'members' | 'requests' | 'invites';

const roleNames = WORKSPACE_ROLES;
const TAB_ORDER: Tab[] = ['members', 'requests', 'invites'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attribute?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (attribute) node.setAttribute(attribute, '');
  return node;
}

function action(label: string, callback: () => void, primary = false): HTMLButtonElement {
  const node = el('button', label, 'data-cloud-settings-button');
  node.type = 'button';
  node.classList.add('blok-button');
  if (primary) node.setAttribute('data-cloud-settings-primary', '');
  node.addEventListener('click', callback);
  return node;
}

function rolePicker(role: CloudRole, label: string, admin = false, onChange: (value: CloudRole) => void = () => {}): ChoiceControl<CloudRole> {
  return createChoice({ label, value: role, options: roleOptions(admin), onChange });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'La demande n’a pas pu aboutir. Réessayez.';
}

function emptyListCopy(tab: Tab, needle: string): string {
  if (needle) return 'Aucun résultat.';
  if (tab === 'members') return 'Aucun membre.';
  if (tab === 'requests') return 'Aucune demande en attente.';
  return 'Aucune invitation en attente.';
}

function tabColumnHeading(tab: Tab): string {
  if (tab === 'members') return 'Rôle';
  if (tab === 'requests') return 'Accès et décision';
  return 'Invitation';
}

function nextTab(current: Tab, key: string): Tab {
  const index = TAB_ORDER.indexOf(current);
  if (key === 'Home') return TAB_ORDER[0];
  if (key === 'End') return TAB_ORDER[2];
  const delta = key === 'ArrowRight' ? 1 : 2;
  return TAB_ORDER[(index + delta) % 3];
}

function setButtonsDisabled(panel: HTMLElement, disabled: boolean): void {
  for (const button of panel.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = disabled;
  }
}

/** Mounts into the existing settings panel; disposing never changes its parent. */
export function mountWorkspaceMembers(container: HTMLElement, options: WorkspaceMembersOptions): WorkspaceMembersHandle {
  const base = `/api/workspaces/${encodeURIComponent(options.slug)}`;
  const panel = el('div', undefined, 'data-cloud-members-panel');
  container.append(panel);
  const toolbar = el('div', undefined, 'data-cloud-members-toolbar');
  toolbar.append(el('p', MEMBERS_ROLES_INTRO, 'data-cloud-settings-muted'));
  const state = {
    alive: true,
    busy: false,
    generation: 0,
    read: undefined as AbortController | undefined,
    loaded: false,
    tab: 'members' as Tab,
    members: [] as Member[],
    requests: [] as JoinRequest[],
    invites: [] as Invite[],
  };
  const choices: ChoiceControl<CloudRole>[] = [];
  const rowMenus: Array<{ destroy(): void }> = [];

  function disposeChoices(): void {
    for (const choice of choices) choice.destroy();
    choices.length = 0;
    for (const menu of rowMenus) menu.destroy();
    rowMenus.length = 0;
  }

  const invite = action('Inviter des membres', () => {
    if (options.onInvite) options.onInvite();
    else openWorkspaceInvitation({
      client: options.client,
      slug: options.slug,
      container: container.closest<HTMLElement>('[data-desktop-settings-dialog]') ?? undefined,
      onComplete: refresh,
    });
  }, true);
  toolbar.append(invite);

  const tabs = el('div', undefined, 'data-cloud-members-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Accès à l’espace');
  const buttons = new Map<Tab, HTMLButtonElement>();
  const labels: Record<Tab, string> = { members: 'Membres', requests: 'Demandes', invites: 'Invitations' };
  const list = el('div', undefined, 'data-cloud-members-list');
  list.id = `cloud-members-${crypto.randomUUID()}`;
  list.setAttribute('role', 'tabpanel');

  for (const value of TAB_ORDER) {
    const button = action(labels[value], () => { state.tab = value; render(); });
    button.setAttribute('role', 'tab');
    button.id = `${list.id}-${value}`;
    button.setAttribute('aria-controls', list.id);
    buttons.set(value, button);
    tabs.append(button);
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      state.tab = nextTab(state.tab, event.key);
      render();
      buttons.get(state.tab)?.focus();
    });
  }

  const search = el('input', undefined, 'data-cloud-members-search');
  styleTextField(search);
  search.type = 'search';
  search.placeholder = 'Rechercher une personne…';
  search.setAttribute('aria-label', 'Rechercher parmi les accès');
  search.addEventListener('input', render);
  const error = el('p', undefined, 'data-cloud-settings-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const searchField = wrapSearchField(search);
  searchField.setAttribute('data-cloud-members-search-field', '');
  panel.append(toolbar, tabs, searchField, error, list);

  function showError(reason: unknown): void {
    if (!state.alive) return;
    error.textContent = message(reason);
    error.hidden = false;
  }

  function row(email: string, subtitle?: string): { root: HTMLElement; controls: HTMLElement } {
    const root = el('tr', undefined, 'data-cloud-member-row');
    const identityCell = el('td');
    const identity = el('div', undefined, 'data-cloud-member-identity');
    const avatar = el('span', email.charAt(0).toUpperCase(), 'data-cloud-member-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const text = el('div');
    text.append(el('strong', email));
    if (subtitle) text.append(el('p', subtitle, 'data-cloud-settings-muted'));
    identity.append(avatar, text);
    const controlsCell = el('td');
    const controls = el('div', undefined, 'data-cloud-member-actions');
    identityCell.append(identity);
    controlsCell.append(controls);
    root.append(identityCell, controlsCell);
    return { root, controls };
  }

  function memberMenu(member: Member): HTMLButtonElement {
    const trigger = action('', () => open());
    trigger.innerHTML = IconDotsHorizontal;
    trigger.setAttribute('data-cloud-member-menu', '');
    trigger.setAttribute('aria-label', `Actions pour ${member.email}`);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const menuState = { popup: null as PopoverDesktop | null, destroyed: false };
    function open(): void {
      if (trigger.disabled || menuState.destroyed) return;
      if (menuState.popup?.isShown) { menuState.popup.hide(); return; }
      const menu = new PopoverDesktop({
        trigger,
        width: 'auto',
        minWidth: '220px',
        items: [{
          name: 'remove',
          title: 'Retirer de l’espace',
          icon: IconTrash,
          isDestructive: true,
          closeOnActivate: true,
          onActivate: () => { void mutate(`/members/${encodeURIComponent(member.id)}`, 'DELETE'); },
        }],
      });
      menuState.popup = menu;
      const closed = { settled: false };
      const palette = getComputedStyle(trigger);
      for (const token of ['--blok-popover-bg', '--blok-popover-border', '--blok-text-primary', '--blok-text-secondary', '--blok-item-hover-bg']) {
        menu.getElement().style.setProperty(token, palette.getPropertyValue(token));
      }
      trigger.setAttribute('aria-expanded', 'true');
      menu.on('closed', () => {
        if (closed.settled) return;
        closed.settled = true;
        if (menuState.popup === menu) {
          menuState.popup = null;
          trigger.setAttribute('aria-expanded', 'false');
        }
        if (trigger.isConnected && !trigger.disabled && !menuState.destroyed) trigger.focus();
        queueMicrotask(() => menu.destroy());
      });
      menu.show();
      menu.focusItemByName('remove');
    }
    rowMenus.push({
      destroy() {
        menuState.destroyed = true;
        menuState.popup?.destroy();
        menuState.popup = null;
        trigger.setAttribute('aria-expanded', 'false');
      },
    });
    return trigger;
  }

  async function mutate(path: string, method: string, body?: unknown): Promise<void> {
    if (state.busy || !state.alive) return;
    state.busy = true;
    error.hidden = true;
    setButtonsDisabled(panel, true);
    for (const choice of choices) choice.disabled = true;
    try {
      await options.client.request(`${base}${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await refresh();
    } catch (reason) {
      showError(reason);
    } finally {
      state.busy = false;
      if (state.alive) setButtonsDisabled(panel, false);
      for (const choice of choices) choice.disabled = false;
    }
  }

  function rowSubtitle(item: Member | JoinRequest | Invite): string | undefined {
    if (state.tab === 'members') return undefined;
    if (state.tab === 'requests') return (item as JoinRequest).message;
    return roleNames[(item as Invite).role];
  }

  function appendMemberControls(controls: HTMLElement, member: Member): void {
    const role = rolePicker(member.role, `Rôle de ${member.email}`, true, (value) => {
      role.setValue(member.role);
      void mutate(`/members/${encodeURIComponent(member.id)}`, 'PATCH', { role: value });
    });
    choices.push(role);
    controls.append(role.element, memberMenu(member));
  }

  function appendRequestControls(controls: HTMLElement, item: JoinRequest): void {
    const role = rolePicker('member', `Accès pour ${item.email}`);
    choices.push(role);
    controls.append(
      role.element,
      action('Refuser', () => { void mutate(`/join-requests/${encodeURIComponent(item.id)}/reject`, 'POST', {}); }),
      action('Accepter', () => { void mutate(`/join-requests/${encodeURIComponent(item.id)}/approve`, 'POST', { role: role.value }); }, true),
    );
  }

  function appendInviteControls(controls: HTMLElement, item: Invite): void {
    controls.append(
      el('span', 'En attente', 'data-cloud-settings-muted'),
      action('Révoquer', () => { void mutate(`/invites/${encodeURIComponent(item.id)}`, 'DELETE'); }),
    );
  }

  function itemsForTab(pending: JoinRequest[], outstanding: Invite[]): Array<Member | JoinRequest | Invite> {
    if (state.tab === 'members') return state.members;
    if (state.tab === 'requests') return pending;
    return outstanding;
  }

  function render(): void {
    if (!state.alive) return;
    const pending = state.requests.filter((item) => item.status === 'pending');
    const outstanding = state.invites.filter((item) => item.status === 'pending');
    const counts = { members: state.members.length, requests: pending.length, invites: outstanding.length };
    for (const [value, button] of buttons) {
      button.replaceChildren(document.createTextNode(labels[value]));
      if (state.loaded) {
        const count = el('span', String(counts[value]), 'data-cloud-members-count');
        button.append(document.createTextNode(' '), count);
      }
      button.setAttribute('aria-selected', String(value === state.tab));
      button.tabIndex = value === state.tab ? 0 : -1;
    }
    const activeTab = buttons.get(state.tab);
    if (activeTab) list.setAttribute('aria-labelledby', activeTab.id);
    disposeChoices();
    list.replaceChildren();
    const needle = search.value.trim().toLocaleLowerCase();
    const shown = itemsForTab(pending, outstanding).filter((item) => item.email.toLocaleLowerCase().includes(needle));
    if (!shown.length) {
      list.append(el('p', emptyListCopy(state.tab, needle), 'data-cloud-members-empty'));
      return;
    }
    const table = el('table', undefined, 'data-cloud-members-table');
    const head = el('thead');
    const heading = el('tr');
    heading.append(el('th', 'Utilisateur'), el('th', tabColumnHeading(state.tab)));
    head.append(heading);
    const body = el('tbody');
    table.append(head, body);
    list.append(table);
    for (const item of shown) {
      const { root, controls } = row(item.email, rowSubtitle(item));
      if (state.tab === 'members') appendMemberControls(controls, item as Member);
      else if (state.tab === 'requests') appendRequestControls(controls, item as JoinRequest);
      else appendInviteControls(controls, item as Invite);
      body.append(root);
    }
  }

  function showLoadFailure(): void {
    list.replaceChildren(
      el('p', 'Les accès ne sont pas disponibles pour le moment.', 'data-cloud-members-empty'),
      action('Réessayer', () => { void refresh(); }),
    );
  }

  async function refresh(): Promise<void> {
    if (!state.alive) return;
    error.hidden = true;
    const turn = ++state.generation;
    state.read?.abort();
    state.read = new AbortController();
    const signal = state.read.signal;
    try {
      const [m, r, i] = await Promise.all([
        options.client.request<{ members: Member[] }>(`${base}/members`, { signal }),
        options.client.request<{ requests: JoinRequest[] }>(`${base}/join-requests`, { signal }),
        options.client.request<{ invites: Invite[] }>(`${base}/invites`, { signal }),
      ]);
      if (!state.alive || turn !== state.generation) return;
      state.members = m.members;
      state.requests = r.requests;
      state.invites = i.invites;
      state.loaded = true;
      render();
    } catch (reason) {
      if (signal.aborted || !state.alive) return;
      showError(reason);
      if (!state.loaded) showLoadFailure();
    }
  }

  list.append(el('p', 'Chargement des membres…', 'data-cloud-settings-muted'));
  void refresh();
  return {
    refresh,
    destroy() {
      state.alive = false;
      ++state.generation;
      state.read?.abort();
      disposeChoices();
      panel.remove();
    },
  };
}

/** Compact editor overlay using the repository's modal/focus/Top Layer primitive. */
export function openWorkspaceInvitation(options: WorkspaceInvitationOptions): { close(): void } {
  const overlay = el('div', undefined, 'data-desktop-settings-overlay');
  overlay.setAttribute('data-cloud-invitation', '');
  const surface = el('section', undefined, 'data-cloud-invite-dialog');
  const icon = el('div', undefined, 'data-cloud-invite-icon');
  icon.innerHTML = IconPeople;
  const title = el('h2', 'Ajouter des membres');
  const intro = el(
    'p',
    options.workspaceName ? `Invitez des personnes dans ${options.workspaceName}.` : 'Invitez des personnes à rejoindre votre espace.',
    'data-cloud-settings-muted',
  );
  const form = el('form');
  const emailLabel = el('label', 'Adresses e-mail');
  const email = el('input');
  styleTextField(email);
  email.type = 'text';
  email.inputMode = 'email';
  email.autocomplete = 'email';
  email.placeholder = 'nom@entreprise.fr, autre@entreprise.fr';
  emailLabel.append(email);
  const hint = el('p', 'Séparez les adresses par une virgule.', 'data-cloud-invite-hint');
  const roleLabel = el('label', 'Accès à l’espace');
  const role = rolePicker('member', 'Accès à l’espace');
  roleLabel.append(role.element);
  const messageLabel = el('label', 'Message (facultatif)');
  const note = el('textarea');
  styleTextField(note);
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Ajoutez un mot à votre invitation…';
  messageLabel.append(note);
  const error = el('p', undefined, 'data-cloud-settings-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const status = el('p', undefined, 'data-cloud-settings-muted');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const life = { alive: true, busy: false, handle: null as ModalDialogHandle | null };
  const close = (): void => {
    if (!life.alive) return;
    life.alive = false;
    life.handle?.close();
  };
  const actions = el('div', undefined, 'data-cloud-invite-actions');
  const cancel = action('Annuler', () => close());
  const submit = action('Envoyer l’invitation', () => {}, true);
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(emailLabel, hint, roleLabel, messageLabel, error, status, actions);
  surface.append(icon, title, intro, form);
  overlay.append(surface);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (life.busy) return;
    void send();
  });

  async function send(): Promise<void> {
    const addresses = [...new Set(email.value.split(/[,;\n]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    error.hidden = true;
    if (!addresses.length || addresses.some((value) => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value))) {
      error.textContent = 'Saisissez une ou plusieurs adresses e-mail valides.';
      error.hidden = false;
      email.focus();
      return;
    }
    if (addresses.length > 25) {
      error.textContent = 'Invitez au maximum 25 personnes à la fois.';
      error.hidden = false;
      return;
    }
    life.busy = true;
    for (const control of [email, note, cancel, submit]) control.disabled = true;
    role.disabled = true;
    const failed: Array<{ email: string; reason: string }> = [];
    const progress = { sent: 0 };
    status.hidden = false;
    for (const address of addresses) {
      if (!life.alive) break;
      status.textContent = `Envoi des invitations… ${progress.sent + failed.length + 1}/${addresses.length}`;
      try {
        await options.client.request(`/api/workspaces/${encodeURIComponent(options.slug)}/invites`, {
          method: 'POST',
          body: JSON.stringify({
            email: address,
            role: role.value,
            ...(note.value.trim() ? { message: note.value.trim() } : {}),
          }),
        });
        progress.sent++;
      } catch (reason) {
        failed.push({ email: address, reason: message(reason) });
      }
    }
    if (!life.alive) return;
    life.busy = false;
    for (const control of [email, note, cancel, submit]) control.disabled = false;
    role.disabled = false;
    if (progress.sent) {
      try { await options.onComplete?.(); } catch { /* Invitations already sent: never retry a successful address. */ }
    }
    if (!life.alive) return;
    if (!failed.length) { close(); return; }
    email.value = failed.map((item) => item.email).join(', ');
    const sent = progress.sent;
    status.textContent = sent ? `${sent} invitation${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}.` : '';
    status.hidden = !sent;
    error.textContent = failed.map((item) => `${item.email} : ${item.reason}`).join('\n');
    error.hidden = false;
    email.focus();
  }

  life.handle = openModalDialog({
    content: overlay,
    surface,
    label: 'Ajouter des membres',
    initialFocus: () => email,
    container: options.container,
    onDismiss: () => { if (!life.busy) close(); },
    onClose: () => { life.alive = false; role.destroy(); },
  });
  return { close };
}
