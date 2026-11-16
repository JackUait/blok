import './cloud.css';
import {WORKSPACE_ROLES} from '../access-vocabulary';
import {brandedTitle} from '../tab-identity';
import {styleTextField} from '../ui/controls';
import {CloudApiError, CloudClient, type CloudInstance, type CloudSession, type CloudSessionAdapter, type CloudWorkspace, type CloudWorkspaceStatus} from './client';
import {mountCreateWorkspace} from './create-workspace';
import {mountInviteScreen, type InviteContext} from './invite';
import {mountJoinWorkspace} from './join';
import {mountSetupAssistant} from './setup';
import {mountUnreachable, parseServerOrigin} from './unreachable';
export * from './client';
export type {InviteContext} from './invite';
export {deriveWorkspaceSlug} from './setup';

/** Named gateway routes (plan §9.1). */
export type CloudGatewayRoute =
  | 'boot'
  | 'unreachable'
  | 'setup'
  | 'login-email'
  | 'login-code'
  | 'invite'
  | 'spaces'
  | 'create-workspace'
  | 'join';

export interface CloudGatewayOptions {
  apiOrigin?: string;
  sessionAdapter?: CloudSessionAdapter;
  allowLocal?: boolean;
  /** Explicit account/workspace navigation must never auto-open the sole workspace. */
  forceWorkspacePicker?: boolean;
  initialManage?: {slug: string; section?: 'members' | 'invites'};
  /** Prefill the invite acceptance screen (or parse `?invite=` / `?email=`). */
  initialInvite?: InviteContext;
  onOpenWorkspace(workspace: CloudWorkspace, client: CloudClient): void | Promise<void>;
  onOpenLocal?(): void | Promise<void>;
  onServerChange?(origin: string): void | Promise<void>;
}
export interface CloudGateway { destroy(): void; refresh(): Promise<void> }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attr?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  if (attr) result.setAttribute(attr, '');
  return result;
}
function button(label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const result = node('button', label);
  result.type = 'button'; result.classList.add('blok-button');
  if (primary) result.setAttribute('data-cloud-primary', '');
  result.addEventListener('click', () => { void action(); });
  return result;
}
function field(form: HTMLElement, label: string, type: string, name: string, value = ''): HTMLInputElement {
  const id = `cloud-${name}`;
  const title = node('label', label); title.htmlFor = id;
  const input = node('input'); styleTextField(input); input.type = type; input.name = name; input.id = id; input.value = value; input.required = true;
  form.append(title, input);
  return input;
}
const roleName = WORKSPACE_ROLES;

function readInviteFromLocation(): InviteContext | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('invite');
    if (!slug) return null;
    const email = params.get('email') ?? undefined;
    const host = params.get('host') ?? undefined;
    const role = params.get('role');
    const message = params.get('message') ?? undefined;
    const parsedRole = role === 'admin' || role === 'member' || role === 'viewer' ? role : undefined;
    return {slug, email, host, role: parsedRole, message};
  } catch {
    return null;
  }
}

