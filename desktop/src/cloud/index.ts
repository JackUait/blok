import './cloud.css';
import {createChoice, styleTextField, type ChoiceControl} from '../ui/controls';
import {CloudApiError, CloudClient, type CloudRole, type CloudSession, type CloudSessionAdapter, type CloudWorkspace, type CloudWorkspaceStatus} from './client';
export * from './client';
export interface CloudGatewayOptions {
  apiOrigin?: string;
  sessionAdapter?: CloudSessionAdapter;
  allowLocal?: boolean;
  initialManage?: {slug: string; section?: 'members' | 'invites'};
  onOpenWorkspace(workspace: CloudWorkspace, client: CloudClient): void | Promise<void>;
  onOpenLocal?(): void | Promise<void>;
  onServerChange?(origin: string): void | Promise<void>;
}
export interface CloudGateway { destroy(): void; refresh(): Promise<void> }
interface Member { id: string; email: string; role: CloudRole }
interface JoinRequest { id: string; email: string; message?: string; status: string }
interface Invite { id: string; email: string; role: CloudRole; status: string }
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
function roleSelect(value: CloudRole, admin = true, label = 'Rôle', onChange: (value: CloudRole) => void = () => {}): ChoiceControl<CloudRole> {
  return createChoice({label,value,options: (admin ? ['member','viewer','admin'] : ['member','viewer']).map(role => ({value:role as CloudRole,label:roleName[role as CloudRole]})),onChange});
}
const roleName: Record<CloudRole, string> = {admin:'Administrateur', member:'Membre', viewer:'Lecture seule'};
export async function mountCloudGateway(root: HTMLElement, options: CloudGatewayOptions): Promise<CloudGateway> {
  const client = new CloudClient({origin:options.apiOrigin, sessionAdapter:options.sessionAdapter});
  const view = node('div', undefined, 'data-cloud-gateway'); view.setAttribute('data-blok-interface','');
  const choices: ChoiceControl<CloudRole>[] = [];
  function trackedRole(value: CloudRole, admin = true, label = 'Rôle', onChange?: (value: CloudRole) => void): ChoiceControl<CloudRole> {const choice = roleSelect(value,admin,label,onChange); choices.push(choice); return choice;}
  function disposeChoices(): void {for (const choice of choices) choice.destroy(); choices.length = 0;}
  root.replaceChildren(view);
  let alive = true;
  let session: CloudSession | null = null;
  let email = '';
  let currentMain: HTMLElement;
  function frame(): HTMLElement {
    disposeChoices();
    view.replaceChildren();
    const header = node('header');
    const brand = node('div', undefined, 'data-cloud-brand'); brand.append(node('span', 'T', 'data-cloud-mark'), node('span', 'Tousambassadeurs'));
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
  async function run(action: () => Promise<void>): Promise<void> {
    const buttons = Array.from(view.querySelectorAll<HTMLButtonElement>('button'));
    buttons.forEach(item => { item.disabled = true; });
    try { await action(); } catch (reason) { error(reason); }
    finally { buttons.forEach(item => {item.disabled = false;}); }
  }
  function login(codeStep = false): void {
    if (!alive) return;
    const main = frame(); main.setAttribute('data-cloud-narrow', '');
    main.append(node('span', 'Votre espace de travail partagé', 'data-cloud-eyebrow'), node('h1', codeStep ? 'Consultez votre boîte mail.' : 'Bienvenue chez\nTousambassadeurs.'));
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
    const status = await client.workspace('tousambassadeurs');
    if (!alive) return;
    session = active; client.currentSession = active;
    const main = frame();
    main.append(node('span', 'Vos espaces', 'data-cloud-eyebrow'), node('h1', 'Où souhaitez-vous travailler ?'), node('p', 'Choisissez un espace pour retrouver ses pages et son équipe.', 'data-cloud-muted'));
    for (const workspace of active.workspaces) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', workspace.name), node('p', roleName[workspace.role]));
      const actions = node('div', undefined, 'data-cloud-actions');
      if (workspace.role === 'admin') actions.append(button('Gérer', () => run(() => admin(workspace))));
      actions.append(button('Ouvrir l’espace', () => run(async () => {await options.onOpenWorkspace(workspace, client);}), true)); row.append(text, actions); main.append(row);
    }
    if (!status.role) joinSection(main, status);
    const details = node('details', undefined, 'data-cloud-section'); details.append(node('summary', 'Créer un espace de travail'));
    const form = node('form'); const name = field(form, 'Nom de l’espace', 'text', 'workspace-name'); const slug = field(form, 'Identifiant de l’espace', 'text', 'workspace-slug'); name.maxLength = 120; slug.pattern = '[a-z0-9][a-z0-9-]{1,62}'; slug.minLength = 2; slug.maxLength = 63; slug.placeholder = 'mon-equipe';
    const create = button('Créer l’espace', () => {}, true); create.type = 'submit'; form.append(create);
    form.addEventListener('submit', event => {event.preventDefault(); void run(async () => {await client.request('/api/workspaces', {method:'POST', body:JSON.stringify({name:name.value.trim(), slug:slug.value.trim()})}); await list();});}); details.append(form); main.append(details);
    if (options.allowLocal !== false && options.onOpenLocal) main.append(node('hr'), button('Ouvrir un espace local', () => run(async () => {await options.onOpenLocal!();})));
    serverSection(main);
  }
  function joinSection(main: HTMLElement, workspace: CloudWorkspaceStatus): void {
    const section = node('section', undefined, 'data-cloud-section'); section.append(node('h2', workspace.name));
    if (workspace.joinStatus === 'pending') {
      const status = node('div', undefined, 'data-cloud-status'); status.setAttribute('role', 'status'); status.append(node('strong', 'Votre demande est en attente'), node('p', 'Un administrateur doit valider votre accès. Vous pourrez ensuite ouvrir cet espace.')); section.append(status, button('Actualiser le statut', () => run(list)));
    } else if (workspace.joinStatus === 'rejected') {
      const status = node('div', undefined, 'data-cloud-status'); status.append(node('strong', 'Votre demande n’a pas été acceptée'), node('p', 'Contactez l’équipe Tousambassadeurs pour en savoir plus.')); section.append(status);
    } else {
      section.append(node('p', 'Rejoignez l’espace commun Tousambassadeurs. Votre accès sera validé par un administrateur.', 'data-cloud-muted'));
      const form = node('form'); const message = field(form, 'Un mot pour l’équipe (facultatif)', 'text', 'join-message'); message.required = false; message.maxLength = 1000;
      const submit = button('Demander à rejoindre', () => {}, true); submit.type = 'submit'; form.append(submit);
      form.addEventListener('submit', event => {event.preventDefault(); void run(async () => {await client.request(`/api/workspaces/${encodeURIComponent(workspace.slug)}/join-requests`, {method:'POST', body:JSON.stringify({message:message.value.trim()})}); await list();});}); section.append(form);
    }
    main.append(section);
  }
  async function enter(active: CloudSession): Promise<void> {
    const workspace = active.workspaces.find(item => item.slug === options.initialManage?.slug && item.role === 'admin');
    if (workspace) {
      session = active;
      try { await admin(workspace, options.initialManage?.section); return; }
      catch (reason) { if (!(reason instanceof CloudApiError && reason.status === 403)) throw reason; }
    }
    await list();
  }
  async function admin(workspace: CloudWorkspace, initialSection?: 'members' | 'invites'): Promise<void> {
    const base = `/api/workspaces/${encodeURIComponent(workspace.slug)}`;
    const [members, requests, invites] = await Promise.all([client.request<{members:Member[]}>(`${base}/members`), client.request<{requests:JoinRequest[]}>(`${base}/join-requests`), client.request<{invites:Invite[]}>(`${base}/invites`)]);
    if (!alive) return;
    const main = frame();
    const navigation = node('div', undefined, 'data-cloud-actions');
    navigation.append(button('← Tous les espaces', () => run(list)), button('Ouvrir l’espace', () => run(async () => {await options.onOpenWorkspace(workspace, client);})));
    main.append(navigation, node('h1', workspace.name), node('p', 'Gérez les accès à cet espace de travail.', 'data-cloud-muted'));
    const pending = requests.requests.filter(request => request.status === 'pending');
    const requestSection = node('section', undefined, 'data-cloud-section'); requestSection.append(node('h2', `Demandes en attente · ${pending.length}`));
    if (!pending.length) requestSection.append(node('p', 'Aucune demande en attente.', 'data-cloud-muted'));
    for (const request of pending) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', request.email)); if (request.message) text.append(node('p', request.message));
      const actions = node('div', undefined, 'data-cloud-actions'); const role = trackedRole('member', false);
      actions.append(role.element, button('Refuser', () => run(async () => {await client.request(`${base}/join-requests/${encodeURIComponent(request.id)}/reject`, {method:'POST', body:'{}'}); await admin(workspace);})), button('Accepter', () => run(async () => {await client.request(`${base}/join-requests/${encodeURIComponent(request.id)}/approve`, {method:'POST', body:JSON.stringify({role:role.value})}); await admin(workspace);}), true)); row.append(text, actions); requestSection.append(row);
    }
    main.append(requestSection);
    const memberSection = node('section', undefined, 'data-cloud-section'); memberSection.setAttribute('data-cloud-admin-members', '');
    const membersHeading = node('h2', `Membres · ${members.members.length}`); membersHeading.tabIndex = -1; memberSection.append(membersHeading);
    for (const member of members.members) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', member.email), node('p', member.id === session?.user.id ? 'Vous' : roleName[member.role]));
      const roles = trackedRole(member.role, true, `Rôle de ${member.email}`, (value) => {void run(async () => {try {await client.request(`${base}/members/${encodeURIComponent(member.id)}`, {method:'PATCH', body:JSON.stringify({role:value})}); await list();} catch (reason) {roles.setValue(member.role); throw reason;}});});
      row.append(text, roles.element); memberSection.append(row);
    }
    main.append(memberSection);
    const invitation = node('section', undefined, 'data-cloud-section'); invitation.append(node('h2', 'Inviter une personne'), node('p', 'L’invitation sera associée à son adresse e-mail.', 'data-cloud-muted'));
    const form = node('form'); const input = field(form, 'Adresse e-mail', 'email', 'invite-email'); const label = node('label', 'Accès'); const role = trackedRole('member', false); label.append(role.element); form.append(label);
    const submit = button('Envoyer l’invitation', () => {}, true); submit.type = 'submit'; form.append(submit);
    form.addEventListener('submit', event => {event.preventDefault(); void run(async () => {await client.request(`${base}/invites`, {method:'POST', body:JSON.stringify({email:input.value.trim(), role:role.value})}); await admin(workspace); const status = node('p', 'Invitation envoyée.', 'data-cloud-note'); status.setAttribute('role', 'status'); currentMain.append(status);});}); invitation.append(form);
    for (const invite of invites.invites.filter(item => item.status === 'pending')) {
      const row = node('div', undefined, 'data-cloud-row'); const text = node('div'); text.append(node('strong', invite.email), node('p', `Invitation en attente · ${roleName[invite.role]}`)); row.append(text, button('Révoquer', () => run(async () => {await client.request(`${base}/invites/${encodeURIComponent(invite.id)}`, {method:'DELETE'}); await admin(workspace);}))); invitation.append(row);
    }
    main.append(invitation);
    if (initialSection) {
      const target = initialSection === 'invites' ? input : membersHeading;
      target.scrollIntoView?.({block:'start'});
      target.focus({preventScroll:true});
    }
  }
  const main = frame(); main.append(node('p', 'Chargement de votre espace…', 'data-cloud-muted'));
  try {session = await client.session(); await enter(session);}
  catch (reason) {
    if (reason instanceof CloudApiError && reason.status === 401) login();
    else {login(); error(reason);}
  }
  return {destroy() {alive = false; disposeChoices(); view.remove();}, async refresh() {if (alive) {await run(async () => {if (session) await list(); else login();});}}};
}
