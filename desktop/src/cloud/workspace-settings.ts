import {openModalDialog, type ModalDialogHandle} from '@blok/modal-dialog';
import {PopoverDesktop} from '@blok/popover';
import {IconPeople, IconDotsHorizontal, IconTrash} from '../../../src/components/icons';
import {CloudClient, type CloudRole} from './client';
import './workspace-settings.css';
import {createChoice, styleTextField, wrapSearchField, type ChoiceControl} from '../ui/controls';

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
  const node = el('button',label,'data-cloud-settings-button'); node.type = 'button'; node.classList.add('blok-button'); if (primary) node.setAttribute('data-cloud-settings-primary',''); node.addEventListener('click',callback); return node;
}
function rolePicker(role: CloudRole, label: string, admin = false, onChange: (value: CloudRole) => void = () => {}): ChoiceControl<CloudRole> {
  return createChoice({label,value:role,options: (admin ? ['member','viewer','admin'] : ['member','viewer']).map(value => ({value:value as CloudRole,label:roleNames[value as CloudRole]})),onChange});
}
function message(error: unknown): string {return error instanceof Error ? error.message : 'La demande n’a pas pu aboutir. Réessayez.';}

/** Mounts into the existing settings panel; disposing never changes its parent. */
export function mountWorkspaceMembers(container: HTMLElement, options: WorkspaceMembersOptions): WorkspaceMembersHandle {
  const base = `/api/workspaces/${encodeURIComponent(options.slug)}`;
  const panel = el('div',undefined,'data-cloud-members-panel'); container.append(panel);
  const toolbar = el('div',undefined,'data-cloud-members-toolbar');
  toolbar.append(el('p','Gérez les personnes qui ont accès à cet espace de travail.','data-cloud-settings-muted'));
  let alive = true; let busy = false; let generation = 0; let read: AbortController | undefined;
  const choices: ChoiceControl<CloudRole>[] = [];
  const rowMenus: {destroy():void}[] = [];
  function disposeChoices(): void {for(const choice of choices)choice.destroy();choices.length=0;for(const menu of rowMenus)menu.destroy();rowMenus.length=0;}
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
  const search = el('input',undefined,'data-cloud-members-search'); styleTextField(search); search.type='search';search.placeholder='Rechercher une personne…';search.setAttribute('aria-label','Rechercher parmi les accès'); search.addEventListener('input',render);
  const error = el('p',undefined,'data-cloud-settings-error'); error.setAttribute('role','alert');error.hidden=true;
  const searchField=wrapSearchField(search);searchField.setAttribute('data-cloud-members-search-field','');
  panel.append(toolbar,tabs,searchField,error,list);
  function showError(reason: unknown): void {if (alive) {error.textContent=message(reason);error.hidden=false;}}
  function row(email: string, subtitle?: string): {root: HTMLElement; controls: HTMLElement} {
    const root=el('tr',undefined,'data-cloud-member-row');const identityCell=el('td');const identity=el('div',undefined,'data-cloud-member-identity');const avatar=el('span',email.charAt(0).toUpperCase(),'data-cloud-member-avatar');avatar.setAttribute('aria-hidden','true');
    const text=el('div');text.append(el('strong',email));if(subtitle)text.append(el('p',subtitle,'data-cloud-settings-muted'));identity.append(avatar,text);
    const controlsCell=el('td');const controls=el('div',undefined,'data-cloud-member-actions');identityCell.append(identity);controlsCell.append(controls);root.append(identityCell,controlsCell);return {root,controls};
  }
  function memberMenu(member: Member): HTMLButtonElement {
    const trigger=action('',()=>open());trigger.innerHTML=IconDotsHorizontal;trigger.setAttribute('data-cloud-member-menu','');trigger.setAttribute('aria-label',`Actions pour ${member.email}`);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    let popup:PopoverDesktop|null=null;let destroyed=false;
    function open():void {
      if(trigger.disabled||destroyed)return;if(popup?.isShown){popup.hide();return;}
      const menu=new PopoverDesktop({trigger,width:'auto',minWidth:'220px',items:[{name:'remove',title:'Retirer de l’espace',icon:IconTrash,isDestructive:true,closeOnActivate:true,onActivate:()=>{void mutate(`/members/${encodeURIComponent(member.id)}`,'DELETE');}}]});popup=menu;let settled=false;
      const palette=getComputedStyle(trigger);for(const token of ['--blok-popover-bg','--blok-popover-border','--blok-text-primary','--blok-text-secondary','--blok-item-hover-bg'])menu.getElement().style.setProperty(token,palette.getPropertyValue(token));
      trigger.setAttribute('aria-expanded','true');menu.on('closed',()=>{if(settled)return;settled=true;if(popup===menu){popup=null;trigger.setAttribute('aria-expanded','false');}if(trigger.isConnected&&!trigger.disabled&&!destroyed)trigger.focus();queueMicrotask(()=>menu.destroy());});menu.show();menu.focusItemByName('remove');
    }
    rowMenus.push({destroy(){destroyed=true;popup?.destroy();popup=null;trigger.setAttribute('aria-expanded','false');}});return trigger;
  }
  async function mutate(path: string, method: string, body?: unknown): Promise<void> {
    if (busy || !alive) return; busy=true;error.hidden=true;panel.querySelectorAll<HTMLButtonElement>('button').forEach(node=>{node.disabled=true;});for(const choice of choices)choice.disabled=true;
    try {await options.client.request(`${base}${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});await refresh();}
    catch(reason){showError(reason);}
    finally {busy=false;if(alive)panel.querySelectorAll<HTMLButtonElement>('button').forEach(node=>{node.disabled=false;});for(const choice of choices)choice.disabled=false;}
  }
  function render(): void {
    if (!alive) return;
    const pending=requests.filter(item=>item.status==='pending');const outstanding=invites.filter(item=>item.status==='pending');
    const counts={members:members.length,requests:pending.length,invites:outstanding.length};
    for (const [value,button] of buttons) {button.replaceChildren(document.createTextNode(labels[value]));if(loaded){const count=el('span',String(counts[value]),'data-cloud-members-count');button.append(document.createTextNode(' '),count);}button.setAttribute('aria-selected',String(value===tab));button.tabIndex=value===tab?0:-1;}
    list.setAttribute('aria-labelledby',buttons.get(tab)!.id);disposeChoices();list.replaceChildren();
    const needle=search.value.trim().toLocaleLowerCase();
    const items=tab==='members'?members:tab==='requests'?pending:outstanding;
    const shown=items.filter(item=>item.email.toLocaleLowerCase().includes(needle));
    if (!shown.length) {list.append(el('p',needle?'Aucun résultat.':tab==='members'?'Aucun membre.':tab==='requests'?'Aucune demande en attente.':'Aucune invitation en attente.','data-cloud-members-empty'));return;}
    const table=el('table',undefined,'data-cloud-members-table');const head=el('thead');const heading=el('tr');heading.append(el('th','Utilisateur'),el('th',tab==='members'?'Rôle':tab==='requests'?'Accès et décision':'Invitation'));head.append(heading);const body=el('tbody');table.append(head,body);list.append(table);
    for (const item of shown) {
      const {root,controls}=row(item.email,tab==='members'?undefined:tab==='requests'?(item as JoinRequest).message:roleNames[(item as Invite).role]);
      if(tab==='members') {
        const member=item as Member;const role=rolePicker(member.role,`Rôle de ${member.email}`,true,value=>{role.setValue(member.role);void mutate(`/members/${encodeURIComponent(member.id)}`,'PATCH',{role:value});});choices.push(role);
        controls.append(role.element,memberMenu(member));
      } else if(tab==='requests') {
        const role=rolePicker('member',`Accès pour ${item.email}`);choices.push(role);
        controls.append(role.element,action('Refuser',()=>{void mutate(`/join-requests/${encodeURIComponent(item.id)}/reject`,'POST',{});}),action('Accepter',()=>{void mutate(`/join-requests/${encodeURIComponent(item.id)}/approve`,'POST',{role:role.value});},true));
      } else controls.append(el('span','En attente','data-cloud-settings-muted'),action('Révoquer',()=>{void mutate(`/invites/${encodeURIComponent(item.id)}`,'DELETE');}));
      body.append(root);
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
  return {refresh,destroy(){alive=false;++generation;read?.abort();disposeChoices();panel.remove();}};
}

/** Compact editor overlay using the repository's modal/focus/Top Layer primitive. */
export function openWorkspaceInvitation(options: WorkspaceInvitationOptions): {close(): void} {
  const overlay=el('div',undefined,'data-desktop-settings-overlay');overlay.setAttribute('data-cloud-invitation','');
  const surface=el('section',undefined,'data-cloud-invite-dialog');
  const icon=el('div',undefined,'data-cloud-invite-icon');icon.innerHTML=IconPeople;
  const title=el('h2','Ajouter des membres');const intro=el('p',options.workspaceName?`Invitez des personnes dans ${options.workspaceName}.`:'Invitez des personnes à rejoindre votre espace.','data-cloud-settings-muted');
  const form=el('form');const emailLabel=el('label','Adresses e-mail');const email=el('input');styleTextField(email);email.type='text';email.inputMode='email';email.autocomplete='email';email.placeholder='nom@entreprise.fr, autre@entreprise.fr';emailLabel.append(email);
  const hint=el('p','Séparez les adresses par une virgule.','data-cloud-invite-hint');
  const roleLabel=el('label','Accès à l’espace');const role=rolePicker('member','Accès à l’espace');roleLabel.append(role.element);
  const messageLabel=el('label','Message (facultatif)');const note=el('textarea');styleTextField(note);note.rows=3;note.maxLength=2000;note.placeholder='Ajoutez un mot à votre invitation…';messageLabel.append(note);
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
    busy=true;for(const control of [email,note,cancel,submit])control.disabled=true;role.disabled=true;
    const failed:{email:string;reason:string}[]=[];let sent=0;
    status.hidden=false;
    for(const address of addresses){
      if(!alive)break;status.textContent=`Envoi des invitations… ${sent+failed.length+1}/${addresses.length}`;
      try {await options.client.request(`/api/workspaces/${encodeURIComponent(options.slug)}/invites`,{method:'POST',body:JSON.stringify({email:address,role:role.value,...(note.value.trim()?{message:note.value.trim()}:{})})});sent++;}
      catch(reason){failed.push({email:address,reason:message(reason)});}
    }
    if(!alive)return;
    busy=false;for(const control of [email,note,cancel,submit])control.disabled=false;role.disabled=false;
    if(sent){try{await options.onComplete?.();}catch{/* Invitations already sent: never retry a successful address. */}}
    if(!alive)return;
    if(!failed.length){close();return;}
    email.value=failed.map(item=>item.email).join(', ');
    status.textContent=sent?`${sent} invitation${sent>1?'s':''} envoyée${sent>1?'s':''}.`:'';status.hidden=!sent;
    error.textContent=failed.map(item=>`${item.email} : ${item.reason}`).join('\n');error.hidden=false;email.focus();
  }
  handle=openModalDialog({content:overlay,surface,label:'Ajouter des membres',initialFocus:()=>email,container:options.container,onDismiss:()=>{if(!busy)close();},onClose:()=>{alive=false;role.destroy();}});
  return {close};
}
