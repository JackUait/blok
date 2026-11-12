import {CloudClient} from './cloud/client';
import {nativeSessionAdapter} from './native-session';
import {readFile, writeFile} from './storage';
import type {WorkspaceRef} from './workspace-registry';

export interface CustomEmoji {id: string; name: string; url: string; createdBy?: string; createdAt?: string}
export function emojiClient(ref: WorkspaceRef): CloudClient | null {
  return ref.kind === 'remote' ? new CloudClient({origin:ref.server, sessionAdapter:'__TAURI_INTERNALS__' in window ? nativeSessionAdapter(ref.server) : undefined}) : null;
}
export function customEmojiStore(ref: WorkspaceRef, client = emojiClient(ref)) {
  const base = ref.kind === 'remote' ? `/api/workspaces/${encodeURIComponent(ref.workspaceId)}/emojis` : '';
  async function list(): Promise<CustomEmoji[]> {
    if (client && ref.kind === 'remote') return (await client.request<{emojis:CustomEmoji[]}>(base)).emojis.map(item => ({...item,url:new URL(item.url,ref.server).href}));
    const raw = await readFile('custom-emojis.json',ref);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('La liste des émojis est invalide.');
    return parsed.filter((item): item is CustomEmoji => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string');
  }
  return {
    list,
    async create(name: string, dataUrl: string): Promise<void> {
      name=name.toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Commencez par une lettre ou un chiffre, puis utilisez jusqu’à 64 lettres, chiffres, tirets ou caractères de soulignement.');
      if (client) {await client.request(base,{method:'POST',body:JSON.stringify({name,dataUrl})});return;}
      const items = await list();
      if (items.some(item=>item.name.toLowerCase()===name.toLowerCase())) throw new Error('Ce nom est déjà utilisé.');
      await writeFile('custom-emojis.json',JSON.stringify([...items,{id:crypto.randomUUID(),name,url:dataUrl,createdAt:new Date().toISOString()}]),ref);
    },
    async remove(id: string): Promise<void> {
      if (client) {await client.request(`${base}/${encodeURIComponent(id)}`,{method:'DELETE'});return;}
      await writeFile('custom-emojis.json',JSON.stringify((await list()).filter(item=>item.id!==id)),ref);
    },
  };
}

export async function readEmojiImage(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) throw new Error('Choisissez une image PNG, JPEG, GIF ou WebP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('L’image doit faire moins de 2 Mo.');
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Impossible de lire l’image.'));reader.readAsDataURL(file);
  });
}
