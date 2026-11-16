import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createMemberProfiles} from './member-profile';

const controllers: ReturnType<typeof createMemberProfiles>[]=[];
beforeEach(()=>{vi.clearAllMocks();history.replaceState(null,'','/?page=sprints');});
afterEach(()=>{controllers.splice(0).forEach(controller=>controller.destroy());document.body.replaceChildren();history.replaceState(null,'','/');vi.restoreAllMocks();});
const people=[{id:'camille',name:'Camille',email:'camille@example.test',role:'member' as const,avatarUrl:''}];
it('opens a real member profile without replacing the underlying page and shares directory requests',async()=>{
 const source=vi.fn().mockResolvedValue({members:people});
 const controller=createMemberProfiles({workspaceName:'Equipe',members:source});controllers.push(controller);
 const editor=document.createElement('article');editor.textContent='Unsaved page';document.body.append(editor);
 await Promise.all([controller.list(),controller.list()]);expect(source).toHaveBeenCalledTimes(1);
 await controller.open('camille');
 expect(document.querySelector('[data-member-profile] h1')?.textContent).toBe('Camille');
 expect(document.querySelector<HTMLAnchorElement>('[data-member-profile] a[href^="mailto:"]')?.href).toBe('mailto:camille@example.test');
 expect(editor.isConnected).toBe(true);expect(new URL(location.href).searchParams.get('profile')).toBe('camille');
 expect(new URL(location.href).searchParams.get('page')).toBe('sprints');
});
it('does not display a stale profile after closing during its directory request',async()=>{
 const pendingDirectory={resolve:undefined as ((value:{members:typeof people})=>void)|undefined};
 const source=()=>new Promise<{members:typeof people}>(done=>{pendingDirectory.resolve=done;});
 const controller=createMemberProfiles({workspaceName:'Equipe',members:source});controllers.push(controller);
 const pending=controller.open('camille');controller.close();pendingDirectory.resolve?.({members:people});await pending;
 expect(document.querySelector('[data-member-profile]')).toBeNull();
});
it('never invents profiles for people absent from the authorized directory',async()=>{
 const controller=createMemberProfiles({workspaceName:'Equipe',members:async()=>({members:people})});controllers.push(controller);
 await controller.open('unknown');
 expect(document.querySelector('[data-member-profile]')?.textContent).toContain('Profil indisponible');
 expect(document.querySelector('[data-member-profile] a[href^="mailto:"]')).toBeNull();
});
