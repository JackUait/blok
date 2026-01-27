/**
 * Reporter - Generates reports for unused CSS analysis
 */

import type { UnusedCSSReport } from './analyzer.js';

export type ReportFormat = 'text' | 'json' | 'markdown';

/**
 * Generate a report in the specified format
 */
export function generateReport(report: UnusedCSSReport, format: ReportFormat): string {
  switch (format) {
    case 'json':
      return generateJsonReport(report);
    case 'markdown':
      return generateMarkdownReport(report);
    case 'text':
    default:
      return generateTextReport(report);
  }
}

/**
 * Generate JSON format report
 */
function generateJsonReport(report: UnusedCSSReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Generate text format report
 */
function generateTextReport(report: UnusedCSSReport): string {
  const lines: string[] = [];

  lines.push('='.repeat(50));
  lines.push('Unused CSS Report');
  lines.push('='.repeat(50));
  lines.push('');

  // Summary section
  lines.push('Summary:');
  lines.push(`  Files analyzed: ${Object.keys(report.unusedByFile).length}`);
  lines.push('');

  // Classes section
  lines.push('Classes:');
  lines.push(`  Total: ${report.totalClasses}`);
  lines.push(`  Used: ${report.usedClassesCount} (${report.classUsagePercentage}%)`);
  lines.push(`  Unused: ${report.unusedClassesCount}`);
  lines.push('');

  // Attributes section
  lines.push('Attributes:');
  lines.push(`  Total: ${report.totalAttributes}`);
  lines.push(`  Used: ${report.usedAttributesCount} (${report.attributeUsagePercentage}%)`);
  lines.push(`  Unused: ${report.unusedAttributesCount}`);
  lines.push('');

  // If no unused CSS, return early
  if (report.unusedClasses.length === 0 && report.unusedAttributes.length === 0) {
    lines.push('✨ No unused CSS found!');
    return lines.join('\n');
  }

  // Unused classes
  if (report.unusedClasses.length > 0) {
    const sorted = [...report.unusedClasses].sort();
    lines.push('Unused Classes:');
    for (const className of sorted) {
      lines.push(`  - ${className}`);
    }
    lines.push('');
  }

  // Unused attributes
  if (report.unusedAttributes.length > 0) {
    const sorted = [...report.unusedAttributes].sort();
    lines.push('Unused Attributes:');
    for (const attr of sorted) {
      lines.push(`  - ${attr}`);
    }
    lines.push('');
  }

  // Grouped by file
  if (Object.keys(report.unusedByFile).length > 0) {
    lines.push('Unused by File:');
    lines.push('');

    for (const [filePath, items] of Object.entries(report.unusedByFile)) {
      lines.push(`  ${filePath}:`);

      if (items.classes.length > 0) {
        const sorted = [...items.classes].sort();
        for (const className of sorted) {
          lines.push(`    - ${className}`);
        }
      }

      if (items.attributes.length > 0) {
        const sorted = [...items.attributes].sort();
        for (const attr of sorted) {
          lines.push(`    - ${attr}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate markdown format report
 */
function generateMarkdownReport(report: UnusedCSSReport): string {
  const lines: string[] = [];

  lines.push('# Unused CSS Report');
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Files analyzed:** ${Object.keys(report.unusedByFile).length}`);
  lines.push('');

  // Classes section
  lines.push('### Classes');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${report.totalClasses} |`);
  lines.push(`| Used | ${report.usedClassesCount} (${report.classUsagePercentage}%) |`);
  lines.push(`| Unused | ${report.unusedClassesCount} |`);
  lines.push('');

  // Attributes section
  lines.push('### Attributes');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${report.totalAttributes} |`);
  lines.push(`| Used | ${report.usedAttributesCount} (${report.attributeUsagePercentage}%) |`);
  lines.push(`| Unused | ${report.unusedAttributesCount} |`);
  lines.push('');

  // If no unused CSS
  if (report.unusedClasses.length === 0 && report.unusedAttributes.length === 0) {
    lines.push('✨ No unused CSS found!');
    return lines.join('\n');
  }

  // Unused classes
  if (report.unusedClasses.length > 0) {
    const sorted = [...report.unusedClasses].sort();
    lines.push('### Unused Classes');
    lines.push('');
    for (const className of sorted) {
      lines.push(`- \`${className}\``);
    }
    lines.push('');
  }

  // Unused attributes
  if (report.unusedAttributes.length > 0) {
    const sorted = [...report.unusedAttributes].sort();
    lines.push('### Unused Attributes');
    lines.push('');
    for (const attr of sorted) {
      lines.push(`- \`${attr}\``);
    }
    lines.push('');
  }

  // Grouped by file
  if (Object.keys(report.unusedByFile).length > 0) {
    lines.push('## Unused by File');
    lines.push('');

    for (const [filePath, items] of Object.entries(report.unusedByFile)) {
      lines.push(`### ${filePath}`);
      lines.push('');

      if (items.classes.length > 0) {
        lines.push('**Classes:**');
        const sorted = [...items.classes].sort();
        for (const className of sorted) {
          lines.push(`- \`${className}\``);
        }
        lines.push('');
      }

      if (items.attributes.length > 0) {
        lines.push('**Attributes:**');
        const sorted = [...items.attributes].sort();
        for (const attr of sorted) {
          lines.push(`- \`${attr}\``);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
