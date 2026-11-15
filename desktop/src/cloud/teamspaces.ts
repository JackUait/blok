import { TEAMSPACE_ROLES } from '../access-vocabulary';
import type { CloudClient } from './client';
export type TeamspaceRole = 'owner' | 'member';
export interface Teamspace {
  id: string; workspaceId: string; name: string; icon: string | null; description: string;
  mode: 'closed'; archived: boolean; myRole: TeamspaceRole | null; canManage: boolean;
}
export interface TeamspaceMember {userId: string; email: string; role: TeamspaceRole}
export interface TeamspaceIdentity {name: string; icon: string | null; description: string}
export function teamspaceClient(client: Pick<CloudClient,'request'>, workspace: string) {
  const base=`/api/workspaces/${encodeURIComponent(workspace)}`;
  const path=(id:string):string=>`${base}/teamspaces/${encodeURIComponent(id)}`;
  return {
    list: (signal?:AbortSignal) => client.request<{teamspaces:Teamspace[]}>(`${base}/teamspaces?archived=true`,{signal}),
    get: (id:string,signal?:AbortSignal) => client.request<Teamspace>(path(id),{signal}),
    create: (value:TeamspaceIdentity) => client.request<Teamspace>(`${base}/teamspaces`,{method:'POST',body:JSON.stringify({...value,mode:'closed'})}),
    update: (id:string,value:TeamspaceIdentity) => client.request<Teamspace>(path(id),{method:'PATCH',body:JSON.stringify(value)}),
    members: (id:string,signal?:AbortSignal) => client.request<{members:TeamspaceMember[]}>(`${path(id)}/members`,{signal}),
    workspaceMembers: (signal?:AbortSignal) => client.request<{members:{id:string;email:string;role:'admin'|'member'|'viewer'}[]}>(`${base}/members`,{signal}),
    setMember: (id:string,userId:string,role:TeamspaceRole) => client.request(`${path(id)}/members/${encodeURIComponent(userId)}`,{method:'PUT',body:JSON.stringify({role})}),
    removeMember: (id:string,userId:string) => client.request(`${path(id)}/members/${encodeURIComponent(userId)}`,{method:'DELETE'}),
    archive: (id:string,archived:boolean) => client.request<Teamspace>(`${path(id)}/${archived ? 'archive' : 'restore'}`,{method:'POST'}),
    createPage: (id:string,title:string) => client.request<{id:string;title:string;teamspaceId:string;revision:number}>(`${path(id)}/pages`,{method:'POST',body:JSON.stringify({title})}),
  };
}
export type TeamspaceClient = ReturnType<typeof teamspaceClient>;
export const teamspaceRoleLabel = (role:TeamspaceRole|null):string => {if(role==='owner')return TEAMSPACE_ROLES.owner;return role==='member' ? TEAMSPACE_ROLES.member : TEAMSPACE_ROLES.none;};
