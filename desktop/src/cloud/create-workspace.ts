import { WORKSPACE_CREATION_POLICIES } from '../access-vocabulary';
import { button, el, field } from '../ui/dom';
import type { CloudClient, CloudInstance, CloudWorkspaceCreation } from './client';
import { deriveWorkspaceSlug } from './setup';

export interface CreateWorkspaceOptions {
  client: CloudClient;
  instance: CloudInstance | null;
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  onCreated(): void | Promise<void>;
  onCancel(): void;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Dedicated create-workspace form (POST /api/workspaces). */
export function mountCreateWorkspace(options: CreateWorkspaceOptions): void {
  const main = options.frame();
  main.setAttribute('data-cloud-narrow', '');
  main.append(
    el('span', { text: 'Nouvel espace', attribute: 'data-cloud-eyebrow' }),
    el('h1', { text: 'Créer un espace de travail' }),
    el('p', {
      text: 'Chaque espace a ses propres pages, membres et réglages.',
      attribute: 'data-cloud-muted',
    }),
  );

  const policy = (options.instance?.workspaceCreation ?? 'anyone') as CloudWorkspaceCreation;
  if (policy === 'disabled') {
    main.append(el('div', {
      attribute: 'data-cloud-status',
      children: [
        el('strong', { text: 'La création d’espaces est désactivée' }),
        el('p', { text: WORKSPACE_CREATION_POLICIES.disabled.consequence }),
      ],
    }));
    main.append(button({ label: 'Retour aux espaces', onClick: options.onCancel }));
    return;
  }
  if (policy === 'admins_only') {
    main.append(el('p', {
      text: WORKSPACE_CREATION_POLICIES.admins_only.consequence,
      attribute: 'data-cloud-note',
    }));
  }

  const form = el('form');
  const name = field({ form, label: 'Nom de l’espace', type: 'text', name: 'workspace-name' });
  name.maxLength = 120;
  const slug = field({ form, label: 'Identifiant de l’espace', type: 'text', name: 'workspace-slug' });
  slug.pattern = '[a-z0-9][a-z0-9-]{1,62}';
  slug.minLength = 2;
  slug.maxLength = 63;
  slug.placeholder = 'mon-equipe';
  let slugTouched = false;
  name.addEventListener('input', () => {
    if (slugTouched) return;
    slug.value = deriveWorkspaceSlug(name.value.trim());
  });
  slug.addEventListener('input', () => { slugTouched = true; });

  const submit = button({ label: 'Créer l’espace', primary: true, type: 'submit', onClick: () => {} });
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void options.run(async () => {
      const workspaceName = name.value.trim();
      const workspaceSlug = slug.value.trim();
      if (!workspaceName || !SLUG_PATTERN.test(workspaceSlug)) {
        throw new Error('Choisissez un nom et un identifiant valides (lettres minuscules, chiffres et tirets).');
      }
      await options.client.request('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName, slug: workspaceSlug }),
      });
      await options.onCreated();
    });
  });
  main.append(form);
  main.append(button({ label: 'Retour', onClick: options.onCancel }));
}
