import { tokenizePrism } from './prism-loader';

/**
 * Languages considered for auto-detection.
 * Kept to ~15 common ones to keep detection fast.
 */
export const DETECTION_CANDIDATE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'html',
  'css',
  'json',
  'bash',
  'sql',
  'rust',
  'go',
  'cpp',
  'yaml',
  'markdown',
  'php',
] as const;

/** Minimum code length (characters) before attempting detection. */
const MIN_CODE_LENGTH = 20;

/**
 * Minimum number of distinct token types a tokenization must produce
 * to be considered a genuine match. Languages that colorize everything
 * with a single token type (e.g. YAML treating code as a string block)
 * produce a deceptively high score without actually recognizing the syntax.
 */
const MIN_DISTINCT_TYPES = 2;

/**
 * Threshold: if the winning language's diversity ratio is below this value,
 * no meaningful detection was possible and we return null.
 * A ratio of 0 means no token spans were found (plain text / unrecognized).
 * A higher ratio means more distinct token types relative to total tokens.
 */
const MIN_ACCEPTABLE_DIVERSITY_RATIO = 0.2;

/**
 * Scores how well Prism tokenized the code in a given language.
 * Returns a value in (0, 1] — higher is better (more token type diversity),
 * or null if the tokenization didn't use enough distinct types to be a real match.
 *
 * Strategy: count distinct token types from Prism's HTML output and compute
 * the ratio of distinct types to total token spans.
 * A well-matched language has many distinctly-typed tokens; a poorly-matched
 * language produces no token spans or only a single token type.
 *
 * Guard: if fewer than MIN_DISTINCT_TYPES appear, the grammar is treating
 * everything as the same token type (e.g. YAML string), which is a false positive.
 * Return null in that case.
 */
async function scoreLanguage(code: string, lang: string): Promise<number | null> {
  const html = await tokenizePrism(code, lang);
  if (!html) return null;

  // Count token spans by type using regex on the HTML output
  const matches = html.match(/class="token ([^"]+)"/g) ?? [];
  if (matches.length === 0) return null;

  // Extract unique token types (handle compound classes like "token keyword operator")
  const types = new Set(
    matches.flatMap(m => {
      const inner = m.slice('class="token '.length, -1); // e.g. "keyword" or "keyword operator"
      return inner.split(' ');
    })
  );

  if (types.size < MIN_DISTINCT_TYPES) return null;

  // Score: ratio of distinct types to total tokens — higher = more diverse = better match
  return types.size / matches.length;
}

/**
 * Detects the most likely programming language for the given code.
 * Returns a language ID from DETECTION_CANDIDATE_LANGUAGES, or null if:
 * - code is too short
 * - prism isn't loaded yet
 * - no language scores clearly better than plain text
 */
export async function detectLanguage(code: string): Promise<string | null> {
  if (code.length < MIN_CODE_LENGTH) {
    return null;
  }

  // Score all candidate languages concurrently
  const results = await Promise.all(
    DETECTION_CANDIDATE_LANGUAGES.map(async (lang) => {
      const score = await scoreLanguage(code, lang);
      return { lang, score };
    })
  );

  const best = results.reduce<{ lang: string | null; score: number }>(
    (acc, { lang, score }) => {
      if (score === null) return acc;
      return score > acc.score ? { lang, score } : acc;
    },
    { lang: null, score: -Infinity }
  );

  if (best.lang === null || best.score < MIN_ACCEPTABLE_DIVERSITY_RATIO) {
    return null;
  }

  return best.lang;
}
