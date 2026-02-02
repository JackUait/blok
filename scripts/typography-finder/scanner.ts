/**
 * Typography Scanner - Scans source files for French typography violations
 *
 * French typography rules require non-breaking spaces before certain punctuation marks:
 * - ? ! : ; (high punctuation)
 * - % € $ (currency symbols)
 * - « » (guillemets - non-breaking spaces inside)
 *
 * Sources:
 * - https://www.noslangues-ourlanguages.gc.ca/en/writing-tips-plus/punctuation-standard-spacing-in-english-and-french
 * - https://brunobernard.com/en/typographic-space-invisible-yet-essential/
 */

import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const NBSP = '\u00A0';

/**
 * French punctuation marks that require non-breaking spaces before them
 */
const FRENCH_PUNCTUATION = ['?', '!', ':', ';', '%', '€', '$'];

/**
 * Typography issue found in code
 */
export interface TypographyIssue {
  type: 'missing-nbsp' | 'missing-nbsp-guillemets';
  punctuation: string;
  line: number;
  column: number;
  text: string;
  suggestion: string;
}

/**
 * Result of scanning a file
 */
export interface FileTypoResult {
  filePath: string;
  issues: TypographyIssue[];
}

/**
 * Result of scanning a directory
 */
export interface ScanTypoResult {
  filesScanned: number;
  totalIssues: number;
  fileResults: FileTypoResult[];
}

/**
 * Check if a string looks like a URL
 */
const isURL = (text: string): boolean => {
  return /^https?:\/\//.test(text) || /^www\./.test(text);
};

/**
 * Determine quote state for a line up to a position
 */
const getQuoteState = (line: string, pos: number): { inSingle: boolean; inDouble: boolean; inTemplate: boolean } => {
  return Array.from({ length: pos }).reduce<{ inSingle: boolean; inDouble: boolean; inTemplate: boolean }>(
    (state, _, i) => {
      const char = line[i];
      const prevChar = line[i - 1] ?? '';
      const isEscaped = prevChar === '\\';

      if (char === "'" && !state.inDouble && !state.inTemplate && !isEscaped) {
        return { ...state, inSingle: !state.inSingle };
      }
      if (char === '"' && !state.inSingle && !state.inTemplate && !isEscaped) {
        return { ...state, inDouble: !state.inDouble };
      }
      if (char === '`' && !state.inSingle && !state.inDouble && !isEscaped) {
        return { ...state, inTemplate: !state.inTemplate };
      }
      return state;
    },
    { inSingle: false, inDouble: false, inTemplate: false }
  );
};

/**
 * Check if position is within a string literal
 */
const isInStringLiteral = (line: string, pos: number): { inString: boolean; quoteType: string } => {
  const state = getQuoteState(line, pos);

  if (state.inSingle) return { inString: true, quoteType: "'" };
  if (state.inDouble) return { inString: true, quoteType: '"' };
  if (state.inTemplate) return { inString: true, quoteType: '`' };
  return { inString: false, quoteType: '' };
};

/**
 * Check if the $ at position is part of a template literal expression ${...}
 */
const isInTemplateExpression = (line: string, pos: number): boolean => {
  if (pos + 1 < line.length && line[pos + 1] === '{') {
    return true;
  }
  if (pos + 1 < line.length && /\d/.test(line[pos + 1])) {
    return true;
  }
  return false;
};

/**
 * Count template expression nesting depth at a position
 */
const countTemplateDepth = (line: string, pos: number): number => {
  return Array.from({ length: pos }).reduce<{ depth: number; skip: boolean }>(
    (state, _, i) => {
      if (state.skip) {
        return { ...state, skip: false };
      }
      if (i + 1 < line.length && line[i] === '$' && line[i + 1] === '{') {
        return { depth: state.depth + 1, skip: true };
      }
      if (line[i] === '}' && state.depth > 0) {
        return { depth: state.depth - 1, skip: false };
      }
      return state;
    },
    { depth: 0, skip: false }
  ).depth;
};

/**
 * Check if position is within a template literal expression ${...}
 */
const isInTemplateExpressionCode = (line: string, pos: number): boolean => {
  return countTemplateDepth(line, pos) > 0;
};

/**
 * Check if colon is in a TypeScript type annotation context
 */
const isTypeAnnotationColon = (line: string, pos: number, beforeChar: string): boolean => {
  if (beforeChar === ' ') {
    return false;
  }
  return /\b(extends|keyof|typeof|infer)\s+/.test(line.substring(Math.max(0, pos - 20), pos));
};

