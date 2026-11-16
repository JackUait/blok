import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readLocalProfile, saveLocalProfile, readProfilePhoto, mountLocalProfile } from './local-profile';
import { commentAuthor } from './comment-author';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({invoke:vi.fn(async () => undefined)}));
const photo = 'data:image/png;base64,aGVsbG8=';
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); document.body.replaceChildren(); });
it('keeps the profile separate from workspace names and preserves the author identity', () => {
  localStorage.setItem('blok:desktop:profile-name', 'Mes notes');
  const ref = { kind: 'local' as const, id: 'default', name: 'Mes notes' };
  const id = commentAuthor(ref).authorId;
  saveLocalProfile({ name: ' Joce ', photo });
  expect(commentAuthor(ref)).toEqual({ authorId: id, authorName: 'Joce', avatarUrl: photo });
  expect(readLocalProfile()).toEqual({ name: 'Joce', photo });
  expect(localStorage.getItem('blok:desktop:profile-name')).toBe('Mes notes');
  saveLocalProfile({ name: 'Joce', photo: null });
  expect(commentAuthor(ref).avatarUrl).toBeUndefined();
});
it('does not apply the local profile to a connected account', () => {
  saveLocalProfile({ name: 'Joce', photo });
  expect(commentAuthor({ kind:'remote', id:'r', name:'Team', server:'https://example.test', accountId:'u', userName:'Camille', workspaceId:'w' })).toEqual({ authorId:'u', authorName:'Camille' });
});
it('rejects external or executable photo URLs and reports storage errors without announcing success', () => {
  expect(() => saveLocalProfile({ name:'Joce', photo:'https://example.test/tracking.png' })).toThrow();
  const listener = vi.fn(); window.addEventListener('blok:profile-changed', listener);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(() => saveLocalProfile({ name:'Joce', photo:null })).toThrow();
  expect(listener).not.toHaveBeenCalled();
  window.removeEventListener('blok:profile-changed', listener);
});
it('rejects unsupported or oversized uploads before decoding', async () => {
  await expect(readProfilePhoto(new File(['<svg/>'], 'bad.svg', {type:'image/svg+xml'}))).rejects.toThrow();
  const file = new File(['x'], 'big.png', {type:'image/png'});
  Object.defineProperty(file, 'size', {value:11 * 1024 * 1024});
  await expect(readProfilePhoto(file)).rejects.toThrow();
});
it('offers Faces and changes/removes the displayed profile without touching workspace settings', () => {
  saveLocalProfile({name:'Joce',photo});
  const host=document.createElement('div');document.body.append(host);
  const mounted=mountLocalProfile(host);
  expect(host.querySelector('img')?.src).toBe(photo);
  expect(host.querySelector<HTMLAnchorElement>('a')?.href).toContain('https://faces.notion.com/');
  const name=host.querySelector<HTMLInputElement>('input[type=text]');
  if (!name) throw new Error('Missing profile name');
  name.value='Camille';name.dispatchEvent(new Event('change'));
  expect(readLocalProfile().name).toBe('Camille');
  host.querySelector<HTMLButtonElement>('[data-profile-remove]')?.click();
  expect(readLocalProfile().photo).toBeNull();
  expect(host.querySelector('img')).toBeNull();
  mounted.destroy();
});

it('opens Faces in the native browser without navigating the editor', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {value:{}, configurable:true});
  const host=document.createElement('div');const mounted=mountLocalProfile(host);
  const click=new MouseEvent('click',{bubbles:true,cancelable:true});
  host.querySelector('a')?.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(invoke).toHaveBeenCalledWith('open_notion_faces');
  mounted.destroy();
});
