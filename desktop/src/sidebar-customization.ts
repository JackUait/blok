import {IconChevronDown, IconCross} from '../../src/components/icons';
import {sidebarIcon} from '../../src/shell/sidebar-icons';
import {sidebarIconPicker} from './sidebar-icon-picker';
import './sidebar-customization.css';
import {defaultSidebarLayout, normalizeSidebarTab, type SidebarTab, type SidebarPreset} from '../../src/shell/sidebar-layout';
import {readSidebarLayout, saveSidebarLayout, subscribeSidebarLayout} from './sidebar-preferences';
import type {WorkspaceRef} from './workspace-registry';
import {workspaceRepository} from './workspace-repository';
import type {CloudClient} from './cloud/client';
import {styleTextField} from './ui/controls';

const actions = {'new-page':'Nouvelle page','new-note':'Nouvelle note',library:'Bibliothèque',assistant:'Assistant IA'};
const sections = {recents:'Récents',favorites:'Favoris',private:'Pages privées',shared:'Pages partagées',teamspaces:'Espaces d’équipe'};
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K] {const element=document.createElement(tag);if(text)element.textContent=text;return element;}
function button(label:string,run:()=>void,disabled=false):HTMLButtonElement {const element=node('button',label);element.type='button';element.disabled=disabled;element.onclick=run;return element;}
function select(label:string,value:string,options:Array<[string,string]>,change:(value:string)=>void):HTMLSelectElement {
  const element=node('select');element.setAttribute('aria-label',label);for(const [id,text] of options){const option=node('option',text);option.value=id;element.append(option);}element.value=value;element.onchange=()=>change(element.value);return element;
}
function check(label:string,value:boolean,change:(value:boolean)=>void):HTMLLabelElement {const wrapper=node('label');const input=node('input');input.type='checkbox';input.checked=value;input.onchange=()=>change(input.checked);wrapper.append(input,document.createTextNode(label));return wrapper;}
function reorder<T>(items:T[],from:number,to:number):void {const item=items.splice(from,1)[0];if(item!==undefined)items.splice(to,0,item);}

