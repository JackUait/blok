import type { PageAccessEntry, PageAccessMap } from './page-access';

/** Les sections de la barre latérale, dans l'ordre où elles s'affichent. */
export type PageSection = 'workspace' | 'shared' | 'sharedWithMe' | 'private';

export const sectionOrder: PageSection[] = ['workspace', 'shared', 'sharedWithMe', 'private'];

export const sectionNames: Record<PageSection, string> = {
  workspace: 'Espace',
  shared: 'Partagé',
  sharedWithMe: 'Partagé avec moi',
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
  // ailleurs : elle vient de quelqu'un d'autre, et elle le dit.
  if (access.sharedRoot === true) return 'sharedWithMe';
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
