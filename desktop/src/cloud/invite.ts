import { WORKSPACE_ROLES } from '../access-vocabulary';
import { button, el } from '../ui/dom';
import type { CloudClient, CloudRole, CloudSession, CloudWorkspaceStatus } from './client';
import { CloudApiError } from './client';

/**
 * Invite acceptance screen (plan §10.4).
 *
 * Gaps (no invitee-facing invite API yet):
 * - Host display name is not exposed; we show the inviting address when given via
 *   `invite.host` / URL, otherwise omit the host line.
 * - Invitation message is delivery-only (not stored); only available if passed in.
 * - Expiry/revocation cannot be probed by the invitee — we infer “expired” when
 *   the workspace is missing (404) or the caller has no membership and no pending
 *   join after being told an invite existed.
 * Prefer wiring to a future `GET /api/invitations/:id` / `POST …/accept`.
 */
export interface InviteContext {
  /** Workspace slug from the invite link (`?invite=`). */
  slug: string;
  /** Address the invitation was sent to (`?email=`), when known. */
  email?: string;
  /** Host display name or email, when known. */
  host?: string;
  /** Role granted by the invite, when known. */
  role?: CloudRole;
  /** Plain-text note from the invitation email, when known. */
  message?: string;
}

export interface InviteScreenOptions {
  client: CloudClient;
  session: CloudSession | null;
  invite: InviteContext;
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  onSwitchAccount(): void | Promise<void>;
  onContinue(workspaceSlug: string): void | Promise<void>;
  onLogin(email?: string): void;
}

export function mountInviteScreen(options: InviteScreenOptions): void {
  const main = options.frame();
  main.setAttribute('data-cloud-narrow', '');
  main.append(
    el('span', { text: 'Invitation', attribute: 'data-cloud-eyebrow' }),
    el('h1', { text: 'Chargement de l’invitation…' }),
  );

  void options.run(async () => {
    await paint(main, options);
  });
}

async function paint(main: HTMLElement, options: InviteScreenOptions): Promise<void> {
  const { invite, session } = options;
  main.replaceChildren();
  main.setAttribute('data-cloud-narrow', '');
  main.append(el('span', { text: 'Invitation', attribute: 'data-cloud-eyebrow' }));

  if (invite.email && session && session.user.email.toLocaleLowerCase() !== invite.email.toLocaleLowerCase()) {
    main.append(el('h1', { text: 'Mauvais compte' }));
    main.append(el('p', {
      text: `Cette invitation est pour ${invite.email}, vous êtes connecté comme ${session.user.email}.`,
      attribute: 'data-cloud-muted',
    }));
    main.append(button({
      label: 'Changer de compte',
      primary: true,
      onClick: () => { void options.run(async () => { await options.onSwitchAccount(); }); },
    }));
    return;
  }

  if (!session) {
    main.append(el('h1', { text: 'Accepter l’invitation' }));
    appendInviteDetails(main, invite, null);
    main.append(el('p', {
      text: invite.email
        ? `Connectez-vous avec ${invite.email} pour rejoindre cet espace.`
        : 'Connectez-vous avec l’adresse invitée pour rejoindre cet espace.',
      attribute: 'data-cloud-muted',
    }));
    main.append(button({
      label: 'Continuer par e-mail',
      primary: true,
      onClick: () => { options.onLogin(invite.email); },
    }));
    return;
  }

  let workspace: CloudWorkspaceStatus;
  try {
    workspace = await options.client.workspace(invite.slug);
  } catch (reason) {
    if (reason instanceof CloudApiError && (reason.status === 404 || reason.status === 0)) {
      paintExpired(main, invite);
      return;
    }
    throw reason;
  }

  const membership = session.workspaces.find((item) => item.slug === invite.slug);
  const role = membership?.role ?? invite.role ?? (workspace.role ?? undefined);

  if (membership || workspace.role) {
    main.append(el('h1', { text: `Bienvenue dans ${workspace.name}` }));
    appendInviteDetails(main, { ...invite, role: role ?? undefined }, workspace);
    main.append(el('p', {
      text: 'Votre invitation a été acceptée. Vous pouvez ouvrir l’espace.',
      attribute: 'data-cloud-muted',
    }));
    main.append(button({
      label: 'Ouvrir l’espace',
      primary: true,
      onClick: () => { void options.run(async () => { await options.onContinue(invite.slug); }); },
    }));
    return;
  }

  // Signed in as the right person but not a member: invite likely expired/revoked,
  // or auto-accept has not run (plan §6.1 gap — accept only happens in verifyCode).
  paintExpired(main, { ...invite, host: invite.host }, workspace.name);
}

function paintExpired(main: HTMLElement, invite: InviteContext, workspaceName?: string): void {
  main.append(el('h1', { text: 'Invitation expirée' }));
  main.append(el('p', {
    text: workspaceName
      ? `Cette invitation pour ${workspaceName} a expiré ou a été révoquée.`
      : `Cette invitation${invite.slug ? ` pour « ${invite.slug} »` : ''} a expiré ou a été révoquée.`,
    attribute: 'data-cloud-muted',
  }));
  main.append(el('p', {
    text: 'Demandez à un administrateur de vous renvoyer une invitation.',
    attribute: 'data-cloud-note',
  }));
}

function appendInviteDetails(main: HTMLElement, invite: InviteContext, workspace: CloudWorkspaceStatus | null): void {
  const card = el('div', { attribute: 'data-cloud-status' });
  if (invite.host) card.append(el('p', { text: `Invité par ${invite.host}` }));
  card.append(el('strong', { text: workspace?.name ?? invite.slug }));
  if (invite.role) card.append(el('p', { text: `Rôle : ${WORKSPACE_ROLES[invite.role]}` }));
  else if (workspace?.role) card.append(el('p', { text: `Rôle : ${WORKSPACE_ROLES[workspace.role]}` }));
  if (invite.message) card.append(el('p', { text: invite.message }));
  main.append(card);
}
