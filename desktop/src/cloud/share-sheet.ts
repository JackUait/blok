import type { CloudClient } from './client';
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
export interface ShareSheetOptions { client: CloudClient; slug: string; pageId: string; pageTitle: string }
export interface ShareSheetHandle { destroy(): void; refresh(): Promise<void> }

const levelNames: Record<PageLevel, string> = { view: 'Peut voir', edit: 'Peut modifier', full: 'Accès complet' };
const visibilityNames: Record<PageAccessSheet['visibility'], string> = {
  private: 'Privée — seules les personnes invitées y accèdent',
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
  const list = el('div', undefined, 'data-cloud-share-list');
  const error = el('p', undefined, 'data-cloud-share-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  panel.append(visibility, list, error);
  container.append(panel);

  const state: { alive: boolean; sheet: PageAccessSheet | null } = { alive: true, sheet: null };
  const controls: ChoiceControl<PageLevel>[] = [];
  const dispose = (): void => { for (const control of controls) control.destroy(); controls.length = 0; };

  function fail(cause: unknown): void {
    error.textContent = cause instanceof Error ? cause.message : 'La demande n’a pas pu aboutir. Réessayez.';
    error.hidden = false;
  }

  async function change(userId: string, level: PageLevel): Promise<void> {
    error.hidden = true;
    try {
      await options.client.request(`${base}/shares/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify({ level }) });
      await refresh();
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
    } catch (cause) {
      fail(cause);
    }
  }

  function row(entry: PageShareEntry, governs: boolean): HTMLElement {
    const node = el('div', undefined, 'data-cloud-share-row');
    node.append(el('span', entry.email, 'data-cloud-share-email'));
    if (entry.from !== undefined) {
      node.setAttribute('data-cloud-share-inherited', '');
      // Nommer la page d'origine est ce qui explique pourquoi ce droit ne se
      // retire pas ici.
      node.append(el('span', `${levelNames[entry.level]} · hérité de « ${entry.from} »`, 'data-cloud-share-origin'));
      return node;
    }
    const control = createChoice<PageLevel>({
      label: `Niveau d’accès de ${entry.email}`,
      value: entry.level,
      options: (['view', 'edit', 'full'] as PageLevel[]).map((value) => ({ value, label: levelNames[value] })),
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
    visibility.textContent = visibilityNames[sheet.visibility === 'inherit' ? sheet.effectiveVisibility : sheet.visibility];
    const rows = [...sheet.shares.map((entry) => row(entry, governs)), ...sheet.inherited.map((entry) => row(entry, false))];
    list.replaceChildren(...rows);
  }

  async function refresh(): Promise<void> {
    try {
      const value = await options.client.request<PageAccessSheet>(`${base}/access`);
      if (!state.alive) return;
      state.sheet = value;
      render();
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
