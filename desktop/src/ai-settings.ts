import { createAiClient, aiChanged, nativeBridge, type AiClient, type AiConfig, type AiScope } from './ai-client';
import { providerStatus } from './assistant';
import { createChoice, styleTextField } from './ui/controls';
import type { WorkspaceRef } from './workspace-registry';
import './ai-settings.css';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); item.textContent = text; return item;
}
function button(text: string, run: () => void): HTMLButtonElement {
  const item = node('button', text); item.type = 'button'; item.classList.add('blok-button'); item.addEventListener('click', run); return item;
}
const sourceLabel = (source: AiConfig['effective']['source']): string => source === 'personal' ? 'Clé personnelle' : source === 'workspace' ? 'Clé du workspace' : 'Aucune clé configurée';

export function mountAiSettings(container: HTMLElement, ref: WorkspaceRef, client: AiClient = createAiClient(ref)): {destroy(): void} {
  let dead = false;
  let generation = 0;
  const choices: {destroy():void}[] = [];
  let gate = new AbortController();
  container.setAttribute('data-ai-settings','');
  const heading = node('h1', 'Assistant IA'); heading.setAttribute('data-desktop-settings-title','');
  const intro = node('p', 'Choisissez le modèle qui répond dans l’assistant. Votre clé personnelle est prioritaire sur celle du workspace.'); intro.setAttribute('data-desktop-settings-intro','');
  const body = node('div');
  const status = node('p'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  container.append(heading, intro, body, status);

  const notify = (error: unknown): void => { if (!dead) status.textContent = error instanceof Error ? error.message : String(error); };
  const mutate = async (action: () => Promise<unknown>, form: HTMLElement): Promise<void> => {
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')];
    controls.forEach((control)=>{control.disabled=true;}); status.textContent='Enregistrement…';
    try {
      await action();
      form.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input=>{input.value='';});
      aiChanged(); await render();
      if (!dead) status.textContent='Configuration enregistrée.';
    } catch (error) { notify(error); }
    finally { controls.forEach((control)=>{control.disabled=false;}); }
  };
  const section = (scope: AiScope, config: AiConfig, stamp: number): HTMLElement => {
    const credential = config[scope];
    const title = scope === 'personal' ? 'Ma clé OpenAI' : 'OpenAI pour le workspace';
    const area = node('section'); area.setAttribute('data-ai-scope',scope); area.append(node('h2',title));
    area.append(node('p', scope === 'personal'
      ? ref.kind === 'local' ? 'Conservée dans le trousseau de ce Mac.' : 'Réservée à votre compte sur ce serveur. Elle remplace la clé du workspace pour vos demandes.'
      : 'Utilisée par les membres qui n’ont pas de clé personnelle. Seuls les administrateurs peuvent la modifier.'));
    const state = node('p', credential.configured ? 'Clé enregistrée · valeur masquée' : 'Aucune clé enregistrée'); area.append(state);
    const key = styleTextField(node('input')); key.type='password'; key.autocomplete='new-password'; key.spellcheck=false; key.maxLength=4096;
    key.setAttribute('aria-label', scope === 'personal' ? 'Clé API personnelle OpenAI' : 'Clé API OpenAI du workspace'); key.placeholder=credential.configured ? 'Nouvelle clé pour remplacer l’actuelle' : 'Collez votre clé API OpenAI';
    const form=node('form'); const actions=node('div'); actions.setAttribute('data-ai-actions','');
    const save=button(credential.configured ? 'Remplacer la clé' : 'Enregistrer la clé',()=>undefined); save.type='submit'; save.disabled=true;
    key.addEventListener('input',()=>{save.disabled=key.value.trim().length === 0;});
    actions.append(save);
    if (credential.configured) actions.append(button('Retirer la clé',()=>{void mutate(()=>client.remove(scope), area);}));
    form.append(key,actions); form.addEventListener('submit',(event)=>{event.preventDefault();const apiKey=key.value.trim();if(apiKey)void mutate(()=>client.save(scope,{apiKey}),area);});
    area.append(form);
    if (credential.configured) {
      const models=node('div'); models.setAttribute('data-ai-models',''); area.append(models);
      const refresh = async (): Promise<void> => {
        models.replaceChildren(node('p','Chargement des modèles…'));
        try {
          const result=await client.models(scope,gate.signal);
          if(dead || stamp !== generation) return;
          const available=[...new Set(result.models.map(model=>model.id))].sort();
          const options=[{value:'',label:'Choisir un modèle',disabled:true},...available.map(id=>({value:id,label:id}))];
          if(credential.model && !available.includes(credential.model)) options.push({value:credential.model,label:`${credential.model} (enregistré)`});
          const choice=createChoice({label:`Modèle OpenAI ${scope === 'personal' ? 'personnel' : 'du workspace'}`,value:credential.model,options,onChange:(model)=>{void mutate(()=>client.save(scope,{model}),area);}});
          choices.push(choice); models.replaceChildren(node('h3','Modèle par défaut'), choice.element);
          models.append(button('Actualiser les modèles',()=>{choice.destroy();void refresh();}));
          if(!available.length) models.append(node('p','Aucun modèle de texte disponible pour cette clé.'));
        } catch(error) {
          if(dead || stamp !== generation) return;
          models.replaceChildren(node('p',error instanceof Error ? error.message : String(error)),button('Réessayer',()=>{void refresh();}));
        }
      }; void refresh();
    }
    return area;
  };
  const render = async (): Promise<void> => {
    if(dead) return;
    const stamp=++generation; gate.abort(); gate=new AbortController(); choices.splice(0).forEach(choice=>choice.destroy());
    body.replaceChildren(node('p','Chargement…'));
    if(!client.available) {body.replaceChildren(node('p','Configurez OpenAI depuis un espace en ligne ou l’application Blok pour macOS.'));return;}
    try {
      const config=await client.config(gate.signal);
      if(dead || stamp !== generation) return;
      const effective=node('div');effective.setAttribute('data-ai-effective','');
      effective.append(node('strong',sourceLabel(config.effective.source)),node('span',config.effective.model ? ` · ${config.effective.model}` : ' · Modèle à choisir'));
      body.replaceChildren(effective, section('personal',config,stamp));
      if(ref.kind === 'remote') {
        if(config.canManageWorkspace) body.append(section('workspace',config,stamp));
        else body.append(node('p',config.workspace.configured ? `Clé du workspace disponible${config.workspace.model ? ` · ${config.workspace.model}` : ''}. Gérée par un administrateur.` : 'Aucune clé partagée. Un administrateur peut en ajouter une pour le workspace.'));
      }
    } catch(error) {
      if(dead || stamp !== generation) return;
      body.replaceChildren(node('p',error instanceof Error ? error.message : String(error)),button('Réessayer',()=>{void render();}));
    }
  };
  void render();
  if(nativeBridge()) {
    const local=node('section');local.append(node('h2','Agents sur ce Mac'),node('p','Codex et Claude Code restent disponibles avec leur connexion CLI. Choisissez-les dans l’assistant.'));
    for(const provider of ['codex','claude'] as const) {
      const state=node('p',`${provider === 'codex' ? 'Codex' : 'Claude Code'} · Vérification…`);state.setAttribute('data-desktop-settings-provider-status','');local.append(state);
      void providerStatus(provider).then(result=>{if(!dead)state.textContent=`${provider === 'codex' ? 'Codex' : 'Claude Code'} · ${result.connected ? 'Connecté' : result.installed ? 'Non connecté' : 'Non installé'}`;}).catch(()=>{if(!dead)state.textContent='État indisponible';});
    } container.append(local);
  }
  const disclosure=node('p','Votre demande et le texte de la page, si vous l’activez, sont envoyés au fournisseur sélectionné. Les appels OpenAI utilisent la facturation de la clé indiquée.'); disclosure.setAttribute('data-desktop-settings-explanation',''); container.append(disclosure);
  return {destroy(){dead=true;++generation;gate.abort();choices.splice(0).forEach(choice=>choice.destroy());container.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input=>{input.value='';});}};
}
