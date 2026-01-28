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
 * Only extracts custom data-* attributes (not standard HTML attributes like role, contenteditable)
 * Excludes Tailwind arbitrary values like [18px]
 */
function extractAttributes(css) {
  const processed = stripComments(css);
  const attributes = new Set();
  // Match only [data-*] attribute selectors
  // Standard HTML attributes (role, contenteditable, etc.) are excluded since they're always valid
  const attrRegex = /\[(data-[a-zA-Z0-9_-]+)(?:[~|^$*]?=["'][^"']*["'])?\]/g;
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
 * Global cache for enum/union type values
 */
const enumValueCache = new Map();

/**
 * Cache for function return values that contain class names
 * Maps function name -> array of class names it can return
 */
const functionReturnCache = new Map();

/**
 * Extract string values from TypeScript type definitions and object literals
 */
function extractEnumValues(code) {
  const strippedCode = stripCodeComments(code);

  // Pattern 1: type aliases with string unions (multi-line): type Accent = 'coral' | 'green' | 'pink'
  // This regex handles multi-line type definitions
  const multiLineTypeRegex = /type\s+(\w+)\s*=\s*([^;]+);/gs;
  let match;
  while ((match = multiLineTypeRegex.exec(strippedCode)) !== null) {
    const typeName = match[1];
    const typeBody = match[2];
    const values = new Set();

    // Extract all string literals from the type definition
    const valueRegex = /['"](\w+)['"]/g;
    let valueMatch;
    while ((valueMatch = valueRegex.exec(typeBody)) !== null) {
      values.add(valueMatch[1]);
    }

    if (values.size > 0) {
      enumValueCache.set(typeName, values);
      // Also store with lowercase first letter
      const lowerFirst = typeName.charAt(0).toLowerCase() + typeName.slice(1);
      if (lowerFirst !== typeName) {
        enumValueCache.set(lowerFirst, values);
      }
    }
  }

  // Pattern 2: Interface property types - extract union types from interface properties
  // interface FeatureDetail { accent: 'coral' | 'orange' | 'pink' | ... }
  const interfaceRegex = /interface\s+(\w+)\s*\{([^}]+)\}/gs;
  while ((match = interfaceRegex.exec(strippedCode)) !== null) {
    const interfaceName = match[1];
    const interfaceBody = match[2];

    // Find property with union type: propName: 'a' | 'b' | 'c'
    const propertyUnionRegex = /(\w+)\s*:\s*(?:['"](\w+)['"](?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?(?:\s*\|\s*['"](\w+)['"])?)/g;
    let propMatch;
    while ((propMatch = propertyUnionRegex.exec(interfaceBody)) !== null) {
      const propName = propMatch[1];
      const propType = propMatch[2];
      const values = new Set();

      // Extract all string literals from the property type
      const propValueRegex = /['"](\w+)['"]/g;
      let propValueMatch;
      while ((propValueMatch = propValueRegex.exec(propType)) !== null) {
        values.add(propValueMatch[1]);
      }

      if (values.size >= 2) {
        // Store as interface.propertyName and just propertyName
        enumValueCache.set(`${interfaceName}.${propName}`, values);
        enumValueCache.set(propName, values);
      }
    }
  }

  // Pattern 3: Object property values in const arrays/objects
  // const FEATURES = [{ accent: "coral" }, { accent: "orange" }, ...]
  // const FEATURES: FeatureDetail[] = [{ accent: "coral" }, ...] (with TypeScript type annotation)
  // Note: Use balanced bracket counting to handle nested arrays/objects
  const arrayStartRegex = /const\s+(\w+)\s*(?::\s[^=]+)?\s*=\s*\[/g;
  while ((match = arrayStartRegex.exec(strippedCode)) !== null) {
    const arrayName = match[1];
    const startPos = match.index + match[0].length - 1; // Position of opening [

    // Find the matching closing bracket
    let bracketCount = 0;
    let endPos = startPos;
    for (let i = startPos; i < strippedCode.length; i++) {
      if (strippedCode[i] === '[') {
        bracketCount++;
      } else if (strippedCode[i] === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          endPos = i;
          break;
        }
      }
    }

    const arrayBody = strippedCode.substring(startPos + 1, endPos);

    // Find all property values: { propName: 'value' }
    const propValueRegex = /(\w+)\s*:\s*['"](\w+)['"]/g;
    const propertyMap = new Map();

    let propMatch;
    while ((propMatch = propValueRegex.exec(arrayBody)) !== null) {
      const propName = propMatch[1];
      const value = propMatch[2];

      if (!propertyMap.has(propName)) {
        propertyMap.set(propName, new Set());
      }
      propertyMap.get(propName).add(value);
    }

    // Store property values that have multiple options
    for (const [propName, values] of propertyMap.entries()) {
      if (values.size >= 1) {
        const key = `${arrayName}.${propName}`;
        if (!enumValueCache.has(propName)) {
          enumValueCache.set(propName, values);
        } else {
          // Merge with existing values
          const existing = enumValueCache.get(propName);
          for (const v of values) {
            existing.add(v);
          }
        }
        enumValueCache.set(key, values);
      }
    }
  }

  // Pattern 4: Extract function return values that contain class names
  // function getLinkClassName(link) { return "nav-link" + (active ? " nav-link-active" : ""); }
  // const getLinkClassName = (link: NavLink): string => { return ... }
  const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:\([^)]*\)(?:\s*:\s*[^={]+)?\s*=>|function)|(\w+)\s*\([^)]*\)\s*{)/g;
  while ((match = functionRegex.exec(strippedCode)) !== null) {
    const funcName = match[1] || match[2] || match[3];
    if (!funcName) continue;

    // Find the function body
    let funcBody = '';
    let braceCount = 0;
    let inFunc = false;
    let startIdx = match.index + match[0].length;

    for (let i = startIdx; i < strippedCode.length; i++) {
      const char = strippedCode[i];
      if (char === '{') {
        braceCount++;
        inFunc = true;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && inFunc) {
          funcBody = strippedCode.slice(startIdx, i);
          break;
        }
      }
    }

    if (!funcBody) continue;

    // First, extract local variable assignments (const/let) within the function
    // For example: const baseClass = "nav-link";
    const localVars = new Map();
    const localVarRegex = /(?:const|let)\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
    let localVarMatch;
    while ((localVarMatch = localVarRegex.exec(funcBody)) !== null) {
      localVars.set(localVarMatch[1], localVarMatch[2]);
    }

    // Extract class names from return statements
    const returnRegex = /return\s+([^;]+);/g;
    let returnMatch;
    const funcClasses = new Set();

    while ((returnMatch = returnRegex.exec(funcBody)) !== null) {
      const returnVal = returnMatch[1];

      // Match template literals with class names
      const templateRegex = /`([^`]*)`/g;
      let templateMatch;
      while ((templateMatch = templateRegex.exec(returnVal)) !== null) {
        const template = templateMatch[1];
        // Extract class names (including those in ternary expressions)
        // Handle: `${base} nav-link-active` and `${base} ${condition ? "class" : ""}`
        const ternaryRegex = /\?\s*['"](\w+)['"]\s*:/g;
        let ternaryMatch;
        while ((ternaryMatch = ternaryRegex.exec(returnVal)) !== null) {
          funcClasses.add(ternaryMatch[1]);
        }

        // Extract variable references from template and resolve them
        const varRefRegex = /\$\{(\w+)\}/g;
        let varRefMatch;
        while ((varRefMatch = varRefRegex.exec(template)) !== null) {
          const varName = varRefMatch[1];
          if (localVars.has(varName)) {
            funcClasses.add(localVars.get(varName));
          }
        }

        // Extract plain class names from template
        const plainClasses = template.replace(/\$\{[^}]*\}/g, ' ').replace(/[?:]/g, ' ');
        const classNames = plainClasses.split(/\s+/);
        for (const cn of classNames) {
          if (/^[a-zA-Z0-9_-]+$/.test(cn)) {
            funcClasses.add(cn);
          }
        }
      }

      // Match string concatenation with class names
      const stringRegex = /(['"])([a-zA-Z0-9_-]+)\1/g;
      let stringMatch;
      while ((stringMatch = stringRegex.exec(returnVal)) !== null) {
        funcClasses.add(stringMatch[2]);
      }

      // Match bare variable returns (e.g., return baseClass;)
      if (/^\s*\w+\s*$/.test(returnVal.trim())) {
        const varName = returnVal.trim();
        if (localVars.has(varName)) {
          funcClasses.add(localVars.get(varName));
        }
      }
    }

    if (funcClasses.size > 0) {
      functionReturnCache.set(funcName, Array.from(funcClasses));
    }
  }
}

/**
 * Get possible values for a variable name from the enum cache
 */
function getEnumValues(varName) {
  const values = new Set();

  // Direct match
  if (enumValueCache.has(varName)) {
    return enumValueCache.get(varName);
  }

  // Try with different case variations
  const camelCase = varName.charAt(0).toLowerCase() + varName.slice(1);
  if (enumValueCache.has(camelCase)) {
    return enumValueCache.get(camelCase);
  }

  const PascalCase = varName.charAt(0).toUpperCase() + varName.slice(1);
  if (enumValueCache.has(PascalCase)) {
    return enumValueCache.get(PascalCase);
  }

  // Try without common suffixes
  for (const suffix of ['Type', 'Variant', 'Option', 'Mode', 'Style']) {
    const baseName = varName.replace(new RegExp(suffix + '$'), '');
    if (enumValueCache.has(baseName)) {
      return enumValueCache.get(baseName);
    }
    if (enumValueCache.has(baseName + suffix)) {
      return enumValueCache.get(baseName + suffix);
    }
  }

  return values;
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

  // Match className attribute with quoted strings
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
    // Save original template content for later regex processing
    // Must be saved here because 'match' gets overwritten by inner loops
    const originalTemplate = match[1];
    // Extract class names from template literal
    let templateContent = originalTemplate;

    // First, extract string literals inside ${} expressions (e.g., ${"copied"})
    const templateExprRegex = /\$\{[^}]*(["'])([a-zA-Z0-9_-]+)\1[^}]*\}/g;
    let exprMatch;
    while ((exprMatch = templateExprRegex.exec(templateContent)) !== null) {
      classes.add(exprMatch[2]);
    }

    // NEW: Extract variable names from ${} expressions for dynamic class generation
    // Patterns: `${variant}-class`, `class-${variant}`, `${accent}`, `${feature.accent}`, `${release.releaseType}`
    const varRegex = /\$\{([a-zA-Z0-9_.]+)\}/g;
    const foundVars = []; // Store both full var path and simple name
    let varMatch;
    // Reset regex for the template content
    varRegex.lastIndex = 0;
    while ((varMatch = varRegex.exec(templateContent)) !== null) {
      const varPath = varMatch[1];
      const lastPart = varPath.includes('.') ? varPath.split('.').pop() : varPath;
      foundVars.push({ full: varMatch[0], name: lastPart });
    }

    // For each variable found, check if we have enum values and generate class combinations
    for (const { full: fullVar, name: varName } of foundVars) {
      const possibleValues = getEnumValues(varName);
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

    // Extract class names from ternary expressions in templates
    // Pattern: `${cond ? 'class1' : 'class2'}` or `${cond ? 'class' : ''} ${'other'}`
    // Also handles: `${index === 0 ? ' feature-card--featured' : ''}` where class has leading space
    const ternaryInTemplateRegex = /\?\s*['"]([a-zA-Z0-9_-]+)['"]\s*:/g;
    let ternaryMatch;
    while ((ternaryMatch = ternaryInTemplateRegex.exec(originalTemplate)) !== null) {
      classes.add(ternaryMatch[1]);
    }

    // Extract all string literals from templates (catches classes with leading/trailing spaces in ternary)
    // Pattern: ' class-name' or 'class-name ' inside ternary expressions
    const hyphenatedClassRegex = /['"]\s*([a-zA-Z0-9_-]+)['"]/g;
    let hyphenMatch;
    while ((hyphenMatch = hyphenatedClassRegex.exec(originalTemplate)) !== null) {
      classes.add(hyphenMatch[1]);
    }
  }

  // Match className with function calls: className={getLinkClassName(link)}
  const classNameFuncRegex = /className\s*=\s*\{([a-zA-Z0-9_]+)\([^)]*\)\}/g;
  while ((match = classNameFuncRegex.exec(strippedCode)) !== null) {
    const funcName = match[1];
    if (functionReturnCache.has(funcName)) {
      const funcClasses = functionReturnCache.get(funcName);
      for (const cls of funcClasses) {
        classes.add(cls);
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
  // This catches classes exported via API
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
async function scanDirectory(dir, excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static']) {
  const files = [];
  // Exclude by path pattern (for nested paths)
  const excludePathPatterns = ['test/unit/scripts/blok-master', 'docs/dist'];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip if path matches any exclusion pattern
      if (shouldExcludePath(fullPath, excludePathPatterns)) {
        continue;
      }

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
 * Check if a path should be excluded
 */
function shouldExcludePath(fullPath, excludePatterns) {
  for (const pattern of excludePatterns) {
    if (fullPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all CSS files in a directory
 */
async function findCSSFiles(dir, extensions = ['.css']) {
  const files = [];
  // Exclude by directory name
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static'];
  // Exclude by path pattern (for nested paths)
  const excludePathPatterns = ['test/unit/scripts/blok-master', 'docs/dist'];

  async function scan(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Skip if path matches any exclusion pattern
      if (shouldExcludePath(fullPath, excludePathPatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
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

  // Pass 1: Extract enum/type values from all files first
  // This is needed because template literals in one file may reference types defined in another
  console.error('  Extracting type definitions...');
  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      extractEnumValues(content);
    } catch {
      // Skip files that can't be read
    }
  }

  // Pass 2: Scan for CSS usage (now that we have the enum cache populated)
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
