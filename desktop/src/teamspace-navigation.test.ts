import {afterEach,describe,expect,it,vi} from 'vitest';
import {createPageFrame} from '@blok/sidebar';
import {must} from './test-helpers';
afterEach(()=>document.body.replaceChildren());
describe('real teamspace sidebar',()=>{
 it('renders Private first, independent teamspaces and old common pages, with no workspace impersonating a teamspace',()=>{
  const create=vi.fn(),manage=vi.fn(),menu=vi.fn();
  const frame=createPageFrame({pages:[{id:'private',title:'Personnel',parentId:null,section:'Privé'},{id:'legacy',title:'Ancienne commune',parentId:null,section:'workspace'},{id:'product',title:'Specs',parentId:null,section:'teamspace:product'},{id:'editorial',title:'Articles',parentId:null,section:'teamspace:editorial'}],activeId:'product',onOpen:vi.fn(),onCreate:vi.fn(),onCreatePrivate:vi.fn(),teamspaces:[{id:'product',name:'Produit',icon:'🛠️',canCreate:true},{id:'editorial',name:'Rédaction',icon:'✍️',canCreate:false}],onCreateTeamspacePage:create,onManageTeamspaces:manage,onTeamspaceMenu:menu});document.body.append(frame.element);
  const headings=[...frame.element.querySelectorAll('[data-blok-sidebar-section-label]')].map(node=>node.textContent);
  expect(headings.indexOf('Privé')).toBeLessThan(headings.indexOf('Espaces d’équipe'));
  expect([...frame.element.querySelectorAll('[data-blok-sidebar-teamspace]')].map(node=>node.getAttribute('data-blok-sidebar-teamspace'))).toEqual(['product','editorial']);
  expect(frame.element.querySelector('[data-blok-sidebar-teamspace-pages=product]')?.textContent).toContain('Specs');
  expect(frame.element.querySelector<HTMLElement>('[data-blok-sidebar-teamspace-pages=product] [data-blok-sidebar-row]')?.style.paddingInlineStart).toBe('24px');
  expect(frame.element.querySelector('[data-blok-sidebar-teamspace-pages=product]')?.textContent).not.toContain('Articles');
  expect(frame.element.textContent).toContain('Pages communes du Workspace');
  must(frame.element.querySelector<HTMLButtonElement>('[aria-label="Créer dans Produit"]')).click();expect(create).toHaveBeenCalledWith('product');
  expect(frame.element.querySelector('[aria-label="Créer dans Rédaction"]')).toBeNull();
  must(frame.element.querySelector<HTMLButtonElement>('[aria-label="Paramètres de Rédaction"]')).click();expect(menu).toHaveBeenCalledWith(expect.any(HTMLButtonElement),'editorial');
  must(frame.element.querySelector<HTMLButtonElement>('[aria-label="Gérer les espaces d’équipe"]')).click();expect(manage).toHaveBeenCalledOnce();
  must(frame.element.querySelector<HTMLButtonElement>('[aria-label="Produit"]')).click();expect(frame.element.querySelector('[data-blok-sidebar-teamspace-pages=product]')).toBeNull();expect(frame.element.querySelector('[data-blok-sidebar-teamspace-pages=editorial]')).not.toBeNull();
 });
 it('renders empty joined teamspaces and leaves shared roots outside a fabricated hierarchy',()=>{
  const frame=createPageFrame({pages:[{id:'orphan',title:'Partagé directement',parentId:null,section:'Partagé'}],activeId:'orphan',teamspaces:[{id:'empty',name:'Équipe vide',canCreate:false}],onOpen:vi.fn(),onCreate:vi.fn()});document.body.append(frame.element);
  expect(frame.element.querySelector('[data-blok-sidebar-teamspace=empty]')).not.toBeNull();
  expect(frame.element.querySelector('[data-blok-sidebar-teamspace-pages=empty]')?.textContent).not.toContain('Partagé directement');
 });
});
