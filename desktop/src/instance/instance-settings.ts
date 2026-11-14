import { openModalDialog, type ModalDialogHandle } from '@blok/modal-dialog';
import { PopoverDesktop } from '@blok/popover';
import { IconDotsHorizontal, IconTrash } from '../../../src/components/icons';
import {
  SIGNUP_POLICIES,
  WORKSPACE_CREATION_POLICIES,
  signupPolicyOptions,
  workspaceCreationOptions,
} from '../access-vocabulary';
import {
  CloudClient,
  type CloudAdminSettings,
  type CloudAdminUser,
  type CloudAdminWorkspace,
  type CloudSignupPolicy,
  type CloudWorkspaceCreation,
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
  let handle: ModalDialogHandle;
  let busy = false;
  const close = (): void => { if (!busy) handle.close(); };
  const cancel = button({ label: 'Annuler', onClick: close });
  const confirm = button({
    label: options.confirmLabel,
    primary: true,
    attribute: 'data-desktop-instance-confirm-destructive',
    onClick: () => {
      if (busy) return;
      busy = true;
      cancel.disabled = true;
      confirm.disabled = true;
      void Promise.resolve(options.onConfirm()).finally(() => {
        busy = false;
        handle.close();
      });
    },
  });
  actions.append(cancel, confirm);
  surface.append(actions);
  overlay.append(surface);
  handle = openModalDialog({
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
  let alive = true;

  const titles: Record<InstancePanel, string> = {
    general: 'Général',
    access: 'Accès',
    accounts: 'Comptes',
    workspaces: 'Espaces',
    health: 'Santé et e-mail',
  };
  const intros: Record<InstancePanel, string> = {
    general: 'Nom et identité de cette instance.',
    access: 'Qui peut créer un compte et un espace sur ce serveur.',
    accounts: 'Comptes de l’instance. Métadonnées seules — aucun contenu de page.',
    workspaces: 'Espaces hébergés sur cette instance. Métadonnées seules — aucun accès au contenu.',
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
    void options.client.adminSettings().then(async (settings) => {
      if (!alive) return;
      status.remove();
      const nameRow = el('div', { attribute: 'data-desktop-settings-row' });
      const labels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      labels.append(
        el('strong', { text: 'Nom de l’instance', attribute: 'data-desktop-settings-row-title' }),
        el('span', { text: 'Affiché sur l’écran de connexion et dans les e-mails.', attribute: 'data-desktop-settings-row-help' }),
      );
      const name = el('input', { attribute: 'data-desktop-instance-name' });
      name.type = 'text';
      styleTextField(name);
      name.maxLength = 120;
      name.value = settings.name;
      name.setAttribute('aria-label', 'Nom de l’instance');
      const feedback = createFeedback({ attribute: 'data-desktop-instance-feedback' });
      disposers.push(() => feedback.destroy());
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (!next || next === settings.name) {
          name.value = settings.name;
          return;
        }
        void options.client.patchAdminSettings({ name: next }).then((updated) => {
          if (!alive) return;
          settings.name = updated.name;
          name.value = updated.name;
          feedback.show('Nom enregistré');
        }).catch((reason) => {
          if (!alive) return;
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
        if (!alive) return;
        const admins = listed.users.filter((user) => user.instanceAdmin);
        const names = admins.map((user) => user.name?.trim() || user.email).join(', ');
        root.append(el('p', {
          text: names ? `Administrée par ${names}.` : 'Administrée par —.',
          attribute: 'data-desktop-instance-admins',
        }));
      } catch {
        if (alive) root.append(el('p', { text: 'Administrée par —.', attribute: 'data-desktop-instance-admins' }));
      }
    }).catch((reason) => {
      if (alive) status.textContent = errorMessage(reason);
    });
  }

  function mountAccess(): void {
    const status = el('p', { text: 'Chargement…', attribute: 'data-cloud-settings-muted' });
    root.append(status);
    const choices: ChoiceControl<string>[] = [];
    disposers.push(() => { for (const choice of choices) choice.destroy(); });
    void options.client.adminSettings().then((settings) => {
      if (!alive) return;
      status.remove();
      const feedback = createFeedback({ attribute: 'data-desktop-instance-feedback' });
      disposers.push(() => feedback.destroy());

      const savePolicy = <K extends 'signupPolicy' | 'workspaceCreation'>(
        key: K,
        value: CloudAdminSettings[K],
        control: ChoiceControl<string>,
        previous: CloudAdminSettings[K],
      ): void => {
        void options.client.patchAdminSettings({ [key]: value }).then((updated) => {
          if (!alive) return;
          settings[key] = updated[key];
          control.setValue(updated[key]);
          feedback.show('Enregistré');
        }).catch((reason) => {
          if (!alive) return;
          control.setValue(previous);
          feedback.show(errorMessage(reason), 'error');
        });
      };

      const signupRow = el('div', { attribute: 'data-desktop-settings-row' });
      const signupLabels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      signupLabels.append(
        el('strong', { text: 'Inscription', attribute: 'data-desktop-settings-row-title' }),
        el('span', {
          text: SIGNUP_POLICIES[settings.signupPolicy].consequence,
          attribute: 'data-desktop-settings-row-help',
        }),
      );
      const signup = createChoice<CloudSignupPolicy>({
        label: 'Inscription',
        value: settings.signupPolicy,
        options: signupPolicyOptions(),
        onChange(value) {
          const previous = settings.signupPolicy;
          settings.signupPolicy = value;
          signupLabels.querySelector('[data-desktop-settings-row-help]')!.textContent = SIGNUP_POLICIES[value].consequence;
          savePolicy('signupPolicy', value, signup, previous);
        },
      });
      signup.element.setAttribute('data-desktop-instance-signup', '');
      choices.push(signup);
      signupRow.append(signupLabels, signup.element);

      const creationRow = el('div', { attribute: 'data-desktop-settings-row' });
      const creationLabels = el('div', { attribute: 'data-desktop-settings-row-labels' });
      creationLabels.append(
        el('strong', { text: 'Création d’espaces', attribute: 'data-desktop-settings-row-title' }),
        el('span', {
          text: WORKSPACE_CREATION_POLICIES[settings.workspaceCreation].consequence,
          attribute: 'data-desktop-settings-row-help',
        }),
      );
      const creation = createChoice<CloudWorkspaceCreation>({
        label: 'Création d’espaces',
        value: settings.workspaceCreation,
        options: workspaceCreationOptions(),
        onChange(value) {
          const previous = settings.workspaceCreation;
          settings.workspaceCreation = value;
          creationLabels.querySelector('[data-desktop-settings-row-help]')!.textContent = WORKSPACE_CREATION_POLICIES[value].consequence;
          savePolicy('workspaceCreation', value, creation, previous);
        },
      });
      creation.element.setAttribute('data-desktop-instance-workspace-creation', '');
      choices.push(creation);
      creationRow.append(creationLabels, creation.element);

      root.append(signupRow, creationRow, feedback.element);
    }).catch((reason) => {
      if (alive) status.textContent = errorMessage(reason);
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
        el('th', { text: 'Date' }),
        el('th', { text: 'Espaces' }),
        el('th', { text: 'Actions' }),
      );
      head.append(heading);
      const body = el('tbody');
      for (const user of users) {
        const row = el('tr');
        row.append(
          el('td', { text: user.email }),
          el('td', { text: user.name || '—' }),
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
      let popup: PopoverDesktop | null = null;
      let destroyed = false;
      function open(): void {
        if (trigger.disabled || destroyed) return;
        if (popup?.isShown) { popup.hide(); return; }
        const items = [
          {
            name: 'promote',
            title: user.instanceAdmin ? 'Déjà administrateur' : 'Promouvoir',
            isDisabled: user.instanceAdmin,
            closeOnActivate: true,
            onActivate: () => {
              if (user.instanceAdmin) return;
              void options.client.patchAdminUser(user.id, { instanceAdmin: true }).then(onChanged).catch((reason) => {
                if (!alive) return;
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
                message: `${user.email} sera retiré de l’instance. Sessions, jetons et accès seront effacés. Cette action est définitive.`,
                confirmLabel: 'Supprimer',
                container: options.dialog,
                onConfirm: async () => {
                  try {
                    await options.client.deleteAdminUser(user.id);
                    onChanged();
                  } catch (reason) {
                    if (!alive) return;
                    error.textContent = errorMessage(reason);
                    error.hidden = false;
                  }
                },
              });
            },
          },
        ];
        const menu = new PopoverDesktop({ trigger, width: 'auto', minWidth: '220px', items });
        popup = menu;
        const palette = getComputedStyle(trigger);
        for (const token of ['--blok-popover-bg', '--blok-popover-border', '--blok-text-primary', '--blok-text-secondary', '--blok-item-hover-bg']) {
          menu.getElement().style.setProperty(token, palette.getPropertyValue(token));
        }
        trigger.setAttribute('aria-expanded', 'true');
        let settled = false;
        menu.on('closed', () => {
          if (settled) return;
          settled = true;
          if (popup === menu) { popup = null; trigger.setAttribute('aria-expanded', 'false'); }
          if (trigger.isConnected && !trigger.disabled && !destroyed) trigger.focus();
          queueMicrotask(() => menu.destroy());
        });
        menu.show();
      }
      menus.push({ destroy() { destroyed = true; popup?.destroy(); popup = null; trigger.setAttribute('aria-expanded', 'false'); } });
      return trigger;
    }

    async function refresh(): Promise<void> {
      if (!alive) return;
      error.hidden = true;
      try {
        const listed = await options.client.adminUsers({ limit: 100 });
        if (!alive) return;
        status.hidden = true;
        render(listed.users);
      } catch (reason) {
        if (!alive) return;
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
      if (!alive) return;
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
      if (alive) status.textContent = errorMessage(reason);
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
        await options.client.request<{ ok: boolean }>('/healthz');
        if (!alive) return;
        setPill(base, 'ok', 'Joignable');
        setPill(files, 'ok', 'Volume accessible via le serveur');
      } catch {
        if (!alive) return;
        setPill(base, 'bad', 'Injoignable');
        setPill(files, 'bad', 'État inconnu');
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
          if (!alive) return;
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
        } catch (reason) {
          if (!alive) return;
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
      alive = false;
      for (const dispose of disposers.splice(0)) dispose();
      root.remove();
    },
  };
}
