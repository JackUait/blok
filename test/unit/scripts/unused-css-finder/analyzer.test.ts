/**
 * Tests for Unused CSS Analyzer
 * Tests the comparison of CSS definitions with actual usage
 */

import { describe, it, expect } from 'vitest';
import { analyzeUnusedCSS } from '../../../../scripts/unused-css-finder/analyzer';
import type { ParsedCSS } from '../../../../scripts/unused-css-finder/css-parser';
import type { ScanResult } from '../../../../scripts/unused-css-finder/scanner';

describe('Unused CSS Analyzer', () => {
  describe('analyzeUnusedCSS', () => {
    it('should identify unused classes', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'styles.css', classes: ['used-class', 'unused-class'], attributes: [], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: ['used-class'],
        allAttributes: [],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedClasses).toEqual(['unused-class']);
      expect(result.usedClasses).toEqual(['used-class']);
    });

    it('should identify unused attributes', () => {
      const cssFiles: ParsedCSS[] = [
        {
          filePath: 'styles.css',
          classes: [],
          attributes: ['data-used', 'data-unused'],
          elements: [],
        },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: [],
        allAttributes: ['data-used'],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedAttributes).toEqual(['data-unused']);
      expect(result.usedAttributes).toEqual(['data-used']);
    });

    it('should handle empty CSS', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'styles.css', classes: [], attributes: [], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: [],
        allAttributes: [],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedClasses).toEqual([]);
      expect(result.unusedAttributes).toEqual([]);
      expect(result.usedClasses).toEqual([]);
      expect(result.usedAttributes).toEqual([]);
    });

    it('should handle empty source scan', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'styles.css', classes: ['class1', 'class2'], attributes: ['data-attr1'], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 0,
        allClasses: [],
        allAttributes: [],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedClasses).toEqual(['class1', 'class2']);
      expect(result.unusedAttributes).toEqual(['data-attr1']);
      expect(result.usedClasses).toEqual([]);
      expect(result.usedAttributes).toEqual([]);
    });

    it('should aggregate results from multiple CSS files', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'file1.css', classes: ['class1', 'class2'], attributes: ['data-attr1'], elements: [] },
        { filePath: 'file2.css', classes: ['class2', 'class3'], attributes: ['data-attr2'], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: ['class2'],
        allAttributes: ['data-attr1'],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedClasses).toContain('class1');
      expect(result.unusedClasses).toContain('class3');
      expect(result.unusedClasses).not.toContain('class2');
      expect(result.unusedAttributes).toContain('data-attr2');
      expect(result.unusedAttributes).not.toContain('data-attr1');
    });

    it('should calculate percentages correctly', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'styles.css', classes: ['used1', 'used2', 'unused1', 'unused2'], attributes: ['data-used', 'data-unused'], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: ['used1', 'used2'],
        allAttributes: ['data-used'],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.totalClasses).toBe(4);
      expect(result.usedClassesCount).toBe(2);
      expect(result.unusedClassesCount).toBe(2);
      expect(result.classUsagePercentage).toBe(50);

      expect(result.totalAttributes).toBe(2);
      expect(result.usedAttributesCount).toBe(1);
      expect(result.unusedAttributesCount).toBe(1);
      expect(result.attributeUsagePercentage).toBe(50);
    });

    it('should handle classes used in multiple files', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'file1.css', classes: ['shared-class', 'unique-class1'], attributes: [], elements: [] },
        { filePath: 'file2.css', classes: ['shared-class', 'unique-class2'], attributes: [], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: ['shared-class'],
        allAttributes: [],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedClasses).toContain('unique-class1');
      expect(result.unusedClasses).toContain('unique-class2');
      expect(result.unusedClasses).not.toContain('shared-class');
      // shared-class should only appear once in usedClasses
      expect(result.usedClasses.filter(c => c === 'shared-class').length).toBe(1);
    });

    it('should group unused items by file', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'file1.css', classes: ['used1', 'unused1'], attributes: ['data-used', 'data-unused1'], elements: [] },
        { filePath: 'file2.css', classes: ['used2', 'unused2'], attributes: ['data-unused2'], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: ['used1', 'used2'],
        allAttributes: ['data-used'],
        fileResults: [],
      };

      const result = analyzeUnusedCSS(cssFiles, sourceScan);

      expect(result.unusedByFile).toEqual({
        'file1.css': {
          classes: ['unused1'],
          attributes: ['data-unused1'],
        },
        'file2.css': {
          classes: ['unused2'],
          attributes: ['data-unused2'],
        },
      });
    });

    it('should handle Tailwind utility classes option', () => {
      const cssFiles: ParsedCSS[] = [
        { filePath: 'styles.css', classes: ['flex', 'justify-center', 'custom-class'], attributes: [], elements: [] },
      ];

      const sourceScan: ScanResult = {
        filesScanned: 1,
        allClasses: [],
        allAttributes: [],
        fileResults: [],
      };

      // Without ignoring Tailwind
      const result1 = analyzeUnusedCSS(cssFiles, sourceScan, { ignoreTailwindUtilities: false });
      expect(result1.unusedClasses).toContain('flex');
      expect(result1.unusedClasses).toContain('custom-class');

      // With ignoring Tailwind
      const result2 = analyzeUnusedCSS(cssFiles, sourceScan, { ignoreTailwindUtilities: true });
      expect(result2.unusedClasses).not.toContain('flex');
      expect(result2.unusedClasses).not.toContain('justify-center');
      expect(result2.unusedClasses).toContain('custom-class');
    });
  });
});
