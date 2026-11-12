import type { DesktopPage, WorkspaceIndex } from './storage';
export class WorkspaceConflictError extends Error {
  constructor() { super('Des modifications concurrentes touchent la même page. Rechargez l’espace pour les comparer avant de continuer.'); this.name = 'WorkspaceConflictError'; }
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  const left = a as unknown as Record<string, unknown>, right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined).sort();
  const other = Object.keys(right).filter((key) => right[key] !== undefined).sort();
  return keys.length === other.length && keys.every((key, i) => key === other[i] && equal(left[key], right[key]));
};
type Entry = {page: DesktopPage; place: 'pages' | 'trash'};
function entries(index: WorkspaceIndex): Map<string, Entry> {
  const clean = (page: DesktopPage): DesktopPage => {
    const value = {...page} as DesktopPage & {position?: unknown}; delete value.position; return value;
  };
  return new Map([...index.pages.map((page): [string,Entry] => [page.id,{page:clean(page),place:'pages'}]), ...(index.trash ?? []).map((page): [string,Entry] => [page.id,{page:clean(page),place:'trash'}])]);
}
function mergeOrder(base: DesktopPage[], local: DesktopPage[], remote: DesktopPage[], values: DesktopPage[]): DesktopPage[] {
  const byId = new Map(values.map((page) => [page.id,page]));
  const ids = (pages: DesktopPage[]) => pages.map((page)=>page.id).filter((id)=>byId.has(id));
  const old = ids(base), mine = ids(local), theirs = ids(remote);
  const oldAt = new Map(old.map((id,i)=>[id,i])), mineAt = new Map(mine.map((id,i)=>[id,i]));
  const reordered = !equal(old.filter((id)=>mineAt.has(id)),mine.filter((id)=>oldAt.has(id)));
  const next = new Map(values.map((page)=>[page.id,new Set<string>()]));
  const edge = (a: string,b: string): void => { if(a !== b) next.get(a)!.add(b); };
  for(let i=1;i<theirs.length;i++) {
    const a=theirs[i-1]!, b=theirs[i]!;
    // A server edge unchanged since base yields to a deliberate local reorder.
    if(reordered && oldAt.has(a) && oldAt.has(b) && mineAt.has(a) && mineAt.has(b) && oldAt.get(a)! < oldAt.get(b)! && mineAt.get(a)! > mineAt.get(b)!) continue;
    edge(a,b);
  }
  for(let i=1;i<mine.length;i++) {
    const a=mine[i-1]!, b=mine[i]!;
    if(reordered || !oldAt.has(a) || !oldAt.has(b)) edge(a,b);
  }
  const priority=[...new Set([...theirs,...mine,...byId.keys()])];
  const incoming=new Map(values.map((page)=>[page.id,0]));
  for(const targets of next.values()) for(const id of targets) incoming.set(id,incoming.get(id)!+1);
  const ordered: DesktopPage[]=[];
  while(ordered.length < values.length) {
    const id=priority.find((candidate)=>incoming.get(candidate)===0);
    if(!id) throw new WorkspaceConflictError();
    incoming.set(id,-1); ordered.push(byId.get(id)!);
    for(const target of next.get(id)!) incoming.set(target,incoming.get(target)!-1);
  }
  return ordered;
}
/** Apply only local changes since base, preserving unrelated current server work. */
export function mergeWorkspaceIndex(base: WorkspaceIndex, local: WorkspaceIndex, remote: WorkspaceIndex): WorkspaceIndex {
  const before = entries(base), ours = entries(local), theirs = entries(remote);
  const result = new Map(theirs);
  for (const id of new Set([...before.keys(), ...ours.keys()])) {
    const old = before.get(id), mine = ours.get(id), other = theirs.get(id);
    if (equal(old,mine)) continue;
    if (equal(old,other) || equal(mine,other)) { if (mine) result.set(id,mine); else result.delete(id); continue; }
    if (!old || !mine || !other) throw new WorkspaceConflictError();
    if (mine.place !== old.place && !equal(old.page, other.page) || other.place !== old.place && !equal(old.page,mine.page)) throw new WorkspaceConflictError();
    if (mine.place !== old.place && other.place !== old.place && mine.place !== other.place) throw new WorkspaceConflictError();
    const page = {...other.page} as unknown as Record<string, unknown>;
    for (const field of new Set([...Object.keys(old.page),...Object.keys(mine.page)])) {
      const original = (old.page as unknown as Record<string,unknown>)[field], next = (mine.page as unknown as Record<string,unknown>)[field], current = (other.page as unknown as Record<string,unknown>)[field];
      if (equal(original,next)) continue;
      if (!equal(original,current) && !equal(next,current)) throw new WorkspaceConflictError();
      if (next === undefined) delete page[field]; else page[field] = next;
    }
    result.set(id,{page:page as unknown as DesktopPage,place:mine.place === old.place ? other.place : mine.place});
  }
  const values = [...result.values()];
  const pages = mergeOrder(base.pages,local.pages,remote.pages,values.filter((entry)=>entry.place === 'pages').map((entry)=>entry.page));
  const trash = mergeOrder(base.trash ?? [],local.trash ?? [],remote.trash ?? [],values.filter((entry)=>entry.place === 'trash').map((entry)=>entry.page));
  const byId = new Map(pages.map((page) => [page.id, page]));
  for (const page of pages) {
    const visited = new Set<string>([page.id]);
    let parentId = page.parentId;
    while (parentId !== null) {
      if (visited.has(parentId) || !byId.has(parentId)) throw new WorkspaceConflictError();
      visited.add(parentId); parentId = byId.get(parentId)!.parentId;
    }
  }
  return {pages,trash,activeId: pages.some((page)=>page.id === local.activeId) ? local.activeId : pages[0]?.id ?? ''};
}