export async function mountCloudGateway(root: HTMLElement, options: CloudGatewayOptions): Promise<CloudGateway> {
  const client = new CloudClient({origin:options.apiOrigin, sessionAdapter:options.sessionAdapter});
  const view = node('div', undefined, 'data-cloud-gateway'); view.setAttribute('data-blok-interface','');
  root.replaceChildren(view);
  const state: {
    alive: boolean;
    session: CloudSession | null;
    instance: CloudInstance | null;
    email: string;
    route: CloudGatewayRoute;
    currentMain: HTMLElement;
    pendingInvite: InviteContext | null;
  } = {
    alive: true,
    session: null,
    instance: null,
    email: '',
    route: 'boot',
    currentMain: node('main'),
    pendingInvite: options.initialInvite ?? readInviteFromLocation(),
  };

  function setRoute(next: CloudGatewayRoute): void {
    state.route = next;
    view.setAttribute('data-cloud-route', next);
  }

  function frame(next: CloudGatewayRoute): HTMLElement {
    setRoute(next);
    view.replaceChildren();
    const header = node('header');
    const brandName = state.instance?.name?.trim() || 'Blok';
    const brand = node('div', undefined, 'data-cloud-brand');
    brand.append(node('span', brandName.charAt(0).toLocaleUpperCase(), 'data-cloud-mark'), node('span', brandName));
    const nav = node('nav'); nav.setAttribute('aria-label', 'Compte');
    if (state.session) {
      nav.append(node('span', state.session.user.email, 'data-cloud-muted'), button('Changer de compte', () => run(async () => {await client.logout(); state.session = null; state.email = ''; login();})), button('Se déconnecter', () => run(async () => {await client.logout(); state.session = null; login();})));
    }
    header.append(brand, nav);
    state.currentMain = node('main');
    view.append(header, state.currentMain, node('footer', 'Un espace commun pour les idées, les documents et les projets.'));
    return state.currentMain;
  }

  function error(error: unknown): void {
    if (!state.alive) return;
    view.querySelector('[data-cloud-error]')?.remove();
    const message = node('p', error instanceof Error ? error.message : 'Une erreur est survenue.', 'data-cloud-error');
    message.setAttribute('role', 'alert'); state.currentMain.append(message);
  }

  /**
   * Disable every button for the duration of an async action, then restore each
   * button's prior disabled state — including those that were already disabled
   * (setup assistant Continuer / Vérifier). Never blanket-enable.
   */
  async function run(action: () => Promise<void>): Promise<void> {
    const buttons = Array.from(view.querySelectorAll<HTMLButtonElement>('button'));
    const prior = buttons.map(button => button.disabled);
    for (const button of buttons) button.disabled = true;
    try { await action(); } catch (reason) { error(reason); }
    finally {
      for (const [index, button] of buttons.entries()) {
        button.disabled = prior[index] ?? false;
      }
    }
  }

  function setup(): void {
    mountSetupAssistant({
      client,
      frame: () => frame('setup'),
      run,
      showError: error,
      hostPreview: (() => {
        try {
          if (client.origin) return new URL(client.origin).host;
          return window.location.host;
        } catch { return undefined; }
      })(),
      onClaimed(claimedEmail) {
        state.email = claimedEmail;
        login(true);
        const note = node('p', `Un code a été envoyé à ${claimedEmail}.`, 'data-cloud-note');
        note.setAttribute('role', 'status');
        // Insert above the form so the handoff from setup is explicit (plan §9.2).
        const form = state.currentMain.querySelector('form');
        if (form) state.currentMain.insertBefore(note, form);
        else state.currentMain.append(note);
      },
    });
  }

  function unreachable(): void {
    const initialOrigin = client.origin || (window.location.protocol.startsWith('http') ? window.location.origin : '');
    mountUnreachable({
      frame: () => frame('unreachable'),
      run,
      showError: error,
      currentOrigin: initialOrigin,
      onRetry: () => boot(),
      onServerChange: options.onServerChange,
    });
    appendLocalOpen(state.currentMain, 'Continuer avec un espace local');
  }

  function invite(): void {
    const context = state.pendingInvite ?? readInviteFromLocation();
    if (!context) {
      const main = frame('invite');
      main.setAttribute('data-cloud-narrow', '');
      main.append(
        node('span', 'Invitation', 'data-cloud-eyebrow'),
        node('h1', 'Invitation'),
        node('p', 'Ouvrez le lien d’invitation reçu par e-mail.', 'data-cloud-muted'),
      );
      return;
    }
    state.pendingInvite = context;
    mountInviteScreen({
      client,
      session: state.session,
      invite: context,
      frame: () => frame('invite'),
      run,
      showError: error,
      onSwitchAccount: async () => {
        await client.logout();
        state.session = null;
        state.email = context.email ?? '';
        login();
      },
      onContinue: async (slug) => {
        const active = state.session ?? await client.session();
        state.session = active;
        client.currentSession = active;
        const workspace = active.workspaces.find(item => item.slug === slug);
        if (workspace) await options.onOpenWorkspace(workspace, client);
        else await list();
      },
      onLogin: (prefill) => {
        if (prefill) state.email = prefill;
        login();
      },
    });
  }

  function createWorkspace(): void {
    mountCreateWorkspace({
      client,
      instance: state.instance,
      frame: () => frame('create-workspace'),
      run,
      showError: error,
      onCreated: () => list(),
      onCancel: () => { void run(list); },
    });
  }

  function joinRoute(): void {
    mountJoinWorkspace({
      client,
      defaultSlug: state.instance?.defaultWorkspace?.slug,
      defaultName: state.instance?.defaultWorkspace?.name,
      frame: () => frame('join'),
      run,
      showError: error,
      onJoined: () => list(),
      onCancel: () => { void run(list); },
    });
  }

  /** Router table — every named route reachable from one place. */
  const routers: Record<CloudGatewayRoute, () => void> = {
    boot: () => { frame('boot').append(node('p', 'Chargement de votre espace…', 'data-cloud-muted')); },
    unreachable,
    setup,
    'login-email': () => login(false),
    'login-code': () => login(true),
    invite,
    spaces: () => { void list(); },
    'create-workspace': createWorkspace,
    join: joinRoute,
  };

  function appendLocalOpen(main: HTMLElement, label: string): void {
    const openLocal = options.onOpenLocal;
    if (options.allowLocal === false || !openLocal) return;
    main.append(node('hr'), button(label, () => run(async () => { await openLocal(); })));
  }

  function login(codeStep = false): void {
    if (!state.alive) return;
    const main = frame(codeStep ? 'login-code' : 'login-email'); main.setAttribute('data-cloud-narrow', '');
    const welcome = state.instance?.name ? `Bienvenue sur\n${state.instance.name}.` : 'Bienvenue.';
    main.append(node('span', 'Votre espace de travail partagé', 'data-cloud-eyebrow'), node('h1', codeStep ? 'Consultez votre boîte mail.' : welcome));
    main.append(node('p', codeStep ? `Si votre adresse est autorisée, un code a été envoyé à ${state.email}. Il est valable 10 minutes.` : 'Retrouvez votre équipe, partagez vos connaissances et faites avancer vos projets.', 'data-cloud-muted'));
    if (state.instance?.signupPolicy === 'invite') {
      main.append(node('p', 'Les nouveaux comptes nécessitent une invitation d’un administrateur de l’espace. Si vous avez déjà un compte, connectez-vous avec votre adresse habituelle.', 'data-cloud-note'));
    } else if (state.instance?.signupPolicy === 'domain') {
      main.append(node('p', 'Les nouveaux comptes sont réservés aux domaines e-mail autorisés par l’administrateur du serveur.', 'data-cloud-note'));
    }
    const form = node('form', undefined, 'data-cloud-stack');
    const input = field(form, codeStep ? 'Code de connexion' : 'Adresse e-mail', codeStep ? 'text' : 'email', codeStep ? 'code' : 'email', codeStep ? '' : state.email);
    input.autocomplete = codeStep ? 'one-time-code' : 'email';
    if (codeStep) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6}'; input.maxLength = 6; }
    const submit = button(codeStep ? 'Se connecter' : 'Continuer par e-mail', () => {}, true); submit.type = 'submit'; submit.setAttribute('data-cloud-block', ''); form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        if (codeStep) {
          state.session = await client.verifyCode(state.email, input.value.trim());
          await enter(state.session);
          return;
        }
        state.email = input.value.trim();
        await client.request('/api/auth/request-code', {method:'POST', body:JSON.stringify({email: state.email})});
        login(true);
      });
    });
    main.append(form);
    if (codeStep) {
      main.append(node('p', 'Le message peut se trouver dans vos courriers indésirables.', 'data-cloud-note'));
      main.append(button('Renvoyer un code', () => run(async () => {
        await client.request('/api/auth/request-code', {method:'POST', body:JSON.stringify({email: state.email})});
        login(true);
        const status = node('p', 'Si votre adresse est autorisée, un nouveau code a été envoyé.', 'data-cloud-note');
        status.setAttribute('role', 'status');
        state.currentMain.append(status);
      })), document.createTextNode(' '), button('Modifier l’adresse e-mail', () => login()));
    } else main.append(node('p', 'Pas de mot de passe. Les adresses autorisées reçoivent un code de connexion.', 'data-cloud-note'));
    appendLocalOpen(main, 'Continuer avec un espace local');
    serverSection(main);
  }

  function serverSection(main: HTMLElement): void {
    const onServerChange = options.onServerChange;
    if (!onServerChange) return;
    const details = node('details', undefined, 'data-cloud-section');
    details.append(node('summary', 'Se connecter à un autre serveur'));
    const serverForm = node('form');
    const initialOrigin = client.origin || (window.location.protocol.startsWith('http') ? window.location.origin : '');
    const server = field(serverForm, 'Adresse du serveur', 'url', 'server', initialOrigin);
    server.placeholder = 'https://votre-serveur.fr'; server.setAttribute('autocomplete', 'url'); server.spellcheck = false;
    const submitServer = button('Utiliser ce serveur', () => {}, true); submitServer.type = 'submit'; serverForm.append(submitServer);
    serverForm.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        await onServerChange(parseServerOrigin(server.value.trim()));
      });
    });
    details.append(node('p', 'Chaque serveur conserve ses propres comptes et espaces.', 'data-cloud-note'), serverForm); main.append(details);
  }

  async function list(): Promise<void> {
    const active = await client.session();
    const defaultWorkspace = state.instance?.defaultWorkspace;
    const status = defaultWorkspace ? await client.workspace(defaultWorkspace.slug) : null;
    if (!state.alive) return;
    state.session = active; client.currentSession = active;
    const main = frame('spaces');
    main.append(node('span', 'Vos espaces', 'data-cloud-eyebrow'), node('h1', 'Où souhaitez-vous travailler ?'), node('p', 'Choisissez un espace pour retrouver ses pages et son équipe.', 'data-cloud-muted'));
    for (const workspace of active.workspaces) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', workspace.name), node('p', roleName[workspace.role]));
      const actions = node('div', undefined, 'data-cloud-actions');
      actions.append(button('Ouvrir l’espace', () => run(async () => {await options.onOpenWorkspace(workspace, client);}), true)); row.append(text, actions); main.append(row);
    }
    if (status && !status.role) joinSection(main, status);
    const actions = node('div', undefined, 'data-cloud-actions');
    const creation = state.instance?.workspaceCreation;
    if (creation === 'anyone' || (creation === 'admins_only' && active.user.instanceAdmin)) {
      actions.append(button('Créer un espace de travail', () => routers['create-workspace'](), true));
    }
    actions.append(button('Rejoindre un espace', () => routers.join()));
    main.append(actions);
    appendLocalOpen(main, 'Ouvrir un espace local');
    serverSection(main);
  }

  function joinSection(main: HTMLElement, workspace: CloudWorkspaceStatus): void {
    const section = node('section', undefined, 'data-cloud-section'); section.append(node('h2', workspace.name));
    if (workspace.joinStatus === 'pending') {
      const status = node('div', undefined, 'data-cloud-status'); status.setAttribute('role', 'status'); status.append(node('strong', 'Votre demande est en attente'), node('p', 'Un administrateur doit valider votre accès. Vous pourrez ensuite ouvrir cet espace.')); section.append(status, button('Actualiser le statut', () => run(list)));
    } else if (workspace.joinStatus === 'rejected') {
      const status = node('div', undefined, 'data-cloud-status'); status.append(node('strong', 'Votre demande n’a pas été acceptée'), node('p', 'Contactez un administrateur de cet espace pour en savoir plus.')); section.append(status);
    } else {
      section.append(node('p', `Rejoignez ${workspace.name}. Votre accès sera validé par un administrateur.`, 'data-cloud-muted'));
      section.append(button('Demander à rejoindre', () => {
        state.pendingInvite = null;
        routers.join();
      }, true));
    }
    main.append(section);
  }

  async function enter(active: CloudSession): Promise<void> {
    if (state.pendingInvite) {
      state.session = active; client.currentSession = active;
      routers.invite();
      return;
    }
    const manage = options.initialManage;
    if (manage) {
      const workspace = active.workspaces.find(item => item.slug === manage.slug && item.role === 'admin');
      if (workspace) {
        state.session = active; client.currentSession = active;
        await options.onOpenWorkspace(workspace, client);
        return;
      }
    }
    // Un seul espace : on y entre, sans demander ou travailler. Le selecteur reste
    // joignable par le commutateur en pied de barre laterale.
    // Exclu quand un lien ?manage= est demande : son repli attendu est le selecteur.
    if (!manage && !options.forceWorkspacePicker && active.workspaces.length === 1) {
      state.session = active; client.currentSession = active;
      await options.onOpenWorkspace(active.workspaces[0], client);
      return;
    }
    await list();
  }

  function handleSessionFailure(reason: unknown): void {
    if (state.pendingInvite) {
      routers.invite();
      return;
    }
    routers['login-email']();
    if (!(reason instanceof CloudApiError && reason.status === 401)) error(reason);
  }

  async function boot(): Promise<void> {
    routers.boot();
    try {
      // Nothing is cached at boot — one read is the read. The re-check that
      // matters is in refresh(), which re-reads while the setup route is open
      // so a claim completed in another tab stops showing the assistant.
      state.instance = await client.instance();
      document.title = brandedTitle('Connexion', state.instance.name);
      if (state.instance.setupRequired) {
        routers.setup();
        return;
      }
      try {
        state.session = await client.session();
        await enter(state.session);
      } catch (reason) {
        handleSessionFailure(reason);
      }
    } catch {
      routers.unreachable();
    }
  }

  await boot();
  return {
    destroy() { state.alive = false; view.remove(); },
    async refresh() {
      if (!state.alive) return;
      await run(async () => {
        if (state.route === 'setup') {
          state.instance = await client.instance();
          if (state.instance.setupRequired) { routers.setup(); return; }
        }
        if (state.session) await list();
        else login();
      });
    },
  };
}
