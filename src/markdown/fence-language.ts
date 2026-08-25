import { HIGHLIGHTABLE_LANGUAGES } from '../tools/code/constants';
import { extToPrismLang } from '../tools/file/code-languages';

/**
 * Fence labels that are not file extensions, so they have no place in
 * EXT_TO_LANG — the file preview routes on `extToPrismLang(ext) !== null`, and
 * an entry there would make files of that extension render as code.
 */
const FENCE_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  golang: 'go',
  zsh: 'bash',
  console: 'bash',
  docker: 'dockerfile',
  tex: 'latex',
};

/**
 * Resolve a fenced-code language to a Prism id. A fence may carry a canonical
 * Prism id (`javascript`), a file extension (`js`), or a common alias
 * (`golang`). Returns null when no known language matches.
 */
export function normalizeFenceLang(rawLang: string): string | null {
  const lang = rawLang.trim().toLowerCase();

  if (lang === '') {
    return null;
  }

  if (HIGHLIGHTABLE_LANGUAGES.has(lang)) {
    return lang;
  }

  const mapped = FENCE_ALIASES[lang] ?? extToPrismLang(lang);

  if (mapped !== null && HIGHLIGHTABLE_LANGUAGES.has(mapped)) {
    return mapped;
  }

  return null;
}
