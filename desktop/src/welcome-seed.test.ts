import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWelcomeDocuments,
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
    expect(pages.map((page) => page.id)).toEqual(['welcome-acme', 'welcome-rights-acme']);
    expect(pages[1]?.parentId).toBe('welcome-acme');
    expect(welcome.title).toContain('Bienvenue');
    const text = JSON.stringify(welcome.blocks);
    expect(text).toMatch(/toolbox|boîte à outils|\//i);
    expect(text).toMatch(/poignée|glisser/i);
    expect(text).toMatch(/Tab/i);
    expect(text).toMatch(/@|mention/i);
    expect(text).toMatch(/Partager/i);
    expect(text).toContain('welcome-rights-acme');
    expect(text).toMatch(/database/);
    expect(rights.title).toMatch(/Droits et partage/i);
  });

  it('writes status options where every database reader looks for them', () => {
    const { welcome } = buildWelcomeDocuments('acme');
    const db = welcome.blocks.find((block) => block.type === 'database');
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
