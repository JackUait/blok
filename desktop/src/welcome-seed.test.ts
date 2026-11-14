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
});
