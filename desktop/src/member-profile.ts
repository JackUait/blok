import type {CloudRole} from './cloud/client';
import {profileDisplayName,profileInitial} from './profile-identity';
import './member-profile.css';

export interface WorkspacePerson {id:string;email:string;name?:string;avatarUrl?:string;role:CloudRole}
const roleName:Record<CloudRole,string>={admin:'Administrateur',member:'Membre',viewer:'Lecteur'};
const memberPortrait=(person:WorkspacePerson):HTMLElement=>{
  const portrait=document.createElement('div');portrait.setAttribute('data-member-profile-avatar','');portrait.textContent=profileInitial(profileDisplayName(person.name,person.email));
  if(!person.avatarUrl)return portrait;
  try {
    const url=new URL(person.avatarUrl,location.href);
    if(url.protocol==='https:' || url.protocol==='http:'){
      const img=document.createElement('img');img.src=url.href;img.alt='';img.addEventListener('error',()=>img.remove(),{once:true});portrait.append(img);
    }
  }catch{/* An invalid photo keeps the member's initial. */}
  return portrait;
};


/** A workspace directory shared by page editors; opening a profile preserves the editor underneath. */
export function createMemberProfiles(options:{workspaceName:string;members(signal?:AbortSignal):Promise<{members:WorkspacePerson[]}>}) {
  const lifetime=new AbortController();
  const state={request:null as Promise<WorkspacePerson[]>|null,dialog:null as HTMLDialogElement|null,body:null as HTMLElement|null,generation:0,disposed:false,pushed:false,opener:null as HTMLElement|null};
  const list=():Promise<WorkspacePerson[]>=>{
    if(!state.request)state.request=options.members(lifetime.signal).then(result=>result.members).catch(error=>{state.request=null;throw error;});
    return state.request;
  };
  const dismiss=():void=>{
    state.generation++;
    state.dialog?.remove();state.dialog=null;state.body=null;
    const opener=state.opener;state.opener=null;
    if(opener?.isConnected){
      const details=opener.closest('details');
      (details && !details.open ? details.querySelector('summary') : opener)?.focus({preventScroll:true});
    }
  };
  const close=():void=>{
    dismiss();
    const url=new URL(location.href);
    if(!url.searchParams.has('profile'))return;
    if(state.pushed){state.pushed=false;history.back();}
    else {url.searchParams.delete('profile');history.replaceState(history.state,'',url);}
  };
  const shell=():HTMLElement=>{
    if(state.body)return state.body;
    state.opener=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog=document.createElement('dialog');dialog.setAttribute('data-member-profile','');dialog.setAttribute('aria-label','Profil du membre');
    const header=document.createElement('header');
    const crumb=document.createElement('span');crumb.textContent=`${options.workspaceName} / Membres`;
    const exit=document.createElement('button');exit.type='button';exit.textContent='Fermer';exit.setAttribute('aria-label','Fermer le profil');exit.addEventListener('click',close);
    header.append(crumb,exit);
    const body=document.createElement('div');body.setAttribute('data-member-profile-body','');
    dialog.append(header,body);document.body.append(dialog);state.dialog=dialog;state.body=body;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    },true);
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    exit.focus({preventScroll:true});
    return body;
  };
  const show=async(id:string):Promise<void>=>{
    if(state.disposed)return;
    const generation=++state.generation;
    const body=shell();
    const loading=document.createElement('p');loading.setAttribute('role','status');loading.textContent='Chargement du profil…';body.replaceChildren(loading);
    try {
      const members=await list();
      if(state.disposed || generation!==state.generation || state.body!==body)return;
      const person=members.find(member=>member.id===id);
      if(!person){loading.textContent='Profil indisponible dans cet espace.';return;}
      const name=profileDisplayName(person.name,person.email);
      state.dialog?.setAttribute('aria-label',`Profil de ${name}`);
      const portrait=memberPortrait(person);
      const title=document.createElement('h1');title.textContent=name;
      const context=document.createElement('p');context.setAttribute('data-member-profile-workspace','');context.textContent=options.workspaceName;
      const facts=document.createElement('dl');
      const emailLabel=document.createElement('dt');emailLabel.textContent='Adresse e-mail';
      const emailValue=document.createElement('dd');const email=document.createElement('a');email.textContent=person.email;email.href=`mailto:${encodeURIComponent(person.email).replace(/%40/gi,'@')}`;emailValue.append(email);
      const roleLabel=document.createElement('dt');roleLabel.textContent='Rôle dans cet espace';
      const roleValue=document.createElement('dd');roleValue.textContent=roleName[person.role];facts.append(emailLabel,emailValue,roleLabel,roleValue);
      const contact=document.createElement('a');contact.setAttribute('data-member-profile-contact','');contact.href=email.href;contact.textContent='Envoyer un e-mail';
      const article=document.createElement('article');article.append(portrait,title,context,facts,contact);
      const aside=document.createElement('nav');aside.setAttribute('aria-label','Membres de cet espace');
      const heading=document.createElement('h2');heading.textContent='Membres';aside.append(heading);
      for(const member of members){
        const button=document.createElement('button');button.type='button';button.textContent=profileDisplayName(member.name,member.email);
        button.setAttribute('aria-current',member.id===id ? 'page' : 'false');
        button.addEventListener('click',()=>{void open(member.id);});aside.append(button);
      }
      body.replaceChildren(article,aside);
    }catch{
      if(state.disposed || generation!==state.generation || state.body!==body)return;
      loading.textContent='Profil indisponible. Vérifiez votre connexion.';
      const retry=document.createElement('button');retry.type='button';retry.textContent='Réessayer';retry.addEventListener('click',()=>{void show(id);});body.append(retry);
    }
  };
  const open=(id:string):Promise<void>=>{
    if(state.disposed)return Promise.resolve();
    const url=new URL(location.href),hadProfile=url.searchParams.has('profile');url.searchParams.set('profile',id);
    if(hadProfile)history.replaceState(history.state,'',url);
    else {history.pushState(history.state,'',url);state.pushed=true;}
    return show(id);
  };
  const onRoute=():void=>{
    const id=new URL(location.href).searchParams.get('profile');
    if(id)void show(id);else {state.pushed=false;dismiss();}
  };
  window.addEventListener('popstate',onRoute,{signal:lifetime.signal});
  const initialProfile=new URL(location.href).searchParams.get('profile');
  if(initialProfile)queueMicrotask(()=>{if(!state.disposed && state.dialog===null)void show(initialProfile);});
  return {list,open,close,destroy(){state.disposed=true;lifetime.abort();state.request=null;dismiss();}};
}