/**
 * Check if colon is after a property name in object literal
 */
const isPropertyColon = (line: string, pos: number): boolean => {
  const nearby = line.substring(Math.max(0, pos - 10), pos + 2);

  if (/['"]\w+['"]\s*:/.test(nearby)) {
    return true;
  }
  return /\w\s*:/.test(line.substring(Math.max(0, pos - 5), pos + 1));
};

/**
 * Check if colon is part of a ternary operator
 */
const isTernaryColon = (line: string, pos: number, beforeChar: string): boolean => {
  if (beforeChar !== ' ' && beforeChar !== '}' && beforeChar !== ']') {
    return false;
  }
  const beforePart = line.substring(Math.max(0, pos - 100), pos);

  return /\?\s*(?:{|\[|\w)/.test(beforePart);
};

/**
 * Check if question mark is part of a ternary operator
 */
const isTernaryQuestion = (line: string, pos: number, beforeChar: string): boolean => {
  if (beforeChar !== ' ') {
    return false;
  }
  const afterPart = line.substring(pos, Math.min(pos + 50, line.length));

  return /\s:\s/.test(afterPart) || /\s:\w/.test(afterPart);
};

/**
 * Check if colon is used as code syntax (type annotation, property, ternary)
 */
const isCodeColon = (line: string, pos: number, beforeChar: string): boolean => {
  if (isTypeAnnotationColon(line, pos, beforeChar)) {
    return true;
  }
  if (isPropertyColon(line, pos)) {
    return true;
  }
  return isTernaryColon(line, pos, beforeChar);
};

/**
 * Check if ? or : is an operator rather than French punctuation
 */
const isQuestionOrColonOperator = (line: string, pos: number, punct: string, inString: boolean): boolean => {
  const beforeChar = pos > 0 ? line[pos - 1] : '';
  const afterChar = pos + 1 < line.length ? line[pos + 1] : '';

  if (beforeChar === '?' || afterChar === '?' || beforeChar === ':' || afterChar === ':') {
    return true;
  }

  if (inString) {
    return false;
  }

  if (punct === ':') {
    return isCodeColon(line, pos, beforeChar);
  }

  if (punct === '?') {
    return isTernaryQuestion(line, pos, beforeChar);
  }

  return false;
};

/**
 * Check if position is within code operators (ternary, comparison, etc.)
 */
const isInOperator = (line: string, pos: number, punct: string, inString: boolean): boolean => {
  if (punct === '?' || punct === ':') {
    return isQuestionOrColonOperator(line, pos, punct, inString);
  }

  if (punct === '!') {
    const afterChar = pos + 1 < line.length ? line[pos + 1] : '';

    return afterChar === '=' || afterChar === '!';
  }

  return false;
};

/**
 * Compute JSX state at a given character position
 */
const computeJSXState = (char: string, inJSX: boolean, depth: number): { inJSX: boolean; depth: number } => {
  if (char === '<') {
    return { inJSX: false, depth: inJSX ? depth + 1 : depth };
  }
  if (char === '>') {
    return { inJSX: true, depth: depth > 0 ? depth - 1 : depth };
  }
  return { inJSX, depth };
};

/**
 * Check if position is within JSX content (between > and < tags)
 */
const isInJSXContent = (line: string, pos: number): boolean => {
  const state = Array.from({ length: pos }).reduce<{ inJSX: boolean; depth: number }>(
    (acc, _, i) => computeJSXState(line[i], acc.inJSX, acc.depth),
    { inJSX: false, depth: 0 }
  );

  return state.inJSX && state.depth === 0;
};

/**
 * Collect all regex match positions in a line
 */
const getRegexRanges = (line: string): Array<{ start: number; end: number }> => {
  const regexRegex = /\/[^\/\s\\]*(?:\\.[^\/\s\\]*)*\//g;
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of line.matchAll(regexRegex)) {
    if (match.index !== undefined) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return ranges;
};

/**
 * Check if position is within a regex literal
 */
const isInRegexLiteral = (line: string, pos: number): boolean => {
  return getRegexRanges(line).some(range => pos >= range.start && pos < range.end);
};

/**
 * Check if context suggests this is code/technical content
 * not user-facing text
 */
const isTechnicalContext = (beforeText: string): boolean => {
  const technicalPatterns = [
    /\b(const|let|var|function|class|import|export|return|if|for|while)\s*$/,
    /\/\/.*/,
    /\/\*/,
    /https?:/,
    /className\s*=\s*['"`]/,
    /\bclass\s*\w/,
    /\btwMerge\(/,
    /\btwJoin\(/,
    /css\./,
  ];

  return technicalPatterns.some(pattern => pattern.test(beforeText));
};

/**
 * Check if a line contains CSS class patterns (Tailwind, CSS modules, etc.)
 */
const isCssClassLine = (line: string): boolean => {
  const cssPatterns = [
    /'[^']*!-[a-z]/,
    /"[^"]*!-[a-z]/,
    /`[^`]*!-[a-z]/,
    /'[^']*-[^']*-[^']*'/,
    /"[^"]*-[^"]*-[^"]*"/,
    /`[^`]*-[^`]*-[^`]*`/,
    /\btwMerge\(/,
    /\btwJoin\(/,
    /className:/,
    /class=/,
  ];

  return cssPatterns.some(pattern => pattern.test(line));
};

/**
 * Check if colon is CSS pseudo-class or property syntax
 */
const isCssColonPunctuation = (line: string, pos: number): boolean => {
  const afterPart = line.substring(pos + 1, Math.min(pos + 15, line.length));

  if (/^has\(|^not\(|^nth-|^first-|^last-|^before\(|^after\(/.test(afterPart)) {
    return true;
  }

  const beforePart = line.substring(Math.max(0, pos - 15), pos);

  return /\b(margin|padding|color|background|width|height|border|font|text|display|position|top|left|right|bottom)\s+$/.test(beforePart);
};

/**
 * Check if the punctuation mark is part of a CSS pseudo-class or CSS syntax
 */
const isCssPunctuation = (line: string, pos: number, punct: string): boolean => {
  if (punct === ':') {
    return isCssColonPunctuation(line, pos);
  }

  if (punct === ';') {
    const beforePart = line.substring(Math.max(0, pos - 20), pos);

    return /\d+(?:px|em|rem|%|vh|vw|deg|s|ms)\s+$/.test(beforePart);
  }

  return false;
};

/**
 * Determine if a currency match should be skipped
 */
const shouldSkipCurrencyMatch = (
  line: string,
  punct: string,
  punctPos: number,
  startPos: number
): boolean => {
  if (isInRegexLiteral(line, punctPos)) {
    return true;
  }
  if (punct === '$' && isInTemplateExpression(line, punctPos)) {
    return true;
  }
  const stringCheck = isInStringLiteral(line, punctPos);

  if (!stringCheck.inString) {
    return true;
  }
  const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);

  return isTechnicalContext(beforeContext);
};

/**
 * Determine if a punctuation match should be skipped
 */
const shouldSkipPunctMatch = (
  line: string,
  punct: string,
  punctPos: number,
  startPos: number
): boolean => {
  if (isInRegexLiteral(line, punctPos)) {
    return true;
  }

  const stringCheck = isInStringLiteral(line, punctPos);
  const inJSX = isInJSXContent(line, punctPos);

  if (isInOperator(line, punctPos, punct, stringCheck.inString)) {
    return true;
  }
  if (!stringCheck.inString && !inJSX) {
    return true;
  }
  if (stringCheck.inString && stringCheck.quoteType === '`' && isInTemplateExpressionCode(line, punctPos)) {
    return true;
  }
  if (stringCheck.inString && isURL(line.substring(startPos, punctPos + 1))) {
    return true;
  }

  const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);

  if (isTechnicalContext(beforeContext)) {
    return true;
  }
  if (isCssPunctuation(line, punctPos, punct)) {
    return true;
  }
  if (isCssClassLine(line)) {
    return true;
  }

  const between = line.substring(startPos + 1, punctPos);

  return between.includes(NBSP);
};

