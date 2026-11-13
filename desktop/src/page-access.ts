import type { WorkspaceRef } from './workspace-registry';

/** Ce que le serveur accorde sur une page précise. */
export type PageLevel = 'view' | 'edit' | 'full';
export interface PageAccessEntry { level: PageLevel; sharedRoot?: boolean }
export type PageAccessMap = Record<string, PageAccessEntry>;

export interface PageAccess {
  /** L'espace entier est en lecture seule : le compte, pas la page. */
  readonly readOnlyWorkspace: boolean;
  canEdit(pageId: string): boolean;
  canShare(pageId: string): boolean;
  isSharedRoot(pageId: string): boolean;
}

const rank: Record<PageLevel, number> = { view: 1, edit: 2, full: 3 };

/**
 * L'interface ne savait dire qu'une chose : cet espace est-il en lecture seule ?
 * Elle doit dire : cette page-ci l'est-elle ? Un seul point de décision, consulté
 * partout, plutôt qu'un booléen calculé une fois à l'ouverture.
 *
 * Une page dont le niveau n'est pas connu se ferme. L'inverse ouvrirait un
 * éditeur modifiable sur une page refusée côté serveur, et l'utilisateur perdrait
 * sa frappe au premier enregistrement.
 */
export function pageAccess(ref: WorkspaceRef, reported: PageAccessMap | undefined): PageAccess {
  if (ref.kind !== 'remote') {
    return { readOnlyWorkspace: false, canEdit: () => true, canShare: () => false, isSharedRoot: () => false };
  }
  const readOnlyWorkspace = ref.role === 'viewer';
  // Un serveur antérieur aux permissions par page n'annonce aucun niveau. Le
  // rôle d'espace reste alors la seule réponse disponible, et c'est exactement
  // le comportement qu'il avait avant.
  const roleLevel: Record<string, PageLevel> = { viewer: 'view', member: 'edit', admin: 'full' };
  const fallback: PageLevel = roleLevel[ref.role ?? 'member'] ?? 'edit';
  const levelOf = (pageId: string): PageLevel | null => {
    if (!reported) return pageId ? fallback : null;
    return reported[pageId]?.level ?? null;
  };
  const atLeast = (pageId: string, needed: PageLevel): boolean => {
    const level = levelOf(pageId);
    if (level === null) return false;
    // Le rôle plafonne, comme côté serveur : un lecteur ne modifie rien, quelle
    // que soit la générosité d'un partage.
    if (readOnlyWorkspace && rank[needed] > rank.view) return false;
    return rank[level] >= rank[needed];
  };
  return {
    readOnlyWorkspace,
    canEdit: (pageId) => atLeast(pageId, 'edit'),
    canShare: (pageId) => atLeast(pageId, 'full'),
    isSharedRoot: (pageId) => reported?.[pageId]?.sharedRoot === true,
  };
}
