import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import { PopoverDesktop } from '@blok/popover';
import { IconDotsHorizontal, IconTrash } from '../../../src/components/icons';
import {
  INSTANCE_ROLES,
  SIGNUP_POLICIES,
  WORKSPACE_CREATION_POLICIES,
  signupPolicyOptions,
  workspaceCreationOptions,
} from '../access-vocabulary';
import type {
  CloudAdminSettings,
  CloudAdminUser,
  CloudAdminWorkspace,
  CloudClient,
  CloudSignupPolicy,
  CloudWorkspaceCreation,
} from '../cloud/client';
import { createChoice, styleTextField, type ChoiceControl } from '../ui/controls';
import { button, el } from '../ui/dom';
import { createFeedback } from '../ui/feedback';
import './instance-settings.css';

export type InstancePanel = 'general' | 'access' | 'accounts' | 'workspaces' | 'health';

export interface InstanceSettingsOptions {
  client: CloudClient;
  /** Settings dialog surface — nested confirms must pass `container: dialog`. */
  dialog: HTMLElement;
  publicUrl: string;
  coreVersion: string;
  appVersion: string;
}

export interface InstanceSettingsHandle {
  destroy(): void;
}

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'La demande n’a pas pu aboutir. Réessayez.';
}

function applyEmailTestOutcome(
  outcome: { ok: boolean; backend?: string; error?: string },
  resultEl: HTMLElement,
  detailsEl: HTMLDetailsElement,
  mail: HTMLElement,
  setPill: (row: HTMLElement, state: 'ok' | 'bad' | 'unknown', detail: string) => void,
): void {
  const result = resultEl;
  const details = detailsEl;
  const backendLabel = outcome.backend || 'inconnu';
  if (outcome.ok) {
    result.textContent = `E-mail de test envoyé (${backendLabel}).`;
    result.setAttribute('data-kind', 'ok');
    setPill(mail, 'ok', `Backend ${backendLabel}`);
  } else {
    result.textContent = `Échec de l’envoi (${backendLabel}).`;
    result.setAttribute('data-kind', 'error');
    setPill(mail, 'bad', `Backend ${backendLabel}`);
    const pre = details.querySelector('pre');
    if (pre) pre.textContent = outcome.error ?? 'Erreur inconnue';
    details.hidden = false;
  }
  result.hidden = false;
}

function openConfirm(options: {
  title: string;
  message: string;
  confirmLabel: string;
  container: HTMLElement;
  onConfirm: () => void | Promise<void>;
}): void {
  const overlay = el('div', { attribute: 'data-desktop-settings-overlay' });
  overlay.setAttribute('data-desktop-instance-confirm', '');
  const surface = el('section', { attribute: 'data-desktop-instance-confirm-dialog' });
  surface.append(
    el('h2', { text: options.title }),
    el('p', { text: options.message, attribute: 'data-cloud-settings-muted' }),
  );
  const actions = el('div', { attribute: 'data-desktop-instance-confirm-actions' });
  const confirmState: { handle: ModalDialogHandle | null; busy: boolean } = { handle: null, busy: false };
  const close = (): void => { if (!confirmState.busy) confirmState.handle?.close(); };
  const cancel = button({ label: 'Annuler', onClick: close });
  const confirm = button({
    label: options.confirmLabel,
    primary: true,
    attribute: 'data-desktop-instance-confirm-destructive',
    onClick: () => {
      if (confirmState.busy) return;
      confirmState.busy = true;
      cancel.disabled = true;
      confirm.disabled = true;
      void Promise.resolve(options.onConfirm()).finally(() => {
        confirmState.busy = false;
        confirmState.handle?.close();
      });
    },
  });
  actions.append(cancel, confirm);
  surface.append(actions);
  overlay.append(surface);
  confirmState.handle = openModalDialog({
    content: overlay,
    surface,
    label: options.title,
    role: 'alertdialog',
    container: options.container,
    initialFocus: () => cancel,
    onDismiss: close,
  });
}

