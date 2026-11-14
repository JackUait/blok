import {
  SIGNUP_POLICIES,
  WORKSPACE_CREATION_POLICIES,
  WORKSPACE_ROLES,
  signupPolicyOptions,
  workspaceCreationOptions,
} from '../access-vocabulary';
import { button, el, field } from '../ui/dom';
import { createChoice, type ChoiceControl } from '../ui/controls';
import type { CloudClient, CloudSignupPolicy, CloudWorkspaceCreation } from './client';

const SETUP_TOKEN_CMD = 'docker compose exec app cat /data/setup-token';
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export interface SetupAssistantOptions {
  client: CloudClient;
  /** Called after a successful claim with the admin email (for login(code)). */
  onClaimed(email: string): void;
  /** Frame the setup route and return its main element. */
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  /** Prefer the live origin hostname for the slug preview. */
  hostPreview?: string;
}

export interface SetupDraft {
  token: string;
  instanceName: string;
  adminName: string;
  email: string;
  workspaceName: string;
  slug: string;
  slugTouched: boolean;
  signupPolicy: CloudSignupPolicy;
  workspaceCreation: CloudWorkspaceCreation;
}

/** Derive a workspace slug from a display name (plan §9.2 step 3). */
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

function previewHost(options: SetupAssistantOptions): string {
  if (options.hostPreview) return options.hostPreview;
  try {
    if (options.client.origin) return new URL(options.client.origin).host;
  } catch { /* fall through */ }
  try {
    return window.location.host || 'votre-serveur.fr';
  } catch {
    return 'votre-serveur.fr';
  }
}

/**
 * Four-step first-run assistant. Nothing is written until the final POST /api/setup/claim.
 *
 * Claim persists `{token,email,name,instanceName?,workspace?,signupPolicy,workspaceCreation}`.
 */
