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
  instanceName: string;
  adminName: string;
  email: string;
  signupPolicy: CloudSignupPolicy;
  workspaceCreation: CloudWorkspaceCreation;
}


/**
 * Four-step first-run assistant. Nothing is written until the final POST /api/setup/claim.
 *
 * Claim persists `{email,name,instanceName?,signupPolicy,workspaceCreation}`. The
 * first space is derived server side from the address, Notion-style.
 */
export function mountSetupAssistant(options: SetupAssistantOptions): void {
  const draft: SetupDraft = {
    instanceName: '',
    adminName: '',
    email: '',
    signupPolicy: 'invite',
    workspaceCreation: 'admins_only',
  };
  const flow = { step: 1 };
  const choices: Array<ChoiceControl<CloudSignupPolicy> | ChoiceControl<CloudWorkspaceCreation>> = [];

  function disposeChoices(): void {
    for (const choice of choices) choice.destroy();
    choices.length = 0;
  }

  function render(): void {
    disposeChoices();
    const main = options.frame();
    main.setAttribute('data-cloud-narrow', '');
    main.setAttribute('data-cloud-setup-step', String(flow.step));
    main.append(
      el('span', { text: `Étape ${flow.step} sur 3`, attribute: 'data-cloud-eyebrow' }),
      el('h1', { text: titles[flow.step] }),
      el('p', { text: leads[flow.step], attribute: 'data-cloud-muted' }),
    );
    if (flow.step === 1) stepOne(main);
    else if (flow.step === 2) stepTwo(main);
    else stepThree(main);
  }

  const titles: Record<number, string> = {
    1: 'Cette instance',
    2: WORKSPACE_ROLES.admin,
    3: 'Qui peut entrer',
  };
  const leads: Record<number, string> = {
    1: 'Ce nom s’affiche sur l’écran de connexion et dans les e-mails.',
    2: 'Cette adresse recevra un code de connexion. Blok n’a pas de mot de passe.',
    3: 'Modifiable à tout moment dans Réglages → Instance → Accès.',
  };

  function stepOne(main: HTMLElement): void {
    const form = el('form');
    const name = field({ form, label: 'Nom de l’instance', type: 'text', name: 'instance-name', value: draft.instanceName });
    name.maxLength = 120;
    const next = button({ label: 'Continuer', primary: true, type: 'submit', onClick: () => {} });
    const sync = (): void => {
      draft.instanceName = name.value.trim();
      next.disabled = !draft.instanceName;
    };
    sync();
    form.append(next);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sync();
      if (!draft.instanceName) return;
      flow.step = 2;
      render();
    });
    name.addEventListener('input', sync);
    main.append(form);
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
            body: JSON.stringify({ email: draft.email }),
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
      verify.disabled = !ready;
    };
    sync();
    form.append(verify, next);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sync();
      if (next.disabled) return;
      flow.step = 3;
      render();
    });
    adminName.addEventListener('input', sync);
    email.addEventListener('input', sync);
    main.append(form, status);
    main.append(button({ label: 'Retour', onClick: () => { flow.step = 1; render(); } }));
  }

  function stepThree(main: HTMLElement): void {
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
      button({ label: 'Retour', onClick: () => { flow.step = 3; render(); } }),
      button({
        label: 'Terminer la configuration',
        primary: true,
        onClick: () => {
          void options.run(async () => {
            await options.client.request('/api/setup/claim', {
              method: 'POST',
              body: JSON.stringify({
                email: draft.email,
                name: draft.adminName,
                instanceName: draft.instanceName,
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
