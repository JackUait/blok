import type { PageAccessEntry, PageAccessMap } from './page-access';

/** Audience categories for roots. Teamspaces are separate backend boundaries;
 * legacy common pages without a teamspace retain the workspace category. */
export type PageSection = 'workspace' | 'shared' | 'private';

export const sectionOrder: PageSection[] = ['workspace', 'shared', 'private'];

/** Stable section keys consumed by the sidebar. */
export const sectionNames: Record<PageSection, string> = {
  workspace: 'workspace',
  shared: 'Partagé',
  private: 'Privé',
};

/**
 * La section se déduit, elle ne se stocke pas.
 *
 * Personne ne choisit une section : on choisit un partage, et la page suit. Une
 * page privée bascule d'elle-même sous « Partagé » à la seconde où quelqu'un
 * d'autre y est invité, et revient sous « Privé » quand le dernier invité en
 * part. Un champ stocké aurait à être rattrapé à chaque changement d'accès, sur
 * la page et sur toute sa descendance.
 */
export function sectionOf(access: PageAccessEntry | undefined): PageSection {
  // Sans information du serveur, une page appartient à l'espace : c'est le
  // comportement d'avant les permissions par page.
  if (!access) return 'workspace';
  // Une page dont l'ancêtre est hors d'atteinte ne peut s'afficher nulle part
  // ailleurs : quelqu'un me l'a ouverte, donc elle est partagée.
  if (access.sharedRoot === true) return 'shared';
  if (access.visibility === 'workspace') return 'workspace';
  return access.shared === true ? 'shared' : 'private';
}

export interface SectionGroup<T> { section: PageSection; pages: T[] }

/** Range les pages par section en conservant leur ordre, sans section vide. */
export function groupPagesBySection<T extends { id: string }>(pages: T[], access: PageAccessMap | undefined): SectionGroup<T>[] {
  const buckets = new Map<PageSection, T[]>();
  for (const page of pages) {
    const section = sectionOf(access?.[page.id]);
    const bucket = buckets.get(section);
    if (bucket) bucket.push(page);
    else buckets.set(section, [page]);
  }
  return sectionOrder
    .filter((section) => (buckets.get(section)?.length ?? 0) > 0)
    .map((section) => ({ section, pages: buckets.get(section) ?? [] }));
}


/** The effective teamspace comes from access metadata, never a client page label. */
export function sidebarSectionOf(access: PageAccessEntry | undefined): string {
  const section=sectionOf(access);
  if(section==='workspace' && access?.teamspaceId)return `teamspace:${access.teamspaceId}`;
  return sectionNames[section];
}
