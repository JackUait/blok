import {IconImage, IconTrash} from '../../src/components/icons';
import {openModalDialog, type ModalDialogHandle} from '@blok/modal-dialog';
import {styleTextField, wrapSearchField} from './ui/controls';
import {customEmojiStore, readEmojiImage, type CustomEmoji} from './custom-emojis';
import type {WorkspaceRef} from './workspace-registry';
import './custom-emoji-settings.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node=document.createElement(tag);if(text)node.textContent=text;return node;
}
function button(label:string):HTMLButtonElement {
  const node=el('button',label);node.type='button';node.className='blok-button';node.setAttribute('data-cloud-settings-button','');return node;
}
function reasonText(reason:unknown):string {return reason instanceof Error?reason.message:'Impossible de modifier les émojis.';}

export function mountCustomEmojiSettings(container:HTMLElement, ref:WorkspaceRef):{destroy():void} {
  const store=customEmojiStore(ref);
  const canAdd=ref.kind==='local'||ref.role!=='viewer';
  let alive=true;let busy=false;let generation=0;let items:CustomEmoji[]=[];
  let uploadDialog:ModalDialogHandle|null=null;
  const panel=el('section');panel.setAttribute('data-custom-emoji-settings','');
  const intro=el('p','Une touche personnelle pour les pages de votre espace.');intro.setAttribute('data-desktop-settings-intro','');
  const tools=el('div');tools.setAttribute('data-custom-emoji-tools','');
  const count=el('span','Émojis personnalisés');count.setAttribute('data-custom-emoji-count','');
  const toolbarActions=el('div');toolbarActions.setAttribute('data-custom-emoji-toolbar-actions','');
  const search=el('input');search.type='search';search.placeholder='Rechercher…';search.setAttribute('aria-label','Rechercher un émoji');styleTextField(search);
  toolbarActions.append(wrapSearchField(search));
  const add=button('Ajouter un émoji');add.setAttribute('data-cloud-settings-primary','');if(canAdd)toolbarActions.append(add);
  tools.append(count,toolbarActions);
  const error=el('p');error.setAttribute('role','alert');error.setAttribute('data-cloud-settings-error','');error.hidden=true;
  const list=el('div');list.setAttribute('data-custom-emoji-list','');list.setAttribute('aria-live','polite');
  panel.append(intro,tools,error,list);container.append(panel);

  function showError(reason:unknown):void {if(alive){error.textContent=reasonText(reason);error.hidden=false;}}
  function render():void {
    if(!alive)return;
    count.textContent=`${items.length} émoji${items.length===1?'':'s'}`;
    list.replaceChildren();
    const needle=search.value.trim().toLocaleLowerCase();
    const shown=items.filter(item=>item.name.toLocaleLowerCase().includes(needle));
    if(!shown.length){
      const empty=el('div');empty.setAttribute('data-custom-emoji-empty','');
      const icon=el('span');icon.innerHTML=IconImage;icon.setAttribute('aria-hidden','true');
      empty.append(icon,el('strong',needle?'Aucun résultat':'Vos émojis, votre espace'),el('p',needle?'Essayez un autre nom.':'Ajoutez un logo, une mascotte ou une image pour personnaliser les icônes de vos pages.'));
      list.append(empty);return;
    }
    const table=el('table');const head=el('thead');const headings=el('tr');
    headings.append(el('th','Émoji'),el('th','Nom'),el('th','Ajouté le'),el('th',''));head.append(headings);
    const body=el('tbody');table.append(head,body);
    for(const item of shown){
      const row=el('tr');const imageCell=el('td');const image=el('img');image.src=item.url;image.alt=item.name;imageCell.append(image);
      const actions=el('td');
      const canDelete=ref.kind==='local'||ref.role==='admin'||(ref.role!=='viewer'&&item.createdBy===ref.accountId);
      if(canDelete){const remove=button('');remove.innerHTML=IconTrash;remove.setAttribute('aria-label',`Supprimer ${item.name}`);remove.disabled=busy;remove.addEventListener('click',()=>{void removeEmoji(item.id);});actions.append(remove);}
      const date=item.createdAt?new Date(item.createdAt):null;
      row.append(imageCell,el('td',`:${item.name}:`),el('td',date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('fr-FR'):'—'),actions);body.append(row);
    }
    list.append(table);
  }
  async function refresh():Promise<void> {
    const turn=++generation;const next=await store.list();if(!alive||turn!==generation)return;items=next;render();
  }
  async function removeEmoji(id:string):Promise<void> {
    if(busy||!alive)return;busy=true;error.hidden=true;render();
    try{await store.remove(id);if(alive)await refresh();}catch(reason){showError(reason);}finally{busy=false;if(alive)render();}
  }

  function openUpload():void {
    if(uploadDialog||!alive)return;
    let selected:File|null=null;let previewUrl:string|null=null;let saving=false;let opened=true;
    const overlay=el('div');overlay.setAttribute('data-custom-emoji-overlay','');
    const surface=el('section');surface.setAttribute('data-custom-emoji-dialog','');
    const header=el('header');const title=el('h2','Ajouter un émoji');
    const close=button('×');close.setAttribute('data-custom-emoji-close','');close.setAttribute('aria-label','Fermer');
    header.append(title,close);
    const description=el('p','Disponible pour les icônes de toutes les pages de cet espace.');description.setAttribute('data-custom-emoji-description','');
    const form=el('form');form.setAttribute('data-custom-emoji-upload','');
    const imageArea=el('div');imageArea.setAttribute('data-custom-emoji-image-area','');
    const previews=el('div');previews.setAttribute('data-custom-emoji-previews','');
    const previewImages:HTMLImageElement[]=[];
    for(const [mode,label] of [['light','Clair'],['dark','Sombre']]){
      const sample=el('div');const tile=el('div');tile.setAttribute('data-emoji-preview-theme',mode);
      const placeholder=el('span');placeholder.innerHTML=IconImage;placeholder.setAttribute('data-custom-emoji-placeholder','');placeholder.setAttribute('aria-hidden','true');
      const image=el('img');image.alt=`Aperçu sur fond ${mode==='light'?'clair':'sombre'}`;image.hidden=true;previewImages.push(image);
      tile.append(placeholder,image);sample.append(tile,el('span',label));previews.append(sample);
    }
    const file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/gif,image/webp';file.hidden=true;
    const pick=button('Choisir une image');pick.addEventListener('click',()=>file.click());
    const hint=el('p','PNG, JPEG, GIF ou WebP · 2 Mo maximum');hint.setAttribute('data-custom-emoji-hint','');
    imageArea.append(previews,pick,hint,file);
    const nameLabel=el('label','Nom de l’émoji');nameLabel.setAttribute('data-custom-emoji-name-label','');
    const name=el('input');name.required=true;name.maxLength=64;name.placeholder='ex. logo_equipe';name.pattern=String.raw`[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}`;name.setAttribute('aria-label','Nom de l’émoji');styleTextField(name);nameLabel.append(name);
    const nameHint=el('p','Lettres, chiffres, tirets et caractères de soulignement.');nameHint.setAttribute('data-custom-emoji-hint','');
    const uploadError=el('p');uploadError.setAttribute('role','alert');uploadError.setAttribute('data-cloud-settings-error','');uploadError.hidden=true;
    const footer=el('footer');const cancel=button('Annuler');const save=button('Enregistrer');save.type='submit';save.setAttribute('data-cloud-settings-primary','');save.disabled=true;
    footer.append(cancel,save);form.append(imageArea,nameLabel,nameHint,uploadError,footer);surface.append(header,description,form);overlay.append(surface);
    function clearPreview():void {if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;}
    function showUploadError(reason:unknown):void {if(opened){uploadError.textContent=reasonText(reason);uploadError.hidden=false;}}
    function updateSave():void {save.disabled=saving||!selected||!name.checkValidity();}
    function dismiss():void {if(!saving)uploadDialog?.close();}
    close.addEventListener('click',dismiss);cancel.addEventListener('click',dismiss);name.addEventListener('input',updateSave);
    file.addEventListener('change',()=>{
      const next=file.files?.[0];if(!next)return;uploadError.hidden=true;
      if(!['image/png','image/jpeg','image/gif','image/webp'].includes(next.type)){showUploadError(new Error('Choisissez une image PNG, JPEG, GIF ou WebP.'));return;}
      if(next.size>2*1024*1024){showUploadError(new Error('L’image doit faire moins de 2 Mo.'));return;}
      clearPreview();selected=next;previewUrl=URL.createObjectURL(next);
      for(const image of previewImages){image.src=previewUrl;image.hidden=false;}
      previews.querySelectorAll<HTMLElement>('[data-custom-emoji-placeholder]').forEach(node=>{node.hidden=true;});
      pick.textContent='Remplacer l’image';
      if(!name.value)name.value=next.name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9_-]/g,'_').replace(/^[^a-z0-9]+/,'').slice(0,64);
      updateSave();name.focus();
    });
    form.addEventListener('submit',event=>{event.preventDefault();if(saving||!selected||!form.reportValidity())return;void saveEmoji(selected);});
    async function saveEmoji(upload:File):Promise<void> {
      saving=true;uploadError.hidden=true;
      for(const control of [close,cancel,save,pick,name,file])control.disabled=true;save.textContent='Enregistrement…';
      try{
        await store.create(name.value.trim(),await readEmojiImage(upload));
        if(!alive||!opened)return;
        uploadDialog?.close();await refresh().catch(showError);
      }catch(reason){showUploadError(reason);}finally{
        saving=false;
        if(opened){for(const control of [close,cancel,pick,name,file])control.disabled=false;save.textContent='Enregistrer';updateSave();}
      }
    }
    uploadDialog=openModalDialog({content:overlay,surface,label:'Ajouter un émoji',container:container.closest<HTMLElement>('[data-desktop-settings-dialog]')??undefined,initialFocus:()=>pick,onDismiss:dismiss,onClose:()=>{opened=false;clearPreview();uploadDialog=null;}});
  }
  add.addEventListener('click',openUpload);search.addEventListener('input',render);
  list.append(el('p','Chargement des émojis…'));void refresh().catch(showError);
  return {destroy(){alive=false;++generation;uploadDialog?.close();uploadDialog=null;panel.remove();}};
}
