import './cloud.css';
import {WORKSPACE_ROLES} from '../access-vocabulary';
import {styleTextField} from '../ui/controls';
import {CloudApiError, CloudClient, type CloudInstance, type CloudSession, type CloudSessionAdapter, type CloudWorkspace, type CloudWorkspaceStatus} from './client';
import {mountCreateWorkspace} from './create-workspace';
import {mountInviteScreen, type InviteContext} from './invite';
import {mountJoinWorkspace} from './join';
import {mountSetupAssistant} from './setup';
import {mountUnreachable} from './unreachable';
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
  let alive = true;
  let session: CloudSession | null = null;
  let instance: CloudInstance | null = null;
  let email = '';
  let route: CloudGatewayRoute = 'boot';
  let currentMain: HTMLElement;
  let pendingInvite: InviteContext | null = options.initialInvite ?? readInviteFromLocation();

  function setRoute(next: CloudGatewayRoute): void {
    route = next;
    view.setAttribute('data-cloud-route', next);
  }

  function frame(next: CloudGatewayRoute): HTMLElement {
    setRoute(next);
    view.replaceChildren();
    const header = node('header');
    const brandName = instance?.name?.trim() || 'Blok';
    const brand = node('div', undefined, 'data-cloud-brand');
    brand.append(node('span', brandName.charAt(0).toLocaleUpperCase(), 'data-cloud-mark'), node('span', brandName));
    const nav = node('nav'); nav.setAttribute('aria-label', 'Compte');
    if (session) {
      nav.append(node('span', session.user.email, 'data-cloud-muted'), button('Changer de compte', () => run(async () => {await client.logout(); session = null; email = ''; login();})), button('Se déconnecter', () => run(async () => {await client.logout(); session = null; login();})));
    }
    header.append(brand, nav);
    currentMain = node('main');
    view.append(header, currentMain, node('footer', 'Un espace commun pour les idées, les documents et les projets.'));
    return currentMain;
  }

  function error(error: unknown): void {
    if (!alive) return;
    view.querySelector('[data-cloud-error]')?.remove();
    const message = node('p', error instanceof Error ? error.message : 'Une erreur est survenue.', 'data-cloud-error');
    message.setAttribute('role', 'alert'); currentMain.append(message);
  }

  /**
   * Disable every button for the duration of an async action, then restore each
   * button's prior disabled state — including those that were already disabled
   * (setup assistant Continuer / Vérifier). Never blanket-enable.
   */
  async function run(action: () => Promise<void>): Promise<void> {
    const buttons = Array.from(view.querySelectorAll<HTMLButtonElement>('button'));
    const prior = buttons.map(item => item.disabled);
    buttons.forEach(item => { item.disabled = true; });
    try { await action(); } catch (reason) { error(reason); }
    finally { buttons.forEach((item, index) => {item.disabled = prior[index] ?? false;}); }
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
        email = claimedEmail;
        login(true);
        const note = node('p', `Un code a été envoyé à ${claimedEmail}.`, 'data-cloud-note');
        note.setAttribute('role', 'status');
        // Insert above the form so the handoff from setup is explicit (plan §9.2).
        const form = currentMain.querySelector('form');
        if (form) currentMain.insertBefore(note, form);
        else currentMain.append(note);
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
  }

  function invite(): void {
    const context = pendingInvite ?? readInviteFromLocation();
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
    pendingInvite = context;
    mountInviteScreen({
      client,
      session,
      invite: context,
      frame: () => frame('invite'),
      run,
      showError: error,
      onSwitchAccount: async () => {
        await client.logout();
        session = null;
        email = context.email ?? '';
        login();
      },
      onContinue: async (slug) => {
        const active = session ?? await client.session();
        session = active;
        client.currentSession = active;
        const workspace = active.workspaces.find(item => item.slug === slug);
        if (workspace) await options.onOpenWorkspace(workspace, client);
        else await list();
      },
      onLogin: (prefill) => {
        if (prefill) email = prefill;
        login();
      },
    });
  }

  function createWorkspace(): void {
    mountCreateWorkspace({
      client,
      instance,
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
      defaultSlug: instance?.defaultWorkspace?.slug,
      defaultName: instance?.defaultWorkspace?.name,
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

  function login(codeStep = false): void {
    if (!alive) return;
    const main = frame(codeStep ? 'login-code' : 'login-email'); main.setAttribute('data-cloud-narrow', '');
    const welcome = instance?.name ? `Bienvenue sur\n${instance.name}.` : 'Bienvenue.';
    main.append(node('span', 'Votre espace de travail partagé', 'data-cloud-eyebrow'), node('h1', codeStep ? 'Consultez votre boîte mail.' : welcome));
    main.append(node('p', codeStep ? `Saisissez le code envoyé à ${email}. Il est valable 10 minutes.` : 'Retrouvez votre équipe, partagez vos connaissances et faites avancer vos projets.', 'data-cloud-muted'));
    const form = node('form');
    const input = field(form, codeStep ? 'Code de connexion' : 'Adresse e-mail', codeStep ? 'text' : 'email', codeStep ? 'code' : 'email', codeStep ? '' : email);
    input.autocomplete = codeStep ? 'one-time-code' : 'email';
    if (codeStep) { input.inputMode = 'numeric'; input.pattern = '[0-9]{6}'; input.maxLength = 6; }
    const submit = button(codeStep ? 'Se connecter' : 'Continuer par e-mail', () => {}, true); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        if (codeStep) { session = await client.verifyCode(email, input.value.trim()); await enter(session); }
        else { email = input.value.trim(); await client.request('/api/auth/request-code', {method:'POST', body:JSON.stringify({email})}); login(true); }
      });
    });
    main.append(form);
    if (codeStep) {
      main.append(node('p', 'Le message peut se trouver dans vos courriers indésirables.', 'data-cloud-note'));
      main.append(button('Renvoyer un code', () => run(async () => {await client.request('/api/auth/request-code', {method:'POST', body:JSON.stringify({email})}); login(true); const status = node('p', 'Un nouveau code a été envoyé.', 'data-cloud-note'); status.setAttribute('role', 'status'); currentMain.append(status);})), document.createTextNode(' '), button('Modifier l’adresse e-mail', () => login()));
    } else main.append(node('p', 'Pas de mot de passe. Un code de connexion vous sera envoyé.', 'data-cloud-note'));
    if (options.allowLocal !== false && options.onOpenLocal) { main.append(node('hr'), button('Continuer avec un espace local', () => run(async () => {await options.onOpenLocal!();}))); }
    serverSection(main);
  }

  function serverSection(main: HTMLElement): void {
    if (!options.onServerChange) return;
    const details = node('details', undefined, 'data-cloud-section');
    details.append(node('summary', 'Se connecter à un autre serveur'));
    const serverForm = node('form');
    const initialOrigin = client.origin || (window.location.protocol.startsWith('http') ? window.location.origin : '');
    const server = field(serverForm, 'Adresse du serveur', 'url', 'server', initialOrigin);
    server.placeholder = 'https://votre-serveur.fr'; server.setAttribute('autocomplete', 'url'); server.spellcheck = false;
    const submitServer = button('Utiliser ce serveur', () => {}, true); submitServer.type = 'submit'; serverForm.append(submitServer);
    serverForm.addEventListener('submit', event => {event.preventDefault(); void run(async () => {
      let url: URL;
      try {url = new URL(server.value.trim());} catch {throw new Error('Saisissez l’adresse complète du serveur, par exemple https://votre-serveur.fr.');}
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Utilisez une adresse HTTPS sans identifiants.');
      await options.onServerChange!(url.origin);
    });});
    details.append(node('p', 'Chaque serveur conserve ses propres comptes et espaces.', 'data-cloud-note'), serverForm); main.append(details);
  }

  async function list(): Promise<void> {
    const active = await client.session();
    const defaultWorkspace = instance?.defaultWorkspace;
    const status = defaultWorkspace ? await client.workspace(defaultWorkspace.slug) : null;
    if (!alive) return;
    session = active; client.currentSession = active;
    const main = frame('spaces');
    main.append(node('span', 'Vos espaces', 'data-cloud-eyebrow'), node('h1', 'Où souhaitez-vous travailler ?'), node('p', 'Choisissez un espace pour retrouver ses pages et son équipe.', 'data-cloud-muted'));
    for (const workspace of active.workspaces) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', workspace.name), node('p', roleName[workspace.role]));
      const actions = node('div', undefined, 'data-cloud-actions');
      actions.append(button('Ouvrir l’espace', () => run(async () => {await options.onOpenWorkspace(workspace, client);}), true)); row.append(text, actions); main.append(row);
    }
    if (status && !status.role) joinSection(main, status);
    const actions = node('div', undefined, 'data-cloud-actions');
    actions.append(
      button('Créer un espace de travail', () => routers['create-workspace'](), true),
      button('Rejoindre un espace', () => routers.join()),
    );
    main.append(actions);
    if (options.allowLocal !== false && options.onOpenLocal) main.append(node('hr'), button('Ouvrir un espace local', () => run(async () => {await options.onOpenLocal!();})));
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
        pendingInvite = null;
        routers.join();
      }, true));
    }
    main.append(section);
  }

  async function enter(active: CloudSession): Promise<void> {
    if (pendingInvite) {
      session = active; client.currentSession = active;
      routers.invite();
      return;
    }
    const manage = options.initialManage;
    if (manage) {
      const workspace = active.workspaces.find(item => item.slug === manage.slug && item.role === 'admin');
      if (workspace) {
        session = active; client.currentSession = active;
        await options.onOpenWorkspace(workspace, client);
        return;
      }
    }
    // Un seul espace : on y entre, sans demander ou travailler. Le selecteur reste
    // joignable par le commutateur en pied de barre laterale.
    // Exclu quand un lien ?manage= est demande : son repli attendu est le selecteur.
    if (!manage && active.workspaces.length === 1) {
      session = active; client.currentSession = active;
      await options.onOpenWorkspace(active.workspaces[0], client);
      return;
    }
    await list();
  }

  async function boot(): Promise<void> {
    routers.boot();
    try {
      // Never trust a cached setupRequired: re-check before rendering setup (plan §9.2).
      instance = await client.instance();
      instance = await client.instance();
      if (instance.name) document.title = `${instance.name} — Connexion`;
      if (instance.setupRequired) {
        routers.setup();
        return;
      }
      try {
        session = await client.session();
        await enter(session);
      } catch (reason) {
        if (pendingInvite) {
          routers.invite();
          return;
        }
        if (reason instanceof CloudApiError && reason.status === 401) routers['login-email']();
        else { routers['login-email'](); error(reason); }
      }
    } catch {
      routers.unreachable();
    }
  }

  await boot();
  return {
    destroy() {alive = false; view.remove();},
    async refresh() {
      if (!alive) return;
      await run(async () => {
        if (route === 'setup') {
          instance = await client.instance();
          if (instance.setupRequired) { routers.setup(); return; }
        }
        if (session) await list();
        else login();
      });
    },
  };
}