/**
 * Process currency punctuation matches for a line
 */
const findCurrencyIssues = (line: string, punct: string, lineIdx: number): TypographyIssue[] => {
  const currencyRegex = /(\d)\s+(\$|€|%)/g;

  return Array.from(line.matchAll(currencyRegex))
    .filter(match => match[2] === punct)
    .filter(match => {
      const startPos = match.index ?? 0;
      const punctPos = startPos + match[0].length - 1;

      return !shouldSkipCurrencyMatch(line, punct, punctPos, startPos);
    })
    .map(match => {
      const startPos = match.index ?? 0;
      const punctPos = startPos + match[0].length - 1;

      return {
        type: 'missing-nbsp' as const,
        punctuation: punct,
        line: lineIdx + 1,
        column: punctPos + 1,
        text: line.substring(startPos, punctPos + 1),
        suggestion: match[1] + NBSP + punct,
      };
    });
};

/**
 * Check if a direct punctuation match (no space) should be flagged
 */
const shouldFlagDirectMatch = (
  line: string,
  punct: string,
  charBefore: string,
  punctPos: number,
  startPos: number
): boolean => {
  if (isInRegexLiteral(line, punctPos)) {
    return false;
  }

  const stringCheck = isInStringLiteral(line, punctPos);
  const inJSX = isInJSXContent(line, punctPos);

  if (isInOperator(line, punctPos, punct, stringCheck.inString)) {
    return false;
  }
  if (!stringCheck.inString && !inJSX) {
    return false;
  }
  if (!/[àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]/.test(charBefore)) {
    return false;
  }
  if (stringCheck.inString && stringCheck.quoteType === '`' && isInTemplateExpressionCode(line, punctPos)) {
    return false;
  }

  const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);

  return !isTechnicalContext(beforeContext);
};

