import {openModalDialog, type ModalDialogHandle} from '@blok/modal-dialog';
import {IconPeople} from '../../../src/components/icons';
import {CloudClient, type CloudRole} from './client';
import './workspace-settings.css';

export interface WorkspaceMembersOptions {client: CloudClient; slug: string; onInvite?: () => void}
export interface WorkspaceMembersHandle {destroy(): void; refresh(): Promise<void>}
export interface WorkspaceInvitationOptions {
  client: CloudClient;
  slug: string;
  workspaceName?: string;
  /** Nest inside the existing settings dialog when opened from its members panel. */
  container?: HTMLElement;
  onComplete?: () => void | Promise<void>;
}
interface Member {id: string; email: string; role: CloudRole}
interface JoinRequest {id: string; email: string; message?: string; status: string}
interface Invite {id: string; email: string; role: CloudRole; status: string}
type Tab = 'members' | 'requests' | 'invites';
const roleNames: Record<CloudRole,string> = {admin:'Administrateur',member:'Membre',viewer:'Lecture seule'};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attribute?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text) node.textContent = text; if (attribute) node.setAttribute(attribute,''); return node;
}
function action(label: string, callback: () => void, primary = false): HTMLButtonElement {
  const node = el('button',label,'data-cloud-settings-button'); node.type = 'button'; if (primary) node.setAttribute('data-cloud-settings-primary',''); node.addEventListener('click',callback); return node;
}
function rolePicker(role: CloudRole, label: string, admin = false): HTMLSelectElement {
  const select = el('select',undefined,'data-desktop-settings-theme'); select.setAttribute('aria-label',label);
  for (const value of (admin ? ['member','viewer','admin'] : ['member','viewer']) as CloudRole[]) {const option=el('option',roleNames[value]);option.value=value;option.selected=value===role;select.append(option);} return select;
}
function message(error: unknown): string {return error instanceof Error ? error.message : 'La demande n’a pas pu aboutir. Réessayez.';}

