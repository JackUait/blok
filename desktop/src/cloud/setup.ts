import { button, el, field } from '../ui/dom';
import type { CloudClient } from './client';

/**
 * Derive a workspace slug from a display name. Used by the create-workspace
 * screen; the assistant no longer asks for one — the server derives the first
 * space from the administrator's address, Notion-style.
 */
export function deriveWorkspaceSlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (!base) return 'espace';
  if (base.length === 1) return `${base}0`;
  return base;
}


export interface SetupAssistantOptions {
  client: CloudClient;
  /** Called after a successful claim with the admin email (for login(code)). */
  onClaimed(email: string): void;
  /** Frame the setup route and return its main element. */
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  hostPreview?: string;
}

export interface SetupDraft {
  adminName: string;
  email: string;
}

/**
 * One-screen first-run assistant: your name and your address, nothing else.
 *
 * AFFiNE's /admin/setup asks for a name, an address and a password; Notion asks
 * for an address. Everything we used to ask on top of that — the instance name,
 * the first space, who may sign up, who may create a space — has a sensible
 * default and a settings page. Asking for them here is asking someone to decide
 * before they have seen anything.
 *
 * Claim posts `{email,name}`. The server names the instance Blok, derives the
 * first space from the address, and starts invite-only with space creation
 * reserved to instance administrators.
 */
export function mountSetupAssistant(options: SetupAssistantOptions): void {
  const draft: SetupDraft = { adminName: '', email: '' };

  const main = options.frame();
  main.setAttribute('data-cloud-narrow', '');
  main.setAttribute('data-cloud-setup-step', '1');
  main.append(
    el('h1', { text: 'Bienvenue sur Blok' }),
    el('p', {
      text: 'Créez votre compte administrateur. Cette adresse recevra un code de connexion — Blok n’a pas de mot de passe.',
      attribute: 'data-cloud-muted',
    }),
  );

  const form = el('form', { attribute: 'data-cloud-stack' });
  const adminName = field({ form, label: 'Votre nom', type: 'text', name: 'admin-name', value: draft.adminName });
  adminName.maxLength = 120;
  const email = field({ form, label: 'Adresse e-mail', type: 'email', name: 'admin-email', value: draft.email });
  email.autocomplete = 'email';

  const status = el('p', { attribute: 'data-cloud-note' });
  status.setAttribute('role', 'status');
  status.hidden = true;

  const finish = button({ label: 'Créer l’instance', primary: true, block: true, type: 'submit', onClick: () => {} });
  const verify = button({
    label: 'Vérifier l’envoi',
    attribute: 'data-cloud-link',
    inline: true,
    onClick: () => {
      void options.run(async () => {
        sync();
        status.hidden = true;
        await options.client.request('/api/setup/email-test', {
          method: 'POST',
          body: JSON.stringify({ email: draft.email }),
        });
        status.textContent = `Un e-mail de test a été envoyé à ${draft.email}.`;
        status.hidden = false;
      });
    },
  });

  function sync(): void {
    draft.adminName = adminName.value.trim();
    draft.email = email.value.trim();
    const ready = Boolean(draft.adminName && draft.email.includes('@'));
    finish.disabled = !ready;
    verify.disabled = !ready;
  }
  sync();
  form.append(verify, finish);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sync();
    if (finish.disabled) return;
    void options.run(async () => {
      await options.client.request('/api/setup/claim', {
        method: 'POST',
        body: JSON.stringify({ email: draft.email, name: draft.adminName }),
      });
      options.onClaimed(draft.email);
    });
  });
  adminName.addEventListener('input', sync);
  email.addEventListener('input', sync);

  main.append(form, status);
  // Say what the defaults are, so nothing feels decided behind the user's back.
  main.append(el('p', {
    text: 'Votre espace et le nom de l’instance seront créés automatiquement, et l’inscription démarre sur invitation. Tout se change dans Réglages → Instance.',
    attribute: 'data-cloud-setup-note',
  }));
}
