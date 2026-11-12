import {IconTrash} from '../../src/components/icons';
import {styleTextField, wrapSearchField} from './ui/controls';
import {customEmojiStore, readEmojiImage, type CustomEmoji} from './custom-emojis';
import type {WorkspaceRef} from './workspace-registry';
import './custom-emoji-settings.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {const node=document.createElement(tag);if(text)node.textContent=text;return node;}
function button(label:string):HTMLButtonElement {const node=el('button',label);node.type='button';node.className='blok-button';node.setAttribute('data-cloud-settings-button','');return node;}
export function mountCustomEmojiSettings(container:HTMLElement, ref:WorkspaceRef):{destroy():void} {
  const store=customEmojiStore(ref);const canAdd=ref.kind==='local'||ref.role!=='viewer';
  let alive=true;let busy=false;let generation=0;let items:CustomEmoji[]=[];let selected:File|null=null;let previewUrl:string|null=null;
  const panel=el('section');panel.setAttribute('data-custom-emoji-settings','');
  const intro=el('p','Ajoutez des émojis personnalisés pour les icônes des pages de cet espace.');intro.setAttribute('data-desktop-settings-intro','');
  const tools=el('div');tools.setAttribute('data-custom-emoji-tools','');
  const search=el('input');search.type='search';search.placeholder='Rechercher un émoji…';search.setAttribute('aria-label','Rechercher un émoji');styleTextField(search);tools.append(wrapSearchField(search));
  const add=button('Ajouter un émoji');add.setAttribute('data-cloud-settings-primary','');if(canAdd)tools.append(add);
  const form=el('form');form.hidden=true;form.setAttribute('data-custom-emoji-upload','');
  const nameLabel=el('label','Nom');const name=el('input');name.required=true;name.maxLength=64;name.placeholder='ex. logo_equipe';name.pattern='[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}';name.setAttribute('aria-label','Nom de l’émoji');styleTextField(name);nameLabel.append(name);
  const file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/gif,image/webp';file.hidden=true;
  const pick=button('Choisir une image');pick.addEventListener('click',()=>file.click());
  const preview=el('span','Aucune image sélectionnée');preview.setAttribute('data-custom-emoji-file','');
  const previews=el('div');previews.setAttribute('data-custom-emoji-previews','');previews.hidden=true;
  for(const mode of ['light','dark']){const tile=el('div');tile.setAttribute('data-emoji-preview-theme',mode);const image=el('img');image.alt=mode==='light'?'Aperçu sur fond clair':'Aperçu sur fond sombre';tile.append(image);previews.append(tile);}
  const clearPreview=():void=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previews.hidden=true;previews.querySelectorAll('img').forEach(image=>image.removeAttribute('src'));};
  const hint=el('p','PNG, JPEG, GIF ou WebP · 2 Mo maximum.');hint.setAttribute('data-cloud-settings-muted','');
  const save=button('Enregistrer');save.type='submit';const cancel=button('Annuler');cancel.addEventListener('click',()=>{form.hidden=true;add.focus();});
  const formActions=el('div');formActions.setAttribute('data-custom-emoji-form-actions','');formActions.append(pick,preview,file);
  const submitActions=el('div');submitActions.setAttribute('data-custom-emoji-form-actions','');submitActions.append(cancel,save);
  form.append(formActions,previews,nameLabel,hint,submitActions);
  const error=el('p');error.setAttribute('role','alert');error.setAttribute('data-cloud-settings-error','');error.hidden=true;
  const list=el('div');list.setAttribute('data-custom-emoji-list','');list.setAttribute('aria-live','polite');
  panel.append(intro,tools,form,error,list);container.append(panel);
  const showError=(reason:unknown):void=>{if(!alive)return;error.textContent=reason instanceof Error?reason.message:'Impossible de modifier les émojis.';error.hidden=false;};
  const render=():void=>{
    if(!alive)return;list.replaceChildren();const needle=search.value.trim().toLocaleLowerCase();const shown=items.filter(item=>item.name.toLocaleLowerCase().includes(needle));
    if(!shown.length){list.append(el('p',needle?'Aucun émoji correspondant.':'Aucun émoji personnalisé. Ajoutez le premier pour votre équipe.'));return;}
    const table=el('table');const head=el('thead');const headings=el('tr');headings.append(el('th','Émoji'),el('th','Nom'),el('th','Ajouté le'),el('th',''));head.append(headings);const body=el('tbody');table.append(head,body);
    for(const item of shown){const row=el('tr');const imageCell=el('td');const image=el('img');image.src=item.url;image.alt=item.name;imageCell.append(image);const actions=el('td');
      const canDelete=ref.kind==='local'||ref.role==='admin'||(ref.role!=='viewer'&&item.createdBy===ref.accountId);
      if(canDelete){const remove=button('');remove.innerHTML=IconTrash;remove.setAttribute('aria-label',`Supprimer ${item.name}`);remove.disabled=busy;remove.addEventListener('click',()=>{void mutate(()=>store.remove(item.id));});actions.append(remove);}
      const date=item.createdAt?new Date(item.createdAt):null;row.append(imageCell,el('td',`:${item.name}:`),el('td',date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('fr-FR'):'—'),actions);body.append(row);
    }list.append(table);
  };
  async function refresh():Promise<void>{const turn=++generation;const next=await store.list();if(!alive||turn!==generation)return;items=next;render();}
  async function mutate(action:()=>Promise<void>):Promise<void>{if(busy||!alive)return;busy=true;error.hidden=true;panel.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(node=>{node.disabled=true;});
    try{await action();if(!alive)return;await refresh();form.hidden=true;form.reset();selected=null;clearPreview();preview.textContent='Aucune image sélectionnée';}
    catch(reason){showError(reason);}finally{busy=false;if(alive){panel.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(node=>{node.disabled=false;});}}
  }
  file.addEventListener('change',()=>{clearPreview();selected=file.files?.[0]??null;preview.textContent=selected?.name??'Aucune image sélectionnée';if(selected&&['image/png','image/jpeg','image/gif','image/webp'].includes(selected.type)&&selected.size<=2*1024*1024){previewUrl=URL.createObjectURL(selected);previews.querySelectorAll('img').forEach(image=>{image.src=previewUrl!;});previews.hidden=false;}if(selected&&!name.value)name.value=selected.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64);});
  form.addEventListener('submit',event=>{event.preventDefault();if(!selected){showError(new Error('Choisissez une image.'));pick.focus();return;}const upload=selected;void mutate(async()=>store.create(name.value.trim(),await readEmojiImage(upload)));});
  add.addEventListener('click',()=>{form.hidden=false;name.focus();});search.addEventListener('input',render);
  list.append(el('p','Chargement des émojis…'));void refresh().catch(showError);
  return {destroy(){alive=false;++generation;clearPreview();panel.remove();}};
}
