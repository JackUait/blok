import {SIDEBAR_ICONS, type SidebarIcon} from '../../src/shell/sidebar-layout';
import {sidebarIcon} from '../../src/shell/sidebar-icons';
import {styleTextField} from './ui/controls';

export function sidebarIconPicker(selected: SidebarIcon, onSelect: (icon: SidebarIcon) => void): HTMLElement {
  const root=document.createElement('div');root.dataset.sidebarIconPicker='';
  const trigger=document.createElement('button');trigger.type='button';trigger.dataset.sidebarIconTrigger='';
  trigger.setAttribute('aria-label','Choisir l’icône de l’onglet');trigger.setAttribute('aria-expanded','false');
  trigger.append(sidebarIcon(selected),document.createTextNode(SIDEBAR_ICONS.find(icon=>icon.id===selected)?.label??'Maison'));
  const panel=document.createElement('div');panel.dataset.sidebarIconPanel='';panel.hidden=true;
  const search=document.createElement('input');search.type='search';search.placeholder='Rechercher une icône…';search.setAttribute('aria-label','Rechercher une icône');styleTextField(search);
  const grid=document.createElement('div');grid.dataset.sidebarIconGrid='';grid.setAttribute('role','group');grid.setAttribute('aria-label','Icônes Lucide');
  const empty=document.createElement('p');empty.textContent='Aucune icône trouvée.';empty.hidden=true;
  const normalize=(value:string):string=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
  const paint=():void=>{
    grid.replaceChildren();const query=normalize(search.value.trim());
    for(const icon of SIDEBAR_ICONS.filter(item=>normalize(`${item.label} ${item.keywords}`).includes(query))){
      const choice=document.createElement('button');choice.type='button';choice.setAttribute('aria-label',icon.label);choice.setAttribute('aria-pressed',String(icon.id===selected));
      const label=document.createElement('span');label.textContent=icon.label;choice.append(sidebarIcon(icon.id),label);
      choice.addEventListener('click',()=>onSelect(icon.id));grid.append(choice);
    }
    empty.hidden=grid.childElementCount>0;
  };
  trigger.addEventListener('click',()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){paint();search.focus();}});
  search.addEventListener('input',paint);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}
    if(event.key==='ArrowDown'&&event.target===search){event.preventDefault();grid.querySelector('button')?.focus();}
  });
  panel.append(search,grid,empty);root.append(trigger,panel);return root;
}
