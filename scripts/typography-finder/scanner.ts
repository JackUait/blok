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
function isURL(text: string): boolean {
  return /^https?:\/\//.test(text) || /^www\./.test(text);
}

/**
 * Check if position is within a string literal
 */
function isInStringLiteral(line: string, pos: number): { inString: boolean; quoteType: string } {
  // Simple check: count quote types before position
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let i = 0;

  while (i < pos) {
    const char = line[i];

    if (char === "'" && !inDouble && !inTemplate) {
      // Check for escaped quote
      if (line[i - 1] !== '\\') {
        inSingle = !inSingle;
      }
    } else if (char === '"' && !inSingle && !inTemplate) {
      if (line[i - 1] !== '\\') {
        inDouble = !inDouble;
      }
    } else if (char === '`' && !inSingle && !inDouble) {
      if (line[i - 1] !== '\\') {
        inTemplate = !inTemplate;
      }
    }
    i++;
  }

  if (inSingle) return { inString: true, quoteType: "'" };
  if (inDouble) return { inString: true, quoteType: '"' };
  if (inTemplate) return { inString: true, quoteType: '`' };
  return { inString: false, quoteType: '' };
}

/**
 * Check if the $ at position is part of a template literal expression ${...}
 */
function isInTemplateExpression(line: string, pos: number): boolean {
  // Check if the $ is followed by { (template expression)
  if (pos + 1 < line.length && line[pos + 1] === '{') {
    return true;
  }
  // Check if $ is a regex replacement pattern like $1, $2, etc.
  // In $1, $2, etc., the digit comes AFTER the $
  if (pos + 1 < line.length && /\d/.test(line[pos + 1])) {
    return true;
  }
  return false;
}

/**
 * Check if position is within a template literal expression ${...}
 * This handles the case where we're inside a template literal but within ${...} code
 */
function isInTemplateExpressionCode(line: string, pos: number): boolean {
  // Count ${ and } to see if we're inside an expression
  let depth = 0;
  let i = 0;

  while (i < pos) {
    if (i + 1 < line.length && line[i] === '$' && line[i + 1] === '{') {
      depth++;
      i += 2;
    } else if (line[i] === '}') {
      if (depth > 0) depth--;
      i++;
    } else {
      i++;
    }
  }

  return depth > 0;
}

/**
 * Check if position is within code operators (ternary, comparison, etc.)
 * @param line - the full line of code
 * @param pos - position of the punctuation mark
 * @param punct - the punctuation mark character
 * @param inString - whether we're inside a string literal
 */
