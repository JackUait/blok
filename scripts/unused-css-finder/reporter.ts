/**
 * Reporter - Generates reports for unused CSS analysis
 */

import type { UnusedCSSReport } from './analyzer.js';

export type ReportFormat = 'text' | 'json' | 'markdown';

/**
 * Generate a report in the specified format
 */
export const generateReport = (report: UnusedCSSReport, format: ReportFormat): string => {
  switch (format) {
    case 'json':
      return generateJsonReport(report);
    case 'markdown':
      return generateMarkdownReport(report);
    case 'text':
    default:
      return generateTextReport(report);
  }
};

/**
 * Generate JSON format report
 */
const generateJsonReport = (report: UnusedCSSReport): string => {
  return JSON.stringify(report, null, 2);
};

/**
 * Add sorted item lines with a prefix and optional suffix to the output array
 */
const addSortedItems = (lines: string[], items: string[], prefix: string, suffix = ''): void => {
  const sorted = [...items].sort();
  for (const item of sorted) {
    lines.push(`${prefix}${item}${suffix}`);
  }
};

/**
 * Generate text format report
 */
const generateTextReport = (report: UnusedCSSReport): string => {
  const lines: string[] = [];

  lines.push('='.repeat(50));
  lines.push('Unused CSS Report');
  lines.push('='.repeat(50));
  lines.push('');

  lines.push('Summary:');
  lines.push(`  Files analyzed: ${Object.keys(report.unusedByFile).length}`);
  lines.push('');

  lines.push('Classes:');
  lines.push(`  Total: ${report.totalClasses}`);
  lines.push(`  Used: ${report.usedClassesCount} (${report.classUsagePercentage}%)`);
  lines.push(`  Unused: ${report.unusedClassesCount}`);
  lines.push('');

  lines.push('Attributes:');
  lines.push(`  Total: ${report.totalAttributes}`);
  lines.push(`  Used: ${report.usedAttributesCount} (${report.attributeUsagePercentage}%)`);
  lines.push(`  Unused: ${report.unusedAttributesCount}`);
  lines.push('');

  if (report.unusedClasses.length === 0 && report.unusedAttributes.length === 0) {
    lines.push('No unused CSS found!');
    return lines.join('\n');
  }

  if (report.unusedClasses.length > 0) {
    lines.push('Unused Classes:');
    addSortedItems(lines, report.unusedClasses, '  - ');
    lines.push('');
  }

  if (report.unusedAttributes.length > 0) {
    lines.push('Unused Attributes:');
    addSortedItems(lines, report.unusedAttributes, '  - ');
    lines.push('');
  }

  appendTextFileSection(lines, report);

  return lines.join('\n');
};

/**
 * Append the "by file" section to text report lines
 */
const appendTextFileSection = (lines: string[], report: UnusedCSSReport): void => {
  if (Object.keys(report.unusedByFile).length === 0) {
    return;
  }

  lines.push('Unused by File:');
  lines.push('');

  for (const [filePath, items] of Object.entries(report.unusedByFile)) {
    lines.push(`  ${filePath}:`);
    addSortedItems(lines, items.classes, '    - ');
    addSortedItems(lines, items.attributes, '    - ');
    lines.push('');
  }
};

/**
 * Generate markdown format report
 */
const generateMarkdownReport = (report: UnusedCSSReport): string => {
  const lines: string[] = [];

  lines.push('# Unused CSS Report');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Files analyzed:** ${Object.keys(report.unusedByFile).length}`);
  lines.push('');

  lines.push('### Classes');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${report.totalClasses} |`);
  lines.push(`| Used | ${report.usedClassesCount} (${report.classUsagePercentage}%) |`);
  lines.push(`| Unused | ${report.unusedClassesCount} |`);
  lines.push('');

  lines.push('### Attributes');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${report.totalAttributes} |`);
  lines.push(`| Used | ${report.usedAttributesCount} (${report.attributeUsagePercentage}%) |`);
  lines.push(`| Unused | ${report.unusedAttributesCount} |`);
  lines.push('');

  if (report.unusedClasses.length === 0 && report.unusedAttributes.length === 0) {
    lines.push('No unused CSS found!');
    return lines.join('\n');
  }

  if (report.unusedClasses.length > 0) {
    lines.push('### Unused Classes');
    lines.push('');
    addSortedItems(lines, report.unusedClasses, '- `', '`');
    lines.push('');
  }

  if (report.unusedAttributes.length > 0) {
    lines.push('### Unused Attributes');
    lines.push('');
    addSortedItems(lines, report.unusedAttributes, '- `', '`');
    lines.push('');
  }

  appendMarkdownFileSection(lines, report);

  return lines.join('\n');
};

/**
 * Append the "by file" section to markdown report lines
 */
const appendMarkdownFileSection = (lines: string[], report: UnusedCSSReport): void => {
  if (Object.keys(report.unusedByFile).length === 0) {
    return;
  }

  lines.push('## Unused by File');
  lines.push('');

  for (const [filePath, items] of Object.entries(report.unusedByFile)) {
    lines.push(`### ${filePath}`);
    lines.push('');

    if (items.classes.length > 0) {
      lines.push('**Classes:**');
      addSortedItems(lines, items.classes, '- `', '`');
      lines.push('');
    }

    if (items.attributes.length > 0) {
      lines.push('**Attributes:**');
      addSortedItems(lines, items.attributes, '- `', '`');
      lines.push('');
    }
  }
};
