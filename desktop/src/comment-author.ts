import { readLocalProfile } from './local-profile';
import type { WorkspaceRef } from './workspace-registry';

const key = 'blok:desktop:comment-author:v1';
const session = { id: `local:${crypto.randomUUID()}` };

/** Attribution is a real account in the cloud, a persistent device identity locally. */
export function commentAuthor(ref: WorkspaceRef): { authorId: string; authorName: string; avatarUrl?: string } {
  if (ref.kind === 'remote') return { authorId: ref.accountId, authorName: ref.userName?.trim() || ref.accountId };
  try {
    const stored = localStorage.getItem(key);
    if (stored?.startsWith('local:') && stored.length > 6) session.id = stored;
    else localStorage.setItem(key, session.id);
  } catch { /* The session identity remains usable without preferences. */ }
  const profile = readLocalProfile();
  return { authorId: session.id, authorName: profile.name || 'Utilisateur local', ...(profile.photo ? { avatarUrl: profile.photo } : {}) };
}