/**
 * Process spaced punctuation matches for a line
 */
const findSpacedPunctIssues = (line: string, punct: string, lineIdx: number): TypographyIssue[] => {
  const regex = new RegExp(`([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ}])\\s+\\${punct}`, 'g');

  return Array.from(line.matchAll(regex))
    .filter(match => {
      const startPos = match.index ?? 0;
      const punctPos = startPos + match[0].length - 1;

      return !shouldSkipPunctMatch(line, punct, punctPos, startPos);
    })
    .map(match => {
      const charBefore = match[1];
      const startPos = match.index ?? 0;
      const punctPos = startPos + match[0].length - 1;
      const text = line.substring(startPos - 5, punctPos + 2);

      return {
        type: 'missing-nbsp' as const,
        punctuation: punct,
        line: lineIdx + 1,
        column: punctPos + 1,
        text: text.trim(),
        suggestion: charBefore + NBSP + punct,
      };
    });
};

/**
 * Process direct (no space) punctuation matches for a line
 */
const findDirectPunctIssues = (line: string, punct: string, lineIdx: number): TypographyIssue[] => {
  const directRegex = new RegExp(`([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ])\\${punct}`, 'g');

  return Array.from(line.matchAll(directRegex))
    .filter(match => {
      const charBefore = match[1];
      const startPos = match.index ?? 0;
      const punctPos = startPos + 1;

      return shouldFlagDirectMatch(line, punct, charBefore, punctPos, startPos);
    })
    .map(match => {
      const charBefore = match[1];
      const startPos = match.index ?? 0;
      const punctPos = startPos + 1;
      const text = line.substring(startPos - 5, punctPos + 2);

      return {
        type: 'missing-nbsp' as const,
        punctuation: punct,
        line: lineIdx + 1,
        column: punctPos + 1,
        text: text.trim(),
        suggestion: charBefore + NBSP + punct,
      };
    });
};

/**
 * Check for opening guillemet issues
 */
const findOpenGuillemetsIssues = (line: string, lineIdx: number): TypographyIssue[] => {
  const openPattern = /«\s+/g;

  return Array.from(line.matchAll(openPattern))
    .filter(match => {
      const openPos = match.index ?? 0;
      const stringCheck = isInStringLiteral(line, openPos + 1);
      const inJSX = isInJSXContent(line, openPos + 1);

      return (stringCheck.inString || inJSX) && !match[0].includes(NBSP);
    })
    .filter(match => {
      const openPos = match.index ?? 0;
      const beforeContext = line.substring(Math.max(0, openPos - 50), openPos);

      return !isTechnicalContext(beforeContext);
    })
    .map(match => {
      const openPos = match.index ?? 0;

      return {
        type: 'missing-nbsp-guillemets' as const,
        punctuation: '«',
        line: lineIdx + 1,
        column: openPos + 2,
        text: line.substring(openPos, Math.min(line.length, openPos + 10)),
        suggestion: `«${NBSP}`,
      };
    });
};

/**
 * Check for closing guillemet issues
 */
