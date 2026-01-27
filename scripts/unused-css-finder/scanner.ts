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

export interface ScanResult {
  filesScanned: number;
  allClasses: string[];
  allAttributes: string[];
  fileResults: FileScanResult[];
}

/**
 * Store for enum/union type values found during scanning
 * Maps variable names to their possible string values
 */
const enumValueCache = new Map<string, Set<string>>();

/**
 * Clear the enum value cache (useful for testing)
 */
export function clearEnumValueCache(): void {
  enumValueCache.clear();
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
 * Extract string values from TypeScript type definitions and object literals
 * This captures:
 * - type aliases with string union types: type Color = 'red' | 'blue' | 'green'
 * - interface properties with string literals: { accent: 'coral' }
 * - Record/Map type definitions: Record<string, 'a' | 'b'>
 * - const objects with string literal properties: const COLORS = { red: 'red', blue: 'blue' }
 */
export function extractEnumValues(code: string): Map<string, Set<string>> {
  const enumValues = new Map<string, Set<string>>();
  const strippedCode = stripComments(code);

  // Pattern 1: type aliases with string unions: type Accent = 'coral' | 'green' | 'pink'
  const typeAliasRegex = /type\s+(\w+)\s*=\s*(['"])(\w+)\2(?:\s*\|\s*\2(\w+)\2)*/g;
  let match;
  while ((match = typeAliasRegex.exec(strippedCode)) !== null) {
    const typeName = match[1];
    const values = new Set<string>();
    // Re-parse the whole type definition to get all values
    const typeDefRegex = new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`);
    const typeDefMatch = strippedCode.match(typeDefRegex);
    if (typeDefMatch) {
      const valuesStr = typeDefMatch[1];
      const valueRegex = /['"](\w+)['"]/g;
      let valueMatch;
      while ((valueMatch = valueRegex.exec(valuesStr)) !== null) {
        values.add(valueMatch[1]);
      }
    }
    if (values.size > 0) {
      enumValues.set(typeName, values);
      // Also store with lowercase first letter (common pattern)
      const lowerFirst = typeName.charAt(0).toLowerCase() + typeName.slice(1);
      if (lowerFirst !== typeName) {
        enumValues.set(lowerFirst, values);
      }
    }
  }

  // Pattern 2: Generic type unions: type T = 'a' | 'b' (already handled above)
  // But also look for: type Variant = 'soft' | 'layered'
  const unionTypeRegex = /type\s+(\w+)\s*=\s*(?:[^=;]*?\|\s*)?['"](\w+)['"](?:\s*\|\s*['"](\w+)['"])?/g;
  while ((match = unionTypeRegex.exec(strippedCode)) !== null) {
    const typeName = match[1];
    const values = new Set<string>();
    // Find the full type definition
    const fullTypeDefRegex = new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`);
    const fullMatch = strippedCode.match(fullTypeDefRegex);
    if (fullMatch) {
      const allValues = fullMatch[1].match(/['"](\w+)['"]/g);
      if (allValues) {
        allValues.forEach(v => {
          const val = v.replace(/['"]/g, '');
          values.add(val);
        });
      }
    }
    if (values.size > 0) {
      enumValues.set(typeName, values);
    }
  }

  // Pattern 3: Object/Record properties with string literals: { accent: 'coral', color: 'blue' }
  // This catches patterns like: { accent: "coral" } in arrays of objects
  const objPropertyRegex = /(\w+)\s*:\s*['"](\w+)['"]/g;
  const propertyMap = new Map<string, Set<string>>();
  while ((match = objPropertyRegex.exec(strippedCode)) !== null) {
    const propName = match[1];
    const value = match[2];
    if (!propertyMap.has(propName)) {
      propertyMap.set(propName, new Set());
    }
    propertyMap.get(propName)!.add(value);
  }

  // Merge property values into enumValues
  for (const [propName, values] of propertyMap.entries()) {
    // Check if this looks like an enum property (appears multiple times with different values)
    if (values.size >= 2) {
      enumValues.set(propName, values);
      // Also store with common plural/singular variants
      if (propName.endsWith('s')) {
        const singular = propName.slice(0, -1);
        enumValues.set(singular, values);
      }
    }
  }

  // Pattern 4: const objects with literal properties: const WAVE_PATHS: Record<Variant, string> = { ... }
  // Or: const OPTIONS = { soft: '...', layered: '...' }
  const constObjectRegex = /const\s+(\w+)\s*[=:]\s*\{([^}]+)\}/g;
  while ((match = constObjectRegex.exec(strippedCode)) !== null) {
    const objName = match[1];
    const body = match[2];
    const keys = new Set<string>();
    // Extract keys from: key: 'value' or key: "value" or just key,
    const keyRegex = /(\w+)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyRegex.exec(body)) !== null) {
      keys.add(keyMatch[1]);
    }
    if (keys.size > 0) {
      enumValues.set(objName, keys);
    }
  }

  // Pattern 5: ReleaseType enum from changelog-parser - special case for "major" | "minor" | "patch"
  const releaseTypeRegex = /type\s+ReleaseType\s*=\s*([^;]+);/;
  const releaseTypeMatch = strippedCode.match(releaseTypeRegex);
  if (releaseTypeMatch) {
    const values = new Set<string>();
    const valueMatches = releaseTypeMatch[1].match(/['"](\w+)['"]/g);
    if (valueMatches) {
      valueMatches.forEach(v => {
        const val = v.replace(/['"]/g, '');
        values.add(val);
      });
    }
    if (values.size > 0) {
      enumValues.set('ReleaseType', values);
      enumValues.set('releaseType', values); // lowercase for property names
    }
  }

  // Pattern 6: WaveVariant type - special case for wave divider variants
  const waveVariantRegex = /type\s+WaveVariant\s*=\s*([^;]+);/;
  const waveVariantMatch = strippedCode.match(waveVariantRegex);
  if (waveVariantMatch) {
    const values = new Set<string>();
    const valueMatches = waveVariantMatch[1].match(/['"](\w+)['"]/g);
    if (valueMatches) {
      valueMatches.forEach(v => {
        const val = v.replace(/['"]/g, '');
        values.add(val);
      });
    }
    if (values.size > 0) {
      enumValues.set('WaveVariant', values);
      enumValues.set('variant', values); // lowercase for property names
    }
  }

  // Pattern 7: SidebarVariant type
  const sidebarVariantRegex = /type\s+SidebarVariant\s*=\s*([^;]+);/;
  const sidebarVariantMatch = strippedCode.match(sidebarVariantRegex);
  if (sidebarVariantMatch) {
    const values = new Set<string>();
    const valueMatches = sidebarVariantMatch[1].match(/['"](\w+)['"]/g);
    if (valueMatches) {
      valueMatches.forEach(v => {
        const val = v.replace(/['"]/g, '');
        values.add(val);
      });
    }
    if (values.size > 0) {
      enumValues.set('SidebarVariant', values);
      // Merge with existing variant values if any
      if (enumValues.has('variant')) {
        const existing = enumValues.get('variant')!;
        for (const v of values) {
          existing.add(v);
        }
      } else {
        enumValues.set('variant', values);
      }
    }
  }

  // Store all found enum values in the global cache
  for (const [key, values] of enumValues.entries()) {
    if (!enumValueCache.has(key)) {
      enumValueCache.set(key, values);
    } else {
      // Merge with existing values
      const existing = enumValueCache.get(key)!;
      for (const v of values) {
        existing.add(v);
      }
    }
  }

  return enumValues;
}

/**
 * Get possible values for a variable name from the enum cache
 */
function getPossibleValues(varName: string): Set<string> {
  const values = new Set<string>();

  // Direct match
  if (enumValueCache.has(varName)) {
    return enumValueCache.get(varName)!;
  }

  // Try with different case variations
  const camelCase = varName.charAt(0).toLowerCase() + varName.slice(1);
  if (enumValueCache.has(camelCase)) {
    return enumValueCache.get(camelCase)!;
  }

  const PascalCase = varName.charAt(0).toUpperCase() + varName.slice(1);
  if (enumValueCache.has(PascalCase)) {
    return enumValueCache.get(PascalCase)!;
  }

  // Try without common suffixes
  for (const suffix of ['Type', 'Variant', 'Option', 'Mode', 'Style']) {
    const baseName = varName.replace(new RegExp(suffix + '$'), '');
    if (enumValueCache.has(baseName)) {
      return enumValueCache.get(baseName)!;
    }
    if (enumValueCache.has(baseName + suffix)) {
      return enumValueCache.get(baseName + suffix)!;
    }
  }

  return values;
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

  // Match className in template literals: className={`class1 ${var} class2`}
  // Also handles: className={`${variant}-sidebar`} and className={`class-${variant}`}
  const classNameTemplateRegex = /className\s*=\s*{`([^`]+)`}/g;
  while ((match = classNameTemplateRegex.exec(strippedCode)) !== null) {
    // Extract class names from template literal
    let templateContent = match[1];

    // First, extract string literals inside ${} expressions (e.g., ${"copied"})
    const templateExprRegex = /\$\{[^}]*(["'])([a-zA-Z0-9_-]+)\1[^}]*\}/g;
    let exprMatch;
    while ((exprMatch = templateExprRegex.exec(templateContent)) !== null) {
      classes.add(exprMatch[2]);
    }

    // NEW: Extract variable names from ${} expressions for dynamic class generation
    // Patterns: `${variant}-class`, `class-${variant}`, `${accent}`, `${feature.accent}`, `${release.releaseType}`
    const varRegex = /\$\{([a-zA-Z0-9_.]+)\}/g;
    const foundVars: Array<{ full: string; name: string }> = []; // Store both full var path and simple name
    let varMatch;
    // Reset regex for the template content
    varRegex.lastIndex = 0;
    while ((varMatch = varRegex.exec(templateContent)) !== null) {
      const varPath = varMatch[1];
      const lastPart = varPath.includes('.') ? varPath.split('.').pop()! : varPath;
      foundVars.push({ full: varMatch[0], name: lastPart });
    }

    // For each variable found, check if we have enum values and generate class combinations
    for (const { full: fullVar, name: varName } of foundVars) {
      const possibleValues = getPossibleValues(varName);
      if (possibleValues.size > 0) {
        // Escape the full variable for regex (contains ${} and . which are special chars)
        const escapedVar = fullVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Check for suffix pattern: `prefix-${var}` or `prefix--${var}`
        // Match any word characters + hyphen before the variable
        const suffixMatch = templateContent.match(new RegExp(`([a-zA-Z0-9_-]+)-` + escapedVar));
        if (suffixMatch) {
          for (const value of possibleValues) {
            classes.add(`${suffixMatch[1]}-${value}`);
          }
        }

        // Check for prefix pattern: `${var}-suffix`
        const prefixMatch = templateContent.match(new RegExp(escapedVar + `-([a-zA-Z0-9_-]+)`));
        if (prefixMatch) {
          for (const value of possibleValues) {
            classes.add(`${value}-${prefixMatch[1]}`);
          }
        }

        // Also add just the values (for cases like bare variable usage)
        for (const value of possibleValues) {
          classes.add(value);
        }
      }
    }

    // Then replace ${} expressions with spaces and extract remaining class names
    templateContent = templateContent.replace(/\$\{[^}]*\}/g, ' ');
    const classNames = templateContent.split(/\s+/);
    for (const className of classNames) {
      if (/^[a-zA-Z0-9_-]+$/.test(className)) {
        classes.add(className);
      }
    }
  }

  // Match CSS module patterns: styles['class-name'] and styles.className
  // This handles React CSS modules
  const cssModuleBracketRegex = /(?:\w+|\.\.\.\w+)\[['"`]([a-zA-Z0-9_-]+)['"`]\]/g;
  while ((match = cssModuleBracketRegex.exec(strippedCode)) !== null) {
    classes.add(match[1]);
  }
  const cssModuleDotRegex = /(\w+)\.([a-zA-Z0-9_-]+)/g;
  while ((match = cssModuleDotRegex.exec(strippedCode)) !== null) {
    // Only if it looks like a styles object (common naming patterns)
    const objName = match[1];
    if (objName.endsWith('styles') || objName.endsWith('Styles') || objName.endsWith('css') || objName.endsWith('Css')) {
      classes.add(match[2]);
    }
  }

  // Match string literals in object properties like: block: 'blok-block', button: 'blok-button'
  // This catches classes exported via API for external tool authors
  const propertyStringRegex = /(?:\w+)\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
  while ((match = propertyStringRegex.exec(strippedCode)) !== null) {
    classes.add(match[1]);
  }

  // Match string literals in array literals: ["class1", "class2", condition && "class3"]
  // This catches patterns like: const classes = ["nav", scrolled ? "scrolled" : ""]
  const arrayStringRegex = /['"`]([a-zA-Z0-9_-]+)['"`]/g;
  while ((match = arrayStringRegex.exec(strippedCode)) !== null) {
    // Check if we're inside an array context by counting brackets
    // Look back from the match position to find if there's an unclosed [
    let bracketCount = 0;
    let inArray = false;
    for (let i = match.index - 1; i >= Math.max(0, match.index - 200); i--) {
      const char = strippedCode[i];
      if (char === ']') {
        bracketCount++;
      } else if (char === '[') {
        bracketCount--;
        if (bracketCount < 0) {
          // Found an unclosed [ before this string
          inArray = true;
          break;
        }
      }
    }
    if (inArray) {
      classes.add(match[1]);
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
async function scanDirectory(dir: string, excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static']): Promise<string[]> {
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
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', ...(options.exclude ?? [])];
  const sourceFiles = await scanDirectory(dir, excludeDirs);

  // Pass 1: Extract enum/type values from all files first
  // This is needed because template literals in one file may reference types defined in another
  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      extractEnumValues(content);
    } catch {
      // Skip files that can't be read
    }
  }

  // Pass 2: Scan for CSS usage (now that we have the enum cache populated)
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
