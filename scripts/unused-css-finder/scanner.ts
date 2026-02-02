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
 * Collect all matches from a regex against a string
 */
const allMatches = (regex: RegExp, text: string): RegExpExecArray[] => {
  const results: RegExpExecArray[] = [];
  for (;;) {
    const m = regex.exec(text);
    if (!m) break;
    results.push(m);
  }
  return results;
};

/**
 * Store for enum/union type values found during scanning
 */
const enumValueCache = new Map<string, Set<string>>();

/**
 * Cache for function return values that contain class names
 */
const functionReturnCache = new Map<string, string[]>();

/**
 * Clear the enum value cache (useful for testing)
 */
export const clearEnumValueCache = (): void => {
  enumValueCache.clear();
  functionReturnCache.clear();
};

/**
 * Get the function return cache (for testing)
 */
export const getFunctionReturnCache = (): Map<string, string[]> => {
  return functionReturnCache;
};

/**
 * Remove single-line comments and multi-line comments
 */
const stripComments = (code: string): string => {
  const withoutMultiLine = code.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutMultiLine.replace(/(?<!:)\/\/.*$/gm, '');
};

/**
 * Merge values into a map entry, creating the entry if it doesn't exist
 */
const mergeIntoMap = (map: Map<string, Set<string>>, key: string, values: Set<string>): void => {
  const existing = map.get(key);
  if (existing) {
    for (const v of values) {
      existing.add(v);
    }
  } else {
    map.set(key, values);
  }
};

/**
 * Extract string literal values from text
 */
