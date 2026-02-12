#!/usr/bin/env node

/**
 * i18n Audit Script
 *
 * Scans the Blok codebase for hardcoded user-facing strings that should be internationalized.
 * Generates JSON and Markdown reports categorized by priority.
 *
 * Usage: node scripts/i18n-audit.js
 *
 * Output:
 *   - scripts/i18n-audit-report.json - Machine-readable findings
 *   - scripts/i18n-audit-report.md   - Human-readable report
 *
 * Categories:
 *   - Tier 1 (Critical): Menu items, button labels, tooltips in runtime code
 *   - Tier 2 (Fallback): Static tool properties that serve as fallbacks
 *   - Tier 3 (Internal): Type definitions, never-displayed defaults
 *
 * Detection patterns:
 *   - title: 'String' in object literals (PopoverItemParams, ToolboxConfig)
 *   - label: 'String' in object literals (MenuConfig)
 *   - placeholder: 'String' in object literals
 *   - static title = 'String' in classes
 *   - String literals 3+ words or common UI terms
 *
 * Exclusions:
 *   - console.log(), throw new Error()
 *   - Test and story files
 *   - CSS class strings (Tailwind classes)
 *   - Data attributes (data-blok-*)
 *   - searchTerms arrays
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Configuration
const SRC_DIR = path.join(__dirname, '../src');
const REPORT_JSON = path.join(__dirname, 'i18n-audit-report.json');
const REPORT_MD = path.join(__dirname, 'i18n-audit-report.md');

// Patterns for detection
const UI_PROPERTIES = new Set([
  'title',
  'label',
  'placeholder',
  'message',
  'text',
  'name',
  'description',
]);

// Patterns to exclude
const EXCLUDE_PROPERTIES = new Set([
  'searchTerms',
  'className',
  'class',
  'style',
  'type',
  'icon',
  'href',
  'src',
  'alt',
  'id',
  'key',
  'testid',
  'aria-label',
  'role',
  'name', // too generic, causes false positives
]);

const EXCLUDE_PATTERNS = [
  /console\.(log|warn|error|info|debug)/,
  /throw new Error/,
  /data-blok-/i,
  /data-testid/i,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.stories\.ts$/,
  /\/stories\//,
  /\.d\.ts$/,
];

// Findings storage
const findings = [];

/**
 * Check if a file should be excluded from scanning
 */
function shouldExcludeFile(filePath) {
  const relativePath = path.relative(SRC_DIR, filePath);
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath));
}

/**
 * Check if a string looks like it's user-facing (3+ words or specific UI text)
 */
