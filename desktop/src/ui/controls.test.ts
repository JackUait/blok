import {afterEach,describe,expect,it,vi} from 'vitest';
import {openModalDialog} from '@blok/modal-dialog';
import {createChoice,styleTextField,wrapSearchField} from './controls';
const dispose: Array<()=>void> = [];
afterEach(()=>{dispose.splice(0).reverse().forEach(fn=>fn());document.body.replaceChildren();});
function choice() {
  const changed=vi.fn();
  const control=createChoice({label:'Thème',value:'dark',options:[{value:'dark',label:'Sombre'},{value:'light',label:'Clair'},{value:'auto',label:'Système',disabled:true}],onChange:changed});
  document.body.append(control.element);dispose.push(()=>control.destroy());return {control,changed};
}
describe('shared editor design-system controls',()=>{
  it('uses the real checked popover and applies a selected value once',async()=>{
    const {control,changed}=choice();control.element.click();
    expect(document.querySelector('[data-blok-item-name=dark]')?.getAttribute('role')).toBe('menuitemradio');
    expect(document.querySelector('[data-blok-item-name=dark]')?.getAttribute('aria-checked')).toBe('true');
    document.querySelector<HTMLElement>('[data-blok-item-name=auto]')!.click();expect(changed).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('[data-blok-item-name=light]')!.click();
    expect(control.value).toBe('light');expect(control.element.textContent).toContain('Clair');expect(changed).toHaveBeenCalledExactlyOnceWith('light');
    await vi.waitFor(()=>expect(document.querySelector('[data-desktop-choice-popover]')).toBeNull());
  });
  it('supports keyboard opening and choosing an enabled option',()=>{
    const {control,changed}=choice();control.element.focus();
    control.element.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,cancelable:true}));
    expect(changed).toHaveBeenCalledWith('light');
  });
  it('closes only the menu on Escape inside a real repository modal',()=>{
    const {control}=choice();const overlay=document.createElement('div');const surface=document.createElement('section');surface.append(control.element);overlay.append(surface);
    let closed=false;const modal=openModalDialog({content:overlay,surface,label:'Paramètres',onDismiss:()=>modal.close(),onClose:()=>{closed=true;}});dispose.push(()=>modal.close());
    control.element.click();expect(control.element.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(control.element.getAttribute('aria-expanded')).toBe('false');expect(closed).toBe(false);expect(document.activeElement).toBe(control.element);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(closed).toBe(true);
  });
  it('closes a portal when disabled or destroyed and never exposes a native select',async()=>{
    const {control}=choice();control.element.click();control.disabled=true;
    expect(control.element.getAttribute('aria-expanded')).toBe('false');control.element.click();expect(control.element.getAttribute('aria-expanded')).toBe('false');
    control.disabled=false;control.element.click();control.destroy();
    await vi.waitFor(()=>expect(document.querySelector('[data-desktop-choice-popover]')).toBeNull());
    expect(document.querySelector('select')).toBeNull();
  });
  it('keeps semantic text editing and uses the real core field/search markers',()=>{
    const email=document.createElement('input');email.type='email';email.required=true;styleTextField(email);
    expect(email.getAttribute('data-blok-field')).toBe('text');expect(email.type).toBe('email');expect(email.required).toBe(true);
    const search=document.createElement('input');search.type='search';styleTextField(search);const field=wrapSearchField(search);
    expect(field.getAttribute('data-blok-field')).toBe('search');expect(field.firstElementChild).toBe(search);expect(search.hasAttribute('data-blok-field')).toBe(false);
  });
});