/** Mounts into the existing settings panel; disposing never changes its parent. */
export function mountWorkspaceMembers(container: HTMLElement, options: WorkspaceMembersOptions): WorkspaceMembersHandle {
  const base = `/api/workspaces/${encodeURIComponent(options.slug)}`;
  const panel = el('div',undefined,'data-cloud-members-panel'); container.append(panel);
  const toolbar = el('div',undefined,'data-cloud-members-toolbar');
  toolbar.append(el('p','Les personnes qui ont accès à cet espace.','data-cloud-settings-muted'));
  let alive = true; let busy = false; let generation = 0; let read: AbortController | undefined;
  let loaded = false;
  let tab: Tab = 'members'; let members: Member[] = []; let requests: JoinRequest[] = []; let invites: Invite[] = [];
  const invite = action('Inviter des membres',() => {
    if (options.onInvite) options.onInvite();
    else openWorkspaceInvitation({client:options.client,slug:options.slug,container:container.closest<HTMLElement>('[data-desktop-settings-dialog]') ?? undefined,onComplete:refresh});
  },true); toolbar.append(invite);
  const tabs = el('div',undefined,'data-cloud-members-tabs'); tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Accès à l’espace');
  const buttons = new Map<Tab,HTMLButtonElement>();
  const labels: Record<Tab,string> = {members:'Membres',requests:'Demandes',invites:'Invitations'};
  const list = el('div',undefined,'data-cloud-members-list'); list.id = `cloud-members-${crypto.randomUUID()}`; list.setAttribute('role','tabpanel');
  for (const value of ['members','requests','invites'] as Tab[]) {
    const button = action(labels[value],() => {tab=value;render();}); button.setAttribute('role','tab'); button.id=`${list.id}-${value}`; button.setAttribute('aria-controls',list.id); buttons.set(value,button); tabs.append(button);
    button.addEventListener('keydown',event => {if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;event.preventDefault();const values=[...buttons.keys()];const index=values.indexOf(tab);tab=values[event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3];render();buttons.get(tab)?.focus();});
  }
  const search = el('input',undefined,'data-desktop-settings-name'); search.type='search';search.placeholder='Rechercher une personne…';search.setAttribute('aria-label','Rechercher parmi les accès'); search.addEventListener('input',render);
  const error = el('p',undefined,'data-cloud-settings-error'); error.setAttribute('role','alert');error.hidden=true;
  panel.append(toolbar,tabs,search,error,list);
  function showError(reason: unknown): void {if (alive) {error.textContent=message(reason);error.hidden=false;}}
  function row(email: string, subtitle?: string): {root: HTMLElement; controls: HTMLElement} {
    const root=el('div',undefined,'data-cloud-member-row');const identity=el('div',undefined,'data-cloud-member-identity');const avatar=el('span',email.charAt(0).toUpperCase(),'data-cloud-member-avatar');avatar.setAttribute('aria-hidden','true');
    const text=el('div');text.append(el('strong',email));if(subtitle)text.append(el('p',subtitle,'data-cloud-settings-muted'));identity.append(avatar,text);
    const controls=el('div',undefined,'data-cloud-member-actions');root.append(identity,controls);return {root,controls};
  }
  async function mutate(path: string, method: string, body?: unknown): Promise<void> {
    if (busy || !alive) return; busy=true;error.hidden=true;panel.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select').forEach(node=>{node.disabled=true;});
    try {await options.client.request(`${base}${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});await refresh();}
    catch(reason){showError(reason);}
    finally {busy=false;if(alive)panel.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select').forEach(node=>{node.disabled=false;});}
  }
  function render(): void {
    if (!alive) return;
    const pending=requests.filter(item=>item.status==='pending');const outstanding=invites.filter(item=>item.status==='pending');
    const counts={members:members.length,requests:pending.length,invites:outstanding.length};
    for (const [value,button] of buttons) {button.textContent=`${labels[value]}${counts[value]?` · ${counts[value]}`:''}`;button.setAttribute('aria-selected',String(value===tab));button.tabIndex=value===tab?0:-1;}
    list.setAttribute('aria-labelledby',buttons.get(tab)!.id);list.replaceChildren();
    const needle=search.value.trim().toLocaleLowerCase();
    const items=tab==='members'?members:tab==='requests'?pending:outstanding;
    const shown=items.filter(item=>item.email.toLocaleLowerCase().includes(needle));
    if (!shown.length) {list.append(el('p',needle?'Aucun résultat.':tab==='members'?'Aucun membre.':tab==='requests'?'Aucune demande en attente.':'Aucune invitation en attente.','data-cloud-members-empty'));return;}
    for (const item of shown) {
      const {root,controls}=row(item.email,tab==='members'?roleNames[(item as Member).role]:tab==='requests'?(item as JoinRequest).message:roleNames[(item as Invite).role]);
      if(tab==='members') {
        const member=item as Member;const role=rolePicker(member.role,`Rôle de ${member.email}`,true);
        role.addEventListener('change',()=>{const value=role.value;role.value=member.role;void mutate(`/members/${encodeURIComponent(member.id)}`,'PATCH',{role:value});});
        controls.append(role,action('Retirer',()=>{void mutate(`/members/${encodeURIComponent(member.id)}`,'DELETE');}));
      } else if(tab==='requests') {
        const role=rolePicker('member',`Accès pour ${item.email}`);
        controls.append(role,action('Refuser',()=>{void mutate(`/join-requests/${encodeURIComponent(item.id)}/reject`,'POST',{});}),action('Accepter',()=>{void mutate(`/join-requests/${encodeURIComponent(item.id)}/approve`,'POST',{role:role.value});},true));
      } else controls.append(el('span','En attente','data-cloud-settings-muted'),action('Révoquer',()=>{void mutate(`/invites/${encodeURIComponent(item.id)}`,'DELETE');}));
      list.append(root);
    }
  }
  async function refresh(): Promise<void> {
    if(!alive)return;error.hidden=true;const turn=++generation;read?.abort();read=new AbortController();const signal=read.signal;
    try {
      const [m,r,i]=await Promise.all([options.client.request<{members:Member[]}>(`${base}/members`,{signal}),options.client.request<{requests:JoinRequest[]}>(`${base}/join-requests`,{signal}),options.client.request<{invites:Invite[]}>(`${base}/invites`,{signal})]);
      if(!alive||turn!==generation)return;members=m.members;requests=r.requests;invites=i.invites;loaded=true;render();
    } catch(reason){if(!signal.aborted&&alive){showError(reason);if(!loaded){list.replaceChildren(el('p','Les accès ne sont pas disponibles pour le moment.','data-cloud-members-empty'),action('Réessayer',()=>{void refresh();}));}}}
  }
  list.append(el('p','Chargement des membres…','data-cloud-settings-muted'));void refresh();
  return {refresh,destroy(){alive=false;++generation;read?.abort();panel.remove();}};
}

/** Compact editor overlay using the repository's modal/focus/Top Layer primitive. */
export function openWorkspaceInvitation(options: WorkspaceInvitationOptions): {close(): void} {
  const overlay=el('div',undefined,'data-desktop-settings-overlay');overlay.setAttribute('data-cloud-invitation','');
  const surface=el('section',undefined,'data-cloud-invite-dialog');
  const icon=el('div',undefined,'data-cloud-invite-icon');icon.innerHTML=IconPeople;
  const title=el('h2','Ajouter des membres');const intro=el('p',options.workspaceName?`Invitez des personnes dans ${options.workspaceName}.`:'Invitez des personnes à rejoindre votre espace.','data-cloud-settings-muted');
  const form=el('form');const emailLabel=el('label','Adresses e-mail');const email=el('input',undefined,'data-desktop-settings-name');email.type='text';email.inputMode='email';email.autocomplete='email';email.placeholder='nom@entreprise.fr, autre@entreprise.fr';emailLabel.append(email);
  const hint=el('p','Séparez les adresses par une virgule.','data-cloud-invite-hint');
  const roleLabel=el('label','Accès à l’espace');const role=rolePicker('member','Accès à l’espace');roleLabel.append(role);
  const messageLabel=el('label','Message (facultatif)');const note=el('textarea');note.rows=3;note.maxLength=2000;note.placeholder='Ajoutez un mot à votre invitation…';messageLabel.append(note);
  const error=el('p',undefined,'data-cloud-settings-error');error.setAttribute('role','alert');error.hidden=true;
  const status=el('p',undefined,'data-cloud-settings-muted');status.setAttribute('role','status');status.hidden=true;
  let alive=true;let busy=false;let handle:ModalDialogHandle;
  const close=():void=>{if(!alive)return;alive=false;handle.close();};
  const actions=el('div',undefined,'data-cloud-invite-actions');const cancel=action('Annuler',()=>close());const submit=action('Envoyer l’invitation',()=>{},true);submit.type='submit';actions.append(cancel,submit);
  form.append(emailLabel,hint,roleLabel,messageLabel,error,status,actions);surface.append(icon,title,intro,form);overlay.append(surface);
  form.addEventListener('submit',event=>{event.preventDefault();if(busy)return;void send();});
  async function send():Promise<void> {
    const addresses=[...new Set(email.value.split(/[,;\n]+/).map(value=>value.trim().toLowerCase()).filter(Boolean))];
    error.hidden=true;
    if(!addresses.length||addresses.some(value=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value))){error.textContent='Saisissez une ou plusieurs adresses e-mail valides.';error.hidden=false;email.focus();return;}
    if(addresses.length>25){error.textContent='Invitez au maximum 25 personnes à la fois.';error.hidden=false;return;}
    busy=true;for(const control of [email,role,note,cancel,submit])control.disabled=true;
    const failed:{email:string;reason:string}[]=[];let sent=0;
    status.hidden=false;
    for(const address of addresses){
      if(!alive)break;status.textContent=`Envoi des invitations… ${sent+failed.length+1}/${addresses.length}`;
      try {await options.client.request(`/api/workspaces/${encodeURIComponent(options.slug)}/invites`,{method:'POST',body:JSON.stringify({email:address,role:role.value,...(note.value.trim()?{message:note.value.trim()}:{})})});sent++;}
      catch(reason){failed.push({email:address,reason:message(reason)});}
    }
    if(!alive)return;
    busy=false;for(const control of [email,role,note,cancel,submit])control.disabled=false;
    if(sent){try{await options.onComplete?.();}catch{/* Invitations already sent: never retry a successful address. */}}
    if(!alive)return;
    if(!failed.length){close();return;}
    email.value=failed.map(item=>item.email).join(', ');
    status.textContent=sent?`${sent} invitation${sent>1?'s':''} envoyée${sent>1?'s':''}.`:'';status.hidden=!sent;
    error.textContent=failed.map(item=>`${item.email} : ${item.reason}`).join('\n');error.hidden=false;email.focus();
  }
  handle=openModalDialog({content:overlay,surface,label:'Ajouter des membres',initialFocus:()=>email,container:options.container,onDismiss:()=>{if(!busy)close();},onClose:()=>{alive=false;}});
  return {close};
}
