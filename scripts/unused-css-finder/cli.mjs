#!/usr/bin/env node

/**
 * CLI for Unused CSS Finder
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Remove CSS comments from content
 */
function stripComments(css) {
  let result = css.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/@import\s+[^;]+;/g, '');
  return result;
}

/**
 * Extract all class names from CSS content
 */
function extractClassNames(css) {
  const processed = stripComments(css);
  const classNames = new Set();
  let index = 0;
  const classRegex = /\.([a-zA-Z0-9_-]+)/g;

  while (index < processed.length) {
    const match = classRegex.exec(processed);
    if (!match) break;

    const className = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    const charBefore = matchStart > 0 ? processed[matchStart - 1] : '';
    const charAfter = matchEnd < processed.length ? processed[matchEnd] : '';

    const validBefore = charBefore === '' ||
                       /\s/.test(charBefore) ||
                       '[>+~:,{'.includes(charBefore) ||
                       /[a-zA-Z]/.test(charBefore);

    const validAfter = charAfter === '' ||
                      /\s/.test(charAfter) ||
                      '[>+~:,{.'.includes(charAfter) ||
                      charAfter === '[';

    if (validBefore && validAfter) {
      classNames.add(className);
    }

    index = matchStart + 1;
    classRegex.lastIndex = index;
  }

  return Array.from(classNames);
}

/**
 * Extract attribute selectors from CSS
 */
function extractAttributes(css) {
  const processed = stripComments(css);
  const attributes = new Set();
  const attrRegex = /\[([a-zA-Z0-9_-]+)(?:[~|^$*]?=["'][^"']*["'])?\]/g;
  let match;

  while ((match = attrRegex.exec(processed)) !== null) {
    attributes.add(match[1]);
  }

  return Array.from(attributes);
}

/**
 * Remove single-line and multi-line comments from code
 */
function stripCodeComments(code) {
  let result = code.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/(?<!:)\/\/.*$/gm, '');
  return result;
}

/**
 * Find CSS class and attribute usage in source code
 */
