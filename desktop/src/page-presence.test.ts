import {afterEach, expect, it, vi} from 'vitest';
import {createPagePresence} from './page-presence';
import type {CollaborationParticipant} from '../../types/events/editor-events';
it('opens the verified member profile from presence without treating anonymous visitors as accounts',()=>{
 const open=vi.fn();const indicator=createPagePresence({self:()=>({id:'me',name:'Jocelin',photo:null}),onLocate:vi.fn(),onProfile:open});
 indicator.update({status:'connected',participants:[person('camille',2,'Camille'),person(null,3,'Visitor')]});
 const profile=indicator.element.querySelector<HTMLButtonElement>('[data-page-presence-profile="camille"]');
 expect(profile).not.toBeNull();profile?.click();expect(open).toHaveBeenCalledWith('camille');
 expect(indicator.element.querySelector('[data-page-presence-profile="client:3"]')).toBeNull();indicator.destroy();
});
const person = (userId: string | null, clientId: number, name: string, self = false): CollaborationParticipant => ({userId,self,present:true,clientIds:[clientId],lastActiveAt:Date.now(),blockId:'block',user:{name,color:'#0b6e99',glyph:null,label:null}});
afterEach(()=>document.body.replaceChildren());
it('counts people, marks self and groups verified sessions without grouping unverified visitors',()=>{
 const indicator=createPagePresence({self:()=>({id:'me',name:'jocelin@example.test',photo:null}),onLocate:vi.fn()});
 indicator.update({status:'connected',participants:[person('me',1,'old',true),person('me',2,'old'),person('friend',3,'Camille'),person('friend',4,'Camille'),person(null,5,'Visitor'),person(null,6,'Visitor')]});
 expect(indicator.element.querySelector('summary')?.textContent).toContain('Vous et 3 autres personnes');
 expect(indicator.element.textContent).toContain('jocelin@example.test (vous)');
 expect(indicator.element.querySelectorAll('[data-page-presence-person]')).toHaveLength(4);
 indicator.destroy();
});
it('distinguishes a lone self from unavailable presence and updates the profile',()=>{
 const profile={id:'me',name:'jocelin@example.test',photo:null};
 const indicator=createPagePresence({self:()=>profile,onLocate:vi.fn()});
 document.body.append(indicator.element);
 expect(indicator.element.textContent).toContain('Présence…');
 indicator.update({status:'connected',participants:[person('me',1,'old',true)]});
 expect(indicator.element.querySelector('summary')?.textContent).toContain('Vous seul');
 expect(indicator.element.querySelector('[data-page-presence-avatar]')?.textContent).toBe('J');
 profile.name='Camille'; indicator.refresh();
 expect(indicator.element.textContent).toContain('Camille (vous)');
 expect(indicator.element.querySelector('[data-page-presence-avatar]')?.textContent).toBe('C');
 indicator.update({status:'offline'});
 expect(indicator.element.querySelector('summary')?.textContent).toContain('Présence indisponible');
 expect(indicator.element.querySelectorAll('[data-page-presence-person]')).toHaveLength(0);
 indicator.destroy();
});
it('locates another person without interpreting their name as HTML',()=>{
 const locate=vi.fn();const indicator=createPagePresence({self:()=>({id:'me',name:'Jocelin',photo:null}),onLocate:locate});
 indicator.update({status:'connected',participants:[person('other',2,'<img src=x>')]});
 const action=indicator.element.querySelector<HTMLButtonElement>('[data-page-presence-locate]');
 action?.click();expect(locate).toHaveBeenCalledWith('block');
 expect(indicator.element.querySelector('img')).toBeNull();
 indicator.destroy();
});