export function mountSidebarCustomization(container:HTMLElement,ref:WorkspaceRef,options:{initialTabId?:string;client?:CloudClient|null;admin?:boolean;presetsOnly?:boolean}={}):{destroy():void} {
  let layout=readSidebarLayout(ref);let selected=options.initialTabId??layout.activeTabId;let destroyed=false;let writing=false;
  let presets:SidebarPreset[]=[];let presetsLoaded=false;let busy=false;let message='';
  let dragged: {items:unknown[];index:number}|null=null;
  const root=node('div');root.dataset.sidebarCustomization='';container.append(root);
  const repository=workspaceRepository(ref);
  const commit=(redraw=true):void=>{try{writing=true;saveSidebarLayout(ref,layout);message='';}catch{message='Impossible d’enregistrer les préférences sur cet appareil.';}finally{writing=false;}if(redraw)render();};
  const moveControls=<T>(row:HTMLElement,items:T[],index:number,label:string):void=>{
    row.append(button(`Monter ${label}`,()=>{reorder(items,index,index-1);commit();},index===0),button(`Descendre ${label}`,()=>{reorder(items,index,index+1);commit();},index===items.length-1));
    for(const control of Array.from(row.querySelectorAll<HTMLButtonElement>('button')).slice(-2)) {
      control.setAttribute('aria-label',control.textContent??'');const up=control.textContent?.startsWith('Monter');control.innerHTML=IconChevronDown;if(up)control.dataset.sidebarMoveUp='';
      control.dataset.sidebarOrderButton='';
    }
    row.draggable=true;row.ondragstart=event=>{dragged={items,index};event.dataTransfer?.setData('application/x-blok-sidebar-order','internal');};row.ondragend=()=>{dragged=null;};
    row.ondragover=event=>{if(dragged?.items===items)event.preventDefault();};row.ondrop=event=>{event.preventDefault();if(dragged?.items!==items)return;reorder(items,dragged.index,index);dragged=null;commit();};
  };
  const resetTab=(tab:SidebarTab):SidebarTab=>{
    const preset=presets.find(item=>item.id===tab.presetId);const original=preset?.tab??defaultSidebarLayout().tabs.find(item=>item.id===tab.id)??defaultSidebarLayout().tabs[0];
    return {...structuredClone(original),id:tab.id,...(preset?{presetId:preset.id}:{})};
  };
  const putPresets=async(next:SidebarPreset[]):Promise<void>=>{
    if(!options.client||ref.kind!=='remote'||busy)return;
    if(!next.length||!next.some(preset=>preset.default)){message='Gardez au moins un modèle par défaut.';render();return;}
    busy=true;message='Enregistrement…';render();
    try{const result=await options.client.request<{presets:SidebarPreset[]}>(`/api/workspaces/${encodeURIComponent(ref.workspaceId)}/sidebar-presets`,{method:'PUT',body:JSON.stringify({presets:next})});presets=result.presets;message='Modèles enregistrés.';}catch(error){message=error instanceof Error?error.message:'Impossible d’enregistrer les modèles.';}finally{busy=false;if(!destroyed)render();}
  };
  const renderPresets=():void=>{
    if(!options.client)return;
    const section=node('section');section.append(node('h2','Modèles de l’espace'),node('p',options.presetsOnly?'Les modèles par défaut sont proposés aux membres qui n’ont pas encore personnalisé leur barre latérale.':'Ajoutez un modèle à vos onglets personnels.'));
    if(!presetsLoaded)section.append(node('p','Chargement des modèles…'));
    for(const preset of presets){const row=node('div');row.dataset.sidebarEditorRow='';row.append(node('strong',preset.name));
      if(options.presetsOnly&&options.admin){
        const name=node('input');name.value=preset.name;name.maxLength=40;name.setAttribute('aria-label',`Nom du modèle ${preset.name}`);styleTextField(name);name.onchange=()=>{if(name.value.trim())void putPresets(presets.map(item=>item.id===preset.id?{...item,name:name.value.trim(),tab:{...item.tab,name:name.value.trim()}}:item));};row.append(name);
        row.append(check('Par défaut',preset.default,value=>{void putPresets(presets.map(item=>item.id===preset.id?{...item,default:value}:item));}));
        row.append(button('Mettre à jour depuis mon onglet',()=>{const tab=layout.tabs.find(item=>item.id===selected);if(!tab)return;if(tab.shortcuts.some(item=>item.kind==='page')){message='Retirez les raccourcis vers des pages avant de publier cet onglet.';render();return;}const clean={...structuredClone(tab),id:preset.tab.id};delete clean.presetId;void putPresets(presets.map(item=>item.id===preset.id?{...item,name:tab.name,tab:clean}:item));},busy));
        row.append(button('Supprimer le modèle',()=>{void putPresets(presets.filter(item=>item.id!==preset.id));},busy));
      }else row.append(button('Ajouter à mes onglets',()=>{const tab=normalizeSidebarTab({...preset.tab,id:crypto.randomUUID(),presetId:preset.id});if(tab){layout.tabs.push(tab);selected=tab.id;layout.activeTabId=tab.id;commit();}},layout.tabs.length>=6));
      section.append(row);
    }
    if(options.presetsOnly&&options.admin){
      const choice=select('Onglet personnel à publier',selected,layout.tabs.map(tab=>[tab.id,tab.name]),value=>{selected=value;});
      section.append(choice,button('Publier cet onglet comme modèle',()=>{
        const tab=layout.tabs.find(item=>item.id===choice.value);if(!tab)return;
        if(tab.shortcuts.some(item=>item.kind==='page')){message='Retirez les raccourcis vers des pages avant de publier cet onglet.';render();return;}
        const clean={...structuredClone(tab),id:crypto.randomUUID()};delete clean.presetId;
        void putPresets([...presets,{id:crypto.randomUUID(),name:tab.name,default:presets.length===0,tab:clean}]);
      },busy||!presetsLoaded||presets.length>=6));
    }
    root.append(section);
  };
  function render():void {
    const focused=document.activeElement;
    const label=focused instanceof HTMLElement&&root.contains(focused)?focused.getAttribute('aria-label'):null;
    const selection=focused instanceof HTMLInputElement&&focused.type==='text'?[focused.selectionStart,focused.selectionEnd]:null;
    paint();
    if(label){const replacement=Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(element=>element.getAttribute('aria-label')===label);replacement?.focus();if(replacement instanceof HTMLInputElement&&selection)replacement.setSelectionRange(selection[0],selection[1]);}
  }
  function paint():void {
    if(destroyed)return;root.replaceChildren();root.append(node('h1',options.presetsOnly?'Modèles de barre latérale':'Barre latérale'));
    if(options.presetsOnly){renderPresets();const status=node('p',message);status.setAttribute('role','status');root.append(status);return;}
    root.append(node('p','Vos réglages personnels pour cet espace sont enregistrés sur cet appareil et appliqués immédiatement.'));
    const list=node('div');list.setAttribute('aria-label','Onglets');
    for(const [index,tab] of layout.tabs.entries()){
      const row=node('div');row.dataset.sidebarEditorRow='';const pick=button(tab.name,()=>{selected=tab.id;layout.activeTabId=tab.id;commit();});pick.setAttribute('aria-pressed',String(tab.id===selected));const glyph=node('span');glyph.setAttribute('aria-hidden','true');glyph.append(sidebarIcon(tab.icon));const title=node('span',tab.name);title.dataset.sidebarTabName='';pick.replaceChildren(glyph,title);row.append(pick);moveControls(row,layout.tabs,index,tab.name);list.append(row);
    }
    root.append(list,button('Ajouter un onglet',()=>{const tab={...structuredClone(defaultSidebarLayout().tabs[0]),id:crypto.randomUUID(),name:'Nouvel onglet'};layout.tabs.push(tab);selected=tab.id;layout.activeTabId=tab.id;commit();},layout.tabs.length>=6));
    const tab=layout.tabs.find(item=>item.id===selected)??layout.tabs[0];selected=tab.id;
    const editor=node('section');editor.append(node('h2','Personnaliser l’onglet'));
    const name=node('input');name.value=tab.name;name.maxLength=40;name.setAttribute('aria-label','Nom de l’onglet');styleTextField(name);name.oninput=()=>{if(name.value.trim()){tab.name=name.value;commit(false);const label=list.querySelector<HTMLElement>('[aria-pressed="true"] [data-sidebar-tab-name]');if(label)label.textContent=name.value;}};
    editor.append(name,sidebarIconPicker(tab.icon,value=>{tab.icon=value;commit();root.querySelector<HTMLButtonElement>('[data-sidebar-icon-trigger]')?.focus();}));
    editor.append(button('Supprimer l’onglet',()=>{layout.tabs=layout.tabs.filter(item=>item.id!==tab.id);selected=layout.tabs[0].id;layout.activeTabId=selected;commit();},layout.tabs.length<=1));
    editor.append(node('h3','Raccourcis'));
    for(const [index,item] of tab.shortcuts.entries()){
      const label=item.kind==='page'?'Raccourci vers une page':actions[item.kind];const row=node('div');row.dataset.sidebarEditorRow='';row.append(check(label,item.visible,value=>{item.visible=value;commit();}));moveControls(row,tab.shortcuts,index,label);const remove=button(`Retirer ${label}`,()=>{tab.shortcuts.splice(index,1);commit();});remove.setAttribute('aria-label',`Retirer ${label}`);remove.innerHTML=IconCross;row.append(remove);editor.append(row);
    }
    const available=Object.entries(actions).filter(([kind])=>!tab.shortcuts.some(item=>item.kind===kind));
    if(available.length){const action=select('Action à ajouter',available[0][0],available,()=>{});editor.append(action,button('Ajouter le raccourci',()=>{tab.shortcuts.push({id:crypto.randomUUID(),kind:action.value as keyof typeof actions,visible:true});commit();},tab.shortcuts.length>=25));}
    const pages=node('div');editor.append(pages);
    pages.append(button('Ajouter une page…',()=>{
      pages.replaceChildren(node('span','Chargement des pages accessibles…'));
      void repository.loadIndex().then(index=>{
        if(destroyed||!pages.isConnected)return;pages.replaceChildren();if(!index.pages.length){pages.append(node('p','Aucune page accessible.'));return;}
        const picker=select('Page à ajouter',index.pages[0].id,index.pages.map(page=>[page.id,page.title||'Sans titre']),()=>{});
        const add=button('Ajouter cette page',()=>{
          add.disabled=true;
          void repository.loadIndex().then(fresh=>{if(destroyed)return;if(!fresh.pages.some(page=>page.id===picker.value)){pages.replaceChildren(node('p','Cette page n’est plus accessible.'));return;}tab.shortcuts.push({id:crypto.randomUUID(),kind:'page',pageId:picker.value,visible:true});commit();}).catch(()=>{if(!destroyed)pages.replaceChildren(node('p','Impossible de vérifier l’accès à cette page.'));});
        });pages.append(picker,add);
      }).catch(()=>{if(!destroyed)pages.replaceChildren(node('p','Impossible de charger les pages. Réessayez.'));});
    },tab.shortcuts.length>=25));
    editor.append(node('h3','Sections'));
    for(const [index,item] of tab.sections.entries()){
      const label=sections[item.id];const row=node('div');row.dataset.sidebarEditorRow='';row.append(check(label,item.visible,value=>{item.visible=value;commit();}));
      row.append(select(`Nombre de pages — ${label}`,String(item.limit),[5,10,20,50,0].map(limit=>[String(limit),limit===0?'Toutes':String(limit)]),value=>{item.limit=Number(value);commit();}),select(`Tri — ${label}`,item.sort,[['manual','Ordre manuel'],['updated','Modification récente']],value=>{item.sort=value==='updated'?'updated':'manual';commit();}));moveControls(row,tab.sections,index,label);editor.append(row);
    }
    editor.append(button('Réinitialiser cet onglet',()=>{layout.tabs[layout.tabs.indexOf(tab)]=resetTab(tab);commit();}));root.append(editor);
    renderPresets();root.append(button('Réinitialiser toute la barre latérale',()=>{const defaults=presets.filter(item=>item.default).map(item=>({...structuredClone(item.tab),id:`preset:${item.id}`,presetId:item.id}));layout=defaultSidebarLayout();if(defaults.length){layout.tabs=defaults.slice(0,6);layout.activeTabId=layout.tabs[0].id;}selected=layout.activeTabId;commit();}));
    const status=node('p',message);status.setAttribute('role','status');root.append(status);
  }
  const unsubscribe=subscribeSidebarLayout(ref,value=>{if(writing)return;layout=value;render();});render();
  if(options.client&&ref.kind==='remote')void options.client.request<{presets:SidebarPreset[]}>(`/api/workspaces/${encodeURIComponent(ref.workspaceId)}/sidebar-presets`).then(result=>{presets=result.presets;presetsLoaded=true;if(!destroyed)render();}).catch(()=>{presetsLoaded=true;message='Les modèles de l’espace sont indisponibles.';if(!destroyed)render();});
  return {destroy(){destroyed=true;unsubscribe();root.remove();}};
}
