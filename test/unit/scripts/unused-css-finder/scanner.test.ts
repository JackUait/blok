/**
 * Tests for Source Scanner
 * Tests the scanning of source files for CSS class and attribute usage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanSourceDirectory, findCSSUsage, scanFile } from '../../../../scripts/unused-css-finder/scanner';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

describe('Source Scanner', () => {
  const testDir = join(process.cwd(), 'test-temp-scanner');

  beforeEach(async () => {
    // Create test directory
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('findCSSUsage', () => {
    it('should find class names in className attributes', () => {
      const code = `<div className="blok-button">Click me</div>`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-button');
    });

    it('should find multiple class names in className', () => {
      const code = `<div className="blok-button blok-button--active">Click</div>`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-button');
      expect(result.classes).toContain('blok-button--active');
    });

    it('should find class names in classList.add', () => {
      const code = `element.classList.add('blok-block');`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-block');
    });

    it('should find class names in classList.toggle', () => {
      const code = `element.classList.toggle('blok-settings-button--active');`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-settings-button--active');
    });

    it('should find class names in classList.remove', () => {
      const code = `element.classList.remove('blok-selected');`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-selected');
    });

    it('should find class names in classList.contains', () => {
      const code = `if (element.classList.contains('blok-item')) { ... }`;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('blok-item');
    });

    it('should find data attributes in dataset', () => {
      const code = `element.dataset.blokSelected = 'true';`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-selected');
    });

    it('should find data attributes in querySelector', () => {
      const code = `document.querySelector('[data-blok-item-name="delete"]')`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-item-name');
    });

    it('should find data attributes in getAttribute', () => {
      const code = `element.getAttribute('data-blok-dragging-multi');`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-dragging-multi');
    });

    it('should find data attributes in setAttribute', () => {
      const code = `element.setAttribute('data-blok-selected', 'true');`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-selected');
    });

    it('should find data attributes in hasAttribute', () => {
      const code = `element.hasAttribute('data-blok-placeholder');`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-placeholder');
    });

    it('should find data attributes in template literals', () => {
      const code = `element.dataset[camelCase('blok-selected')] = 'true';`;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-selected');
    });

    it('should handle multiple data-* patterns in one file', () => {
      const code = `
        element.dataset.blokSelected = 'true';
        element.setAttribute('data-blok-dragging-multi', 'true');
        document.querySelector('[data-blok-item-name="delete"]');
      `;
      const result = findCSSUsage(code);
      expect(result.attributes).toContain('data-blok-selected');
      expect(result.attributes).toContain('data-blok-dragging-multi');
      expect(result.attributes).toContain('data-blok-item-name');
    });

    it('should handle mixed quotes', () => {
      const code = `
        element.classList.add("double-quotes");
        element.classList.add('single-quotes');
        element.classList.add(\`backticks\`);
      `;
      const result = findCSSUsage(code);
      expect(result.classes).toContain('double-quotes');
      expect(result.classes).toContain('single-quotes');
      expect(result.classes).toContain('backticks');
    });

    it('should ignore CSS in comments', () => {
      const code = `
        // element.classList.add('commented-class');
        /* element.setAttribute('data-commented', 'true'); */
        element.classList.add('real-class');
      `;
      const result = findCSSUsage(code);
      expect(result.classes).not.toContain('commented-class');
      expect(result.classes).toContain('real-class');
      expect(result.attributes).not.toContain('data-commented');
    });

    it('should ignore strings in comments', () => {
      const code = `
        // const x = "blok-fake";
        element.classList.add('blok-real');
      `;
      const result = findCSSUsage(code);
      expect(result.classes).not.toContain('blok-fake');
      expect(result.classes).toContain('blok-real');
    });

    it('should handle empty code', () => {
      const result = findCSSUsage('');
      expect(result.classes).toEqual([]);
      expect(result.attributes).toEqual([]);
    });
  });

  describe('scanFile', () => {
    it('should scan a TypeScript file and return CSS usage', async () => {
      const filePath = join(testDir, 'test.ts');
      await writeFile(filePath, `
        element.classList.add('blok-button');
        element.dataset.blokSelected = 'true';
      `, 'utf-8');

      const result = await scanFile(filePath);
      expect(result.classes).toContain('blok-button');
      expect(result.attributes).toContain('data-blok-selected');
      expect(result.filePath).toBe(filePath);
    });

    it('should return empty result for non-text files', async () => {
      const filePath = join(testDir, 'image.png');
      await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

      const result = await scanFile(filePath);
      expect(result.classes).toEqual([]);
      expect(result.attributes).toEqual([]);
    });

    it('should handle non-existent files gracefully', async () => {
      const filePath = join(testDir, 'does-not-exist.ts');

      const result = await scanFile(filePath);
      expect(result.classes).toEqual([]);
      expect(result.attributes).toEqual([]);
    });
  });

  describe('scanSourceDirectory', () => {
    it('should scan all TypeScript files in directory', async () => {
      await writeFile(join(testDir, 'file1.ts'), `element.classList.add('class-one');`);
      await writeFile(join(testDir, 'file2.ts'), `element.classList.add('class-two');`);
      await writeFile(join(testDir, 'file3.ts'), `element.dataset.blokTest = 'true';`);
      await writeFile(join(testDir, 'index.ts'), `export {};`);

      const result = await scanSourceDirectory(testDir);

      expect(result.filesScanned).toBeGreaterThanOrEqual(3);
      expect(result.allClasses).toContain('class-one');
      expect(result.allClasses).toContain('class-two');
      expect(result.allAttributes).toContain('data-blok-test');
    });

    it('should skip node_modules', async () => {
      const nodeModulesDir = join(testDir, 'node_modules', 'some-package');
      await mkdir(nodeModulesDir, { recursive: true });
      await writeFile(join(nodeModulesDir, 'index.ts'), `element.classList.add('external-class');`);

      await writeFile(join(testDir, 'local.ts'), `element.classList.add('local-class');`);

      const result = await scanSourceDirectory(testDir);

      expect(result.allClasses).toContain('local-class');
      expect(result.allClasses).not.toContain('external-class');
    });

    it('should handle directories with no matching files', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir, { recursive: true });

      const result = await scanSourceDirectory(emptyDir);

      expect(result.filesScanned).toBe(0);
      expect(result.allClasses).toEqual([]);
      expect(result.allAttributes).toEqual([]);
    });
  });
});
