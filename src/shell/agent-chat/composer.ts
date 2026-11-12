import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import { IconCheck } from '../../components/icons';
import { chatIcon } from './icons';

export interface ChatProvider {
  id: string;
  label: string;
}

export interface ChatComposerOptions {
  providers: readonly ChatProvider[];
  selectedProvider?: string;
  includePage?: boolean;
  sendLabel?: string;
  onSend: (message: string, provider: string, includePage: boolean) => void;
  onStop?: () => void;
  onProviderChange?: (provider: string) => void;
  onContextChange?: (includePage: boolean) => void;
}

export interface ChatComposerHandle {
  element: HTMLFormElement;
  field: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  setRunning: (running: boolean) => void;
  setProviders: (providers: readonly ChatProvider[], selectedProvider?: string) => void;
  setText: (text: string) => void;
  focus: () => void;
  destroy: () => void;
}

export const createChatComposer = (options: ChatComposerOptions): ChatComposerHandle => {
  const element = document.createElement('form');
  const field = document.createElement('textarea');
  const controls = document.createElement('div');
  const page = document.createElement('button');
  const providerWrap = document.createElement('span');
  const provider = document.createElement('button');
  provider.type = 'button';
  provider.setAttribute('data-blok-chat-provider-trigger', '');
  provider.setAttribute('aria-haspopup', 'menu');
  provider.setAttribute('aria-expanded', 'false');
  const providerText = document.createElement('span');
  providerText.id = `blok-chat-model-${crypto.randomUUID()}`;
  provider.setAttribute('aria-describedby', providerText.id);
  provider.append(providerText);
  const submit = document.createElement('button');
  const state = { running: false, includePage: options.includePage ?? true };

  element.setAttribute('data-blok-chat-composer', '');
  element.setAttribute('aria-label', 'Message à l’assistant');
  field.setAttribute('aria-label', 'Demander à l’assistant');
  field.placeholder = 'Demander à l’assistant…';
  field.rows = 2;
  controls.setAttribute('data-blok-chat-composer-controls', '');
  page.type = 'button';
  page.setAttribute('data-blok-chat-page-context', '');
  page.setAttribute('aria-label', 'Inclure cette page');
  page.setAttribute('aria-pressed', String(state.includePage));
  page.append(chatIcon('check', 14), document.createTextNode('Cette page'));
  providerWrap.setAttribute('data-blok-chat-provider', '');
  provider.setAttribute('aria-label', 'Moteur IA');
  let providers: readonly ChatProvider[] = [];
  let providerMenu: PopoverDesktop | null = null;
  let destroyed = false;
  const closeProviderMenu = (): void => { providerMenu?.hide(); };
  const fillProviders = (next: readonly ChatProvider[], selected?: string): void => {
    closeProviderMenu(); providers = next;
    provider.value = next.some((item) => item.id === selected) ? selected! : next[0]?.id ?? '';
    const label = next.find((item) => item.id === provider.value)?.label ?? 'Choisir un modèle';
    providerText.textContent = label; provider.title = label;
    provider.disabled = next.length === 0;
  };
  const openProviderMenu = (last = false): void => {
    if (provider.disabled || destroyed) return;
    if (providerMenu?.isShown) { closeProviderMenu(); return; }
    const searchable = providers.length > 8;
    const menu = new PopoverDesktop({
      trigger: provider, class:'blok-chat-provider-menu', searchable,
      messages:{search:'Rechercher un modèle…'}, width:'auto', minWidth:'240px', autoFocusFirstItem:searchable,
      items:providers.map((item) => ({name:item.id,title:item.label,toggle:providerText.id,
        isActive:()=>provider.value === item.id,trailingIcon:provider.value === item.id ? IconCheck : undefined,closeOnActivate:true,
        onActivate:()=>{
          provider.value=item.id;providerText.textContent=item.label;provider.title=item.label;
          options.onProviderChange?.(item.id);sync();
        },
      })),
    });
    providerMenu=menu;
    const root=menu.getElement(); root.id=`${providerText.id}-menu`;root.setAttribute('data-blok-chat-model-menu','');root.setAttribute('aria-label','Modèles IA');
    const style=getComputedStyle(provider);
    for(let index=0;index<style.length;index++) {const token=style.item(index);if(token.startsWith('--blok-'))root.style.setProperty(token,style.getPropertyValue(token));}
    provider.setAttribute('aria-controls',root.id);provider.setAttribute('aria-expanded','true');
    let closed=false;
    menu.on(PopoverEvent.Closed,()=>{
      if(closed)return;closed=true;
      if(providerMenu===menu){providerMenu=null;provider.setAttribute('aria-expanded','false');provider.removeAttribute('aria-controls');}
      if(!destroyed&&provider.isConnected)provider.focus();
      queueMicrotask(()=>menu.destroy());
    });
    menu.show();
    if(!searchable){const chosen=last?providers.at(-1)?.id:provider.value;if(chosen)menu.focusItemByName(chosen);}
  };
  provider.addEventListener('click',()=>openProviderMenu());
  provider.addEventListener('keydown',(event)=>{
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();openProviderMenu(event.key==='ArrowUp');
  });
  fillProviders(options.providers, options.selectedProvider);
  providerWrap.append(provider, chatIcon('chevron', 14));
  submit.type = 'submit';
  submit.setAttribute('data-blok-chat-submit', '');
  submit.setAttribute('aria-label', options.sendLabel ?? 'Envoyer');
  submit.append(chatIcon('send'));
  controls.append(page, providerWrap, submit);
  element.append(field, controls);

  const sizeField = (): void => {
    field.style.height = 'auto';
    field.style.height = `${Math.max(52, Math.min(field.scrollHeight, 144))}px`;
    field.style.overflowY = field.scrollHeight > 144 ? 'auto' : 'hidden';
  };
  const sync = (): void => {
    submit.disabled = state.running ? options.onStop === undefined : field.value.trim() === '' || provider.disabled;
    submit.setAttribute('aria-label', state.running ? 'Arrêter la réponse' : options.sendLabel ?? 'Envoyer');
    submit.replaceChildren(chatIcon(state.running ? 'stop' : 'send'));
  };

  field.addEventListener('input', () => { sizeField(); sync(); });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    if (!submit.disabled) element.requestSubmit();
  });
  page.addEventListener('click', () => {
    state.includePage = !state.includePage;
    page.setAttribute('aria-pressed', String(state.includePage));
    options.onContextChange?.(state.includePage);
  });
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.running) {
      options.onStop?.();
      return;
    }

    const message = field.value.trim();

    if (message === '' || provider.disabled) return;
    options.onSend(message, provider.value, state.includePage);
    field.value = '';
    sizeField();
    sync();
  });
  sizeField();
  sync();

  return {
    element,
    field,
    submit,
    setRunning: (next) => {
      state.running = next;
      field.disabled = next;
      element.toggleAttribute('data-running', next);
      sync();
    },
    setProviders: (providers, selected) => {
      fillProviders(providers, selected ?? provider.value);
      sync();
    },
    setText: (text) => {
      field.value = text;
      sizeField();
      sync();
    },
    focus: () => field.focus(),
    destroy: () => { destroyed=true;providerMenu?.destroy();providerMenu=null; },
  };
};