/** Mounts one Instance settings panel into the settings content shell. */
export function mountInstanceSettings(
  content: HTMLElement,
  panel: InstancePanel,
  options: InstanceSettingsOptions,
): InstanceSettingsHandle {
  const root = el('div', { attribute: 'data-desktop-instance-panel' });
  root.setAttribute('data-desktop-instance-kind', panel);
  content.append(root);
  const disposers: Array<() => void> = [];
  const life = { alive: true };

  const titles: Record<InstancePanel, string> = {
    general: 'Général',
    access: 'Accès',
    accounts: 'Comptes',
    workspaces: 'Workspaces',
    health: 'Santé et e-mail',
  };
  const intros: Record<InstancePanel, string> = {
    general: 'Nom et identité de cette instance.',
    access: 'Qui peut créer un compte et un espace sur ce serveur.',
    accounts: 'Comptes du serveur. Métadonnées seules — aucun contenu de page.',
    workspaces: 'Workspaces hébergés sur ce serveur. Métadonnées seules — aucun accès au contenu.',
    health: 'État du serveur et délivrabilité des e-mails.',
  };
  root.append(
    el('h1', { text: titles[panel], attribute: 'data-desktop-settings-title' }),
    el('p', { text: intros[panel], attribute: 'data-desktop-settings-intro' }),
  );

  if (panel === 'general') mountGeneral();
  else if (panel === 'access') mountAccess();
  else if (panel === 'accounts') mountAccounts();
  else if (panel === 'workspaces') mountWorkspaces();
  else mountHealth();

  function mountGeneral(): void {
    const status = el('p', { text: 'Chargement…', attribute: 'data-cloud-settings-muted' });
    root.append(status);
    void options.client.adminSettings().then(async (payload) => {
      if (!life.alive) return;
      status.remove();
      const settings = payload;
      const nameRow = el('div', { attribute: 'data-desktop-settings-row' });
      const labels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      labels.append(
        el('strong', { text: 'Nom du serveur', attribute: 'data-desktop-settings-row-title' }),
        el('span', { text: 'Affiché sur l’écran de connexion et dans les e-mails.', attribute: 'data-desktop-settings-row-help' }),
      );
      const name = el('input', { attribute: 'data-desktop-instance-name' });
      name.type = 'text';
      styleTextField(name);
      name.maxLength = 120;
      name.value = settings.name;
      name.setAttribute('aria-label', 'Nom du serveur');
      const feedback = createFeedback({ attribute: 'data-desktop-instance-feedback' });
      disposers.push(() => feedback.destroy());
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (!next || next === settings.name) {
          name.value = settings.name;
          return;
        }
        void options.client.patchAdminSettings({ name: next }).then((updated) => {
          if (!life.alive) return;
          settings.name = updated.name;
          name.value = updated.name;
          feedback.show('Nom enregistré');
        }).catch((reason) => {
          if (!life.alive) return;
          name.value = settings.name;
          feedback.show(errorMessage(reason), 'error');
        });
      });
      nameRow.append(labels, name);
      const urlRow = el('div', { attribute: 'data-desktop-settings-row' });
      urlRow.append(
        el('strong', { text: 'Adresse publique', attribute: 'data-desktop-settings-row-title' }),
        el('span', { text: options.publicUrl || '—', attribute: 'data-desktop-settings-row-value' }),
      );
      const versionRow = el('div', { attribute: 'data-desktop-settings-row' });
      versionRow.append(
        el('strong', { text: 'Versions', attribute: 'data-desktop-settings-row-title' }),
        el('span', {
          text: `Blok ${options.coreVersion} · App ${options.appVersion}`,
          attribute: 'data-desktop-settings-row-value',
        }),
      );
      root.append(nameRow, feedback.element, urlRow, versionRow);
      try {
        const listed = await options.client.adminUsers({ limit: 100 });
        if (!life.alive) return;
        const admins = listed.users.filter((user) => user.instanceAdmin);
        const names = admins.map((user) => user.name?.trim() ? `${user.name.trim()} (${user.email})` : user.email).join(', ');
        root.append(el('p', {
          text: names ? `Administrée par ${names}.` : 'Administrée par —.',
          attribute: 'data-desktop-instance-admins',
        }));
      } catch {
        if (life.alive) root.append(el('p', { text: 'Administrée par —.', attribute: 'data-desktop-instance-admins' }));
      }
    }).catch((reason) => {
      if (life.alive) status.textContent = errorMessage(reason);
    });
  }

  function mountAccess(): void {
    const status = el('p', { text: 'Chargement…', attribute: 'data-cloud-settings-muted' });
    root.append(status);
    const choices: ChoiceControl<string>[] = [];
    disposers.push(() => { for (const choice of choices) choice.destroy(); });
    void options.client.adminSettings().then((payload) => {
      if (!life.alive) return;
      status.remove();
      const settings = payload;
      const feedback = createFeedback({ attribute: 'data-desktop-instance-feedback' });
      disposers.push(() => feedback.destroy());

      const savePolicy = <K extends 'signupPolicy' | 'workspaceCreation'>(
        key: K,
        value: CloudAdminSettings[K],
        control: ChoiceControl<string>,
        help: HTMLElement,
        consequence: (value: CloudAdminSettings[K]) => string,
      ): void => {
        control.disabled = true;
        void options.client.patchAdminSettings({ [key]: value }).then((updated) => {
          if (!life.alive) return;
          settings[key] = updated[key];
          control.setValue(updated[key]);
          help.textContent = consequence(updated[key]);
          feedback.show('Enregistré');
        }).catch((reason) => {
          if (!life.alive) return;
          control.setValue(settings[key]);
          help.textContent = consequence(settings[key]);
          feedback.show(errorMessage(reason), 'error');
        }).finally(() => {
          if (life.alive) control.disabled = false;
        });
      };

      const signupRow = el('div', { attribute: 'data-desktop-settings-row' });
      const signupLabels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      const signupHelp = el('span', {
        text: SIGNUP_POLICIES[settings.signupPolicy].consequence,
        attribute: 'data-desktop-settings-row-help',
      });
      signupLabels.append(
        el('strong', { text: 'Inscription', attribute: 'data-desktop-settings-row-title' }),
        signupHelp,
      );
      const signup = createChoice<CloudSignupPolicy>({
        label: 'Inscription',
        value: settings.signupPolicy,
        options: signupPolicyOptions(),
        onChange(value) {
          savePolicy('signupPolicy', value, signup, signupHelp, (policy) => SIGNUP_POLICIES[policy].consequence);
        },
      });
      signup.element.setAttribute('data-desktop-instance-signup', '');
      choices.push(signup);
      signupRow.append(signupLabels, signup.element);

      const creationRow = el('div', { attribute: 'data-desktop-settings-row' });
      const creationLabels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      const creationHelp = el('span', {
        text: WORKSPACE_CREATION_POLICIES[settings.workspaceCreation].consequence,
        attribute: 'data-desktop-settings-row-help',
      });
      creationLabels.append(
        el('strong', { text: 'Création d’espaces', attribute: 'data-desktop-settings-row-title' }),
        creationHelp,
      );
      const creation = createChoice<CloudWorkspaceCreation>({
        label: 'Création d’espaces',
        value: settings.workspaceCreation,
        options: workspaceCreationOptions(),
        onChange(value) {
          savePolicy('workspaceCreation', value, creation, creationHelp, (policy) => WORKSPACE_CREATION_POLICIES[policy].consequence);
        },
      });
      creation.element.setAttribute('data-desktop-instance-workspace-creation', '');
      choices.push(creation);
      creationRow.append(creationLabels, creation.element);

      const invitationHelp = el('p', {
        text: `Pour un serveur privé, choisissez « ${SIGNUP_POLICIES.invite.label} » et « ${WORKSPACE_CREATION_POLICIES.admins_only.label} ». Les comptes existants conservent leur accès. Pour inviter une nouvelle personne, ouvrez les paramètres du Workspace, puis Membres. Les administrateurs du Workspace peuvent envoyer ces invitations ; ce rôle est distinct de l’administration du serveur.`,
        attribute: 'data-desktop-settings-row-help',
      });
      root.append(signupRow, creationRow, feedback.element, invitationHelp);
    }).catch((reason) => {
      if (life.alive) status.textContent = errorMessage(reason);
    });
  }

  function mountAccounts(): void {
    const status = el('p', { text: 'Chargement…', attribute: 'data-cloud-settings-muted' });
    const error = el('p', { attribute: 'data-cloud-settings-error' });
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const list = el('div', { attribute: 'data-desktop-instance-accounts' });
    root.append(status, error, list);
    const menus: Array<{ destroy(): void }> = [];
    disposers.push(() => { for (const menu of menus) menu.destroy(); menus.length = 0; });

    const render = (users: CloudAdminUser[]): void => {
      menus.splice(0).forEach((menu) => menu.destroy());
      list.replaceChildren();
      if (!users.length) {
        list.append(el('p', { text: 'Aucun compte.', attribute: 'data-cloud-settings-muted' }));
        return;
      }
      const table = el('table', { attribute: 'data-desktop-instance-table' });
      const head = el('thead');
      const heading = el('tr');
      heading.append(
        el('th', { text: 'Adresse' }),
        el('th', { text: 'Nom' }),
        el('th', { text: 'Rôle d’instance' }),
        el('th', { text: 'Date' }),
        el('th', { text: 'Workspaces' }),
        el('th', { text: 'Actions' }),
      );
      head.append(heading);
      const body = el('tbody');
      for (const user of users) {
        const row = el('tr');
        row.append(
          el('td', { text: user.email }),
          el('td', { text: user.name || '—' }),
          el('td', { text: user.instanceAdmin ? INSTANCE_ROLES.admin : INSTANCE_ROLES.account }),
          el('td', { text: formatDate(user.createdAt) }),
          el('td', { text: String(user.workspaceCount) }),
        );
        const actions = el('td');
        actions.append(accountMenu(user, () => { void refresh(); }));
        row.append(actions);
        body.append(row);
      }
      table.append(head, body);
      list.append(table);
    };

    function accountMenu(user: CloudAdminUser, onChanged: () => void): HTMLButtonElement {
      const trigger = button({ label: '', onClick: () => open(), attribute: 'data-desktop-instance-account-menu' });
      trigger.innerHTML = IconDotsHorizontal;
      trigger.setAttribute('aria-label', `Actions pour ${user.email}`);
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      const menuState: { popup: PopoverDesktop | null; destroyed: boolean } = { popup: null, destroyed: false };
      function open(): void {
        if (trigger.disabled || menuState.destroyed) return;
        if (menuState.popup?.isShown) { menuState.popup.hide(); return; }
        const items = [
          {
            name: 'promote',
            title: user.instanceAdmin ? 'Déjà administrateur' : 'Promouvoir',
            isDisabled: user.instanceAdmin,
            closeOnActivate: true,
            onActivate: () => {
              if (user.instanceAdmin) return;
              void options.client.patchAdminUser(user.id, { instanceAdmin: true }).then(onChanged).catch((reason) => {
                if (!life.alive) return;
                error.textContent = errorMessage(reason);
                error.hidden = false;
              });
            },
          },
          {
            name: 'delete',
            title: 'Supprimer',
            icon: IconTrash,
            isDestructive: true,
            closeOnActivate: true,
            onActivate: () => {
              openConfirm({
                title: 'Supprimer ce compte ?',
                message: `${user.email} sera retiré du serveur. Sessions, jetons et accès seront effacés. Cette action est définitive.`,
                confirmLabel: 'Supprimer',
                container: options.dialog,
                onConfirm: async () => {
                  try {
                    await options.client.deleteAdminUser(user.id);
                    onChanged();
                  } catch (reason) {
                    if (!life.alive) return;
                    error.textContent = errorMessage(reason);
                    error.hidden = false;
                  }
                },
              });
            },
          },
        ];
        const menu = new PopoverDesktop({ trigger, width: 'auto', minWidth: '220px', items });
        menuState.popup = menu;
        const palette = getComputedStyle(trigger);
        for (const token of ['--blok-popover-bg', '--blok-popover-border', '--blok-text-primary', '--blok-text-secondary', '--blok-item-hover-bg']) {
          menu.getElement().style.setProperty(token, palette.getPropertyValue(token));
        }
        trigger.setAttribute('aria-expanded', 'true');
        const closed = { settled: false };
        menu.on('closed', () => {
          if (closed.settled) return;
          closed.settled = true;
          if (menuState.popup === menu) { menuState.popup = null; trigger.setAttribute('aria-expanded', 'false'); }
          if (trigger.isConnected && !trigger.disabled && !menuState.destroyed) trigger.focus();
          queueMicrotask(() => menu.destroy());
        });
        menu.show();
      }
      menus.push({ destroy() { menuState.destroyed = true; menuState.popup?.destroy(); menuState.popup = null; trigger.setAttribute('aria-expanded', 'false'); } });
      return trigger;
    }

    async function refresh(): Promise<void> {
      if (!life.alive) return;
      error.hidden = true;
      try {
        const listed = await options.client.adminUsers({ limit: 100 });
        if (!life.alive) return;
        status.hidden = true;
        render(listed.users);
      } catch (reason) {
        if (!life.alive) return;
        status.textContent = errorMessage(reason);
        status.hidden = false;
      }
    }
    void refresh();
  }

  function mountWorkspaces(): void {
    const status = el('p', { text: 'Chargement…', attribute: 'data-cloud-settings-muted' });
    const list = el('div', { attribute: 'data-desktop-instance-workspaces' });
    root.append(status, list);
    void options.client.adminWorkspaces().then((payload) => {
      if (!life.alive) return;
      status.remove();
      const workspaces: CloudAdminWorkspace[] = payload.workspaces;
      if (!workspaces.length) {
        list.append(el('p', { text: 'Aucun espace.', attribute: 'data-cloud-settings-muted' }));
        return;
      }
      const table = el('table', { attribute: 'data-desktop-instance-table' });
      const head = el('thead');
      const heading = el('tr');
      heading.append(
        el('th', { text: 'Nom' }),
        el('th', { text: 'Identifiant' }),
        el('th', { text: 'Membres' }),
        el('th', { text: 'Date' }),
      );
      head.append(heading);
      const body = el('tbody');
      for (const workspace of workspaces) {
        const row = el('tr');
        row.append(
          el('td', { text: workspace.name }),
          el('td', { text: workspace.slug || workspace.id }),
          el('td', { text: String(workspace.memberCount) }),
          el('td', { text: formatDate(workspace.createdAt) }),
        );
        body.append(row);
      }
      table.append(head, body);
      list.append(table);
    }).catch((reason) => {
      if (life.alive) status.textContent = errorMessage(reason);
    });
  }

  function mountHealth(): void {
    const pills = el('div', { attribute: 'data-desktop-instance-health' });
    const setPill = (row: HTMLElement, state: 'ok' | 'bad' | 'unknown', detail: string): void => {
      const dot = row.querySelector<HTMLElement>('[data-desktop-instance-pastille]');
      const text = row.querySelector<HTMLElement>('[data-cloud-settings-muted]');
      if (dot) dot.setAttribute('data-state', state);
      if (text) text.textContent = detail;
    };
    const makePill = (label: string, state: 'ok' | 'bad' | 'unknown', detail: string): HTMLElement => {
      const row = el('div', { attribute: 'data-desktop-instance-health-row' });
      const dot = el('span', { attribute: 'data-desktop-instance-pastille' });
      dot.setAttribute('data-state', state);
      dot.setAttribute('aria-hidden', 'true');
      row.append(dot, el('strong', { text: label }), el('span', { text: detail, attribute: 'data-cloud-settings-muted' }));
      return row;
    };
    const base = makePill('Base de données', 'unknown', 'Vérification…');
    const files = makePill('Fichiers', 'unknown', 'Vérification…');
    const mail = makePill('Envoi d’e-mails', 'unknown', 'Non vérifié');
    pills.append(base, files, mail);
    root.append(pills);
    root.append(el('p', {
      text: 'L’expéditeur est défini dans la configuration du serveur (variables SMTP / Resend).',
      attribute: 'data-desktop-settings-row-help',
    }));

    void (async () => {
      try {
        // /healthz only answers {"ok":true} and never touches DATA_DIRECTORY,
        // so a green Fichiers pill derived from it is a claim nobody checked —
        // exactly the state this panel exists to catch. /api/admin/health
        // probes the uploads volume for real.
        type Section = { ok: boolean; detail?: string; backend?: string };
        const health = await options.client.request<{
          database: Section; files: Section; mail: Section;
        }>('/api/admin/health');
        if (!life.alive) return;
        setPill(base, health.database.ok ? 'ok' : 'bad', health.database.detail ?? '');
        setPill(files, health.files.ok ? 'ok' : 'bad', health.files.detail ?? '');
        setPill(mail, health.mail.ok ? 'ok' : 'bad', health.mail.detail ?? '');
      } catch {
        if (!life.alive) return;
        setPill(base, 'bad', 'Injoignable');
        setPill(files, 'unknown', 'État inconnu');
        setPill(mail, 'unknown', 'État inconnu');
      }
    })();

    const form = el('div', { attribute: 'data-desktop-instance-email-form' });
    const email = el('input', { attribute: 'data-desktop-instance-email-input' });
    email.type = 'email';
    styleTextField(email);
    email.placeholder = 'adresse@exemple.fr';
    email.setAttribute('aria-label', 'Adresse pour l’e-mail de test');
    const sessionEmail = options.client.currentSession?.user.email;
    if (sessionEmail) email.value = sessionEmail;
    const result = el('p', { attribute: 'data-desktop-instance-email-result' });
    result.setAttribute('role', 'status');
    result.hidden = true;
    const details = el('details', { attribute: 'data-desktop-instance-smtp-error' });
    details.hidden = true;
    details.append(el('summary', { text: 'Détail de l’erreur SMTP' }), el('pre', { text: '' }));
    const send = button({
      label: 'Envoyer un e-mail de test',
      primary: true,
      attribute: 'data-desktop-instance-email-test',
      onClick: async () => {
        const address = email.value.trim().toLocaleLowerCase();
        result.hidden = true;
        details.hidden = true;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          result.textContent = 'Saisissez une adresse e-mail valide.';
          result.hidden = false;
          result.setAttribute('data-kind', 'error');
          return;
        }
        send.disabled = true;
        email.disabled = true;
        try {
          const outcome = await options.client.adminEmailTest(address);
          if (!life.alive) return;
          applyEmailTestOutcome(outcome, result, details, mail, setPill);
        } catch (reason) {
          if (!life.alive) return;
          result.textContent = errorMessage(reason);
          result.setAttribute('data-kind', 'error');
          result.hidden = false;
        } finally {
          send.disabled = false;
          email.disabled = false;
        }
      },
    });
    form.append(email, send);
    root.append(form, result, details);
  }

  return {
    destroy() {
      life.alive = false;
      for (const dispose of disposers.splice(0)) dispose();
      root.remove();
    },
  };
}
