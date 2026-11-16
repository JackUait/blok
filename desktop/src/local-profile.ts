import './local-profile.css';
import { invoke } from '@tauri-apps/api/core';
import { styleTextField } from './ui/controls';

export interface LocalProfile { name: string; photo: string | null }
const KEY = 'blok:desktop:local-profile:v1';
export const PROFILE_CHANGED = 'blok:profile-changed';
export const FACES_URL = 'https://faces.notion.com/?face=s4e27y10b8n15m4h132a0';
const validPhoto = (value: unknown): value is string => typeof value === 'string' && value.length <= 400_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);

export function readLocalProfile(): LocalProfile {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalProfile>;
    return { name: typeof value?.name === 'string' ? value.name.trim().slice(0, 80) : '', photo: validPhoto(value?.photo) ? value.photo : null };
  } catch { return { name: '', photo: null }; }
}
export function watchLocalProfile(listener: () => void): () => void {
  const storage = (event: StorageEvent): void => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener(PROFILE_CHANGED, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(PROFILE_CHANGED, listener); window.removeEventListener('storage', storage); };
}
export function saveLocalProfile(profile: LocalProfile): void {
  if (profile.photo !== null && !validPhoto(profile.photo)) throw new Error('Image de profil invalide.');
  const value = { name: profile.name.trim().slice(0, 80), photo: profile.photo };
  try { localStorage.setItem(KEY, JSON.stringify(value)); }
  catch { throw new Error('Impossible d’enregistrer le profil sur cet appareil. Libérez de l’espace puis réessayez.'); }
  window.dispatchEvent(new Event(PROFILE_CHANGED));
}

/** Decode and shrink locally: the profile never stores the original multi-megabyte file. */
export async function readProfilePhoto(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choisissez une image PNG, JPEG ou WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('L’image doit faire moins de 10 Mo.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Impossible de lire cette image.')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image vide.');
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Impossible de préparer cette image.');
    // Fit the entire portrait so Faces drawings are not cropped; retain transparency.
    const scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
    const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    const photo = canvas.toDataURL('image/png');
    if (!validPhoto(photo)) throw new Error('Impossible de préparer cette image.');
    return photo;
  } finally { URL.revokeObjectURL(url); }
}

export function mountLocalProfile(host: HTMLElement, onSaved: () => void = () => undefined): { destroy(): void } {
  let disposed = false; let uploadVersion = 0;
  const section = document.createElement('section'); section.setAttribute('data-local-profile', '');
  const row = document.createElement('div'); row.setAttribute('data-profile-row', '');
  const photo = document.createElement('button'); photo.type = 'button'; photo.setAttribute('data-profile-photo', '');
  const fields = document.createElement('div');
  const label = document.createElement('label'); label.textContent = 'Nom affiché';
  const name = document.createElement('input'); name.type = 'text'; name.maxLength = 80; name.placeholder = 'Votre nom ou pseudo'; name.value = readLocalProfile().name;
  styleTextField(name);
  name.setAttribute('data-desktop-settings-name', ''); label.append(name);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Supprimer la photo'; remove.setAttribute('data-profile-remove', '');
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const faces = document.createElement('a'); faces.href = FACES_URL; faces.target = '_blank'; faces.rel = 'noopener noreferrer'; faces.textContent = 'Créer un avatar avec Notion Faces ↗';
  faces.addEventListener('click', event => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    event.preventDefault();
    void invoke('open_notion_faces').catch(() => { if (!disposed) status.textContent = 'Impossible d’ouvrir le navigateur. Rendez-vous sur faces.notion.com.'; });
  });
  const help = document.createElement('p'); help.textContent = 'Téléchargez votre portrait dans Notion Faces, puis cliquez sur la photo pour l’importer. PNG, JPEG ou WebP, 10 Mo maximum.';
  const draw = (): void => {
    const profile = readLocalProfile(); photo.replaceChildren();
    photo.setAttribute('aria-label', profile.photo ? 'Remplacer la photo' : 'Ajouter une photo');
    if (profile.photo) { const img = document.createElement('img'); img.src = profile.photo; img.alt = ''; photo.append(img); }
    else photo.textContent = Array.from(profile.name || 'Vous')[0]?.toUpperCase() ?? 'V';
    remove.hidden = !profile.photo;
  };
  const save = (value: LocalProfile): void => {
    try { saveLocalProfile(value); status.textContent = 'Profil enregistré sur cet appareil.'; draw(); onSaved(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'Enregistrement impossible.'; }
  };
  name.addEventListener('change', () => save({ ...readLocalProfile(), name: name.value }));
  photo.addEventListener('click', () => file.click());
  remove.addEventListener('click', () => { ++uploadVersion; save({ ...readLocalProfile(), photo: null }); });
  file.addEventListener('change', () => {
    const selected = file.files?.[0]; file.value = ''; if (!selected) return;
    const version = ++uploadVersion; status.textContent = 'Préparation de la photo…';
    void readProfilePhoto(selected).then(image => {
      if (!disposed && version === uploadVersion) save({ ...readLocalProfile(), photo: image });
    }).catch(error => { if (!disposed && version === uploadVersion) status.textContent = error instanceof Error ? error.message : 'Import impossible.'; });
  });
  fields.append(label, remove); row.append(photo, fields); section.append(row, file, faces, help, status); host.append(section); draw();
  return { destroy() { disposed = true; ++uploadVersion; section.remove(); } };
}