export function mountSetupAssistant(options: SetupAssistantOptions): void {
  const draft: SetupDraft = {
    token: '',
    instanceName: '',
    adminName: '',
    email: '',
    workspaceName: '',
    slug: '',
    slugTouched: false,
    signupPolicy: 'invite',
    workspaceCreation: 'admins_only',
  };
  let step = 1;
  const choices: Array<ChoiceControl<CloudSignupPolicy> | ChoiceControl<CloudWorkspaceCreation>> = [];

  function disposeChoices(): void {
    for (const choice of choices) choice.destroy();
    choices.length = 0;
  }

  function render(): void {
    disposeChoices();
    const main = options.frame();
    main.setAttribute('data-cloud-narrow', '');
    main.setAttribute('data-cloud-setup-step', String(step));
    main.append(
      el('span', { text: `Étape ${step} sur 4`, attribute: 'data-cloud-eyebrow' }),
      el('h1', { text: titles[step] }),
      el('p', { text: leads[step], attribute: 'data-cloud-muted' }),
    );
    if (step === 1) stepOne(main);
    else if (step === 2) stepTwo(main);
    else if (step === 3) stepThree(main);
    else stepFour(main);
  }

  const titles: Record<number, string> = {
    1: 'Cette instance',
    2: WORKSPACE_ROLES.admin,
    3: 'Premier espace',
    4: 'Qui peut entrer',
  };
  const leads: Record<number, string> = {
    1: 'Ce nom s’affiche sur l’écran de connexion et dans les e-mails.',
    2: 'Cette adresse recevra un code de connexion. Blok n’a pas de mot de passe.',
    3: 'L’espace où vous travaillerez en premier. Vous pourrez en créer d’autres plus tard.',
    4: 'Modifiable à tout moment dans Réglages → Instance → Accès.',
  };

  function stepOne(main: HTMLElement): void {
    const form = el('form');
    const token = field({ form, label: 'Jeton de setup', type: 'text', name: 'setup-token', value: draft.token });
    token.autocomplete = 'off';
    token.spellcheck = false;
    const name = field({ form, label: 'Nom de l’instance', type: 'text', name: 'instance-name', value: draft.instanceName });
    name.maxLength = 120;
    const cmd = el('p', { attribute: 'data-cloud-note' });
    cmd.append(document.createTextNode('Sur le serveur : '), el('code', { text: SETUP_TOKEN_CMD }));
    const next = button({ label: 'Continuer', primary: true, type: 'submit', onClick: () => {} });
    const sync = (): void => {
      draft.token = token.value.trim();
      draft.instanceName = name.value.trim();
      next.disabled = !(draft.token && draft.instanceName);
    };
    sync();
    form.append(next);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sync();
      if (!draft.token || !draft.instanceName) return;
      step = 2;
      render();
    });
    token.addEventListener('input', sync);
    name.addEventListener('input', sync);
    main.append(form, cmd);
  }

  function stepTwo(main: HTMLElement): void {
    const form = el('form');
    const adminName = field({ form, label: 'Votre nom', type: 'text', name: 'admin-name', value: draft.adminName });
    adminName.maxLength = 120;
    const email = field({ form, label: 'Adresse e-mail', type: 'email', name: 'admin-email', value: draft.email });
    email.autocomplete = 'email';
    const status = el('p', { attribute: 'data-cloud-note' });
    status.setAttribute('role', 'status');
    status.hidden = true;
    const next = button({ label: 'Continuer', primary: true, type: 'submit', onClick: () => {} });
    const verify = button({
      label: 'Vérifier l’envoi',
      onClick: () => {
        void options.run(async () => {
          draft.adminName = adminName.value.trim();
          draft.email = email.value.trim();
          status.hidden = true;
          await options.client.request('/api/setup/email-test', {
            method: 'POST',
            body: JSON.stringify({ token: draft.token, email: draft.email }),
          });
          status.textContent = `Un e-mail de test a été envoyé à ${draft.email}.`;
          status.hidden = false;
        });
      },
    });
    const sync = (): void => {
      draft.adminName = adminName.value.trim();
      draft.email = email.value.trim();
      const ready = Boolean(draft.adminName && draft.email.includes('@'));
      next.disabled = !ready;
      verify.disabled = !ready || !draft.token;
    };
    sync();
    form.append(verify, next);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sync();
      if (next.disabled) return;
      step = 3;
      render();
    });
    adminName.addEventListener('input', sync);
    email.addEventListener('input', sync);
    main.append(form, status);
    main.append(button({ label: 'Retour', onClick: () => { step = 1; render(); } }));
  }

  function stepThree(main: HTMLElement): void {
    const form = el('form');
    const workspaceName = field({
      form,
      label: 'Nom de l’espace',
      type: 'text',
      name: 'workspace-name',
      value: draft.workspaceName,
    });
    workspaceName.maxLength = 120;
    if (!draft.slugTouched && draft.workspaceName) draft.slug = deriveWorkspaceSlug(draft.workspaceName);

    const preview = el('p', { attribute: 'data-cloud-note' });
    const previewValue = el('code', { text: `${previewHost(options)}/${draft.slug || '…'}` });
    preview.append(el('span', { text: 'Identifiant : ' }), previewValue);

    const slugWrap = el('div', { attribute: 'data-cloud-setup-slug' });
    slugWrap.hidden = !draft.slugTouched;
    const slug = field({
      form: slugWrap,
      label: 'Identifiant de l’espace',
      type: 'text',
      name: 'workspace-slug',
      value: draft.slug,
    });
    slug.pattern = '[a-z0-9][a-z0-9-]{1,62}';
    slug.minLength = 2;
    slug.maxLength = 63;

    const edit = button({
      label: 'Modifier',
      attribute: 'data-cloud-link',
      onClick: () => {
        slugWrap.hidden = false;
        edit.hidden = true;
        slug.focus();
      },
    });
    edit.hidden = draft.slugTouched;

    const next = button({ label: 'Continuer', primary: true, type: 'submit', onClick: () => {} });
    const syncPreview = (): void => {
      previewValue.textContent = `${previewHost(options)}/${draft.slug || '…'}`;
      next.disabled = !(draft.workspaceName && SLUG_PATTERN.test(draft.slug));
    };
    workspaceName.addEventListener('input', () => {
      draft.workspaceName = workspaceName.value.trim();
      if (!draft.slugTouched) {
        draft.slug = deriveWorkspaceSlug(draft.workspaceName);
        slug.value = draft.slug;
      }
      syncPreview();
    });
    slug.addEventListener('input', () => {
      draft.slugTouched = true;
      draft.slug = slug.value.trim();
      syncPreview();
    });
    syncPreview();

    form.append(preview, edit, slugWrap, next);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      draft.workspaceName = workspaceName.value.trim();
      draft.slug = slug.value.trim();
      if (!(draft.workspaceName && SLUG_PATTERN.test(draft.slug))) return;
      step = 4;
      render();
    });
    main.append(form);
    main.append(button({ label: 'Retour', onClick: () => { step = 2; render(); } }));
  }

  function stepFour(main: HTMLElement): void {
    const signupLabel = el('label', { text: 'Qui peut créer un compte' });
    const signupConsequence = el('p', {
      text: SIGNUP_POLICIES[draft.signupPolicy].consequence,
      attribute: 'data-cloud-note',
    });
    const signup = createChoice({
      label: 'Politique d’inscription',
      value: draft.signupPolicy,
      options: signupPolicyOptions(),
      onChange: (value) => {
        draft.signupPolicy = value;
        signupConsequence.textContent = SIGNUP_POLICIES[value].consequence;
        summary.textContent = `${SIGNUP_POLICIES[value].consequence} Modifiable à tout moment dans Réglages → Instance → Accès.`;
      },
    });
    choices.push(signup);

    const creationLabel = el('label', { text: 'Qui peut créer un espace' });
    const creationConsequence = el('p', {
      text: WORKSPACE_CREATION_POLICIES[draft.workspaceCreation].consequence,
      attribute: 'data-cloud-note',
    });
    const creation = createChoice({
      label: 'Création d’espaces',
      value: draft.workspaceCreation,
      options: workspaceCreationOptions(),
      onChange: (value) => {
        draft.workspaceCreation = value;
        creationConsequence.textContent = WORKSPACE_CREATION_POLICIES[value].consequence;
      },
    });
    choices.push(creation);

    const summary = el('p', {
      text: `${SIGNUP_POLICIES[draft.signupPolicy].consequence} Modifiable à tout moment dans Réglages → Instance → Accès.`,
      attribute: 'data-cloud-muted',
    });

    main.append(signupLabel, signup.element, signupConsequence, creationLabel, creation.element, creationConsequence, summary);

    const actions = el('div', { attribute: 'data-cloud-actions' });
    actions.append(
      button({ label: 'Retour', onClick: () => { step = 3; render(); } }),
      button({
        label: 'Terminer la configuration',
        primary: true,
        onClick: () => {
          void options.run(async () => {
            await options.client.request('/api/setup/claim', {
              method: 'POST',
              body: JSON.stringify({
                token: draft.token,
                email: draft.email,
                name: draft.adminName,
                instanceName: draft.instanceName,
                workspace: { slug: draft.slug, name: draft.workspaceName },
                signupPolicy: draft.signupPolicy,
                workspaceCreation: draft.workspaceCreation,
              }),
            });
            options.onClaimed(draft.email);
          });
        },
      }),
    );
    main.append(actions);
  }

  render();
}
