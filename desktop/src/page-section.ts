import type { PageAccessEntry, PageAccessMap } from './page-access';

/**
 * Les sections d'accès de la barre latérale, dans l'ordre où elles s'affichent.
 *
 * Trois, comme Notion : l'espace lui-même, ce qui est partagé avec des personnes
 * précises, et ce qui n'appartient qu'à soi. « Partagé avec moi » n'est pas une
 * quatrième section : une page que quelqu'un m'a ouverte et une page que j'ai
 * ouverte à quelqu'un sont toutes deux « Partagé ».
 */
export type PageSection = 'workspace' | 'shared' | 'private';

export const sectionOrder: PageSection[] = ['workspace', 'shared', 'private'];

/**
 * La section de l'espace porte le nom de l'espace — c'est ce que Notion affiche
 * pour un teamspace, et « Espace » tout court ne désigne rien.
 */
export function sectionNames(workspaceName: string): Record<PageSection, string> {
  return { workspace: workspaceName, shared: 'Partagé', private: 'Privé' };
}

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
