import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWelcomeDocuments,
  seedWelcomeDocuments,
  hasWelcomeSeeded,
  markWelcomeSeeded,
  shouldSeedWelcome,
  welcomePageId,
  welcomeRightsPageId,
} from './welcome-seed';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('welcome seed', () => {
  it('uses a deterministic page id derived from the workspace id', () => {
    expect(welcomePageId('acme')).toBe('welcome-acme');
    expect(welcomeRightsPageId('acme')).toBe('welcome-rights-acme');
    expect(welcomePageId('acme')).toBe(welcomePageId('acme'));
  });

  it('seeds once: empty, remote, never seeded, and not a viewer', () => {
    expect(shouldSeedWelcome({ empty: true, seeded: false, viewer: false, remote: true })).toBe(true);
    expect(shouldSeedWelcome({ empty: true, seeded: true, viewer: false, remote: true })).toBe(false);
    expect(shouldSeedWelcome({ empty: false, seeded: false, viewer: false, remote: true })).toBe(false);
    expect(shouldSeedWelcome({ empty: true, seeded: false, viewer: false, remote: false })).toBe(false);
  });

  it('does not seed for a viewer', () => {
    expect(shouldSeedWelcome({ empty: true, seeded: false, viewer: true, remote: true })).toBe(false);
  });

  it('persists the seeded flag per workspace key', () => {
    expect(hasWelcomeSeeded('remote:acme')).toBe(false);
    markWelcomeSeeded('remote:acme');
    expect(hasWelcomeSeeded('remote:acme')).toBe(true);
    expect(hasWelcomeSeeded('remote:other')).toBe(false);
  });

  it('builds a welcome document that teaches Blok gestures and links the rights subpage', () => {
    const { welcome, rights, pages } = buildWelcomeDocuments('acme');
    // Notion's shape: the welcome page, a rights subpage, and a separate
    // "To Do List" page beside it rather than a database embedded in the body.
    expect(pages.map((page) => page.id)).toEqual(['welcome-acme', 'welcome-rights-acme', 'welcome-tasks-acme']);
    expect(pages[1]?.parentId).toBe('welcome-acme');
    expect(pages[2]?.parentId).toBeNull();
    expect(pages[0]?.icon).toBe('👋');
    expect(welcome.title).toContain('Bienvenue');
    const text = JSON.stringify(welcome.blocks);
    expect(text).toMatch(/toolbox|boîte à outils|\//i);
    expect(text).toMatch(/poignée|glisser/i);
    expect(text).toMatch(/Tab/i);
    expect(text).toMatch(/@|mention/i);
    expect(text).toMatch(/Partager/i);
    expect(text).toContain('welcome-rights-acme');
    expect(text).toContain('welcome-tasks-acme');
    // The checklist is the page: no headings, and a toggle closes it, like Notion's.
    expect(welcome.blocks.some((block) => block.type === 'header')).toBe(false);
    expect(welcome.blocks.some((block) => block.type === 'toggle')).toBe(true);
    expect(welcome.blocks[0]?.data.checked).toBe(true);
    expect(rights.title).toMatch(/Droits et partage/i);
  });

  it('writes status options where every database reader looks for them', () => {
    const { tasks } = buildWelcomeDocuments('acme');
    const db = tasks.blocks.find((block) => block.type === 'database');
    const schema = (db?.data as { schema?: Array<Record<string, unknown>> } | undefined)?.schema ?? [];
    const status = schema.find((property) => property.type === 'status');
    expect(status).toBeTruthy();
    // PropertyDefinition.config?.options, with SelectOption = {id,label,color?,position}.
    // A top-level `options` array of {id,name,color} is invisible to every reader
    // in src/shared/database/, so the column renders empty.
    expect(status).not.toHaveProperty('options');
    const options = (status?.config as { options?: Array<Record<string, unknown>> } | undefined)?.options;
    expect(options?.map((option) => option.id)).toEqual(['todo', 'doing', 'done']);
    for (const option of options ?? []) {
      expect(typeof option.label).toBe('string');
      expect(typeof option.position).toBe('string');
      expect(option).not.toHaveProperty('name');
    }
  });
});

describe('seedWelcomeDocuments ordering', () => {
  it('seeds every document before the welcome page is opened', async () => {
    const calls: string[] = [];
    const docs = buildWelcomeDocuments('acme');
    await seedWelcomeDocuments({
      docs,
      publishPages: (selectId) => { calls.push(`publish:${selectId ?? 'none'}`); },
      flushOrder: async () => { calls.push('flush'); },
      seedDocument: async (pageId) => { calls.push(`seed:${pageId}`); },
    });
    // Selecting the welcome page opens it, which starts collaboration on an
    // empty document. Admission before the seed leaves the editor empty for
    // good: the server keeps the checkpoint, the live doc never sees it.
    const open = calls.indexOf('publish:welcome-acme');
    const lastSeed = calls.map((c) => c.startsWith('seed:')).lastIndexOf(true);
    expect(lastSeed).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(lastSeed);
    // The page rows must exist before seeding, so the index flush comes first.
    expect(calls.indexOf('flush')).toBeLessThan(lastSeed);
    expect(calls.filter((c) => c.startsWith('seed:'))).toHaveLength(docs.documents.length);
  });

  it('reports failure without opening the welcome page', async () => {
    const calls: string[] = [];
    const docs = buildWelcomeDocuments('acme');
    const ok = await seedWelcomeDocuments({
      docs,
      publishPages: (selectId) => { calls.push(`publish:${selectId ?? 'none'}`); },
      flushOrder: async () => { calls.push('flush'); },
      seedDocument: async () => { throw new Error('seed refused'); },
    });
    expect(ok).toBe(false);
    expect(calls).not.toContain('publish:welcome-acme');
  });
});