const extractStringLiterals = (text: string): Set<string> => {
  const values = new Set<string>();
  for (const m of allMatches(/['"](\w+)['"]/g, text)) {
    values.add(m[1]);
  }
  return values;
};

/**
 * Extract values from a named type pattern like `type TypeName = 'a' | 'b'`
 */
const extractNamedTypeValues = (strippedCode: string, typeName: string): Set<string> => {
  const regex = new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`);
  const match = strippedCode.match(regex);
  if (!match) {
    return new Set<string>();
  }

  const values = new Set<string>();
  const valueMatches = match[1].match(/['"](\w+)['"]/g);
  if (valueMatches) {
    valueMatches.forEach(v => {
      values.add(v.replace(/['"]/g, ''));
    });
  }
  return values;
};

interface BraceState {
  braceCount: number;
  inBlock: boolean;
  endIdx: number;
}

/**
 * Scan characters to find the end of a brace-delimited block
 */
const findBraceEndIdx = (chars: string[], initialState: BraceState): BraceState => {
  return chars.reduce<BraceState>((state, char, idx) => {
    if (state.endIdx >= 0) return state;
    if (char === '{') {
      return { braceCount: state.braceCount + 1, inBlock: true, endIdx: -1 };
    }
    if (char === '}' && state.braceCount === 0 && state.inBlock) {
      return { ...state, endIdx: idx };
    }
    if (char === '}') {
      return { ...state, braceCount: state.braceCount - 1 };
    }
    return state;
  }, initialState);
};

/**
 * Find the body of a brace-delimited block starting after the opening brace
 */
const findBraceBody = (code: string, startIdx: number): string => {
  const chars = [...code.slice(startIdx)];
  const result = findBraceEndIdx(chars, { braceCount: 0, inBlock: false, endIdx: -1 });
  if (result.endIdx < 0) return '';
  return code.slice(startIdx, startIdx + result.endIdx);
};

/**
 * Extract multi-line type aliases with string unions
 */
const extractTypeAliases = (strippedCode: string, enumValues: Map<string, Set<string>>): void => {
  for (const match of allMatches(/type\s+(\w+)\s*=\s*([\s\S]+?);/g, strippedCode)) {
    const typeName = match[1];
    const typeBody = match[2];
    const values = extractStringLiterals(typeBody);

    if (values.size === 0) continue;

    enumValues.set(typeName, values);
    const lowerFirst = typeName.charAt(0).toLowerCase() + typeName.slice(1);
    if (lowerFirst !== typeName) {
      enumValues.set(lowerFirst, values);
    }
  }
};

/**
 * Extract union type property values from an interface body
 */
const extractInterfacePropertyUnions = (
  interfaceBody: string,
  interfaceName: string,
  enumValues: Map<string, Set<string>>,
): void => {
  const regex = /(\w+)\s*:\s*(?:[^=;{}]*?['"][\w]+['"][^=;{}]*?(?:\|\s*['"][\w]+['"][^=;{}]*?)+)/g;
  for (const propMatch of allMatches(regex, interfaceBody)) {
    const propName = propMatch[1];
    const propType = propMatch[2];
    const values = extractStringLiterals(propType);

    if (values.size < 2) continue;

    enumValues.set(`${interfaceName}.${propName}`, values);
    mergeIntoMap(enumValues, propName, values);
  }
};

/**
 * Extract interface property types
 */
const extractInterfaceProperties = (strippedCode: string, enumValues: Map<string, Set<string>>): void => {
  for (const interfaceMatch of allMatches(/interface\s+(\w+)\s*\{/g, strippedCode)) {
    const interfaceName = interfaceMatch[1];
    const startIdx = interfaceMatch.index + interfaceMatch[0].length;
    const interfaceBody = findBraceBody(strippedCode, startIdx);

    if (!interfaceBody) continue;

    extractInterfacePropertyUnions(interfaceBody, interfaceName, enumValues);
  }
};

/**
 * Add value to a property map, creating the set if needed
 */
const addToPropertyMap = (propertyMap: Map<string, Set<string>>, key: string, value: string): void => {
  const propSet = propertyMap.get(key);
  if (propSet) {
    propSet.add(value);
  } else {
    propertyMap.set(key, new Set([value]));
  }
};

/**
 * Process a single array-of-objects match and merge into enumValues
 */
const processArrayMatch = (arrayName: string, arrayBody: string, enumValues: Map<string, Set<string>>): void => {
  const propertyMap = new Map<string, Set<string>>();

  for (const propMatch of allMatches(/(\w+)\s*:\s*['"](\w+)['"]/g, arrayBody)) {
    addToPropertyMap(propertyMap, propMatch[1], propMatch[2]);
  }

  for (const [propName, values] of propertyMap.entries()) {
    if (values.size < 1) continue;
    mergeIntoMap(enumValues, propName, values);
    enumValues.set(`${arrayName}.${propName}`, values);
  }
};

/**
 * Extract property values from arrays of objects
 */
const extractArrayObjectProperties = (strippedCode: string, enumValues: Map<string, Set<string>>): void => {
  for (const match of allMatches(/const\s+(\w+)\s*=\s*\[([\s\S]*?)\]/g, strippedCode)) {
    processArrayMatch(match[1], match[2], enumValues);
  }
};

/**
 * Extract object property values as potential enum values
 */
const extractObjectPropertyValues = (strippedCode: string, enumValues: Map<string, Set<string>>): void => {
  const propertyMap = new Map<string, Set<string>>();
  for (const match of allMatches(/(\w+)\s*:\s*['"](\w+)['"]/g, strippedCode)) {
    addToPropertyMap(propertyMap, match[1], match[2]);
  }

  for (const [propName, values] of propertyMap.entries()) {
    if (values.size < 2) continue;
    enumValues.set(propName, values);
    if (propName.endsWith('s')) {
      enumValues.set(propName.slice(0, -1), values);
    }
  }
};

/**
 * Extract const object keys as potential enum values
 */
const extractConstObjectKeys = (strippedCode: string, enumValues: Map<string, Set<string>>): void => {
  for (const match of allMatches(/const\s+(\w+)\s*[=:]\s*\{([^}]+)\}/g, strippedCode)) {
    const objName = match[1];
    const body = match[2];
    const keys = new Set<string>();
    for (const keyMatch of allMatches(/(\w+)\s*:/g, body)) {
      keys.add(keyMatch[1]);
    }
    if (keys.size > 0) {
      enumValues.set(objName, keys);
    }
  }
};

/**
 * Store named type values and merge with variant cache
 */
const storeNamedTypeWithVariant = (
  strippedCode: string,
  typeName: string,
  enumValues: Map<string, Set<string>>,
): void => {
  const values = extractNamedTypeValues(strippedCode, typeName);
  if (values.size === 0) return;

  enumValues.set(typeName, values);
  enumValues.set(typeName.charAt(0).toLowerCase() + typeName.slice(1), values);
  mergeIntoMap(enumValues, 'variant', values);
};

/**
 * Extract string values from TypeScript type definitions and object literals
 */
export const extractEnumValues = (code: string): Map<string, Set<string>> => {
  const enumValues = new Map<string, Set<string>>();
  const strippedCode = stripComments(code);

  extractTypeAliases(strippedCode, enumValues);
  extractInterfaceProperties(strippedCode, enumValues);
  extractArrayObjectProperties(strippedCode, enumValues);
  extractObjectPropertyValues(strippedCode, enumValues);
  extractConstObjectKeys(strippedCode, enumValues);

  const releaseValues = extractNamedTypeValues(strippedCode, 'ReleaseType');
  if (releaseValues.size > 0) {
    enumValues.set('ReleaseType', releaseValues);
    enumValues.set('releaseType', releaseValues);
  }

  storeNamedTypeWithVariant(strippedCode, 'WaveVariant', enumValues);
  storeNamedTypeWithVariant(strippedCode, 'SidebarVariant', enumValues);

  for (const [key, values] of enumValues.entries()) {
    mergeIntoMap(enumValueCache, key, values);
  }

  return enumValues;
};

/**
 * Extract class names from template literal content
 */
const extractClassesFromTemplate = (template: string): string[] => {
  const plainClasses = template.replace(/\$\{[^}]*\}/g, ' ').replace(/[?:]/g, ' ');
  return plainClasses.split(/\s+/).filter(cn => /^[a-zA-Z0-9_-]+$/.test(cn));
};

/**
 * Extract class names from a single return value expression
 */
const extractClassesFromReturnValue = (returnVal: string, funcClasses: Set<string>): void => {
  for (const m of allMatches(/\?\s*['"]([a-zA-Z0-9_-]+)['"]\s*:/g, returnVal)) {
    funcClasses.add(m[1]);
  }

  for (const m of allMatches(/['"]([a-zA-Z0-9_-]+)['"]/g, returnVal)) {
    funcClasses.add(m[1]);
  }

  for (const m of allMatches(/`([^`]*)`/g, returnVal)) {
    extractClassesFromTemplate(m[1]).forEach(cn => funcClasses.add(cn));
  }
};

/**
 * Helper: Extract class names from return statements in a function body
 */
const extractClassesFromReturns = (funcBody: string): Set<string> => {
  const funcClasses = new Set<string>();

  for (const returnMatch of allMatches(/return\s+([^;]+);/g, funcBody)) {
    extractClassesFromReturnValue(returnMatch[1], funcClasses);
  }

  return funcClasses;
};

/**
 * Process a closing brace in function body scanning
 */
const processClosingBrace = (
  state: { braceCount: number; inFunc: boolean; endIdx: number },
  idx: number,
): { braceCount: number; inFunc: boolean; endIdx: number } => {
  const newCount = state.braceCount - 1;
  if (newCount === 0 && state.inFunc) {
    return { ...state, endIdx: idx };
  }
  return { ...state, braceCount: newCount };
};

/**
 * Find function body starting from after the opening brace.
 * Unlike findBraceBody, this counts the first { as entering the function.
 */
const findFunctionBody = (code: string, startIdx: number): string => {
  const chars = [...code.slice(startIdx)];
  const result = chars.reduce<{ braceCount: number; inFunc: boolean; endIdx: number }>((state, char, idx) => {
    if (state.endIdx >= 0) return state;
    if (char === '{') {
      return { braceCount: state.braceCount + 1, inFunc: true, endIdx: -1 };
    }
    if (char === '}') {
      return processClosingBrace(state, idx);
    }
    return state;
  }, { braceCount: 0, inFunc: false, endIdx: -1 });

  if (result.endIdx < 0) return '';
  return code.slice(startIdx, startIdx + result.endIdx);
};

/**
 * Find the opening brace index for an arrow function body
 */
const findArrowFunctionBraceStart = (code: string, afterArrow: number): number => {
  const searchWindow = code.slice(afterArrow, afterArrow + 50);
  const braceIdx = searchWindow.indexOf('{');
  if (braceIdx === -1) return -1;
  return afterArrow + braceIdx + 1;
};

/**
 * Store function classes in the global cache
 */
const storeFunctionClasses = (funcName: string, classes: string[]): void => {
  const existing = functionReturnCache.get(funcName);
  if (!existing) {
    functionReturnCache.set(funcName, classes);
  } else {
    functionReturnCache.set(funcName, [...new Set([...existing, ...classes])]);
  }
};

/**
 * Extract function return values that contain class names
 */
export const extractFunctionReturns = (code: string): Map<string, string[]> => {
  const funcReturns = new Map<string, string[]>();
  const strippedCode = stripComments(code);

  for (const match of allMatches(/function\s+(\w+)\s*\([^)]*\)\s*\{/g, strippedCode)) {
    const funcName = match[1];
    const funcBody = findFunctionBody(strippedCode, match.index + match[0].length);
    if (!funcBody) continue;

    const funcClasses = extractClassesFromReturns(funcBody);
    if (funcClasses.size > 0) {
      funcReturns.set(funcName, Array.from(funcClasses));
    }
  }

  for (const match of allMatches(/const\s+(\w+)\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\))\s*=>/g, strippedCode)) {
    const funcName = match[1];
    const braceStart = findArrowFunctionBraceStart(strippedCode, match.index + match[0].length);
    if (braceStart === -1) continue;

    const funcBody = findFunctionBody(strippedCode, braceStart);
    if (!funcBody) continue;

    const funcClasses = extractClassesFromReturns(funcBody);
    if (funcClasses.size > 0) {
      funcReturns.set(funcName, Array.from(funcClasses));
    }
  }

  for (const [funcName, classes] of funcReturns.entries()) {
    storeFunctionClasses(funcName, classes);
  }

  return funcReturns;
};

