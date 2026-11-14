import type { CloudClient } from './client';
import { PAGE_LEVELS, PAGE_RIGHTS_CUMULATIVE, pageLevelOptions } from '../access-vocabulary';
import { createChoice, type ChoiceControl } from '../ui/controls';
import type { PageLevel } from '../page-access';

export interface PageShareEntry { userId: string; email: string; level: PageLevel; from?: string }
export interface PageAccessSheet {
  visibility: 'inherit' | 'private' | 'workspace';
  effectiveVisibility: 'inherit' | 'private' | 'workspace';
  myLevel: PageLevel;
  shares: PageShareEntry[];
  inherited: PageShareEntry[];
}
export interface ShareSheetOptions { client: CloudClient; slug: string; pageId: string; pageTitle: string; onChanged?: () => Promise<void> | void }
export interface ShareSheetHandle { destroy(): void; refresh(): Promise<void> }

const levelNames = PAGE_LEVELS;
const visibilityNames: Record<PageAccessSheet['visibility'], string> = {
  private: 'Personnes invitées uniquement',
  workspace: 'Ouverte à l’espace — tous les membres y accèdent',
  inherit: 'Héritée de la page parente',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attribute?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (attribute) node.setAttribute(attribute, '');
  return node;
}

/**
 * La feuille d'accès d'une page. Elle sépare ce qui se décide ici de ce qui
 * vient d'un ancêtre : sans cette distinction, personne ne comprend d'où vient
 * un droit, ni pourquoi il ne peut pas le retirer depuis la page qu'il regarde.
 */
