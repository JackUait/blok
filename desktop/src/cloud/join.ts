import { button, el, field } from '../ui/dom';
import type { CloudClient } from './client';

export interface JoinWorkspaceOptions {
  client: CloudClient;
  /** Prefill when the instance has a default workspace. */
  defaultSlug?: string;
  defaultName?: string;
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  onJoined(): void | Promise<void>;
  onCancel(): void;
}

/** Ask to join a workspace via POST /api/workspaces/:slug/join-requests. */
export function mountJoinWorkspace(options: JoinWorkspaceOptions): void {
  const main = options.frame();
  main.setAttribute('data-cloud-narrow', '');
  main.append(
    el('span', { text: 'Rejoindre', attribute: 'data-cloud-eyebrow' }),
    el('h1', { text: 'Rejoindre un espace' }),
    el('p', {
      text: 'Un administrateur validera votre demande avant que vous puissiez ouvrir l’espace.',
      attribute: 'data-cloud-muted',
    }),
  );

  if (options.defaultName) {
    main.append(el('p', {
      text: `Espace proposé : ${options.defaultName} (${options.defaultSlug}).`,
      attribute: 'data-cloud-note',
    }));
  }

  const form = el('form');
  const slug = field({
    form,
    label: 'Identifiant de l’espace',
    type: 'text',
    name: 'join-slug',
    value: options.defaultSlug ?? '',
  });
  slug.pattern = '[a-z0-9][a-z0-9-]{1,62}';
  slug.minLength = 2;
  slug.maxLength = 63;
  slug.placeholder = 'mon-equipe';
  const message = field({
    form,
    label: 'Un mot pour l’équipe (facultatif)',
    type: 'text',
    name: 'join-message',
    required: false,
  });
  message.maxLength = 1000;

  const statusBox = el('div', { attribute: 'data-cloud-status' });
  statusBox.hidden = true;

  const submit = button({ label: 'Demander à rejoindre', primary: true, type: 'submit', onClick: () => {} });
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void options.run(async () => {
      const value = slug.value.trim();
      if (!value) throw new Error('Saisissez l’identifiant de l’espace.');
      const workspace = await options.client.workspace(value);
      if (workspace.role) {
        statusBox.replaceChildren(
          el('strong', { text: `Vous êtes déjà membre de ${workspace.name}` }),
          el('p', { text: 'Retournez à la liste pour l’ouvrir.' }),
        );
        statusBox.hidden = false;
        return;
      }
      if (workspace.joinStatus === 'pending') {
        statusBox.replaceChildren(
          el('strong', { text: 'Votre demande est en attente' }),
          el('p', { text: 'Un administrateur doit valider votre accès.' }),
        );
        statusBox.hidden = false;
        return;
      }
      if (workspace.joinStatus === 'rejected') {
        statusBox.replaceChildren(
          el('strong', { text: 'Votre demande n’a pas été acceptée' }),
          el('p', { text: 'Contactez un administrateur de cet espace pour en savoir plus.' }),
        );
        statusBox.hidden = false;
        return;
      }
      await options.client.request(`/api/workspaces/${encodeURIComponent(value)}/join-requests`, {
        method: 'POST',
        body: JSON.stringify({ message: message.value.trim() }),
      });
      await options.onJoined();
    });
  });

  main.append(form, statusBox);
  main.append(button({ label: 'Retour', onClick: options.onCancel }));
}