const findCloseGuillemetsIssues = (line: string, lineIdx: number): TypographyIssue[] => {
  const closePattern = /\s+»/g;

  return Array.from(line.matchAll(closePattern))
    .filter(match => {
      const closePos = (match.index ?? 0) + match[0].length - 1;
      const stringCheck = isInStringLiteral(line, closePos);
      const inJSX = isInJSXContent(line, closePos);

      return (stringCheck.inString || inJSX) && !match[0].includes(NBSP);
    })
    .filter(match => {
      const matchIndex = match.index ?? 0;
      const beforeContext = line.substring(Math.max(0, matchIndex - 50), matchIndex);

      return !isTechnicalContext(beforeContext);
    })
    .map(match => {
      const matchIndex = match.index ?? 0;
      const closePos = matchIndex + match[0].length - 1;

      return {
        type: 'missing-nbsp-guillemets' as const,
        punctuation: '»',
        line: lineIdx + 1,
        column: closePos + 1,
        text: line.substring(Math.max(0, matchIndex - 5), closePos + 1),
        suggestion: `${NBSP}»`,
      };
    });
};

/**
 * Check for guillemet issues in a line
 */
const findGuillemetsIssues = (line: string, lineIdx: number): TypographyIssue[] => {
  return [
    ...findOpenGuillemetsIssues(line, lineIdx),
    ...findCloseGuillemetsIssues(line, lineIdx),
  ];
};

/**
 * Process a single line for typography issues
 */
const processLine = (line: string, lineIdx: number): TypographyIssue[] => {
  const trimmedLine = line.trim();

  if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
    return [];
  }

  const punctIssues = FRENCH_PUNCTUATION.flatMap(punct => {
    const isCurrency = ['$', '€', '%'].includes(punct);

    if (isCurrency) {
      return findCurrencyIssues(line, punct, lineIdx);
    }
    return [
      ...findSpacedPunctIssues(line, punct, lineIdx),
      ...findDirectPunctIssues(line, punct, lineIdx),
    ];
  });

  return [
    ...punctIssues,
    ...findGuillemetsIssues(line, lineIdx),
  ];
};

/**
 * Find typography issues in source code
 */
export const findTypographyIssues = (code: string): { issues: TypographyIssue[] } => {
  const lines = code.split('\n');
  const issues = lines.flatMap((line, lineIdx) => processLine(line, lineIdx));

  return { issues };
};

/**
 * Scan a single file for typography issues
 */
export const scanFile = async (filePath: string): Promise<FileTypoResult> => {
  try {
    const stats = await stat(filePath);

    if (!stats.isFile()) {
      return { filePath, issues: [] };
    }

    const ext = extname(filePath).toLowerCase();
    const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];

    if (!textExtensions.includes(ext)) {
      return { filePath, issues: [] };
    }

    const content = await readFile(filePath, 'utf-8');
    const result = findTypographyIssues(content);

    return { filePath, ...result };
  } catch {
    return { filePath, issues: [] };
  }
};

/**
 * Process a single directory entry during scanning
 */
const processEntry = async (
  entry: Dirent,
  dir: string,
  excludeDirs: string[],
  sourceExtensions: string[]
): Promise<string[]> => {
  const fullPath = join(dir, entry.name);

  if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
    return scanDirectory(fullPath, excludeDirs);
  }

  if (entry.isFile() && sourceExtensions.includes(extname(entry.name).toLowerCase())) {
    return [fullPath];
  }

  return [];
};

/**
 * Recursively scan a directory for source files
 */
const scanDirectory = async (dir: string, excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', 'blok-master', 'typography-finder']): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
    const results = await Promise.all(
      entries.map(entry => processEntry(entry, dir, excludeDirs, sourceExtensions))
    );

    return results.flat();
  } catch {
    return [];
  }
};

/**
 * Clear any internal caches (for testing)
 */
export const clearTypoCache = (): void => {
  // No caches to clear in current implementation
};

/**
 * Scan a source directory for typography issues
 */
export const scanSourceDirectory = async (dir: string, options: { exclude?: string[] } = {}): Promise<ScanTypoResult> => {
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', 'blok-master', 'typography-finder', ...(options.exclude ?? [])];
  const sourceFiles = await scanDirectory(dir, excludeDirs);

  const fileResults: FileTypoResult[] = [];
  const totalIssues: number[] = [];

  for (const filePath of sourceFiles) {
    const result = await scanFile(filePath);

    totalIssues.push(result.issues.length);
    fileResults.push(result);
  }

  return {
    filesScanned: sourceFiles.length,
    totalIssues: totalIssues.reduce((a, b) => a + b, 0),
    fileResults,
  };
};
