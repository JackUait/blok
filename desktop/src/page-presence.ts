import type {CollaborationParticipant, CollaborationStatusChangedPayload} from '../../types/events/editor-events';
import {profileInitial} from './profile-identity';
import './page-presence.css';

type Identity = {id: string; name: string; photo: string | null};
type Person = {key: string; userId: string | null; name: string; self: boolean; agent: boolean; blockId: string | null; sessions: Set<number>};

/** Count verified people, not their open tabs. Unknown identities stay separate. */
function people(participants: CollaborationParticipant[], self: Identity): Person[] {
  const rows = new Map<string, Person>();
  rows.set('self', {key:'self', userId:self.id, name:self.name, self:true, agent:false, blockId:null, sessions:new Set()});
  for (const peer of participants.filter(item => item.present)) {
    const own = !peer.agent && (peer.self || peer.userId === self.id);
    const id = peer.userId ? `user:${peer.userId}` : `client:${peer.clientIds.join(',')}`;
    const key = own ? 'self' : `${peer.agent ? 'agent:' : ''}${id}`;
    const existing = rows.get(key);
    if (existing) { peer.clientIds.forEach(clientId => existing.sessions.add(clientId)); continue; }
    rows.set(key, {key, userId:peer.userId, name:peer.user.name || peer.user.label || 'Visiteur', self:false, agent:!!peer.agent, blockId:peer.blockId, sessions:new Set(peer.clientIds)});
  }
  return [...rows.values()];
}

export function createPagePresence(options: {self(): Identity; onLocate(blockId: string): void; onProfile?(userId: string): void}) {
  const element = document.createElement('details'); element.setAttribute('data-page-presence', '');
  const summary = document.createElement('summary'); summary.setAttribute('aria-label', 'Personnes sur cette page');
  const avatar = document.createElement('span'); avatar.setAttribute('data-page-presence-avatar', ''); avatar.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.setAttribute('data-page-presence-label', ''); summary.append(avatar, label);
  const panel = document.createElement('div'); panel.setAttribute('data-page-presence-panel', '');
  const heading = document.createElement('strong'); heading.textContent = 'Sur cette page';
  const list = document.createElement('ul'); panel.append(heading, list); element.append(summary, panel);
  const state = {status:'connecting' as CollaborationStatusChangedPayload['status'], participants:[] as CollaborationParticipant[]};
  const lifetime = new AbortController();
  const close = (): void => { element.open = false; };
  document.addEventListener('pointerdown', event => { if (event.target instanceof Node && !element.contains(event.target)) close(); }, {signal:lifetime.signal});
  element.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); summary.focus(); event.stopPropagation(); } });
  const renderPerson = (person: Person): HTMLLIElement => {
    const row = document.createElement('li'); row.setAttribute('data-page-presence-person', '');
    const profileId = !person.agent ? person.userId : null;
    const text = document.createElement(profileId && options.onProfile ? 'button' : 'span'); text.textContent = person.name;
    if (text instanceof HTMLButtonElement && profileId) {
      text.type = 'button'; text.setAttribute('data-page-presence-profile', profileId);
      text.setAttribute('aria-label', `Voir le profil de ${person.name}`);
      text.addEventListener('click', () => { close(); options.onProfile?.(profileId); });
    }
    if (person.self) text.textContent += ' (vous)';
    else if (person.agent) text.textContent += ' · Agent';
    row.append(text);
    if (person.sessions.size > 1) { const sessions = document.createElement('small'); sessions.textContent = `${person.sessions.size} sessions ouvertes`; row.append(sessions); }
    if (person.blockId && !person.self) {
      const blockId = person.blockId;
      const locate = document.createElement('button'); locate.type = 'button'; locate.setAttribute('data-page-presence-locate', ''); locate.textContent = 'Rejoindre'; locate.setAttribute('aria-label', `Rejoindre ${person.name}`);
      locate.addEventListener('click', () => { options.onLocate(blockId); close(); }); row.append(locate);
    }
    return row;
  };
  const refresh = (): void => {
    const self = options.self();
    avatar.replaceChildren();
    if (self.photo) { const img = document.createElement('img'); img.src = self.photo; img.alt = ''; avatar.append(img); }
    else avatar.textContent = profileInitial(self.name);
    if (state.status !== 'connected') {
      label.textContent = state.status === 'connecting' ? 'Présence…' : 'Présence indisponible';
      summary.setAttribute('aria-label', label.textContent);
      list.replaceChildren(); const message = document.createElement('li'); message.textContent = 'La liste sera disponible une fois connecté.'; list.append(message);
      return;
    }
    const rows = people(state.participants, self);
    const otherPeople = rows.filter(row => !row.self && !row.agent).length;
    const agents = rows.filter(row => row.agent).length;
    if (otherPeople > 0) label.textContent = `Vous et ${otherPeople} autre${otherPeople > 1 ? 's personnes' : ' personne'}`;
    else label.textContent = agents ? 'Vous' : 'Vous seul';
    if (agents) label.textContent += ` · ${agents} agent${agents > 1 ? 's' : ''}`;
    summary.setAttribute('aria-label', `${label.textContent} sur cette page`);
    list.replaceChildren(...rows.map(renderPerson));
  };
  refresh();
  return {element, refresh, close, update(event: Partial<CollaborationStatusChangedPayload>) {
    if (event.status) state.status = event.status;
    if (event.participants) state.participants = event.participants;
    refresh();
  }, destroy() { lifetime.abort(); element.remove(); }};
}