function findCSSUsage(code) {
  const classes = new Set();
  const attributes = new Set();
  const strippedCode = stripCodeComments(code);

  // Match classList methods
  const classListRegex = /classList\.(add|remove|toggle|contains)\s*\(\s*(['"`])([a-zA-Z0-9_-]+)\2/g;
  let match;
  while ((match = classListRegex.exec(strippedCode)) !== null) {
    classes.add(match[3]);
  }

  // Match className attribute
  const classNameRegex = /className\s*=\s*{?\s*(['"`])([^'"`]*?[a-zA-Z0-9_-]+[^'"`]*)\1/g;
  while ((match = classNameRegex.exec(strippedCode)) !== null) {
    const classNames = match[2].split(/\s+/);
    for (const className of classNames) {
      if (/^[a-zA-Z0-9_-]+$/.test(className)) {
        classes.add(className);
      }
    }
  }

  // Match dataset properties
  const datasetRegex = /dataset\.([a-zA-Z0-9]+)/g;
  while ((match = datasetRegex.exec(strippedCode)) !== null) {
    const kebabCase = match[1].replace(/([A-Z])/g, '-$1').toLowerCase();
    attributes.add(`data-${kebabCase}`);
  }

  // Match dataset bracket notation
  const datasetBracketRegex = /dataset\[['"`]([a-zA-Z0-9-]+)['"`]\]/g;
  while ((match = datasetBracketRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match dataset with function calls
  const datasetBracketFuncRegex = /dataset\[[^(]*\(['"`]([a-zA-Z0-9-]+)['"`]\)/g;
  while ((match = datasetBracketFuncRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match data- attributes in querySelector, etc.
  const dataAttrRegex = /(?:querySelector|getAttribute|setAttribute|hasAttribute|querySelectorAll)\s*\(\s*['"`]?\[?data-([a-zA-Z0-9-]+)/g;
  while ((match = dataAttrRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match data- attribute strings
  const dataAttrStringRegex = /['"`]data-([a-zA-Z0-9-]+)['"`]/g;
  while ((match = dataAttrStringRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  return {
    classes: Array.from(classes),
    attributes: Array.from(attributes)
  };
}

/**
 * Check if class is a Tailwind utility
 */
const TAILWIND_PATTERNS = [
  /^p-?[0-9xl]+$/, /^px-?[0-9xl]+$/, /^py-?[0-9xl]+$/,
  /^pt-?[0-9xl]+$/, /^pr-?[0-9xl]+$/, /^pb-?[0-9xl]+$/, /^pl-?[0-9xl]+$/,
  /^m-?[0-9xl]+$/, /^mx-?[0-9xl]+$/, /^my-?[0-9xl]+$/,
  /^flex$/, /^flex-(row|col|wrap|nowrap|reverse|grow|shrink)$/,
  /^justify-(start|end|center|between|around|evenly)$/,
  /^items-(start|end|center|baseline|stretch)$/,
  /^block$/, /^inline-block$/, /^hidden$/, /^inline$/,
  /^bg-(white|black|transparent|gray-\d+|red-\d+|blue-\d+|green-\d+|yellow-\d+)$/,
  /^text-(white|black|gray-\d+|red-\d+|blue-\d+|green-\d+|yellow-\d+)$/,
  /^border$/, /^border-?[0-2]$/, /^rounded(-?[0-9xl]+)?$/,
  /^w-?\d+$/, /^h-?\d+$/, /^max-w-?\w+$/,
  /^relative$/, /^absolute$/, /^fixed$/, /^sticky$/,
  /^text-(xs|sm|base|lg|xl|\d+xl)$/,
  /^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^shadow(-?\w+)?$/, /^opacity-?\d+$/,
  /^cursor-(pointer|default|not-allowed)$/, /^pointer-events-none$/,
];

function isTailwindUtility(className) {
  return TAILWIND_PATTERNS.some(pattern => pattern.test(className));
}

/**
 * Recursively scan a directory for source files
 */
async function scanDirectory(dir, excludeDirs = ['node_modules', '.git', 'dist', 'build']) {
  const files = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          const subFiles = await scanDirectory(fullPath, excludeDirs);
          files.push(...subFiles);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
        if (sourceExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return files;
}

/**
 * Find all CSS files in a directory
 */
async function findCSSFiles(dir, extensions = ['.css']) {
  const files = [];

  async function scan(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          await scan(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase().endsWith('.css') ? '.css' :
                    entry.name.toLowerCase().endsWith('.module.css') ? '.module.css' : '';
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await scan(dir);
  return files;
}

/**
 * Generate text report
 */
function generateTextReport(report) {
  const lines = [];

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
    lines.push('✨ No unused CSS found!');
    return lines.join('\n');
  }

  if (report.unusedClasses.length > 0) {
    const sorted = [...report.unusedClasses].sort();
    lines.push('Unused Classes:');
    for (const className of sorted) {
      lines.push(`  - ${className}`);
    }
    lines.push('');
  }

  if (report.unusedAttributes.length > 0) {
    const sorted = [...report.unusedAttributes].sort();
    lines.push('Unused Attributes:');
    for (const attr of sorted) {
      lines.push(`  - ${attr}`);
    }
    lines.push('');
  }

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
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);

  let cssDir = '.';
  let srcDir = '.';
  let ignoreTailwind = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Unused CSS Finder - Find and report unused CSS classes and data attributes

Usage:
  unused-css [options]

Options:
  --css-dir <path>     Directory containing CSS files (default: .)
  --src-dir <path>     Directory containing source files to scan (default: .)
  --include-tailwind   Don't ignore Tailwind utility classes
  --help, -h           Show this help message

Examples:
  unused-css --css-dir ./src/styles --src-dir ./src
  unused-css --include-tailwind
      `);
      process.exit(0);
    }

    if (arg === '--css-dir' && args[i + 1]) {
      cssDir = args[++i];
    } else if (arg === '--src-dir' && args[i + 1]) {
      srcDir = args[++i];
    } else if (arg === '--include-tailwind') {
      ignoreTailwind = false;
    }
  }

  // Find CSS files
  console.error(`Scanning CSS files in: ${cssDir}`);
  const cssFiles = await findCSSFiles(cssDir);

  if (cssFiles.length === 0) {
    console.error('No CSS files found');
    process.exit(1);
  }

  console.error(`Found ${cssFiles.length} CSS file(s)`);

  // Parse CSS files
  const cssData = [];
  const allDefinedClasses = new Set();
  const allDefinedAttributes = new Set();

  for (const filePath of cssFiles) {
    const content = await readFile(filePath, 'utf-8');
    const classes = extractClassNames(content);
    const attributes = extractAttributes(content);

    for (const c of classes) {
      if (!ignoreTailwind || !isTailwindUtility(c)) {
        allDefinedClasses.add(c);
      }
    }
    for (const a of attributes) {
      allDefinedAttributes.add(a);
    }

    cssData.push({ filePath, classes, attributes });
    console.error(`  Parsed: ${filePath} (${classes.length} classes, ${attributes.length} attributes)`);
  }

  // Scan source files
  console.error(`\nScanning source files in: ${srcDir}`);
  const sourceFiles = await scanDirectory(srcDir);

  const allUsedClasses = new Set();
  const allUsedAttributes = new Set();

  for (const filePath of sourceFiles) {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) continue;

      const content = await readFile(filePath, 'utf-8');
      const usage = findCSSUsage(content);

      for (const c of usage.classes) {
        allUsedClasses.add(c);
      }
      for (const a of usage.attributes) {
        allUsedAttributes.add(a);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  console.error(`Scanned ${sourceFiles.length} file(s)`);
  console.error(`Found usage of ${allUsedClasses.size} classes and ${allUsedAttributes.size} attributes`);

  // Find unused
  const unusedClasses = [];
  const unusedAttributes = [];
  const unusedByFile = {};

  for (const cssFile of cssData) {
    const fileUnusedClasses = [];
    const fileUnusedAttributes = [];

    for (const c of cssFile.classes) {
      if (ignoreTailwind && isTailwindUtility(c)) continue;
      if (!allUsedClasses.has(c)) {
        fileUnusedClasses.push(c);
        unusedClasses.push(c);
      }
    }

    for (const a of cssFile.attributes) {
      if (!allUsedAttributes.has(a)) {
        fileUnusedAttributes.push(a);
        unusedAttributes.push(a);
      }
    }

    if (fileUnusedClasses.length > 0 || fileUnusedAttributes.length > 0) {
      unusedByFile[cssFile.filePath] = {
        classes: fileUnusedClasses,
        attributes: fileUnusedAttributes
      };
    }
  }

  const usedClasses = Array.from(allDefinedClasses).filter(c => allUsedClasses.has(c));
  const usedAttributes = Array.from(allDefinedAttributes).filter(a => allUsedAttributes.has(a));

  const report = {
    totalClasses: allDefinedClasses.size,
    usedClassesCount: usedClasses.length,
    unusedClassesCount: unusedClasses.length,
    classUsagePercentage: allDefinedClasses.size > 0
      ? Math.round((usedClasses.length / allDefinedClasses.size) * 100)
      : 100,
    totalAttributes: allDefinedAttributes.size,
    usedAttributesCount: usedAttributes.length,
    unusedAttributesCount: unusedAttributes.length,
    attributeUsagePercentage: allDefinedAttributes.size > 0
      ? Math.round((usedAttributes.length / allDefinedAttributes.size) * 100)
      : 100,
    unusedClasses,
    unusedAttributes,
    unusedByFile
  };

  console.error('\nAnalyzing...\n');
  console.log(generateTextReport(report));

  // Exit with error code if unused CSS found
  if (report.unusedClassesCount > 0 || report.unusedAttributesCount > 0) {
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
