import {PopoverDesktop} from '@blok/popover';
import {IconCheck, IconChevronDown} from '../../../src/components/icons';
import './controls.css';

export interface ChoiceOption<T extends string> {value: T; label: string; description?: string; disabled?: boolean}
export interface ChoiceControl<T extends string> {
  element: HTMLButtonElement;
  readonly value: T;
  setValue(value: T): void;
  disabled: boolean;
  destroy(): void;
}
export interface ChoiceOptions<T extends string> {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  searchable?: boolean;
  onChange(value: T): void;
}
const palette = ['--blok-popover-bg','--blok-popover-border','--blok-text-primary','--blok-text-secondary','--blok-item-hover-bg','--blok-icon-active-bg','--blok-focus-ring','--blok-search-input-placeholder'] as const;

/** The editor's own checked popover menu, shared by app and workspace settings. */
export function createChoice<T extends string>(options: ChoiceOptions<T>): ChoiceControl<T> {
  const element = document.createElement('button');
  element.type = 'button'; element.setAttribute('data-desktop-choice','');
  element.setAttribute('aria-label',options.label); element.setAttribute('aria-haspopup','menu'); element.setAttribute('aria-expanded','false');
  const text = document.createElement('span'); text.setAttribute('data-desktop-choice-label','');
  const arrow = document.createElement('span'); arrow.innerHTML = IconChevronDown; arrow.setAttribute('aria-hidden','true');
  element.append(text,arrow);
  const id = `desktop-choice-${crypto.randomUUID()}`;
  text.id=`${id}-value`; element.setAttribute('aria-describedby',text.id);
  let value = options.value;
  let popover: PopoverDesktop | null = null;
  let destroyed = false;
  function render(): void {
    text.textContent = options.options.find((option)=>option.value === value)?.label ?? value;
    element.setAttribute('aria-label',options.label);
  }
  const close = (): void => { popover?.hide(); };
  function open(last = false): void {
    if (element.disabled || destroyed) return;
    if (popover?.isShown) { close(); return; }
    const searchable = options.searchable ?? options.options.length > 8;
    const menu = new PopoverDesktop({
      trigger: element, class: 'desktop-choice-popover', width:'auto', minWidth:`${Math.max(180,element.getBoundingClientRect().width)}px`,
      autoFocusFirstItem:searchable, searchable, messages:{search:"Rechercher…"}, flippable:true,
      items:options.options.map((option)=>({
        name:option.value, title:option.label, description:option.description, toggle:id, isActive:()=>option.value === value,
        isDisabled:option.disabled, trailingIcon:option.value === value ? IconCheck : undefined, closeOnActivate:true,
        onActivate:()=>{ if(option.disabled) return; value=option.value;render();options.onChange(value); },
      })),
    });
    popover = menu;
    const root = menu.getElement(); root.id=id; root.setAttribute('data-desktop-choice-popover',''); root.setAttribute('aria-label',options.label);
    const style=getComputedStyle(element); for(const token of palette) { const color=style.getPropertyValue(token); if(color) root.style.setProperty(token,color); }
    element.setAttribute('aria-controls',id); element.setAttribute('aria-expanded','true');
    let settled = false;
    menu.on('closed',()=>{
      if (settled) return;
      settled = true;
      if(popover === menu) { popover=null;element.setAttribute('aria-expanded','false');element.removeAttribute('aria-controls'); }
      if(element.isConnected && !element.disabled && !destroyed) element.focus();
      queueMicrotask(()=>menu.destroy());
    });
    menu.show();
    const enabled=options.options.filter((option)=>!option.disabled);
    const focused=last ? enabled.at(-1)?.value : enabled.find((option)=>option.value === value)?.value ?? enabled[0]?.value;
    if(!searchable && focused !== undefined) menu.focusItemByName(focused);
  }
  const click=():void=>open();
  const key=(event:KeyboardEvent):void=>{
    if(!['ArrowDown','ArrowUp'].includes(event.key)) return;
    event.preventDefault(); open(event.key === 'ArrowUp');
  };
  element.addEventListener('click',click); element.addEventListener('keydown',key);
  const observer=new MutationObserver(()=>{if(element.disabled) close();}); observer.observe(element,{attributes:true,attributeFilter:['disabled']});
  render();
  return {
    element,
    get value(){return value;},
    setValue(next){value=next;render();close();},
    get disabled(){return element.disabled;},
    set disabled(next){element.disabled=next;if(next)close();},
    destroy(){if(destroyed)return;destroyed=true;observer.disconnect();element.removeEventListener('click',click);element.removeEventListener('keydown',key);popover?.destroy();popover=null;element.setAttribute('aria-expanded','false');element.removeAttribute('aria-controls');},
  };
}

/** Keep semantic native text editing while using the editor's shared field box. */
export function styleTextField<T extends HTMLInputElement | HTMLTextAreaElement>(input: T): T {
  input.setAttribute('data-blok-field','text'); return input;
}
/** Search uses the core field wrapper and glyph, with an unboxed native input. */
export function wrapSearchField(input: HTMLInputElement): HTMLDivElement {
  input.removeAttribute('data-blok-field');
  const wrapper=document.createElement('div');wrapper.setAttribute('data-blok-field','search');wrapper.append(input);return wrapper;
}