/**
 * Get possible values for a variable name from the enum cache
 */
const getPossibleValues = (varName: string): Set<string> => {
  const direct = enumValueCache.get(varName);
  if (direct) return direct;

  const camelCase = varName.charAt(0).toLowerCase() + varName.slice(1);
  const camelResult = enumValueCache.get(camelCase);
  if (camelResult) return camelResult;

  const pascalCase = varName.charAt(0).toUpperCase() + varName.slice(1);
  const pascalResult = enumValueCache.get(pascalCase);
  if (pascalResult) return pascalResult;

  for (const suffix of ['Type', 'Variant', 'Option', 'Mode', 'Style']) {
    const baseName = varName.replace(new RegExp(suffix + '$'), '');
    const baseResult = enumValueCache.get(baseName);
    if (baseResult) return baseResult;
    const withSuffix = enumValueCache.get(baseName + suffix);
    if (withSuffix) return withSuffix;
  }

  return new Set<string>();
};

/**
 * Add classes from classList method calls
 */
const extractClassListUsage = (strippedCode: string, classes: Set<string>): void => {
  for (const m of allMatches(/classList\.(add|remove|toggle|contains)\s*\(\s*(['"`])([a-zA-Z0-9_-]+)\2/g, strippedCode)) {
    classes.add(m[3]);
  }
};

/**
 * Add classes from className attribute assignments
 */
const extractClassNameAttr = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/className\s*=\s*{?\s*(['"`])([^'"`]*?[a-zA-Z0-9_-]+[^'"`]*)\1/g, strippedCode)) {
    const classNames = match[2].split(/\s+/);
    classNames
      .filter(cn => /^[a-zA-Z0-9_-]+$/.test(cn))
      .forEach(cn => classes.add(cn));
  }
};

/**
 * Generate dynamic class names from template variable and enum values for suffix patterns
 */
const generateSuffixClasses = (
  templateContent: string,
  escapedVar: string,
  possibleValues: Set<string>,
  classes: Set<string>,
): void => {
  for (const suffixMatch of allMatches(new RegExp(`([a-zA-Z0-9_-]+)-` + escapedVar, 'g'), templateContent)) {
    for (const value of possibleValues) {
      classes.add(`${suffixMatch[1]}-${value}`);
    }
  }
};

/**
 * Generate dynamic class names from template variable and enum values for prefix patterns
 */
const generatePrefixClasses = (
  templateContent: string,
  escapedVar: string,
  possibleValues: Set<string>,
  classes: Set<string>,
): void => {
  for (const prefixMatch of allMatches(new RegExp(escapedVar + `-([a-zA-Z0-9_-]+)`, 'g'), templateContent)) {
    for (const value of possibleValues) {
      classes.add(`${value}-${prefixMatch[1]}`);
    }
  }
};

/**
 * Generate dynamic class names from template variable and enum values
 */
const generateDynamicClasses = (
  templateContent: string,
  foundVars: Array<{ full: string; name: string }>,
  classes: Set<string>,
): void => {
  for (const { full: fullVar, name: varName } of foundVars) {
    const possibleValues = getPossibleValues(varName);
    if (possibleValues.size === 0) continue;

    const escapedVar = fullVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    generateSuffixClasses(templateContent, escapedVar, possibleValues, classes);
    generatePrefixClasses(templateContent, escapedVar, possibleValues, classes);

    for (const value of possibleValues) {
      classes.add(value);
    }
  }
};

/**
 * Extract variables from template literal expressions
 */
const extractTemplateVars = (templateContent: string): Array<{ full: string; name: string }> => {
  return allMatches(/\$\{([a-zA-Z0-9_.]+)\}/g, templateContent).map(varMatch => {
    const varPath = varMatch[1];
    const parts = varPath.split('.');
    return { full: varMatch[0], name: parts[parts.length - 1] };
  });
};

/**
 * Extract string literals and ternary class names from template content
 */
const extractStringsFromTemplate = (originalTemplate: string, classes: Set<string>): void => {
  for (const m of allMatches(/\?\s*['"]([a-zA-Z0-9_-]+)['"]\s*:/g, originalTemplate)) {
    classes.add(m[1]);
  }

  for (const m of allMatches(/['"]([a-zA-Z0-9_-]+)['"]/g, originalTemplate)) {
    classes.add(m[1]);
  }

  for (const m of allMatches(/['"]\s*([a-zA-Z0-9_-]+)['"]/g, originalTemplate)) {
    classes.add(m[1]);
  }
};

/**
 * Process a className template literal match
 */
const processClassNameTemplate = (templateContent: string, classes: Set<string>): void => {
  const originalTemplate = templateContent;

  for (const exprMatch of allMatches(/\$\{[^}]*(["'])([a-zA-Z0-9_-]+)\1[^}]*\}/g, templateContent)) {
    classes.add(exprMatch[2]);
  }

  const foundVars = extractTemplateVars(templateContent);
  generateDynamicClasses(templateContent, foundVars, classes);

  const cleaned = templateContent.replace(/\$\{[^}]*\}/g, ' ');
  cleaned.split(/\s+/)
    .filter(cn => /^[a-zA-Z0-9_-]+$/.test(cn))
    .forEach(cn => classes.add(cn));

  extractStringsFromTemplate(originalTemplate, classes);
};

/**
 * Add classes from className template literals
 */
const extractClassNameTemplates = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/className\s*=\s*{`([^`]+)`}/g, strippedCode)) {
    processClassNameTemplate(match[1], classes);
  }
};

/**
 * Add classes from className function calls
 */
const extractClassNameFuncCalls = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/className\s*=\s*\{([a-zA-Z0-9_]+)\([^)]*\)\}/g, strippedCode)) {
    const funcClasses = functionReturnCache.get(match[1]);
    if (!funcClasses) continue;
    for (const cls of funcClasses) {
      classes.add(cls);
    }
  }
};

/**
 * Add classes from CSS module patterns
 */
const extractCSSModuleUsage = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/(?:\w+|\.\.\.\w+)\[['"`]([a-zA-Z0-9_-]+)['"`]\]/g, strippedCode)) {
    classes.add(match[1]);
  }

  for (const match of allMatches(/(\w+)\.([a-zA-Z0-9_-]+)/g, strippedCode)) {
    const objName = match[1];
    const isStylesObj = objName.endsWith('styles') || objName.endsWith('Styles') || objName.endsWith('css') || objName.endsWith('Css');
    if (isStylesObj) {
      classes.add(match[2]);
    }
  }
};

/**
 * Add classes from property string values
 */
const extractPropertyStrings = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/(?:\w+)\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g, strippedCode)) {
    classes.add(match[1]);
  }
};

