import { describe, it, expect } from 'vitest';
import { NAV_LINKS } from './constants';

describe('constants', () => {
  describe('NAV_LINKS', () => {
    it('should be an array of navigation links', () => {
      expect(Array.isArray(NAV_LINKS)).toBe(true);
    });

    it('should have at least 4 links', () => {
      expect(NAV_LINKS.length).toBeGreaterThanOrEqual(4);
    });

    it('should have a Docs link', () => {
      const docsLink = NAV_LINKS.find((link) => link.label === 'Docs');
      expect(docsLink).toBeDefined();
      expect(docsLink?.href).toBe('/docs');
    });

    it('should have a Demo link', () => {
      const demoLink = NAV_LINKS.find((link) => link.label === 'Demo');
      expect(demoLink).toBeDefined();
      expect(demoLink?.href).toBe('/demo');
    });

    it('should have a Migration link', () => {
      const migrationLink = NAV_LINKS.find((link) => link.label === 'Migration');
      expect(migrationLink).toBeDefined();
      expect(migrationLink?.href).toBe('/migration');
    });

    it('should have a Presets link with an i18nKey, so the page is reachable from the nav', () => {
      const presetsLink = NAV_LINKS.find((link) => link.label === 'Presets');
      expect(presetsLink).toBeDefined();
      expect(presetsLink?.href).toBe('/presets');
      expect(presetsLink?.i18nKey).toBe('nav.presets');
    });

    it('should have a Server link with an i18nKey, so the page is reachable from the nav', () => {
      const serverLink = NAV_LINKS.find((link) => link.label === 'Server');
      expect(serverLink).toBeDefined();
      expect(serverLink?.href).toBe('/server');
      expect(serverLink?.i18nKey).toBe('nav.server');
    });

    it('should not include a GitHub link (lives as a nav icon instead)', () => {
      const githubLink = NAV_LINKS.find((link) => link.label === 'GitHub');
      expect(githubLink).toBeUndefined();
    });

    it('should have all required properties on each link', () => {
      NAV_LINKS.forEach((link) => {
        expect(link).toHaveProperty('href');
        expect(link).toHaveProperty('label');
        expect(typeof link.href).toBe('string');
        expect(typeof link.label).toBe('string');
      });
    });

    it('should not have empty labels', () => {
      NAV_LINKS.forEach((link) => {
        expect(link.label.trim().length).toBeGreaterThan(0);
      });
    });

    it('should not have empty hrefs', () => {
      NAV_LINKS.forEach((link) => {
        expect(link.href.trim().length).toBeGreaterThan(0);
      });
    });

    it('should not include integrations or recipes links', () => {
      const hrefs = NAV_LINKS.map((link) => link.href);
      expect(hrefs).not.toContain('/integrations');
      expect(hrefs).not.toContain('/recipes');
    });
  });
});
