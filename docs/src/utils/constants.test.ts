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

    it('should have a Try it out link', () => {
      const demoLink = NAV_LINKS.find((link) => link.label === 'Try it out');
      expect(demoLink).toBeDefined();
      expect(demoLink?.href).toBe('/demo');
    });

    it('should have a Migration link', () => {
      const migrationLink = NAV_LINKS.find((link) => link.label === 'Migration');
      expect(migrationLink).toBeDefined();
      expect(migrationLink?.href).toBe('/migration');
    });

    it('should have a GitHub link marked as external', () => {
      const githubLink = NAV_LINKS.find((link) => link.label === 'GitHub');
      expect(githubLink).toBeDefined();
      expect(githubLink?.external).toBe(true);
      expect(githubLink?.href).toContain('github.com');
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
  });
});
