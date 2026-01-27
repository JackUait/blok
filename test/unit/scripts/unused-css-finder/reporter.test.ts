/**
 * Tests for Reporter
 * Tests the generation of reports for unused CSS
 */

import { describe, it, expect } from 'vitest';
import { generateReport, ReportFormat } from '../../../../scripts/unused-css-finder/reporter';
import type { UnusedCSSReport } from '../../../../scripts/unused-css-finder/analyzer';

describe('Reporter', () => {
  const sampleReport: UnusedCSSReport = {
    totalClasses: 10,
    usedClassesCount: 6,
    unusedClassesCount: 4,
    classUsagePercentage: 60,
    totalAttributes: 5,
    usedAttributesCount: 3,
    unusedAttributesCount: 2,
    attributeUsagePercentage: 60,
    usedClasses: ['used-class-1', 'used-class-2', 'used-class-3', 'shared-class', 'blok-button', 'blok-input'],
    unusedClasses: ['unused-class-1', 'unused-class-2', 'old-class', 'deprecated-class'],
    usedAttributes: ['data-blok-selected', 'data-blok-focused', 'data-active'],
    unusedAttributes: ['data-deprecated', 'data-old'],
    unusedByFile: {
      'src/styles/main.css': {
        classes: ['unused-class-1', 'unused-class-2'],
        attributes: ['data-deprecated'],
      },
      'docs/assets/styles.css': {
        classes: ['old-class', 'deprecated-class'],
        attributes: ['data-old'],
      },
    },
  };

  describe('generateReport', () => {
    it('should generate text format report', () => {
      const result = generateReport(sampleReport, 'text');

      expect(result).toContain('Unused CSS Report');
      expect(result).toContain('Total: 10');
      expect(result).toContain('Used: 6 (60%)');
      expect(result).toContain('Unused: 4');
      expect(result).toContain('Total: 5');
      expect(result).toContain('unused-class-1');
      expect(result).toContain('data-deprecated');
    });

    it('should generate JSON format report', () => {
      const result = generateReport(sampleReport, 'json');

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(sampleReport);
    });

    it('should generate markdown format report', () => {
      const result = generateReport(sampleReport, 'markdown');

      expect(result).toContain('# Unused CSS Report');
      expect(result).toContain('## Summary');
      expect(result).toContain('### Classes');
      expect(result).toContain('| Total | 10 |');
      expect(result).toContain('### Attributes');
      expect(result).toContain('## Unused by File');
      expect(result).toContain('`unused-class-1`');
    });

    it('should handle empty report', () => {
      const emptyReport: UnusedCSSReport = {
        totalClasses: 0,
        usedClassesCount: 0,
        unusedClassesCount: 0,
        classUsagePercentage: 100,
        totalAttributes: 0,
        usedAttributesCount: 0,
        unusedAttributesCount: 0,
        attributeUsagePercentage: 100,
        usedClasses: [],
        unusedClasses: [],
        usedAttributes: [],
        unusedAttributes: [],
        unusedByFile: {},
      };

      const result = generateReport(emptyReport, 'text');

      expect(result).toContain('No unused CSS found!');
      expect(result).toContain('100%');
    });

    it('should sort unused items alphabetically in text report', () => {
      const result = generateReport(sampleReport, 'text');

      // Find the unused classes section
      const unusedClassIndex = result.indexOf('Unused Classes:');
      const nextSectionIndex = result.indexOf('\n\n', unusedClassIndex);
      const unusedClassesSection = result.slice(unusedClassIndex, nextSectionIndex);

      // Classes should be sorted
      const deprecatedPos = unusedClassesSection.indexOf('deprecated-class');
      const oldPos = unusedClassesSection.indexOf('old-class');
      const unused1Pos = unusedClassesSection.indexOf('unused-class-1');
      const unused2Pos = unusedClassesSection.indexOf('unused-class-2');

      expect(deprecatedPos).toBeLessThan(oldPos);
      expect(oldPos).toBeLessThan(unused1Pos);
      expect(unused1Pos).toBeLessThan(unused2Pos);
    });

    it('should include file paths in grouped report', () => {
      const result = generateReport(sampleReport, 'text');

      expect(result).toContain('src/styles/main.css');
      expect(result).toContain('docs/assets/styles.css');
    });

    it('should handle report with only unused classes', () => {
      const classesOnlyReport: UnusedCSSReport = {
        ...sampleReport,
        unusedAttributes: [],
        unusedAttributesCount: 0,
        attributeUsagePercentage: 100,
      };

      const result = generateReport(classesOnlyReport, 'text');

      expect(result).toContain('Unused Classes:');
      expect(result).not.toContain('Unused Attributes:');
    });

    it('should handle report with only unused attributes', () => {
      const attrsOnlyReport: UnusedCSSReport = {
        ...sampleReport,
        unusedClasses: [],
        unusedClassesCount: 0,
        classUsagePercentage: 100,
      };

      const result = generateReport(attrsOnlyReport, 'text');

      expect(result).toContain('Unused Attributes:');
      expect(result).not.toContain('Unused Classes:');
    });
  });
});