function isInOperator(line: string, pos: number, punct: string, inString: boolean): boolean {
  if (punct === '?' || punct === ':') {
    const beforeChar = pos > 0 ? line[pos - 1] : '';
    const afterChar = pos + 1 < line.length ? line[pos + 1] : '';

    // ? or : with space before/after or part of ? : : or ?
    if (beforeChar === '?' || afterChar === '?' || beforeChar === ':' || afterChar === ':') {
      return true;
    }

    // Only check these patterns if NOT in a string literal
    // (In strings, these patterns might be French text)
    if (!inString) {
      // Check for : in type annotations (TypeScript)
      // Pattern: identifier : type or extends : type
      // Note: Type annotations have NO space before the colon
      if (punct === ':' && beforeChar !== ' ') {
        if (/\b(extends|keyof|typeof|infer)\s+/.test(line.substring(Math.max(0, pos - 20), pos))) {
          return true;
        }
      }

      // Check for : after property names in object literals (e.g., "key": value or 'key': value)
      // This has : directly after quote or word, no space before
      if (/['"]\w+['"]\s*:/.test(line.substring(Math.max(0, pos - 10), pos + 2))) {
        return true;
      }
      if (/\w\s*:/.test(line.substring(Math.max(0, pos - 5), pos + 1))) {
        return true;
      }

      // Check for : that is part of a ternary operator (e.g., ? ... : or } ... :)
      // Look for a ? earlier in the line (within reasonable distance)
      if (punct === ':') {
        // Check if : is preceded by } or ] (closing object/array in ternary)
        // Pattern: ? { ... } : or ? [ ... ] :
        if (beforeChar === ' ' || beforeChar === '}' || beforeChar === ']') {
          const beforePart = line.substring(Math.max(0, pos - 100), pos);
          // Look for ? in the preceding part (ternary operator)
          if (/\?\s*(?:{|\[|\w)/.test(beforePart)) {
            return true;
          }
        }
      }

      // Check for ? in ternary: identifier ? identifier : identifier
      // The regex matches word + space + ?, so check if there's a corresponding : later
      if (punct === '?' && beforeChar === ' ') {
        const afterPart = line.substring(pos, Math.min(pos + 50, line.length));
        if (/\s:\s/.test(afterPart) || /\s:\w/.test(afterPart)) {
          return true;
        }
      }
    }
  }

  if (punct === '!') {
    // Check for !=, !==, !if, etc.
    const afterChar = pos + 1 < line.length ? line[pos + 1] : '';
    if (afterChar === '=' || afterChar === '!') {
      return true;
    }
  }

  return false;
}

/**
 * Check if position is within JSX content (between > and < tags)
 */
function isInJSXContent(line: string, pos: number): boolean {
  // Find all JSX tag boundaries
  let depth = 0;
  let inJSX = false;
  let i = 0;

  while (i < pos) {
    if (line[i] === '<') {
      // Check if it's a closing tag or JSX comment
      if (line[i + 1] === '/' || line[i + 1] === '!') {
        // Still in JSX content before closing
      } else {
        // Opening tag - we're entering a tag, not content
        if (inJSX) {
          depth++;
        }
        inJSX = false;
      }
    } else if (line[i] === '>') {
      inJSX = true;
      if (depth > 0) depth--;
    }
    i++;
  }

  // If we're in JSX content (after > and before <)
  return inJSX && depth === 0;
}

/**
 * Check if position is within a regex literal
 */
function isInRegexLiteral(line: string, pos: number): boolean {
  // Find all regex literals in the line
  const regexRegex = /\/[^\/\s\\]*(?:\\.[^\/\s\\]*)*\//g;
  let match;
  while ((match = regexRegex.exec(line)) !== null) {
    if (pos >= match.index && pos < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

/**
 * Check if context suggests this is code/technical content
 * not user-facing text
 */
function isTechnicalContext(beforeText: string): boolean {
  // Check for common code patterns
  const technicalPatterns = [
    /\b(const|let|var|function|class|import|export|return|if|for|while)\s*$/,
    /\/\/.*/,  // single-line comment
    /\/\*/,    // multi-line comment start
    /https?:/,
    /className\s*=\s*['"`]/,
    /\bclass\s*\w/,
    /\btwMerge\(/,  // Tailwind class merging
    /\btwJoin\(/,   // Tailwind class joining
    /css\./,        // CSS module objects
  ];

  return technicalPatterns.some(pattern => pattern.test(beforeText));
}

/**
 * Check if a line contains CSS class patterns (Tailwind, CSS modules, etc.)
 */
function isCssClassLine(line: string): boolean {
  // Check for Tailwind CSS class patterns (classes with hyphens, !important, etc.)
  // Patterns like: 'text-red-500 bg-blue-100 !important'
  const cssPatterns = [
    /'[^']*!-[a-z]/,  // Single quote string containing !modifier
    /"[^"]*!-[a-z]/,   // Double quote string containing !modifier
    /`[^`]*!-[a-z]/,   // Backtick string containing !modifier
    /'[^']*-[^']*-[^']*'/,  // Single quote with double hyphen (Tailwind pattern like bg-blue-500)
    /"[^"]*-[^"]*-[^"]*"/,  // Double quote with double hyphen
    /`[^`]*-[^`]*-[^`]*`/,  // Backtick with double hyphen
    /\btwMerge\(/,
    /\btwJoin\(/,
    /className:/,
    /class=/,
  ];

  return cssPatterns.some(pattern => pattern.test(line));
}

/**
 * Check if the punctuation mark is part of a CSS pseudo-class or CSS syntax
 * Patterns: :has, :not, :nth-child, :first-child, etc.
 * Also checks for CSS property patterns like "36px ;" or "color :"
 */
function isCssPunctuation(line: string, pos: number, punct: string): boolean {
  if (punct === ':') {
    // Check for CSS pseudo-classes: :has, :not, :nth, :first, :last, :before, :after, etc.
    const afterPart = line.substring(pos + 1, Math.min(pos + 15, line.length));
    if (/^has\(|^not\(|^nth-|^first-|^last-|^before\(|^after\(/.test(afterPart)) {
      return true;
    }

    // Check for CSS property pattern: "word + space + :" followed by value (not in French text)
    // Pattern: "margin :", "color :", etc. in CSS strings
    const beforePart = line.substring(Math.max(0, pos - 15), pos);
    if (/\b(margin|padding|color|background|width|height|border|font|text|display|position|top|left|right|bottom)\s+$/.test(beforePart)) {
      return true;
    }
  }

  if (punct === ';') {
    // Check for CSS property value ending: "36px ;", "red ;", etc.
    const beforePart = line.substring(Math.max(0, pos - 20), pos);
    if (/\d+(?:px|em|rem|%|vh|vw|deg|s|ms)\s+$/.test(beforePart)) {
      return true;
    }
  }

  return false;
}

/**
 * Find typography issues in source code
 */
export function findTypographyIssues(code: string): { issues: TypographyIssue[] } {
  const issues: TypographyIssue[] = [];
  const lines = code.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Skip comment-only lines
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
      continue;
    }

    // Check each French punctuation mark
    for (const punct of FRENCH_PUNCTUATION) {
      // For currency symbols ($, €, %), they come after digits
      // For punctuation (? ! : ;), they come after letters/words
      const isCurrency = ['$', '€', '%'].includes(punct);

      if (isCurrency) {
        // Pattern: digit + space + currency symbol
        const currencyRegex = /(\d)\s+(\$|€|%)/g;
        let match;
        while ((match = currencyRegex.exec(line)) !== null) {
          if (match[2] !== punct) continue;

          const startPos = match.index;
          const punctPos = startPos + match[0].length - 1;

          // Skip if in regex literal
          if (isInRegexLiteral(line, punctPos)) {
            continue;
          }

          // Skip if $ is part of template expression ${...} or regex replacement $1, $2, etc.
          if (punct === '$' && isInTemplateExpression(line, punctPos)) {
            continue;
          }

          // Skip if not in string literal (currency symbols should only be in user-facing strings)
          const stringCheck = isInStringLiteral(line, punctPos);
          if (!stringCheck.inString) {
            continue;
          }

          const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);

          // Skip technical context
          if (isTechnicalContext(beforeContext)) {
            continue;
          }

          issues.push({
            type: 'missing-nbsp',
            punctuation: punct,
            line: lineIdx + 1,
            column: punctPos + 1,
            text: line.substring(startPos, punctPos + 1),
            suggestion: match[1] + NBSP + punct,
          });
        }
      } else {
        // For punctuation marks: Pattern: letter/word/} + regular space(s) + punctuation
        // Include } to match JSX expressions like {name} !
        const regex = new RegExp(`([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ}])\\s+\\${punct}`, 'g');

        let match;
        while ((match = regex.exec(line)) !== null) {
          const charBefore = match[1];
          const startPos = match.index;
          const punctPos = startPos + match[0].length - 1;

          // Skip if in regex literal
          if (isInRegexLiteral(line, punctPos)) {
            continue;
          }

          // Check if in string literal or JSX content
          const stringCheck = isInStringLiteral(line, punctPos);
          const inJSX = isInJSXContent(line, punctPos);

          // Skip if part of code operators (ternary, comparison, etc.)
          // We pass inString to avoid false positives on French text
          if (isInOperator(line, punctPos, punct, stringCheck.inString)) {
            continue;
          }

          if (!stringCheck.inString && !inJSX) {
            continue; // Skip if not in a string or JSX
          }

          // Skip if in template literal but inside ${...} code expression
          if (stringCheck.inString && stringCheck.quoteType === '`') {
            if (isInTemplateExpressionCode(line, punctPos)) {
              continue;
            }
          }

          // Skip if in string literal that looks like a URL
          if (stringCheck.inString) {
            const fullMatch = line.substring(startPos, punctPos + 1);
            if (isURL(fullMatch)) {
              continue;
            }
          }

          // Get context before the match
          const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);

          // Skip technical context
          if (isTechnicalContext(beforeContext)) {
            continue;
          }

          // Skip if this looks like CSS syntax (pseudo-classes, property values, etc.)
          if (isCssPunctuation(line, punctPos, punct)) {
            continue;
          }

          // Skip if this looks like a CSS class line (Tailwind classes, etc.)
          if (isCssClassLine(line)) {
            continue;
          }

          // Check if NBSP already exists (between the letter and punctuation)
          const between = line.substring(startPos + 1, punctPos);
          if (between.includes(NBSP)) {
            continue; // Already has NBSP
          }

          const text = line.substring(startPos - 5, punctPos + 2);
          issues.push({
            type: 'missing-nbsp',
            punctuation: punct,
            line: lineIdx + 1,
            column: punctPos + 1,
            text: text.trim(),
            suggestion: charBefore + NBSP + punct,
          });
        }

        // Also check for: letter directly followed by punctuation (no space) in strings
        // This is only an issue if it's user-facing French text
        const directRegex = new RegExp(`([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ])\\${punct}`, 'g');
        while ((match = directRegex.exec(line)) !== null) {
          const charBefore = match[1];
          const startPos = match.index;
          const punctPos = startPos + 1;

          // Skip if in regex literal
          if (isInRegexLiteral(line, punctPos)) {
            continue;
          }

          // Only flag if in string literal or JSX and looks like French
          const stringCheck = isInStringLiteral(line, punctPos);
          const inJSX = isInJSXContent(line, punctPos);

          // Skip if part of code operators (ternary, comparison, etc.)
          // We pass inString to avoid false positives on French text
          if (isInOperator(line, punctPos, punct, stringCheck.inString)) {
            continue;
          }

          if ((stringCheck.inString || inJSX) && /[àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]/.test(charBefore)) {
            // Skip if in template literal but inside ${...} code expression
            if (stringCheck.inString && stringCheck.quoteType === '`') {
              if (isInTemplateExpressionCode(line, punctPos)) {
                continue;
              }
            }

            const beforeContext = line.substring(Math.max(0, startPos - 50), startPos);
            if (!isTechnicalContext(beforeContext)) {
              const text = line.substring(startPos - 5, punctPos + 2);
              issues.push({
                type: 'missing-nbsp',
                punctuation: punct,
                line: lineIdx + 1,
                column: punctPos + 1,
                text: text.trim(),
                suggestion: charBefore + NBSP + punct,
              });
            }
          }
        }
      }
    }

    // Check guillemets « »
    // French: «text» should have NBSP inside: « text »
    // Look for « followed by regular space
    let openMatch;
    const openPattern = /«\s+/g;
    while ((openMatch = openPattern.exec(line)) !== null) {
      const openPos = openMatch.index;
      // Check if in string literal or JSX
      const stringCheck = isInStringLiteral(line, openPos + 1);
      const inJSX = isInJSXContent(line, openPos + 1);

      if ((stringCheck.inString || inJSX) && !openMatch[0].includes(NBSP)) {
        const beforeContext = line.substring(Math.max(0, openPos - 50), openPos);
        if (!isTechnicalContext(beforeContext)) {
          issues.push({
            type: 'missing-nbsp-guillemets',
            punctuation: '«',
            line: lineIdx + 1,
            column: openPos + 2,
            text: line.substring(openPos, Math.min(line.length, openPos + 10)),
            suggestion: `«${NBSP}`,
          });
        }
      }
    }

    // Look for » preceded by regular space
    let closeMatch;
    const closePattern = /\s+»/g;
    while ((closeMatch = closePattern.exec(line)) !== null) {
      const closePos = closeMatch.index + closeMatch[0].length - 1;
      // Check if in string literal or JSX
      const stringCheck = isInStringLiteral(line, closePos);
      const inJSX = isInJSXContent(line, closePos);

      if ((stringCheck.inString || inJSX) && !closeMatch[0].includes(NBSP)) {
        const beforeContext = line.substring(Math.max(0, closeMatch.index - 50), closeMatch.index);
        if (!isTechnicalContext(beforeContext)) {
          issues.push({
            type: 'missing-nbsp-guillemets',
            punctuation: '»',
            line: lineIdx + 1,
            column: closePos + 1,
            text: line.substring(Math.max(0, closeMatch.index - 5), closePos + 1),
            suggestion: `${NBSP}»`,
          });
        }
      }
    }
  }

  return { issues };
}

/**
 * Scan a single file for typography issues
 */
export async function scanFile(filePath: string): Promise<FileTypoResult> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return { filePath, issues: [] };
    }

    // Skip binary files
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
}

/**
 * Recursively scan a directory for source files
 */
async function scanDirectory(dir: string, excludeDirs: string[] = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', 'blok-master', 'typography-finder']): Promise<string[]> {
  const files: string[] = [];

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
 * Clear any internal caches (for testing)
 */
export function clearTypoCache(): void {
  // No caches to clear in current implementation
}

/**
 * Scan a source directory for typography issues
 */
export async function scanSourceDirectory(dir: string, options: { exclude?: string[] } = {}): Promise<ScanTypoResult> {
  const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', 'blok-master', 'typography-finder', ...(options.exclude ?? [])];
  const sourceFiles = await scanDirectory(dir, excludeDirs);

  const totalIssues: number[] = [];
  const fileResults: FileTypoResult[] = [];

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
}