/**
 * Process an opening bracket in array context detection
 */
const processOpenBracket = (bracketCount: number): { bracketCount: number; found: boolean } => {
  const newCount = bracketCount - 1;
  return { bracketCount: newCount, found: newCount < 0 };
};

/**
 * Check if a position in code is inside an array context
 */
const isInArrayContext = (code: string, position: number): boolean => {
  const start = Math.max(0, position - 200);
  const lookback = code.slice(start, position).split('').reverse();

  const result = lookback.reduce<{ bracketCount: number; found: boolean }>((state, char) => {
    if (state.found) return state;
    if (char === ']') return { ...state, bracketCount: state.bracketCount + 1 };
    if (char === '[') return processOpenBracket(state.bracketCount);
    return state;
  }, { bracketCount: 0, found: false });

  return result.found;
};

/**
 * Add classes from array string literals
 */
const extractArrayStringLiterals = (strippedCode: string, classes: Set<string>): void => {
  for (const match of allMatches(/['"`]([a-zA-Z0-9_-]+)['"`]/g, strippedCode)) {
    if (isInArrayContext(strippedCode, match.index)) {
      classes.add(match[1]);
    }
  }
};

/**
 * Extract data attributes from source code
 */
const extractDataAttributes = (strippedCode: string, attributes: Set<string>): void => {
  for (const match of allMatches(/dataset\.([a-zA-Z0-9]+)/g, strippedCode)) {
    const kebabCase = match[1].replace(/([A-Z])/g, '-$1').toLowerCase();
    attributes.add(`data-${kebabCase}`);
  }

  for (const match of allMatches(/dataset\[['"`]([a-zA-Z0-9-]+)['"`]\]/g, strippedCode)) {
    attributes.add(`data-${match[1]}`);
  }

  for (const match of allMatches(/dataset\[[^(]*\(['"`]([a-zA-Z0-9-]+)['"`]\)/g, strippedCode)) {
    attributes.add(`data-${match[1]}`);
  }

  for (const match of allMatches(/(?:querySelector|getAttribute|setAttribute|hasAttribute|querySelectorAll)\s*\(\s*['"`]?\[?data-([a-zA-Z0-9-]+)/g, strippedCode)) {
    attributes.add(`data-${match[1]}`);
  }

  for (const match of allMatches(/['"`]data-([a-zA-Z0-9-]+)['"`]/g, strippedCode)) {
    attributes.add(`data-${match[1]}`);
  }
};

/**
 * Find CSS class and attribute usage in source code
 */
export const findCSSUsage = (code: string): CSSUsage => {
  const classes = new Set<string>();
  const attributes = new Set<string>();
  const strippedCode = stripComments(code);

  extractClassListUsage(strippedCode, classes);
  extractClassNameAttr(strippedCode, classes);
  extractClassNameTemplates(strippedCode, classes);
  extractClassNameFuncCalls(strippedCode, classes);
  extractCSSModuleUsage(strippedCode, classes);
  extractPropertyStrings(strippedCode, classes);
  extractArrayStringLiterals(strippedCode, classes);
  extractDataAttributes(strippedCode, attributes);

  return { classes: Array.from(classes), attributes: Array.from(attributes) };
};

/**
 * Scan a single file for CSS usage
 */
export const scanFile = async (filePath: string): Promise<FileScanResult> => {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return { filePath, classes: [], attributes: [] };
    }

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
};

/**
 * Check if a directory entry is a scannable source file
 */
const isSourceFile = (entryName: string): boolean => {
  const ext = extname(entryName).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'].includes(ext);
};

/**
 * Process a single directory entry and collect file paths
 */
const processEntry = async (
  entry: { name: string; isDirectory: () => boolean; isFile: () => boolean },
  fullPath: string,
  excludeDirs: string[],
): Promise<string[]> => {
  if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
    return scanDirectory(fullPath, excludeDirs);
  }
  if (entry.isFile() && isSourceFile(entry.name)) {
    return [fullPath];
  }
  return [];
};

/**
 * Recursively scan a directory for source files
 */
const scanDirectory = async (
  dir: string,
  excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static'],
): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(entry => processEntry(entry, join(dir, entry.name), excludeDirs)),
    );
    return results.flat();
  } catch {
    return [];
  }
};

/**
 * Scan a source directory for all CSS usage
 */
export const scanSourceDirectory = async (dir: string, options: { exclude?: string[] } = {}): Promise<ScanResult> => {
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', ...(options.exclude ?? [])];
  const sourceFiles = await scanDirectory(dir, excludeDirs);

  // Pass 1: Extract enum/type values and function returns from all files first
  for (const filePath of sourceFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      extractEnumValues(content);
      extractFunctionReturns(content);
    } catch {
      // Skip files that can't be read
    }
  }

  // Pass 2: Scan for CSS usage
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
};
