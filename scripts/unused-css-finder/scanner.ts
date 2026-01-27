/**
 * Source Scanner - Scans source files for CSS class and attribute usage
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

export interface CSSUsage {
  classes: string[];
  attributes: string[];
}

export interface FileScanResult extends CSSUsage {
  filePath: string;
}

export interface ScanResult extends CSSUsage {
  filesScanned: number;
  fileResults: FileScanResult[];
}

/**
 * Remove single-line comments and multi-line comments
 */
function stripComments(code: string): string {
  // Remove multi-line comments first (they may span multiple lines)
  let result = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (but not URLs like http://...)
  result = result.replace(/(?<!:)\/\/.*$/gm, '');
  return result;
}

/**
 * Find CSS class and attribute usage in source code
 */
export function findCSSUsage(code: string): CSSUsage {
  const classes = new Set<string>();
  const attributes = new Set<string>();

  const strippedCode = stripComments(code);

  // Match classList methods: classList.add('class-name'), classList.remove(), etc.
  const classListRegex = /classList\.(add|remove|toggle|contains)\s*\(\s*(['"`])([a-zA-Z0-9_-]+)\2/g;
  let match;
  while ((match = classListRegex.exec(strippedCode)) !== null) {
    classes.add(match[3]);
  }

  // Match className attribute with class names: className="class1 class2"
  const classNameRegex = /className\s*=\s*{?\s*(['"`])([^'"`]*?[a-zA-Z0-9_-]+[^'"`]*)\1/g;
  while ((match = classNameRegex.exec(strippedCode)) !== null) {
    const classNames = match[2].split(/\s+/);
    for (const className of classNames) {
      if (/^[a-zA-Z0-9_-]+$/.test(className)) {
        classes.add(className);
      }
    }
  }

  // Match dataset properties: element.dataset.blokSelected -> data-blok-selected
  const datasetRegex = /dataset\.([a-zA-Z0-9]+)/g;
  while ((match = datasetRegex.exec(strippedCode)) !== null) {
    const kebabCase = match[1].replace(/([A-Z])/g, '-$1').toLowerCase();
    attributes.add(`data-${kebabCase}`);
  }

  // Match dataset bracket notation: dataset['blok-selected'] -> data-blok-selected
  const datasetBracketRegex = /dataset\[['"`]([a-zA-Z0-9-]+)['"`]\]/g;
  while ((match = datasetBracketRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match dataset bracket notation with function calls: dataset[func('blok-selected')]
  const datasetBracketFuncRegex = /dataset\[[^(]*\(['"`]([a-zA-Z0-9-]+)['"`]\)/g;
  while ((match = datasetBracketFuncRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match data- attributes in querySelector, getAttribute, setAttribute, hasAttribute
  const dataAttrRegex = /(?:querySelector|getAttribute|setAttribute|hasAttribute|querySelectorAll)\s*\(\s*['"`]?\[?data-([a-zA-Z0-9-]+)/g;
  while ((match = dataAttrRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  // Match data- attribute strings directly: 'data-blok-selected'
  const dataAttrStringRegex = /['"`]data-([a-zA-Z0-9-]+)['"`]/g;
  while ((match = dataAttrStringRegex.exec(strippedCode)) !== null) {
    attributes.add(`data-${match[1]}`);
  }

  return { classes: Array.from(classes), attributes: Array.from(attributes) };
}

/**
 * Scan a single file for CSS usage
 */
export async function scanFile(filePath: string): Promise<FileScanResult> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return { filePath, classes: [], attributes: [] };
    }

    // Skip binary files
    const ext = extname(filePath).toLowerCase();
    const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.html', '.css'];
    if (!textExtensions.includes(ext)) {
      return { filePath, classes: [], attributes: [] };
    }

    const content = await readFile(filePath, 'utf-8');
    const usage = findCSSUsage(content);

    return { filePath, ...usage };
  } catch {
    return { filePath, classes: [], attributes: [] };
  }
}

/**
 * Recursively scan a directory for source files
 */
async function scanDirectory(dir: string, excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build']): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (excludeDirs.includes(entry.name)) {
          continue;
        }
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, excludeDirs);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
        if (sourceExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors reading directories
  }

  return files;
}

/**
 * Scan a source directory for all CSS usage
 */
export async function scanSourceDirectory(dir: string, options: { exclude?: string[] } = {}): Promise<ScanResult> {
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', ...(options.exclude ?? [])];
  const sourceFiles = await scanDirectory(dir, excludeDirs);

  const allClasses = new Set<string>();
  const allAttributes = new Set<string>();
  const fileResults: FileScanResult[] = [];

  for (const filePath of sourceFiles) {
    const result = await scanFile(filePath);
    result.classes.forEach(c => allClasses.add(c));
    result.attributes.forEach(a => allAttributes.add(a));
    fileResults.push(result);
  }

  return {
    filesScanned: sourceFiles.length,
    allClasses: Array.from(allClasses),
    allAttributes: Array.from(allAttributes),
    fileResults,
  };
}
