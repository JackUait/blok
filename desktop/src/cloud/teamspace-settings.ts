import { TEAMSPACE_ROLES } from '../access-vocabulary';
import { EmojiPicker } from '@blok/emoji-picker';
import french from '../../../src/components/i18n/locales/fr.json';
import { createChoice, styleTextField, type ChoiceControl } from '../ui/controls';
import { teamspaceRoleLabel, type Teamspace, type TeamspaceClient, type TeamspaceIdentity, type TeamspaceRole } from './teamspaces';
import './teamspace-settings.css';
interface Options {api:TeamspaceClient; canCreate:boolean; initialId?:string; onChanged():void}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text=''):HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);node.textContent=text;return node;};
const button=(label:string,run:()=>void):HTMLButtonElement=>{const node=el('button',label);node.type='button';node.setAttribute('data-desktop-settings-copy','');node.addEventListener('click',run);return node;};
const errorText=(error:unknown):string=>{
  const message=error instanceof Error ? error.message : '';
  const translations:Record<string,string>={
    'Keep at least one teamspace owner':'Conservez au moins un propriétaire dans cet espace d’équipe.',
    'Restore teamspace before changing memberships':'Restaurez cet espace d’équipe avant de modifier ses membres.',
    'Teamspace membership required':'Le contenu et les membres sont réservés aux membres de cet espace d’équipe.',
    'Workspace administrator required':'Seuls les administrateurs du Workspace peuvent créer un espace d’équipe.',
    'Teamspace owner or workspace administrator required':'Cette action est réservée aux propriétaires de cet espace d’équipe et aux administrateurs du Workspace.',
    'Viewer cannot own a teamspace':'Un lecteur du Workspace ne peut pas être propriétaire d’un espace d’équipe.',
    'Workspace member not found':'Ce compte n’est plus membre de ce Workspace.',
    'Teamspace not found':'Cet espace d’équipe est introuvable dans ce Workspace.',
    'Invalid name':'Le nom doit contenir entre 1 et 120 caractères.',
    'Invalid description':'La description doit contenir au maximum 2 000 caractères.',
    'Invalid icon':'Choisissez un emoji Unicode valide.',
    'Database unavailable':'Le serveur est indisponible. Réessayez.',
  };
  return translations[message] || message || 'La demande a échoué. Réessayez.';
};
export function mountTeamspaceSettings(container:HTMLElement, options:Options):{destroy():void;dismiss():boolean} {
  const state={dead:false,generation:0,busy:false,picker:null as EmojiPicker|null,choices:[] as ChoiceControl<string>[],team:null as Teamspace|null,tab:'general' as 'general'|'members'|'access'};
  const gate=new AbortController();
  const body=el('section');body.setAttribute('data-teamspace-settings','');container.append(body);
  const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const cleanup=():void=>{state.generation++;state.picker?.close();state.picker?.getElement().remove();state.picker=null;state.choices.splice(0).forEach(choice=>choice.destroy());};
  const mutate=async(action:()=>Promise<unknown>,after:()=>Promise<void>):Promise<void>=>{
    if(state.busy || state.dead)return;
    state.busy=true;status.textContent='Enregistrement…';body.setAttribute('aria-busy','true');
    const controls=[...body.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement|HTMLSelectElement>('input,textarea,button,select')].map(element=>({element,disabled:element.disabled}));for(const control of controls)control.element.disabled=true;
    try {await action();options.onChanged();if(!state.dead){await after();status.textContent='Modification enregistrée.';}}
    catch(error){if(!state.dead)status.textContent=errorText(error);}
    finally {state.busy=false;body.removeAttribute('aria-busy');for(const control of controls)control.element.disabled=control.disabled;}
  };
  const field=(label:string,input:HTMLElement,hint?:string):HTMLElement=>{const row=el('label');row.setAttribute('data-teamspace-field','');row.append(el('strong',label));if(hint)row.append(el('small',hint));row.append(input);return row;};
  const editor=(team:Teamspace|null):void=>{
    const creating=team===null;
    const editable=creating ? options.canCreate : team.canManage && !team.archived;
    const form=el('form');form.setAttribute('data-teamspace-identity-form','');
    const name=styleTextField(el('input'));name.value=team?.name ?? '';name.required=true;name.maxLength=240;name.disabled=!editable;name.setAttribute('aria-label','Nom de l’espace d’équipe');
    const description=el('textarea');description.value=team?.description ?? '';description.rows=3;description.maxLength=4000;description.disabled=!editable;description.setAttribute('aria-label','Description de l’espace d’équipe');
    const draft={icon:team?.icon ?? null as string|null};
    const initial=():string=>([...name.value.trim()][0] || 'É').toLocaleUpperCase();
    const icon=button(draft.icon || initial(),()=>{
      if(!editable || state.busy)return;
      const select=(value:string|null):void=>{draft.icon=value;icon.textContent=value || initial();};
      state.picker??=new EmojiPicker({onSelect:select,onRemove:()=>select(null),i18n:{t:key=>(french as Record<string,string>)[key] ?? key},locale:'fr',curated:false,fitToAnchor:true,startInset:0});
      const node=state.picker.getElement();if(!node.isConnected)body.append(node);
      void state.picker.open(icon,undefined,{current:draft.icon ?? '',onSelect:select,onRemove:()=>select(null)}).catch(error=>{status.textContent=errorText(error);});
    });icon.setAttribute('data-teamspace-icon','');icon.setAttribute('aria-label','Choisir l’emoji de l’espace d’équipe');icon.disabled=!editable;
    name.addEventListener('input',()=>{if(!draft.icon)icon.textContent=initial();});
    const iconRow=el('div');iconRow.append(icon);
    if(editable) iconRow.append(button('Supprimer l’icône',()=>{draft.icon=null;icon.textContent=initial();}));
    form.append(field('Nom',name,'Nom affiché dans la barre latérale. Maximum 120 caractères.'),field('Icône',iconRow),field('Description',description,'Expliquez à votre équipe ce que cet espace contient.'));
    if(editable){const save=button(creating ? 'Créer l’espace d’équipe' : 'Enregistrer',()=>undefined);save.type='submit';form.append(save);}
    else form.append(el('p',team?.archived ? 'Cet espace d’équipe est archivé. Restaurez-le pour modifier son identité.' : 'Seuls ses propriétaires et les administrateurs du Workspace peuvent modifier ces informations.'));
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!editable)return;
      const value:TeamspaceIdentity={name:name.value.trim(),icon:draft.icon,description:description.value};
      if(!value.name || [...value.name].length>120){status.textContent='Le nom doit contenir entre 1 et 120 caractères.';return;}
      if([...value.description].length>2000){status.textContent='La description doit contenir au maximum 2 000 caractères.';return;}
      void mutate(async()=>{state.team=creating ? await options.api.create(value) : await options.api.update(team.id,value);},async()=>{if(state.team)await detail(state.team.id,'general');});
    });body.append(form);
  };
  const members=async(team:Teamspace,stamp:number):Promise<void>=>{
    const area=el('section');area.setAttribute('data-teamspace-members','');body.append(area);area.append(el('p','Chargement des membres…'));
    try {
      const result=await options.api.members(team.id,gate.signal);
      const workspace=team.canManage && !team.archived ? await options.api.workspaceMembers(gate.signal) : null;
      if(state.dead || stamp!==state.generation)return;
      area.replaceChildren(el('p','Ces rôles concernent cet espace d’équipe. Un administrateur du Workspace ne reçoit pas automatiquement accès à son contenu.'));
      const table=el('table');const head=el('tr');['Personne','Rôle',''].forEach(text=>head.append(el('th',text)));table.append(head);
      result.members.forEach(member=>{
        const row=el('tr');row.append(el('td',member.email));
        const role=el('td');const actions=el('td');
        if(team.canManage && !team.archived){
          const isViewer=workspace?.members.find(item=>item.id===member.userId)?.role==='viewer';
          const choice=createChoice<TeamspaceRole>({label:`Rôle de ${member.email}`,value:member.role,options:[{value:'owner',label:TEAMSPACE_ROLES.owner,disabled:isViewer},{value:'member',label:TEAMSPACE_ROLES.member}],onChange:value=>{void mutate(()=>options.api.setMember(team.id,member.userId,value),()=>detail(team.id,'members'));}});
          state.choices.push(choice);role.append(choice.element);
          actions.append(button('Retirer',()=>{void mutate(()=>options.api.removeMember(team.id,member.userId),()=>detail(team.id,'members'));}));
        }else role.textContent=teamspaceRoleLabel(member.role);
        row.append(role,actions);table.append(row);
      });area.append(table);
      if(workspace){
        const candidates=workspace.members.filter(item=>!result.members.some(member=>member.userId===item.id));
        const form=el('form');form.setAttribute('data-teamspace-add-member','');
        const select=el('select');select.setAttribute('aria-label','Compte existant du Workspace');
        select.append(Object.assign(el('option','Choisir un membre du Workspace…'),{value:''}));
        candidates.forEach(item=>select.append(Object.assign(el('option',item.email),{value:item.id})));
        const add=button('Ajouter à cet espace d’équipe',()=>undefined);add.type='submit';add.disabled=candidates.length===0;
        form.append(select,add,el('small','Ajoute un membre déjà présent dans ce Workspace. Aucun e-mail d’invitation n’est envoyé.'));
        form.addEventListener('submit',event=>{event.preventDefault();if(!select.value){status.textContent='Choisissez un membre existant du Workspace.';return;}void mutate(()=>options.api.setMember(team.id,select.value,'member'),()=>detail(team.id,'members'));});area.append(form);
      }
    }catch(error){if(!state.dead && stamp===state.generation)area.replaceChildren(el('p',errorText(error)),button('Réessayer',()=>{void detail(team.id,'members');}));}
  };
  const access=(team:Teamspace):void=>{
    const area=el('section');area.append(el('h2','Fermé'),el('p','Son existence est visible aux membres du Workspace. Son contenu est réservé aux membres de cet espace d’équipe et reste soumis aux droits de chaque page.'),el('p','Seul le mode fermé est disponible actuellement. Les modes ouvert et privé ne sont pas pris en charge.'),el('p',`Votre rôle : ${teamspaceRoleLabel(team.myRole)}. Les propriétaires gèrent les membres ; l’administration du Workspace reste un rôle distinct.`));
    if(team.canManage){const section=el('div');section.setAttribute('data-teamspace-archive','');section.append(el('h2',team.archived ? 'Restaurer cet espace d’équipe' : 'Archiver cet espace d’équipe'),el('p',team.archived ? 'Rétablit les accès précédents sans déplacer les pages.' : 'Ferme tous les accès à son contenu, sans supprimer les pages ni les membres. Cette action est réversible.'));
      const confirm=button(team.archived ? 'Restaurer' : 'Confirmer l’archivage',()=>{void mutate(()=>options.api.archive(team.id,!team.archived),()=>detail(team.id,'access'));});
      if(team.archived)section.append(confirm);
      else {confirm.hidden=true;section.append(button('Archiver…',()=>{confirm.hidden=false;}),confirm);}area.append(section);
    }body.append(area);
  };
  const detail=async(id:string,tab:typeof state.tab='general'):Promise<void>=>{
    cleanup();const stamp=state.generation;body.replaceChildren(el('p','Chargement de l’espace d’équipe…'),status);
    try {
      const team=await options.api.get(id,gate.signal);if(state.dead || stamp!==state.generation)return;
      state.team=team;state.tab=tab;body.replaceChildren(button('← Espaces d’équipe',()=>{void list();}),el('h1',team.name),el('p',team.archived ? 'Archivé · contenu inaccessible' : 'Espace d’équipe du Workspace'),status);
      const tabs=el('nav');tabs.setAttribute('aria-label','Réglages de l’espace d’équipe');
      ([['general','Général'],['members','Membres'],['access','Accès']] as const).forEach(([key,label])=>{if(key==='members' && !team.myRole && !team.canManage)return;const choice=button(label,()=>{void detail(id,key);});choice.setAttribute('aria-current',key===tab ? 'page' : 'false');tabs.append(choice);});body.append(tabs);
      if(tab==='members' && (team.myRole || team.canManage))await members(team,stamp);
      else if(tab==='access')access(team);
      else editor(team);
    }catch(error){if(!state.dead && stamp===state.generation)body.replaceChildren(el('h1','Espace d’équipe'),el('p',errorText(error)),button('Réessayer',()=>{void detail(id,tab);}),button('← Espaces d’équipe',()=>{void list();}),status);}
  };
  const list=async():Promise<void>=>{
    cleanup();const stamp=state.generation;body.replaceChildren(el('h1','Espaces d’équipe'),el('p','Organisez les pages de ce Workspace par équipe. Les membres et les accès se règlent séparément pour chaque espace d’équipe.'),status);
    try {
      const result=await options.api.list(gate.signal);if(state.dead || stamp!==state.generation)return;
      if(options.canCreate)body.append(button('Créer un espace d’équipe',()=>{cleanup();state.team=null;body.replaceChildren(button('← Espaces d’équipe',()=>{void list();}),el('h1','Nouvel espace d’équipe'),el('p','Fermé · contenu réservé aux membres ajoutés à cet espace d’équipe.'),status);editor(null);}));
      if(!result.teamspaces.length)body.append(el('p','Aucun espace d’équipe. Les anciennes pages communes restent dans « Pages communes du Workspace ».'));
      const table=el('table');table.setAttribute('data-teamspace-list','');const heading=el('tr');['Nom','Votre rôle','Accès'].forEach(text=>heading.append(el('th',text)));table.append(heading);
      for(const team of result.teamspaces){const row=el('tr');row.setAttribute('data-teamspace-id',team.id);const name=el('td');name.append(button(`${team.icon || [...team.name][0] || 'É'} ${team.name}`,()=>{void detail(team.id);}));row.append(name,el('td',teamspaceRoleLabel(team.myRole)),el('td',team.archived ? 'Archivé' : 'Fermé — réservé aux membres'));table.append(row);}body.append(table);
    }catch(error){if(!state.dead && stamp===state.generation)body.append(el('p',errorText(error)),button('Réessayer',()=>{void list();}));}
  };
  if(options.initialId)void detail(options.initialId);else void list();
  return {dismiss(){if(!state.picker || state.picker.getElement().hidden)return false;state.picker.close();return true;},destroy(){state.dead=true;gate.abort();cleanup();}};
}