export function mountShareSheet(container: HTMLElement, options: ShareSheetOptions): ShareSheetHandle {
  const base = `/api/workspaces/${encodeURIComponent(options.slug)}/pages/${encodeURIComponent(options.pageId)}`;
  const panel = el('div', undefined, 'data-cloud-share-sheet');
  const visibility = el('p', undefined, 'data-cloud-share-visibility');
  const invitation = el('div', undefined, 'data-cloud-share-invitation');
  const list = el('div', undefined, 'data-cloud-share-list');
  const error = el('p', undefined, 'data-cloud-share-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  panel.setAttribute('aria-busy', 'true');
  visibility.textContent = 'Chargement des accès…';
  const cumulative = el('p', PAGE_RIGHTS_CUMULATIVE, 'data-cloud-share-cumulative');
  panel.append(invitation, list, el('h3', 'Accès général', 'data-cloud-share-heading'), visibility, cumulative, error);
  container.append(panel);

  const state: { alive: boolean; sheet: PageAccessSheet | null } = { alive: true, sheet: null };
  const controls: ChoiceControl<PageLevel>[] = [];
  let people: ChoiceControl<string> | null = null;
  let members: { id: string; email: string }[] = [];
  let membersLoaded = false;
  let adding = false;
  const dispose = (): void => { people?.destroy(); people = null; for (const control of controls) control.destroy(); controls.length = 0; };

  function fail(cause: unknown): void {
    error.textContent = cause instanceof Error ? cause.message : 'La demande n’a pas pu aboutir. Réessayez.';
    error.hidden = false;
    panel.removeAttribute('aria-busy');
  }

  async function change(userId: string, level: PageLevel): Promise<void> {
    error.hidden = true;
    try {
      await options.client.request(`${base}/shares/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({ level }) });
      await refresh();
      await options.onChanged?.();
    } catch (cause) {
      fail(cause);
      // Remettre ce que le serveur dit encore, plutôt que ce que l'écran montrait.
      render();
    }
  }

  async function revoke(userId: string): Promise<void> {
    error.hidden = true;
    try {
      await options.client.request(`${base}/shares/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await refresh();
      await options.onChanged?.();
    } catch (cause) {
      fail(cause);
    }
  }

  function row(entry: PageShareEntry, governs: boolean): HTMLElement {
    const node = el('div', undefined, 'data-cloud-share-row');
    const avatar = el('span', entry.email.slice(0, 1).toLocaleUpperCase(), 'data-cloud-share-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const identity = el('div', undefined, 'data-cloud-share-identity');
    const email = el('span', entry.email, 'data-cloud-share-email');
    email.title = entry.email;
    identity.append(email);
    node.append(avatar, identity);
    if (entry.from !== undefined) {
      node.setAttribute('data-cloud-share-inherited', '');
      // Nommer la page d'origine est ce qui explique pourquoi ce droit ne se
      // retire pas ici.
      const origin = el('span', `Hérité de la page ${entry.from}`, 'data-cloud-share-origin');
      origin.title = origin.textContent ?? '';
      identity.append(origin);
      node.append(el('span', levelNames[entry.level], 'data-cloud-share-level'));
      return node;
    }
    if (!governs) { node.append(el('span', levelNames[entry.level], 'data-cloud-share-level')); return node; }
    const control = createChoice<PageLevel>({
      label: `Niveau d’accès de ${entry.email}`,
      value: entry.level,
      options: pageLevelOptions(),
      onChange: (value) => { void change(entry.userId, value); },
    });
    control.element.disabled = !governs;
    controls.push(control);
    node.append(control.element);
    const remove = el('button', 'Retirer', 'data-cloud-share-remove');
    remove.type = 'button';
    remove.disabled = !governs;
    remove.addEventListener('click', () => { void revoke(entry.userId); });
    node.append(remove);
    return node;
  }

  function render(): void {
    if (!state.sheet) return;
    dispose();
    const { sheet } = state;
    const governs = sheet.myLevel === 'full';
    invitation.replaceChildren();
    invitation.hidden = !governs;
    if (governs) renderInvitation();
    visibility.textContent = visibilityNames[sheet.visibility === 'inherit' ? sheet.effectiveVisibility : sheet.visibility];
    const rows = [...sheet.shares.map((entry) => row(entry, governs)), ...sheet.inherited.map((entry) => row(entry, false))];
    list.replaceChildren(...rows);
    if (!rows.length) list.append(el('p', 'Aucun accès individuel ajouté à cette page.', 'data-cloud-share-empty'));
    panel.removeAttribute('aria-busy');
  }

  function renderInvitation(): void {
    const existing = new Set([...(state.sheet?.shares ?? []), ...(state.sheet?.inherited ?? [])].map((entry) => entry.userId));
    const candidates = members.filter((member) => !existing.has(member.id));
    const add = el('button', 'Ajouter', 'data-cloud-share-add');
    add.type = 'button'; add.disabled = true;
    people = createChoice<string>({
      label: 'Ajouter une personne', value: '', searchable: true,
      options: [{ value: '', label: membersLoaded ? 'Nom ou e-mail d’un membre…' : 'Chargement des membres…', disabled: true },
        ...candidates.map((member) => ({ value: member.id, label: member.email }))],
      onChange: () => { add.disabled = adding; },
    });
    people.disabled = adding || !candidates.length;
    const personRow = el('div', undefined, 'data-cloud-share-person-picker');
    personRow.append(people.element, add);
    const level = createChoice<PageLevel>({ label: 'Accès à accorder', value: 'view',
      options: pageLevelOptions(), onChange() {},
    });
    level.disabled = adding;
    controls.push(level);
    const accessRow = el('div', undefined, 'data-cloud-share-invite-level');
    accessRow.append(el('span', 'Droit sur cette page'), level.element);
    const note = el('p', membersLoaded && !candidates.length ? 'Tous les membres ont déjà un accès individuel.' : 'Choisissez un membre de cet espace.', 'data-cloud-share-invite-note');
    invitation.append(personRow, accessRow, note);
    add.addEventListener('click', () => {
      const id = people?.value;
      if (!id || adding || state.sheet?.myLevel !== 'full') return;
      adding = true; add.disabled = true; people!.disabled = true; level.disabled = true;
      void change(id, level.value).finally(() => { adding = false; if (state.alive) render(); });
    });
  }

  async function refresh(): Promise<void> {
    try {
      const value = await options.client.request<PageAccessSheet>(`${base}/access`);
      if (!state.alive) return;
      state.sheet = value;
      render();
      if (value.myLevel === 'full' && !membersLoaded) {
        try {
          const result = await options.client.request<{ members: { id: string; email: string }[] }>(`/api/workspaces/${encodeURIComponent(options.slug)}/members`);
          if (!state.alive) return;
          members = result.members; membersLoaded = true; render();
        } catch (cause) { if (state.alive) fail(cause); }
      }
    } catch (cause) {
      if (state.alive) fail(cause);
    }
  }

  // Une prise de test : l'enchaînement « le serveur refuse, l'écran revient à
  // ce qu'il affichait » ne se pilote pas depuis un popover en jsdom.
  Object.assign(panel, { testChange: change });

  void refresh();
  return {
    destroy() { state.alive = false; dispose(); panel.remove(); },
    refresh,
  };
}
