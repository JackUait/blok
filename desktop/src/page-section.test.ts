import { describe, expect, it } from 'vitest';
import { sectionOf, groupPagesBySection, sectionNames, type PageSection } from './page-section';
import type { PageAccessEntry } from './page-access';

const entry = (over: Partial<PageAccessEntry>): PageAccessEntry => ({ level: 'edit', visibility: 'private', shared: false, ...over });

describe('sidebar sections', () => {
  // La section n'est jamais stockée : elle se déduit de l'état de partage, et
  // une page bascule d'elle-même dès qu'on invite quelqu'un.
  it('derives the section from sharing state, never from a stored field', () => {
    const cases: Array<[PageAccessEntry, PageSection]> = [
      [entry({ visibility: 'workspace' }), 'workspace'],
      [entry({ visibility: 'private', shared: false }), 'private'],
      [entry({ visibility: 'private', shared: true }), 'shared'],
      // « Partagé avec moi » n'est pas une section à part : une page qu'on m'a
      // ouverte et une page que j'ai ouverte sont toutes deux « Partagé ».
      [entry({ visibility: 'private', shared: true, sharedRoot: true }), 'shared'],
      [entry({ visibility: 'workspace', sharedRoot: true }), 'shared'],
    ];
    for (const [access, expected] of cases) expect(sectionOf(access)).toBe(expected);
  });

  // Inviter quelqu'un sur une page privée la fait passer sous « Partagé » sans
  // que personne n'ait choisi de section.
  it('moves a page out of Private the moment someone else is invited', () => {
    const before = entry({ visibility: 'private', shared: false });
    expect(sectionOf(before)).toBe('private');
    expect(sectionOf({ ...before, shared: true })).toBe('shared');
  });

  it('falls back to the workspace section when the server says nothing', () => {
    expect(sectionOf(undefined)).toBe('workspace');
  });

  it('groups pages while keeping their order, and drops empty sections', () => {
    const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const groups = groupPagesBySection(pages, {
      a: entry({ visibility: 'workspace' }),
      b: entry({ visibility: 'private', shared: true }),
      c: entry({ visibility: 'workspace' }),
      d: entry({ visibility: 'private' }),
    });
    expect(groups.map((group) => group.section)).toEqual(['workspace', 'shared', 'private']);
    expect(groups[0].pages.map((page) => page.id)).toEqual(['a', 'c']);
    expect(groups.some((group) => group.pages.length === 0)).toBe(false);
  });

  // « Espace » ne désigne rien ; Notion affiche le nom du teamspace.
  it('names the workspace section after the workspace itself', () => {
    expect(sectionNames('Tousambassadeurs').workspace).toBe('Tousambassadeurs');
    expect(sectionNames('Tousambassadeurs').private).toBe('Privé');
  });

  it('keeps every page in exactly one section', () => {
    const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const groups = groupPagesBySection(pages, { a: entry({ visibility: 'workspace' }) });
    expect(groups.flatMap((group) => group.pages.map((page) => page.id)).sort()).toEqual(['a', 'b', 'c']);
  });
});
