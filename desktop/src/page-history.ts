import {blocksToHtml} from '../../src/view/blocks-to-html';
import {diffOutputData} from '../../src/view/diff-output-data';
import '../../view.css';
import {changePreview} from '../../src/shared/history-preview';
import type {HistoryDocument, HistoryVersion, PageHistoryApi, RestorePlan} from './page-history-api';
import './page-history.css';

const guardLabels: Record<string,string> = {
  share:'Modifier les règles de partage de cette base',
  unlock:'Déverrouiller cette base',
  lockedReshape:'Modifier la structure d’une base verrouillée',
  orphanedDatabase:'Restaurer une référence dont la base source n’est plus présente',
};
const dateLabel = (time: number | null): string => time === null ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(time);
const keyOf = (point: HistoryVersion): string => `${point.lineage}:${point.sequence}`;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, attr?: string, text?: string): HTMLElementTagNameMap[K] {
  const element=document.createElement(tag); if(attr) element.setAttribute(attr,''); if(text) element.textContent=text; return element;
}
function button(text: string, click: () => void, attr?: string): HTMLButtonElement {
  const element=node('button',attr,text);element.type='button';element.addEventListener('click',click);return element;
}

/** A separate read-only view: the live editor and its scroll position stay intact. */
export function createPageHistory(options: {
  api: PageHistoryApi; title(): string; actorName(id: string): string;
  canRestore(): boolean; onRestored(): void | Promise<void>; returnFocus?(): HTMLElement | null;
}) {
  const {api}=options;
  const element=node('dialog','data-page-history');element.setAttribute('aria-label','Historique des versions');
  const state={epoch:0,controller:new AbortController(),versions:[] as HistoryVersion[],current:'',selected:null as HistoryVersion|null,
    document:null as HistoryDocument|null,ready:false,busy:false,confirming:false,destroyed:false,change:0,returnFocus:null as HTMLElement|null};
  const sidebar=node('aside','data-history-sidebar');
  const title=node('h2',undefined,'Historique des versions');
  const pageTitle=node('p','data-history-page-title');
  const grouping=node('select','data-history-group');grouping.setAttribute('aria-label','Regrouper les versions');
  for(const [value,label] of [['1','1 minute'],['15','15 minutes'],['60','1 heure']]) { const option=node('option',undefined,label);option.value=value;grouping.append(option); }
  grouping.value='15';
  const groupLabel=node('label',undefined,'Regrouper par ');groupLabel.append(grouping);
  const list=node('div','data-history-list');
  sidebar.append(title,pageTitle,groupLabel,list);
  const main=node('section','data-history-main');
  const head=node('header','data-history-head');
  const selectedLabel=node('span','data-history-selected');
  const restore=button('Restaurer cette version',()=>{void confirm();},'data-history-restore');restore.disabled=true;
  const dismiss=button('Fermer',()=>close(),'data-history-close');
  head.append(selectedLabel,restore,dismiss);
  const status=node('p','data-history-status');status.setAttribute('role','status');
  const scroll=node('div','data-history-scroll');
  const render=node('div','data-history-render');
  const documentTitle=node('h1','data-history-document-title');
  const legend=node('p','data-history-legend');
  for(const [kind,label] of [['added','Ajouté'],['changed','Modifié'],['removed','Supprimé'],['moved','Déplacé']]) {
    const key=node('span','data-history-key',label);key.setAttribute('data-history-key',kind);legend.append(key);
  }
  const content=node('div','data-history-content');content.append(render);
  const confirmation=node('section','data-history-confirm');confirmation.hidden=true;confirmation.setAttribute('aria-label','Confirmer la restauration');
  scroll.append(documentTitle,legend,content,confirmation);
  const navigation=node('nav','data-history-changes');navigation.setAttribute('aria-label','Parcourir les modifications');navigation.hidden=true;
  const counter=node('span');
  const previous=button('Précédente',()=>jump(-1));
  const next=button('Suivante',()=>jump(1));
  navigation.append(previous,counter,next);
  main.append(head,status,scroll,navigation);element.append(sidebar,main);
  // Historical links must never navigate away from the live page behind the dialog.
  render.addEventListener('click',event=>{if(event.target instanceof Element && event.target.closest('a')) event.preventDefault();});
  const begin = (): number => {state.controller.abort();state.controller=new AbortController();return ++state.epoch;};
  const valid = (epoch:number): boolean => !state.destroyed && element.open && epoch===state.epoch;
  const showError = (error:unknown): void => {status.textContent=error instanceof Error?error.message:'Impossible de charger l’historique. Réessayez.';};
  const changed = (): HTMLElement[] => [...render.querySelectorAll<HTMLElement>('[data-history-change]')];
  function jump(direction:number): void {
    const items=changed();if(!items.length)return;
    state.change=(state.change+direction+items.length)%items.length;
    items[state.change].scrollIntoView({block:'center',behavior:'instant'});
    counter.textContent=`${state.change+1} / ${items.length} modifications`;
  }
  function clearConfirmation(): void {
    state.confirming=false;confirmation.hidden=true;confirmation.replaceChildren();content.hidden=false;legend.hidden=false;
    grouping.disabled=false;list.querySelectorAll('button').forEach(item=>{item.removeAttribute('disabled');});
    restore.disabled=!state.ready || !state.selected || keyOf(state.selected)===state.current || !options.canRestore();
    navigation.hidden=changed().length===0;
  }
  function drawList(): void {
    list.replaceChildren(...state.versions.map(version=>{
      const item=button('',()=>{void select(version);},'data-history-version');item.setAttribute('data-history-version',keyOf(version));
      item.disabled=state.confirming || state.busy;
      item.setAttribute('aria-pressed',String(state.selected!==null && keyOf(version)===keyOf(state.selected)));
      const when=node('strong',undefined,dateLabel(version.savedAt));
      const who=node('span',undefined,version.actors.map(options.actorName).join(', ') || 'Auteur inconnu');
      item.append(when,who);
      if(keyOf(version)===state.current)item.append(node('small',undefined,'Version actuelle'));
      return item;
    }));
  }
  async function select(version:HistoryVersion): Promise<void> {
    if(state.busy || state.confirming)return;
    const epoch=begin();state.selected=version;state.ready=false;restore.disabled=true;state.document=null;
    drawList();selectedLabel.textContent=`${dateLabel(version.savedAt)} · Lecture seule`;
    status.textContent='Chargement de la version…';render.replaceChildren();documentTitle.textContent='';navigation.hidden=true;legend.hidden=true;
    const index=state.versions.indexOf(version);
    const older=state.versions[index+1];
    try {
      // Only the chosen version and its predecessor are read, never every version.
      const [data,before]=await Promise.all([api.read(version,state.controller.signal),older?.lineage===version.lineage?api.read(older,state.controller.signal):Promise.resolve(null)]);
      if(!valid(epoch))return;
      state.document=data;
      const preview=before?changePreview(before,data,diffOutputData):{blocks:data.blocks,marks:{}};
      render.innerHTML=blocksToHtml({blocks:preview.blocks},{toolAttributes:true,blockIds:true,root:true,classes:true});
      render.querySelectorAll<HTMLElement>('[contenteditable]').forEach(item=>item.removeAttribute('contenteditable'));
      render.querySelectorAll<HTMLInputElement>('input,button,select,textarea').forEach(item=>{item.setAttribute('disabled','');});
      render.querySelectorAll<HTMLElement>('[data-blok-id]').forEach(item=>{
        const id=item.getAttribute('data-blok-id');
        if(id && id in preview.marks)item.setAttribute('data-history-change',preview.marks[id]);
      });
      documentTitle.textContent=data.page?.title || options.title();
      state.ready=true;restore.disabled=keyOf(version)===state.current || !options.canRestore();
      status.textContent=keyOf(version)===state.current?'Dernière version enregistrée.':'';
      legend.hidden=before===null;state.change=0;
      const count=changed().length;navigation.hidden=count===0;counter.textContent=`${count?1:0} / ${count} modifications`;
      scroll.scrollTop=0;
    } catch(error){if(valid(epoch))showError(error);}
  }
  async function load(): Promise<void> {
    const epoch=begin();state.ready=false;state.selected=null;restore.disabled=true;state.current='';state.versions=[];
    list.replaceChildren();render.replaceChildren();navigation.hidden=true;legend.hidden=true;selectedLabel.textContent='';documentTitle.textContent='';
    status.textContent='Chargement de l’historique…';pageTitle.textContent=options.title();
    try {
      const result=await api.list(grouping.value,state.controller.signal);if(!valid(epoch))return;
      state.versions=result.versions;
      const currentLineage=result.lineages.find(item=>item.current)?.lineage;
      const current=state.versions.find(item=>item.lineage===currentLineage);
      state.current=current?keyOf(current):'';drawList();
      if(state.versions[0])await select(state.versions[0]);else status.textContent='Aucune version enregistrée pour cette page.';
    }catch(error){if(valid(epoch))showError(error);}
  }
  async function confirm(): Promise<void> {
    const selected=state.selected;if(!selected || !state.ready || !options.canRestore() || state.busy || state.confirming)return;
    const epoch=begin();restore.disabled=true;status.textContent='Vérification de la restauration…';
    try {
      const plan=await api.preview(selected,state.controller.signal);if(!valid(epoch))return;
      state.confirming=true;grouping.disabled=true;list.querySelectorAll('button').forEach(item=>{item.setAttribute('disabled','');});
      content.hidden=true;legend.hidden=true;navigation.hidden=true;confirmation.hidden=false;
      const heading=node('h2',undefined,`Restaurer la version du ${dateLabel(selected.savedAt)} ?`);
      const summary=node('p',undefined,`${plan.wouldUndo.blocks.length} bloc${plan.wouldUndo.blocks.length===1?'':'s'} concerné${plan.wouldUndo.blocks.length===1?'':'s'} par la restauration.`);
      const fields=node('p');
      const fieldNames=plan.wouldUndo.page.map(field=>({title:'titre',icon:'icône'}[field] ?? 'propriétés de la page'));
      if(fieldNames.length)fields.textContent=`Également restaurés : ${[...new Set(fieldNames)].join(', ')}.`;
      const details=node('ul');
      const names:Record<string,string>={added:'à ajouter',removed:'à supprimer',changed:'à modifier',moved:'à déplacer'};
      ['added','removed','changed','moved'].forEach(kind=> {
        const count=plan.wouldUndo.blocks.filter(item=>item.kind===kind).length;
        if(count)details.append(node('li',undefined,`${count} bloc${count===1?'':'s'} ${names[kind]}`));
      });
      const confirmations:HTMLInputElement[]=[];
      for(const guard of plan.guards) {
        const label=node('label','data-history-guard');const input=node('input');input.type='checkbox';
        label.append(input,document.createTextNode(`${guardLabels[guard.kind] ?? 'Cette restauration demande une confirmation non prise en charge'} (${guard.blockId})`));
        confirmations.push(input);details.append(node('li'));details.lastElementChild?.append(label);
      }
      const eligible=plan.fits && plan.guards.every(guard=>guard.kind in guardLabels) && options.canRestore();
      const apply=button('Confirmer la restauration',()=>{void commit(selected,plan,apply);});
      const sync=():void=>{apply.disabled=!eligible || confirmations.some(input=>!input.checked);};
      confirmations.forEach(input=>input.addEventListener('change',sync));sync();
      const cancel=button('Annuler',()=>{clearConfirmation();restore.focus();status.textContent='';});
      confirmation.replaceChildren(heading,summary,fields,details,node('p',undefined,'Le contenu, le titre et l’icône de la page reviendront à cette version. Les sous-pages conservent leur propre historique. Les autres versions restent disponibles.'),apply,cancel);
      status.textContent=plan.fits?'':'Cette version dépasse la taille autorisée pour une restauration.';
      cancel.focus();
    }catch(error){if(valid(epoch)){showError(error);restore.disabled=false;}}
  }
  async function commit(selected:HistoryVersion,plan:RestorePlan,apply:HTMLButtonElement):Promise<void> {
    if(state.busy || apply.disabled || !options.canRestore())return;
    state.busy=true;apply.setAttribute('disabled','');dismiss.disabled=true;confirmation.querySelectorAll('button,input').forEach(item=>item.setAttribute('disabled',''));
    status.textContent='Restauration en cours…';
    try {
      await api.restore(selected,plan,crypto.randomUUID());
    }catch(error){
      if(!state.destroyed){clearConfirmation();showError(error);restore.focus();}
      state.busy=false;dismiss.disabled=false;return;
    }
    state.busy=false;dismiss.disabled=false;if(state.destroyed)return;
    clearConfirmation();
    // Sync delivers the restored document to the still-mounted editor.
    await Promise.resolve(options.onRestored()).catch(()=>undefined);
    if(state.destroyed || !element.open)return;
    await load();if(element.open)status.textContent=state.ready?'Version restaurée. Elle est maintenant la version actuelle.':`Version restaurée. ${status.textContent ?? ''}`;
  }
  function close(force=false):void {
    if(state.busy && !force)return;
    begin();clearConfirmation();element.close();
    if(state.returnFocus?.isConnected)state.returnFocus.focus({preventScroll:true});
  }
  grouping.addEventListener('change',()=>{void load();});
  element.addEventListener('cancel',event=>{event.preventDefault();if(state.busy)return;if(state.confirming){clearConfirmation();restore.focus();}else close();});
  element.addEventListener('keydown',event=>event.stopPropagation());
  return {element,async open(){
    if(state.destroyed || element.open)return;
    state.returnFocus=options.returnFocus?.() ?? (document.activeElement instanceof HTMLElement?document.activeElement:null);
    if(!element.isConnected)document.body.append(element);
    element.showModal();dismiss.focus();await load();
  },refreshActors(){if(element.open)drawList();},refreshAccess(){
    if(state.confirming || state.busy)return;
    restore.disabled=!state.ready || !state.selected || keyOf(state.selected)===state.current || !options.canRestore();
  },close:()=>close(),destroy(){state.destroyed=true;close(true);element.remove();}};
}