function isLikelyUserFacing(str, propertyName, parentContext) {
  if (typeof str !== 'string') return false;

  // Remove quotes
  const cleaned = str.replace(/^['"`]|['"`]$/g, '').trim();

  // Too short
  if (cleaned.length < 2) return false;

  // Just a single character
  if (cleaned.length === 1) return false;

  // Looks like a variable name (camelCase, snake_case, etc.) - but only if lowercase start
  if (/^[a-z_$][a-z0-9_$]*$/i.test(cleaned) && /^[a-z]/.test(cleaned)) return false;

  // Looks like Tailwind CSS classes (multiple space-separated classes with hyphens)
  // or any string with CSS-like patterns (e.g., "text-lg", "bg-blue-500")
  if (cleaned.includes(' ') && cleaned.split(/\s+/).every(part => /^[\w-]+$/.test(part) && part.includes('-'))) {
    return false;
  }

  // Single CSS class-like string (lowercase with hyphens, no spaces)
  if (/^[a-z][\w-]*$/.test(cleaned) && cleaned.includes('-')) {
    return false;
  }

  // Looks like a file path
  if (cleaned.includes('/') || cleaned.includes('\\')) return false;

  // Looks like a URL or protocol
  if (/^https?:/.test(cleaned) || /^\/\//.test(cleaned)) return false;

  // HTML tags
  if (/^<[^>]+>$/.test(cleaned)) return false;

  // Common technical strings
  const technicalTerms = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'];
  if (technicalTerms.includes(cleaned)) return false;

  // Has 3+ words and looks like natural language (not all lowercase-hyphenated)
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount >= 3) {
    // Make sure it's not just CSS classes
    if (!cleaned.split(/\s+/).every(part => /^[a-z][\w-]*$/.test(part))) {
      return true;
    }
    return false;
  }

  // 1-2 words but looks like UI text (starts with capital, has spaces)
  if (wordCount >= 2 && /^[A-Z]/.test(cleaned)) return true;

  // Single capitalized word that looks like a label (for title/label properties especially)
  if (/^[A-Z][a-z]+$/.test(cleaned)) return true;

  // Common single-word UI labels (even if short)
  const commonUIWords = [
    'Delete', 'Clear', 'Text', 'Link', 'Bold', 'Italic', 'Save', 'Cancel',
    'Add', 'Edit', 'Remove', 'Search', 'Filter', 'Sort', 'View', 'Settings',
    'Help', 'Close', 'Open', 'New', 'Import', 'Export', 'Upload', 'Download',
  ];
  if (commonUIWords.includes(cleaned)) return true;

  return false;
}

/**
 * Categorize a finding based on context
 */
function categorizeFinding(propertyName, context, isStatic, isInClass) {
  // Tier 1: Critical runtime UI strings
  if (['title', 'label', 'placeholder', 'message'].includes(propertyName)) {
    // But not if it's a static class property (those are tier 2)
    if (isStatic && isInClass) {
      return 'tier2';
    }
    return 'tier1';
  }

  // Tier 2: Fallback strings in tool definitions
  if (isStatic && isInClass) {
    return 'tier2';
  }

  // Check context for type definitions
  if (context.includes('interface') || context.includes('type ')) {
    return 'tier3';
  }

  return 'tier1';
}

/**
 * Generate a suggested translation key from context
 */
function generateSuggestedKey(filePath, propertyName, stringValue) {
  const relativePath = path.relative(SRC_DIR, filePath);

  // Extract tool/component name from path
  const pathParts = relativePath.split(path.sep);

  // For tools
  if (pathParts.includes('tools')) {
    const toolIndex = pathParts.indexOf('tools');
    const toolName = pathParts[toolIndex + 1];
    if (toolName) {
      const key = stringValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      return `tools.${toolName}.${key}`;
    }
  }

  // For components
  if (pathParts.includes('components')) {
    const componentIndex = pathParts.indexOf('components');
    const componentName = pathParts[componentIndex + 1];
    if (componentName) {
      const key = stringValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      return `components.${componentName}.${key}`;
    }
  }

  // Generic fallback
  const key = stringValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `ui.${key}`;
}

/**
 * Check if a node is inside a console.log or throw statement
 */
function isInExcludedContext(node, sourceFile) {
  let parent = node.parent;
  while (parent) {
    // Check for console.log/warn/error
    if (ts.isCallExpression(parent)) {
      const expression = parent.expression;
      if (ts.isPropertyAccessExpression(expression)) {
        if (expression.expression.getText(sourceFile) === 'console') {
          return true;
        }
      }
    }

    // Check for throw statement
    if (ts.isThrowStatement(parent)) {
      return true;
    }

    parent = parent.parent;
  }
  return false;
}

/**
 * Check if node is a property in an object that should be excluded
 */
function isExcludedProperty(node, sourceFile) {
  if (ts.isPropertyAssignment(node.parent)) {
    const propName = node.parent.name.getText(sourceFile);
    if (EXCLUDE_PROPERTIES.has(propName)) {
      return true;
    }
  }
  return false;
}

/**
 * Visit AST nodes to find hardcoded strings
 */
function visitNode(node, sourceFile, filePath) {
  // Skip if in excluded context
  if (isInExcludedContext(node, sourceFile)) {
    return;
  }

  // Check for static class properties with string literal
  // e.g., static title = 'Link'
  if (ts.isPropertyDeclaration(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {

    const propertyName = node.name.getText(sourceFile);

    if (UI_PROPERTIES.has(propertyName) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const stringValue = node.initializer.text;

      if (isLikelyUserFacing(stringValue, propertyName, null)) {
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const context = node.getText(sourceFile).substring(0, 100);

        findings.push({
          file: path.relative(SRC_DIR, filePath),
          line: lineNumber,
          string: stringValue,
          context: context,
          category: categorizeFinding(propertyName, context, true, true),
          suggestedKey: generateSuggestedKey(filePath, propertyName, stringValue),
        });
      }
    }
  }

  // Check for object literal properties
  // e.g., { title: 'Insert Column Left' }
  if (ts.isPropertyAssignment(node)) {
    const propertyName = node.name.getText(sourceFile);

    if (UI_PROPERTIES.has(propertyName) &&
        !EXCLUDE_PROPERTIES.has(propertyName) &&
        ts.isStringLiteral(node.initializer)) {

      const stringValue = node.initializer.text;

      if (isLikelyUserFacing(stringValue, propertyName, null)) {
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const context = node.getText(sourceFile).substring(0, 100);

        findings.push({
          file: path.relative(SRC_DIR, filePath),
          line: lineNumber,
          string: stringValue,
          context: context,
          category: categorizeFinding(propertyName, context, false, false),
          suggestedKey: generateSuggestedKey(filePath, propertyName, stringValue),
        });
      }
    }
  }

  // Recursively visit children
  ts.forEachChild(node, child => visitNode(child, sourceFile, filePath));
}

/**
 * Scan a single TypeScript file
 */
function scanFile(filePath) {
  if (shouldExcludeFile(filePath)) {
    return;
  }

  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  visitNode(sourceFile, sourceFile, filePath);
}

/**
 * Recursively find all .ts and .tsx files in a directory
 */
function findTypeScriptFiles(dir) {
  const files = [];

  function traverse(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and other common excludes
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
          traverse(fullPath);
        }
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  traverse(dir);
  return files;
}

/**
 * Generate JSON report
 */
function generateJsonReport() {
  const summary = {
    tier1: findings.filter(f => f.category === 'tier1').length,
    tier2: findings.filter(f => f.category === 'tier2').length,
    tier3: findings.filter(f => f.category === 'tier3').length,
    total: findings.length,
  };

  const report = {
    findings,
    summary,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`JSON report written to: ${REPORT_JSON}`);
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport() {
  const lines = [];

  lines.push('# i18n Audit Report');
  lines.push('');
  lines.push('This report identifies hardcoded strings in the Blok codebase that should be internationalized.');
  lines.push('');

  // Summary
  const tier1Count = findings.filter(f => f.category === 'tier1').length;
  const tier2Count = findings.filter(f => f.category === 'tier2').length;
  const tier3Count = findings.filter(f => f.category === 'tier3').length;

  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Tier 1 (Critical)**: ${tier1Count} - Menu items, button labels, tooltips`);
  lines.push(`- **Tier 2 (Fallback)**: ${tier2Count} - Static tool properties, toolbox config`);
  lines.push(`- **Tier 3 (Internal)**: ${tier3Count} - Type definitions, never-displayed defaults`);
  lines.push(`- **Total**: ${findings.length}`);
  lines.push('');

  // Group by category
  const categories = ['tier1', 'tier2', 'tier3'];
  const categoryNames = {
    tier1: 'Tier 1: Critical Runtime UI Strings',
    tier2: 'Tier 2: Fallback Configuration Strings',
    tier3: 'Tier 3: Internal/Type Definitions',
  };

  for (const category of categories) {
    const categoryFindings = findings.filter(f => f.category === category);

    if (categoryFindings.length === 0) continue;

    lines.push(`## ${categoryNames[category]}`);
    lines.push('');

    // Group by file
    const byFile = {};
    for (const finding of categoryFindings) {
      if (!byFile[finding.file]) {
        byFile[finding.file] = [];
      }
      byFile[finding.file].push(finding);
    }

    for (const [file, fileFindings] of Object.entries(byFile).sort()) {
      lines.push(`### ${file}`);
      lines.push('');

      for (const finding of fileFindings) {
        lines.push(`**Line ${finding.line}**: \`"${finding.string}"\``);
        lines.push('');
        lines.push('```typescript');
        lines.push(finding.context);
        lines.push('```');
        lines.push('');
        lines.push(`**Suggested key**: \`${finding.suggestedKey}\``);
        lines.push('');
      }
    }
  }

  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf-8');
  console.log(`Markdown report written to: ${REPORT_MD}`);
}

/**
 * Main execution
 */
function main() {
  console.log('Starting i18n audit...');
  console.log(`Scanning: ${SRC_DIR}`);

  const files = findTypeScriptFiles(SRC_DIR);
  console.log(`Found ${files.length} TypeScript files`);

  for (const file of files) {
    scanFile(file);
  }

  console.log(`\nFound ${findings.length} potential hardcoded strings`);

  generateJsonReport();
  generateMarkdownReport();

  console.log('\nAudit complete!');
  console.log(`\nSummary:`);
  console.log(`  Tier 1 (Critical): ${findings.filter(f => f.category === 'tier1').length}`);
  console.log(`  Tier 2 (Fallback): ${findings.filter(f => f.category === 'tier2').length}`);
  console.log(`  Tier 3 (Internal): ${findings.filter(f => f.category === 'tier3').length}`);
  console.log(`  Total: ${findings.length}`);
}

main();
